import { SlashCommandBuilder } from "discord.js";
import { BTS_MEMBERS, type BtsMember } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import { card } from "../../features/ui.js";

const BTS_ALIASES = new Map<string, BtsMember>([
  ["rm", "RM"],
  ["jin", "Jin"],
  ["suga", "Suga"],
  ["jhope", "J-Hope"],
  ["j-hope", "J-Hope"],
  ["j hope", "J-Hope"],
  ["jimin", "Jimin"],
  ["v", "V"],
  ["jungkook", "Jungkook"],
  ["jk", "Jungkook"],
]);

export function normalizeMember(value: string | undefined): BtsMember | null {
  if (!value) return null;
  const cleaned = value.toLowerCase().replace(/^<@!?|>$/g, "").trim();
  const exact = BTS_MEMBERS.find((member) => member.toLowerCase() === cleaned);
  if (exact) return exact;
  return BTS_ALIASES.get(cleaned) ?? null;
}

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<@!?|>$/g, "");
}

function biasCard(displayName: string, bias: string, wrecker: string) {
  return card({
    title: `${displayName}'s bias`,
    body: `**Bias** · ${bias}\n**Bias wrecker** · ${wrecker}`,
  });
}

export const biasCommand: Command = {
  name: "bias",
  aliases: ["biaswrecker", "mybias"],
  category: "social",
  description: "Set or show your BTS bias and bias wrecker.",
  usage: "[set <bias> <wrecker> | show [user] | clear]",
  examples: ["bias set RM Jungkook", "bias show @user", "bias clear"],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("bias")
    .setDescription("Set or show your BTS bias and bias wrecker")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set your BTS bias and bias wrecker")
        .addStringOption((option) =>
          option
            .setName("bias")
            .setDescription("Your bias")
            .setRequired(true)
            .addChoices(...BTS_MEMBERS.map((member) => ({ name: member, value: member }))),
        )
        .addStringOption((option) =>
          option
            .setName("wrecker")
            .setDescription("Your bias wrecker")
            .setRequired(true)
            .addChoices(...BTS_MEMBERS.map((member) => ({ name: member, value: member }))),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("show")
        .setDescription("Show a member's BTS bias")
        .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName("clear").setDescription("Clear your BTS bias")),
  async execute(ctx: CommandContext) {
    try {
      const args = ctx.args;
      const action = args[0]?.toLowerCase();

      if (action === "clear") {
        await ctx.services.bias.clear(ctx.guild.id, ctx.author.id);
        await ctx.reply({ content: "Your BTS bias has been cleared.", ephemeral: true });
        return;
      }

      if (action === "set") {
        const bias = normalizeMember(args[1]);
        const wrecker = normalizeMember(args[2]);
        if (!bias || !wrecker) {
          throw new UserError(`Use BTS members only: ${BTS_MEMBERS.join(", ")}.`);
        }
        if (bias === wrecker) throw new UserError("Your bias and bias wrecker must be different members.");
        await ctx.services.bias.set(ctx.guild.id, ctx.author.id, bias, wrecker);
        await ctx.reply(biasCard(ctx.member.displayName, bias, wrecker));
        return;
      }

      if (action === "show") {
        const userId = normalizeId(args[1]) ?? ctx.author.id;
        const member = await ctx.guild.members.fetch(userId).catch(() => null);
        if (!member) throw new UserError("Member not found.");
        const row = await ctx.services.bias.get(ctx.guild.id, member.id);
        if (!row) {
          await ctx.reply({
            content: member.id === ctx.author.id ? "You have not set a BTS bias yet." : `${member.displayName} has not set a BTS bias yet.`,
            ephemeral: true,
          });
          return;
        }
        await ctx.reply(biasCard(member.displayName, row.bias, row.biasWrecker));
        return;
      }

      const first = args[0];
      const second = args[1];
      const bias = normalizeMember(first);
      const wrecker = normalizeMember(second);
      if (first && second && bias && wrecker) {
        if (bias === wrecker) throw new UserError("Your bias and bias wrecker must be different members.");
        await ctx.services.bias.set(ctx.guild.id, ctx.author.id, bias, wrecker);
        await ctx.reply(biasCard(ctx.member.displayName, bias, wrecker));
        return;
      }

      const targetId = normalizeId(first);
      const targetMember = targetId ? await ctx.guild.members.fetch(targetId).catch(() => null) : null;
      if (targetMember) {
        const row = await ctx.services.bias.get(ctx.guild.id, targetMember.id);
        if (!row) {
          await ctx.reply({ content: `${targetMember.displayName} has not set a BTS bias yet.`, ephemeral: true });
          return;
        }
        await ctx.reply(biasCard(targetMember.displayName, row.bias, row.biasWrecker));
        return;
      }

      const row = await ctx.services.bias.get(ctx.guild.id, ctx.author.id);
      if (!row) {
        await ctx.reply({
          content: `No bias set yet. Use \`bias set <bias> <wrecker>\` with: ${BTS_MEMBERS.join(", ")}.`,
          ephemeral: true,
        });
        return;
      }
      await ctx.reply(biasCard(ctx.member.displayName, row.bias, row.biasWrecker));
    } catch (error) {
      const message = error instanceof UserError ? error.message : "Something went wrong.";
      await ctx.reply({ content: message, ephemeral: true }).catch(() => undefined);
    }
  },
};
