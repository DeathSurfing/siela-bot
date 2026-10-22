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
import { ChannelType, type Guild, type VoiceChannel } from "discord.js";
import type { Logger } from "../lib/logger.js";
import type { MusicService } from "./music.js";

type Prayer = "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";

interface Phase {
  key: string;
  channelName: string;
  audioName: string;
  offsetMs: number;
}

const CATEGORY_NAME = "Scheduled Events";
const AUDIO_EXTENSIONS = [".ogg", ".mp3", ".wav", ".m4a", ".flac"];
const PHASES: Phase[] = [
  { key: "azan", channelName: "masjid", audioName: "azan", offsetMs: 0 },
  { key: "anthem", channelName: "parliament", audioName: "anthem", offsetMs: 60 * 60 * 1000 },
  { key: "chalisa", channelName: "mandir", audioName: "hanuman-chalisa", offsetMs: 2 * 60 * 60 * 1000 },
];
const TICK_MS = 15_000;
const RUN_WINDOW_MS = 60_000;

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

export class ScheduledEventService {
  private guild: Guild | null = null;
  private timer: NodeJS.Timeout | null = null;
  private prayerDate: string | null = null;
  private prayerStart: Date | null = null;
  private readonly ran = new Set<string>();
  private activeConnection: VoiceConnection | null = null;
  private activePlayer: AudioPlayer | null = null;

  constructor(
    private readonly music: MusicService | null,
    private readonly logger: Logger,
    private readonly enabled: boolean,
    private readonly prayer: Prayer,
    private readonly isVoiceBusy?: (guildId: string) => boolean,
  ) {}

  start(guild: Guild): void {
    if (!this.enabled) {
      this.logger.info("scheduled voice events are disabled");
      return;
    }
    this.guild = guild;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.logger.warn({ err: error }, "scheduled event tick failed"));
    }, TICK_MS);
    this.timer.unref?.();
    void this.tick().catch((error) => this.logger.warn({ err: error }, "scheduled event startup tick failed"));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopPlayback();
    this.guild = null;
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
    const guild = this.guild;
    if (!guild) return;
    const today = delhiDate();
    if (this.prayerDate !== today || !this.prayerStart) {
      try {
        this.prayerStart = await this.fetchPrayerStart(today);
        this.prayerDate = today;
        this.ran.clear();
        this.logger.info(
          { date: today, prayer: this.prayer, at: this.prayerStart.toISOString() },
          "scheduled prayer time loaded",
        );
      } catch (error) {
        this.logger.warn({ err: error, date: today }, "could not load Delhi prayer time");
        return;
      }
    }

    const now = Date.now();
    for (const phase of PHASES) {
      const target = this.prayerStart.getTime() + phase.offsetMs;
      if (now < target || now > target + RUN_WINDOW_MS) continue;
      const runKey = `${today}:${phase.key}`;
      if (this.ran.has(runKey)) continue;
      this.ran.add(runKey);
      void this.runPhase(guild, phase).catch((error) => this.logger.warn({ err: error, phase: phase.key }, "scheduled phase failed"));
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
        candidate.type === ChannelType.GuildVoice && candidate.parentId === category!.id,
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
    this.activeConnection = connection;
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.activePlayer = player;
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

  async test(kind: string, guild: Guild): Promise<{ phase: string; channel: string; audio: string }> {
    if (this.isVoiceBusy?.(guild.id) || this.music?.isVoiceLocked(guild.id)) {
      throw new Error("Tambola is using the voice channel. End it before testing event audio.");
    }
    const normalized = kind.toLowerCase().replace(/[^a-z]/g, "");
    const phase = PHASES.find((candidate) => {
      if (candidate.key === "chalisa") return normalized === "hanumanchalisa" || normalized === "chalisa";
      return candidate.key === normalized;
    });
    if (!phase) throw new Error("Use `azan`, `anthem`, or `hanumanchalisa`.");
    const audio = findAudio(phase.audioName);
    if (!audio) {
      throw new Error(`Missing audio file: assets/events/${phase.audioName}.ogg|mp3|wav|m4a|flac`);
    }
    this.logger.info({ guildId: guild.id, phase: phase.key }, "scheduled event test starting");
    await this.runPhase(guild, phase);
    return { phase: phase.key, channel: phase.channelName, audio };
  }

  private async runPhase(guild: Guild, phase: Phase): Promise<void> {
    if (this.isVoiceBusy?.(guild.id) || this.music?.isVoiceLocked(guild.id)) {
      this.logger.info({ guildId: guild.id, phase: phase.key }, "scheduled event skipped because Tambola is using voice");
      return;
    }
    const path = findAudio(phase.audioName);
    if (!path) {
      throw new Error(`Missing audio file: assets/events/${phase.audioName}.ogg|mp3|wav|m4a|flac`);
    }

    try {
      this.stopPlayback();
      await this.music?.stop(guild.id).catch(() => undefined);
      await this.music?.disconnect(guild.id).catch(() => undefined);
      const channel = await this.ensureEventChannel(guild, phase.channelName);
      await this.moveEveryone(guild, channel);
      await this.playAudio(guild, channel, path);
      this.logger.info({ phase: phase.key, channelId: channel.id }, "scheduled voice event completed");
    } finally {
      this.stopPlayback();
    }
  }

  private stopPlayback(): void {
    this.activePlayer?.stop(true);
    this.activeConnection?.destroy();
    this.activePlayer = null;
    this.activeConnection = null;
  }
}
