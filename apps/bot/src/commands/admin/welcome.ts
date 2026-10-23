import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { card } from "../../features/ui.js";

function normalizeId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/^<#|^<@!?|>$/g, "");
}

function onOff(value: string | undefined): boolean {
  if (value === "on" || value === "true" || value === "yes") return true;
  if (value === "off" || value === "false" || value === "no") return false;
  throw new Error("Use `on` or `off`.");
}

function configCard(prefix: string, settings: Awaited<ReturnType<CommandContext["services"]["settings"]["getWelcome"]>>) {
  return card({
    title: "Welcome",
    body: [
      `**Enabled** · ${settings.enabled ? "On" : "Off"}`,
      `**Channel** · ${settings.channelId ? `<#${settings.channelId}>` : "Not set"}`,
      `**Embed** · ${settings.embed ? "On" : "Off"}`,
      `**Card** · ${settings.card ? "On" : "Off"}`,
      `**Ping user** · ${settings.pingUser ? "On" : "Off"}`,
      `**DM** · ${settings.dmEnabled ? "On" : "Off"}`,
      `**Goodbye** · ${settings.goodbyeEnabled ? (settings.goodbyeChannelId ? `On · <#${settings.goodbyeChannelId}>` : "On") : "Off"}`,
      `**Message**\n\`\`\`${settings.message.slice(0, 900)}\`\`\``,
      `-# \`${prefix}welcome <channel|message|embed|ping|dm|test|disable|goodbye>\``,
    ].join("\n"),
    ephemeral: true,
  });
}

