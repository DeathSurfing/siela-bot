import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { ChannelType, type Guild, type VoiceChannel } from "discord.js";
import {
  scheduledVoiceEventRuns,
  scheduledVoiceEvents,
  type Database,
  type ScheduledVoiceEventRow,
} from "@siela/db";
import { NotFoundError, ServiceUnavailableError, UserError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { MusicService } from "./music.js";

type Prayer = "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";

interface Phase {
  key: string;
  channelName: string;
  audioName?: string;
  youtubeUrl?: string;
  offsetMs: number;
}

const CATEGORY_NAME = "Scheduled Events";
const AUDIO_EXTENSIONS = [".ogg", ".mp3", ".wav", ".m4a", ".flac"];
const PHASES: Phase[] = [
  { key: "azan", channelName: "masjid", audioName: "azan", offsetMs: 0 },
  { key: "anthem", channelName: "parliament", audioName: "anthem", offsetMs: 60 * 60 * 1000 },
  { key: "chalisa", channelName: "mandir", audioName: "hanuman-chalisa", offsetMs: 2 * 60 * 60 * 1000 },
  {
    key: "church",
    channelName: "church",
    youtubeUrl: "https://www.youtube.com/watch?v=nCxqjEz5hJ4",
    offsetMs: 3 * 60 * 60 * 1000,
  },
  {
    key: "monastery",
    channelName: "monastery",
    youtubeUrl: "https://www.youtube.com/watch?v=O3tqJfgYWOs",
    offsetMs: 4 * 60 * 60 * 1000,
  },
  {
    key: "gurudwara",
    channelName: "gurudwara",
    youtubeUrl: "https://www.youtube.com/watch?v=QJwu2BMnf2I",
    offsetMs: 5 * 60 * 60 * 1000,
  },
];
const TICK_MS = 15_000;
const RUN_WINDOW_MS = 60_000;
const MAX_SCHEDULED_EVENTS_PER_TICK = 5;
export type ScheduledEventRepeat = "none" | "daily" | "weekly";
export type ScheduledEventStatus = "running" | "success" | "failed" | "skipped";

export interface ScheduledEventInput {
  name: string;
  channelId: string;
  sourceUrl: string;
  startAt: Date;
  repeat: ScheduledEventRepeat;
  enabled: boolean;
}

export interface ScheduledEventView {
  id: number;
  name: string;
  channelId: string;
  sourceUrl: string;
  repeat: ScheduledEventRepeat;
  enabled: boolean;
  startAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: ScheduledEventStatus | null;
  lastError: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledEventRunView {
  id: number;
  eventName: string;
  status: ScheduledEventStatus;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function normalizeYouTubeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid YouTube video URL.");
  }

  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.port || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Only YouTube video URLs are supported.");
  }

  const host = url.hostname.toLowerCase();
  let videoId: string | null = null;
  if (host === "youtu.be") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 1) videoId = parts[0] ?? null;
  } else if (url.pathname === "/watch") {
    const ids = url.searchParams.getAll("v");
    if (ids.length === 1) videoId = ids[0] ?? null;
  } else {
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)$/);
    videoId = match?.[1] ?? null;
  }

  if (!videoId || !VIDEO_ID.test(videoId)) throw new Error("Enter a YouTube video URL with a valid video ID.");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function nextScheduledRun(from: Date, repeat: ScheduledEventRepeat, now: Date): Date | null {
  if (repeat === "none") return null;
  const intervalMs = repeat === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const elapsed = now.getTime() - from.getTime();
  const intervals = Math.max(0, Math.floor(elapsed / intervalMs) + 1);
  return new Date(from.getTime() + intervals * intervalMs);
}

function scheduledStart(startAt: Date, repeat: ScheduledEventRepeat, now: Date): Date | null {
  return repeat === "none" ? startAt : nextScheduledRun(startAt, repeat, now);
}

function eventSource(raw: string): string {
  try {
    return normalizeYouTubeUrl(raw);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error), "invalid_source_url");
  }
}

function scheduledRepeat(value: string): ScheduledEventRepeat {
  if (value === "none" || value === "daily" || value === "weekly") return value;
  throw new Error(`Unknown scheduled event repeat: ${value}`);
}

