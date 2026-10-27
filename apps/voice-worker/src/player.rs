//! Playback state machine.
//!
//! One actor owns the queue and the songbird call, so queue mutations never
//! race each other. Every public method is a message to that actor.
//!
//! Ports `MusicService` and `GuildPlayer` from
//! `apps/bot/src/features/music.ts`, minus the per-VC binding that lives on
//! the commander.

use std::collections::VecDeque;
use std::sync::Arc;

use serde::Serialize;
use serenity::model::id::{ChannelId, GuildId};
use songbird::{
    events::{Event, TrackEvent},
    tracks::TrackHandle,
    Call, EventContext, Songbird,
};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::audio::{build_input, AudioConfig};
use crate::fleet::Store;
use crate::model::{FilterPreset, LoopMode, MusicState, Track};
use crate::resolve::{ResolveError, Resolver};

/// Leave voice this long after the queue drains, matching
/// `IDLE_LEAVE_GRACE_MS` in the TypeScript worker.
pub const IDLE_LEAVE_GRACE_MS: u64 = 30_000;

#[derive(Debug, thiserror::Error)]
pub enum PlayerError {
    #[error("invalid worker token")]
    Unauthorized,
    #[error("the worker is not bound to a guild yet")]
    NotReady,
    #[error("music search failed, try again in a moment")]
    Unavailable,
    #[error("no tracks found for that search")]
    NoTracks,
    #[error("{0}")]
    Invalid(String),
    #[error("join a voice channel first")]
    NoVoice,
    #[error("the bot is not playing anything")]
    NothingPlaying,
    #[error("the queue is full")]
    QueueFull,
    #[error("{0}")]
    Internal(String),
}

impl PlayerError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::NotReady => "not_ready",
            Self::Unavailable => "unavailable",
            Self::NoTracks => "no_tracks",
            Self::Invalid(_) => "validation_error",
            Self::NoVoice => "no_voice",
            Self::NothingPlaying => "nothing_playing",
            Self::QueueFull => "queue_full",
            Self::Internal(_) => "internal_error",
        }
    }
}

