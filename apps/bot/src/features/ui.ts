import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { COLORS } from "@siela/shared";
import type { ReplyPayload } from "../framework/types.js";

export const UI_ACCENT = COLORS.primary;

export const ICONS = {
  music: "♪",
  social: "♥",
  voice: "◉",
  utility: "⚙",
  admin: "⌘",
  success: "✓",
  error: "!",
  live: "●",
  lock: "🔒",
  unlock: "🔓",
  rename: "✎",
  limit: "#",
  more: "⋯",
  play: "▶",
  pause: "⏸",
  skip: "⏭",
} as const;

export function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

export function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

export function actionRow(
  ...components: MessageActionRowComponentBuilder[]
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

export function card(options: {
  title?: string;
  subtitle?: string;
  body?: string;
  accent?: number;
  rows?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  ephemeral?: boolean;
}): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(options.accent ?? UI_ACCENT);
  if (options.title) container.addTextDisplayComponents(text(`## ${options.title}`));
  if (options.subtitle) container.addTextDisplayComponents(text(`-# ${options.subtitle}`));
  if (options.title || options.subtitle) container.addSeparatorComponents(separator());
  if (options.body) container.addTextDisplayComponents(text(options.body));
  if (options.rows?.length) container.addActionRowComponents(...options.rows);
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    ephemeral: options.ephemeral,
  };
}

export function progressBar(current: number, total: number, width = 12): string {
  if (!Number.isFinite(total) || total <= 0) return "▱".repeat(width);
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(ratio * width);
  return `${"▰".repeat(filled)}${"▱".repeat(Math.max(0, width - filled))}`;
}

export function success(message: string): ReplyPayload {
  return { content: `${ICONS.success} ${message}`, ephemeral: true };
}

export function error(message: string): ReplyPayload {
  return { content: `${ICONS.error} ${message}`, ephemeral: true };
}

export function empty(message: string): ReplyPayload {
  return { content: message, ephemeral: true };
}

export function confirmCard(options: {
  title: string;
  body: string;
  confirmId: string;
  cancelId: string;
  confirmLabel?: string;
}): ReplyPayload {
  return card({
    title: options.title,
    body: options.body,
    ephemeral: true,
    rows: [
      actionRow(
        new ButtonBuilder()
          .setCustomId(options.confirmId)
          .setLabel(options.confirmLabel ?? "Confirm")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(options.cancelId)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}
