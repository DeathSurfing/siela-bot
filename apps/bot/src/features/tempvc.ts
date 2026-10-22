import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type CategoryChannel,
  type Client,
  type Guild,
  type GuildMember,
  type VoiceChannel,
  type VoiceState,
} from "discord.js";
import { and, eq, sql } from "drizzle-orm";
import { tempVoiceChannels, type Database, type TempVoiceChannelRow } from "@siela/db";
import { COLORS, renderTemplate, sanitizeChannelName, type TempVoiceChannel } from "@siela/shared";
import type { SettingsService } from "./settings.js";
import type { Logger } from "../lib/logger.js";
import { UserError } from "../lib/errors.js";
import type { ReplyPayload } from "../framework/types.js";
import { EMOJI, ICONS, UI_ACCENT, actionRow, separator, text } from "./ui.js";

const OWNER_ALLOW = {
  ViewChannel: true,
  Connect: true,
  ManageChannels: true,
  MoveMembers: true,
  MuteMembers: true,
  DeafenMembers: true,
  PrioritySpeaker: true,
  Speak: true,
  Stream: true,
  SendMessages: true,
  ReadMessageHistory: true,
  ManageMessages: true,
  AddReactions: true,
  AttachFiles: true,
  EmbedLinks: true,
} as const;

const BOT_ALLOW = {
  ViewChannel: true,
  Connect: true,
  ManageChannels: true,
  MoveMembers: true,
  Speak: true,
  Stream: true,
  SendMessages: true,
  ReadMessageHistory: true,
  ManageMessages: true,
  AddReactions: true,
  AttachFiles: true,
  EmbedLinks: true,
} as const;

export function tempVcPanelCustomId(action: string, channelId: string): string {
  return `tempvc:${action}:${channelId}`;
}

export function parseTempVcPanelCustomId(customId: string): { action: string; channelId: string } | null {
  const [prefix, action, channelId] = customId.split(":");
  if (prefix !== "tempvc" || !action || !channelId || !/^\d{17,20}$/.test(channelId)) return null;
  return { action, channelId };
}

export type TempVcPanelPayload = ReplyPayload;

