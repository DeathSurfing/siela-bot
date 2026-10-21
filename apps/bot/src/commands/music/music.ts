import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS, formatDuration, parseDuration, truncate } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import type { MusicService } from "../../features/music.js";
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

function trackLine(track: { title: string; author: string; length: number; isStream: boolean }): string {
  return `**${truncate(track.title, 80)}** — ${truncate(track.author, 40)} ${track.isStream ? "🔴 live" : `\`${formatDuration(track.length)}\``}`;
}

function stateEmbed(ctx: CommandContext) {
  const state = music(ctx).state(ctx.guild.id);
  if (!state?.current) throw new UserError("Nothing is playing.");
  const embed = new EmbedBuilder()
    .setColor(COLORS.music)
    .setTitle("Now playing")
    .setDescription(trackLine(state.current))
    .addFields(
      { name: "Position", value: `${formatDuration(state.position)} / ${state.current.isStream ? "live" : formatDuration(state.current.length)}`, inline: true },
      { name: "Volume", value: `${state.volume}%`, inline: true },
      { name: "Loop", value: state.loop, inline: true },
      { name: "Up next", value: state.upcoming.length ? trackLine(state.upcoming[0]!) : "queue is empty", inline: false },
    );
  if (state.current.artworkUrl) embed.setThumbnail(state.current.artworkUrl);
  return embed;
}

const playCommand: Command = {
  name: "play",
  aliases: ["p"],
  category: "music",
  description: "Play a search, a track URL, or a playlist URL (YouTube/YouTube Music/SoundCloud).",
  usage: "<query or url>",
  examples: [
    "play lofi",
    "play https://soundcloud.com/...",
    "play https://music.youtube.com/playlist?list=...",
    "play https://open.spotify.com/track/...",
  ],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a SoundCloud search or URL")
    .addStringOption((option) => option.setName("query").setDescription("Search or URL").setRequired(true).setMaxLength(500))
    .addChannelOption((option) => option.setName("voice").setDescription("Voice channel (optional)").setRequired(false)),
  async execute(ctx: CommandContext) {
    const query = ctx.args[0];
    if (!query) throw new UserError("Provide a search query or URL.");
    await ctx.defer();
    const result = await music(ctx).play(ctx.member, query, ctx.args[1]);
    await ctx.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.music)
          .setTitle("Added to queue")
          .setDescription(trackLine(result.first))
          .setFooter({ text: `${result.added} track${result.added === 1 ? "" : "s"} added` }),
      ],
    });
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
    await ctx.reply({ content: "Paused.", ephemeral: true });
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
    await ctx.reply({ content: "Resumed.", ephemeral: true });
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
    await ctx.reply({ content: "Skipped.", ephemeral: true });
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
    await music(ctx).stop(ctx.guild.id);
    await ctx.reply({ content: "Stopped and cleared.", ephemeral: true });
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
    const state = music(ctx).state(ctx.guild.id);
    if (!state?.current) throw new UserError("Nothing is playing.");
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(state.upcoming.length / perPage));
    const requested = Number(ctx.args[0] ?? 1) || 1;
    const page = Math.max(1, Math.min(totalPages, requested));
    const start = (page - 1) * perPage;
    const slice = state.upcoming.slice(start, start + perPage);
    const totalMs = state.upcoming.reduce((sum, track) => sum + (track.isStream ? 0 : track.length), 0);
    const lines = slice.map((track, index) => `**${start + index + 1}.** ${trackLine(track)}`);
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.music)
          .setTitle("Music queue")
          .setDescription(
            [
              `**Now:** ${trackLine(state.current)}`,
              "",
              lines.length ? lines.join("\n") : "Queue is empty.",
            ].join("\n"),
          )
          .setFooter({
            text: `${state.upcoming.length} upcoming • ${formatDuration(totalMs)} total • page ${page}/${totalPages} • volume ${state.volume}% • loop ${state.loop}`,
          }),
      ],
    });
  },
};

const nowPlayingCommand: Command = {
  name: "nowplaying",
  aliases: ["np"],
  category: "music",
  description: "Show the current track.",
  usage: "",
  examples: ["nowplaying"],
  slash: new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current track"),
  async execute(ctx) {
    await ctx.reply({ embeds: [stateEmbed(ctx)] });
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
    await ctx.reply({ content: `Volume set to **${actual}%**.`, ephemeral: true });
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
    await music(ctx).seek();
    await ctx.reply({ content: `Seeked to ${formatDuration(position)}.`, ephemeral: true });
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
    await ctx.reply({ content: `Loop mode: **${mode}**.`, ephemeral: true });
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
    await ctx.reply({ content: "Queue shuffled.", ephemeral: true });
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
    await ctx.reply({ content: `Removed **${removed.title}**.`, ephemeral: true });
  },
};

const clearCommand: Command = {
  name: "clear",
  category: "music",
  description: "Clear upcoming tracks.",
  usage: "",
  examples: ["clear"],
  slash: new SlashCommandBuilder().setName("clear").setDescription("Clear upcoming tracks"),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    await music(ctx).clear(ctx.guild.id);
    await ctx.reply({ content: "Queue cleared.", ephemeral: true });
  },
};

const clearQueueCommand: Command = {
  name: "clearqueue",
  aliases: ["cq", "emptyqueue"],
  category: "music",
  description: "Clear every upcoming track while keeping the current song.",
  usage: "",
  examples: ["clearqueue"],
  slash: new SlashCommandBuilder().setName("clearqueue").setDescription("Clear every upcoming track"),
  async execute(ctx) {
    requireSameVoice(ctx);
    await requireDj(ctx);
    await music(ctx).clear(ctx.guild.id);
    await ctx.reply({ content: "Queue cleared.", ephemeral: true });
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
    await ctx.reply({ content: "Track moved.", ephemeral: true });
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
    await ctx.reply({ content: "Jumped.", ephemeral: true });
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
    await ctx.reply({ content: "Disconnected.", ephemeral: true });
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
    await ctx.reply({ content: `Autoplay **${value}**.`, ephemeral: true });
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
    await ctx.reply({ content: `Filter preset: **${preset}**.`, ephemeral: true });
  },
};

export const musicCommands = [
  playCommand,
  pauseCommand,
  resumeCommand,
  skipCommand,
  stopCommand,
  queueCommand,
  nowPlayingCommand,
  volumeCommand,
  seekCommand,
  loopCommand,
  shuffleCommand,
  removeCommand,
  clearCommand,
  clearQueueCommand,
  moveCommand,
  jumpCommand,
  disconnectCommand,
  autoplayCommand,
  filtersCommand,
];
