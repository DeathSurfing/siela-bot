import { ComponentType, SlashCommandBuilder } from "discord.js";
import { formatDuration, parseDuration } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import type { MusicService } from "../../features/music.js";
import { buildMusicPayload, buildQueuePayload } from "../../features/music-ui.js";
import { buildLyricsPayload } from "../../features/lyrics-ui.js";
import { attachConfirmation, card, confirmCard, success } from "../../features/ui.js";
import { canManageMusic } from "../../framework/permissions.js";
import { UserError } from "../../lib/errors.js";

function music(ctx: CommandContext): MusicService {
  if (!ctx.services.music) throw new UserError("The music service is still starting up.");
  return ctx.services.music;
}

async function requireDj(ctx: CommandContext): Promise<void> {
  const settings = await ctx.services.settings.getMusic(ctx.guild.id);
  if (!canManageMusic(ctx.member, settings.djRoleIds, ctx.services.config)) {
    throw new UserError("You need a DJ role to do that.");
  }
}

function requireSameVoice(ctx: CommandContext): void {
  const channelId = music(ctx).channelId(ctx.guild.id);
  if (!channelId) throw new UserError("The bot is not in a voice channel.");
  if (ctx.member.voice.channelId !== channelId) {
    throw new UserError("Join the bot's voice channel first.");
  }
}


const playCommand: Command = {
  name: "play",
  aliases: ["p"],
  category: "music",
  description: "Play a search, track URL, or playlist (YouTube, SoundCloud, Spotify).",
  usage: "<query or url>",
  examples: [
    "play lofi",
    "play https://soundcloud.com/...",
    "play https://music.youtube.com/playlist?list=...",
    "play https://open.spotify.com/track/...",
    "play https://open.spotify.com/playlist/...",
  ],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a search, track, or playlist")
    .addStringOption((option) => option.setName("query").setDescription("Search or URL").setRequired(true).setMaxLength(500))
    .addChannelOption((option) => option.setName("voice").setDescription("Voice channel (optional)").setRequired(false)),
  async execute(ctx: CommandContext) {
    const query = ctx.args[0];
    if (!query) throw new UserError("Provide a search query or URL.");
    if (ctx.source === "prefix") {
      await ctx.reply(card({ title: "Loading", body: "Resolving track…" }));
    } else {
      await ctx.defer();
    }
    try {
      const service = music(ctx);
      const result = await service.play(ctx.member, query, ctx.args[1]);
      const notice = result.added > 1 ? `Added ${result.added} tracks to the queue.` : "Added to the queue.";
      const message = await ctx.edit(buildMusicPayload(ctx.guild.id, service.state(ctx.guild.id), notice));
      if (message) service.setNowPlayingMessage(ctx.guild.id, message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "That play request failed.";
      await ctx.edit(card({ title: "Could not play", body: message })).catch(() => undefined);
    }
  },
};

const joinCommand: Command = {
  name: "join",
  aliases: ["j", "summon"],
  category: "music",
  description: "Join your current voice channel (or a specified one).",
  usage: "[voice-channel]",
  examples: ["join", "join #Lounge"],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your voice channel")
    .addChannelOption((option) =>
      option.setName("channel").setDescription("Voice channel; defaults to yours").setRequired(false),
    ),
  async execute(ctx) {
    const channelId = ctx.args[0]?.replace(/^<#|>$/g, "");
    const joined = await music(ctx).join(ctx.member, channelId);
    await ctx.reply(success(`Joined <#${joined}>.`));
  },
};

const pauseCommand: Command = {
  name: "pause",
  category: "music",
  description: "Pause playback.",
  usage: "",
  examples: ["pause"],
  slash: new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  async execute(ctx) {
    requireSameVoice(ctx);
    await music(ctx).pause(ctx.guild.id);
    music(ctx).refreshNowPlaying(ctx.guild.id);
    await ctx.reply(success("Paused."));
  },
};

const resumeCommand: Command = {
  name: "resume",
  category: "music",
  description: "Resume playback.",
  usage: "",
  examples: ["resume"],
  slash: new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  async execute(ctx) {
    requireSameVoice(ctx);
    await music(ctx).resume(ctx.guild.id);
    music(ctx).refreshNowPlaying(ctx.guild.id);
    await ctx.reply(success("Resumed."));
  },
};

const skipCommand: Command = {
  name: "skip",
  aliases: ["s"],
  category: "music",
  description: "Skip the current track.",
  usage: "[count]",
  examples: ["skip", "skip 2"],
  slash: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip track(s)")
    .addIntegerOption((option) => option.setName("count").setDescription("Tracks to skip").setRequired(false).setMinValue(1).setMaxValue(50)),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    await music(ctx).skip(ctx.guild.id, Number(ctx.args[0] ?? 1) || 1);
    await ctx.reply(success("Skipped."));
  },
};

const stopCommand: Command = {
  name: "stop",
  category: "music",
  description: "Stop playback and clear the queue.",
  usage: "",
  examples: ["stop"],
  slash: new SlashCommandBuilder().setName("stop").setDescription("Stop and clear the queue"),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    const confirmId = "music:stop:confirm";
    const cancelId = "music:stop:cancel";
    const message = await ctx.reply(
      confirmCard({
        title: "Stop playback?",
        body: "This stops the current track and clears the queue.",
        confirmId,
        cancelId,
        confirmLabel: "Stop",
      }),
    );
    if (!message) return;
    attachConfirmation({
      message,
      userId: ctx.author.id,
      confirmId,
      cancelId,
      onConfirm: async () => {
        await music(ctx).stop(ctx.guild.id);
        return card({ title: "Stopped", body: "Playback stopped and the queue was cleared." });
      },
      onCancel: () => card({ title: "Cancelled", body: "Playback continues." }),
    });
  },
};

