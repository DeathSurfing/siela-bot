import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";

export const confessCommand: Command = {
  name: "confess",
  category: "social",
  description: "Post an anonymous confession to the configured wall.",
  usage: "<text>",
  examples: ["confess I really like pineapple on pizza"],
  cooldownMs: 1_000,
  slash: new SlashCommandBuilder()
    .setName("confess")
    .setDescription("Post an anonymous confession")
    .addStringOption((option) =>
      option.setName("text").setDescription("Confession text").setRequired(true).setMaxLength(2000),
    ),
  async execute(ctx: CommandContext) {
    const text = ctx.rawArgs.trim();
    if (!text) {
      await ctx.reply({ content: "Usage: `confess <text>`", ephemeral: true });
      return;
    }
    const number = await ctx.services.confession.post(ctx.guild.id, ctx.author.id, text);
    await ctx.reply({ content: `Your confession was posted anonymously as #${number}.`, ephemeral: true });
  },
};
