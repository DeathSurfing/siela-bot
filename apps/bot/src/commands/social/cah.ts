import { SlashCommandBuilder } from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import { card, success } from "../../features/ui.js";
import { DEFAULT_POINTS_GOAL, MAX_PLAYERS, MIN_PLAYERS } from "../../features/cah/game.js";

function privateReply(ctx: CommandContext, payload: Parameters<CommandContext["reply"]>[0]) {
  return { ...payload, ephemeral: true };
}

export const cahCommand: Command = {
  name: "cah",
  aliases: ["cahgame"],
  category: "social",
  description: "Play Cards Against Humanity.",
  usage: "<host|join|leave|start|hand|reveal|pick|next|scores|status|end|rules>",
  examples: [
    "cah host",
    "cah host 7 10",
    "cah join",
    "cah hand",
    "cah pick 1",
    "cah next",
  ],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("cah")
    .setDescription("Play Cards Against Humanity")
    .addSubcommand((sub) =>
      sub
        .setName("host")
        .setDescription("Open a CAH lobby")
        .addIntegerOption((option) =>
          option.setName("points").setDescription("Points to win (default 7)").setRequired(false).setMinValue(1).setMaxValue(50),
        )
        .addIntegerOption((option) =>
          option.setName("max_players").setDescription("Maximum players (3-10)").setRequired(false).setMinValue(MIN_PLAYERS).setMaxValue(MAX_PLAYERS),
        ),
    )
    .addSubcommand((sub) => sub.setName("join").setDescription("Join the CAH lobby"))
    .addSubcommand((sub) => sub.setName("leave").setDescription("Leave the CAH lobby"))
    .addSubcommand((sub) => sub.setName("start").setDescription("Start the CAH game"))
    .addSubcommand((sub) => sub.setName("hand").setDescription("Show your hand"))
    .addSubcommand((sub) =>
      sub
        .setName("reveal")
        .setDescription("Force the judging phase"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("pick")
        .setDescription("Judge picks a winning slot")
        .addIntegerOption((option) =>
          option.setName("slot").setDescription("Slot number").setRequired(true).setMinValue(1),
        ),
    )
    .addSubcommand((sub) => sub.setName("next").setDescription("Advance to the next round"))
    .addSubcommand((sub) => sub.setName("scores").setDescription("Show scores"))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show the current game"))
    .addSubcommand((sub) => sub.setName("end").setDescription("End the CAH game"))
    .addSubcommand((sub) => sub.setName("rules").setDescription("Show CAH rules")),
  async execute(ctx) {
    const cah = ctx.services.cah;
    const action = (ctx.args[0] ?? "status").toLowerCase();

    if (action === "host" || action === "create") {
      await ctx.defer(true);
      let pointsGoal = DEFAULT_POINTS_GOAL;
      let maxPlayers = MAX_PLAYERS;
      let assigned = 0;
      for (const raw of ctx.args.slice(1)) {
        if (/^\d+$/.test(raw)) {
          const value = Number(raw);
          if (assigned === 0) {
            pointsGoal = value;
            assigned = 1;
          } else {
            maxPlayers = value;
          }
        }
      }
      // Slash option values are already present in ctx.args via argsFromInteraction.
      if (!Number.isInteger(pointsGoal) || pointsGoal < 1 || pointsGoal > 50) {
        throw new UserError("Points goal must be between 1 and 50.");
      }
      if (!Number.isInteger(maxPlayers) || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
        throw new UserError(`Max players must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}.`);
      }
      await cah.host({
        guild: ctx.guild,
        channel: ctx.channel,
        host: ctx.member,
        pointsGoal,
        maxPlayers,
      });
      await ctx.reply(privateReply(ctx, success("CAH lobby created.")));
      return;
    }

    if (action === "join") {
      await ctx.defer(true);
      await cah.join(ctx.guild.id, ctx.member);
      await ctx.reply(privateReply(ctx, success("You joined the game.")));
      return;
    }

    if (action === "leave") {
      cah.leave(ctx.guild.id, ctx.member.id);
      await ctx.reply(privateReply(ctx, success("You left the lobby.")));
      return;
    }

    if (action === "start") {
      await ctx.defer(true);
      await cah.start(ctx.guild.id, ctx.member);
      await ctx.reply(privateReply(ctx, success("CAH started.")));
      return;
    }

    if (action === "hand") {
      await ctx.defer(true);
      const payload = cah.hand(ctx.guild.id, ctx.member.id);
      await ctx.reply({ ...payload, ephemeral: true });
      return;
    }

    if (action === "reveal") {
      await ctx.defer(true);
      await cah.reveal(ctx.guild.id, ctx.member);
      await ctx.reply(privateReply(ctx, success("Reveal forced.")));
      return;
    }

    if (action === "pick") {
      const slot = ctx.args[1];
      if (!slot) throw new UserError("Provide a slot number.");
      await ctx.defer(true);
      const result = await cah.pick(ctx.guild.id, ctx.member.id, slot);
      await ctx.reply(privateReply(ctx, success(`Picked slot ${slot}. Winner: <@${result.playerId}>.`)));
      return;
    }

    if (action === "next") {
      await ctx.defer(true);
      await cah.next(ctx.guild.id, ctx.member);
      await ctx.reply(privateReply(ctx, success("Next round.")));
      return;
    }

    if (action === "scores") {
      const payload = cah.scores(ctx.guild.id);
      await ctx.reply(payload);
      return;
    }

    if (action === "status") {
      const payload = cah.status(ctx.guild.id);
      await ctx.reply(payload ?? card({ title: "CAH", body: "No CAH game is running." }));
      return;
    }

    if (action === "end") {
      await ctx.reply(privateReply(ctx, cah.promptEnd(ctx.guild.id, ctx.member)));
      return;
    }

    if (action === "rules") {
      await ctx.reply(cah.rules());
      return;
    }

    throw new UserError("Use `cah host`, `join`, `leave`, `start`, `hand`, `reveal`, `pick`, `next`, `scores`, `status`, `end`, or `rules`.");
  },
};