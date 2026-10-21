import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import { loveBar, loveResult } from "../../features/love.js";

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<@!?|>$/g, "");
}

async function resolveMember(ctx: CommandContext, value: string | undefined) {
  const id = normalizeId(value);
  if (!id) throw new UserError("Mention a member to calculate love with.");
  const member = await ctx.guild.members.fetch(id).catch(() => null);
  if (!member) throw new UserError("That member is not in the server.");
  if (member.user.bot) throw new UserError("Bots cannot be part of a love calculation.");
  return member;
}

export const loveCalcCommand: Command = {
  name: "lovecalc",
  aliases: ["love", "lc"],
  category: "social",
  description: "Calculate a permanent love score for you and another member.",
  usage: "<user> [second-user]",
  examples: ["lovecalc @user", "lovecalc @user1 @user2"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("lovecalc")
    .setDescription("Calculate a permanent love score")
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to calculate with").setRequired(false),
    )
    .addUserOption((option) =>
      option.setName("second").setDescription("Optional second member").setRequired(false),
    ),
  async execute(ctx: CommandContext) {
    const firstArg = ctx.args[0];
    const secondArg = ctx.args[1];
    if (!firstArg) {
      throw new UserError("Mention the member you want a love calculation with.");
    }

    const first = secondArg ? await resolveMember(ctx, firstArg) : ctx.member;
    const second = await resolveMember(ctx, secondArg ?? firstArg);
    if (first.id === second.id) throw new UserError("Pick two different members.");

    const result = loveResult(ctx.guild.id, first.id, second.id);
    await ctx.services.friendship.addXp(ctx.guild.id, first.id, second.id, 1).catch(() => undefined);
    const embed = new EmbedBuilder()
      .setColor(result.score >= 80 ? 0xff4f8b : COLORS.social)
      .setTitle(`💘 Love Calculator — ${result.score}%`)
      .setDescription(
        [
          `**${first.displayName}** + **${second.displayName}**`,
          "",
          loveBar(result.score),
          `**${result.score}%** — **${result.title}**`,
          result.message,
        ].join("\n"),
      )
      .setFooter({ text: "This result is permanent for this pair." });

    await ctx.reply({ embeds: [embed] });
  },
};
