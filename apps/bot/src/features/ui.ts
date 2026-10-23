import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type Guild,
  type Message,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { COLORS } from "@siela/shared";
import type { ReplyPayload } from "../framework/types.js";

export const UI_ACCENT = COLORS.primary;

export const EMOJI = {
  music: "🎵",
  social: "💗",
  voice: "🔊",
  utility: "🧰",
  admin: "🛡️",
  play: "▶️",
  pause: "⏸️",
  skip: "⏭️",
  rewind: "⏪",
  forward: "⏩",
  shuffle: "🔀",
  loop: "🔁",
  stop: "⏹️",
  filter: "🎛️",
  off: "🚫",
  bass: "🔊",
  nightcore: "🌙",
  vaporwave: "🌴",
  kick: "➖",
  transfer: "🔄",
  delete: "🗑️",
  lock: "🔒",
  unlock: "🔓",
  rename: "✏️",
  limit: "👥",
  lyrics: "📜",
  help: "🧭",
  search: "🔎",
  home: "↩",
  close: "✕",
  nsfw: "🔞",
} as const;

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
  rewind: "↶",
  forward: "↷",
  shuffle: "⇄",
  loop: "↻",
  stop: "■",
  filter: "⚙",
  off: "∅",
  bass: "⌁",
  nightcore: "⇈",
  vaporwave: "⇊",
  kick: "−",
  transfer: "⇄",
  delete: "✕",
  lyrics: "♬",
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

export function rankLabel(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
}

export function pagedCard(options: {
  title: string;
  subtitle: string;
  body: string;
  page: number;
  totalPages: number;
  disabled?: boolean;
}): ReplyPayload {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (options.totalPages > 1) {
    rows.push(
      actionRow(
        new ButtonBuilder()
          .setCustomId(`lb:page:${options.page - 1}`)
          .setLabel("Previous")
          .setEmoji(EMOJI.rewind)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(Boolean(options.disabled) || options.page <= 1),
        new ButtonBuilder()
          .setCustomId(`lb:page:${options.page + 1}`)
          .setLabel("Next")
          .setEmoji(EMOJI.forward)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(Boolean(options.disabled) || options.page >= options.totalPages),
      ),
    );
  }
  return card({
    title: options.title,
    subtitle: `${options.subtitle} · page ${options.page}/${options.totalPages}`,
    body: options.body,
    rows,
  });
}

export function attachPagination(
  message: Message,
  userId: string,
  initialPage: number,
  render: (page: number, disabled?: boolean) => ReplyPayload,
): void {
  let currentPage = initialPage;
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120_000,
    filter: (interaction) => interaction.user.id === userId,
  });
  collector.on("collect", async (interaction) => {
    const page = Number(interaction.customId.split(":").pop()) || 1;
    currentPage = page;
    await interaction.update(render(page, false)).catch(() => undefined);
  });
  collector.on("end", () => {
    void message.edit(render(currentPage, true)).catch(() => undefined);
  });
}

export function attachConfirmation(options: {
  message: Message;
  userId: string;
  confirmId: string;
  cancelId: string;
  onConfirm: () => Promise<ReplyPayload>;
  onCancel: () => ReplyPayload | Promise<ReplyPayload>;
  timeoutMs?: number;
}): void {
  const collector = options.message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: options.timeoutMs ?? 15_000,
    filter: (interaction) => interaction.customId === options.confirmId || interaction.customId === options.cancelId,
  });
  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== options.userId) {
      await interaction.reply({ content: "This confirmation is not for you.", ephemeral: true }).catch(() => undefined);
      return;
    }
    await interaction.deferUpdate().catch(() => undefined);
    collector.stop(interaction.customId === options.confirmId ? "confirmed" : "cancelled");
  });
  collector.on("end", async (_collected, reason) => {
    try {
      if (reason === "confirmed") {
        await options.message.edit(await options.onConfirm());
      } else {
        await options.message.edit(await options.onCancel());
      }
    } catch {
      await options.message
        .edit(card({ title: "Failed", body: "That action could not be completed." }))
        .catch(() => undefined);
    }
  });
}

export async function fetchMemberNames(guild: Guild, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += 100) {
    const batch = unique.slice(index, index + 100);
    const members = await guild.members.fetch({ user: batch }).catch(() => null);
    if (!members) continue;
    for (const member of members.values()) names.set(member.id, member.displayName);
  }
  return names;
}
