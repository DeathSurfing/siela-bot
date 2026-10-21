import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS, truncate } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";

export const translateCommand: Command = {
  name: "translate",
  aliases: ["tr"],
  category: "utility",
  description: "Translate a replied message (or text) into English.",
  usage: "[text]",
  examples: ["translate (as a reply)", "translate hello world"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("translate")
    .setDescription("Translate text or a replied message into English")
    .addStringOption((option) =>
      option.setName("text").setDescription("Text to translate; omit and reply to a message instead").setRequired(false),
    ),
  async execute(ctx: CommandContext) {
    const remaining = ctx.services.translation.checkRateLimit(ctx.author.id);
    if (remaining > 0) {
      await ctx.reply({
        content: `Please wait ${Math.ceil(remaining / 1000)}s before translating again.`,
        ephemeral: true,
      });
      return;
    }

    const replyId = ctx.message?.reference?.messageId;
    const text = ctx.args.join(" ").trim();
    if (!replyId && !text) {
      await ctx.reply({
        content: "Reply to a message with `translate`, or use `translate <text>`.",
        ephemeral: true,
      });
      return;
    }

    await ctx.defer();
    try {
      let result;
      if (replyId) {
        if (!ctx.channel.isTextBased()) throw new UserError("This channel is not text-based.");
        const target = await ctx.channel.messages.fetch(replyId).catch(() => null);
        if (!target) throw new UserError("I could not read the replied message.");
        const source = ctx.services.translation.extractText(target);
        if (!source) throw new UserError("That message has no translatable text.");
        result = await ctx.services.translation.translate(source);
      } else {
        result = await ctx.services.translation.translate(text);
      }

      const embed = new EmbedBuilder()
        .setColor(COLORS.primary)
        .setTitle("Translation → English")
        .addFields(
          {
            name: "Original",
            value: truncate(result.original, 1_000),
          },
          {
            name: "English",
            value: truncate(result.translated, 1_000),
          },
        )
        .setFooter({
          text: [
            result.detectedSource ? `Detected: ${result.detectedSource}` : null,
            result.cached ? "cached" : "LibreTranslate",
          ]
            .filter(Boolean)
            .join(" • "),
        });
      await ctx.edit({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Translation failed.";
      await ctx.edit({ content: message, allowedMentions: { parse: [] } });
    }
  },
};
