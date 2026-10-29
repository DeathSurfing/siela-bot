import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import { success } from "../../features/ui.js";
import { FleetClient } from "../../features/fleetClient.js";

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
      if (ctx.services.tambola.isUsingVoice(ctx.guild.id)) {
        throw new UserError("Tambola is using the voice channel. Finish the game before enabling TTS.");
      }
      const voiceChannelId = ctx.member.voice?.channelId ?? undefined;
      if (!voiceChannelId) throw new UserError("Join a voice channel first.");
      const music = ctx.services.music;
      const commanderBusy =
        !music || music.isVoiceLocked(ctx.guild.id) || music.isConnected(ctx.guild.id);
      const fleet = new FleetClient(
        ctx.services.config.ROUTER_URL ?? null,
        ctx.services.config.MCP_TOKEN,
        ctx.services.tts.logger,
        ctx.guild.id,
      );
      if (commanderBusy && fleet.enabled) {
        // Commander's voice is taken: bind sticky TTS to a free fleet node
        // instead of stealing the commander's connection.
        const nodeId = await fleet.ttsEnable(voiceChannelId);
        ctx.services.tts.recordRemoteSession(ctx.guild.id, nodeId, voiceChannelId);
        await ctx.reply(success(`TTS enabled on **${nodeId}** for <#${voiceChannelId}>. It stays there until you turn TTS off.`));
        return;
      }
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
