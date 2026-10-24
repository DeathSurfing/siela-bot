import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";
import { escapeMarkdown, formatDuration, truncate, type MusicQueueState } from "@siela/shared";
import type { ReplyPayload } from "../framework/types.js";
import { EMOJI, ICONS, UI_ACCENT, actionRow, progressBar, text } from "./ui.js";

function buttonId(guildId: string, action: string): string {
  return `music:${action}:${guildId}`;
}

export function buildMusicPayload(
  guildId: string,
  state: MusicQueueState | null,
  notice?: string,
): ReplyPayload {
  if (!state?.current) {
    return {
      components: [
        new ContainerBuilder()
          .setAccentColor(UI_ACCENT)
          .addTextDisplayComponents(text(`## ${ICONS.music} Nothing playing`))
          .addTextDisplayComponents(text("-# Use `/play` to start a track.")),
      ],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  const track = state.current;
  const length = track.isStream ? 0 : track.length;
  const progress = track.isStream
    ? `${ICONS.live} LIVE`
    : `${progressBar(state.position, length, 14)}  \`${formatDuration(state.position)} / ${formatDuration(length)}\``;
  const next = state.upcoming[0];

  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  if (notice) {
    container.addTextDisplayComponents(text(`-# ${notice}`));
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
  }

  const titleText = text(`### ${ICONS.music} ${escapeMarkdown(truncate(track.title, 80))}`);
  const artistText = text(`-# ${escapeMarkdown(truncate(track.author, 48))}${track.isStream ? ` · ${ICONS.live} LIVE` : ""}`);
  if (track.artworkUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(titleText, artistText)
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: track.artworkUrl } })),
    );
  } else {
    container.addTextDisplayComponents(titleText, artistText);
  }
  container.addTextDisplayComponents(text(progress));
  container.addTextDisplayComponents(
    text(
      `-# Volume ${state.volume}% · Loop ${state.loop} · ${state.upcoming.length} queued`,
    ),
  );
  if (next) {
    container.addTextDisplayComponents(
      text(`**Next** · ${escapeMarkdown(truncate(next.title, 70))} — ${escapeMarkdown(truncate(next.author, 32))}`),
    );
  }

  container.addActionRowComponents(
    actionRow(
      new ButtonBuilder()
        .setCustomId(buttonId(guildId, "pause"))
        .setLabel(state.paused ? "Resume" : "Pause")
        .setEmoji(state.paused ? EMOJI.play : EMOJI.pause)
        .setStyle(state.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buttonId(guildId, "lyrics"))
        .setLabel("Lyrics")
        .setEmoji(EMOJI.lyrics)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buttonId(guildId, "skip"))
        .setLabel("Skip")
        .setEmoji(EMOJI.skip)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  const more = new StringSelectMenuBuilder()
    .setCustomId(`music:more:${guildId}`)
    .setPlaceholder(`${ICONS.more} More controls…`)
    .addOptions(
      { label: "Rewind 10s", value: "rewind", emoji: EMOJI.rewind },
      { label: "Forward 10s", value: "forward", emoji: EMOJI.forward },
      { label: "Shuffle queue", value: "shuffle", emoji: EMOJI.shuffle },
      { label: "Cycle loop mode", value: "loop", emoji: EMOJI.loop, description: `Currently ${state.loop}` },
      { label: "Filter preset", value: "filter", emoji: EMOJI.filter },
      { label: "Stop and disconnect", value: "stop", emoji: EMOJI.stop },
    );

  container.addActionRowComponents(actionRow(more));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

export function buildQueuePayload(
  guildId: string,
  state: MusicQueueState | null,
  page = 1,
  disabled = false,
): ReplyPayload {
  if (!state || (!state.current && !state.upcoming.length)) {
    return {
      components: [
        new ContainerBuilder()
          .setAccentColor(UI_ACCENT)
          .addTextDisplayComponents(text(`## ${ICONS.music} Nothing playing`))
          .addTextDisplayComponents(text("-# Use `/play` to start a track.")),
      ],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  const perPage = 6;
  const totalPages = Math.max(1, Math.ceil(state.upcoming.length / perPage));
  const currentPage = Math.max(1, Math.min(totalPages, page));
  const start = (currentPage - 1) * perPage;
  const slice = state.upcoming.slice(start, start + perPage);
  const totalMs = state.upcoming.reduce((sum, track) => sum + (track.isStream ? 0 : track.length), 0);
  const lines = slice.map((track, index) => {
    const duration = track.isStream ? "LIVE" : formatDuration(track.length);
    return `**${start + index + 1}.** ${escapeMarkdown(truncate(track.title, 56))} — ${escapeMarkdown(truncate(track.author, 28))} \`${duration}\``;
  });

  const container = new ContainerBuilder()
    .setAccentColor(UI_ACCENT)
    .addTextDisplayComponents(
      text(`## ${ICONS.music} Queue`),
      text(
        `-# ${state.upcoming.length} upcoming · ${formatDuration(totalMs)} total · page ${currentPage}/${totalPages}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents(
      text(
        state.current
          ? `**Now** · ${escapeMarkdown(truncate(state.current.title, 64))} — ${escapeMarkdown(truncate(state.current.author, 32))}`
          : "**Now** · Nothing playing",
      ),
    );

  if (lines.length) {
    container.addTextDisplayComponents(text(lines.join("\n")));
  } else {
    container.addTextDisplayComponents(text("-# Queue is empty."));
  }

  if (totalPages > 1) {
    const prev = new ButtonBuilder()
      .setCustomId(`queue:page:${guildId}:${currentPage - 1}`)
      .setLabel("Previous")
      .setEmoji(EMOJI.rewind)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || currentPage <= 1);
    const next = new ButtonBuilder()
      .setCustomId(`queue:page:${guildId}:${currentPage + 1}`)
      .setLabel("Next")
      .setEmoji(EMOJI.forward)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || currentPage >= totalPages);
    container.addActionRowComponents(actionRow(prev, next));
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}
