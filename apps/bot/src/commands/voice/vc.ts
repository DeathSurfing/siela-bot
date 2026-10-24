import { ChannelType, SlashCommandBuilder, type VoiceChannel } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { canManageTempVc, isAdmin } from "../../framework/permissions.js";
import { UserError } from "../../lib/errors.js";
import { ICONS, card, error as uiError, success } from "../../features/ui.js";

function currentChannel(ctx: CommandContext): VoiceChannel {
  const channel = ctx.member.voice.channel;
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    throw new UserError("Join your temporary voice channel first.");
  }
  return channel;
}

async function requireOwned(ctx: CommandContext): Promise<{ channel: VoiceChannel; ownerId: string }> {
  const channel = currentChannel(ctx);
  const row = await ctx.services.tempVc.getRow(channel.id);
  if (!row || row.status !== "active") throw new UserError("You are not in an active temporary VC.");
  if (!canManageTempVc(ctx.member, row.ownerId, ctx.services.config)) {
    throw new UserError("Only the channel owner or an admin can do that.");
  }
  return { channel, ownerId: row.ownerId };
}

async function targetMember(ctx: CommandContext, index = 1) {
  const id = ctx.args[index];
  if (!id) throw new UserError("Mention a member.");
  const member = await ctx.guild.members.fetch(id).catch(() => null);
  if (!member) throw new UserError("That member is not in the server.");
  return member;
}

function audit(ctx: CommandContext, action: string, targetId: string, after?: unknown) {
  return ctx.services.audit.log({
    guildId: ctx.guild.id,
    actorId: ctx.author.id,
    actorType: "user",
    source: "discord",
    action,
    targetType: "tempvc",
    targetId,
    after,
  });
}

