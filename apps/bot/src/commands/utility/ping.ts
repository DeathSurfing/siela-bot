import { SlashCommandBuilder } from "discord.js";
import { APP_NAME, APP_VERSION, formatDuration } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { ICONS, card } from "../../features/ui.js";

export const pingCommand: Command = {
  name: "ping",
  aliases: ["latency"],
  category: "utility",
  description: "Show gateway, database, and music status.",
  usage: "",
  examples: ["ping"],
  cooldownMs: 3_000,
  slash: new SlashCommandBuilder().setName("ping").setDescription("Show bot latency and service status"),
  async execute(ctx: CommandContext) {
    const started = Date.now();
    const music = (await ctx.services.music?.isUp().catch(() => false)) ?? false;
    const body = [
      `**Gateway** · ${ctx.client.ws.ping}ms`,
      `**Round trip** · ${Date.now() - started}ms`,
      `**Uptime** · ${formatDuration(ctx.client.uptime ?? 0)}`,
      `**Music** · ${music ? "up" : "down"}`,
      `**Database** · connected`,
    ].join("\n");
    await ctx.reply(card({ title: `${ICONS.utility} Status`, subtitle: `${APP_NAME} ${APP_VERSION}`, body }));
  },
};
