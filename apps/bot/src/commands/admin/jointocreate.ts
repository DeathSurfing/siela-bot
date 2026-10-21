import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CategoryChannel,
  type VoiceChannel,
} from "discord.js";
import { COLORS } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<#|>$/g, "");
}

function configEmbed(settings: Awaited<ReturnType<CommandContext["services"]["settings"]["getTempVc"]>>) {
  return new EmbedBuilder()
    .setColor(COLORS.voice)
    .setTitle("Join to create")
    .addFields(
      { name: "Enabled", value: settings.enabled ? "yes" : "no", inline: true },
      { name: "Hub channel", value: settings.hubChannelId ? `<#${settings.hubChannelId}>` : "not set", inline: true },
      { name: "Category", value: settings.categoryId ? `<#${settings.categoryId}>` : "server root", inline: true },
      { name: "Name template", value: `\`${settings.nameTemplate}\``, inline: false },
      { name: "Default locked", value: settings.defaultLocked ? "yes" : "no", inline: true },
      { name: "Grace", value: `${settings.graceSeconds}s`, inline: true },
    );
}

async function connectivityWarning(ctx: CommandContext): Promise<string | null> {
  const roles = ctx.guild.roles.cache.filter(
    (role) => !role.managed && role.id !== ctx.guild.id && role.permissions.has(PermissionFlagsBits.Connect),
  );
  if (!roles.size) return null;
  return `${roles.size} role(s) have Connect at the server level and may bypass a channel deny. Prefer a dedicated category with no role-level Connect allows.`;
}

export const joinToCreateCommand: Command = {
  name: "jointocreate",
  aliases: ["j2c", "jtc"],
  category: "admin",
  description: "Set the voice channel members join to get their own temporary VC.",
  usage: "<#voice-channel> [#category] | status | disable",
  examples: ["jointocreate #Join to Create", "jointocreate #Join to Create #Private VCs", "jointocreate status", "jointocreate disable"],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("jointocreate")
    .setDescription("Configure the join-to-create temporary VC hub")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set the hub voice channel")
        .addChannelOption((option) =>
          option.setName("hub").setDescription("Voice channel members join").setRequired(true),
        )
        .addChannelOption((option) =>
          option.setName("category").setDescription("Category for created channels").setRequired(false),
        ),
    )
    .addSubcommand((sub) => sub.setName("status").setDescription("Show the current setup"))
    .addSubcommand((sub) => sub.setName("disable").setDescription("Disable join-to-create")),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase();
    const before = await ctx.services.settings.getTempVc(ctx.guild.id);

    try {
      if (!action || action === "status" || action === "show") {
        await ctx.reply({ embeds: [configEmbed(before)], ephemeral: true });
        return;
      }

      if (action === "disable" || action === "off") {
        const after = await ctx.services.settings.updateTempVc(ctx.guild.id, { enabled: false }, ctx.author.id);
        await ctx.services.audit.log({
          guildId: ctx.guild.id,
          actorId: ctx.author.id,
          actorType: "user",
          source: "discord",
          action: "jointocreate.disable",
          before,
          after,
        });
        await ctx.reply({ content: "Join-to-create disabled.", ephemeral: true });
        return;
      }

      if (action === "set" || action.startsWith("<#") || /^\d{17,20}$/.test(action)) {
        const hubArg = action === "set" ? ctx.args[1] : ctx.args[0];
        const categoryArg = action === "set" ? ctx.args[2] : ctx.args[1];
        const hubId = normalizeId(hubArg);
        if (!hubId) throw new Error("Mention the voice channel members should join.");
        const hub = await ctx.guild.channels.fetch(hubId).catch(() => null);
        if (!hub || hub.type !== ChannelType.GuildVoice) {
          throw new Error("The hub must be a voice channel.");
        }

        const categoryId = normalizeId(categoryArg) ?? (hub as VoiceChannel).parentId ?? before.categoryId ?? undefined;
        let category: CategoryChannel | null = null;
        if (categoryId) {
          const fetched = await ctx.guild.channels.fetch(categoryId).catch(() => null);
          if (fetched && fetched.type === ChannelType.GuildCategory) category = fetched;
        }

        const after = await ctx.services.settings.updateTempVc(
          ctx.guild.id,
          {
            hubChannelId: hub.id,
            categoryId: category?.id ?? null,
            enabled: true,
          },
          ctx.author.id,
        );
        await ctx.services.audit.log({
          guildId: ctx.guild.id,
          actorId: ctx.author.id,
          actorType: "user",
          source: "discord",
          action: "jointocreate.set",
          before,
          after,
        });
        const warning = await connectivityWarning(ctx);
        await ctx.reply({
          content: [
            `Join-to-create enabled.`,
            `Hub: <#${hub.id}>`,
            `Category: ${category ? `<#${category.id}>` : "server root (consider setting a category)"}`,
            warning ? `⚠️ ${warning}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          ephemeral: true,
        });
        return;
      }

      throw new Error("Usage: `jointocreate <#voice-channel> [#category]`, `jointocreate status`, or `jointocreate disable`.");
    } catch (error) {
      await ctx.reply({ content: error instanceof Error ? error.message : "That action failed.", ephemeral: true });
    }
  },
};
