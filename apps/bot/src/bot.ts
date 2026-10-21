import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Interaction,
  type Message,
  type MessageReaction,
  type ModalSubmitInteraction,
  type PartialMessageReaction,
  type ChatInputCommandInteraction,
  type PartialGuildMember,
  type PartialUser,
  type User,
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
import { parseTempVcPanelCustomId, tempVcPanelCustomId, TempVcService } from "./features/tempvc.js";

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
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User],
      allowedMentions: { parse: [], repliedUser: false },
    });
    this.registry = new CommandRegistry().register(...commands);
    const settings = new SettingsService(this.dbHandle.db);
    const counters = new CounterService(this.dbHandle.db);
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
    );
    this.music = music;
    this.services = {
      config: this.config,
      registry: this.registry,
      settings,
      audit: new AuditService(this.dbHandle.db, this.logger),
      counters,
      welcome: new WelcomeService(settings, this.logger),
      autoRole: new AutoRoleService(settings, this.logger),
      tempVc: new TempVcService(this.client, this.dbHandle.db, settings, this.logger),
      privacy: new PrivacyService(counters),
      music,
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
    this.client.on(Events.MessageReactionAdd, (reaction, user) => void this.onReaction(reaction, user));
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
      if ((interaction.isButton() || interaction.isUserSelectMenu()) && interaction.customId.startsWith("tempvc:")) {
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

  private async requireTempVcPanelAccess(
    interaction: ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
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
    interaction: ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
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
    interaction: ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
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
    interaction: ButtonInteraction | UserSelectMenuInteraction,
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
        await interaction.editReply({ content: "Temporary VC deleted.", components: [] }).catch(() => undefined);
        return;
      }

      if (action === "delete-cancel") {
        await interaction.update({ content: "Delete cancelled.", embeds: [], components: [] });
        return;
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
        await interaction.editReply(await this.services.tempVc.panelPayload(channelId));
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

  private async onReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    if (user.bot) return;
    try {
      if (reaction.partial) await reaction.fetch();
      const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
      if (!message.guildId || message.guildId !== this.guildId) return;
      const member = await message.guild?.members.fetch(user.id).catch(() => null);
      if (!member) return;
      const handled = await this.services.music?.handleControlReaction(
        message.id,
        reaction.emoji.name ?? "",
        member,
      );
      if (handled) await reaction.users.remove(user.id).catch(() => undefined);
    } catch (error) {
      this.logger.debug({ err: error, messageId: reaction.message.id }, "reaction control failed");
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
    this.client.destroy();
    await this.dbHandle.close();
  }
}
