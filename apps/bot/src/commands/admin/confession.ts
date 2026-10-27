import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { isSnowflake } from "@siela/shared";
import { attachConfirmation, card, confirmCard } from "../../features/ui.js";
import type { Command, CommandContext } from "../../framework/types.js";

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<#|>$/g, "");
}

export const confessionCommand: Command = {
  name: "confession",
  aliases: ["confessions"],
  category: "admin",
  description: "Configure and moderate the confession wall.",
  usage: "channel <#channel> | channel clear | delete <number> | status",
  examples: ["confession channel #confessions", "confession delete 42", "confession status"],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("confession")
    .setDescription("Configure and moderate the confession wall")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("channel")
        .setDescription("Set the confession wall channel")
        .addChannelOption((option) => option.setName("channel").setDescription("Text channel").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("clear").setDescription("Clear the confession wall channel"))
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a confession by number")
        .addIntegerOption((option) => option.setName("number").setDescription("Confession number").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("status").setDescription("Show confession wall status")),
  async execute(ctx: CommandContext) {
    const sub = (ctx.args[0] ?? "").toLowerCase();
    if (sub === "channel") {
      if (ctx.args[1]?.toLowerCase() === "clear") {
        await ctx.services.confession.clearChannel(ctx.guild.id, ctx.author.id);
        await ctx.reply({ content: "Confession wall cleared.", ephemeral: true });
        return;
      }
      const channelId = normalizeId(ctx.args[1]);
      if (!channelId || !isSnowflake(channelId)) {
        await ctx.reply({ content: "Usage: `confession channel #channel`", ephemeral: true });
        return;
      }
      const channel = await ctx.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await ctx.reply({ content: "That is not a text channel.", ephemeral: true });
        return;
      }
      await ctx.services.confession.setChannel(ctx.guild.id, channelId, ctx.author.id);
      await ctx.reply({ content: `Confession wall set to <#${channelId}>.`, ephemeral: true });
      return;
    }
    if (sub === "clear") {
      await ctx.services.confession.clearChannel(ctx.guild.id, ctx.author.id);
      await ctx.reply({ content: "Confession wall cleared.", ephemeral: true });
      return;
    }
    if (sub === "delete") {
      const number = Number(ctx.args[1]);
      if (!Number.isInteger(number) || number < 1) {
        await ctx.reply({ content: "Usage: `confession delete <number>`", ephemeral: true });
        return;
      }
      const confirmId = "confession:delete:confirm";
      const cancelId = "confession:delete:cancel";
      const message = await ctx.reply(
        confirmCard({
          title: `Delete confession #${number}?`,
          body: "This removes the confession from the wall.",
          confirmId,
          cancelId,
          confirmLabel: "Delete",
        }),
      );
      if (!message) return;
      attachConfirmation({
        message,
        userId: ctx.author.id,
        confirmId,
        cancelId,
        onConfirm: async () => {
          await ctx.services.confession.delete(ctx.guild.id, number, ctx.author.id);
          return card({ theme: "admin", title: "Deleted", body: `Confession #${number} was deleted.` });
        },
        onCancel: () => card({ theme: "admin", title: "Cancelled", body: "The confession was not deleted." }),
      });
      return;
    }
    if (sub === "status") {
      const channelId = await ctx.services.confession.getChannel(ctx.guild.id);
      await ctx.reply(
        card({ theme: "admin",
          title: "Confession wall",
          body: channelId ? `**Channel** · <#${channelId}>` : "No confession wall configured.",
          ephemeral: true,
        }),
      );
      return;
    }
    await ctx.reply({ content: "Usage: `confession channel #channel | channel clear | delete <number> | status`", ephemeral: true });
  },
};
