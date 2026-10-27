import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CategoryChannel,
} from "discord.js";
import { DEFAULTS, isSnowflake } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { card } from "../../features/ui.js";

const TEMP_CATEGORY_NAME = "Temporary VCs";

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<#|>$/g, "");
}

function configCard(settings: Awaited<ReturnType<CommandContext["services"]["settings"]["getTempVc"]>>) {
  return card({ theme: "admin",
    title: "Join to create",
    body: [
      `**Enabled** · ${settings.enabled ? "On" : "Off"}`,
      `**Hub** · ${settings.hubChannelId ? `<#${settings.hubChannelId}>` : "Not set"}`,
      `**Category** · ${settings.categoryId ? `<#${settings.categoryId}>` : "auto-created on setup"}`,
      `**Name template** · \`${settings.nameTemplate}\``,
      `**Default locked** · ${settings.defaultLocked ? "On" : "Off"}`,
      `**Grace** · ${settings.graceSeconds}s`,
    ].join("\n"),
    ephemeral: true,
  });
}

async function connectivityWarning(ctx: CommandContext): Promise<string | null> {
  const roles = ctx.guild.roles.cache.filter(
    (role) => !role.managed && role.id !== ctx.guild.id && role.permissions.has(PermissionFlagsBits.Connect),
  );
  if (!roles.size) return null;
  return `${roles.size} role(s) have Connect at the server level and may bypass a channel deny. Prefer a dedicated category with no role-level Connect allows.`;
}

function validateTemplate(template: string): string {
  const value = template.trim();
  if (!value) throw new Error("Provide a name template.");
  if (value.length > 100) throw new Error("Name template must be 100 characters or fewer.");
  if (!/\{(user|username|displayName)\}/.test(value)) {
    throw new Error("Name template must include `{user}`, `{username}`, or `{displayName}` so channels stay unique.");
  }
  return value;
}

async function findOrCreateCategory(
  ctx: CommandContext,
  existingId: string | null,
): Promise<{ category: CategoryChannel; created: boolean }> {
  if (existingId) {
    const current = await ctx.guild.channels.fetch(existingId).catch(() => null);
    if (current?.type === ChannelType.GuildCategory) return { category: current, created: false };
  }

  const cached = ctx.guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory &&
      channel.name.toLowerCase() === TEMP_CATEGORY_NAME.toLowerCase(),
  );
  if (cached?.type === ChannelType.GuildCategory) return { category: cached, created: false };

  const category = await ctx.guild.channels.create({
    name: TEMP_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: "Join-to-create temporary VC category",
  });
  await category.permissionOverwrites
    .create(ctx.guild.roles.everyone, { ViewChannel: true, Connect: false })
    .catch(() => undefined);
  return { category, created: true };
}

