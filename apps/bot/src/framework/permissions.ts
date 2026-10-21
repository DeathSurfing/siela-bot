import { PermissionFlagsBits } from "discord.js";
import type { Guild, GuildBasedChannel, GuildMember } from "discord.js";
import type { BotConfig } from "@siela/config";

export function isAdmin(member: GuildMember, config: BotConfig, guild: Guild): boolean {
  if (config.botOwnerId && member.id === config.botOwnerId) return true;
  if (member.id === guild.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return config.adminRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

export function hasUserPermissions(member: GuildMember, permissions: bigint[]): boolean {
  return permissions.every((permission) => member.permissions.has(permission));
}

export function hasBotPermissions(guild: Guild, permissions: bigint[]): boolean {
  const me = guild.members.me;
  if (!me) return false;
  return permissions.every((permission) => me.permissions.has(permission));
}

export function isNsfwChannel(channel: GuildBasedChannel): boolean {
  if ("nsfw" in channel && typeof channel.nsfw === "boolean") return channel.nsfw;
  if (channel.isThread()) return channel.parent?.nsfw ?? false;
  return false;
}

export function canManageTempVc(member: GuildMember, ownerId: string, config: BotConfig): boolean {
  return member.id === ownerId || isAdmin(member, config, member.guild);
}

export function canManageMusic(member: GuildMember, djRoleIds: string[], config: BotConfig): boolean {
  if (!djRoleIds.length) return true;
  if (isAdmin(member, config, member.guild)) return true;
  return djRoleIds.some((roleId) => member.roles.cache.has(roleId));
}
