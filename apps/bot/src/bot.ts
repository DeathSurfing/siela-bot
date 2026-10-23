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
import { APP_VERSION, DEFAULTS, type BotStatus } from "@siela/shared";
import { pingDatabase, type DatabaseHandle, type TempVoiceChannelRow } from "@siela/db";
import type { BotConfig } from "@siela/config";
import { commands } from "./commands/index.js";
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
import { buildMusicPayload } from "./features/music-ui.js";
import { LyricsService } from "./features/lyrics.js";
import { buildLyricsPayload } from "./features/lyrics-ui.js";
import { TambolaService } from "./features/tambola/service.js";
import { TtsService } from "./features/tts.js";
import { EconomyService } from "./features/economy.js";
import { EMOJI, card, confirmCard } from "./features/ui.js";
import { PrivacyService } from "./features/privacy.js";
import { buildHelpPayload } from "./features/help.js";
import { ControlServer } from "./control/server.js";
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
  private readonly valkey: ValkeyService;
  private readonly randomVc: RandomVcService;
  private readonly scheduledEvents: ScheduledEventService;
  private guildId: string | null = null;
  private initializedGuildId: string | null = null;
  private music: MusicService | null = null;
  private stopping = false;

  constructor(
    private readonly config: BotConfig,
    private readonly dbHandle: DatabaseHandle,
    private readonly logger: Logger,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User],
      allowedMentions: { parse: [], repliedUser: false },
    });
    this.registry = new CommandRegistry().register(...commands);
    const settings = new SettingsService(this.dbHandle.db);
    const counters = new CounterService(this.dbHandle.db);
    this.valkey = new ValkeyService(this.config.VALKEY_URL ?? null, this.logger);
    const economy = new EconomyService(this.dbHandle.db, this.valkey, this.logger);
    const friendship = new FriendshipService(this.dbHandle.db, this.logger, this.valkey);
    const lyrics = new LyricsService(this.logger);
    const confession = new ConfessionService(this.dbHandle.db, settings, this.client, this.logger);
    const tempVc = new TempVcService(this.client, this.dbHandle.db, settings, this.logger, this.config.adminRoleIds);
    const music = new MusicService(
      this.client,
      {
        backend: this.config.MUSIC_BACKEND,
        ytdlpPath: this.config.YTDLP_PATH,
        mpvPath: this.config.MPV_PATH,
        ffmpegPath: this.config.FFMPEG_PATH,
        settings,
      },
      this.logger,
      this.valkey,
    );
    this.music = music;
    const tambola = new TambolaService(this.client, music, this.config, this.logger, economy);
    const tts = new TtsService(music, this.config, this.logger);
    music.setVoiceBusyChecker((guildId) => tambola.isUsingVoice(guildId) || tts.isEnabled(guildId));
    const isVoiceBusy = (guildId: string): boolean => Boolean(tambola.get(guildId));
    this.randomVc = new RandomVcService(music, this.logger, isVoiceBusy);
    this.scheduledEvents = new ScheduledEventService(
      music,
      this.logger,
      this.config.EVENT_SCHEDULE_ENABLED,
      this.config.EVENT_PRAYER,
      isVoiceBusy,
    );
    const activity = new ActivityService(this.dbHandle.db, friendship, tempVc, music, this.logger);
    const leveling = new LevelingService(this.dbHandle.db, settings, this.client, this.logger);
    activity.leveling = leveling;
    this.services = {
      config: this.config,
      registry: this.registry,
      settings,
      audit: new AuditService(this.dbHandle.db, this.logger),
      activity,
      leveling,
      counters,
      welcome: new WelcomeService(settings, this.logger),
      autoRole: new AutoRoleService(settings, this.logger),
      bias: new BiasService(this.dbHandle.db),
      family: new FamilyService(this.dbHandle.db, this.logger),
      delulu: new DeluluService(this.config.LLM_URL ?? null, this.config.HF_TOKEN ?? null, this.logger),
      birthday: new BirthdayService(this.dbHandle.db, settings, this.client, this.logger),
      confession,
      friendship,
      tempVc,
      privacy: new PrivacyService(this.dbHandle.db, counters, economy, activity, friendship),
      music,
      lyrics,
      tambola,
      tts,
      economy,
      scheduledEvents: this.scheduledEvents,
    };
    this.controlServer = new ControlServer({
      services: this.services,
      client: this.client,
      token: this.config.MCP_TOKEN,
      logger: this.logger,
      getStatus: () => this.status(),
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
    this.registerEvents();
    await this.valkey.start();
    this.services.friendship.start();
    await Promise.all([
      this.controlServer.start(this.config.CONTROL_API_HOST, this.config.CONTROL_API_PORT),
      this.healthServer.start(),
    ]);
    await this.client.login(this.config.DISCORD_TOKEN);
    this.logger.info({ user: this.client.user?.tag }, "bot logged in");
  }

  private registerEvents(): void {
    this.client.once(Events.ClientReady, () => void this.onReady());
    this.client.on(Events.GuildCreate, (guild) => void this.onGuildCreate(guild));
    this.client.on(Events.GuildDelete, (guild) => {
      if (guild.id === this.guildId) this.logger.warn({ guildId: guild.id }, "bound guild removed");
    });
    this.client.on(Events.MessageCreate, (message) => void this.onMessage(message));
    this.client.on(Events.MessageReactionAdd, (reaction, user) => void this.onReactionAdd(reaction, user));
    this.client.on(Events.InteractionCreate, (interaction) => void this.onInteraction(interaction));
    this.client.on(Events.GuildMemberAdd, (member) => void this.onMemberAdd(member));
    this.client.on(Events.GuildMemberRemove, (member) => void this.onMemberRemove(member));
    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => void this.onVoiceState(oldState, newState));
    this.client.on(Events.ChannelDelete, (channel) => {
      if (channel.type === ChannelType.GuildVoice) void this.services.tempVc.onChannelDelete(channel.id);
      this.services.tambola.onChannelDelete(channel.id);
    });
    this.client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
      if (newChannel.type === ChannelType.GuildVoice) {
        void this.services.tempVc.onChannelUpdate(oldChannel.id, newChannel);
      }
    });
    this.client.on(Events.Error, (error) => this.logger.error({ err: error }, "discord client error"));
    this.client.on(Events.Warn, (warning) => this.logger.warn({ warning }, "discord client warning"));
  }

  private async onReady(): Promise<void> {
    this.logger.info({ guilds: this.client.guilds.cache.size }, "gateway ready");
    const guild = this.resolveGuild();
    if (guild) {
      await this.initGuild(guild);
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
      this.logger.warn({ guildId: guild.id, configuredGuildId: this.config.guildId }, "leaving unconfigured guild");
      await guild.leave().catch(() => undefined);
      return;
    }
    if (!this.guildId) {
      await this.initGuild(guild);
      return;
    }
    if (guild.id !== this.guildId) {
      this.logger.warn({ guildId: guild.id, boundGuildId: this.guildId }, "leaving unbound guild");
      await guild.leave().catch(() => undefined);
    }
  }

  private async initGuild(guild: Guild): Promise<void> {
    if (this.initializedGuildId === guild.id) return;
    this.guildId = guild.id;
    this.initializedGuildId = guild.id;
    await this.services.settings.ensure(guild.id);
    await this.registerCommands(guild);
    await this.services.tempVc.reconcile(guild).catch((error) => this.logger.warn({ err: error }, "temp VC reconcile failed"));
    await this.services.activity.purgeOld().catch((error) => this.logger.warn({ err: error }, "activity purge failed"));
    await this.services.activity.reconcile(guild).catch((error) => this.logger.warn({ err: error }, "activity reconcile failed"));
    await this.services.leveling.reconcile(guild).catch((error) => this.logger.warn({ err: error }, "leveling reconcile failed"));
    this.services.activity.start();
    this.randomVc.start(guild);
    this.scheduledEvents.start(guild);
    this.services.birthday.start();
    await this.client.user?.setPresence({
      activities: [{ name: `${guild.name} • ${DEFAULTS.prefix}help`, type: ActivityType.Watching }],
      status: "online",
    });
    this.logger.info({ guildId: guild.id }, "guild initialized");
  }

  private async registerCommands(guild: Guild): Promise<void> {
    const slash = this.registry.slashCommands();
    await guild.commands.set(slash);
    this.logger.info({ count: slash.length }, "guild commands registered");
  }

  private async onMessage(message: Message): Promise<void> {
    try {
      if (message.author.bot || !message.inGuild() || message.webhookId) return;
      if (!this.guildId || message.guild.id !== this.guildId) return;
      this.services.activity.recordMessage(message.guild.id, message.author.id);
      void this.services.leveling.awardMessage(message.guild.id, message.author.id).catch(() => undefined);
      if (this.services.tts.isEnabledChannel(message.guild.id, message.channel.id)) {
        if (!message.content.startsWith("/") && !message.content.startsWith("!")) {
          void this.services.tts.speak(message.guild.id, message.content).catch(() => undefined);
        }
      }
      const prefix = await this.services.settings.getPrefix(message.guild.id);
      const parsed = parsePrefixCommand(message.content, prefix, this.client.user?.id ?? "");
      if (!parsed) return;
      const command = this.registry.get(parsed.name);
      if (!command) {
        const now = Date.now();
        for (const [userId, timestamp] of this.unknownCommandNotices) {
          if (now - timestamp > 15_000) this.unknownCommandNotices.delete(userId);
        }
        const last = this.unknownCommandNotices.get(message.author.id) ?? 0;
        if (now - last > 15_000) {
          this.unknownCommandNotices.set(message.author.id, now);
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
      this.services.activity.recordCommand(message.guild.id, message.author.id);
      void (async () => {
        const allowed = await this.services.economy.rateLimit(`command:${message.guild.id}:${message.author.id}`, 5, 60 * 60 * 1000).catch(() => true);
        if (allowed) await this.services.economy.award(message.guild.id, message.author.id, 1, "command", message.id).catch(() => undefined);
      })();
    } catch (error) {
      await this.handleCommandError(message, error);
    }
  }

  private async onReactionAdd(reaction: any, user: any): Promise<void> {
    try {
      if (user?.bot) return;
      let guildId: string | null = null;
      if (reaction.message?.guildId) guildId = reaction.message.guildId;
      else if (reaction.partial) {
        const fetched = await reaction.fetch().catch(() => null);
        guildId = fetched?.message?.guildId ?? null;
      }
      if (!guildId || guildId !== this.guildId) return;
      this.services.activity.recordReaction(guildId, user.id);
      void this.services.leveling.awardReaction(guildId, user.id).catch(() => undefined);
    } catch {
      // ignore reaction tracking failures
    }
  }

  private async onInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await this.onChatInput(interaction);
        return;
      }
      if (
        (interaction.isButton() ||
          interaction.isStringSelectMenu() ||
          interaction.isChannelSelectMenu()) &&
        interaction.customId.startsWith("tambola:")
      ) {
        await this.services.tambola.handleInteraction(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith("economy:bj:")) {
        await this.services.economy.handleBlackjackInteraction(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith("music:")) {
        await this.onMusicButton(interaction);
        return;
      }
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith("music:filter:")) {
        await this.onMusicFilterSelect(interaction);
        return;
      }
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith("music:more:")) {
        await this.onMusicMoreSelect(interaction);
        return;
      }
      if ((interaction.isButton() || interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) && interaction.customId.startsWith("tempvc:")) {
        await this.onTempVcComponent(interaction);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith("tempvc:")) {
        await this.onTempVcModal(interaction);
        return;
      }
      if (interaction.isStringSelectMenu() && interaction.customId === "help:category") {
        await this.onHelpSelect(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId === "help:close") {
        await interaction.update({ content: "Help closed.", embeds: [], components: [] }).catch(() => undefined);
      }
    } catch (error) {
      this.logger.error({ err: error }, "interaction error");
      if (interaction.isRepliable() && !interaction.replied) {
        await interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => undefined);
      }
    }
  }

  private async onChatInput(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) return;
    if (!this.guildId || interaction.guild!.id !== this.guildId) return;
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
    this.services.activity.recordCommand(interaction.guild!.id, interaction.user.id);
    void this.services.leveling.awardCommand(interaction.guild!.id, interaction.user.id).catch(() => undefined);
    void (async () => {
      const allowed = await this.services.economy.rateLimit(`command:${interaction.guild!.id}:${interaction.user.id}`, 5, 60 * 60 * 1000).catch(() => true);
      if (allowed) await this.services.economy.award(interaction.guild!.id, interaction.user.id, 1, "command", interaction.id).catch(() => undefined);
    })();
  }

  private async onHelpSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return;
    const prefix = await this.services.settings.getPrefix(guild.id);
    const payload = await buildHelpPayload({
      registry: this.registry,
      member,
      config: this.config,
      prefix,
      category: interaction.values[0],
    });
    await interaction.update({
      components: payload.components,
      flags: payload.flags,
    });
  }

  private async onMusicButton(interaction: ButtonInteraction): Promise<void> {
    const [prefix, action, guildId] = interaction.customId.split(":");
    if (prefix !== "music" || !action || !guildId) return;
    await this.handleMusicAction(interaction, action, guildId);
  }

  private async onMusicMoreSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [prefix, kind, guildId] = interaction.customId.split(":");
    if (prefix !== "music" || kind !== "more" || !guildId) return;
    const action = interaction.values[0];
    if (!action) return;
    await this.handleMusicAction(interaction, action, guildId);
  }

  private async handleMusicAction(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    action: string,
    guildId: string,
  ): Promise<void> {
    if (!this.guildId || guildId !== this.guildId) return;
    const guild = interaction.guild;
    if (!guild) return;
    const music = this.services.music;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!music || !member) return;

    const replyError = async (message: string): Promise<void> => {
      if (interaction.deferred) {
        await interaction.editReply({ content: message }).catch(() => undefined);
      } else if (!interaction.replied) {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
      } else {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => undefined);
      }
    };

    const channelId = music.channelId(guild.id);
    const state = music.state(guild.id);
    if (action === "lyrics") {
      if (!state?.current) return replyError("Nothing is playing.");
      await interaction.deferReply();
      try {
        const result = await this.services.lyrics.forTrack(state.current);
        await interaction.editReply(buildLyricsPayload(state.current, result));
      } catch (error) {
        const message = error instanceof UserError ? error.message : "Could not fetch lyrics.";
        await interaction
          .editReply(card({ title: "Lyrics", body: message }))
          .catch(() => undefined);
      }
      return;
    }
    if (!channelId) return replyError("The bot is not in a voice channel.");
    if (member.voice.channelId !== channelId) return replyError("Join the bot's voice channel first.");
    if (!state?.current) return replyError("Nothing is playing.");

    try {
      if (action === "pause") {
        if (state.paused) await music.resume(guild.id);
        else await music.pause(guild.id);
        await interaction.update(buildMusicPayload(guild.id, music.state(guild.id)));
        return;
      }
      if (action === "rewind" || action === "forward") {
        await interaction.deferUpdate();
        const delta = action === "rewind" ? -10_000 : 10_000;
        await music.seek(guild.id, state.position + delta);
        await interaction.editReply(buildMusicPayload(guild.id, music.state(guild.id)));
        return;
      }
      if (action === "skip") {
        await interaction.deferUpdate();
        await music.skip(guild.id);
        await interaction.editReply(buildMusicPayload(guild.id, music.state(guild.id)));
        return;
      }
      if (action === "shuffle") {
        await interaction.deferUpdate();
        await music.shuffle(guild.id);
        await interaction.editReply(buildMusicPayload(guild.id, music.state(guild.id)));
        return;
      }
      if (action === "loop") {
        const next = state.loop === "off" ? "track" : state.loop === "track" ? "queue" : "off";
        await interaction.deferUpdate();
        await music.loop(guild.id, next);
        await interaction.editReply(buildMusicPayload(guild.id, music.state(guild.id)));
        return;
      }
      if (action === "filter") {
        await interaction.reply({
          content: "Choose a filter preset:",
          ephemeral: true,
          components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`music:filter:${guild.id}`)
                .setPlaceholder("Choose a filter")
                .addOptions(
                  { label: "Off", value: "off", description: "No audio filter", emoji: EMOJI.off },
                  { label: "Bass boost", value: "bassboost", description: "Extra low end", emoji: EMOJI.bass },
                  { label: "Nightcore", value: "nightcore", description: "Faster and higher", emoji: EMOJI.nightcore },
                  { label: "Vaporwave", value: "vaporwave", description: "Slower and deeper", emoji: EMOJI.vaporwave },
                ),
            ),
          ],
        });
        return;
      }
      if (action === "stop") {
        await interaction.deferUpdate();
        await music.stop(guild.id);
        await music.disconnect(guild.id);
        await interaction.editReply(card({ title: "Stopped", body: "The player has been disconnected." }));
        return;
      }
      await replyError("Unknown music control.");
    } catch (error) {
      await replyError(error instanceof UserError ? error.message : "That music control failed.");
    }
  }

  private async onMusicFilterSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [prefix, kind, guildId] = interaction.customId.split(":");
    if (prefix !== "music" || kind !== "filter" || !guildId || !this.guildId || guildId !== this.guildId) return;
    const guild = interaction.guild;
    if (!guild) return;
    const music = this.services.music;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!music || !member) return;

    const errorReply = async (message: string): Promise<void> => {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
      } else {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => undefined);
      }
    };

    const channelId = music.channelId(guild.id);
    if (!channelId) return errorReply("The bot is not in a voice channel.");
    if (member.voice.channelId !== channelId) return errorReply("Join the bot's voice channel first.");
    if (!music.state(guild.id)?.current) return errorReply("Nothing is playing.");

    const value = interaction.values[0];
    if (value !== "off" && value !== "bassboost" && value !== "nightcore" && value !== "vaporwave") {
      return errorReply("Unknown filter preset.");
    }

    await interaction.deferUpdate();
    try {
      await music.filters(guild.id, value as MusicFilterPreset);
      music.refreshNowPlaying(guild.id);
      await interaction.editReply({ content: `Filter preset set to **${value}**.`, components: [] });
    } catch (error) {
      await interaction.editReply({
        content: error instanceof UserError ? error.message : "That filter could not be applied.",
        components: [],
      });
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
        .reply({ content: "That control panel does not belong to this channel.", ephemeral: true })
        .catch(() => undefined);
      return null;
    }
    const row = await this.services.tempVc.getRow(parsed.channelId);
    const channel = await guild.channels.fetch(parsed.channelId).catch(() => null);
    if (!row || row.status !== "active" || !channel || channel.type !== ChannelType.GuildVoice) {
      await interaction
        .reply({ content: "That temporary VC is no longer active.", ephemeral: true })
        .catch(() => undefined);
      return null;
    }
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return null;
    if (!canManageTempVc(member, row.ownerId, this.config)) {
      await interaction
        .reply({ content: "Only the channel owner or an admin can use these controls.", ephemeral: true })
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
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => undefined);
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
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
        guildId: interaction.guildId ?? this.guildId ?? "",
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
        await interaction.editReply(await this.services.tempVc.panelPayload(channelId));
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
        await interaction.reply({
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
        });
        return;
      }

      if (action === "delete-confirm") {
        await interaction.deferReply({ ephemeral: true });
        await this.services.tempVc.delete(channelId, "Owner deleted temporary VC from panel");
        await this.auditTempVcPanel(interaction, "vc.panel.delete", channelId);
        await interaction.editReply(card({ title: "Deleted", body: "Temporary VC deleted." })).catch(() => undefined);
        return;
      }

      if (action === "delete-cancel") {
        await interaction.update(card({ title: "Cancelled", body: "No changes were made." }));
        return;
      }

      if (action === "manage") {
        if (!interaction.isStringSelectMenu()) throw new UserError("Choose a management action.");
        const choice = interaction.values[0];
        await interaction.update(await this.services.tempVc.panelPayload(channelId));
        if (choice === "delete") {
          await interaction.followUp(
            confirmCard({
              title: "Delete this channel?",
              body: `This will delete **${channel.name}** and disconnect everyone in it.`,
              confirmId: tempVcPanelCustomId("delete-confirm", channelId),
              cancelId: tempVcPanelCustomId("delete-cancel", channelId),
              confirmLabel: "Delete",
            }),
          );
          return;
        }
        if (choice === "kick" || choice === "transfer") {
          await interaction.followUp({
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
          });
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
        await interaction.editReply({ content: `Kicked <@${targetId}> from the VC.` });
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
          card({ title: "Ownership transferred", body: `<@${targetId}> now owns this VC.` }),
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
        await interaction.editReply({ content: "Temporary VC renamed." });
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
        await interaction.editReply({ content: `User limit set to **${limit === 0 ? "unlimited" : limit}**.` });
        return;
      }

      throw new UserError("Unknown VC control.");
    } catch (error) {
      await this.replyTempVcError(interaction, error);
    }
  }

  private async guard(command: Command, ctx: CommandContext): Promise<boolean> {
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
      const key = `${command.name}:${ctx.author.id}`;
      const remaining = this.cooldowns.remaining(key, cooldown);
      if (remaining > 0) {
        await ctx.reply({ content: `Wait ${Math.ceil(remaining / 1000)}s before using that again.`, ephemeral: true });
        return false;
      }
      this.cooldowns.use(key);
    }
    return true;
  }

  private async handleCommandError(source: Message | CommandContext, error: unknown): Promise<void> {
    const requestId = randomUUID().slice(0, 8);
    const message = error instanceof UserError ? error.message : "Something went wrong.";
    this.logger.error({ err: error, requestId }, "command error");
    const content = `${message}${error instanceof UserError ? "" : ` Reference: \`${requestId}\``}`;
    if ("commandName" in source) {
      await (source as CommandContext).reply({ content, ephemeral: true }).catch(() => undefined);
    } else {
      await (source as Message).reply({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
    }
  }

  private async onMemberAdd(member: GuildMember): Promise<void> {
    if (member.guild.id !== this.guildId) return;
    await Promise.allSettled([
      this.services.welcome.onMemberJoin(member),
      this.services.autoRole.onMemberJoin(member),
    ]);
  }

  private async onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    if (member.guild.id !== this.guildId) return;
    this.services.tambola.onMemberRemove(member.guild.id, member.user.id);
    await Promise.allSettled([
      this.services.welcome.onMemberRemove(member),
      this.services.tempVc.onMemberRemove(member.guild, member.user.id),
    ]);
  }

  private async onVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.guild.id !== this.guildId) return;
    await this.services.activity.handleVoiceState(oldState, newState).catch((error) => {
      this.logger.warn({ err: error }, "activity voice handling failed");
    });
    await this.services.tempVc.handleVoiceState(oldState, newState).catch((error) => {
      this.logger.warn({ err: error }, "voice state handling failed");
    });
  }

  async status(): Promise<BotStatus> {
    const database = (await pingDatabase(this.dbHandle.db)) ? "up" : "down";
    const music = this.music ? await this.music.isUp().catch(() => false) : false;
    const activeTempVcs = this.guildId ? await this.services.tempVc.activeCount(this.guildId).catch(() => 0) : 0;
    return {
      ready: Boolean(this.client.isReady() && this.guildId),
      uptimeSeconds: Math.floor((this.client.uptime ?? 0) / 1000),
      gatewayPing: this.client.ws.ping >= 0 ? this.client.ws.ping : null,
      guildId: this.guildId,
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
    await Promise.allSettled([this.controlServer.stop(), this.healthServer.stop()]);
    if (this.music) await this.music.shutdown().catch(() => undefined);
    this.services.tambola.stop();
    this.services.tts.stop();
    this.services.tempVc.stop();
    this.randomVc.stop();
    this.scheduledEvents.stop();
    await this.services.activity.stop();
    await this.services.friendship.stop();
    await this.valkey.stop();
    this.services.birthday.stop();
    this.client.destroy();
    await this.dbHandle.close();
  }
}