export class TempVcService {
  private readonly creating = new Set<string>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly client: Client,
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
    private readonly adminRoleIds: string[] = [],
  ) {}

  private async activeByOwner(guildId: string, ownerId: string): Promise<TempVoiceChannelRow | null> {
    const [row] = await this.db
      .select()
      .from(tempVoiceChannels)
      .where(
        and(
          eq(tempVoiceChannels.guildId, guildId),
          eq(tempVoiceChannels.ownerId, ownerId),
          eq(tempVoiceChannels.status, "active"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async activeCount(guildId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(tempVoiceChannels)
      .where(and(eq(tempVoiceChannels.guildId, guildId), eq(tempVoiceChannels.status, "active")));
    return Number(row?.count ?? 0);
  }

  async getRow(channelId: string): Promise<TempVoiceChannelRow | null> {
    const [row] = await this.db
      .select()
      .from(tempVoiceChannels)
      .where(eq(tempVoiceChannels.channelId, channelId))
      .limit(1);
    return row ?? null;
  }

  toDto(row: TempVoiceChannelRow): TempVoiceChannel {
    return {
      channelId: row.channelId,
      guildId: row.guildId,
      ownerId: row.ownerId,
      hubId: row.hubId,
      status: row.status as TempVoiceChannel["status"],
      locked: row.locked,
      userLimit: row.userLimit,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      lastEmptyAt: row.lastEmptyAt?.toISOString() ?? null,
    };
  }

  async list(guildId: string): Promise<TempVoiceChannel[]> {
    const rows = await this.db
      .select()
      .from(tempVoiceChannels)
      .where(and(eq(tempVoiceChannels.guildId, guildId), eq(tempVoiceChannels.status, "active")));
    return rows.map((row) => this.toDto(row));
  }

  private panelPayloadFor(channel: VoiceChannel, row: TempVoiceChannelRow): TempVcPanelPayload {
    const status = row.locked ? "Locked" : "Open";
    const limit = row.userLimit === 0 ? "unlimited" : String(row.userLimit);
    const memberCount = [...channel.members.values()].filter((member) => !member.user.bot).length;
    const container = new ContainerBuilder()
      .setAccentColor(UI_ACCENT)
      .addTextDisplayComponents(text(`## ${channel.name}`))
      .addTextDisplayComponents(
        text(`-# <@${row.ownerId}> · ${status} · ${memberCount}/${limit} members`),
      )
      .addSeparatorComponents(separator())
      .addActionRowComponents(
        actionRow(
          new ButtonBuilder()
            .setCustomId(tempVcPanelCustomId("lock", row.channelId))
            .setLabel(row.locked ? "Unlock" : "Lock")
            .setEmoji(row.locked ? EMOJI.unlock : EMOJI.lock)
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(tempVcPanelCustomId("rename", row.channelId))
            .setLabel("Rename")
            .setEmoji(EMOJI.rename)
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(tempVcPanelCustomId("limit", row.channelId))
            .setLabel("Limit")
            .setEmoji(EMOJI.limit)
            .setStyle(ButtonStyle.Secondary),
        ),
      )
      .addActionRowComponents(
        actionRow(
          new StringSelectMenuBuilder()
            .setCustomId(tempVcPanelCustomId("manage", row.channelId))
            .setPlaceholder(`${ICONS.more} Manage members…`)
            .addOptions(
              { label: "Kick member", value: "kick", description: "Remove someone from this VC", emoji: EMOJI.kick },
              { label: "Transfer ownership", value: "transfer", description: "Give this VC to another member", emoji: EMOJI.transfer },
              { label: "Delete channel", value: "delete", description: "Delete this temporary VC", emoji: EMOJI.delete },
            ),
        ),
      );
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  async panelPayload(channelId: string): Promise<TempVcPanelPayload> {
    const { channel, row } = await this.requireChannel(channelId);
    return this.panelPayloadFor(channel, row);
  }

  async ensurePanel(channelId: string): Promise<void> {
    const { channel, row } = await this.requireChannel(channelId);
    const payload = this.panelPayloadFor(channel, row);
    const messages = await channel.messages.fetch({ limit: 100 }).catch((error) => {
      this.logger.warn({ err: error, channelId }, "temp VC panel history unavailable");
      return null;
    });
    const marker = tempVcPanelCustomId("lock", channelId);
    const existing = messages?.find(
      (message) =>
        message.author.id === this.client.user?.id &&
        message.components.some((component) => JSON.stringify(component.toJSON()).includes(marker)),
    );
    if (existing) {
      await existing.edit(payload).catch((error) => {
        this.logger.warn({ err: error, channelId }, "temp VC panel edit failed");
        throw error;
      });
      return;
    }
    const sent = await channel.send(payload).catch((error) => {
      this.logger.warn({ err: error, channelId }, "temp VC panel send failed");
      throw error;
    });
    await sent.pin().catch((error) => {
      this.logger.debug({ err: error, channelId }, "temp VC panel could not be pinned");
    });
  }

  async refreshPanel(channelId: string): Promise<void> {
    await this.ensurePanel(channelId);
  }

  async handleVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;
    const settings = await this.settings.getTempVc(guild.id);
    if (!settings.enabled || !settings.hubChannelId) return;

    if (newState.channelId === settings.hubChannelId && oldState.channelId !== settings.hubChannelId) {
      const member = newState.member;
      if (member && !member.user.bot) {
        await this.ensureChannel(member, settings).catch((error) => {
          this.logger.warn({ err: error, userId: member.id }, "temp VC creation failed");
          member.send({ content: "Could not create your temporary voice channel. Please try again." }).catch(() => undefined);
        });
      }
    }

    if (oldState.channelId && oldState.channelId !== settings.hubChannelId) {
      const row = await this.getRow(oldState.channelId);
      if (row?.status === "active") {
        // Check immediately on every leave. cleanupIfEmpty still returns without
        // deleting when someone else is present.
        this.scheduleCleanup(guild, oldState.channelId, 0, true);
      }
    }
  }

  private async ensureChannel(
    member: GuildMember,
    settings: Awaited<ReturnType<SettingsService["getTempVc"]>>,
  ): Promise<void> {
    if (this.creating.has(member.id)) return;
    this.creating.add(member.id);
    try {
      const existing = await this.activeByOwner(member.guild.id, member.id);
      if (existing) {
        const channel = member.guild.channels.cache.get(existing.channelId);
        if (channel?.type === ChannelType.GuildVoice) {
          await member.voice.setChannel(channel, "Temporary VC rejoin");
          await this.ensurePanel(channel.id).catch((error) => {
            this.logger.debug({ err: error, channelId: channel.id }, "temp VC panel refresh failed");
          });
          return;
        }
        await this.markDeleted(existing.channelId);
      }

      const active = await this.activeCount(member.guild.id);
      if (active >= settings.maxChannels) {
        throw new UserError("The temporary VC limit has been reached. Try again later.");
      }

      const category = settings.categoryId
        ? member.guild.channels.cache.get(settings.categoryId)
        : null;
      if (category && category.type !== ChannelType.GuildCategory) {
        throw new UserError("The configured temp VC category is invalid.");
      }

      const name = sanitizeChannelName(
        renderTemplate(settings.nameTemplate, {
          user: member.user.username,
          username: member.user.username,
          displayName: member.displayName,
          mention: "",
          server: member.guild.name,
          memberCount: member.guild.memberCount,
        }),
        `${member.user.username}'s VC`,
      );

      const channel = await member.guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: category?.id,
        userLimit: settings.defaultUserLimit,
        reason: `Temporary VC for ${member.user.tag}`,
      });

      try {
        const everyone = member.guild.roles.everyone;
        await channel.permissionOverwrites.create(everyone, {
          ViewChannel: true,
          Connect: !settings.defaultLocked,
          MoveMembers: false,
        });
        await channel.permissionOverwrites.create(member, OWNER_ALLOW);
        if (this.client.user) await channel.permissionOverwrites.create(this.client.user, BOT_ALLOW);
        await this.applyMovePermissions(channel, member.id);
        await this.db.insert(tempVoiceChannels).values({
          channelId: channel.id,
          guildId: member.guild.id,
          ownerId: member.id,
          hubId: settings.hubChannelId!,
          locked: settings.defaultLocked,
          userLimit: settings.defaultUserLimit,
          status: "active",
        });
        await member.voice.setChannel(channel, "Temporary VC created");
        await this.ensurePanel(channel.id).catch((error) => {
          this.logger.debug({ err: error, channelId: channel.id }, "temp VC panel creation failed");
        });
      } catch (error) {
        await channel.delete("Temporary VC creation failed").catch(() => undefined);
        throw error;
      }
    } finally {
      this.creating.delete(member.id);
    }
  }

  async lock(channelId: string, actorId: string): Promise<void> {
    const { channel, row } = await this.requireChannel(channelId);
    await channel.permissionOverwrites.create(channel.guild.roles.everyone, {
      ViewChannel: true,
      Connect: false,
      MoveMembers: false,
    });
    await this.db
      .update(tempVoiceChannels)
      .set({ locked: true })
      .where(eq(tempVoiceChannels.channelId, channelId));
    this.logger.info({ channelId, actorId, row: row.ownerId }, "temp VC locked");
  }

  async unlock(channelId: string, actorId: string): Promise<void> {
    const { channel } = await this.requireChannel(channelId);
    await channel.permissionOverwrites.create(channel.guild.roles.everyone, {
      ViewChannel: true,
      Connect: true,
      MoveMembers: false,
    });
    await this.db
      .update(tempVoiceChannels)
      .set({ locked: false })
      .where(eq(tempVoiceChannels.channelId, channelId));
    this.logger.info({ channelId, actorId }, "temp VC unlocked");
  }

  async permit(channelId: string, userId: string): Promise<void> {
    const { channel, guild } = await this.requireChannel(channelId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new UserError("That member is not in the server.");
    await channel.permissionOverwrites.create(member, {
      ViewChannel: true,
      Connect: true,
    });
  }

  async deny(channelId: string, userId: string): Promise<void> {
    const { channel, guild } = await this.requireChannel(channelId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new UserError("That member is not in the server.");
    await channel.permissionOverwrites.create(member, {
      Connect: false,
    });
    if (member.voice.channelId === channelId) {
      await member.voice.disconnect("Denied access to temporary VC").catch(() => undefined);
    }
  }

  async disconnect(channelId: string, userId: string): Promise<void> {
    const { channel, guild } = await this.requireChannel(channelId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new UserError("That member is not in the server.");
    if (member.voice.channelId !== channelId) throw new UserError("That member is not in this channel.");
    await member.voice.disconnect("Removed from temporary VC");
  }

  async rename(channelId: string, name: string): Promise<void> {
    const { channel } = await this.requireChannel(channelId);
    const safe = sanitizeChannelName(name);
    await channel.setName(safe, "Temporary VC renamed");
  }

  async setLimit(channelId: string, limit: number): Promise<void> {
    const { channel } = await this.requireChannel(channelId);
    const value = Math.max(0, Math.min(99, Math.trunc(limit)));
    await channel.setUserLimit(value, "Temporary VC limit");
    await this.db
      .update(tempVoiceChannels)
      .set({ userLimit: value })
      .where(eq(tempVoiceChannels.channelId, channelId));
  }

  async claim(channelId: string, claimantId: string): Promise<void> {
    const { channel, row, guild } = await this.requireChannel(channelId);
    const oldOwner = await guild.members.fetch(row.ownerId).catch(() => null);
    if (oldOwner?.voice.channelId === channelId) {
      throw new UserError("The owner is still in the channel.");
    }
    const claimant = await guild.members.fetch(claimantId).catch(() => null);
    if (!claimant) throw new UserError("That member is not in the server.");
    if (oldOwner) await channel.permissionOverwrites.delete(oldOwner).catch(() => undefined);
    await channel.permissionOverwrites.create(claimant, OWNER_ALLOW);
    await this.db
      .update(tempVoiceChannels)
      .set({ ownerId: claimant.id })
      .where(eq(tempVoiceChannels.channelId, channelId));
  }

  async transfer(channelId: string, newOwnerId: string): Promise<void> {
    const { channel, row, guild } = await this.requireChannel(channelId);
    if (newOwnerId === row.ownerId) throw new UserError("That member already owns the channel.");
    const oldOwner = await guild.members.fetch(row.ownerId).catch(() => null);
    const newOwner = await guild.members.fetch(newOwnerId).catch(() => null);
    if (!newOwner) throw new UserError("That member is not in the server.");
    if (newOwner.voice.channelId !== channelId) throw new UserError("The new owner must be in the channel.");
    if (oldOwner) await channel.permissionOverwrites.delete(oldOwner).catch(() => undefined);
    await channel.permissionOverwrites.create(newOwner, OWNER_ALLOW);
    await this.db
      .update(tempVoiceChannels)
      .set({ ownerId: newOwner.id })
      .where(eq(tempVoiceChannels.channelId, channelId));
  }

  async delete(channelId: string, reason = "Temporary VC deleted"): Promise<void> {
    const { channel } = await this.requireChannel(channelId);
    await channel.delete(reason);
    await this.markDeleted(channelId);
  }

  async markDeleted(channelId: string): Promise<void> {
    await this.db
      .update(tempVoiceChannels)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(tempVoiceChannels.channelId, channelId));
    const timer = this.cleanupTimers.get(channelId);
    if (timer) clearTimeout(timer);
    this.cleanupTimers.delete(channelId);
  }

  private async requireChannel(channelId: string): Promise<{
    channel: VoiceChannel;
    row: TempVoiceChannelRow;
    guild: Guild;
  }> {
    const row = await this.getRow(channelId);
    if (!row || row.status !== "active") throw new UserError("That is not an active temporary VC.");
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await this.markDeleted(channelId);
      throw new UserError("The temporary VC no longer exists.");
    }
    return { channel, row, guild: channel.guild };
  }

  private scheduleCleanup(guild: Guild, channelId: string, graceSeconds: number, replace = false): void {
    const existing = this.cleanupTimers.get(channelId);
    if (existing && !replace) return;
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(channelId);
      void this.cleanupIfEmpty(guild, channelId);
    }, Math.max(0, graceSeconds) * 1000);
    timer.unref?.();
    this.cleanupTimers.set(channelId, timer);
  }

  private async cleanupIfEmpty(guild: Guild, channelId: string): Promise<void> {
    const row = await this.getRow(channelId);
    if (!row || row.status !== "active") return;
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await this.markDeleted(channelId);
      return;
    }
    if (channel.members.size > 0) return;
    await this.db
      .update(tempVoiceChannels)
      .set({ lastEmptyAt: new Date() })
      .where(eq(tempVoiceChannels.channelId, channelId));
    await channel.delete("Temporary VC empty").catch(() => undefined);
    await this.markDeleted(channelId);
  }

  async reconcile(guild: Guild): Promise<void> {
    const settings = await this.settings.getTempVc(guild.id);
    if (!settings.enabled) return;
    const rows = await this.db
      .select()
      .from(tempVoiceChannels)
      .where(and(eq(tempVoiceChannels.guildId, guild.id), eq(tempVoiceChannels.status, "active")));
    for (const row of rows) {
      const channel = guild.channels.cache.get(row.channelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        await this.markDeleted(row.channelId);
      } else {
        await this.syncOverwrites(channel, row.ownerId);
        await this.ensurePanel(row.channelId).catch((error) => {
          this.logger.warn({ err: error, channelId: row.channelId }, "temp VC panel reconcile failed");
        });
        if (channel.members.size === 0) this.scheduleCleanup(guild, row.channelId, 0, true);
      }
    }
  }

  async onChannelDelete(channelId: string): Promise<void> {
    await this.markDeleted(channelId);
  }

  async onChannelUpdate(oldChannelId: string, newChannel: VoiceChannel): Promise<void> {
    const row = await this.getRow(oldChannelId);
    if (!row || row.status !== "active") return;
    await this.syncOverwrites(newChannel, row.ownerId);
    const safe = sanitizeChannelName(newChannel.name, "Private VC");
    if (safe !== newChannel.name) {
      await newChannel.setName(safe, "Sanitized temporary VC name").catch(() => undefined);
    }
  }

  async onMemberRemove(guild: Guild, userId: string): Promise<void> {
    const row = await this.activeByOwner(guild.id, userId);
    if (!row) return;
    const channel = guild.channels.cache.get(row.channelId);
    if (channel && channel.type === ChannelType.GuildVoice && channel.members.size === 0) {
      await channel.delete("Temporary VC owner left").catch(() => undefined);
    }
    await this.markDeleted(row.channelId);
  }

  private async applyMovePermissions(channel: VoiceChannel, ownerId: string): Promise<void> {
    const guild = channel.guild;
    const adminRoles = new Set(this.adminRoleIds);

    await channel.permissionOverwrites.create(guild.roles.everyone, { MoveMembers: false }).catch((error) => {
      this.logger.debug({ err: error, channelId: channel.id }, "could not deny @everyone MoveMembers");
    });

    for (const role of guild.roles.cache.values()) {
      if (role.id === guild.id || role.managed) continue;
      const isAdminRole =
        adminRoles.has(role.id) ||
        role.permissions.has(PermissionFlagsBits.Administrator) ||
        role.permissions.has(PermissionFlagsBits.ManageGuild);
      const hasMoveMembers = role.permissions.has(PermissionFlagsBits.MoveMembers);
      if (!isAdminRole && !hasMoveMembers) continue;
      await channel.permissionOverwrites
        .create(role, { MoveMembers: isAdminRole })
        .catch((error) => {
          this.logger.debug({ err: error, channelId: channel.id, roleId: role.id }, "could not set role MoveMembers");
        });
    }

    const owner = await guild.members.fetch(ownerId).catch(() => null);
    if (owner) await channel.permissionOverwrites.create(owner, { MoveMembers: true }).catch(() => undefined);

    const guildOwner = await guild.members.fetch(guild.ownerId).catch(() => null);
    if (guildOwner && guildOwner.id !== ownerId) {
      await channel.permissionOverwrites.create(guildOwner, { MoveMembers: true }).catch(() => undefined);
    }
  }

  private async syncOverwrites(channel: VoiceChannel, ownerId: string): Promise<void> {
    const guild = channel.guild;
    const owner = await guild.members.fetch(ownerId).catch(() => null);
    if (this.client.user) {
      await channel.permissionOverwrites.create(this.client.user, BOT_ALLOW).catch(() => undefined);
    }
    if (owner) await channel.permissionOverwrites.create(owner, OWNER_ALLOW).catch(() => undefined);
  }
}
