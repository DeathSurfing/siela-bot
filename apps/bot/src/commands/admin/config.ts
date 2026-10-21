import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { COLORS } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";

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
    const [prefix, welcome, autorole, tempvc, music] = await Promise.all([
      ctx.services.settings.getPrefix(ctx.guild.id),
      ctx.services.settings.getWelcome(ctx.guild.id),
      ctx.services.settings.getAutoRole(ctx.guild.id),
      ctx.services.settings.getTempVc(ctx.guild.id),
      ctx.services.settings.getMusic(ctx.guild.id),
    ]);
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.admin)
          .setTitle("Server configuration")
          .addFields(
            { name: "Prefix", value: `\`${prefix}\``, inline: true },
            { name: "Welcome", value: welcome.enabled ? `<#${welcome.channelId}>` : "disabled", inline: true },
            { name: "Auto-role", value: autorole.enabled ? autorole.roleIds.map((id) => `<@&${id}>`).join(", ") || "enabled, no roles" : "disabled", inline: false },
            { name: "Temp VC", value: tempvc.enabled ? `hub <#${tempvc.hubChannelId}>` : "disabled", inline: true },
            { name: "Music", value: `volume ${music.defaultVolume} • queue ${music.maxQueueSize}`, inline: true },
          )
          .setFooter({ text: "Use the feature commands or MCP tools to change these values" }),
      ],
      ephemeral: true,
    });
  },
};
