import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { card } from "../../features/ui.js";

export const configCommand: Command = {
  name: "config",
  category: "admin",
  description: "Read-only overview of all server feature settings.",
  usage: "",
  examples: ["config"],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Overview of all server settings")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(ctx: CommandContext) {
    const [prefix, welcome, autorole, tempvc, music, relics] = await Promise.all([
      ctx.services.settings.getPrefix(ctx.guild.id),
      ctx.services.settings.getWelcome(ctx.guild.id),
      ctx.services.settings.getAutoRole(ctx.guild.id),
      ctx.services.settings.getTempVc(ctx.guild.id),
      ctx.services.settings.getMusic(ctx.guild.id),
      ctx.services.relics.getSettings(ctx.guild.id),
    ]);
    await ctx.reply(
      card({
        title: "Server configuration",
        body: [
          `**Prefix** · \`${prefix}\``,
          `**Welcome** · ${welcome.enabled ? `<#${welcome.channelId}>` : "disabled"}`,
          `**Auto-role** · ${autorole.enabled ? autorole.roleIds.map((id) => `<@&${id}>`).join(", ") || "enabled, no roles" : "disabled"}`,
          `**Temp VC** · ${tempvc.enabled ? `hub <#${tempvc.hubChannelId}>` : "disabled"}`,
          `**Music** · volume ${music.defaultVolume} · queue ${music.maxQueueSize}`,
          `**Relics** · ${relics.enabled ? `auctions in ${relics.channelId ? `<#${relics.channelId}>` : "no channel"}` : "disabled"}`,
          "",
          "-# Use the feature commands to change these values.",
        ].join("\n"),
        ephemeral: true,
      }),
    );
  },
};