export const welcomeCommand: Command = {
  name: "welcome",
  category: "admin",
  description: "Configure welcome messages, DMs, and goodbye messages.",
  usage: "<channel|message|embed|ping|dm|test|disable|goodbye>",
  examples: ["welcome channel #welcome", "welcome message Welcome {mention}!", "welcome embed on", "welcome test"],
  adminOnly: true,
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Configure welcome messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName("channel").setDescription("Set the welcome channel").addChannelOption((option) =>
        option.setName("channel").setDescription("Text channel").setRequired(true),
      ),
    )
    .addSubcommand((sub) =>
      sub.setName("message").setDescription("Set the welcome message template").addStringOption((option) =>
        option.setName("template").setDescription("Message template").setRequired(true).setMaxLength(2_000),
      ),
    )
    .addSubcommand((sub) => sub.setName("show").setDescription("Show the current configuration"))
    .addSubcommand((sub) => sub.setName("embed").setDescription("Toggle embeds").addStringOption((option) =>
      option.setName("value").setDescription("on or off").setRequired(true).addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    ))
    .addSubcommand((sub) => sub.setName("card").setDescription("Toggle the generated welcome image card").addStringOption((option) =>
      option.setName("value").setDescription("on or off").setRequired(true).addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    ))
    .addSubcommand((sub) => sub.setName("ping").setDescription("Toggle user ping").addStringOption((option) =>
      option.setName("value").setDescription("on or off").setRequired(true).addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    ))
    .addSubcommand((sub) => sub.setName("dm").setDescription("Toggle welcome DMs").addStringOption((option) =>
      option.setName("value").setDescription("on or off").setRequired(true).addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    ))
    .addSubcommand((sub) => sub.setName("test").setDescription("Send a preview"))
    .addSubcommand((sub) => sub.setName("disable").setDescription("Disable welcome messages"))
    .addSubcommand((sub) =>
      sub
        .setName("goodbye")
        .setDescription("Configure goodbye messages")
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("State, channel, or message")
            .setRequired(false)
            .addChoices(
              { name: "on", value: "on" },
              { name: "off", value: "off" },
              { name: "channel", value: "channel" },
              { name: "message", value: "message" },
            ),
        )
        .addChannelOption((option) => option.setName("channel").setDescription("Goodbye channel").setRequired(false))
        .addStringOption((option) => option.setName("text").setDescription("Goodbye message").setRequired(false)),
    ),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase() ?? "show";
    const prefix = await ctx.services.settings.getPrefix(ctx.guild.id);
    const before = await ctx.services.settings.getWelcome(ctx.guild.id);

    try {
      if (action === "show" || action === "config") {
        await ctx.reply(configCard(prefix, before));
        return;
      }
      if (action === "disable") {
        const after = await ctx.services.settings.updateWelcome(ctx.guild.id, { enabled: false }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "welcome.disable", before, after });
        await ctx.reply({ content: "Welcome messages disabled.", ephemeral: true });
        return;
      }
      if (action === "channel") {
        const id = normalizeId(ctx.args[1]);
        if (!id) throw new Error("Mention a text channel.");
        const channel = await ctx.guild.channels.fetch(id).catch(() => null);
        if (!channel?.isTextBased()) throw new Error("That is not a text channel.");
        const after = await ctx.services.settings.updateWelcome(ctx.guild.id, { channelId: id, enabled: true }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "welcome.channel", before, after });
        await ctx.reply({ content: `Welcome channel set to <#${id}> and welcome enabled.`, ephemeral: true });
        return;
      }
      if (action === "message") {
        const template = ctx.args.slice(1).join(" ").trim();
        if (!template) throw new Error("Provide a welcome message template.");
        const unknown = ctx.services.welcome.validateTemplate(template);
        if (unknown.length) throw new Error(`Unknown placeholders: ${unknown.map((key) => `{${key}}`).join(", ")}`);
        const after = await ctx.services.settings.updateWelcome(ctx.guild.id, { message: template }, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "welcome.message", before, after });
        await ctx.reply({ content: "Welcome message updated.", ephemeral: true });
        return;
      }
      if (action === "embed" || action === "card" || action === "ping" || action === "dm") {
        const value = onOff(ctx.args[1]);
        const patch =
          action === "embed" ? { embed: value }
          : action === "card" ? { card: value }
          : action === "ping" ? { pingUser: value }
          : { dmEnabled: value };
        const after = await ctx.services.settings.updateWelcome(ctx.guild.id, patch, ctx.author.id);
        await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: `welcome.${action}`, before, after });
        await ctx.reply({ content: `Welcome **${action}** set to **${value ? "on" : "off"}**.`, ephemeral: true });
        return;
      }
      if (action === "test") {
        await ctx.services.welcome.sendTest(ctx.member);
        await ctx.reply({ content: "Welcome preview sent.", ephemeral: true });
        return;
      }
      if (action === "goodbye") {
        const mode = ctx.args[1]?.toLowerCase();
        if (mode === "on" || mode === "off") {
          const after = await ctx.services.settings.updateWelcome(ctx.guild.id, { goodbyeEnabled: mode === "on" }, ctx.author.id);
          await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "welcome.goodbye", before, after });
          await ctx.reply({ content: `Goodbye messages **${mode}**.`, ephemeral: true });
          return;
        }
        if (mode === "channel") {
          const id = normalizeId(ctx.args[2]);
          if (!id) throw new Error("Mention a text channel.");
          const after = await ctx.services.settings.updateWelcome(ctx.guild.id, { goodbyeChannelId: id, goodbyeEnabled: true }, ctx.author.id);
          await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "welcome.goodbyeChannel", before, after });
          await ctx.reply({ content: `Goodbye channel set to <#${id}>.`, ephemeral: true });
          return;
        }
        if (mode === "message") {
          const template = ctx.args.slice(2).join(" ").trim();
          if (!template) throw new Error("Provide a goodbye message.");
          const unknown = ctx.services.welcome.validateTemplate(template);
          if (unknown.length) throw new Error(`Unknown placeholders: ${unknown.map((key) => `{${key}}`).join(", ")}`);
          const after = await ctx.services.settings.updateWelcome(ctx.guild.id, { goodbyeMessage: template }, ctx.author.id);
          await ctx.services.audit.log({ guildId: ctx.guild.id, actorId: ctx.author.id, actorType: "user", source: "discord", action: "welcome.goodbyeMessage", before, after });
          await ctx.reply({ content: "Goodbye message updated.", ephemeral: true });
          return;
        }
        throw new Error("Usage: `welcome goodbye <on|off|channel|message>`");
      }
      throw new Error("Unknown `welcome` subcommand.");
    } catch (error) {
      await ctx.reply({ content: error instanceof Error ? error.message : "That action failed.", ephemeral: true });
    }
  },
};
