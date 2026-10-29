import { styleMessage } from "./features/ui.js";
import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  StringSelectMenuBuilder,
  TextInputBuilder,
  UserSelectMenuBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type ChatInputCommandInteraction,
  type PartialGuildMember,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
  type VoiceState,
} from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";
import { APP_VERSION, DEFAULTS, featureForCommand, getFeature, type BotStatus } from "@siela/shared";
import { pingDatabase, type DatabaseHandle, type TempVoiceChannelRow } from "@siela/db";
import type { BotConfig } from "@siela/config";
import { commands } from "./commands/index.js";
import { DELULU_SETUP_PREFIX, handleDeluluSetup } from "./commands/social/delulu.js";
import { CommandRegistry } from "./framework/registry.js";
import { CooldownManager } from "./framework/cooldowns.js";
import { parsePrefixCommand } from "./framework/prefix.js";
import { argsFromInteraction, rawArgsFromInteraction } from "./framework/slash.js";
import {
  canManageTempVc,
  hasBotPermissions,
  hasUserPermissions,
  isAdmin,
  isNsfwChannel,
} from "./framework/permissions.js";
import { createPrefixContext, createSlashContext } from "./framework/context.js";
import type { Command, CommandContext, Services } from "./framework/types.js";
import { SettingsService } from "./features/settings.js";
import { FeatureFlagService } from "./features/features.js";
import { AuditService } from "./features/audit.js";
import { CounterService } from "./features/counters.js";
import { WelcomeService } from "./features/welcome.js";
import { AutoRoleService } from "./features/autorole.js";
import { ActivityService } from "./features/activity.js";
import { LevelingService } from "./features/leveling.js";
import { BiasService } from "./features/bias.js";
import { FamilyService } from "./features/family.js";
import { DeluluService } from "./features/delulu.js";
import { ConfessionService } from "./features/confession.js";
import { FriendshipService } from "./features/friendship.js";
import { ValkeyService } from "./features/valkey.js";
import { RandomVcService } from "./features/randomVc.js";
import { ScheduledEventService } from "./features/scheduledEvents.js";
import { BirthdayService } from "./features/birthday.js";
import { parseTempVcPanelCustomId, tempVcPanelCustomId, TempVcService } from "./features/tempvc.js";

import { MusicService, type MusicFilterPreset } from "./features/music.js";
import { VoiceSfxService } from "./features/voiceSfx.js";
import { buildMusicPayload } from "./features/music-ui.js";
import { LyricsService } from "./features/lyrics.js";
import { buildLyricsPayload } from "./features/lyrics-ui.js";
import { TambolaService } from "./features/tambola/service.js";
import { CahService } from "./features/cah/service.js";
import { TtsService } from "./features/tts.js";
import { EconomyService } from "./features/economy.js";
import { handleStockButton, handleStockModal } from "./features/stocks-ui.js";
import { EMOJI, attachConfirmation, card, confirmCard } from "./features/ui.js";
import { PrivacyService } from "./features/privacy.js";
import { RelicService } from "./features/relics/service.js";
import {
  buildHelpPayload,
  buildHelpSearchModal,
  HELP_SEARCH_INPUT_ID,
  HELP_SEARCH_MODAL_ID,
} from "./features/help.js";
import { ControlServer } from "./control/server.js";
import { WorkerServer } from "./control/worker.js";
import { FleetClient, type FleetNodePlayback } from "./features/fleetClient.js";
import { FleetHeartbeat } from "./features/fleetHeartbeat.js";
import { HealthServer } from "./control/health.js";
import type { Logger } from "./lib/logger.js";
import { UserError } from "./lib/errors.js";

export class SielaBot {
  readonly client: Client;
  readonly registry: CommandRegistry;
  readonly services: Services;
  private readonly cooldowns = new CooldownManager();
  private readonly unknownCommandNotices = new Map<string, number>();
  private readonly controlServer: ControlServer;
  private readonly healthServer: HealthServer;
  private readonly workerServer: WorkerServer;
  private readonly isVoiceWorker: boolean;
  private readonly nodeId: string;
  private readonly valkey: ValkeyService;
  private readonly fleetHeartbeat: FleetHeartbeat | null;
  private readonly randomVc = new Map<string, RandomVcService>();
  private readonly scheduledEvents: ScheduledEventService;
  private readonly initializedGuilds = new Set<string>();
  private readonly isVoiceBusy: (guildId: string) => boolean;
  private music: MusicService | null = null;
  private globalSchedulersStarted = false;
  private stopping = false;

