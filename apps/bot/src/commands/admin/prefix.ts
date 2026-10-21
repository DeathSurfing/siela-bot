import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS, DEFAULTS, prefixSchema } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { isAdmin } from "../../framework/permissions.js";

export const prefixCommand: Command = {
  name: "prefix",
  aliases: ["setprefix"],
  category: "admin",
  description: "Show or change the global prefix for this server.",
  usage: "[set <prefix>|reset]",
  examples: ["prefix", "prefix set ?", "prefix reset"],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("prefix")
    .setDescription("Show or change the server prefix")
    .addSubcommand((sub) => sub.setName("show").setDescription("Show the current prefix"))
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Change the global prefix")
        .addStringOption((option) =>
          option.setName("value").setDescription("New prefix (1-5 chars, punctuation required)").setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName("reset").setDescription("Reset the prefix to the default")),
  async execute(ctx: CommandContext) {
    const action = ctx.args[0]?.toLowerCase() ?? "show";
    if (action === "show") {
      const prefix = await ctx.services.settings.getPrefix(ctx.guild.id);
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle("Server prefix")
            .setDescription(`Current prefix: **${prefix}**\nTry \`${prefix}help\`.`),
        ],
      });
      return;
    }

    if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
      await ctx.reply({ content: "Only admins can change the prefix.", ephemeral: true });
      return;
    }

    const before = await ctx.services.settings.getPrefix(ctx.guild.id);
    let next: string;
    if (action === "reset") {
      next = DEFAULTS.prefix;
    } else if (action === "set") {
      const value = ctx.args.slice(1).join(" ").trim();
      if (!value) {
        await ctx.reply({ content: "Usage: `prefix set <new prefix>`", ephemeral: true });
        return;
      }
      const parsed = prefixSchema.safeParse(value);
      if (!parsed.success) {
        await ctx.reply({ content: parsed.error.issues[0]?.message ?? "Invalid prefix.", ephemeral: true });
        return;
      }
      next = parsed.data;
    } else {
      await ctx.reply({ content: "Usage: `prefix [set <prefix>|reset]`", ephemeral: true });
      return;
    }

    await ctx.services.settings.setPrefix(ctx.guild.id, next, ctx.author.id);
    await ctx.services.audit.log({
      guildId: ctx.guild.id,
      actorId: ctx.author.id,
      actorType: "user",
      source: "discord",
      action: "prefix.set",
      targetType: "guild",
      targetId: ctx.guild.id,
      before: { prefix: before },
      after: { prefix: next },
    });
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setDescription(`Prefix changed from **${before}** to **${next}**.`),
      ],
    });
  },
};
