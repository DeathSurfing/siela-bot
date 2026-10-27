import { styleMessage } from "../../features/ui.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { success } from "../../features/ui.js";

const TEST_USER_IDS = new Set(["197768227936403458", "777455348725973003"]);

export const testCommand: Command = {
  name: "test",
  category: "admin",
  description: "Run the full scheduled voice event workflow for testing.",
  usage: "<azan|anthem|hanumanchalisa|church|monastery|gurudwara>",
  examples: ["test azan", "test anthem", "test hanumanchalisa", "test church", "test monastery", "test gurudwara"],
  cooldownMs: 2_000,
  async execute(ctx: CommandContext) {
    if (!TEST_USER_IDS.has(ctx.author.id)) {
      await ctx.reply({ content: "Not allowed.", ephemeral: true });
      return;
    }
    const kind = ctx.args[0];
    if (!kind) {
      await ctx.reply({ content: "Usage: `test <azan|anthem|hanumanchalisa|church|monastery|gurudwara>`", ephemeral: true });
      return;
    }
    const message = await ctx.reply({ content: `Running scheduled event test: **${kind}**…` });
    try {
      const result = await ctx.services.scheduledEvents.test(kind, ctx.guild);
      const file = result.audio.split("/").pop() ?? result.audio;
      await message?.edit(styleMessage(success(`Test complete: **${result.phase}** in **${result.channel}** using \`${file}\`.`)));
    } catch (error) {
      await message?.edit(styleMessage({
        content: error instanceof Error ? error.message : "That test phase failed.",
      }));
    }
  },
};
