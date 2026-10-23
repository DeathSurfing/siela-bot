import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { buildHelpPayload } from "../../features/help.js";

export const helpCommand: Command = {
  name: "help",
  aliases: ["h"],
  category: "utility",
  description: "Browse commands by category, or search for one.",
  usage: "[command|category]",
  examples: ["help", "help play", "help admin"],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Browse every command")
    .addStringOption((option) =>
      option.setName("query").setDescription("Command or category").setRequired(false),
    ),
  async execute(ctx: CommandContext) {
    const prefix = await ctx.services.settings.getPrefix(ctx.guild.id);
    const query = ctx.rawArgs.trim() || undefined;
    const payload = await buildHelpPayload({
      registry: ctx.services.registry,
      member: ctx.member,
      config: ctx.services.config,
      prefix,
      query,
    });
    await ctx.reply(payload);
  },
};
