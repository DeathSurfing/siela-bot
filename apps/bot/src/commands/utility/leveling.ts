import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import { card, progressBar } from "../../features/ui.js";

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<#|^<@!?|>$/g, "");
}

function xpForLevel(level: number): number {
  return level * level * 100;
}

export const levelChannelCommand: Command = {
  name: "levelchannel",
  aliases: ["levelingchannel", "setlevelchannel"],
  category: "admin",
  description: "Set the level-up announcement channel.",
  usage: "[#channel]",
  examples: ["levelchannel #levels", "levelchannel #announcements"],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("levelchannel")
    .setDescription("Set the level-up announcement channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) => option.setName("channel").setDescription("Text channel").setRequired(true)),
  async execute(ctx: CommandContext) {
    const channelId = normalizeId(ctx.args[0]);
    if (!channelId) throw new UserError("Mention a text channel.");
    const channel = await ctx.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) throw new UserError("That is not a text channel.");
    await ctx.services.settings.setLevelingChannel(ctx.guild.id, channel.id, ctx.author.id);
    await ctx.reply({ content: `Level-up announcements will be sent in <#${channel.id}>.`, ephemeral: true });
  },
};

export const levelCommand: Command = {
  name: "level",
  aliases: ["lvl", "rank"],
  category: "utility",
  description: "Show a member's level.",
  usage: "[user]",
  examples: ["level", "level @user"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Show a member's level")
    .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(false)),
  async execute(ctx: CommandContext) {
    const targetId = normalizeId(ctx.args[0]) ?? ctx.author.id;
    const member = await ctx.guild.members.fetch(targetId).catch(() => null);
    if (!member) throw new UserError("Member not found.");

    const xp = ctx.services.leveling.getXp(ctx.guild.id, member.id);
    const level = ctx.services.leveling.getLevel(ctx.guild.id, member.id);

    const currentThreshold = xpForLevel(level);
    const nextThreshold = xpForLevel(level + 1);
    const progress = Math.max(0, xp - currentThreshold);
    const needed = Math.max(1, nextThreshold - currentThreshold);
    const bar = progressBar(progress, needed, 12);

    const body = [
      `**Level** · ${level}`,
      `**XP** · ${xp}`,
      `**Progress** · ${bar} ${progress}/${needed} XP`,
      `-# Next level at ${nextThreshold} XP`,
    ].join("\n");

    await ctx.reply(card({ title: "Level", subtitle: member.displayName, body }));
  },
};