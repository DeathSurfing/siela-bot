import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { FEATURES, getFeature, isFeatureId, type FeatureCategory } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { card } from "../../features/ui.js";
import { UserError } from "../../lib/errors.js";

const CATEGORY_ORDER: FeatureCategory[] = [
  "Music",
  "Economy",
  "Relics",
  "Games",
  "Social",
  "Community",
  "Voice",
  "Automation",
];

function parseToggle(value: string | undefined): boolean {
  if (value === "true" || value === "on" || value === "enable" || value === "enabled") return true;
  if (value === "false" || value === "off" || value === "disable" || value === "disabled") return false;
  throw new UserError("Use `on` or `off`.", "validation_error");
}

export const featuresCommand: Command = {
  name: "features",
  aliases: ["feature"],
  category: "admin",
  description: "List every server feature, or turn one on or off.",
  usage: "[on|off] [feature]",
  examples: ["features", "features off relics", "features on music-lyrics"],
  adminOnly: true,
  cooldownMs: 1_000,
  slash: new SlashCommandBuilder()
    .setName("features")
    .setDescription("List or toggle server features")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName("list").setDescription("Show every feature and its state"))
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Turn a feature on or off")
        .addStringOption((option) =>
          option.setName("feature").setDescription("Feature id, for example relics").setRequired(true),
        )
        .addBooleanOption((option) =>
          option.setName("enabled").setDescription("On or off").setRequired(true),
        ),
    ),
  async execute(ctx: CommandContext): Promise<void> {
    const [action, featureArg, toggleArg] = ctx.args;
    const wantsList = !action || action === "list" || action === "show";
    if (wantsList) {
      const states = await ctx.services.features.list(ctx.guild.id);
      const lines: string[] = [];
      for (const category of CATEGORY_ORDER) {
        const inCategory = states.filter((feature) => feature.category === category);
        if (!inCategory.length) continue;
        lines.push(`**${category}**`);
        for (const feature of inCategory) {
          lines.push(`${feature.enabled ? "✓" : "✗"} \`${feature.id}\` · ${feature.label}`);
        }
      }
      const enabled = states.filter((feature) => feature.enabled).length;
      await ctx.reply(
        card({
          theme: "admin",
          title: "Feature switches",
          subtitle: `${enabled} of ${states.length} enabled`,
          body: [...lines, "", "-# `features off <id>` turns one off. `features on <id>` turns it back on."].join("\n"),
          ephemeral: true,
        }),
      );
      return;
    }

    const enabled =
      action === "set"
        ? parseToggle(toggleArg)
        : action === "enable" || action === "on"
          ? true
          : action === "disable" || action === "off"
            ? false
            : null;
    if (enabled === null) {
      throw new UserError("Use `features`, `features on <id>`, or `features off <id>`.", "validation_error");
    }
    const featureId = featureArg;
    if (!featureId) throw new UserError("Name the feature id to toggle.", "validation_error");
    if (!isFeatureId(featureId)) {
      throw new UserError(`Unknown feature \`${featureId}\`. Run \`features\` for the list.`, "unknown_feature");
    }
    const before = (await ctx.services.features.list(ctx.guild.id)).find((feature) => feature.id === featureId);
    await ctx.services.features.set(ctx.guild.id, featureId, enabled, ctx.author.id);
    await ctx.services.audit.log({
      guildId: ctx.guild.id,
      actorId: ctx.author.id,
      actorType: "user",
      source: "discord",
      action: enabled ? "features.enable" : "features.disable",
      targetType: "feature",
      targetId: featureId,
      before: before ? { enabled: before.enabled } : null,
      after: { enabled },
    });
    await ctx.reply(
      card({
        theme: enabled ? "success" : "warning",
        title: enabled ? "Feature enabled" : "Feature disabled",
        body: `**${getFeature(featureId)?.label ?? featureId}** · \`${featureId}\` is now **${enabled ? "on" : "off"}**.\n\n-# Hidden commands stay registered with Discord but reject use.`,
        ephemeral: true,
      }),
    );
  },
};
