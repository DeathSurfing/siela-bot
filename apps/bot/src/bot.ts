import { randomUUID } from "node:crypto";
import {
  ActivityType,
  ApplicationCommandType,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageContextMenuCommandInteraction,
  type ChatInputCommandInteraction,
  type PartialGuildMember,
  type StringSelectMenuInteraction,
  type VoiceState,
} from "discord.js";
import { APP_VERSION, DEFAULTS, truncate, type BotStatus } from "@siela/shared";
import { pingDatabase, type DatabaseHandle } from "@siela/db";
import type { BotConfig } from "@siela/config";
import { commands } from "./commands/index.js";
import { CommandRegistry } from "./framework/registry.js";
import { CooldownManager } from "./framework/cooldowns.js";
import { parsePrefixCommand } from "./framework/prefix.js";
import { argsFromInteraction, rawArgsFromInteraction } from "./framework/slash.js";
import {
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
import { TempVcService } from "./features/tempvc.js";
import { TranslationService } from "./features/translation.js";
import { MusicService } from "./features/music.js";
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
      partials: [Partials.Channel, Partials.GuildMember],
      allowedMentions: { parse: [], repliedUser: false },
    });
    this.registry = new CommandRegistry().register(...commands);
    const settings = new SettingsService(this.dbHandle.db);
    const counters = new CounterService(this.dbHandle.db);
    this.services = {
      config: this.config,
      registry: this.registry,
      settings,
      audit: new AuditService(this.dbHandle.db, this.logger),
      counters,
      welcome: new WelcomeService(settings, this.logger),
      autoRole: new AutoRoleService(settings, this.logger),
      tempVc: new TempVcService(this.client, this.dbHandle.db, settings, this.logger),
      translation: new TranslationService(this.config.LIBRETRANSLATE_URL, undefined, this.logger),
      privacy: new PrivacyService(counters),
      music: null,
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
    this.client.on(Events.InteractionCreate, (interaction) => void this.onInteraction(interaction));
    this.client.on(Events.GuildMemberAdd, (member) => void this.onMemberAdd(member));
    this.client.on(Events.GuildMemberRemove, (member) => void this.onMemberRemove(member));
    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => void this.onVoiceState(oldState, newState));
    this.client.on(Events.ChannelDelete, (channel) => {
      if (channel.type === ChannelType.GuildVoice) void this.services.tempVc.onChannelDelete(channel.id);
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
    this.music = new MusicService(
      this.client,
      { url: this.config.LAVALINK_URL, password: this.config.LAVALINK_PASSWORD, guildId: guild.id, settings: this.services.settings },
      this.logger,
    );
    this.services.music = this.music;
    await this.registerCommands(guild);
    await this.services.tempVc.reconcile(guild).catch((error) => this.logger.warn({ err: error }, "temp VC reconcile failed"));
    await this.client.user?.setPresence({
      activities: [{ name: `${guild.name} • ${DEFAULTS.prefix}help`, type: ActivityType.Watching }],
      status: "online",
    });
    this.logger.info({ guildId: guild.id }, "guild initialized");
  }

  private async registerCommands(guild: Guild): Promise<void> {
    const slash = this.registry.slashCommands();
    await guild.commands.set(slash);
    if (this.client.application) {
      await this.client.application.commands.set([]).catch(() => undefined);
      await guild.commands
        .create({ name: "Translate to English", type: ApplicationCommandType.Message })
        .catch((error) => this.logger.warn({ err: error }, "context menu registration failed"));
    }
    this.logger.info({ count: slash.length }, "guild commands registered");
  }

  private async onMessage(message: Message): Promise<void> {
    try {
      if (message.author.bot || !message.inGuild() || message.webhookId) return;
      if (!this.guildId || message.guild.id !== this.guildId) return;
      const prefix = await this.services.settings.getPrefix(message.guild.id);
      const parsed = parsePrefixCommand(message.content, prefix, this.client.user?.id ?? "");
      if (!parsed) return;
      const command = this.registry.get(parsed.name);
      if (!command) {
        const now = Date.now();
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
    } catch (error) {
      await this.handleCommandError(message, error);
    }
  }

  private async onInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await this.onChatInput(interaction);
        return;
      }
      if (interaction.isMessageContextMenuCommand()) {
        await this.onMessageContextMenu(interaction);
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
    if (!this.guildId || interaction.guild.id !== this.guildId) return;
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
    await command.execute(ctx);
  }

  private async onMessageContextMenu(interaction: MessageContextMenuCommandInteraction): Promise<void> {
    if (interaction.commandName !== "Translate to English") return;
    if (!interaction.inGuild() || !interaction.guild) return;
    const remaining = this.services.translation.checkRateLimit(interaction.user.id);
    if (remaining > 0) {
      await interaction.reply({
        content: `Please wait ${Math.ceil(remaining / 1000)}s before translating again.`,
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply();
    try {
      const source = this.services.translation.extractText(interaction.targetMessage);
      if (!source) throw new UserError("That message has no translatable text.");
      const result = await this.services.translation.translate(source);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x8b5cf6)
            .setTitle("Translation → English")
            .addFields(
              { name: "Original", value: truncate(result.original, 1_000) },
              { name: "English", value: truncate(result.translated, 1_000) },
            )
            .setFooter({ text: result.detectedSource ? `Detected: ${result.detectedSource}` : "LibreTranslate" }),
        ],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      await interaction.editReply({ content: error instanceof Error ? error.message : "Translation failed." });
    }
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
      embeds: payload.embeds,
      components: payload.components,
    });
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
    await Promise.allSettled([
      this.services.welcome.onMemberRemove(member),
      this.services.tempVc.onMemberRemove(member.guild, member.user.id),
    ]);
  }

  private async onVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.guild.id !== this.guildId) return;
    await this.services.tempVc.handleVoiceState(oldState, newState).catch((error) => {
      this.logger.warn({ err: error }, "voice state handling failed");
    });
  }

  async status(): Promise<BotStatus> {
    const database = (await pingDatabase(this.dbHandle.db)) ? "up" : "down";
    const translation = (await this.services.translation.health().catch(() => false)) ? "up" : "down";
    const activeTempVcs = this.guildId ? await this.services.tempVc.activeCount(this.guildId).catch(() => 0) : 0;
    return {
      ready: Boolean(this.client.isReady() && this.guildId),
      uptimeSeconds: Math.floor((this.client.uptime ?? 0) / 1000),
      gatewayPing: this.client.ws.ping >= 0 ? this.client.ws.ping : null,
      guildId: this.guildId,
      database,
      lavalink: this.music ? (this.music.isUp() ? "up" : "down") : "unknown",
      translation,
      activePlayers: this.music ? this.music.shoukaku.players.size : 0,
      activeTempVcs,
      version: APP_VERSION,
    };
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await Promise.allSettled([this.controlServer.stop(), this.healthServer.stop()]);
    if (this.guildId && this.music) await this.music.disconnect(this.guildId).catch(() => undefined);
    this.client.destroy();
    await this.dbHandle.close();
  }
}