const queueCommand: Command = {
  name: "queue",
  aliases: ["q"],
  category: "music",
  description: "Show the music queue with pages and total duration.",
  usage: "[page]",
  examples: ["queue", "queue 2"],
  slash: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the music queue")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number").setRequired(false).setMinValue(1),
    ),
  async execute(ctx) {
    const service = music(ctx);
    const state = service.state(ctx.guild.id);
    if (!state) throw new UserError("Nothing is playing.");
    if (!state.current && !state.upcoming.length) throw new UserError("The queue is empty.");
    const requested = Number(ctx.args[0] ?? 1) || 1;
    const message = await ctx.reply(buildQueuePayload(ctx.guild.id, state, requested));
    if (!message) return;
    let currentPage = requested;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: (interaction) => interaction.user.id === ctx.author.id,
    });
    collector.on("collect", async (interaction) => {
      const [, , , pageRaw] = interaction.customId.split(":");
      const page = Number(pageRaw) || 1;
      currentPage = page;
      await interaction.update(buildQueuePayload(ctx.guild.id, service.state(ctx.guild.id), page, false)).catch(() => undefined);
    });
    collector.on("end", () => {
      message.edit(buildQueuePayload(ctx.guild.id, service.state(ctx.guild.id), currentPage, true)).catch(() => undefined);
    });
  },
};

const lyricsCommand: Command = {
  name: "lyrics",
  aliases: ["lyric", "lrc"],
  category: "music",
  description: "Show lyrics for the current track.",
  usage: "",
  examples: ["lyrics"],
  slash: new SlashCommandBuilder().setName("lyrics").setDescription("Show lyrics for the current track"),
  async execute(ctx) {
    const service = music(ctx);
    const state = service.state(ctx.guild.id);
    if (!state?.current) throw new UserError("Nothing is playing.");
    if (ctx.source === "prefix") {
      await ctx.reply(card({ title: "Lyrics", body: "Searching for lyrics…" }));
    } else {
      await ctx.defer();
    }
    try {
      const result = await ctx.services.lyrics.forTrack(state.current);
      await ctx.edit(buildLyricsPayload(state.current, result));
    } catch (error) {
      const message = error instanceof UserError ? error.message : "Could not fetch lyrics.";
      await ctx.edit(card({ title: "Lyrics", body: message })).catch(() => undefined);
    }
  },
};

const nowPlayingCommand: Command = {
  name: "nowplaying",
  aliases: ["np", "current", "currentlyplaying", "cp"],
  category: "music",
  description: "Show the current track.",
  usage: "",
  examples: ["nowplaying"],
  slash: new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track"),
  async execute(ctx) {
    const service = music(ctx);
    const message = await ctx.reply(buildMusicPayload(ctx.guild.id, service.state(ctx.guild.id)));
    if (message) service.setNowPlayingMessage(ctx.guild.id, message);
  },
};

