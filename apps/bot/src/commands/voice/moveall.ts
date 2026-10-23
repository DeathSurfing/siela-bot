import { ChannelType, PermissionFlagsBits, SlashCommandBuilder, type VoiceChannel } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { isAdmin } from "../../framework/permissions.js";
import { UserError } from "../../lib/errors.js";
import { ICONS, card, error as uiError, success } from "../../features/ui.js";

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<#|>$/g, "");
}

export const moveallCommand: Command = {
  name: "moveall",
  aliases: ["moveallusers", "moveeveryone"],
  category: "voice",
  description: "Move everyone in your voice channel to another voice channel.",
  usage: "<#target-vc> [reason]",
  examples: ["moveall #lobby", "moveall 123456789 moving to lobby"],
  adminOnly: true,
  cooldownMs: 3_000,
  botPermissions: [PermissionFlagsBits.MoveMembers],
  slash: new SlashCommandBuilder()
    .setName("moveall")
    .setDescription("Move everyone in your voice channel to another voice channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option.setName("channel").setDescription("Target voice channel").setRequired(true).addChannelTypes(ChannelType.GuildVoice),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the move").setRequired(false),
    ),
  async execute(ctx: CommandContext) {
    try {
      const source = ctx.member.voice.channel;
      if (!source || source.type !== ChannelType.GuildVoice) {
        throw new UserError("Join a voice channel first.");
      }

      const targetId = normalizeId(ctx.args[0]);
      if (!targetId) {
        throw new UserError("Usage: `moveall <#target-vc> [reason]`");
      }
      const target = await ctx.guild.channels.fetch(targetId).catch(() => null);
      if (!target || target.type !== ChannelType.GuildVoice) {
        throw new UserError("Target must be a voice channel.");
      }
      if (target.id === source.id) {
        throw new UserError("Target channel is the same as your current channel.");
      }

      const me = ctx.guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
        throw new UserError("I need the Move Members permission.");
      }
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("Only admins can use this command.");
      }

      const reason = ctx.args.slice(1).join(" ").trim() || "Moved by admin";
      const members = [...(source as VoiceChannel).members.values()].filter((m) => !m.user.bot);

      if (members.length === 0) {
        throw new UserError("No members to move.");
      }

      let moved = 0;
      const failed: string[] = [];
      for (const member of members) {
        try {
          await member.voice.setChannel(target as VoiceChannel, reason);
          moved += 1;
        } catch {
          failed.push(member.displayName);
        }
      }

      await ctx.reply(
        success(
          `Moved ${moved} member(s) to <#${target.id}>.${failed.length ? ` Failed: ${failed.join(", ")}` : ""}`,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "That action failed.";
      await ctx.reply(uiError(message));
    }
  },
};
