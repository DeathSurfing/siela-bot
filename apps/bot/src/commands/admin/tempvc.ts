import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type CategoryChannel, type VoiceChannel } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { card } from "../../features/ui.js";

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<#|>$/g, "");
}

function onOff(value: string | undefined): boolean {
  if (value === "on" || value === "true" || value === "yes") return true;
  if (value === "off" || value === "false" || value === "no") return false;
  throw new Error("Use `on` or `off`.");
}

function configCard(settings: Awaited<ReturnType<CommandContext["services"]["settings"]["getTempVc"]>>) {
  return card({ theme: "admin",
    title: "Temporary VC",
    body: [
      `**Enabled** · ${settings.enabled ? "On" : "Off"}`,
      `**Hub** · ${settings.hubChannelId ? `<#${settings.hubChannelId}>` : "Not set"}`,
      `**Category** · ${settings.categoryId ? `<#${settings.categoryId}>` : "Not set"}`,
      `**Name template** · \`${settings.nameTemplate}\``,
      `**Default locked** · ${settings.defaultLocked ? "On" : "Off"}`,
      `**Default limit** · ${settings.defaultUserLimit}`,
      `**Grace** · ${settings.graceSeconds}s`,
      `**Max channels** · ${settings.maxChannels}`,
      `**Max per user** · ${settings.maxPerUser}`,
    ].join("\n"),
    ephemeral: true,
  });
}

async function connectivityWarning(ctx: CommandContext): Promise<string | null> {
  const roles = ctx.guild.roles.cache.filter(
    (role) => !role.managed && role.id !== ctx.guild.id && role.permissions.has(PermissionFlagsBits.Connect),
  );
  if (!roles.size) return null;
  return `${roles.size} role(s) have Connect at the server level and may bypass a channel deny. Prefer a dedicated category with no role-level Connect allows.`;
}

export const tempVcCommand: Command = {
  name: "tempvc",
  category: "admin",
  description: "Configure join-to-create temporary voice channels.",
  usage: "<show|setup|hub|category|enable|disable|name|limit|locked|grace|max|peruser>",
  examples: ["tempvc setup #Join to Create #Private VCs", "tempvc locked on", "tempvc grace 30"],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("tempvc")
    .setDescription("Configure temporary voice channels")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName("show").setDescription("Show configuration"))
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Set the hub and category")
        .addChannelOption((option) => option.setName("hub").setDescription("Voice hub").setRequired(true))
        .addChannelOption((option) => option.setName("category").setDescription("Category").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName("hub").setDescription("Set the hub").addChannelOption((option) =>
        option.setName("channel").setDescription("Voice hub").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("category").setDescription("Set the category").addChannelOption((option) =>
        option.setName("channel").setDescription("Category").setRequired(true),
      ),
    )
    .addSubcommand((sub) => sub.setName("enable").setDescription("Enable temp VCs"))
    .addSubcommand((sub) => sub.setName("disable").setDescription("Disable temp VCs"))
    .addSubcommand((sub) =>
      sub.setName("name").setDescription("Set the name template").addStringOption((option) =>
        option.setName("template").setDescription("Use {user}").setRequired(true).setMaxLength(100),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("limit").setDescription("Set default user limit").addIntegerOption((option) =>
        option.setName("value").setDescription("0-99").setRequired(true).setMinValue(0).setMaxValue(99),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("locked").setDescription("Default locked state").addStringOption((option) =>
        option.setName("value").setDescription("on or off").setRequired(true).addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("grace").setDescription("Empty-channel grace seconds").addIntegerOption((option) =>
        option.setName("seconds").setDescription("0-600").setRequired(true).setMinValue(0).setMaxValue(600),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("max").setDescription("Max active channels").addIntegerOption((option) =>
        option.setName("value").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("peruser").setDescription("Max channels per user").addIntegerOption((option) =>
        option.setName("value").setDescription("1-3").setRequired(true).setMinValue(1).setMaxValue(3),
      ),
    ),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase() ?? "show";
    const before = await ctx.services.settings.getTempVc(ctx.guild.id);
    try {
      if (action === "show" || action === "config") {
        await ctx.reply(configCard(before));
        return;
      }
      if (action === "setup" || action === "hub" || action === "category") {
        let hubId = normalizeId(ctx.args[1]);
        let categoryId = normalizeId(ctx.args[2]);
        if (action === "hub") {
          hubId = normalizeId(ctx.args[1]);
          categoryId = before.categoryId ?? undefined;
        } else if (action === "category") {
          categoryId = normalizeId(ctx.args[1]);
          hubId = before.hubChannelId ?? undefined;
        }
        if (!hubId || !categoryId) throw new Error("Provide a voice hub and a category.");
        const hub = await ctx.guild.channels.fetch(hubId).catch(() => null);
        const category = await ctx.guild.channels.fetch(categoryId).catch(() => null);
        if (!hub || hub.type !== ChannelType.GuildVoice) throw new Error("Hub must be a voice channel.");
        if (!category || category.type !== ChannelType.GuildCategory) throw new Error("Category must be a category channel.");
        const after = await ctx.services.settings.updateTempVc(
          ctx.guild.id,
          { hubChannelId: (hub as VoiceChannel).id, categoryId: (category as CategoryChannel).id, enabled: true },
          ctx.author.id,
        );
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "tempvc.setup", before, after });
        const warning = await connectivityWarning(ctx);
        await ctx.reply({
          content: `Temporary VCs enabled. Hub: <#${hub.id}> • Category: <#${category.id}>${warning ? `\n\n⚠️ ${warning}` : ""}`,
          ephemeral: true,
        });
        return;
      }
      if (action === "enable" || action === "disable") {
        const after = await ctx.services.settings.updateTempVc(ctx.guild.id, { enabled: action === "enable" }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: `tempvc.${action}`, before, after });
        await ctx.reply({ content: `Temporary VCs **${action}d**.`, ephemeral: true });
        return;
      }
      if (action === "name") {
        const template = ctx.args.slice(1).join(" ").trim();
        if (!template) throw new Error("Provide a name template.");
        const after = await ctx.services.settings.updateTempVc(ctx.guild.id, { nameTemplate: template }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "tempvc.name", before, after });
        await ctx.reply({ content: `Name template set to \`${template}\`.`, ephemeral: true });
        return;
      }
      if (action === "limit" || action === "grace" || action === "max" || action === "peruser") {
        const value = Number(ctx.args[1]);
        if (!Number.isInteger(value)) throw new Error("Provide an integer.");
        const patch =
          action === "limit" ? { defaultUserLimit: value }
          : action === "grace" ? { graceSeconds: value }
          : action === "max" ? { maxChannels: value }
          : { maxPerUser: value };
        const after = await ctx.services.settings.updateTempVc(ctx.guild.id, patch, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: `tempvc.${action}`, before, after });
        await ctx.reply({ content: `Temporary VC **${action}** updated.`, ephemeral: true });
        return;
      }
      if (action === "locked") {
        const value = onOff(ctx.args[1]);
        const after = await ctx.services.settings.updateTempVc(ctx.guild.id, { defaultLocked: value }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "tempvc.locked", before, after });
        await ctx.reply({ content: `Default locked set to **${value ? "on" : "off"}**.`, ephemeral: true });
        return;
      }
      throw new Error("Unknown `tempvc` subcommand.");
    } catch (error) {
      await ctx.reply({ content: error instanceof Error ? error.message : "That action failed.", ephemeral: true });
    }
  },
};
