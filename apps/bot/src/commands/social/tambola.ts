import { ChannelType, SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import { card, success } from "../../features/ui.js";

function privateReply(ctx: CommandContext, payload: Parameters<CommandContext["reply"]>[0]) {
  return { ...payload, ephemeral: true };
}

async function hostOptions(ctx: CommandContext): Promise<{
  maxPlayers: number;
  intervalSeconds: number;
  autoMark: boolean;
  voiceChannelId: string | null;
}> {
  let maxPlayers = 20;
  let intervalSeconds = 12;
  let autoMark = true;
  let voiceChannelId: string | null = null;
  for (const raw of ctx.args.slice(1)) {
    const lower = raw.toLowerCase();
    const value = raw.replace(/^<#|>$/g, "");
    if (/^\d{17,20}$/.test(value)) {
      voiceChannelId = value;
    } else if (/^\d+$/.test(raw)) {
      maxPlayers = Number(raw);
    } else if (lower === "fast") {
      intervalSeconds = 8;
    } else if (lower === "normal") {
      intervalSeconds = 12;
    } else if (lower === "slow") {
      intervalSeconds = 15;
    } else if (["auto", "automark", "auto-mark", "true"].includes(lower)) {
      autoMark = true;
    } else if (["manual", "manualmark", "manual-mark", "false"].includes(lower)) {
      autoMark = false;
    }
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 20) {
    throw new UserError("Max players must be between 2 and 20.");
  }
  if (!voiceChannelId) voiceChannelId = ctx.member.voice.channelId ?? null;
  if (voiceChannelId) {
    const channel = ctx.guild.channels.cache.get(voiceChannelId)
      ?? await ctx.guild.channels.fetch(voiceChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new UserError("Choose a voice channel for Tambola.");
    }
  }
  return { maxPlayers, intervalSeconds, autoMark, voiceChannelId };
}

export const tambolaCommand: Command = {
  name: "tambola",
  aliases: ["housie"],
  category: "social",
  description: "Play Tambola with private tickets, live calls, TTS, and auto-marking.",
  usage: "<host|join|leave|start|ticket|call|pause|resume|end|status|settings|rules>",
  examples: [
    "tambola host",
    "tambola host 20 normal #General",
    "tambola host 20 fast auto",
    "tambola join",
    "tambola ticket",
    "tambola settings",
    "tambola start",
  ],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("tambola")
    .setDescription("Play Tambola")
    .addSubcommand((sub) =>
      sub
        .setName("host")
        .setDescription("Open a Tambola lobby")
        .addIntegerOption((option) =>
          option
            .setName("max_players")
            .setDescription("Maximum players (2-20)")
            .setRequired(false)
            .setMinValue(2)
            .setMaxValue(20),
        )
        .addStringOption((option) =>
          option
            .setName("speed")
            .setDescription("Number calling speed")
            .setRequired(false)
            .addChoices(
              { name: "Fast · 8s", value: "fast" },
              { name: "Normal · 12s", value: "normal" },
              { name: "Slow · 15s", value: "slow" },
            ),
        )
        .addChannelOption((option) =>
          option
            .setName("voice")
            .setDescription("Voice channel for number calls")
            .setRequired(false),
        )
        .addBooleanOption((option) =>
          option
            .setName("auto_mark")
            .setDescription("Automatically mark called numbers (default: on)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) => sub.setName("join").setDescription("Join the Tambola lobby"))
    .addSubcommand((sub) => sub.setName("leave").setDescription("Leave the Tambola lobby"))
    .addSubcommand((sub) => sub.setName("start").setDescription("Start the Tambola game"))
    .addSubcommand((sub) => sub.setName("ticket").setDescription("Show your Tambola ticket"))
    .addSubcommand((sub) => sub.setName("call").setDescription("Call the next number"))
    .addSubcommand((sub) => sub.setName("pause").setDescription("Pause auto-calls"))
    .addSubcommand((sub) => sub.setName("resume").setDescription("Resume auto-calls"))
    .addSubcommand((sub) => sub.setName("end").setDescription("End the Tambola game"))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show the current game"))
    .addSubcommand((sub) => sub.setName("settings").setDescription("Change Tambola lobby settings"))
    .addSubcommand((sub) => sub.setName("rules").setDescription("Show Tambola rules")),
  async execute(ctx) {
    const tambola = ctx.services.tambola;
    const action = (ctx.args[0] ?? "status").toLowerCase();

    if (action === "host" || action === "create") {
      await ctx.defer(true);
      const options = await hostOptions(ctx);
      await tambola.host({
        guild: ctx.guild,
        channel: ctx.channel,
        host: ctx.member,
        maxPlayers: options.maxPlayers,
        intervalSeconds: options.intervalSeconds,
        autoMark: options.autoMark,
        voiceChannelId: options.voiceChannelId,
      });
      await ctx.reply(privateReply(ctx, success("Tambola lobby created.")));
      return;
    }

    if (action === "join") {
      await ctx.defer(true);
      const result = await tambola.join(ctx.guild.id, ctx.member);
      if (result.dmSent) {
        await ctx.reply(privateReply(ctx, success("You joined. Your ticket was sent by DM.")));
      } else if (ctx.source === "prefix") {
        await ctx.reply(
          card({
            title: "Tambola ticket",
            body: "I couldn't DM your ticket. Enable DMs and use `/tambola ticket` to open it privately.",
          }),
        );
      } else {
        await ctx.reply({ ...result.payload, ephemeral: true });
      }
      return;
    }

    if (action === "leave") {
      tambola.leave(ctx.guild.id, ctx.member.id);
      await ctx.reply(privateReply(ctx, success("You left the lobby.")));
      return;
    }

    if (action === "start") {
      await ctx.defer(true);
      await tambola.start(ctx.guild.id, ctx.member);
      await ctx.reply(privateReply(ctx, success("Tambola started.")));
      return;
    }

    if (action === "ticket") {
      await ctx.defer(true);
      const result = await tambola.ticket(ctx.guild.id, ctx.member.id);
      if (result.dmSent) {
        await ctx.reply(privateReply(ctx, success("Your ticket was sent by DM.")));
      } else if (ctx.source === "prefix") {
        await ctx.reply(
          card({
            title: "Tambola ticket",
            body: "I couldn't DM your ticket. Enable DMs and use `/tambola ticket` to open it privately.",
          }),
        );
      } else {
        await ctx.reply({ ...result.payload, ephemeral: true });
      }
      return;
    }

    if (action === "call") {
      const number = await tambola.call(ctx.guild.id, ctx.member);
      await ctx.reply(success(number === null ? "No numbers remain." : `Called ${number}.`));
      return;
    }

    if (action === "pause") {
      await tambola.pause(ctx.guild.id, ctx.member);
      await ctx.reply(success("Game paused."));
      return;
    }

    if (action === "resume") {
      await tambola.resume(ctx.guild.id, ctx.member);
      await ctx.reply(success("Game resumed."));
      return;
    }

    if (action === "end") {
      await ctx.reply(privateReply(ctx, tambola.promptEnd(ctx.guild.id, ctx.member)));
      return;
    }

    if (action === "status") {
      const payload = tambola.status(ctx.guild.id);
      await ctx.reply(payload ?? card({ title: "Tambola", body: "No Tambola game is running." }));
      return;
    }

    if (action === "settings") {
      await ctx.reply(privateReply(ctx, tambola.settingsPayload(ctx.guild.id, ctx.member)));
      return;
    }

    if (action === "rules") {
      await ctx.reply(tambola.rules());
      return;
    }

    throw new UserError("Use `tambola host`, `join`, `ticket`, `start`, `call`, `pause`, `resume`, `end`, `status`, `settings`, or `rules`.");
  },
};
