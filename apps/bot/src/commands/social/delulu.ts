import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { card } from "../../features/ui.js";
import { UserError } from "../../lib/errors.js";

export const deluluCommand: Command = {
  name: "delulu",
  category: "social",
  description: "Generate a ridiculous fictional scenario where your BTS bias notices you.",
  usage: "[nsfw]",
  examples: ["delulu", "delulu nsfw"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("delulu")
    .setDescription("Generate a delulu BTS bias scenario")
    .addBooleanOption((option) =>
      option
        .setName("nsfw")
        .setDescription("Generate an NSFW-focused delulu scenario")
        .setRequired(false),
    ),
  async execute(ctx: CommandContext) {
    const optionNsfw = (ctx.interaction?.options as { getBoolean?: (name: string) => boolean | null } | undefined)?.getBoolean?.("nsfw");
    const nsfw = optionNsfw ?? ctx.args.some((arg) =>
      ["true", "nsfw", "on", "1"].includes(arg.toLowerCase()),
    );
    const row = await ctx.services.bias.get(ctx.guild.id, ctx.author.id);
    if (!row) {
      await ctx.reply({
        content: "Set your bias first with `bias <member> <wrecker>`.",
        ephemeral: true,
      });
      return;
    }
    const kind = nsfw ? "delulu_nsfw" : "delulu";
    const used = await ctx.services.economy
      .countDeluluUsesToday(ctx.guild.id, ctx.author.id, kind)
      .catch(() => 0);
    const limit = nsfw ? 2 : 4;
    if (used >= limit) {
      throw new UserError(
        `Daily ${nsfw ? "NSFW " : ""}delulu limit reached (${limit} uses). Try again tomorrow.`,
      );
    }
    const cost = (nsfw ? 15 : 5) * 2 ** used;
    const paymentId = `delulu:${kind}:${ctx.guild.id}:${ctx.author.id}:${Date.now()}`;
    try {
      await ctx.services.economy.spend(
        ctx.guild.id,
        ctx.author.id,
        cost,
        kind,
        paymentId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment failed.";
      if (message === "INSUFFICIENT_FUNDS") {
        throw new UserError(
          `You need ${cost} SC for delulu${nsfw ? " NSFW" : ""} (use ${used + 1} today).`,
        );
      }
      throw new UserError(message);
    }
    await ctx.defer();
    try {
      const scenario = await ctx.services.delulu.generate(row.bias, nsfw);
      await ctx.edit(
        card({
          title: `${row.bias} notices you`,
          subtitle: nsfw ? "NSFW delulu scenario" : "Delulu scenario",
          body: scenario,
        }),
      );
    } catch (error) {
      try {
        await ctx.services.economy.award(ctx.guild.id, ctx.author.id, cost, "delulu_refund", `${paymentId}:refund`);
      } catch (refundError) {
        await ctx.services.audit.log({
          guildId: ctx.guild.id,
          actorId: ctx.author.id,
          source: "discord",
          action: "delulu.refund_failed",
          targetType: "user",
          targetId: ctx.author.id,
          after: { cost, error: refundError instanceof Error ? refundError.message : String(refundError) },
        });
      }
      throw new UserError("Delulu generation failed. Your coins have been refunded.");
    }
  },
};
