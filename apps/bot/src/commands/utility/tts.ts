import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import { success } from "../../features/ui.js";

export const ttsCommand: Command = {
  name: "tts",
  category: "utility",
  description: "Toggle TTS for the current voice channel.",
  usage: "<on|off>",
  examples: ["tts on", "tts off"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder()
    .setName("tts")
    .setDescription("Toggle TTS")
    .addSubcommand((sub) => sub.setName("on").setDescription("Enable TTS in your voice channel"))
    .addSubcommand((sub) => sub.setName("off").setDescription("Disable TTS")),
  async execute(ctx) {
    const action = (ctx.args[0] ?? "status").toLowerCase();
    if (action === "on" || action === "enable" || action === "start") {
      await ctx.services.tts.enable(ctx.guild.id, ctx.member, null);
      await ctx.reply(success("TTS enabled for this voice channel."));
      return;
    }
    if (action === "off" || action === "disable" || action === "stop") {
      await ctx.services.tts.disable(ctx.guild.id);
      await ctx.reply(success("TTS disabled."));
      return;
    }
    throw new UserError("Use `tts on` or `tts off`.");
  },
};
