import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type Guild,
  type Message,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { COLORS } from "@siela/shared";
import type { ReplyPayload } from "../framework/types.js";
import { renderCardHero } from "./ui-art.js";

export const UI_ACCENT = COLORS.primary;

export const UI_THEMES = {
  primary: { color: 0xa78bfa, label: "YOUR COMMUNITY, IN HARMONY", icon: "✦" },
  social: { color: 0xe7a0c3, label: "LITTLE MOMENTS / BIG FEELINGS", icon: "♡" },
  music: { color: 0x65d6d1, label: "THE LISTENING ROOM", icon: "♫" },
  economy: { color: 0xe5bd75, label: "THE COMMUNITY ECONOMY", icon: "◈" },
  games: { color: 0xa6adff, label: "THE AFTER-HOURS ARCADE", icon: "✧" },
  voice: { color: 0x87bdf2, label: "A ROOM FOR YOUR PEOPLE", icon: "◉" },
  admin: { color: 0x94cbb4, label: "YOUR SERVER / YOUR WAY", icon: "⌘" },
  success: { color: 0x85cba8, label: "ALL TAKEN CARE OF", icon: "✓" },
  warning: { color: 0xe5bd75, label: "ONE THING BEFORE WE CONTINUE", icon: "!" },
} as const;
export type UiTheme = keyof typeof UI_THEMES;

/** Use the same visual identity in custom players, tickets, and other panels. */
export function brandedContainer(theme: UiTheme = "primary", label?: string, compact = false): ContainerBuilder {
  const look = UI_THEMES[theme];
  const container = new ContainerBuilder().setAccentColor(look.color);
  if (!compact) container.addTextDisplayComponents(text(`-# ${look.icon}  SIELA  /  ${label ?? look.label}`));
  return container;
}

export function cardFooter(container: ContainerBuilder, value = "Made for the moments in between."): void {
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(text(`-# ✦ ${value}`));
}

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
  home: "🏠",
  close: "❌",
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
  theme?: UiTheme;
  eyebrow?: string;
  footer?: string | false;
  fields?: Array<{ label: string; value: string }>;
  hero?: { title: string; kicker: string };
  rows?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  ephemeral?: boolean;
}): ReplyPayload {
  const theme = options.theme ?? "primary";
  const container = brandedContainer(theme, options.eyebrow);
  if (options.accent !== undefined) container.setAccentColor(options.accent);
  const files: AttachmentBuilder[] = [];
  if (options.hero) {
    const name = "siela-card-hero.png";
    const art = renderCardHero({ ...options.hero, color: UI_THEMES[theme].color });
    files.push(new AttachmentBuilder(art, { name }));
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(`attachment://${name}`).setDescription(options.hero.title),
    ));
  }
  const heading = [options.title ? `## ${options.title}` : "", options.subtitle ? `-# ${options.subtitle}` : ""].filter(Boolean).join("\n");
  if (heading) container.addTextDisplayComponents(text(heading));
  if ((options.title || options.subtitle) && (options.body || options.fields?.length)) container.addSeparatorComponents(separator());
  if (options.fields?.length) {
    for (const field of options.fields) container.addTextDisplayComponents(text(`-# ${field.label}\n### ${field.value}`));
    if (options.body) container.addSeparatorComponents(separator());
  }
  if (options.body) container.addTextDisplayComponents(text(options.body));
  if (options.rows?.length) {
    container.addSeparatorComponents(separator());
    container.addActionRowComponents(...options.rows);
  }
  if (options.footer !== false) cardFooter(container, options.footer || undefined);
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    ephemeral: options.ephemeral,
    ...(files.length ? { files } : {}),
  };
}

export function progressBar(current: number, total: number, width = 12): string {
  if (!Number.isFinite(total) || total <= 0) return "▱".repeat(width);
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(ratio * width);
  return `${"▰".repeat(filled)}${"▱".repeat(Math.max(0, width - filled))}`;
}

export function success(message: string): ReplyPayload {
  return card({ theme: "success", body: message, footer: false, ephemeral: true });
}

export function error(message: string): ReplyPayload {
  return card({ theme: "warning", body: message, footer: false, ephemeral: true });
}

export function empty(message: string): ReplyPayload {
  return card({ body: message, footer: false, ephemeral: true });
}

/** Normalize outgoing Discord messages, retaining controls, attachments and delivery options. */
export function styleMessage<T>(input: T): T {
  const payload = typeof input === "string" ? { content: input } : input;
  if (!payload || typeof payload !== "object") return input;
  const data = payload as Record<string, any>;
  const flags = Number(data.flags?.bitfield ?? data.flags ?? 0);
  if (flags & MessageFlags.IsComponentsV2) return input;
  if (!data.content && !data.embeds?.length) return input;
  const container = brandedContainer();
  const addText = (value: string) => {
    // Text displays accept at most 4000 characters each.
    for (let offset = 0; offset < value.length; offset += 4000) {
      container.addTextDisplayComponents(text(value.slice(offset, offset + 4000)));
    }
  };
  if (data.content) addText(data.content);
  for (const source of data.embeds ?? []) {
    const embed = typeof source.toJSON === "function" ? source.toJSON() : source;
    if (embed.color !== undefined) container.setAccentColor(embed.color);
    if (embed.author?.name) addText(`-# ${embed.author.name}`);
    if (embed.title) addText(`## ${embed.url ? `[${embed.title}](${embed.url})` : embed.title}`);
    if (embed.description) addText(embed.description);
    for (const field of embed.fields ?? []) addText(`**${field.name}**\n${field.value}`);
    const image = embed.image?.url ?? embed.thumbnail?.url;
    if (image) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
    if (embed.footer?.text) addText(`-# ${embed.footer.text}`);
  }
  // Keep original rows outside the container, preserving every custom ID and collector.
  const { content, embeds, ...rest } = data;
  return { ...rest, flags: flags | MessageFlags.IsComponentsV2, components: [container, ...(data.components ?? [])] } as T;
}

export function confirmCard(options: {
  title: string;
  body: string;
  confirmId: string;
  cancelId: string;
  confirmLabel?: string;
}): ReplyPayload {
  return card({
    theme: "warning",
    eyebrow: "CONFIRM YOUR NEXT MOVE",
    footer: "Only you can confirm this action. The controls expire automatically.",
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
  });
  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== userId) {
      await interaction.reply(styleMessage({ content: "Only the original user can change pages.", ephemeral: true })).catch(() => undefined);
      return;
    }
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
      await interaction.reply(styleMessage({ content: "This confirmation is not for you.", ephemeral: true })).catch(() => undefined);
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
