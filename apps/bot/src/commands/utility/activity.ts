import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { attachPagination, card, empty, pagedCard, rankLabel } from "../../features/ui.js";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export const activityCommand: Command = {
  name: "activity",
  aliases: ["memberactivity"],
  category: "utility",
  description: "Show activity stats for a member.",
  usage: "[user]",
  examples: ["activity", "activity @user"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("activity")
    .setDescription("Show member activity stats")
    .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(false)),
  async execute(ctx: CommandContext) {
    const targetId = ctx.args[0] ?? ctx.author.id;
    const member = await ctx.guild.members.fetch(targetId).catch(() => null);
    if (!member) {
      await ctx.reply(empty("Member not found."));
      return;
    }
    const row = await ctx.services.activity.get(ctx.guild.id, member.id);
    const body = [
      `**Messages** · ${row?.messages ?? 0}`,
      `**Commands** · ${row?.commands ?? 0}`,
      `**Reactions** · ${row?.reactions ?? 0}`,
      `**Voice** · ${formatDuration(row?.voiceSeconds ?? 0)}`,
      `**Last active** · ${row?.lastActiveAt ? `<t:${Math.floor(row.lastActiveAt.getTime() / 1000)}:R>` : "never"}`,
    ].join("\n");
    await ctx.reply(card({ title: "Activity", subtitle: member.displayName, body }));
  },
};

export const activityTopCommand: Command = {
  name: "activetop",
  aliases: ["activitytop"],
  category: "utility",
  description: "Show the activity leaderboard.",
  usage: "[messages|commands|reactions|voice]",
  examples: ["activetop", "activetop voice", "activetop messages"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("activetop")
    .setDescription("Activity leaderboard")
    .addStringOption((option) =>
      option
        .setName("metric")
        .setDescription("Metric to rank by")
        .setRequired(false)
        .addChoices(
          { name: "voice", value: "voice" },
          { name: "messages", value: "messages" },
          { name: "commands", value: "commands" },
          { name: "reactions", value: "reactions" },
        ),
    ),
  async execute(ctx: CommandContext) {
    const metricArg = (ctx.args[0] ?? "voice").toLowerCase();
    const metric = ["messages", "commands", "reactions", "voice"].includes(metricArg)
      ? (metricArg as "messages" | "commands" | "reactions" | "voice")
      : "voice";
    const rows = await ctx.services.activity.leaderboard(ctx.guild.id, metric, 100);
    if (!rows.length) {
      await ctx.reply(empty("No activity recorded yet."));
      return;
    }

    const ids = [...new Set(rows.map((row) => row.userId))];
    const members = await ctx.guild.members.fetch({ user: ids }).catch(() => null);
    const names = new Map((members ? [...members.values()] : []).map((member) => [member.id, member.displayName]));
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
    const buildPage = (page: number, disabled = false) => {
      const start = (page - 1) * perPage;
      const lines = rows.slice(start, start + perPage).map((row, index) => {
        const value =
          metric === "messages"
            ? `${row.messages} messages`
            : metric === "commands"
              ? `${row.commands} commands`
              : metric === "reactions"
                ? `${row.reactions} reactions`
                : formatDuration(row.voiceSeconds);
        return `${rankLabel(start + index + 1)} **${names.get(row.userId) ?? row.userId}** — ${value}`;
      });
      return pagedCard({
        title: "Activity leaderboard",
        subtitle: metric,
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
