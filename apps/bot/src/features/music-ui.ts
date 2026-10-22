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
import { formatDuration, truncate, type MusicQueueState } from "@siela/shared";
import type { ReplyPayload } from "../framework/types.js";
import { UI_ACCENT, actionRow, progressBar, text } from "./ui.js";

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
          .addTextDisplayComponents(text("## Nothing playing"))
          .addTextDisplayComponents(text("-# Use `/play` to start a track.")),
      ],
      flags: MessageFlags.IsComponentsV2,
    };
  }

  const track = state.current;
  const length = track.isStream ? 0 : track.length;
  const progress = track.isStream
    ? "🔴 LIVE"
    : `${progressBar(state.position, length, 14)}  \`${formatDuration(state.position)} / ${formatDuration(length)}\``;
  const next = state.upcoming[0];

  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  if (notice) {
    container.addTextDisplayComponents(text(`-# ${notice}`));
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
  }

  const titleSection = new SectionBuilder()
    .addTextDisplayComponents(
      text(`### ${truncate(track.title, 80)}`),
      text(`-# ${truncate(track.author, 48)}${track.isStream ? " · LIVE" : ""}`),
    );
  if (track.artworkUrl) {
    titleSection.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: track.artworkUrl } }));
  }
  container.addSectionComponents(titleSection);
  container.addTextDisplayComponents(text(progress));
  container.addTextDisplayComponents(
    text(
      `-# Volume ${state.volume}% · Loop ${state.loop} · ${state.upcoming.length} queued`,
    ),
  );
  if (next) {
    container.addTextDisplayComponents(
      text(`**Next** · ${truncate(next.title, 70)} — ${truncate(next.author, 32)}`),
    );
  }

  container.addActionRowComponents(
    actionRow(
      new ButtonBuilder()
        .setCustomId(buttonId(guildId, "pause"))
        .setLabel(state.paused ? "Resume" : "Pause")
        .setStyle(state.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buttonId(guildId, "skip"))
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  const more = new StringSelectMenuBuilder()
    .setCustomId(`music:more:${guildId}`)
    .setPlaceholder("More controls…")
    .addOptions(
      { label: "Rewind 10s", value: "rewind" },
      { label: "Forward 10s", value: "forward" },
      { label: "Shuffle queue", value: "shuffle" },
      { label: "Cycle loop mode", value: "loop" },
      { label: "Filter preset", value: "filter" },
      { label: "Stop and disconnect", value: "stop" },
    );

  container.addActionRowComponents(actionRow(more));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}
