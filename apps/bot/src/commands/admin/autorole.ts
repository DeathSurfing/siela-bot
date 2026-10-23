import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { card } from "../../features/ui.js";

function normalizeRoleId(value: string | undefined): string | undefined {
  return value?.replace(/^<@&|>$/g, "");
}

function bool(value: string | undefined): boolean {
  if (value === "on" || value === "true" || value === "yes") return true;
  if (value === "off" || value === "false" || value === "no") return false;
  throw new Error("Use `on` or `off`.");
}

function configCard(settings: Awaited<ReturnType<CommandContext["services"]["settings"]["getAutoRole"]>>) {
  return card({
    title: "Auto-role",
    body: [
      `**Enabled** · ${settings.enabled ? "On" : "Off"}`,
      `**Include bots** · ${settings.includeBots ? "On" : "Off"}`,
      `**Minimum account age** · ${settings.minAccountAgeDays} days`,
      `**Delay** · ${settings.delayMs}ms`,
      `**Roles** · ${settings.roleIds.length ? settings.roleIds.map((id) => `<@&${id}>`).join(", ") : "none"}`,
    ].join("\n"),
    ephemeral: true,
  });
}

export const autoRoleCommand: Command = {
  name: "autorole",
  aliases: ["ar"],
  category: "admin",
  description: "Configure roles assigned automatically when members join.",
  usage: "<show|add|remove|enable|disable|validate|sync|minage|bots>",
  examples: ["autorole add @Member", "autorole validate", "autorole sync", "autorole sync apply"],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Configure join auto-roles")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName("show").setDescription("Show configuration"))
    .addSubcommand((sub) =>
      sub.setName("add").setDescription("Add an auto-role").addRoleOption((option) =>
        option.setName("role").setDescription("Role").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("remove").setDescription("Remove an auto-role").addRoleOption((option) =>
        option.setName("role").setDescription("Role").setRequired(true),
      ),
    )
    .addSubcommand((sub) => sub.setName("enable").setDescription("Enable auto-role"))
    .addSubcommand((sub) => sub.setName("disable").setDescription("Disable auto-role"))
    .addSubcommand((sub) => sub.setName("validate").setDescription("Validate configured roles"))
    .addSubcommand((sub) =>
      sub.setName("sync").setDescription("Assign missing roles to existing members").addBooleanOption((option) =>
        option.setName("dry_run").setDescription("Preview only").setRequired(false),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("minage").setDescription("Minimum account age").addIntegerOption((option) =>
        option.setName("days").setDescription("0-365").setRequired(true).setMinValue(0).setMaxValue(365),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("bots").setDescription("Include bots").addStringOption((option) =>
        option.setName("value").setDescription("on or off").setRequired(true).addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
      ),
    ),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase() ?? "show";
    const before = await ctx.services.settings.getAutoRole(ctx.guild.id);
    try {
      if (action === "show" || action === "list") {
        await ctx.reply(configCard(before));
        return;
      }
      if (action === "validate") {
        const result = await ctx.services.autoRole.validateRoles(ctx.guild, before.roleIds, ctx.member);
        await ctx.reply(
          card({
            title: "Auto-role validation",
            body: [
              result.validRoleIds.length ? `**Valid** · ${result.validRoleIds.map((id) => `<@&${id}>`).join(", ")}` : "**Valid** · none",
              result.errors.length ? `**Errors**\n${result.errors.map((e) => `• ${e}`).join("\n")}` : null,
              result.warnings.length ? `**Warnings**\n${result.warnings.map((w) => `• ${w}`).join("\n")}` : null,
            ]
              .filter(Boolean)
              .join("\n\n"),
            ephemeral: true,
          }),
        );
        return;
      }
      if (action === "sync") {
        const arg = ctx.args[1]?.toLowerCase();
        const dryRun = arg !== "apply" && arg !== "false";
        if (!dryRun && !ctx.member.permissions.has(PermissionFlagsBits.Administrator)) {
          await ctx.reply({ content: "Only an Administrator can apply a full auto-role sync.", ephemeral: true });
          return;
        }
        const result = await ctx.services.autoRole.sync(ctx.guild, dryRun);
        await ctx.services.audit.log({
          guildId: ctx.guild.id,
          actorId: ctx.author.id,
          actorType: "user",
          source: "discord",
          action: dryRun ? "autorole.sync.preview" : "autorole.sync",
          after: result,
        });
        await ctx.reply(
          card({
            title: dryRun ? "Auto-role sync preview" : "Auto-role sync complete",
            body: `**Total** · ${result.total}\n**${dryRun ? "Would assign" : "Assigned"}** · ${result.assigned}\n**Skipped** · ${result.skipped}\n**Failed** · ${result.failed}${dryRun ? "\n\n-# Run `autorole sync apply` to apply." : ""}`,
            ephemeral: true,
          }),
        );
        return;
      }
      if (action === "enable" || action === "disable") {
        const after = await ctx.services.settings.updateAutoRole(ctx.guild.id, { enabled: action === "enable" }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: `autorole.${action}`, before, after });
        await ctx.reply({ content: `Auto-role **${action}d**.`, ephemeral: true });
        return;
      }
      if (action === "minage") {
        const days = Number(ctx.args[1]);
        if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error("Days must be 0-365.");
        const after = await ctx.services.settings.updateAutoRole(ctx.guild.id, { minAccountAgeDays: days }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "autorole.minage", before, after });
        await ctx.reply({ content: `Minimum account age set to **${days} days**.`, ephemeral: true });
        return;
      }
      if (action === "bots") {
        const value = bool(ctx.args[1]);
        const after = await ctx.services.settings.updateAutoRole(ctx.guild.id, { includeBots: value }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "autorole.bots", before, after });
        await ctx.reply({ content: `Include bots set to **${value ? "on" : "off"}**.`, ephemeral: true });
        return;
      }
      if (action === "add" || action === "remove") {
        const roleId = normalizeRoleId(ctx.args[1]);
        if (!roleId) throw new Error("Mention a role.");
        const role = await ctx.guild.roles.fetch(roleId).catch(() => null);
        if (!role) throw new Error("Role not found.");
        const next = action === "add"
          ? [...new Set([...before.roleIds, role.id])]
          : before.roleIds.filter((id) => id !== role.id);
        if (next.length > 10) throw new Error("At most 10 auto-roles are allowed.");
        const validation = await ctx.services.autoRole.validateRoles(ctx.guild, next, ctx.member);
        if (validation.errors.length) {
          throw new Error(validation.errors.join("\n"));
        }
        const after = await ctx.services.settings.updateAutoRole(ctx.guild.id, { roleIds: validation.validRoleIds, enabled: true }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: `autorole.${action}`, before, after });
        await ctx.reply({
          content: `${role} ${action === "add" ? "added to" : "removed from"} auto-roles.${validation.warnings.length ? `\nWarnings: ${validation.warnings.join("; ")}` : ""}`,
          ephemeral: true,
        });
        return;
      }
      throw new Error("Unknown `autorole` subcommand.");
    } catch (error) {
      await ctx.reply({ content: error instanceof Error ? error.message : "That action failed.", ephemeral: true });
    }
  },
};
