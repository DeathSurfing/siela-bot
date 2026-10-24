import { AttachmentBuilder, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } from "discord.js";
import { escapeMarkdown, truncate, type MusicTrackInfo } from "@siela/shared";
import type { ReplyPayload } from "../framework/types.js";
import { ICONS, UI_ACCENT, text } from "./ui.js";
import { lyricsBody, type LyricsResult } from "./lyrics.js";

const INLINE_LIMIT = 1_800;

function excerpt(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = value.slice(0, max);
  const newline = cut.lastIndexOf("\n");
  if (newline > max * 0.6) cut = cut.slice(0, newline);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

function filename(track: MusicTrackInfo): string {
  const slug = `${track.author} ${track.title}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${slug || "lyrics"}.txt`;
}

export function buildLyricsPayload(track: MusicTrackInfo, result: LyricsResult): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text(`## ${ICONS.lyrics} Lyrics`));
  container.addTextDisplayComponents(
    text(`**${escapeMarkdown(truncate(track.title, 80))}** · ${escapeMarkdown(truncate(track.author, 48))}`),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  const body = lyricsBody(result);
  const files: AttachmentBuilder[] = [];
  if (result.instrumental) {
    container.addTextDisplayComponents(text("Instrumental track · No lyrics available."));
  } else if (!body) {
    container.addTextDisplayComponents(text("No lyrics are available for this track."));
  } else {
    container.addTextDisplayComponents(text(excerpt(body, INLINE_LIMIT)));
    if (body.length > INLINE_LIMIT) {
      container.addTextDisplayComponents(
        text(`-# Full lyrics attached · ${body.length.toLocaleString()} characters`),
      );
      files.push(
        new AttachmentBuilder(Buffer.from(`${track.title} — ${track.author}\n\n${body}\n`, "utf8"), {
          name: filename(track),
          description: "Full lyrics",
        }),
      );
    }
  }

  container.addTextDisplayComponents(text("-# Source · LRCLIB"));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    files,
  };
}
