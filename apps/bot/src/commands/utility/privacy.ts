import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { attachConfirmation, card, confirmCard } from "../../features/ui.js";

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
      const confirmId = "privacy:delete:confirm";
      const cancelId = "privacy:delete:cancel";
      const message = await ctx.reply(
        confirmCard({
          title: "Delete your data?",
          body: "This removes your interaction counters and opt-outs. This cannot be undone.",
          confirmId,
          cancelId,
          confirmLabel: "Delete data",
        }),
      );
      if (!message) return;
      attachConfirmation({
        message,
        userId: ctx.author.id,
        confirmId,
        cancelId,
        onConfirm: async () => {
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
          return card({ title: "Deleted", body: "Your counter and opt-out data has been deleted." });
        },
        onCancel: () => card({ title: "Cancelled", body: "No data was deleted." }),
      });
      return;
    }

    await ctx.reply(
      card({
        title: "Privacy",
        body: [
          "Siela stores your Discord user ID, interaction counters, opt-outs, and temporary-VC ownership while it is active.",
          "Message content is not stored.",
          `-# Use \`${await ctx.services.settings.getPrefix(ctx.guild.id)}privacy delete\` to remove your counter and opt-out data.`,
        ].join("\n\n"),
      }),
    );
  },
};
