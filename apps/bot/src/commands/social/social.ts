import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import {
  COLORS,
  INTERACTION_KINDS,
  INTERACTION_META,
  type InteractionKind,
} from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { fetchInteractionGif } from "../../features/social.js";

function isKind(value: string | undefined): value is InteractionKind {
  return Boolean(value && INTERACTION_KINDS.includes(value as InteractionKind));
}

function socialCommand(kind: InteractionKind): Command {
  const meta = INTERACTION_META[kind];
  return {
    name: kind,
    category: "social",
    description: `${meta.label} someone and increment your pair counter.`,
    usage: "<user>",
    examples: [`${kind} @user`],
    cooldownMs: 3_000,
    slash: new SlashCommandBuilder()
      .setName(kind)
      .setDescription(`${meta.label} a member`)
      .addUserOption((option) => option.setName("user").setDescription("Target member").setRequired(true)),
    async execute(ctx: CommandContext) {
      const targetId = ctx.args[0];
      if (!targetId) {
        await ctx.reply({ content: `Usage: \`${kind} <user>\``, ephemeral: true });
        return;
      }
      const target = await ctx.guild.members.fetch(targetId).catch(() => null);
      if (!target || target.user.bot) {
        await ctx.reply({ content: "Please target a human member.", ephemeral: true });
        return;
      }
      if (kind === "chodu" && target.id === ctx.author.id) {
        await ctx.reply({ content: "You cannot use this on yourself.", ephemeral: true });
        return;
      }
      if (await ctx.services.counters.isOptedOut(ctx.guild.id, target.id, kind)) {
        await ctx.reply({ content: `${target.displayName} has opted out of that interaction.`, ephemeral: true });
        return;
      }

      const count = await ctx.services.counters.increment(ctx.guild.id, ctx.author.id, target.id, kind);
      const gif = await fetchInteractionGif(kind);
      const embed = new EmbedBuilder()
        .setColor(COLORS.social)
        .setDescription(
          `${meta.emoji} **${ctx.member.displayName}** ${meta.verb} **${target.displayName}**!\nThat makes **${count}** ${meta.label.toLowerCase()} interaction${count === 1 ? "" : "s"}.`,
        )
        .setFooter({ text: "Counter stored in PostgreSQL" });
      if (gif) embed.setImage(gif);
      await ctx.reply({ embeds: [embed] });
    },
  };
}

export const slapCommand = socialCommand("slap");
export const kissCommand = socialCommand("kiss");
export const hugCommand = socialCommand("hug");
export const choduCommand = socialCommand("chodu");
export const wuzuCommand = socialCommand("wuzu");

export const socialStatsCommand: Command = {
  name: "socialstats",
  aliases: ["stats", "counter"],
  category: "social",
  description: "Show given and received interaction counters for a member.",
  usage: "[user]",
  examples: ["socialstats", "socialstats @user"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("socialstats")
    .setDescription("Show interaction counters")
    .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(false)),
  async execute(ctx: CommandContext) {
    const userId = ctx.args[0] ?? ctx.author.id;
    const member = await ctx.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await ctx.reply({ content: "Member not found.", ephemeral: true });
      return;
    }
    const rows = await ctx.services.counters.query({ guildId: ctx.guild.id, userId: member.id, limit: 100 });
    const given = new Map<InteractionKind, number>();
    const received = new Map<InteractionKind, number>();
    for (const row of rows) {
      if (row.actorId === member.id) given.set(row.kind, (given.get(row.kind) ?? 0) + row.count);
      if (row.targetId === member.id) received.set(row.kind, (received.get(row.kind) ?? 0) + row.count);
    }
    const lines = INTERACTION_KINDS.map((kind) => {
      const meta = INTERACTION_META[kind];
      return `${meta.emoji} **${meta.label}** — given **${given.get(kind) ?? 0}**, received **${received.get(kind) ?? 0}**`;
    });
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.social)
          .setTitle(`Interaction stats for ${member.displayName}`)
          .setDescription(lines.join("\n")),
      ],
    });
  },
};

export const socialTopCommand: Command = {
  name: "socialtop",
  aliases: ["top"],
  category: "social",
  description: "Show the interaction leaderboard.",
  usage: "[kind]",
  examples: ["socialtop", "socialtop slap"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("socialtop")
    .setDescription("Interaction leaderboard")
    .addStringOption((option) =>
      option
        .setName("kind")
        .setDescription("Interaction kind")
        .setRequired(false)
        .addChoices(...INTERACTION_KINDS.map((kind) => ({ name: INTERACTION_META[kind].label, value: kind }))),
    ),
  async execute(ctx: CommandContext) {
    const kind = ctx.args[0];
    if (kind && !isKind(kind)) {
      await ctx.reply({ content: `Unknown kind. Use one of: ${INTERACTION_KINDS.join(", ")}`, ephemeral: true });
      return;
    }
    const rows = await ctx.services.counters.leaderboard(ctx.guild.id, kind as InteractionKind | undefined, 10);
    if (!rows.length) {
      await ctx.reply({ content: "No counters yet.", ephemeral: true });
      return;
    }
    const lines = rows.map((row, index) => {
      const meta = INTERACTION_META[row.kind];
      return `**${index + 1}.** <@${row.userId}> — ${meta.emoji} ${meta.label}: **${row.total}**`;
    });
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.social)
          .setTitle(kind ? `${INTERACTION_META[kind as InteractionKind].label} leaderboard` : "Interaction leaderboard")
          .setDescription(lines.join("\n"))
          .setFooter({ text: "Counts are pair-based; totals are aggregated per actor" }),
      ],
      allowedMentions: { parse: [] },
    });
  },
};

function optCommand(kind: "optout" | "optin"): Command {
  return {
    name: kind,
    category: "social",
    description: kind === "optout" ? "Stop being targeted by interaction commands." : "Allow interaction commands again.",
    usage: "[kind]",
    examples: [kind, `${kind} slap`],
    cooldownMs: 3_000,
    slash: new SlashCommandBuilder()
      .setName(kind)
      .setDescription(kind === "optout" ? "Opt out of interactions" : "Opt back in to interactions")
      .addStringOption((option) =>
        option
          .setName("kind")
          .setDescription("Specific kind, or all")
          .setRequired(false)
          .addChoices(
            { name: "All", value: "*" },
            ...INTERACTION_KINDS.map((value) => ({ name: INTERACTION_META[value].label, value })),
          ),
      ),
    async execute(ctx: CommandContext) {
      const value = ctx.args[0] ?? "*";
      if (value !== "*" && !isKind(value)) {
        await ctx.reply({ content: "Unknown interaction kind.", ephemeral: true });
        return;
      }
      if (kind === "optout") {
        await ctx.services.counters.optOut(ctx.guild.id, ctx.author.id, value as InteractionKind | "*");
      } else {
        await ctx.services.counters.optIn(ctx.guild.id, ctx.author.id, value as InteractionKind | "*");
      }
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setDescription(
              kind === "optout"
                ? `You will no longer be targeted by ${value === "*" ? "interaction commands" : INTERACTION_META[value as InteractionKind].label}.`
                : `You can be targeted by ${value === "*" ? "interaction commands" : INTERACTION_META[value as InteractionKind].label} again.`,
            ),
        ],
        ephemeral: true,
      });
    },
  };
}

export const optoutCommand = optCommand("optout");
export const optinCommand = optCommand("optin");
