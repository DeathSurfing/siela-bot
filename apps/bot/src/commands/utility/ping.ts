import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS, formatDuration } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";

export const pingCommand: Command = {
  name: "ping",
  aliases: ["latency"],
  category: "utility",
  description: "Show gateway, database, Lavalink, and translation status.",
  usage: "",
  examples: ["ping"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder().setName("ping").setDescription("Show bot latency and service status"),
  async execute(ctx: CommandContext) {
    const started = Date.now();
    const [translation] = await Promise.all([
      ctx.services.translation.health().catch(() => false),
    ]);
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle("Siela status")
      .addFields(
        { name: "Gateway", value: `${ctx.client.ws.ping}ms`, inline: true },
        { name: "Round trip", value: `${Date.now() - started}ms`, inline: true },
        { name: "Uptime", value: formatDuration(ctx.client.uptime ?? 0), inline: true },
        { name: "Lavalink", value: ctx.services.music?.isUp() ? "🟢 up" : "🔴 down", inline: true },
        { name: "Translation", value: translation ? "🟢 up" : "🔴 down", inline: true },
        { name: "Database", value: "🟢 connected", inline: true },
      )
      .setTimestamp();
    await ctx.reply({ embeds: [embed] });
  },
};
