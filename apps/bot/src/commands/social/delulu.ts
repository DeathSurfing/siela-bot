import { AttachmentBuilder, EmbedBuilder, SlashCommandBuilder } from "discord.js";
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
    const audio = await ctx.services.tts.synthesize(scenario, row.bias);
    const embed = new EmbedBuilder()
      .setColor(COLORS.social)
      .setTitle(`✨ Delulu: ${row.bias} notices you`)
      .setDescription(scenario);
    await ctx.edit({
      embeds: [embed],
      files: audio ? [new AttachmentBuilder(audio, { name: "delulu.wav" })] : undefined,
    });
  },
};
