import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
} from "discord.js";
import type { BotConfig } from "@siela/config";
import { pingDatabase, type DatabaseHandle } from "@siela/db";
import type { Logger } from "./lib/logger.js";
import { SettingsService } from "./features/settings.js";
import { ValkeyService } from "./features/valkey.js";
import { MusicService } from "./features/music.js";
import { TtsService } from "./features/tts.js";
import { FleetHeartbeat } from "./features/fleetHeartbeat.js";
import { WorkerServer } from "./control/worker.js";
import { HealthServer } from "./control/health.js";

/**
 * Slim voice-worker node. Boots only what playback needs: Discord voice,
 * music + TTS services, the internal worker API, health, and the fleet
 * heartbeat. No command registry, schedulers, economy, or social features —
 * roughly half the modules of the full bot stay unloaded.
 */
export class VoiceWorkerNode {
  private readonly client: Client;
  private readonly valkey: ValkeyService;
  private readonly workerServer: WorkerServer;
  private readonly healthServer: HealthServer;
  private readonly heartbeat: FleetHeartbeat | null;
  private readonly music: MusicService;
  private readonly tts: TtsService;
  private guildId: string | null = null;
  private stopping = false;

  constructor(
    private readonly config: BotConfig,
    private readonly dbHandle: DatabaseHandle,
    private readonly logger: Logger,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [],
      allowedMentions: { parse: [], repliedUser: false },
    });
    const settings = new SettingsService(this.dbHandle.db);
    this.valkey = new ValkeyService(this.config.VALKEY_URL ?? null, this.logger);
    this.music = new MusicService(
      this.client,
      {
        backend: this.config.MUSIC_BACKEND,
        ytdlpPath: this.config.YTDLP_PATH,
        mpvPath: this.config.MPV_PATH,
        ffmpegPath: this.config.FFMPEG_PATH,
        settings,
        nodeId: this.config.NODE_ID,
        leaveOnQueueEnd: true,
        stayConnected: (guildId) => this.tts.isEnabled(guildId),
      },
      this.logger,
      this.valkey,
    );
    this.tts = new TtsService(this.music, this.config, this.logger);
    this.heartbeat = this.config.NODE_ADVERTISE_URL
      ? new FleetHeartbeat(
        this.valkey,
        this.logger,
        this.config.NODE_ID,
        this.config.NODE_ADVERTISE_URL,
        "voice",
        () => this.guildId,
      )
      : null;
    this.workerServer = new WorkerServer({
      services: { music: this.music, tts: this.tts },
      client: this.client,
      token: this.config.MCP_TOKEN,
      logger: this.logger,
      getGuildId: () => this.guildId,
    });
    this.healthServer = new HealthServer({
      host: this.config.HEALTH_HOST,
      port: this.config.HEALTH_PORT,
      logger: this.logger,
      isReady: async () => {
        const ready = Boolean(this.client.isReady() && this.guildId);
        const dbUp = await pingDatabase(this.dbHandle.db);
        return { ready: ready && dbUp, details: { gateway: this.client.isReady(), guild: Boolean(this.guildId), database: dbUp } };
      },
    });
  }

  async start(): Promise<void> {
    this.client.once(Events.ClientReady, () => void this.onReady());
    this.client.on(Events.GuildCreate, (guild) => void this.onGuildCreate(guild));
    this.client.on(Events.Error, (error) => this.logger.error({ err: error }, "discord client error"));
    await this.valkey.start();
    this.heartbeat?.start();
    await Promise.all([
      this.workerServer.start(this.config.WORKER_INTERNAL_HOST, this.config.WORKER_INTERNAL_PORT),
      this.healthServer.start(),
    ]);
    await this.client.login(this.config.DISCORD_TOKEN);
    this.logger.info({ user: this.client.user?.tag, nodeId: this.config.NODE_ID }, "voice worker logged in");
  }

  private onReady(): void {
    const guild = this.resolveGuild();
    if (guild) {
      this.guildId = guild.id;
      void this.client.user?.setPresence({
        activities: [{ name: `music • ${this.config.NODE_ID}`, type: ActivityType.Listening }],
        status: "online",
      });
      this.logger.info({ guildId: guild.id, nodeId: this.config.NODE_ID }, "voice worker bound");
    } else {
      this.logger.warn("no guild bound yet; waiting for the first guild join");
    }
  }

  private resolveGuild(): Guild | null {
    if (this.config.guildId) {
      return this.client.guilds.cache.get(this.config.guildId) ?? null;
    }
    if (this.client.guilds.cache.size === 1) {
      return this.client.guilds.cache.first() ?? null;
    }
    return null;
  }

  private async onGuildCreate(guild: Guild): Promise<void> {
    if (this.config.guildId && guild.id !== this.config.guildId) {
      await guild.leave().catch(() => undefined);
      return;
    }
    if (!this.guildId) {
      this.guildId = guild.id;
      this.logger.info({ guildId: guild.id }, "voice worker bound");
    } else if (guild.id !== this.guildId) {
      await guild.leave().catch(() => undefined);
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await this.heartbeat?.stop().catch(() => undefined);
    await Promise.allSettled([this.workerServer.stop(), this.healthServer.stop()]);
    await this.music.shutdown().catch(() => undefined);
    this.tts.stop();
    await this.valkey.stop();
    this.client.destroy();
    await this.dbHandle.close();
  }
}
