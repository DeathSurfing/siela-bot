import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { friendshipProgress, friendshipTier } from "../../features/friendship.js";
import { attachPagination, card, fetchMemberNames, pagedCard, progressBar, rankLabel } from "../../features/ui.js";

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
    await ctx.reply(
      card({
        title: `${tier.emoji} ${ctx.member.displayName} & ${target.displayName}`,
        subtitle: `${tier.label} · ${xp} XP`,
        body: [
          `${progressBar(progress.percent, 100, 14)} ${progress.percent}%`,
          `**XP** · ${xp}`,
          `**Time together** · ${formatDuration(time)}`,
          `**Next** · ${next}`,
        ].join("\n"),
      }),
    );
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
    const rows = await ctx.services.friendship.leaderboard(ctx.guild.id, 100);
    if (!rows.length) {
      await ctx.reply({ content: "No friendship levels yet.", ephemeral: true });
      return;
    }
    const names = await fetchMemberNames(ctx.guild, rows.flatMap((row) => [row.userA, row.userB]));
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
    const buildPage = (page: number, disabled = false) => {
      const start = (page - 1) * perPage;
      const lines = rows.slice(start, start + perPage).map((row, index) => {
        const tier = friendshipTier(row.xp);
        return `${rankLabel(start + index + 1)} ${tier.emoji} ${names.get(row.userA) ?? row.userA} & ${names.get(row.userB) ?? row.userB} — ${row.xp} XP`;
      });
      return pagedCard({
        title: "Friendship leaderboard",
        subtitle: "pair XP",
        body: lines.join("\n"),
        page,
        totalPages,
        disabled,
      });
    };
    const message = await ctx.reply(buildPage(1));
    if (message) attachPagination(message, ctx.author.id, 1, buildPage);
  },
};
