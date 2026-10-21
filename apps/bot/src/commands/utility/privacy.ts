import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";

export const privacyCommand: Command = {
  name: "privacy",
  category: "utility",
  description: "See what data is stored, or delete your own counter data.",
  usage: "[delete]",
  examples: ["privacy", "privacy delete"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("privacy")
    .setDescription("Data summary or deletion")
    .addSubcommand((sub) => sub.setName("info").setDescription("Show stored data"))
    .addSubcommand((sub) => sub.setName("delete").setDescription("Delete your counter and opt-out data")),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase() ?? "info";
    if (action === "delete") {
      await ctx.services.privacy.deleteUserData(ctx.guild.id, ctx.author.id);
      await ctx.services.audit.log({
        guildId: ctx.guild.id,
        actorId: ctx.author.id,
        actorType: "user",
        source: "discord",
        action: "privacy.delete",
        targetType: "user",
        targetId: ctx.author.id,
      });
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setDescription("Your counter and opt-out data has been deleted."),
        ],
        ephemeral: true,
      });
      return;
    }

    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("Privacy")
          .setDescription(
            [
              "Siela stores your Discord user ID, interaction counters, opt-outs, and temporary-VC ownership while it is active.",
              "Message content is not stored.",
              `Use \`${await ctx.services.settings.getPrefix(ctx.guild.id)}privacy delete\` to remove your counter/opt-out data.`,
            ].join("\n\n"),
          ),
      ],
      ephemeral: true,
    });
  },
};
