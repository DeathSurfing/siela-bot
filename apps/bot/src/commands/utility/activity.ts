import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";

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
      await ctx.reply({ content: "Member not found.", ephemeral: true });
      return;
    }
    const row = await ctx.services.activity.get(ctx.guild.id, member.id);
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`Activity for ${member.displayName}`)
      .addFields(
        { name: "Messages", value: String(row?.messages ?? 0), inline: true },
        { name: "Commands", value: String(row?.commands ?? 0), inline: true },
        { name: "Reactions", value: String(row?.reactions ?? 0), inline: true },
        { name: "Voice time", value: formatDuration(row?.voiceSeconds ?? 0), inline: true },
        { name: "Last active", value: row?.lastActiveAt ? `<t:${Math.floor(row.lastActiveAt.getTime() / 1000)}:R>` : "never", inline: true },
      );
    await ctx.reply({ embeds: [embed] });
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
    const rows = await ctx.services.activity.leaderboard(ctx.guild.id, metric, 10);
    if (!rows.length) {
      await ctx.reply({ content: "No activity recorded yet.", ephemeral: true });
      return;
    }
    const lines = await Promise.all(
      rows.map(async (row, index) => {
        const member = await ctx.guild.members.fetch(row.userId).catch(() => null);
        const value =
          metric === "messages"
            ? row.messages
            : metric === "commands"
              ? row.commands
              : metric === "reactions"
                ? row.reactions
                : `${formatDuration(row.voiceSeconds)}`;
        return `${index + 1}. ${member?.displayName ?? row.userId} — ${value}`;
      }),
    );
    await ctx.reply({
      embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(`Activity leaderboard (${metric})`).setDescription(lines.join("\n"))],
    });
  },
};
