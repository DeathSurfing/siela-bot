import { PermissionFlagsBits, type Guild, type GuildMember, type Role } from "discord.js";
import { sleep } from "@siela/shared";
import type { SettingsService } from "./settings.js";
import type { Logger } from "../lib/logger.js";

const REJECT_PERMISSIONS = [
  ["Administrator", PermissionFlagsBits.Administrator],
  ["Manage Guild", PermissionFlagsBits.ManageGuild],
  ["Manage Roles", PermissionFlagsBits.ManageRoles],
  ["Ban Members", PermissionFlagsBits.BanMembers],
  ["Kick Members", PermissionFlagsBits.KickMembers],
] as const;

const WARN_PERMISSIONS = [
  ["Manage Channels", PermissionFlagsBits.ManageChannels],
  ["Manage Webhooks", PermissionFlagsBits.ManageWebhooks],
  ["Mention Everyone", PermissionFlagsBits.MentionEveryone],
  ["Moderate Members", PermissionFlagsBits.ModerateMembers],
] as const;

export interface AutoRoleValidation {
  validRoleIds: string[];
  errors: string[];
  warnings: string[];
}

export class AutoRoleService {
  constructor(
    private readonly settings: SettingsService,
    private readonly logger: Logger,
  ) {}

  async validateRoles(guild: Guild, roleIds: string[], invoker?: GuildMember): Promise<AutoRoleValidation> {
    const me = guild.members.me;
    const errors: string[] = [];
    const warnings: string[] = [];
    const validRoleIds: string[] = [];
    if (!me) {
      return { validRoleIds: [], errors: ["Bot member is not available"], warnings: [] };
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      errors.push("Bot is missing the Manage Roles permission");
    }

    for (const roleId of [...new Set(roleIds)]) {
      const role = guild.roles.cache.get(roleId);
      if (!role) {
        errors.push(`Role ${roleId} no longer exists`);
        continue;
      }
      if (role.id === guild.id) {
        errors.push("The @everyone role cannot be an auto-role");
        continue;
      }
      if (role.managed) {
        errors.push(`${role.name} is managed by an integration and cannot be assigned`);
        continue;
      }
      if (role.position >= me.roles.highest.position) {
        errors.push(`${role.name} is above the bot's highest role`);
        continue;
      }
      if (invoker && invoker.id !== guild.ownerId && role.position >= invoker.roles.highest.position) {
        errors.push(`${role.name} is above your highest role`);
        continue;
      }
      const rejected = REJECT_PERMISSIONS.filter(([, permission]) => role.permissions.has(permission));
      if (rejected.length) {
        errors.push(`${role.name} has dangerous permissions: ${rejected.map(([name]) => name).join(", ")}`);
        continue;
      }
      const warned = WARN_PERMISSIONS.filter(([, permission]) => role.permissions.has(permission));
      if (warned.length) {
        warnings.push(`${role.name} has elevated permissions: ${warned.map(([name]) => name).join(", ")}`);
      }
      validRoleIds.push(role.id);
    }

    if (validRoleIds.length > 10) errors.push("At most 10 auto-roles are allowed");
    return { validRoleIds: validRoleIds.slice(0, 10), errors, warnings };
  }

  private assignableRoles(guild: Guild, roleIds: string[]): Role[] {
    const me = guild.members.me;
    if (!me) return [];
    return roleIds
      .map((id) => guild.roles.cache.get(id))
      .filter((role): role is Role => Boolean(role))
      .filter((role) => !role.managed && role.id !== guild.id && role.position < me.roles.highest.position)
      .filter((role) => !REJECT_PERMISSIONS.some(([, permission]) => role.permissions.has(permission)));
  }

  async onMemberJoin(member: GuildMember): Promise<void> {
    const settings = await this.settings.getAutoRole(member.guild.id);
    if (!settings.enabled) return;
    if (member.user.bot && !settings.includeBots) return;
    if (settings.minAccountAgeDays > 0) {
      const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
      if (ageDays < settings.minAccountAgeDays) {
        this.logger.debug({ userId: member.id, ageDays }, "auto-role skipped: account too new");
        return;
      }
    }
    if (settings.delayMs > 0) await sleep(settings.delayMs);

    const roles = this.assignableRoles(member.guild, settings.roleIds);
    if (!roles.length) return;
    const missing = roles.filter((role) => !member.roles.cache.has(role.id));
    if (!missing.length) return;

    try {
      await member.roles.add(missing, "Siela auto-role");
    } catch (error) {
      this.logger.warn({ err: error, userId: member.id }, "auto-role assignment failed (partial)");
      // Try one-by-one so one bad role does not block the rest.
      for (const role of missing) {
        await member.roles.add(role, "Siela auto-role").catch((roleError) => {
          this.logger.warn({ err: roleError, roleId: role.id, userId: member.id }, "auto-role role failed");
        });
      }
    }
  }

  async sync(
    guild: Guild,
    dryRun: boolean,
  ): Promise<{ total: number; assigned: number; skipped: number; failed: number; dryRun: boolean }> {
    const settings = await this.settings.getAutoRole(guild.id);
    if (!settings.enabled) {
      return { total: 0, assigned: 0, skipped: 0, failed: 0, dryRun };
    }
    const roles = this.assignableRoles(guild, settings.roleIds);
    const roleIds = new Set(roles.map((role) => role.id));
    if (!roleIds.size) {
      return { total: 0, assigned: 0, skipped: 0, failed: 0, dryRun };
    }

    const members = await guild.members.fetch();
    let assigned = 0;
    let skipped = 0;
    let failed = 0;
    for (const member of members.values()) {
      if (member.user.bot && !settings.includeBots) {
        skipped += 1;
        continue;
      }
      const missing = roles.filter((role) => !member.roles.cache.has(role.id));
      if (!missing.length) {
        skipped += 1;
        continue;
      }
      if (dryRun) {
        assigned += 1;
        continue;
      }
      try {
        await member.roles.add(missing, "Siela auto-role sync");
        assigned += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn({ err: error, userId: member.id }, "auto-role sync failed");
      }
      await sleep(100);
    }
    return { total: members.size, assigned, skipped, failed, dryRun };
  }
}