  constructor(
    private readonly config: BotConfig,
    private readonly dbHandle: DatabaseHandle,
    private readonly logger: Logger,
  ) {
    this.isVoiceWorker = config.NODE_ROLE === "voice";
    this.nodeId = config.NODE_ID;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User],
      allowedMentions: { parse: [], repliedUser: false },
    });
    this.registry = new CommandRegistry().register(...commands);
    const settings = new SettingsService(this.dbHandle.db);
    const features = new FeatureFlagService(this.dbHandle.db);
    const counters = new CounterService(this.dbHandle.db);
    this.valkey = new ValkeyService(this.config.VALKEY_URL ?? null, this.logger);
    this.fleetHeartbeat = this.config.NODE_ADVERTISE_URL
      ? new FleetHeartbeat(
        this.valkey,
        this.logger,
        this.nodeId,
        this.config.NODE_ADVERTISE_URL,
        this.config.NODE_ROLE,
        () => this.servedGuildIds(),
      )
      : null;
    const economy = new EconomyService(this.dbHandle.db, this.valkey, this.logger);
    const audit = new AuditService(this.dbHandle.db, this.logger);
    const relics = new RelicService(this.dbHandle.db, this.client, economy, audit, this.logger);
    relics.setEnabledChecker((guildId) => features.isEnabled(guildId, "relics"));
    const friendship = new FriendshipService(this.dbHandle.db, this.logger, this.valkey);
    const lyrics = new LyricsService(this.logger);
    const confession = new ConfessionService(this.dbHandle.db, settings, this.client, this.logger);
    const tempVc = new TempVcService(this.client, this.dbHandle.db, settings, this.logger, this.config.adminRoleIds);
    let ttsRef: TtsService | null = null;
    const music = new MusicService(
      this.client,
      {
        backend: this.config.MUSIC_BACKEND,
        ytdlpPath: this.config.YTDLP_PATH,
        mpvPath: this.config.MPV_PATH,
        ffmpegPath: this.config.FFMPEG_PATH,
        settings,
        nodeId: this.nodeId,
        leaveOnQueueEnd: this.config.NODE_ROLE === "voice",
        stayConnected: (guildId) => ttsRef?.isEnabled(guildId) ?? false,
      },
      this.logger,
      this.valkey,
    );
    this.music = music;
    const tambola = new TambolaService(this.client, music, this.config, this.logger, economy);
    const cah = new CahService(this.client, this.config, this.logger);
    const tts = new TtsService(music, this.config, this.logger);
    ttsRef = tts;
    // The synthesis model stays loaded while TTS or Tambola is active.
    tts.setConsumerChecker((guildId) => Boolean(tambola.get(guildId)));
    tambola.setSessionEndHook((guildId) => void tts.maybeUnload(guildId));
    music.setVoiceBusyChecker((guildId) => tambola.isUsingVoice(guildId) || tts.isLocal(guildId));
    const isBotInVoice = (guildId: string): boolean =>
      Boolean(
        getVoiceConnection(guildId) ||
          music.isConnected(guildId) ||
          music.isVoiceLocked(guildId) ||
          tambola.isUsingVoice(guildId) ||
          tts.isEnabled(guildId),
      );
    const voiceSfx = new VoiceSfxService({
      ytdlpPath: this.config.YTDLP_PATH,
      ffmpegPath: this.config.FFMPEG_PATH,
      logger: this.logger,
      isVoiceBusy: isBotInVoice,
    });
    this.isVoiceBusy = (guildId: string): boolean => Boolean(tambola.get(guildId));
    this.scheduledEvents = new ScheduledEventService(
      music,
      this.logger,
      this.config.EVENT_SCHEDULE_ENABLED,
      this.config.EVENT_PRAYER,
      this.isVoiceBusy,
      this.config.YTDLP_PATH,
      this.config.FFMPEG_PATH,
      this.config.ROUTER_URL ?? null,
      this.config.MCP_TOKEN,
      (guildId) => features.isEnabled(guildId, "automation-scheduled-events"),
    );
    const activity = new ActivityService(this.dbHandle.db, friendship, tempVc, music, this.logger, economy);
    const leveling = new LevelingService(this.dbHandle.db, settings, this.client, this.logger);
    activity.leveling = leveling;
    this.services = {
      config: this.config,
      registry: this.registry,
      settings,
      features,
      audit,
      activity,
      leveling,
      counters,
      welcome: new WelcomeService(settings, this.logger),
      autoRole: new AutoRoleService(settings, this.logger),
      bias: new BiasService(this.dbHandle.db),
      family: new FamilyService(this.dbHandle.db, this.logger),
      delulu: new DeluluService(this.config.LLM_URL ?? null, this.config.HF_TOKEN ?? null, this.logger),
      birthday: new BirthdayService(
        this.dbHandle.db,
        settings,
        this.client,
        this.logger,
        (guildId) => features.isEnabled(guildId, "engagement-birthday"),
      ),
      confession,
      friendship,
      tempVc,
      privacy: new PrivacyService(this.dbHandle.db, counters, economy, activity, friendship),
      music,
      lyrics,
      tambola,
      cah,
      tts,
      voiceSfx,
      economy,
      relics,
      scheduledEvents: this.scheduledEvents,
    };
    this.controlServer = new ControlServer({
      services: this.services,
      client: this.client,
      token: this.config.MCP_TOKEN,
      logger: this.logger,
      getStatus: () => this.status(),
      getDefaultGuildId: () => this.defaultGuildId(),
      getGuildIds: () => this.servedGuildIds(),
    });
    // Every node (commander and voice workers) serves the internal worker
    // API so the router can treat the fleet uniformly. Only the commander
    // serves the public control API (see start()).
    this.workerServer = new WorkerServer({
      services: this.services,
      client: this.client,
      token: this.config.MCP_TOKEN,
      logger: this.logger,
      getGuildId: () => this.defaultGuildId(),
    });
    this.healthServer = new HealthServer({
      host: this.config.HEALTH_HOST,
      port: this.config.HEALTH_PORT,
      logger: this.logger,
      isReady: async () => {
        const ready = Boolean(this.client.isReady() && this.servedGuildIds().length > 0);
        const dbUp = await pingDatabase(this.dbHandle.db);
        return {
          ready: ready && dbUp,
          details: { gateway: this.client.isReady(), guild: this.servedGuildIds().length > 0, database: dbUp },
        };
      },
    });
  }

  /** The guild list this node serves. A configured GUILD_ID pins the node. */
  private servedGuildIds(): string[] {
    if (this.config.guildId) {
      return this.client.guilds.cache.has(this.config.guildId) ? [this.config.guildId] : [];
    }
    return [...this.client.guilds.cache.keys()];
  }

  private defaultGuildId(): string | null {
    if (this.config.guildId) return this.client.guilds.cache.has(this.config.guildId) ? this.config.guildId : null;
    const ids = this.servedGuildIds();
    return ids.length === 1 ? ids[0]! : null;
  }

  private isServing(guildId: string): boolean {
    if (this.config.guildId) return guildId === this.config.guildId;
    return this.client.guilds.cache.has(guildId);
  }

  async start(): Promise<void> {
    this.registerEvents();
    await this.valkey.start();
    if (!this.isVoiceWorker) this.services.friendship.start();
    this.fleetHeartbeat?.start();
    await Promise.all([
      // Only the commander serves the public control API. Voice workers
      // serve only the internal worker API so there is a single writer.
      ...(this.isVoiceWorker ? [] : [this.controlServer.start(this.config.CONTROL_API_HOST, this.config.CONTROL_API_PORT)]),
      this.healthServer.start(),
      this.workerServer.start(this.config.WORKER_INTERNAL_HOST, this.config.WORKER_INTERNAL_PORT),
    ]);
    await this.client.login(this.config.DISCORD_TOKEN);
    this.logger.info({ user: this.client.user?.tag, nodeId: this.nodeId, role: this.config.NODE_ROLE }, "bot logged in");
  }

  private registerEvents(): void {
    this.client.once(Events.ClientReady, () => void this.onReady());
    this.client.on(Events.GuildCreate, (guild) => void this.onGuildCreate(guild));
    this.client.on(Events.GuildDelete, (guild) => void this.onGuildDelete(guild));
    this.client.on(Events.MessageCreate, (message) => void this.onMessage(message));
    this.client.on(Events.MessageReactionAdd, (reaction, user) => void this.onReactionAdd(reaction, user));
    this.client.on(Events.InteractionCreate, (interaction) => void this.onInteraction(interaction));
    this.client.on(Events.GuildMemberAdd, (member) => void this.onMemberAdd(member));
    this.client.on(Events.GuildMemberRemove, (member) => void this.onMemberRemove(member));
    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => void this.onVoiceState(oldState, newState));
    this.client.on(Events.ChannelDelete, (channel) => {
      if (this.isVoiceWorker) return;
      if (!("guildId" in channel)) return;
      const guildId = channel.guildId;
      void (async () => {
        if (channel.type === ChannelType.GuildVoice && await this.services.features.isEnabled(guildId, "voice-tempvc")) {
          void this.services.tempVc.onChannelDelete(channel.id);
        }
        if (await this.services.features.isEnabled(guildId, "games-tambola")) this.services.tambola.onChannelDelete(channel.id);
        if (await this.services.features.isEnabled(guildId, "games-cah")) this.services.cah.onChannelDelete(channel.id);
      })();
    });
    this.client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
      if (this.isVoiceWorker) return;
      if (newChannel.type === ChannelType.GuildVoice) {
        void (async () => {
          if (await this.services.features.isEnabled(newChannel.guildId, "voice-tempvc")) {
            void this.services.tempVc.onChannelUpdate(oldChannel.id, newChannel);
          }
        })();
      }
    });
    this.client.on(Events.Error, (error) => this.logger.error({ err: error }, "discord client error"));
    this.client.on(Events.Warn, (warning) => this.logger.warn({ warning }, "discord client warning"));
  }

  private async onReady(): Promise<void> {
    const guilds = [...this.client.guilds.cache.values()].filter((guild) => this.isServing(guild.id));
    this.logger.info({ guilds: this.client.guilds.cache.size, serving: guilds.length }, "gateway ready");
    if (guilds.length === 0) {
      this.logger.warn("no guild to serve yet; waiting for the first guild join");
      return;
    }
    for (const guild of guilds) {
      await this.initGuild(guild).catch((error) => this.logger.error({ err: error, guildId: guild.id }, "guild init failed"));
    }
  }

  private async onGuildCreate(guild: Guild): Promise<void> {
    if (!this.isServing(guild.id)) {
      this.logger.warn({ guildId: guild.id, configuredGuildId: this.config.guildId }, "leaving unconfigured guild");
      await guild.leave().catch(() => undefined);
      return;
    }
    await this.initGuild(guild).catch((error) => this.logger.error({ err: error, guildId: guild.id }, "guild init failed"));
  }

  private onGuildDelete(guild: Guild): void {
    this.initializedGuilds.delete(guild.id);
    this.randomVc.get(guild.id)?.stop();
    this.randomVc.delete(guild.id);
    this.scheduledEvents.stop(guild.id);
    this.services.relics.stop(guild.id);
    this.logger.warn({ guildId: guild.id, remaining: this.servedGuildIds().length }, "guild removed");
    void this.updatePresence();
  }

  private async initGuild(guild: Guild): Promise<void> {
    if (this.initializedGuilds.has(guild.id)) return;
    this.initializedGuilds.add(guild.id);
    if (this.isVoiceWorker) {
      this.logger.info({ guildId: guild.id, nodeId: this.nodeId }, "voice worker bound (commands and schedulers disabled)");
      return;
    }
    await this.services.settings.ensure(guild.id);
    await this.registerCommands(guild);
    await this.services.tempVc.reconcile(guild).catch((error) => this.logger.warn({ err: error }, "temp VC reconcile failed"));
    await this.services.activity.reconcile(guild).catch((error) => this.logger.warn({ err: error, guildId: guild.id }, "activity reconcile failed"));
    await this.services.leveling.reconcile(guild).catch((error) => this.logger.warn({ err: error, guildId: guild.id }, "leveling reconcile failed"));
    this.startGlobalSchedulers();
    const randomVc = new RandomVcService(
      this.music,
      this.logger,
      this.isVoiceBusy,
      (guildId) => this.services.features.isEnabled(guildId, "automation-random-drops"),
    );
    randomVc.start(guild);
    this.randomVc.set(guild.id, randomVc);
    this.scheduledEvents.start(guild);
    this.services.relics.start(guild);
    await this.updatePresence();
    this.logger.info({ guildId: guild.id }, "guild initialized");
  }

  private startGlobalSchedulers(): void {
    if (this.globalSchedulersStarted) return;
    this.globalSchedulersStarted = true;
    this.services.activity.start();
    this.services.birthday.start();
    void this.services.activity.purgeOld().catch((error) => this.logger.warn({ err: error }, "activity purge failed"));
  }

  private async updatePresence(): Promise<void> {
    if (this.isVoiceWorker) return;
    const count = this.servedGuildIds().length;
    if (count === 0) return;
    const name = count === 1
      ? `${this.client.guilds.cache.get(this.servedGuildIds()[0]!)?.name ?? "server"} • ${DEFAULTS.prefix}help`
      : `${count} servers • ${DEFAULTS.prefix}help`;
    this.client.user?.setPresence({
      activities: [{ name, type: ActivityType.Watching }],
      status: "online",
    });
  }

  private async registerCommands(guild: Guild): Promise<void> {
    const slash = this.registry.slashCommands();
    await guild.commands.set(slash);
    this.logger.info({ count: slash.length }, "guild commands registered");
  }

  private async onMessage(message: Message): Promise<void> {
    try {
      if (this.isVoiceWorker) return;
      if (message.author.bot || !message.inGuild() || message.webhookId) return;
      if (!this.isServing(message.guild.id)) return;
      const guildId = message.guild.id;
      const features = this.services.features;
      if (await features.isEnabled(guildId, "engagement-activity")) {
        this.services.activity.recordMessage(guildId, message.author.id);
      }
      if (await features.isEnabled(guildId, "engagement-leveling")) {
        void this.services.leveling.awardMessage(guildId, message.author.id).catch(() => undefined);
      }
      if (
        (await features.isEnabled(guildId, "voice-tts")) &&
        this.services.tts.isEnabledChannel(guildId, message.channel.id)
      ) {
        void this.services.tts.speakMessage(message).catch(() => undefined);
      }
      const prefix = await this.services.settings.getPrefix(guildId);
      const parsed = parsePrefixCommand(message.content, prefix, this.client.user?.id ?? "");
      if (!parsed) {
        if (await features.isEnabled(guildId, "voice-sfx")) {
          void this.services.voiceSfx.maybePlay(message).catch(() => undefined);
        }
        return;
      }
      const command = this.registry.get(parsed.name);
      if (!command) {
        const now = Date.now();
        for (const [userId, timestamp] of this.unknownCommandNotices) {
          if (now - timestamp > 15_000) this.unknownCommandNotices.delete(userId);
        }
        const noticeKey = `${message.guild.id}:${message.author.id}`;
        const last = this.unknownCommandNotices.get(noticeKey) ?? 0;
        if (now - last > 15_000) {
          this.unknownCommandNotices.set(noticeKey, now);
          await message.react("❓").catch(() => undefined);
        }
        return;
      }
      const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
      if (!member) return;
      const channel = message.channel as GuildBasedChannel;
      const ctx = await createPrefixContext({
        services: this.services,
        message,
        member,
        channel,
        commandName: command.name,
        args: parsed.args,
        rawArgs: parsed.rawArgs,
      });
      const allowed = await this.guard(command, ctx);
      if (!allowed) return;
      await command.execute(ctx);
      if (await features.isEnabled(guildId, "engagement-activity")) {
        this.services.activity.recordCommand(guildId, message.author.id);
      }
      void (async () => {
        if (!(await features.isEnabled(guildId, "economy-core"))) return;
        const allowed = await this.services.economy.rateLimit(`command:${guildId}:${message.author.id}`, 5, 60 * 60 * 1000).catch(() => true);
        if (allowed) await this.services.economy.award(guildId, message.author.id, 1, "command", message.id).catch(() => undefined);
      })();
    } catch (error) {
      await this.handleCommandError(message, error);
    }
  }

  private async onReactionAdd(reaction: any, user: any): Promise<void> {
    try {
      if (this.isVoiceWorker) return;
      if (user?.bot) return;
      let guildId: string | null = null;
      if (reaction.message?.guildId) guildId = reaction.message.guildId;
      if (!guildId && reaction.partial) {
        const fetched = await reaction.fetch().catch(() => null);
        guildId = fetched?.message?.guildId ?? null;
      }
      if (!guildId && reaction.message?.partial) {
        const message = await reaction.message.fetch().catch(() => null);
        guildId = message?.guildId ?? null;
      }
      if (!guildId || !this.isServing(guildId)) return;
      if (await this.services.features.isEnabled(guildId, "engagement-activity")) {
        this.services.activity.recordReaction(guildId, user.id);
      }
      if (await this.services.features.isEnabled(guildId, "engagement-leveling")) {
        void this.services.leveling.awardReaction(guildId, user.id).catch(() => undefined);
      }
      if (reaction.emoji?.name === "💰" && (await this.services.features.isEnabled(guildId, "relics"))) {
        await this.services.relics.handleReaction(reaction, user).catch((error) => {
          this.logger.warn({ err: error }, "relic reaction bid failed");
        });
        return;
      }
    } catch {
      // ignore reaction tracking failures
    }
  }

  private async onInteraction(interaction: Interaction): Promise<void> {
    try {
      if (this.isVoiceWorker) return;
      if (interaction.isChatInputCommand()) {
        await this.onChatInput(interaction);
        return;
      }
      if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith(DELULU_SETUP_PREFIX)) {
        if (!interaction.guildId || !this.isServing(interaction.guildId)) return;
        if (!(await this.allowFeature(interaction, "social-delulu"))) return;
        await handleDeluluSetup(interaction, this.services);
        return;
      }
      if (
        (interaction.isButton() ||
          interaction.isStringSelectMenu() ||
          interaction.isChannelSelectMenu()) &&
        interaction.customId.startsWith("tambola:")
      ) {
        if (!(await this.allowFeature(interaction, "games-tambola"))) return;
        await this.services.tambola.handleInteraction(interaction);
        return;
      }
      if (
        (interaction.isButton() ||
          interaction.isStringSelectMenu() ||
          interaction.isChannelSelectMenu()) &&
        interaction.customId.startsWith("cah:")
      ) {
        if (!(await this.allowFeature(interaction, "games-cah"))) return;
        await this.services.cah.handleInteraction(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith("economy:bj:")) {
        if (!(await this.allowFeature(interaction, "economy-core"))) return;
        await this.services.economy.handleBlackjackInteraction(interaction);
        return;
      }
      if (
        (interaction.isButton() || interaction.isModalSubmit()) &&
        interaction.customId.startsWith("relics:")
      ) {
        if (!(await this.allowFeature(interaction, "relics"))) return;
        await this.services.relics.handleInteraction(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith("stocks:")) {
        if (!(await this.allowFeature(interaction, "economy-stocks"))) return;
        await handleStockButton(this.services.economy, interaction);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith("stocks:")) {
        if (!(await this.allowFeature(interaction, "economy-stocks"))) return;
        await handleStockModal(this.services.economy, interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith("music:")) {
        if (!(await this.allowFeature(interaction, "music-playback"))) return;
        await this.onMusicButton(interaction);
        return;
      }
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith("music:filter:")) {
        if (!(await this.allowFeature(interaction, "music-playback"))) return;
        await this.onMusicFilterSelect(interaction);
        return;
      }
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith("music:more:")) {
        if (!(await this.allowFeature(interaction, "music-playback"))) return;
        await this.onMusicMoreSelect(interaction);
        return;
      }
      if ((interaction.isButton() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) && interaction.customId.startsWith("tempvc:")) {
        if (!(await this.allowFeature(interaction, "voice-tempvc"))) return;
        await this.onTempVcComponent(interaction);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith("tempvc:")) {
        if (!(await this.allowFeature(interaction, "voice-tempvc"))) return;
        await this.onTempVcModal(interaction);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId === HELP_SEARCH_MODAL_ID) {
        await this.onHelpSearch(interaction);
        return;
      }
      if (
        (interaction.isButton() || interaction.isStringSelectMenu()) &&
        interaction.customId.startsWith("help:")
      ) {
        await this.onHelpComponent(interaction);
        return;
      }
    } catch (error) {
      this.logger.error({ err: error }, "interaction error");
      if (interaction.isRepliable() && !interaction.replied) {
        await interaction.reply(styleMessage({ content: "Something went wrong. Try again, and ask an admin to check the logs if it persists.", ephemeral: true })).catch(() => undefined);
      }
    }
  }

  private async onChatInput(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) return;
    if (!this.isServing(interaction.guild!.id)) return;
    const command = this.registry.get(interaction.commandName);
    if (!command) return;
    const member = interaction.member instanceof Object && "roles" in interaction.member
      ? (interaction.member as GuildMember)
      : await interaction.guild.members.fetch(interaction.user.id);
    const channel = interaction.channel as GuildBasedChannel | null;
    if (!channel) return;
    const args = argsFromInteraction(interaction);
    const ctx = await createSlashContext({
      services: this.services,
      interaction,
      member,
      channel,
      commandName: command.name,
      args,
      rawArgs: rawArgsFromInteraction(interaction),
    });
    const allowed = await this.guard(command, ctx);
    if (!allowed) return;
    try {
      await command.execute(ctx);
    } catch (error) {
      await this.handleCommandError(ctx, error);
      return;
    }
    const guildId = interaction.guild.id;
    const features = this.services.features;
    if (await features.isEnabled(guildId, "engagement-activity")) {
      this.services.activity.recordCommand(guildId, interaction.user.id);
    }
    if (await features.isEnabled(guildId, "engagement-leveling")) {
      void this.services.leveling.awardCommand(guildId, interaction.user.id).catch(() => undefined);
    }
    void (async () => {
      if (!(await features.isEnabled(guildId, "economy-core"))) return;
      const allowed = await this.services.economy.rateLimit(`command:${guildId}:${interaction.user.id}`, 5, 60 * 60 * 1000).catch(() => true);
      if (allowed) await this.services.economy.award(guildId, interaction.user.id, 1, "command", interaction.id).catch(() => undefined);
    })();
  }

  private async onHelpComponent(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ): Promise<void> {
    if (interaction.customId === "help:close") {
      await interaction.deferUpdate().catch(() => undefined);
      const deleted = await interaction.deleteReply().then(() => true).catch(() => false);
      if (!deleted) await interaction.message.delete().catch(() => undefined);
      return;
    }

    if (interaction.customId === "help:search") {
      await interaction.showModal(buildHelpSearchModal());
      return;
    }

    const guild = interaction.guild;
    if (!guild) return;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;
    const prefix = await this.services.settings.getPrefix(guild.id);

    let category: string | undefined;
    let query: string | undefined;
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "help:category") category = interaction.values[0];
      else if (interaction.customId === "help:pick") query = interaction.values[0];
      else if (interaction.customId.startsWith("help:command:")) query = interaction.values[0];
      else return;
    } else if (interaction.customId.startsWith("help:nav:")) {
      category = interaction.customId.slice("help:nav:".length);
    } else if (interaction.customId.startsWith("help:pick:")) {
      query = interaction.customId.slice("help:pick:".length);
    } else if (interaction.customId !== "help:home") {
      return;
    }

    const payload = await buildHelpPayload({
      registry: this.registry,
      member,
      config: this.config,
      prefix,
      category,
      query,
      disabledFeatures: await this.services.features.disabledIds(guild.id),
    });
    await interaction.update(styleMessage({
      components: payload.components,
      flags: payload.flags,
    }));
  }

  private async onHelpSearch(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.isFromMessage()) {
      await interaction
        .reply(styleMessage({ content: "Open help with `/help` or `!help` first.", ephemeral: true }))
        .catch(() => undefined);
      return;
    }
    const guild = interaction.guild;
    if (!guild) return;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;
    const prefix = await this.services.settings.getPrefix(guild.id);
    const query = interaction.fields.getTextInputValue(HELP_SEARCH_INPUT_ID).trim() || undefined;
    const payload = await buildHelpPayload({
      registry: this.registry,
      member,
      config: this.config,
      prefix,
      query,
      disabledFeatures: await this.services.features.disabledIds(guild.id),
    });
    await interaction.update(styleMessage({
      components: payload.components,
      flags: payload.flags,
    }));
  }

  private async onMusicButton(interaction: ButtonInteraction): Promise<void> {
    const [prefix, action, guildId, channelId] = interaction.customId.split(":");
    if (prefix !== "music" || !action || !guildId) return;
    await this.handleMusicAction(interaction, action, guildId, channelId);
  }

  private async onMusicMoreSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [prefix, kind, guildId, channelId] = interaction.customId.split(":");
    if (prefix !== "music" || kind !== "more" || !guildId) return;
    const action = interaction.values[0];
    if (!action) return;
    await this.handleMusicAction(interaction, action, guildId, channelId);
  }

  private async handleMusicAction(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    action: string,
    guildId: string,
    channelId?: string,
  ): Promise<void> {
    if (!guildId || !this.isServing(guildId)) return;
    const guild = interaction.guild;
    if (!guild) return;
    const music = this.services.music;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!music || !member) return;

    const fleetNode = channelId ? music.getFleetNode(guild.id, channelId) : null;
    if (fleetNode && this.config.ROUTER_URL) {
      await this.handleFleetMusicAction(interaction, action, guild, member, music, fleetNode, channelId);
      return;
    }

    const replyError = async (message: string): Promise<void> => {
      if (interaction.deferred) {
        await interaction.editReply(styleMessage({ content: message })).catch(() => undefined);
      } else if (!interaction.replied) {
        await interaction.reply(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
      } else {
        await interaction.followUp(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
      }
    };

    const localChannelId = music.channelId(guild.id);
    const state = music.state(guild.id);
    if (action === "lyrics") {
      if (!state?.current) return replyError("Nothing is playing.");
      await interaction.deferReply();
      try {
        const result = await this.services.lyrics.forTrack(state.current);
        await interaction.editReply(styleMessage(buildLyricsPayload(state.current, result)));
      } catch (error) {
        const message = error instanceof UserError ? error.message : "Could not fetch lyrics.";
        await interaction
          .editReply(styleMessage(card({ title: "Lyrics", body: message })))
          .catch(() => undefined);
      }
      return;
    }
    if (!localChannelId) return replyError("The bot is not in a voice channel.");
    if (member.voice.channelId !== localChannelId) return replyError("Join the bot's voice channel first.");
    if (!state?.current) return replyError("Nothing is playing.");

    try {
      if (action === "pause") {
        if (state.paused) await music.resume(guild.id);
        else await music.pause(guild.id);
        await interaction.update(styleMessage(buildMusicPayload(guild.id, music.state(guild.id))));
        return;
      }
      if (action === "rewind" || action === "forward") {
        await interaction.deferUpdate();
        const delta = action === "rewind" ? -10_000 : 10_000;
        await music.seek(guild.id, state.position + delta);
        await interaction.editReply(styleMessage(buildMusicPayload(guild.id, music.state(guild.id))));
        return;
      }
      if (action === "skip") {
        await interaction.deferUpdate();
        await music.skip(guild.id);
        await interaction.editReply(styleMessage(buildMusicPayload(guild.id, music.state(guild.id))));
        return;
      }
      if (action === "shuffle") {
        await interaction.deferUpdate();
        await music.shuffle(guild.id);
        await interaction.editReply(styleMessage(buildMusicPayload(guild.id, music.state(guild.id))));
        return;
      }
      if (action === "loop") {
        const next = state.loop === "off" ? "track" : state.loop === "track" ? "queue" : "off";
        await interaction.deferUpdate();
        await music.loop(guild.id, next);
        await interaction.editReply(styleMessage(buildMusicPayload(guild.id, music.state(guild.id))));
        return;
      }
      if (action === "filter") {
        await interaction.reply(styleMessage({
          content: "Choose a filter preset:",
          ephemeral: true,
          components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(channelId ? `music:filter:${guild.id}:${channelId}` : `music:filter:${guild.id}`)
                .setPlaceholder("Choose a filter")
                .addOptions(
                  { label: "Off", value: "off", description: "No audio filter", emoji: EMOJI.off },
                  { label: "Bass boost", value: "bassboost", description: "Extra low end", emoji: EMOJI.bass },
                  { label: "Nightcore", value: "nightcore", description: "Faster and higher", emoji: EMOJI.nightcore },
                  { label: "Vaporwave", value: "vaporwave", description: "Slower and deeper", emoji: EMOJI.vaporwave },
                ),
            ),
          ],
        }));
        return;
      }
      if (action === "stop") {
        const confirmId = "music:stop:confirm";
        const cancelId = "music:stop:cancel";
        const confirmationMessage = await interaction.reply(styleMessage({
          ...confirmCard({
            title: "Stop playback?",
            body: "This stops the current track and clears the queue.",
            confirmId,
            cancelId,
            confirmLabel: "Stop",
          }),
          fetchReply: true,
        }));
        attachConfirmation({
          message: confirmationMessage,
          userId: interaction.user.id,
          confirmId,
          cancelId,
          onConfirm: async () => {
            await music.stop(guild.id);
            await music.disconnect(guild.id);
            await interaction.message?.edit(styleMessage(card({ title: "Stopped", body: "The player has been disconnected." }))).catch(() => undefined);
            return card({ title: "Stopped", body: "The player has been disconnected." });
          },
          onCancel: () => card({ title: "Cancelled", body: "Playback continues." }),
        });
        return;
      }
      await replyError("Unknown music control.");
    } catch (error) {
      await replyError(error instanceof UserError ? error.message : "That music control failed.");
    }
  }

  /**
   * Fleet music controls. The commander owns the interface (card + buttons)
   * while audio plays on the worker; every op forwards through the router.
   */
  private async handleFleetMusicAction(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    action: string,
    guild: Guild,
    member: GuildMember,
    music: MusicService,
    nodeId: string,
    channelId?: string | null,
  ): Promise<void> {
    const fleet = new FleetClient(this.config.ROUTER_URL ?? null, this.config.MCP_TOKEN, this.logger, guild.id);

    const replyError = async (message: string): Promise<void> => {
      if (interaction.deferred) {
        await interaction.editReply(styleMessage({ content: message })).catch(() => undefined);
      } else if (!interaction.replied) {
        await interaction.reply(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
      } else {
        await interaction.followUp(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
      }
    };

    const refresh = async (): Promise<void> => {
      const { state } = await fleet.nodeState(nodeId);
      await interaction.editReply(styleMessage(buildMusicPayload(guild.id, state, undefined, channelId ?? undefined))).catch(() => undefined);
      music.refreshNowPlaying(guild.id);
    };

    let playback: FleetNodePlayback;
    try {
      playback = await fleet.nodeState(nodeId);
    } catch {
      if (channelId) music.setFleetNode(guild.id, channelId, null);
      await replyError("That fleet player is unreachable. Use `/play` to start a new queue.");
      return;
    }

    if (action === "lyrics") {
      if (!playback.state?.current) return replyError("Nothing is playing.");
      await interaction.deferReply();
      try {
        const result = await this.services.lyrics.forTrack(playback.state.current);
        await interaction.editReply(styleMessage(buildLyricsPayload(playback.state.current, result)));
      } catch (error) {
        const message = error instanceof UserError ? error.message : "Could not fetch lyrics.";
        await interaction
          .editReply(styleMessage(card({ title: "Lyrics", body: message })))
          .catch(() => undefined);
      }
      return;
    }
    if (!playback.channelId) {
      if (channelId) music.setFleetNode(guild.id, channelId, null);
      return replyError("The fleet player is not in a voice channel.");
    }
    if (member.voice.channelId !== playback.channelId) return replyError("Join the fleet player's voice channel first.");
    if (!playback.state?.current) return replyError("Nothing is playing.");

    try {
      if (action === "pause") {
        if (playback.state.paused) await fleet.control(nodeId, "resume");
        else await fleet.control(nodeId, "pause");
        await interaction.update(styleMessage(buildMusicPayload(guild.id, (await fleet.nodeState(nodeId)).state, undefined, channelId ?? undefined)));
        music.refreshNowPlaying(guild.id);
        return;
      }
      if (action === "rewind" || action === "forward") {
        await interaction.deferUpdate();
        const delta = action === "rewind" ? -10_000 : 10_000;
        await fleet.control(nodeId, "seek", { positionMs: playback.state.position + delta });
        await refresh();
        return;
      }
      if (action === "skip") {
        await interaction.deferUpdate();
        await fleet.control(nodeId, "skip", { count: 1 });
        await refresh();
        return;
      }
      if (action === "shuffle") {
        await interaction.deferUpdate();
        await fleet.control(nodeId, "shuffle");
        await refresh();
        return;
      }
      if (action === "loop") {
        const next = playback.state.loop === "off" ? "track" : playback.state.loop === "track" ? "queue" : "off";
        await interaction.deferUpdate();
        await fleet.control(nodeId, "loop", { mode: next });
        await refresh();
        return;
      }
      if (action === "filter") {
        await interaction.reply(styleMessage({
          content: "Choose a filter preset:",
          ephemeral: true,
          components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(channelId ? `music:filter:${guild.id}:${channelId}` : `music:filter:${guild.id}`)
                .setPlaceholder("Choose a filter")
                .addOptions(
                  { label: "Off", value: "off", description: "No audio filter", emoji: EMOJI.off },
                  { label: "Bass boost", value: "bassboost", description: "Extra low end", emoji: EMOJI.bass },
                  { label: "Nightcore", value: "nightcore", description: "Faster and higher", emoji: EMOJI.nightcore },
                  { label: "Vaporwave", value: "vaporwave", description: "Slower and deeper", emoji: EMOJI.vaporwave },
                ),
            ),
          ],
        }));
        return;
      }
      if (action === "stop") {
        const confirmId = "music:stop:confirm";
        const cancelId = "music:stop:cancel";
        const confirmationMessage = await interaction.reply(styleMessage({
          ...confirmCard({
            title: "Stop playback?",
            body: "This stops the fleet player and clears its queue.",
            confirmId,
            cancelId,
            confirmLabel: "Stop",
          }),
          fetchReply: true,
        }));
        attachConfirmation({
          message: confirmationMessage,
          userId: interaction.user.id,
          confirmId,
          cancelId,
          onConfirm: async () => {
            await fleet.control(nodeId, "stop").catch(() => undefined);
            if (channelId) music.setFleetNode(guild.id, channelId, null);
            await interaction.message?.edit(styleMessage(card({ title: "Stopped", body: "The fleet player has been disconnected." }))).catch(() => undefined);
            return card({ title: "Stopped", body: "The fleet player has been disconnected." });
          },
          onCancel: () => card({ title: "Cancelled", body: "Playback continues." }),
        });
        return;
      }
      await replyError("Unknown music control.");
    } catch (error) {
      await replyError(error instanceof UserError ? error.message : "That music control failed.");
    }
  }

  private async onMusicFilterSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [prefix, kind, guildId, channelId] = interaction.customId.split(":");
    if (prefix !== "music" || kind !== "filter" || !guildId || !this.isServing(guildId)) return;
    const guild = interaction.guild;
    if (!guild) return;
    const music = this.services.music;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!music || !member) return;

    const errorReply = async (message: string): Promise<void> => {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
      } else {
        await interaction.followUp(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
      }
    };

    const value = interaction.values[0];
    if (value !== "off" && value !== "bassboost" && value !== "nightcore" && value !== "vaporwave") {
      return errorReply("Unknown filter preset.");
    }

    // Fleet playback: the commander's local player is idle, so validate
    // against the worker's channel instead.
    const fleetNode = channelId ? music.getFleetNode(guild.id, channelId) : null;
    if (fleetNode && this.config.ROUTER_URL) {
      const fleet = new FleetClient(this.config.ROUTER_URL, this.config.MCP_TOKEN, this.logger, guild.id);
      await interaction.deferUpdate();
      try {
        const playback = await fleet.nodeState(fleetNode);
        if (!playback.channelId) return errorReply("The fleet player is not in a voice channel.");
        if (member.voice.channelId !== playback.channelId) return errorReply("Join the fleet player's voice channel first.");
        if (!playback.state?.current) return errorReply("Nothing is playing.");
        await fleet.control(fleetNode, "filters", { preset: value });
        music.refreshNowPlaying(guild.id);
        await interaction.editReply(styleMessage({ content: `Filter preset set to **${value}** on **${fleetNode}**.`, components: [] }));
      } catch (error) {
        await interaction.editReply(styleMessage({
          content: error instanceof UserError ? error.message : "That filter could not be applied.",
          components: [],
        }));
      }
      return;
    }

    const localChannelId = music.channelId(guild.id);
    if (!localChannelId) return errorReply("The bot is not in a voice channel.");
    if (member.voice.channelId !== localChannelId) return errorReply("Join the bot's voice channel first.");
    if (!music.state(guild.id)?.current) return errorReply("Nothing is playing.");

    await interaction.deferUpdate();
    try {
      await music.filters(guild.id, value as MusicFilterPreset);
      music.refreshNowPlaying(guild.id);
      await interaction.editReply(styleMessage({ content: `Filter preset set to **${value}**.`, components: [] }));
    } catch (error) {
      await interaction.editReply(styleMessage({
        content: error instanceof UserError ? error.message : "That filter could not be applied.",
        components: [],
      }));
    }
  }

  private async requireTempVcPanelAccess(
    interaction: ButtonInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  ): Promise<{
    action: string;
    channelId: string;
    row: TempVoiceChannelRow;
    channel: VoiceChannel;
    member: GuildMember;
  } | null> {
    const parsed = parseTempVcPanelCustomId(interaction.customId);
    const guild = interaction.guild;
    if (!parsed || !guild) return null;
    if (interaction.channelId !== parsed.channelId) {
      await interaction
        .reply(styleMessage({ content: "That control panel does not belong to this channel.", ephemeral: true }))
        .catch(() => undefined);
      return null;
    }
    const row = await this.services.tempVc.getRow(parsed.channelId);
    const channel = await guild.channels.fetch(parsed.channelId).catch(() => null);
    if (!row || row.status !== "active" || !channel || channel.type !== ChannelType.GuildVoice) {
      await interaction
        .reply(styleMessage({ content: "That temporary VC is no longer active.", ephemeral: true }))
        .catch(() => undefined);
      return null;
    }
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return null;
    if (!canManageTempVc(member, row.ownerId, this.config)) {
      await interaction
        .reply(styleMessage({ content: "Only the channel owner or an admin can use these controls.", ephemeral: true }))
        .catch(() => undefined);
      return null;
    }
    return { action: parsed.action, channelId: parsed.channelId, row, channel, member };
  }

  private async replyTempVcError(
    interaction: ButtonInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof UserError ? error.message : "That VC action failed.";
    this.logger.warn({ err: error, customId: interaction.customId }, "temp VC panel action failed");
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
    } else {
      await interaction.reply(styleMessage({ content: message, ephemeral: true })).catch(() => undefined);
    }
  }

  private auditTempVcPanel(
    interaction: ButtonInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    action: string,
    channelId: string,
    after?: unknown,
  ): Promise<void> {
    return this.services.audit
      .log({
        guildId: interaction.guildId ?? this.defaultGuildId() ?? "",
        actorId: interaction.user.id,
        actorType: "user",
        source: "discord",
        action,
        targetType: "tempvc",
        targetId: channelId,
        after,
      })
      .catch((error) => this.logger.debug({ err: error, action, channelId }, "temp VC panel audit failed"));
  }

  private async onTempVcComponent(
    interaction: ButtonInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction,
  ): Promise<void> {
    const context = await this.requireTempVcPanelAccess(interaction);
    if (!context) return;
    const { action, channelId, row, channel } = context;
    try {
      if (action === "lock") {
        await interaction.deferUpdate();
        if (row.locked) await this.services.tempVc.unlock(channelId, interaction.user.id);
        else await this.services.tempVc.lock(channelId, interaction.user.id);
        await this.auditTempVcPanel(interaction, "vc.panel.lock", channelId, { locked: !row.locked });
        await interaction.editReply(styleMessage(await this.services.tempVc.panelPayload(channelId)));
        return;
      }

      if (action === "rename") {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId(tempVcPanelCustomId("rename-modal", channelId))
            .setTitle("Rename temporary VC")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("name")
                  .setLabel("Channel name")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setMaxLength(100)
                  .setValue(channel.name.slice(0, 100)),
              ),
            ),
        );
        return;
      }

      if (action === "limit") {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId(tempVcPanelCustomId("limit-modal", channelId))
            .setTitle("Set VC user limit")
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId("limit")
                  .setLabel("User limit (0 = unlimited)")
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setMaxLength(2)
                  .setValue(String(row.userLimit)),
              ),
            ),
        );
        return;
      }

      if (action === "delete") {
        await interaction.reply(styleMessage({
          content: `Delete **${channel.name}** and disconnect everyone in it?`,
          ephemeral: true,
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(tempVcPanelCustomId("delete-confirm", channelId))
                .setLabel("Delete")
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId(tempVcPanelCustomId("delete-cancel", channelId))
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary),
            ),
          ],
        }));
        return;
      }

      if (action === "delete-confirm") {
        await interaction.deferReply({ ephemeral: true });
        await this.services.tempVc.delete(channelId, "Owner deleted temporary VC from panel");
        await this.auditTempVcPanel(interaction, "vc.panel.delete", channelId);
        await interaction.editReply(styleMessage(card({ title: "Deleted", body: "Temporary VC deleted." }))).catch(() => undefined);
        return;
      }

      if (action === "delete-cancel") {
        await interaction.update(styleMessage(card({ title: "Cancelled", body: "No changes were made." })));
        return;
      }

      if (action === "manage") {
        if (!interaction.isStringSelectMenu()) throw new UserError("Choose a management action.");
        const choice = interaction.values[0];
        await interaction.update(styleMessage(await this.services.tempVc.panelPayload(channelId)));
        if (choice === "delete") {
          await interaction.followUp(
            styleMessage(confirmCard({
              title: "Delete this channel?",
              body: `This will delete **${channel.name}** and disconnect everyone in it.`,
              confirmId: tempVcPanelCustomId("delete-confirm", channelId),
              cancelId: tempVcPanelCustomId("delete-cancel", channelId),
              confirmLabel: "Delete",
            })),
          );
          return;
        }
        if (choice === "kick" || choice === "transfer") {
          await interaction.followUp(styleMessage({
            content: choice === "kick" ? "Select a member to kick." : "Select the new owner.",
            ephemeral: true,
            components: [
              new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
                new UserSelectMenuBuilder()
                  .setCustomId(tempVcPanelCustomId(choice, channelId))
                  .setPlaceholder(choice === "kick" ? "Member to kick" : "New owner")
                  .setMinValues(1)
                  .setMaxValues(1),
              ),
            ],
          }));
          return;
        }
        throw new UserError("Unknown management action.");
      }

      if (action === "kick") {
        if (!interaction.isUserSelectMenu()) throw new UserError("Select a member to kick.");
        const targetId = interaction.values[0];
        if (!targetId) throw new UserError("Select a member to kick.");
        await interaction.deferReply({ ephemeral: true });
        await this.services.tempVc.disconnect(channelId, targetId);
        await this.auditTempVcPanel(interaction, "vc.panel.kick", channelId, { targetId });
        await interaction.editReply(styleMessage({ content: `Kicked <@${targetId}> from the VC.` }));
        await this.services.tempVc.refreshPanel(channelId).catch(() => undefined);
        return;
      }

      if (action === "transfer") {
        if (!interaction.isUserSelectMenu()) throw new UserError("Select the new owner.");
        const targetId = interaction.values[0];
        if (!targetId) throw new UserError("Select the new owner.");
        await interaction.deferUpdate();
        await this.services.tempVc.transfer(channelId, targetId);
        await this.auditTempVcPanel(interaction, "vc.panel.transfer", channelId, { targetId });
        await interaction.editReply(
          styleMessage(card({ title: "Ownership transferred", body: `<@${targetId}> now owns this VC.` })),
        );
        await this.services.tempVc.refreshPanel(channelId).catch(() => undefined);
        return;
      }

      throw new UserError("Unknown VC control.");
    } catch (error) {
      await this.replyTempVcError(interaction, error);
    }
  }

  private async onTempVcModal(interaction: ModalSubmitInteraction): Promise<void> {
    const context = await this.requireTempVcPanelAccess(interaction);
    if (!context) return;
    const { action, channelId } = context;
    try {
      await interaction.deferReply({ ephemeral: true });
      if (action === "rename-modal") {
        const name = interaction.fields.getTextInputValue("name").trim();
        if (!name) throw new UserError("Provide a channel name.");
        await this.services.tempVc.rename(channelId, name);
        await this.auditTempVcPanel(interaction, "vc.panel.rename", channelId, { name });
        await this.services.tempVc.refreshPanel(channelId);
        await interaction.editReply(styleMessage({ content: "Temporary VC renamed." }));
        return;
      }

      if (action === "limit-modal") {
        const raw = interaction.fields.getTextInputValue("limit").trim();
        if (!/^\d{1,2}$/.test(raw)) throw new UserError("Limit must be a number from 0 to 99.");
        const limit = Number(raw);
        if (limit > 99) throw new UserError("Limit must be a number from 0 to 99.");
        await this.services.tempVc.setLimit(channelId, limit);
        await this.auditTempVcPanel(interaction, "vc.panel.limit", channelId, { limit });
        await this.services.tempVc.refreshPanel(channelId);
        await interaction.editReply(styleMessage({ content: `User limit set to **${limit === 0 ? "unlimited" : limit}**.` }));
        return;
      }

      throw new UserError("Unknown VC control.");
    } catch (error) {
      await this.replyTempVcError(interaction, error);
    }
  }

  private async guard(command: Command, ctx: CommandContext): Promise<boolean> {
    const featureId = featureForCommand(command.name);
    if (featureId && !(await this.services.features.isEnabled(ctx.guild.id, featureId))) {
      const label = getFeature(featureId)?.label ?? "That feature";
      await ctx.reply({ content: `${label} is turned off on this server. An admin can enable it from the dashboard.`, ephemeral: true });
      return false;
    }
    if (command.adminOnly && !isAdmin(ctx.member, this.config, ctx.guild)) {
      await ctx.reply({ content: "You need admin permissions for that.", ephemeral: true });
      return false;
    }
    if (command.nsfw && !isNsfwChannel(ctx.channel)) {
      await ctx.reply({ content: "That command can only be used in an NSFW channel.", ephemeral: true });
      return false;
    }
    if (command.userPermissions?.length && !hasUserPermissions(ctx.member, command.userPermissions)) {
      await ctx.reply({ content: "You are missing permissions for that.", ephemeral: true });
      return false;
    }
    if (command.botPermissions?.length && !hasBotPermissions(ctx.guild, command.botPermissions)) {
      await ctx.reply({ content: "I am missing permissions for that.", ephemeral: true });
      return false;
    }
    const cooldown = command.cooldownMs ?? 0;
    if (cooldown > 0) {
      const key = `${ctx.guild.id}:${command.name}:${ctx.author.id}`;
      const remaining = this.cooldowns.remaining(key, cooldown);
      if (remaining > 0) {
        await ctx.reply({ content: `Wait ${Math.ceil(remaining / 1000)}s before using that again.`, ephemeral: true });
        return false;
      }
      this.cooldowns.use(key);
    }
    return true;
  }

  /** Reply once and return false when a feature is off. Components bypass guard. */
  private async allowFeature(interaction: Interaction, featureId: string): Promise<boolean> {
    const guildId = interaction.guildId;
    if (!guildId) return false;
    if (await this.services.features.isEnabled(guildId, featureId)) return true;
    const label = getFeature(featureId)?.label ?? "That feature";
    if (interaction.isRepliable()) {
      await interaction
        .reply(styleMessage({ content: `${label} is turned off on this server.`, ephemeral: true }))
        .catch(() => undefined);
    }
    return false;
  }

  private async handleCommandError(source: Message | CommandContext, error: unknown): Promise<void> {
    const requestId = randomUUID().slice(0, 8);
    const message = error instanceof UserError ? error.message : "Something went wrong.";
    this.logger.error({ err: error, requestId }, "command error");
    const content = `${message}${error instanceof UserError ? "" : ` Reference: \`${requestId}\``}`;
    if ("commandName" in source) {
      await (source as CommandContext).reply(styleMessage({ content, ephemeral: true })).catch(() => undefined);
    } else {
      await (source as Message).reply(styleMessage({ content, allowedMentions: { parse: [] } })).catch(() => undefined);
    }
  }

  private async onMemberAdd(member: GuildMember): Promise<void> {
    if (this.isVoiceWorker || !this.isServing(member.guild.id)) return;
    const guildId = member.guild.id;
    const jobs: Array<Promise<unknown>> = [];
    if (await this.services.features.isEnabled(guildId, "onboarding-welcome")) {
      jobs.push(this.services.welcome.onMemberJoin(member));
    }
    if (await this.services.features.isEnabled(guildId, "onboarding-autorole")) {
      jobs.push(this.services.autoRole.onMemberJoin(member));
    }
    await Promise.allSettled(jobs);
  }

  private async onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    if (this.isVoiceWorker || !this.isServing(member.guild.id)) return;
    const guildId = member.guild.id;
    const features = this.services.features;
    if (await features.isEnabled(guildId, "games-tambola")) this.services.tambola.onMemberRemove(guildId, member.user.id);
    if (await features.isEnabled(guildId, "games-cah")) this.services.cah.onMemberRemove(guildId, member.user.id);
    const jobs: Array<Promise<unknown>> = [];
    if (await features.isEnabled(guildId, "onboarding-welcome")) jobs.push(this.services.welcome.onMemberRemove(member));
    if (await features.isEnabled(guildId, "voice-tempvc")) jobs.push(this.services.tempVc.onMemberRemove(member.guild, member.user.id));
    await Promise.allSettled(jobs);
  }

  private async onVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (this.isVoiceWorker || !this.isServing(oldState.guild.id)) return;
    const guildId = oldState.guild.id;
    if (await this.services.features.isEnabled(guildId, "engagement-activity")) {
      await this.services.activity.handleVoiceState(oldState, newState).catch((error) => {
        this.logger.warn({ err: error }, "activity voice handling failed");
      });
    }
    if (await this.services.features.isEnabled(guildId, "voice-tempvc")) {
      await this.services.tempVc.handleVoiceState(oldState, newState).catch((error) => {
        this.logger.warn({ err: error }, "voice state handling failed");
      });
    }
  }

  async status(): Promise<BotStatus> {
    const database = (await pingDatabase(this.dbHandle.db)) ? "up" : "down";
    const music = this.music ? await this.music.isUp().catch(() => false) : false;
    const guildIds = this.servedGuildIds();
    const activeTempVcs = (
      await Promise.all(guildIds.map((guildId) => this.services.tempVc.activeCount(guildId).catch(() => 0)))
    ).reduce((sum, count) => sum + count, 0);
    return {
      ready: Boolean(this.client.isReady() && guildIds.length > 0),
      uptimeSeconds: Math.floor((this.client.uptime ?? 0) / 1000),
      gatewayPing: this.client.ws.ping >= 0 ? this.client.ws.ping : null,
      guildId: this.defaultGuildId(),
      guildCount: guildIds.length,
      database,
      music: this.music ? (music ? "up" : "down") : "unknown",
      activePlayers: this.music ? this.music.activePlayers() : 0,
      activeTempVcs,
      version: APP_VERSION,
    };
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await this.fleetHeartbeat?.stop().catch(() => undefined);
    await Promise.allSettled([this.controlServer.stop(), this.healthServer.stop(), this.workerServer.stop()]);
    if (this.music) await this.music.shutdown().catch(() => undefined);
    this.services.tambola.stop();
    this.services.cah.stop();
    this.services.tts.stop();
    this.services.voiceSfx.stop();
    this.services.tempVc.stop();
    for (const service of this.randomVc.values()) service.stop();
    this.randomVc.clear();
    this.scheduledEvents.stop();
    await this.services.activity.stop();
    await this.services.friendship.stop();
    await this.valkey.stop();
    this.services.birthday.stop();
    this.services.relics.stop();
    this.client.destroy();
    await this.dbHandle.close();
  }
}
