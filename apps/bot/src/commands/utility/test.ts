import type { Command, CommandContext } from "../../framework/types.js";

const TEST_USER_ID = "197768227936403458";

export const testCommand: Command = {
  name: "test",
  category: "admin",
  description: "Run a scheduled voice event phase for testing.",
  usage: "<azan|anthem|hanumanchalisa>",
  examples: ["test azan", "test anthem", "test hanumanchalisa"],
  cooldownMs: 2_000,
  async execute(ctx: CommandContext) {
    if (ctx.author.id !== TEST_USER_ID) {
      await ctx.reply({ content: "Not allowed.", ephemeral: true });
      return;
    }
    const kind = ctx.args[0];
    if (!kind) {
      await ctx.reply({ content: "Usage: `test <azan|anthem|hanumanchalisa>`", ephemeral: true });
      return;
    }
    try {
      const result = await ctx.services.scheduledEvents.test(kind, ctx.guild);
      const file = result.audio.split("/").pop() ?? result.audio;
      await ctx.reply({
        content: `Started **${result.phase}** in **${result.channel}** using \`${file}\`.`,
      });
    } catch (error) {
      await ctx.reply({
        content: error instanceof Error ? error.message : "That test phase could not start.",
        ephemeral: true,
      });
    }
  },
};
