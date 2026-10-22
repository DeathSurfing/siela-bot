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
    const nsfw = ctx.args.some((arg) =>
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
    const cost = nsfw ? 15 : 5;
    try {
      await ctx.services.economy.spend(
        ctx.guild.id,
        ctx.author.id,
        cost,
        "delulu",
        `delulu:${ctx.guild.id}:${ctx.author.id}:${Date.now()}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment failed.";
      if (message === "INSUFFICIENT_FUNDS") {
        throw new UserError(`You need ${cost} SC to run delulu${nsfw ? " NSFW" : ""}.`);
      }
      throw new UserError(message);
    }
    const paymentId = `delulu:${ctx.guild.id}:${ctx.author.id}:${Date.now()}`;
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
      await ctx.services.economy
        .award(ctx.guild.id, ctx.author.id, cost, "delulu_refund", `${paymentId}:refund`)
        .catch(() => undefined);
      throw new UserError("Delulu generation failed. Your coins have been refunded.");
    }
  },
};
