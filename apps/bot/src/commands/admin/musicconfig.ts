import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { card } from "../../features/ui.js";

function normalizeRoleId(value: string | undefined): string | undefined {
  return value?.replace(/^<@&|>$/g, "");
}

function configCard(settings: Awaited<ReturnType<CommandContext["services"]["settings"]["getMusic"]>>) {
  return card({
    title: "Music",
    body: [
      `**DJ roles** · ${settings.djRoleIds.length ? settings.djRoleIds.map((id) => `<@&${id}>`).join(", ") : "everyone"}`,
      `**Default volume** · ${settings.defaultVolume}`,
      `**Max queue** · ${settings.maxQueueSize}`,
      `**Alone timeout** · ${settings.aloneTimeoutSeconds}s`,
      `**Music channel** · ${settings.musicChannelId ? `<#${settings.musicChannelId}>` : "any"}`,
    ].join("\n"),
    ephemeral: true,
  });
}

export const musicConfigCommand: Command = {
  name: "musicconfig",
  aliases: ["music"],
  category: "admin",
  description: "Configure music policy: DJ roles, queue cap, volume, and channel.",
  usage: "<show|djrole|maxqueue|volume|channel|alone>",
  examples: ["musicconfig show", "musicconfig djrole @DJ", "musicconfig maxqueue 100"],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("musicconfig")
    .setDescription("Configure music policy")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName("show").setDescription("Show configuration"))
    .addSubcommand((sub) =>
      sub
        .setName("djrole")
        .setDescription("Add or remove a DJ role")
        .addRoleOption((option) => option.setName("role").setDescription("Role").setRequired(true))
        .addStringOption((option) =>
          option.setName("mode").setDescription("add or remove").setRequired(false).addChoices({ name: "add", value: "add" }, { name: "remove", value: "remove" }),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("maxqueue").setDescription("Set max queue").addIntegerOption((option) =>
        option.setName("value").setDescription("1-500").setRequired(true).setMinValue(1).setMaxValue(500),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("volume").setDescription("Set default volume").addIntegerOption((option) =>
        option.setName("value").setDescription("0-150").setRequired(true).setMinValue(0).setMaxValue(150),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("channel").setDescription("Restrict music commands to a channel").addChannelOption((option) =>
        option.setName("channel").setDescription("Text channel").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("alone").setDescription("Set alone timeout").addIntegerOption((option) =>
        option.setName("seconds").setDescription("30-3600").setRequired(true).setMinValue(30).setMaxValue(3600),
      ),
    ),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase() ?? "show";
    const before = await ctx.services.settings.getMusic(ctx.guild.id);
    try {
      if (action === "show") {
        await ctx.reply(configCard(before));
        return;
      }
      if (action === "djrole") {
        const roleId = normalizeRoleId(ctx.args[1]);
        if (!roleId) throw new Error("Mention a role.");
        const mode = ctx.args[2]?.toLowerCase() ?? "add";
        const next = mode === "remove"
          ? before.djRoleIds.filter((id) => id !== roleId)
          : [...new Set([...before.djRoleIds, roleId])];
        if (next.length > 10) throw new Error("At most 10 DJ roles are allowed.");
        const after = await ctx.services.settings.updateMusic(ctx.guild.id, { djRoleIds: next }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "music.djrole", before, after });
        await ctx.reply({ content: `DJ role ${mode === "remove" ? "removed" : "added"}.`, ephemeral: true });
        return;
      }
      if (action === "maxqueue" || action === "volume" || action === "alone") {
        const value = Number(ctx.args[1]);
        if (!Number.isInteger(value)) throw new Error("Provide an integer.");
        if (action === "maxqueue" && (value < 1 || value > 500)) throw new Error("Max queue must be 1-500.");
        if (action === "volume" && (value < 0 || value > 150)) throw new Error("Volume must be 0-150.");
        if (action === "alone" && (value < 30 || value > 3600)) throw new Error("Alone timeout must be 30-3600.");
        const patch =
          action === "maxqueue" ? { maxQueueSize: value }
          : action === "volume" ? { defaultVolume: value }
          : { aloneTimeoutSeconds: value };
        const after = await ctx.services.settings.updateMusic(ctx.guild.id, patch, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: `music.${action}`, before, after });
        await ctx.reply({ content: `Music **${action}** updated.`, ephemeral: true });
        return;
      }
      if (action === "channel") {
        const id = ctx.args[1]?.replace(/^<#|>$/g, "");
        if (!id) throw new Error("Mention a text channel.");
        const after = await ctx.services.settings.updateMusic(ctx.guild.id, { musicChannelId: id }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "music.channel", before, after });
        await ctx.reply({ content: `Music channel set to <#${id}>.`, ephemeral: true });
        return;
      }
      throw new Error("Unknown `musicconfig` subcommand.");
    } catch (error) {
      await ctx.reply({ content: error instanceof Error ? error.message : "That action failed.", ephemeral: true });
    }
  },
};