const volumeCommand: Command = {
  name: "volume",
  aliases: ["vol"],
  category: "music",
  description: "Set playback volume (0-150).",
  usage: "<0-150>",
  examples: ["volume 80"],
  slash: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set volume")
    .addIntegerOption((option) => option.setName("value").setDescription("0-150").setRequired(true).setMinValue(0).setMaxValue(150)),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    const value = Number(ctx.args[0]);
    if (!Number.isInteger(value) || value < 0 || value > 150) throw new UserError("Volume must be 0-150.");
    const actual = await music(ctx).volume(ctx.guild.id, value);
    music(ctx).refreshNowPlaying(ctx.guild.id);
    await ctx.reply(success(`Volume set to **${actual}%**.`));
  },
};

const seekCommand: Command = {
  name: "seek",
  category: "music",
  description: "Seek the current track.",
  usage: "<mm:ss>",
  examples: ["seek 1:30"],
  slash: new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Seek the current track")
    .addStringOption((option) => option.setName("position").setDescription("mm:ss or seconds").setRequired(true)),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    const position = parseDuration(ctx.args[0] ?? "");
    if (position === null) throw new UserError("Use seconds or mm:ss.");
    await music(ctx).seek(ctx.guild.id, position);
    await ctx.reply(success(`Seeked to ${formatDuration(position)}.`));
  },
};

const loopCommand: Command = {
  name: "loop",
  category: "music",
  description: "Set loop mode.",
  usage: "<off|track|queue>",
  examples: ["loop track"],
  slash: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Set loop mode")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Loop mode")
        .setRequired(true)
        .addChoices({ name: "off", value: "off" }, { name: "track", value: "track" }, { name: "queue", value: "queue" }),
    ),
  async execute(ctx) {
    requireSameVoice(ctx);
    const mode = ctx.args[0]?.toLowerCase();
    if (mode !== "off" && mode !== "track" && mode !== "queue") throw new UserError("Use off, track, or queue.");
    await music(ctx).loop(ctx.guild.id, mode);
    music(ctx).refreshNowPlaying(ctx.guild.id);
    await ctx.reply(success(`Loop mode: **${mode}**.`));
  },
};

const shuffleCommand: Command = {
  name: "shuffle",
  category: "music",
  description: "Shuffle the queue.",
  usage: "",
  examples: ["shuffle"],
  slash: new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the queue"),
  async execute(ctx) {
    requireSameVoice(ctx);
    await music(ctx).shuffle(ctx.guild.id);
    music(ctx).refreshNowPlaying(ctx.guild.id);
    await ctx.reply(success("Queue shuffled."));
  },
};

const removeCommand: Command = {
  name: "remove",
  category: "music",
  description: "Remove a track from the queue.",
  usage: "<index>",
  examples: ["remove 2"],
  slash: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a queue track")
    .addIntegerOption((option) => option.setName("index").setDescription("Queue index").setRequired(true).setMinValue(1)),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    const removed = await music(ctx).remove(ctx.guild.id, Number(ctx.args[0]));
    music(ctx).refreshNowPlaying(ctx.guild.id);
    await ctx.reply(success(`Removed **${removed.title}**.`));
  },
};

async function confirmClearQueue(ctx: CommandContext): Promise<void> {
  requireSameVoice(ctx);
  await requireDj(ctx);
  const confirmId = "music:clear:confirm";
  const cancelId = "music:clear:cancel";
  const message = await ctx.reply(
    confirmCard({
      title: "Clear the queue?",
      body: "This removes every upcoming track. The current song keeps playing.",
      confirmId,
      cancelId,
      confirmLabel: "Clear queue",
    }),
  );
  if (!message) return;
  attachConfirmation({
    message,
    userId: ctx.author.id,
    confirmId,
    cancelId,
    onConfirm: async () => {
      await music(ctx).clear(ctx.guild.id);
      music(ctx).refreshNowPlaying(ctx.guild.id);
      return card({ title: "Queue cleared", body: "Every upcoming track was removed." });
    },
    onCancel: () => card({ title: "Cancelled", body: "The queue was not changed." }),
  });
}