export const vcCommand: Command = {
  name: "vc",
  category: "voice",
  description: "Control your temporary voice channel.",
  usage: "<lock|unlock|permit|deny|disconnect|rename|limit|claim|transfer|delete|panel|info>",
  examples: ["vc lock", "vc permit @user", "vc rename Chill Zone", "vc limit 10", "vc claim"],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("vc")
    .setDescription("Control your temporary voice channel")
    .addSubcommand((sub) => sub.setName("lock").setDescription("Lock the channel"))
    .addSubcommand((sub) => sub.setName("unlock").setDescription("Unlock the channel"))
    .addSubcommand((sub) =>
      sub.setName("permit").setDescription("Allow a member to join").addUserOption((option) =>
        option.setName("user").setDescription("Member").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("deny").setDescription("Deny a member and disconnect them").addUserOption((option) =>
        option.setName("user").setDescription("Member").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("disconnect").setDescription("Disconnect a member").addUserOption((option) =>
        option.setName("user").setDescription("Member").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("rename").setDescription("Rename the channel").addStringOption((option) =>
        option.setName("name").setDescription("New name").setRequired(true).setMaxLength(100),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("limit").setDescription("Set the user limit").addIntegerOption((option) =>
        option.setName("limit").setDescription("0 = unlimited").setRequired(true).setMinValue(0).setMaxValue(99),
      ),
    )
    .addSubcommand((sub) => sub.setName("claim").setDescription("Claim an ownerless channel"))
    .addSubcommand((sub) =>
      sub.setName("transfer").setDescription("Transfer ownership").addUserOption((option) =>
        option.setName("user").setDescription("New owner").setRequired(true),
      ),
    )
    .addSubcommand((sub) => sub.setName("delete").setDescription("Delete the channel"))
    .addSubcommand((sub) => sub.setName("panel").setDescription("Post or refresh the VC control panel"))
    .addSubcommand((sub) => sub.setName("info").setDescription("Show channel info")),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase();
    if (!action) {
      await ctx.reply({ content: "Usage: `vc <lock|unlock|permit|deny|disconnect|rename|limit|claim|transfer|delete|panel|info>`", ephemeral: true });
      return;
    }

    try {
      if (action === "panel") {
        const { channel } = await requireOwned(ctx);
        await ctx.services.tempVc.ensurePanel(channel.id);
        await audit(ctx, "vc.panel", channel.id);
        await ctx.reply(success("VC control panel refreshed."));
        return;
      }

      if (action === "info") {
        const channel = currentChannel(ctx);
        const row = await ctx.services.tempVc.getRow(channel.id);
        if (!row) throw new UserError("This is not a temporary VC.");
        await ctx.reply(
          card({
            title: `${ICONS.voice} ${channel.name}`,
            subtitle: `Owner <@${row.ownerId}> · created <t:${Math.floor(row.createdAt.getTime() / 1000)}:R>`,
            body: `**${row.locked ? "Locked" : "Open"}** · limit ${row.userLimit === 0 ? "unlimited" : row.userLimit}`,
          }),
        );
        return;
      }

      if (action === "claim") {
        const channel = currentChannel(ctx);
        await ctx.services.tempVc.claim(channel.id, ctx.author.id);
        await audit(ctx, "vc.claim", channel.id);
        await ctx.reply(success(`You now own **${channel.name}**.`));
        return;
      }

      if (action === "lock" || action === "unlock" || action === "rename" || action === "limit" || action === "delete") {
        const { channel } = await requireOwned(ctx);
        if (action === "lock") {
          await ctx.services.tempVc.lock(channel.id, ctx.author.id);
        } else if (action === "unlock") {
          await ctx.services.tempVc.unlock(channel.id, ctx.author.id);
        } else if (action === "rename") {
          const name = ctx.args.slice(1).join(" ").trim();
          if (!name) throw new UserError("Provide a new channel name.");
          await ctx.services.tempVc.rename(channel.id, name);
        } else if (action === "limit") {
          const limit = Number(ctx.args[1]);
          if (!Number.isInteger(limit) || limit < 0 || limit > 99) throw new UserError("Limit must be 0-99.");
          await ctx.services.tempVc.setLimit(channel.id, limit);
        } else {
          await ctx.services.tempVc.delete(channel.id, "Owner deleted temporary VC");
        }
        await audit(ctx, `vc.${action}`, channel.id, { args: ctx.args.slice(1) });
        const message =
          action === "lock" ? "Locked the channel."
          : action === "unlock" ? "Unlocked the channel."
          : action === "rename" ? "Renamed the channel."
          : action === "limit" ? (Number(ctx.args[1]) === 0 ? "Removed the user limit." : `Set the user limit to ${Number(ctx.args[1])}.`)
          : "Deleted the channel.";
        await ctx.reply(success(message));
        return;
      }

      if (action === "permit" || action === "deny" || action === "disconnect" || action === "transfer") {
        const { channel, ownerId } = await requireOwned(ctx);
        const target = await targetMember(ctx);
        if (action === "permit") await ctx.services.tempVc.permit(channel.id, target.id);
        if (action === "deny") await ctx.services.tempVc.deny(channel.id, target.id);
        if (action === "disconnect") await ctx.services.tempVc.disconnect(channel.id, target.id);
        if (action === "transfer") {
          if (ctx.author.id !== ownerId && !isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
            throw new UserError("Only the owner can transfer ownership.");
          }
          await ctx.services.tempVc.transfer(channel.id, target.id);
        }
        await audit(ctx, `vc.${action}`, channel.id, { targetId: target.id });
        const message =
          action === "permit" ? `Allowed ${target.displayName}.`
          : action === "deny" ? `Removed ${target.displayName}'s access.`
          : action === "disconnect" ? `Disconnected ${target.displayName}.`
          : `Transferred ownership to ${target.displayName}.`;
        await ctx.reply(success(message));
        return;
      }

      await ctx.reply({ content: "Unknown `vc` subcommand.", ephemeral: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "That action failed.";
      await ctx.reply(uiError(message));
    }
  },
};
