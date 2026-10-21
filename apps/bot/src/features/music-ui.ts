import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { MusicQueueState } from "@siela/shared";

function buttonId(guildId: string, action: string): string {
  return `music:${action}:${guildId}`;
}

export function buildMusicControls(
  guildId: string,
  state: MusicQueueState | null,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const hasTrack = Boolean(state?.current);
  const paused = state?.paused ?? false;
  const loop = state?.loop ?? "off";

  const pause = new ButtonBuilder()
    .setCustomId(buttonId(guildId, "pause"))
    .setLabel(paused ? "Resume" : "Pause")
    .setEmoji(paused ? "▶️" : "⏸️")
    .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setDisabled(!hasTrack);
  const rewind = new ButtonBuilder()
    .setCustomId(buttonId(guildId, "rewind"))
    .setLabel("-10s")
    .setEmoji("⏪")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!hasTrack);
  const forward = new ButtonBuilder()
    .setCustomId(buttonId(guildId, "forward"))
    .setLabel("+10s")
    .setEmoji("⏩")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!hasTrack);
  const skip = new ButtonBuilder()
    .setCustomId(buttonId(guildId, "skip"))
    .setLabel("Skip")
    .setEmoji("⏭️")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!hasTrack);
  const stop = new ButtonBuilder()
    .setCustomId(buttonId(guildId, "stop"))
    .setLabel("Stop")
    .setEmoji("⏹️")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(!hasTrack);
  const shuffle = new ButtonBuilder()
    .setCustomId(buttonId(guildId, "shuffle"))
    .setLabel("Shuffle")
    .setEmoji("🔀")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!hasTrack);
  const loopButton = new ButtonBuilder()
    .setCustomId(buttonId(guildId, "loop"))
    .setLabel(`Loop: ${loop}`)
    .setEmoji("🔁")
    .setStyle(loop === "off" ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(!hasTrack);

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      pause,
      rewind,
      forward,
      skip,
      stop,
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(shuffle, loopButton),
  ];
}