async function setHub(ctx: CommandContext, args: string[]): Promise<void> {
  const before = await ctx.services.settings.getTempVc(ctx.guild.id);
  const hubId = normalizeId(args[0]);
  if (!hubId) throw new Error("Mention the voice channel members should join.");
  const hub = await ctx.guild.channels.fetch(hubId).catch(() => null);
  if (!hub || hub.type !== ChannelType.GuildVoice) {
    throw new Error("The hub must be a voice channel.");
  }

  let categoryArg = args[1];
  let templateParts = args.slice(2);
  if (categoryArg && !isSnowflake(normalizeId(categoryArg) ?? "")) {
    templateParts = args.slice(1);
    categoryArg = undefined;
  }

  let category: CategoryChannel | null = null;
  let categoryCreated = false;
  if (categoryArg) {
    const categoryId = normalizeId(categoryArg);
    const fetched = categoryId ? await ctx.guild.channels.fetch(categoryId).catch(() => null) : null;
    if (!fetched || fetched.type !== ChannelType.GuildCategory) {
      throw new Error("That category does not exist.");
    }
    category = fetched;
  } else {
    const resolved = await findOrCreateCategory(ctx, before.categoryId);
    category = resolved.category;
    categoryCreated = resolved.created;
  }

  const template = templateParts.length
    ? validateTemplate(templateParts.join(" "))
    : before.nameTemplate || DEFAULTS.tempVcNameTemplate;

  const after = await ctx.services.settings.updateTempVc(
    ctx.guild.id,
    {
      hubChannelId: hub.id,
      categoryId: category.id,
      nameTemplate: template,
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
      "Join-to-create enabled.",
      `Hub: <#${hub.id}>`,
      `Category: <#${category.id}>${categoryCreated ? " (created)" : ""}`,
      `Template: \`${template}\``,
      warning ? `⚠️ ${warning}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    ephemeral: true,
  });
}

export const joinToCreateCommand: Command = {
  name: "jointocreate",
  aliases: ["j2c", "jtc"],
  category: "admin",
  description: "Set up join-to-create with an auto-created category and name template.",
  usage: "<#voice-channel> [template] | template <text> | category <#category> | status | disable",
  examples: [
    "jointocreate #Join to Create",
    "jointocreate #Join to Create {user}'s VC",
    "jointocreate template {displayName}'s room",
    "jointocreate status",
  ],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("jointocreate")
    .setDescription("Configure the join-to-create temporary VC hub")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set the hub and optionally a template or category")
        .addChannelOption((option) =>
          option.setName("hub").setDescription("Voice channel members join").setRequired(true),
        )
        .addChannelOption((option) =>
          option.setName("category").setDescription("Category; auto-created if omitted").setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName("template")
            .setDescription("Name template; default {user}'s VC")
            .setRequired(false)
            .setMaxLength(100),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("template")
        .setDescription("Change the channel name template")
        .addStringOption((option) =>
          option.setName("value").setDescription("Must include {user}").setRequired(true).setMaxLength(100),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("category")
        .setDescription("Use a specific category")
        .addChannelOption((option) =>
          option.setName("category").setDescription("Category channel").setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName("status").setDescription("Show the current setup"))
    .addSubcommand((sub) => sub.setName("disable").setDescription("Disable join-to-create")),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase();
    const before = await ctx.services.settings.getTempVc(ctx.guild.id);

    try {
      if (!action || action === "status" || action === "show") {
        await ctx.reply({ ...configCard(before), ephemeral: true });
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

      if (action === "template") {
        const template = validateTemplate(ctx.args.slice(1).join(" "));
        const after = await ctx.services.settings.updateTempVc(ctx.guild.id, { nameTemplate: template }, ctx.author.id);
        await ctx.services.audit.log({
          guildId: ctx.guild.id,
          actorId: ctx.author.id,
          actorType: "user",
          source: "discord",
          action: "jointocreate.template",
          before,
          after,
        });
        await ctx.reply({ content: `Template set to \`${template}\`.`, ephemeral: true });
        return;
      }

      if (action === "category") {
        const categoryId = normalizeId(ctx.args[1]);
        const category = categoryId ? await ctx.guild.channels.fetch(categoryId).catch(() => null) : null;
        if (!category || category.type !== ChannelType.GuildCategory) {
          throw new Error("Mention a category channel.");
        }
        const after = await ctx.services.settings.updateTempVc(ctx.guild.id, { categoryId: category.id }, ctx.author.id);
        await ctx.services.audit.log({
          guildId: ctx.guild.id,
          actorId: ctx.author.id,
          actorType: "user",
          source: "discord",
          action: "jointocreate.category",
          before,
          after,
        });
        await ctx.reply({ content: `Category set to <#${category.id}>.`, ephemeral: true });
        return;
      }

      if (action === "set" || action.startsWith("<#") || /^\d{17,20}$/.test(action)) {
        await setHub(ctx, action === "set" ? ctx.args.slice(1) : ctx.args);
        return;
      }

      throw new Error(
        "Usage: `jointocreate <#voice-channel> [template]`, `jointocreate template <text>`, `jointocreate category <#category>`, `jointocreate status`, or `jointocreate disable`.",
      );
    } catch (error) {
      await ctx.reply({ content: error instanceof Error ? error.message : "That action failed.", ephemeral: true });
    }
  },
};
