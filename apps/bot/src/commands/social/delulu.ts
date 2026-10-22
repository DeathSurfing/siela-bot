import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";

export const deluluCommand: Command = {
  name: "delulu",
  category: "social",
  description: "Generate a ridiculous fictional scenario where your BTS bias notices you.",
  usage: "",
  examples: ["delulu"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("delulu")
    .setDescription("Generate a delulu BTS bias scenario"),
  async execute(ctx: CommandContext) {
    const row = await ctx.services.bias.get(ctx.guild.id, ctx.author.id);
    if (!row) {
      await ctx.reply({
        content: "Set your bias first with `bias <member> <wrecker>`.",
        ephemeral: true,
      });
      return;
    }
    await ctx.defer();
    const scenario = await ctx.services.delulu.generate(row.bias);
    await ctx.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.social)
          .setTitle(`✨ Delulu: ${row.bias} notices you`)
          .setDescription(scenario)
          .setFooter({ text: "Completely fictional. Your delulu is valid." }),
      ],
    });
  },
};