impl From<ResolveError> for PlayerError {
    fn from(error: ResolveError) -> Self {
        match error {
            ResolveError::Unavailable => Self::Unavailable,
            ResolveError::NoTracks => Self::NoTracks,
            ResolveError::Invalid(message) => Self::Invalid(message),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayOutcome {
    pub added: usize,
    pub first: Track,
}

/// Shared with the command actor and the API layer.
#[derive(Clone)]
pub struct PlayerHandle {
    tx: mpsc::Sender<Command>,
}

impl PlayerHandle {
    pub async fn state(&self) -> MusicState {
        let (tx, rx) = oneshot::channel();
        if self.tx.send(Command::State { reply: tx }).await.is_err() {
            return MusicState::default();
        }
        rx.await.unwrap_or_default()
    }

    pub async fn join(&self, channel_id: Option<String>) -> Result<String, PlayerError> {
        self.call(|reply| Command::Join { channel_id, reply }).await
    }

    pub async fn play(
        &self,
        query: String,
        channel_id: Option<String>,
        next: bool,
    ) -> Result<PlayOutcome, PlayerError> {
        self.call(|reply| Command::Play {
            query,
            channel_id,
            next,
            reply,
        })
        .await
    }

    pub async fn pause(&self) -> Result<(), PlayerError> {
        self.call(|reply| Command::Pause { reply }).await
    }

    pub async fn resume(&self) -> Result<(), PlayerError> {
        self.call(|reply| Command::Resume { reply }).await
    }

    pub async fn stop(&self) -> Result<(), PlayerError> {
        self.call(|reply| Command::Stop { reply }).await
    }

    pub async fn disconnect(&self) -> Result<(), PlayerError> {
        self.call(|reply| Command::Disconnect { reply }).await
    }

    pub async fn clear(&self) -> Result<(), PlayerError> {
        self.call(|reply| Command::Clear { reply }).await
    }

    pub async fn shuffle(&self) -> Result<(), PlayerError> {
        self.call(|reply| Command::Shuffle { reply }).await
    }

    pub async fn skip(&self, count: i64) -> Result<(), PlayerError> {
        self.call(|reply| Command::Skip { count, reply }).await
    }

    pub async fn volume(&self, volume: i64) -> Result<u8, PlayerError> {
        self.call(|reply| Command::Volume { volume, reply }).await
    }

    pub async fn seek(&self, position_ms: i64) -> Result<(), PlayerError> {
        self.call(|reply| Command::Seek { position_ms, reply }).await
    }

    pub async fn set_loop_mode(&self, mode: &str) -> Result<(), PlayerError> {
        let mode = match mode {
            "off" => LoopMode::Off,
            "track" => LoopMode::Track,
            "queue" => LoopMode::Queue,
            other => return Err(PlayerError::Invalid(format!("Unknown loop mode: {other}"))),
        };
        self.call(|reply| Command::SetLoop { mode, reply }).await
    }

    pub async fn remove(&self, index: i64) -> Result<String, PlayerError> {
        self.call(|reply| Command::Remove { index, reply }).await
    }

    pub async fn move_track(&self, from: i64, to: i64) -> Result<(), PlayerError> {
        self.call(|reply| Command::Move { from, to, reply }).await
    }

    pub async fn jump(&self, index: i64) -> Result<(), PlayerError> {
        self.call(|reply| Command::Jump { index, reply }).await
    }

    pub async fn set_autoplay(&self, enabled: bool) -> Result<(), PlayerError> {
        self.call(|reply| Command::SetAutoplay { enabled, reply }).await
    }

    pub async fn set_filter(&self, preset: &str) -> Result<(), PlayerError> {
        let preset = match preset {
            "off" => FilterPreset::Off,
            "bassboost" => FilterPreset::Bassboost,
            "nightcore" => FilterPreset::Nightcore,
            "vaporwave" => FilterPreset::Vaporwave,
            other => return Err(PlayerError::Invalid(format!("Unknown filter: {other}"))),
        };
        self.call(|reply| Command::SetFilter { preset, reply }).await
    }

    /// Play a local audio file on top of the current queue, used by TTS.
    pub async fn play_file(&self, path: String) -> Result<(), PlayerError> {
        self.call(|reply| Command::PlayFile { path, reply }).await
    }

    /// Take the voice channel for a TTS session, stopping music.
    pub async fn lock_tts(&self) -> Result<(), PlayerError> {
        self.call(|reply| Command::LockTts { reply }).await
    }

    /// Release the channel back to music.
    pub async fn unlock_tts(&self) -> Result<(), PlayerError> {
        self.call(|reply| Command::UnlockTts { reply }).await
    }

    async fn call<T>(
        &self,
        make: impl FnOnce(oneshot::Sender<Result<T, PlayerError>>) -> Command,
    ) -> Result<T, PlayerError> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(make(reply))
            .await
            .map_err(|_| PlayerError::NotReady)?;
        rx.await.map_err(|_| PlayerError::NotReady)?
    }
}

enum Command {
    State { reply: oneshot::Sender<MusicState> },
    Join { channel_id: Option<String>, reply: oneshot::Sender<Result<String, PlayerError>> },
    Play { query: String, channel_id: Option<String>, next: bool, reply: oneshot::Sender<Result<PlayOutcome, PlayerError>> },
    Pause { reply: oneshot::Sender<Result<(), PlayerError>> },
    Resume { reply: oneshot::Sender<Result<(), PlayerError>> },
    Stop { reply: oneshot::Sender<Result<(), PlayerError>> },
    Disconnect { reply: oneshot::Sender<Result<(), PlayerError>> },
    Clear { reply: oneshot::Sender<Result<(), PlayerError>> },
    Shuffle { reply: oneshot::Sender<Result<(), PlayerError>> },
    Skip { count: i64, reply: oneshot::Sender<Result<(), PlayerError>> },
    Volume { volume: i64, reply: oneshot::Sender<Result<u8, PlayerError>> },
    Seek { position_ms: i64, reply: oneshot::Sender<Result<(), PlayerError>> },
    SetLoop { mode: LoopMode, reply: oneshot::Sender<Result<(), PlayerError>> },
    Remove { index: i64, reply: oneshot::Sender<Result<String, PlayerError>> },
    Move { from: i64, to: i64, reply: oneshot::Sender<Result<(), PlayerError>> },
    Jump { index: i64, reply: oneshot::Sender<Result<(), PlayerError>> },
    SetAutoplay { enabled: bool, reply: oneshot::Sender<Result<(), PlayerError>> },
    SetFilter { preset: FilterPreset, reply: oneshot::Sender<Result<(), PlayerError>> },
    PlayFile { path: String, reply: oneshot::Sender<Result<(), PlayerError>> },
    LockTts { reply: oneshot::Sender<Result<(), PlayerError>> },
    UnlockTts { reply: oneshot::Sender<Result<(), PlayerError>> },
    IdleLeave { token: u64 },
    TrackEnded,
}

/// Bridges songbird's track-end event into the player actor.
struct TrackEndNotifier(mpsc::Sender<Command>);

#[async_trait::async_trait]
impl songbird::EventHandler for TrackEndNotifier {
    async fn act(&self, _ctx: &EventContext<'_>) -> Option<Event> {
        let _ = self.0.send(Command::TrackEnded).await;
        None
    }
}

pub struct Player {
    guild_id: Arc<tokio::sync::RwLock<Option<String>>>,
    manager: Arc<Songbird>,
    resolver: Resolver,
    store: Store,
    audio: AudioConfig,
    call: Option<Arc<Mutex<Call>>>,
    channel_id: Option<String>,
    queue: VecDeque<Track>,
    current: Option<Track>,
    loop_mode: LoopMode,
    autoplay: bool,
    volume: u8,
    filter: FilterPreset,
    paused: bool,
    started_at: Option<std::time::Instant>,
    position_base_ms: i64,
    current_handle: Option<TrackHandle>,
    events: mpsc::Sender<Command>,
    max_queue: usize,
    /// Set before a manual stop so the resulting End event does not advance twice.
    ignore_next_end: bool,
    /// Guard so the persisted queue is restored only on the first join.
    restored: bool,
    /// True while a TTS session owns the voice channel. Music is blocked and
    /// the idle-leave timer is suspended, matching the TypeScript lock.
    tts_active: bool,
    /// Bumped whenever playback starts, so a stale idle timer cannot fire.
    idle_token: u64,
}

impl Player {
    pub fn spawn(
        guild_id: Arc<tokio::sync::RwLock<Option<String>>>,
        manager: Arc<Songbird>,
        resolver: Resolver,
        store: Store,
        audio: AudioConfig,
    ) -> PlayerHandle {
        let (tx, rx) = mpsc::channel(64);
        let player = Self {
            guild_id,
            manager,
            resolver,
            store,
            audio,
            call: None,
            channel_id: None,
            queue: VecDeque::new(),
            current: None,
            loop_mode: LoopMode::Off,
            autoplay: false,
            volume: 80,
            filter: FilterPreset::Off,
            paused: false,
            started_at: None,
            position_base_ms: 0,
            current_handle: None,
            events: tx.clone(),
            max_queue: 1000,
            ignore_next_end: false,
            restored: false,
            tts_active: false,
            idle_token: 0,
        };
        tokio::spawn(player.run(rx));
        PlayerHandle { tx }
    }

    async fn run(mut self, mut rx: mpsc::Receiver<Command>) {
        while let Some(command) = rx.recv().await {
            match command {
                Command::State { reply } => {
                    let _ = reply.send(self.snapshot());
                }
                Command::Join { channel_id, reply } => {
                    let _ = reply.send(self.join(channel_id).await);
                }
                Command::Play { query, channel_id, next, reply } => {
                    let _ = reply.send(self.play(query, channel_id, next).await);
                }
                Command::Pause { reply } => {
                    let _ = reply.send(self.pause());
                }
                Command::Resume { reply } => {
                    let _ = reply.send(self.resume());
                }
                Command::Stop { reply } => {
                    let _ = reply.send(self.stop().await);
                }
                Command::Disconnect { reply } => {
                    let _ = reply.send(self.disconnect().await);
                }
                Command::Clear { reply } => {
                    self.queue.clear();
                    self.persist().await;
                    let _ = reply.send(Ok(()));
                }
                Command::Shuffle { reply } => {
                    shuffle(&mut self.queue);
                    self.persist().await;
                    let _ = reply.send(Ok(()));
                }
                Command::Skip { count, reply } => {
                    let _ = reply.send(self.skip(count).await);
                }
                Command::Volume { volume, reply } => {
                    let _ = reply.send(self.set_volume(volume));
                }
                Command::Seek { position_ms, reply } => {
                    let _ = reply.send(self.seek(position_ms).await);
                }
                Command::SetLoop { mode, reply } => {
                    self.loop_mode = mode;
                    let _ = reply.send(Ok(()));
                }
                Command::Remove { index, reply } => {
                    let _ = reply.send(self.remove(index));
                }
                Command::Move { from, to, reply } => {
                    let _ = reply.send(self.move_track(from, to));
                }
                Command::Jump { index, reply } => {
                    let _ = reply.send(self.jump(index).await);
                }
                Command::SetAutoplay { enabled, reply } => {
                    self.autoplay = enabled;
                    let _ = reply.send(Ok(()));
                }
                Command::SetFilter { preset, reply } => {
                    self.filter = preset;
                    let result = self.seek(self.position()).await;
                    let _ = reply.send(result);
                }
                Command::PlayFile { path, reply } => {
                    let _ = reply.send(self.play_file(path).await);
                }
                Command::LockTts { reply } => {
                    let _ = reply.send(self.lock_tts().await);
                }
                Command::UnlockTts { reply } => {
                    let _ = reply.send(self.unlock_tts().await);
                }
                Command::IdleLeave { token } => {
                    self.idle_leave(token).await;
                }
                Command::TrackEnded => {
                    // A TTS clip ending must not advance the music queue.
                    if self.tts_active {
                        self.ignore_next_end = false;
                    } else if self.ignore_next_end {
                        self.ignore_next_end = false;
                    } else {
                        self.advance().await;
                    }
                }
            }
        }
    }

    fn snapshot(&self) -> MusicState {
        MusicState {
            playing: self.current.is_some() && !self.paused,
            paused: self.paused,
            volume: self.volume,
            r#loop: self.loop_mode,
            position: self.position(),
            current: self.current.clone(),
            upcoming: self.queue.iter().cloned().collect(),
            channel_id: self.channel_id.clone(),
        }
    }

    fn position(&self) -> i64 {
        match (self.started_at, self.paused) {
            (Some(started), false) => self.position_base_ms + started.elapsed().as_millis() as i64,
            _ => self.position_base_ms,
        }
    }

    async fn guild(&self) -> Result<String, PlayerError> {
        self.guild_id
            .read()
            .await
            .clone()
            .ok_or(PlayerError::NotReady)
    }

    async fn ensure_call(&mut self, channel_id: Option<String>) -> Result<String, PlayerError> {
        let guild = self.guild().await?;
        let resolved = channel_id.or_else(|| self.channel_id.clone());

        if let (Some(existing), Some(target)) = (&self.call, resolved.as_deref()) {
            if self.channel_id.as_deref() == Some(target) {
                return Ok(target.to_string());
            }
            let _ = existing;
        }

        let Some(target) = resolved else {
            return Err(PlayerError::NoVoice);
        };

        let guild_id: GuildId = guild.parse().map_err(|_| PlayerError::NotReady)?;
        let channel_id: ChannelId = target
            .parse()
            .map_err(|_| PlayerError::Invalid("That is not a voice channel.".into()))?;

        let call = self
            .manager
            .join(guild_id, channel_id)
            .await
            // Debug form keeps the underlying driver cause; Display collapses
            // every driver failure to "establishing connection failed".
            .map_err(|error| PlayerError::Internal(format!("join failed: {error:?}")))?;

        if self.call.is_none() {
            let mut locked = call.lock().await;
            locked.add_global_event(
                Event::Track(TrackEvent::End),
                TrackEndNotifier(self.events.clone()),
            );
        }

        // The TypeScript worker restores the persisted queue but does not
        // resume playback, so do the same once, on first join.
        if !self.restored {
            self.restored = true;
            let restored = self.store.load_queue(&guild).await;
            if !restored.is_empty() {
                self.queue.extend(restored);
            }
        }

        self.call = Some(call);
        self.channel_id = Some(target.clone());
        Ok(target)
    }

    async fn join(&mut self, channel_id: Option<String>) -> Result<String, PlayerError> {
        self.ensure_call(channel_id).await
    }

    async fn play(
        &mut self,
        query: String,
        channel_id: Option<String>,
        next: bool,
    ) -> Result<PlayOutcome, PlayerError> {
        let channel = self.ensure_call(channel_id).await?;
        let _ = channel;

        if self.tts_active {
            return Err(PlayerError::Invalid(
                "TTS is using the voice channel. Turn it off before playing music.".into(),
            ));
        }

        let available = self
            .max_queue
            .saturating_sub(self.queue.len() + usize::from(self.current.is_some()));
        if available == 0 {
            return Err(PlayerError::QueueFull);
        }

        let resolved = self.resolver.resolve(&query, available).await?;
        let added = resolved.len();
        let first = resolved.first().cloned().ok_or(PlayerError::NoTracks)?;

        if next {
            for track in resolved.into_iter().rev() {
                self.queue.push_front(track);
            }
        } else {
            self.queue.extend(resolved);
        }

        if self.current.is_none() {
            self.advance().await;
        } else {
            self.persist().await;
        }

        Ok(PlayOutcome { added, first })
    }

    async fn advance(&mut self) {
        // TTS owns the channel; never start music underneath it.
        if self.tts_active {
            return;
        }

        if self.loop_mode == LoopMode::Track {
            if let Some(track) = self.current.clone() {
                let _ = self.start(track, 0).await;
                return;
            }
        }

        if self.loop_mode == LoopMode::Queue {
            if let Some(track) = self.current.clone() {
                self.queue.push_back(track);
            }
        }

        while let Some(track) = self.queue.pop_front() {
            if self.start(track, 0).await.is_ok() {
                self.persist().await;
                return;
            }
        }

        // Autoplay pulls one related track before the queue is declared empty.
        if self.autoplay {
            if let Some(previous) = self.current.clone() {
                let query = format!("{} {}", previous.author, previous.title);
                if let Ok(tracks) = self.resolver.resolve(&query, 1).await {
                    if let Some(next) = tracks.into_iter().next() {
                        if self.start(next, 0).await.is_ok() {
                            self.persist().await;
                            return;
                        }
                    }
                }
            }
        }

        self.current = None;
        self.current_handle = None;
        self.started_at = None;
        self.position_base_ms = 0;
        if let Ok(guild) = self.guild().await {
            self.store.clear_queue(&guild).await;
        }
        self.schedule_idle_leave();
    }

    async fn start(&mut self, track: Track, start_ms: i64) -> Result<(), PlayerError> {
        let Some(call) = self.call.clone() else {
            return Err(PlayerError::NoVoice);
        };

        let input = build_input(&track, start_ms, self.filter, &self.audio).await?;
        let handle = {
            let mut locked = call.lock().await;
            // play_only_input replaces whatever is playing instead of queueing
            // behind it; the queue is owned by this actor, not by songbird.
            let handle = locked.play_only_input(input);
            handle.set_volume(self.volume as f32 / 100.0).ok();
            handle
        };

        self.current = Some(track);
        self.current_handle = Some(handle);
        self.started_at = Some(std::time::Instant::now());
        self.position_base_ms = start_ms;
        self.paused = false;
        // Cancel any pending idle leave.
        self.idle_token = self.idle_token.wrapping_add(1);
        Ok(())
    }

    fn pause(&mut self) -> Result<(), PlayerError> {
        if self.current.is_none() {
            return Err(PlayerError::NothingPlaying);
        }
        if let Some(handle) = &self.current_handle {
            let _ = handle.pause();
        }
        self.position_base_ms = self.position();
        self.paused = true;
        self.started_at = None;
        Ok(())
    }

    fn resume(&mut self) -> Result<(), PlayerError> {
        if self.current.is_none() {
            return Err(PlayerError::NothingPlaying);
        }
        if let Some(handle) = &self.current_handle {
            let _ = handle.play();
        }
        self.paused = false;
        self.started_at = Some(std::time::Instant::now());
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), PlayerError> {
        self.queue.clear();
        self.current = None;
        self.current_handle = None;
        self.started_at = None;
        self.paused = false;
        if let Some(call) = &self.call {
            let mut locked = call.lock().await;
            locked.stop();
        }
        if let Ok(guild) = self.guild().await {
            self.store.clear_queue(&guild).await;
        }
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), PlayerError> {
        if let Ok(guild) = self.guild().await {
            self.persist().await;
            if let Ok(guild_id) = guild.parse::<GuildId>() {
                let _ = self.manager.leave(guild_id).await;
            }
        }
        self.call = None;
        self.channel_id = None;
        self.queue.clear();
        self.current = None;
        self.current_handle = None;
        self.started_at = None;
        Ok(())
    }

    async fn skip(&mut self, count: i64) -> Result<(), PlayerError> {
        if self.current.is_none() {
            return Err(PlayerError::NothingPlaying);
        }
        let drop = (count.max(1) as usize).saturating_sub(1);
        for _ in 0..drop {
            self.queue.pop_front();
        }
        if let Some(handle) = &self.current_handle {
            self.ignore_next_end = true;
            let _ = handle.stop();
        }
        self.current = None;
        self.advance().await;
        Ok(())
    }

    fn set_volume(&mut self, volume: i64) -> Result<u8, PlayerError> {
        let value = volume.clamp(0, 150) as u8;
        self.volume = value;
        if let Some(handle) = &self.current_handle {
            let _ = handle.set_volume(value as f32 / 100.0);
        }
        Ok(value)
    }

    async fn seek(&mut self, position_ms: i64) -> Result<(), PlayerError> {
        let Some(track) = self.current.clone() else {
            return Err(PlayerError::NothingPlaying);
        };
        let max = if track.length > 0 {
            (track.length - 1_000).max(0)
        } else {
            i64::MAX
        };
        let target = position_ms.clamp(0, max);
        self.start(track, target).await
    }

    fn remove(&mut self, index: i64) -> Result<String, PlayerError> {
        if index < 1 {
            return Err(PlayerError::Invalid("Invalid queue index.".into()));
        }
        let position = (index - 1) as usize;
        if position >= self.queue.len() {
            return Err(PlayerError::Invalid("Invalid queue index.".into()));
        }
        self.queue
            .remove(position)
            .map(|track| track.title)
            .ok_or_else(|| PlayerError::Invalid("Invalid queue index.".into()))
    }

    fn move_track(&mut self, from: i64, to: i64) -> Result<(), PlayerError> {
        let len = self.queue.len();
        let from = (from.max(1) as usize) - 1;
        let to = (to.max(1) as usize) - 1;
        if from >= len || to >= len {
            return Err(PlayerError::Invalid("Invalid queue index.".into()));
        }
        if from == to {
            return Ok(());
        }
        let track = self.queue.remove(from).expect("index checked");
        self.queue.insert(to.min(self.queue.len()), track);
        Ok(())
    }

    async fn jump(&mut self, index: i64) -> Result<(), PlayerError> {
        if index < 1 {
            return Err(PlayerError::Invalid("Invalid queue index.".into()));
        }
        let position = (index - 1) as usize;
        if position >= self.queue.len() {
            return Err(PlayerError::Invalid("Invalid queue index.".into()));
        }
        if let Some(handle) = &self.current_handle {
            self.ignore_next_end = true;
            let _ = handle.stop();
        }
        let track = self.queue.remove(position).expect("index checked");
        self.current = None;
        self.start(track, 0).await?;
        self.persist().await;
        Ok(())
    }

    async fn persist(&self) {
        if let Ok(guild) = self.guild().await {
            let upcoming: Vec<Track> = self.queue.iter().cloned().collect();
            self.store.save_queue(&guild, &upcoming).await;
        }
    }

    /// Play a prepared local file without touching the queue or the now-playing
    /// state. TTS uses this so speech never rewrites the music session.
    async fn play_file(&mut self, path: String) -> Result<(), PlayerError> {
        let Some(call) = self.call.clone() else {
            return Err(PlayerError::NoVoice);
        };
        let input: songbird::input::Input = songbird::input::File::new(path).into();
        let mut locked = call.lock().await;
        // Replace the previous clip rather than mixing two utterances.
        let handle = locked.play_only_input(input);
        handle.set_volume(self.volume as f32 / 100.0).ok();
        Ok(())
    }

    /// Take the channel for TTS: stop music, keep the queue for later, and
    /// suspend the idle-leave timer.
    async fn lock_tts(&mut self) -> Result<(), PlayerError> {
        self.tts_active = true;
        self.idle_token = self.idle_token.wrapping_add(1);
        if self.current.is_some() {
            self.persist().await;
        }
        if let Some(handle) = &self.current_handle {
            self.ignore_next_end = true;
            let _ = handle.stop();
        }
        self.current = None;
        self.current_handle = None;
        self.started_at = None;
        self.position_base_ms = 0;
        Ok(())
    }

    async fn unlock_tts(&mut self) -> Result<(), PlayerError> {
        self.tts_active = false;
        Ok(())
    }

    /// Disconnect after a grace period with nothing playing. Bumped tokens
    /// make stale timers harmless when playback or TTS starts in between.
    fn schedule_idle_leave(&mut self) {
        if self.tts_active {
            return;
        }
        self.idle_token = self.idle_token.wrapping_add(1);
        let token = self.idle_token;
        let events = self.events.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(IDLE_LEAVE_GRACE_MS)).await;
            let _ = events.send(Command::IdleLeave { token }).await;
        });
    }

    async fn idle_leave(&mut self, token: u64) {
        if token != self.idle_token || self.current.is_some() || self.tts_active {
            return;
        }
        if let Err(error) = self.disconnect().await {
            tracing::debug!(%error, "idle leave failed");
        }
    }
}

fn shuffle(queue: &mut VecDeque<Track>) {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let len = queue.len();
    if len < 2 {
        return;
    }
    let mut items: Vec<Track> = queue.drain(..).collect();
    for i in (1..len).rev() {
        let mut hasher = DefaultHasher::new();
        std::time::SystemTime::now().hash(&mut hasher);
        i.hash(&mut hasher);
        let j = (hasher.finish() as usize) % (i + 1);
        items.swap(i, j);
    }
    queue.extend(items);
}