const clearQueueCommand: Command = {
  name: "clearqueue",
  aliases: ["cq", "emptyqueue", "clear"],
  category: "music",
  description: "Clear every upcoming track while keeping the current song.",
  usage: "",
  examples: ["clearqueue"],
  slash: new SlashCommandBuilder().setName("clearqueue").setDescription("Clear every upcoming track"),
  async execute(ctx) {
    await confirmClearQueue(ctx);
  },
};

const moveCommand: Command = {
  name: "move",
  category: "music",
  description: "Move a queue track.",
  usage: "<from> <to>",
  examples: ["move 3 1"],
  slash: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a queue track")
    .addIntegerOption((option) => option.setName("from").setDescription("From index").setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName("to").setDescription("To index").setRequired(true).setMinValue(1)),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    await music(ctx).move(ctx.guild.id, Number(ctx.args[0]), Number(ctx.args[1]));
    music(ctx).refreshNowPlaying(ctx.guild.id);
    await ctx.reply(success("Track moved."));
  },
};

const jumpCommand: Command = {
  name: "jump",
  category: "music",
  description: "Jump to a queue track.",
  usage: "<index>",
  examples: ["jump 3"],
  slash: new SlashCommandBuilder()
    .setName("jump")
    .setDescription("Jump to a queue track")
    .addIntegerOption((option) => option.setName("index").setDescription("Queue index").setRequired(true).setMinValue(1)),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    await music(ctx).jump(ctx.guild.id, Number(ctx.args[0]));
    await ctx.reply(success("Jumped."));
  },
};

const disconnectCommand: Command = {
  name: "disconnect",
  aliases: ["dc"],
  category: "music",
  description: "Disconnect the bot from voice.",
  usage: "",
  examples: ["disconnect"],
  slash: new SlashCommandBuilder().setName("disconnect").setDescription("Disconnect from voice"),
  async execute(ctx) {
    await requireDj(ctx);
    await music(ctx).disconnect(ctx.guild.id);
    await ctx.reply(success("Disconnected."));
  },
};

const autoplayCommand: Command = {
  name: "autoplay",
  category: "music",
  description: "Toggle related-track autoplay.",
  usage: "<on|off>",
  examples: ["autoplay on"],
  slash: new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Toggle autoplay")
    .addStringOption((option) =>
      option.setName("value").setDescription("on or off").setRequired(true).addChoices({ name: "on", value: "on" }, { name: "off", value: "off" }),
    ),
  async execute(ctx) {
    requireSameVoice(ctx);
    const value = ctx.args[0]?.toLowerCase();
    if (value !== "on" && value !== "off") throw new UserError("Use on or off.");
    await music(ctx).autoplay(ctx.guild.id, value === "on");
    await ctx.reply(success(`Autoplay **${value}**.`));
  },
};

const filtersCommand: Command = {
  name: "filters",
  category: "music",
  description: "Apply a filter preset.",
  usage: "<off|bassboost|nightcore|vaporwave>",
  examples: ["filters bassboost"],
  slash: new SlashCommandBuilder()
    .setName("filters")
    .setDescription("Apply a filter preset")
    .addStringOption((option) =>
      option
        .setName("preset")
        .setDescription("Filter preset")
        .setRequired(true)
        .addChoices(
          { name: "off", value: "off" },
          { name: "bassboost", value: "bassboost" },
          { name: "nightcore", value: "nightcore" },
          { name: "vaporwave", value: "vaporwave" },
        ),
    ),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    const preset = ctx.args[0]?.toLowerCase();
    if (preset !== "off" && preset !== "bassboost" && preset !== "nightcore" && preset !== "vaporwave") {
      throw new UserError("Use off, bassboost, nightcore, or vaporwave.");
    }
    await music(ctx).filters(ctx.guild.id, preset);
    music(ctx).refreshNowPlaying(ctx.guild.id);
    await ctx.reply(success(`Filter preset: **${preset}**.`));
  },
};

export const musicCommands = [
  joinCommand,
  playCommand,
  pauseCommand,
  resumeCommand,
  skipCommand,
  stopCommand,
  queueCommand,
  nowPlayingCommand,
  lyricsCommand,
  volumeCommand,
  seekCommand,
  loopCommand,
  shuffleCommand,
  removeCommand,
  clearQueueCommand,
  moveCommand,
  jumpCommand,
  disconnectCommand,
  autoplayCommand,
  filtersCommand,
];