function scheduledStatus(value: string): ScheduledEventStatus {
  if (value === "running" || value === "success" || value === "failed" || value === "skipped") return value;
  throw new Error(`Unknown scheduled event status: ${value}`);
}

function eventView(row: ScheduledVoiceEventRow): ScheduledEventView {
  return {
    id: row.id,
    name: row.name,
    channelId: row.channelId,
    sourceUrl: row.sourceUrl,
    repeat: scheduledRepeat(row.repeat),
    enabled: row.enabled,
    startAt: row.startAt.toISOString(),
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastStatus: row.lastStatus === null ? null : scheduledStatus(row.lastStatus),
    lastError: row.lastError,
    runCount: row.runCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function delhiDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function findAudio(name: string): string | null {
  for (const extension of AUDIO_EXTENSIONS) {
    for (const directory of [
      join(process.cwd(), "assets", "events"),
      join(process.cwd(), "apps", "bot", "assets", "events"),
    ]) {
      const path = join(directory, `${name}${extension}`);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

interface GuildState {
  prayerDate: string | null;
  prayerStart: Date | null;
  ran: Set<string>;
}

interface Playback {
  connection: VoiceConnection | null;
  player: AudioPlayer | null;
  ytdlp: ChildProcess | null;
  ffmpeg: ChildProcess | null;
}

export class ScheduledEventService {
  private readonly guilds = new Map<string, Guild>();
  private readonly states = new Map<string, GuildState>();
  private readonly playbacks = new Map<string, Playback>();
  private readonly runningGuilds = new Set<string>();
  private readonly tickingGuilds = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly music: MusicService | null,
    private readonly logger: Logger,
    private readonly enabled: boolean,
    private readonly prayer: Prayer,
    private readonly isVoiceBusy?: (guildId: string) => boolean,
    private readonly ytdlpPath = "yt-dlp",
    private readonly ffmpegPath = "ffmpeg",
    private readonly routerUrl: string | null = null,
    private readonly routerToken: string | null = null,
    private readonly isEnabled?: (guildId: string) => Promise<boolean>,
    private readonly db: Database | null = null,
  ) {}

  get schedulerEnabled(): boolean {
    return this.enabled;
  }

  builtInPhases(): Array<{ key: string; channelName: string; source: string; youtube: boolean; offsetMs: number }> {
    return PHASES.map((phase) => ({
      key: phase.key,
      channelName: phase.channelName,
      source: phase.audioName ?? phase.youtubeUrl ?? "",
      youtube: Boolean(phase.youtubeUrl),
      offsetMs: phase.offsetMs,
    }));
  }

  private database(): Database {
    if (!this.db) throw new ServiceUnavailableError("Scheduled event storage is not ready.");
    return this.db;
  }

  private async eventFor(guildId: string, id: number): Promise<ScheduledVoiceEventRow> {
    const [event] = await this.database()
      .select()
      .from(scheduledVoiceEvents)
      .where(and(eq(scheduledVoiceEvents.guildId, guildId), eq(scheduledVoiceEvents.id, id)))
      .limit(1);
    if (!event) throw new NotFoundError("Scheduled event was not found.");
    return event;
  }

  async list(guildId: string): Promise<ScheduledEventView[]> {
    const events = await this.database()
      .select()
      .from(scheduledVoiceEvents)
      .where(eq(scheduledVoiceEvents.guildId, guildId))
      .orderBy(asc(scheduledVoiceEvents.nextRunAt), desc(scheduledVoiceEvents.createdAt));
    return events.map(eventView);
  }

  async listRuns(guildId: string, limit = 10): Promise<ScheduledEventRunView[]> {
    const runs = await this.database()
      .select({
        id: scheduledVoiceEventRuns.id,
        eventName: scheduledVoiceEvents.name,
        status: scheduledVoiceEventRuns.status,
        triggeredBy: scheduledVoiceEventRuns.triggeredBy,
        startedAt: scheduledVoiceEventRuns.startedAt,
        finishedAt: scheduledVoiceEventRuns.finishedAt,
        error: scheduledVoiceEventRuns.error,
      })
      .from(scheduledVoiceEventRuns)
      .innerJoin(scheduledVoiceEvents, eq(scheduledVoiceEventRuns.eventId, scheduledVoiceEvents.id))
      .where(eq(scheduledVoiceEventRuns.guildId, guildId))
      .orderBy(desc(scheduledVoiceEventRuns.startedAt))
      .limit(limit);
    return runs.map((run) => ({
      ...run,
      status: scheduledStatus(run.status),
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    }));
  }

  async create(guildId: string, input: ScheduledEventInput, actorId: string): Promise<ScheduledEventView> {
    const now = new Date();
    this.validateStartAt(input.startAt, now);
    const [event] = await this.database()
      .insert(scheduledVoiceEvents)
      .values({
        guildId,
        name: input.name.trim(),
        channelId: input.channelId,
        sourceUrl: eventSource(input.sourceUrl),
        repeat: input.repeat,
        enabled: input.enabled,
        startAt: input.startAt,
        nextRunAt: scheduledStart(input.startAt, input.repeat, now),
        createdBy: actorId,
      })
      .returning();
    if (!event) throw new Error("Scheduled event could not be created.");
    return eventView(event);
  }

  async update(
    guildId: string,
    id: number,
    input: Partial<ScheduledEventInput>,
    _actorId: string,
  ): Promise<ScheduledEventView> {
    const current = await this.eventFor(guildId, id);
    const now = new Date();
    if (input.startAt !== undefined) this.validateStartAt(input.startAt, now);
    const repeat = input.repeat ?? scheduledRepeat(current.repeat);
    const startAt = input.startAt ?? current.startAt;
    const scheduleChanged = input.startAt !== undefined || input.repeat !== undefined ||
      (input.enabled === true && !current.enabled);
    const nextRunAt = scheduleChanged
      ? scheduledStart(startAt, repeat, now)
      : current.nextRunAt;
    const [event] = await this.database()
      .update(scheduledVoiceEvents)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
        ...(input.sourceUrl !== undefined ? { sourceUrl: eventSource(input.sourceUrl) } : {}),
        ...(input.repeat !== undefined ? { repeat: input.repeat } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
        ...(scheduleChanged ? { nextRunAt } : {}),
        updatedAt: now,
      })
      .where(and(eq(scheduledVoiceEvents.guildId, guildId), eq(scheduledVoiceEvents.id, id)))
      .returning();
    if (!event) throw new NotFoundError("Scheduled event was not found.");
    return eventView(event);
  }

  async remove(guildId: string, id: number): Promise<ScheduledEventView> {
    const event = await this.eventFor(guildId, id);
    await this.database()
      .delete(scheduledVoiceEvents)
      .where(and(eq(scheduledVoiceEvents.guildId, guildId), eq(scheduledVoiceEvents.id, id)));
    return eventView(event);
  }

  async runNow(guildId: string, id: number, triggeredBy: string): Promise<ScheduledEventRunView> {
    if (this.runningGuilds.has(guildId) || this.isVoiceBusy?.(guildId)) {
      throw new UserError("A voice event is already running in this server.", "voice_busy");
    }
    const guild = this.guilds.get(guildId);
    if (!guild) throw new ServiceUnavailableError("The bot is not connected to this server.");
    this.runningGuilds.add(guildId);
    try {
      if (this.isEnabled && !(await this.isEnabled(guildId))) {
        throw new UserError("Scheduled events are turned off on this server.", "feature_disabled");
      }
      const event = await this.eventFor(guildId, id);
      return await this.recordAndExecute(guild, event, triggeredBy);
    } finally {
      this.runningGuilds.delete(guildId);
    }
  }

  private validateStartAt(startAt: Date, now: Date): void {
    if (Number.isNaN(startAt.getTime()) || startAt.getTime() < now.getTime() - 60_000) {
      throw new UserError("Start time must be in the future or within the last minute.", "invalid_start_at");
    }
  }

  private async recordAndExecute(
    guild: Guild,
    event: ScheduledVoiceEventRow,
    triggeredBy: string,
    skippedReason?: string,
  ): Promise<ScheduledEventRunView> {
    const db = this.database();
    const startedAt = new Date();
    const [run] = await db
      .insert(scheduledVoiceEventRuns)
      .values({ eventId: event.id, guildId: event.guildId, startedAt, status: "running", triggeredBy })
      .returning();
    if (!run) throw new Error("Scheduled event run could not be recorded.");

    await db
      .update(scheduledVoiceEvents)
      .set({ lastRunAt: startedAt, lastStatus: "running", lastError: null, updatedAt: startedAt })
      .where(and(eq(scheduledVoiceEvents.guildId, event.guildId), eq(scheduledVoiceEvents.id, event.id)));

    let status: Exclude<ScheduledEventStatus, "running"> = skippedReason ? "skipped" : "success";
    let error = skippedReason ?? null;
    if (!skippedReason) {
      try {
        await this.execute(guild, event);
      } catch (failure) {
        status = "failed";
        error = (failure instanceof Error ? failure.message : String(failure)).slice(0, 500);
      } finally {
        this.stopPlayback(guild.id);
      }
    }

    const finishedAt = new Date();
    const nextRunAt = event.repeat === "none"
      ? null
      : nextScheduledRun(event.nextRunAt ?? event.startAt, scheduledRepeat(event.repeat), finishedAt);
    const update = {
      status,
      finishedAt,
      error,
    };
    await db.update(scheduledVoiceEventRuns).set(update).where(eq(scheduledVoiceEventRuns.id, run.id));
    await db
      .update(scheduledVoiceEvents)
      .set({
        enabled: event.repeat === "none" ? false : event.enabled,
        lastRunAt: startedAt,
        lastStatus: status,
        lastError: error,
        runCount: sql`${scheduledVoiceEvents.runCount} + 1`,
        nextRunAt,
        updatedAt: finishedAt,
      })
      .where(and(eq(scheduledVoiceEvents.guildId, event.guildId), eq(scheduledVoiceEvents.id, event.id)));

    return {
      id: run.id,
      eventName: event.name,
      status,
      triggeredBy,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      error,
    };
  }

  protected async execute(guild: Guild, event: ScheduledVoiceEventRow): Promise<void> {
    this.stopPlayback(guild.id);
    await this.music?.stop(guild.id).catch(() => undefined);
    await this.music?.disconnect(guild.id).catch(() => undefined);
    if (await this.preemptSession(guild.id, event.name)) this.music?.clearFleetNodes(guild.id);
    const channel = await guild.channels.fetch(event.channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error("The selected channel is not a voice channel in this server.");
    }
    await this.playYouTubeAudio(guild, channel, normalizeYouTubeUrl(event.sourceUrl));
  }

  private stateFor(guildId: string): GuildState {
    let state = this.states.get(guildId);
    if (!state) {
      state = { prayerDate: null, prayerStart: null, ran: new Set() };
      this.states.set(guildId, state);
    }
    return state;
  }

  private playbackFor(guildId: string): Playback {
    let playback = this.playbacks.get(guildId);
    if (!playback) {
      playback = { connection: null, player: null, ytdlp: null, ffmpeg: null };
      this.playbacks.set(guildId, playback);
    }
    return playback;
  }

  /**
   * Session preempt: one guild is one session. Before event audio plays,
   * tell the router to clear every node's queue and disconnect voice so
   * worker playback never overlaps the event. Best-effort: event audio
   * still plays if the router is unreachable.
   */
  private async preemptSession(guildId: string, phase: string): Promise<boolean> {
    if (!this.routerUrl || !this.routerToken) return false;
    try {
      const response = await fetch(`${this.routerUrl.replace(/\/+$/, "")}/v1/session/preempt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.routerToken}`,
        },
        body: JSON.stringify({ guildId }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`router preempt returned ${response.status}`);
      this.logger.info({ guildId, phase }, "voice session preempted for scheduled event");
      return true;
    } catch (error) {
      this.logger.warn({ err: error, guildId, phase }, "session preempt failed; playing event audio anyway");
      return false;
    }
  }

  start(guild: Guild): void {
    this.guilds.set(guild.id, guild);
    if (!this.enabled) {
      this.logger.info("scheduled voice events are disabled");
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.logger.warn({ err: error }, "scheduled event tick failed"));
    }, TICK_MS);
    this.timer.unref?.();
    void this.tick().catch((error) => this.logger.warn({ err: error }, "scheduled event startup tick failed"));
  }

  stop(guildId?: string): void {
    if (guildId) {
      this.guilds.delete(guildId);
      this.states.delete(guildId);
      this.stopPlayback(guildId);
      if (this.guilds.size > 0) return;
    }
    this.guilds.clear();
    this.states.clear();
    for (const id of [...this.playbacks.keys()]) this.stopPlayback(id);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async fetchPrayerStart(date: string): Promise<Date> {
    const [year, month, day] = date.split("-");
    const url = `https://api.aladhan.com/v1/timingsByCity?city=Delhi&country=India&method=1&date=${day}-${month}-${year}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Aladhan returned ${response.status}`);
    const json = (await response.json()) as { data?: { timings?: Record<string, string> } };
    const raw = json.data?.timings?.[this.prayer];
    const time = raw?.match(/\d{1,2}:\d{2}/)?.[0];
    if (!time) throw new Error(`No ${this.prayer} time in Aladhan response`);
    const start = new Date(`${date}T${time}:00+05:30`);
    if (Number.isNaN(start.getTime())) throw new Error("Invalid prayer timestamp");
    return start;
  }

  private async tick(): Promise<void> {
    for (const guild of this.guilds.values()) {
      try {
        await this.tickGuild(guild);
      } catch (error) {
        this.logger.warn({ err: error, guildId: guild.id }, "scheduled event tick failed");
      }
    }
  }

  protected async tickGuild(guild: Guild): Promise<void> {
    if (this.tickingGuilds.has(guild.id)) return;
    this.tickingGuilds.add(guild.id);
    try {
      await this.tickGuildOnce(guild);
    } finally {
      this.tickingGuilds.delete(guild.id);
    }
  }

  private async tickGuildOnce(guild: Guild): Promise<void> {
    if (this.isEnabled && !(await this.isEnabled(guild.id))) return;
    const state = this.stateFor(guild.id);
    const today = delhiDate();
    if (state.prayerDate !== today || !state.prayerStart) {
      try {
        state.prayerStart = await this.fetchPrayerStart(today);
        state.prayerDate = today;
        state.ran.clear();
        this.logger.info(
          { guildId: guild.id, date: today, prayer: this.prayer, at: state.prayerStart.toISOString() },
          "scheduled prayer time loaded",
        );
      } catch (error) {
        this.logger.warn({ err: error, guildId: guild.id, date: today }, "could not load Delhi prayer time");
        state.prayerStart = null;
      }
    }

    const now = Date.now();
    if (state.prayerStart) {
      for (const phase of PHASES) {
        const target = state.prayerStart.getTime() + phase.offsetMs;
        if (now < target || now > target + RUN_WINDOW_MS) continue;
        const runKey = `${today}:${phase.key}`;
        if (state.ran.has(runKey)) continue;
        state.ran.add(runKey);
        void this.runPhase(guild, phase).catch((error) => this.logger.warn({ err: error, guildId: guild.id, phase: phase.key }, "scheduled phase failed"));
      }
    }

    await this.tickScheduledEvents(guild, new Date(now));
  }

  private async tickScheduledEvents(guild: Guild, now: Date): Promise<void> {
    if (!this.db) return;
    const events = await this.database()
      .select()
      .from(scheduledVoiceEvents)
      .where(and(
        eq(scheduledVoiceEvents.guildId, guild.id),
        eq(scheduledVoiceEvents.enabled, true),
        lte(scheduledVoiceEvents.nextRunAt, now),
      ))
      .orderBy(asc(scheduledVoiceEvents.nextRunAt))
      .limit(MAX_SCHEDULED_EVENTS_PER_TICK);

    for (const event of events) {
      if (this.runningGuilds.has(guild.id) || this.isVoiceBusy?.(guild.id)) {
        await this.recordAndExecute(guild, event, "scheduler", "Skipped because another voice session is active.");
        continue;
      }
      this.runningGuilds.add(guild.id);
      void this.recordAndExecute(guild, event, "scheduler")
        .catch((error) => this.logger.warn({ err: error, guildId: guild.id, eventId: event.id }, "scheduled event run failed"))
        .finally(() => {
          this.runningGuilds.delete(guild.id);
        });
      break;
    }
  }

  private async ensureEventChannel(guild: Guild, name: string): Promise<VoiceChannel> {
    let category = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME,
    );
    if (!category || category.type !== ChannelType.GuildCategory) {
      category = await guild.channels.create({
        name: CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        reason: "Scheduled voice events",
      });
    }

    let channel = guild.channels.cache.find(
      (candidate): candidate is VoiceChannel =>
        candidate.type === ChannelType.GuildVoice &&
        candidate.parentId === category!.id &&
        candidate.name === name,
    );
    if (!channel) {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: category.id,
        reason: "Scheduled voice event",
      });
    }
    if (channel.name !== name) await channel.setName(name, "Scheduled voice event");
    if (channel.userLimit !== 0) await channel.setUserLimit(0, "Scheduled voice event").catch(() => undefined);
    return channel;
  }

  private async moveEveryone(guild: Guild, channel: VoiceChannel): Promise<void> {
    const states = [...guild.voiceStates.cache.values()].filter((state) => {
      if (!state.channelId || state.channelId === channel.id) return false;
      if (guild.afkChannelId && state.channelId === guild.afkChannelId) return false;
      return Boolean(state.member && !state.member.user.bot);
    });
    if (!states.length) {
      this.logger.info({ guildId: guild.id, channelId: channel.id }, "scheduled event has no members to move");
      return;
    }
    const results = await Promise.allSettled(
      states.map((state) => state.member!.voice.setChannel(channel, "Scheduled voice event")),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    this.logger.info(
      { guildId: guild.id, channelId: channel.id, moved: states.length - failed, failed },
      "scheduled event moved members",
    );
  }

  private async playAudio(guild: Guild, channel: VoiceChannel, path: string): Promise<void> {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    const playback = this.playbackFor(guild.id);
    playback.connection = connection;
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    playback.player = player;
    connection.subscribe(player);
    const resource = createAudioResource(createReadStream(path), {
      inputType: path.endsWith(".ogg") ? StreamType.OggOpus : StreamType.Arbitrary,
      inlineVolume: true,
    });
    resource.volume?.setVolume(0.9);

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 20 * 60 * 1000);
      timer.unref?.();
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      player.once(AudioPlayerStatus.Idle, done);
      player.once("error", done);
      player.play(resource);
    });
  }

  private async playYouTubeAudio(guild: Guild, channel: VoiceChannel, url: string): Promise<void> {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    const playback = this.playbackFor(guild.id);
    playback.connection = connection;
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    playback.player = player;
    connection.subscribe(player);

    const ytdlp = spawn(
      this.ytdlpPath,
      [
        "--js-runtimes",
        "node",
        "--no-part",
        "--no-cache-dir",
        "-f",
        "bestaudio[abr<=312]/bestaudio/best[abr<=312]/best",
        "-o",
        "-",
        "--no-playlist",
        "--no-warnings",
        "--quiet",
        url,
      ],
      { cwd: "/tmp", stdio: ["ignore", "pipe", "pipe"] },
    );
    playback.ytdlp = ytdlp;

    const ffmpeg = spawn(
      this.ffmpegPath,
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
      { cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] },
    );
    playback.ffmpeg = ffmpeg;

    ytdlp.stdout?.on("error", () => undefined);
    ytdlp.stderr?.on("data", () => undefined);
    ytdlp.on("error", (error) => {
      this.logger.warn({ err: error, url }, "scheduled event yt-dlp spawn failed");
    });
    ffmpeg.stdin?.on("error", () => undefined);
    ffmpeg.stdout?.on("error", () => undefined);
    ffmpeg.stderr?.on("data", () => undefined);
    ffmpeg.on("error", (error) => {
      this.logger.warn({ err: error, url }, "scheduled event ffmpeg spawn failed");
    });
    ytdlp.stdout?.pipe(ffmpeg.stdin!);

    const resource = createAudioResource(ffmpeg.stdout!, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(0.9);

    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout;
      const cleanup = (): void => {
        clearTimeout(timer);
        player.off(AudioPlayerStatus.Idle, done);
        player.off("error", fail);
        ytdlp.off("error", fail);
        ffmpeg.off("error", fail);
        ytdlp.off("close", ytdlpClosed);
        ffmpeg.off("close", ffmpegClosed);
      };
      const done = (): void => {
        cleanup();
        resolve();
      };
      const fail = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const ytdlpClosed = (code: number | null): void => {
        if (code !== 0) fail(new Error(`yt-dlp exited with code ${code ?? "unknown"}.`));
      };
      const ffmpegClosed = (code: number | null): void => {
        if (code !== 0) fail(new Error(`ffmpeg exited with code ${code ?? "unknown"}.`));
      };
      timer = setTimeout(() => fail(new Error("YouTube playback timed out.")), 20 * 60 * 1000);
      timer.unref?.();
      player.once(AudioPlayerStatus.Idle, done);
      player.once("error", fail);
      ytdlp.once("error", fail);
      ffmpeg.once("error", fail);
      ytdlp.once("close", ytdlpClosed);
      ffmpeg.once("close", ffmpegClosed);
      player.play(resource);
    });
  }

  async test(kind: string, guild: Guild): Promise<{ phase: string; channel: string; audio: string }> {
    if (this.isVoiceBusy?.(guild.id) || this.music?.isVoiceLocked(guild.id)) {
      throw new Error("Tambola is using the voice channel. End it before testing event audio.");
    }
    const normalized = kind.toLowerCase().replace(/[^a-z]/g, "");
    const phase = PHASES.find((candidate) => {
      if (candidate.key === "chalisa") return normalized === "hanumanchalisa" || normalized === "chalisa";
      if (candidate.key === "monastery") return normalized === "monastery" || normalized === "monestary";
      return candidate.key === normalized;
    });
    if (!phase) throw new Error("Use `azan`, `anthem`, `hanumanchalisa`, `church`, `monastery`, or `gurudwara`.");
    let audio: string;
    if (phase.youtubeUrl) {
      audio = phase.youtubeUrl;
    } else if (phase.audioName) {
      const found = findAudio(phase.audioName);
      if (!found) {
        throw new Error(`Missing audio file: assets/events/${phase.audioName}.ogg|mp3|wav|m4a|flac`);
      }
      audio = found;
    } else {
      throw new Error(`Phase ${phase.key} has no audio source.`);
    }
    this.logger.info({ guildId: guild.id, phase: phase.key }, "scheduled event test starting");
    await this.runPhase(guild, phase);
    return { phase: phase.key, channel: phase.channelName, audio };
  }

  private async runPhase(guild: Guild, phase: Phase): Promise<void> {
    if (this.runningGuilds.has(guild.id) || this.isVoiceBusy?.(guild.id) || this.music?.isVoiceLocked(guild.id)) {
      this.logger.info({ guildId: guild.id, phase: phase.key }, "scheduled event skipped because voice is busy");
      return;
    }
    this.runningGuilds.add(guild.id);

    try {
      this.stopPlayback(guild.id);
      await this.music?.stop(guild.id).catch(() => undefined);
      await this.music?.disconnect(guild.id).catch(() => undefined);
      if (await this.preemptSession(guild.id, phase.key)) {
        this.music?.clearFleetNodes(guild.id);
      }
      const channel = await this.ensureEventChannel(guild, phase.channelName);
      await this.moveEveryone(guild, channel);
      if (phase.youtubeUrl) {
        await this.playYouTubeAudio(guild, channel, phase.youtubeUrl);
      } else if (phase.audioName) {
        const path = findAudio(phase.audioName);
        if (!path) {
          throw new Error(`Missing audio file: assets/events/${phase.audioName}.ogg|mp3|wav|m4a|flac`);
        }
        await this.playAudio(guild, channel, path);
      } else {
        throw new Error(`Phase ${phase.key} has no audio source.`);
      }
      this.logger.info({ guildId: guild.id, phase: phase.key, channelId: channel.id }, "scheduled voice event completed");
    } finally {
      this.stopPlayback(guild.id);
      this.runningGuilds.delete(guild.id);
    }
  }

  private stopPlayback(guildId: string): void {
    const playback = this.playbacks.get(guildId);
    if (!playback) return;
    playback.player?.stop(true);
    playback.connection?.destroy();
    playback.ytdlp?.kill("SIGKILL");
    playback.ffmpeg?.kill("SIGKILL");
    this.playbacks.delete(guildId);
  }
}
