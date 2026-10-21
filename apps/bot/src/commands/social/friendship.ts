import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { friendshipProgress, friendshipTier } from "../../features/friendship.js";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export const friendshipCommand: Command = {
  name: "friendship",
  aliases: ["friend", "friendlevel"],
  category: "social",
  description: "Show your friendship level with another member.",
  usage: "<user>",
  examples: ["friendship @user"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("friendship")
    .setDescription("Show friendship level with a member")
    .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true)),
  async execute(ctx: CommandContext) {
    const targetId = ctx.args[0];
    if (!targetId) {
      await ctx.reply({ content: "Usage: `friendship <user>`", ephemeral: true });
      return;
    }
    const target = await ctx.guild.members.fetch(targetId).catch(() => null);
    if (!target || target.user.bot || target.id === ctx.author.id) {
      await ctx.reply({ content: "Choose a different human member.", ephemeral: true });
      return;
    }
    const row = await ctx.services.friendship.get(ctx.guild.id, ctx.author.id, target.id);
    const xp = row?.xp ?? 0;
    const time = row?.timeTogetherSeconds ?? 0;
    const tier = friendshipTier(xp);
    const progress = friendshipProgress(xp);
    const next = progress.next === null ? "maxed" : `${progress.next - xp} XP to ${friendshipTier(progress.next).label}`;
    const embed = new EmbedBuilder()
      .setColor(COLORS.social)
      .setTitle(`${tier.emoji} ${ctx.member.displayName} & ${target.displayName}`)
      .setDescription(`**${tier.label}** — ${xp} XP`)
      .addFields(
        { name: "Tier", value: `${tier.emoji} ${tier.label}`, inline: true },
        { name: "XP", value: String(xp), inline: true },
        { name: "Time together", value: formatDuration(time), inline: true },
        { name: "Progress", value: `${progress.percent}% (${next})`, inline: false },
      );
    await ctx.reply({ embeds: [embed] });
  },
};

export const friendshipTopCommand: Command = {
  name: "friendshiptop",
  aliases: ["friendtop"],
  category: "social",
  description: "Show the friendship leaderboard.",
  usage: "",
  examples: ["friendshiptop"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder().setName("friendshiptop").setDescription("Friendship leaderboard"),
  async execute(ctx: CommandContext) {
    const rows = await ctx.services.friendship.leaderboard(ctx.guild.id, 10);
    if (!rows.length) {
      await ctx.reply({ content: "No friendship levels yet.", ephemeral: true });
      return;
    }
    const lines = await Promise.all(
      rows.map(async (row, index) => {
        const a = await ctx.guild.members.fetch(row.userA).catch(() => null);
        const b = await ctx.guild.members.fetch(row.userB).catch(() => null);
        const tier = friendshipTier(row.xp);
        return `${index + 1}. ${tier.emoji} ${a?.displayName ?? row.userA} & ${b?.displayName ?? row.userB} — ${row.xp} XP`;
      }),
    );
    await ctx.reply({
      embeds: [new EmbedBuilder().setColor(COLORS.social).setTitle("Friendship leaderboard").setDescription(lines.join("\n"))],
    });
  },
};
