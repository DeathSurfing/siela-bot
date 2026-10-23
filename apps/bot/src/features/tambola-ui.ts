import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import { truncate } from "@siela/shared";
import type { ReplyPayload } from "../framework/types.js";
import { EMOJI, ICONS, UI_ACCENT, actionRow, separator, text } from "./ui.js";
import {
  CLAIM_LABELS,
  CLAIM_PATTERNS,
  type TambolaGame,
  type TambolaPlayer,
  ticketNumbers,
} from "./tambola/game.js";

const TICKET_PAGE_SIZE = 20;

function id(game: TambolaGame, action: string, extra?: string): string {
  return `tambola:${action}:${game.id}${extra ? `:${extra}` : ""}`;
}

function playerList(game: TambolaGame): string {
  if (!game.players.size) return "-# No players yet.";
  const lines = [...game.players.values()].map(
    (player, index) => `${index + 1}. ${truncate(player.displayName, 32)}`,
  );
  return lines.join("\n");
}

function claimList(game: TambolaGame): string {
  return CLAIM_PATTERNS.map((pattern) => {
    const claim = game.claims.get(pattern);
    return `${claim ? ICONS.success : "○"} ${CLAIM_LABELS[pattern]}${claim ? ` · <@${claim.userId}>` : ""}`;
  }).join("\n");
}

function calledBoard(game: TambolaGame): string {
  const cells: string[] = [];
  for (let number = 1; number <= 90; number += 1) {
    cells.push(`${String(number).padStart(2, "0")}${game.calledSet.has(number) ? "*" : " "}`);
  }
  const lines: string[] = [];
  for (let index = 0; index < cells.length; index += 10) {
    lines.push(cells.slice(index, index + 10).join(" "));
  }
  return lines.join("\n");
}

function voiceLine(voiceChannelId: string | null, voiceNote?: string): string {
  const note = voiceNote ?? (voiceChannelId ? "Ready" : "Text only");
  if (!voiceChannelId) return `**Voice and TTS** · ${note}`;
  return `**Voice** · <#${voiceChannelId}> · **TTS** ${note}`;
}

function clampTicketPage(page: number, totalPages: number): number {
  const value = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(Math.max(value, 1), totalPages);
}

function uniqueTicketNumbers(player: TambolaPlayer): number[] {
  return [...new Set(player.tickets.flatMap((ticket) => ticketNumbers(ticket)))].sort((a, b) => a - b);
}

export function buildTambolaLobbyPayload(
  game: TambolaGame,
  voiceChannelId: string | null,
  voiceNote?: string,
): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text("## Tambola · Lobby"));
  container.addTextDisplayComponents(text(`Host · <@${game.hostId}>`));
  container.addTextDisplayComponents(
    text(
      `Players ${game.players.size}/${game.maxPlayers} · Auto-call ${game.intervalSeconds}s · Marking ${game.autoMark ? "Auto" : "Manual"}`,
    ),
  );
  container.addTextDisplayComponents(text(voiceLine(voiceChannelId, voiceNote)));
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(text(playerList(game)));
  if (voiceChannelId) {
    container.addTextDisplayComponents(text("-# TTS uses the selected voice channel; active music will be stopped."));
  }
  container.addTextDisplayComponents(text("-# Tickets are sent by DM. Join before the host starts."));
  container.addActionRowComponents(
    actionRow(
      new ButtonBuilder()
        .setCustomId(id(game, "join"))
        .setLabel("Join")
        .setEmoji(EMOJI.music)
        .setStyle(ButtonStyle.Success)
        .setDisabled(game.players.size >= game.maxPlayers),
      new ButtonBuilder()
        .setCustomId(id(game, "leave"))
        .setLabel("Leave")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(id(game, "start"))
        .setLabel("Start")
        .setEmoji(EMOJI.play)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(game.players.size < 2),
      new ButtonBuilder()
        .setCustomId(id(game, "settings"))
        .setLabel("Settings")
        .setEmoji(EMOJI.filter)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addActionRowComponents(
    actionRow(
      new ButtonBuilder()
        .setCustomId(id(game, "buyticket"))
        .setLabel("Buy ticket")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(id(game, "rules"))
        .setLabel("Rules")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaSettingsPayload(
  game: TambolaGame,
  voiceChannelId: string | null,
  voiceNote?: string,
): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text("## Tambola settings"));
  container.addTextDisplayComponents(
    text(`**Auto-marking** · ${game.autoMark ? "On" : "Off"}`),
  );
  container.addTextDisplayComponents(text(voiceLine(voiceChannelId, voiceNote)));
  container.addTextDisplayComponents(
    text(`**Calls** · every ${game.intervalSeconds} seconds`),
  );
  container.addTextDisplayComponents(
    text("-# Lobby only. Players can press Refresh on their ticket after changing auto-marking."),
  );
  container.addSeparatorComponents(separator());
  container.addActionRowComponents(
    actionRow(
      new ButtonBuilder()
        .setCustomId(id(game, "toggleautomark"))
        .setLabel(`Auto-mark: ${game.autoMark ? "On" : "Off"}`)
        .setStyle(game.autoMark ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(id(game, "novoice"))
        .setLabel("Text only")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!voiceChannelId),
    ),
  );
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(id(game, "voice"))
    .setPlaceholder("Choose TTS voice channel")
    .setChannelTypes(ChannelType.GuildVoice)
    .setMinValues(1)
    .setMaxValues(1);
  if (voiceChannelId) select.setDefaultChannels(voiceChannelId);
  container.addActionRowComponents(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaGamePayload(
  game: TambolaGame,
  voiceChannelId: string | null,
  voiceNote?: string,
): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  const last = game.called.at(-1);
  container.addTextDisplayComponents(text("## Tambola · Live"));
  container.addTextDisplayComponents(text(`Host · <@${game.hostId}>`));
  container.addTextDisplayComponents(
    text(`**Last call** · ${last ? `\`${last}\`` : "Waiting"}   **Called** · ${game.called.length}/90`),
  );
  if (game.remainingCalls === 0) {
    container.addTextDisplayComponents(
      text("-# All 90 numbers called · Full House claims are open."),
    );
  }
  const playerCount = `${game.players.size} player${game.players.size === 1 ? "" : "s"}`;
  container.addTextDisplayComponents(
    text(
      `**Status** · ${game.status === "paused" ? "Paused" : "Live"} · ${game.intervalSeconds}s calls · Marking ${game.autoMark ? "Auto" : "Manual"} · ${playerCount}`,
    ),
  );
  container.addTextDisplayComponents(text(voiceLine(voiceChannelId, voiceNote)));
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(text(`**Claims**\n${claimList(game)}`));
  container.addActionRowComponents(
    actionRow(
      new ButtonBuilder()
        .setCustomId(id(game, "claim"))
        .setLabel("Claim")
        .setEmoji(EMOJI.music)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(id(game, "ticket"))
        .setLabel("My ticket")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(id(game, "board"))
        .setLabel("Board")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(id(game, "players"))
        .setLabel("Players")
        .setStyle(ButtonStyle.Secondary),
    ),
    actionRow(
      new ButtonBuilder()
        .setCustomId(id(game, "call"))
        .setLabel("Call next")
        .setEmoji(EMOJI.play)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(game.remainingCalls === 0),
      new ButtonBuilder()
        .setCustomId(id(game, game.status === "paused" ? "resume" : "pause"))
        .setLabel(game.status === "paused" ? "Resume" : "Pause")
        .setEmoji(game.status === "paused" ? EMOJI.play : EMOJI.pause)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(id(game, "end"))
        .setLabel("End")
        .setEmoji(EMOJI.stop)
        .setStyle(ButtonStyle.Danger),
    ),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaFinalPayload(game: TambolaGame, note?: string): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  const title = game.status === "cancelled" ? "Tambola · Cancelled" : "Tambola · Finished";
  container.addTextDisplayComponents(text(`## ${title}`));
  if (note) container.addTextDisplayComponents(text(note));
  if (game.winnerId) {
    container.addTextDisplayComponents(text(`**Full House** · <@${game.winnerId}>`));
  } else {
    container.addTextDisplayComponents(text("**Full House** · Not claimed"));
  }
  container.addTextDisplayComponents(text(`**Called** · ${game.called.length}/90`));
  container.addTextDisplayComponents(text(`**Players** · ${game.players.size}`));
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(text(`**Claims**\n${claimList(game)}`));
  container.addTextDisplayComponents(text("-# Start the next lobby with `/tambola host`."));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaTicketPayload(
  game: TambolaGame,
  player: TambolaPlayer,
  options?: { page?: number; focusNumber?: number },
): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  const playable = game.status !== "finished" && game.status !== "cancelled";
  const numbers = uniqueTicketNumbers(player);
  const totalPages = Math.max(1, Math.ceil(numbers.length / TICKET_PAGE_SIZE));
  let page = options?.page ?? 1;
  if (options?.focusNumber !== undefined) {
    const index = numbers.indexOf(options.focusNumber);
    if (index >= 0) page = Math.floor(index / TICKET_PAGE_SIZE) + 1;
    else page = 1;
  }
  const currentPage = clampTicketPage(page, totalPages);

  container.addTextDisplayComponents(text("## Your Tambola ticket"));
  const pageNote = totalPages > 1 ? ` · Page ${currentPage}/${totalPages}` : "";
  container.addTextDisplayComponents(
    text(
      `${player.tickets.length} ticket${player.tickets.length === 1 ? "" : "s"} · ${player.marked.size} marked${pageNote}`,
    ),
  );
  container.addTextDisplayComponents(
    text(
      player.autoMark
        ? "-# Auto-marking is on for you. Use Refresh to see your marks."
        : "-# `*` = marked · Tap a called number to mark it.",
    ),
  );

  const pageNumbers = numbers.slice(
    (currentPage - 1) * TICKET_PAGE_SIZE,
    currentPage * TICKET_PAGE_SIZE,
  );
  for (let index = 0; index < pageNumbers.length; index += 5) {
    const chunk = pageNumbers.slice(index, index + 5);
    container.addActionRowComponents(
      actionRow(
        ...chunk.map((number) => {
          const marked = player.marked.has(number);
          return new ButtonBuilder()
            .setCustomId(id(game, "mark", String(number)))
            .setLabel(String(number))
            .setStyle(marked ? ButtonStyle.Success : game.calledSet.has(number) ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!playable || marked || player.autoMark);
        }),
      ),
    );
  }

  if (totalPages > 1) {
    container.addActionRowComponents(
      actionRow(
        new ButtonBuilder()
          .setCustomId(id(game, "ticketpage", String(Math.max(1, currentPage - 1))))
          .setLabel("Previous")
          .setEmoji(EMOJI.rewind)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage <= 1),
        new ButtonBuilder()
          .setCustomId(id(game, "ticketpage", String(Math.min(totalPages, currentPage + 1))))
          .setLabel("Next")
          .setEmoji(EMOJI.forward)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage >= totalPages),
      ),
    );
  }

  const hasAvailableClaim = CLAIM_PATTERNS.some((pattern) => !game.claims.has(pattern));
  const select = new StringSelectMenuBuilder()
    .setCustomId(id(game, "claimselect"))
    .setPlaceholder("Claim a pattern")
    .setDisabled(!playable || !hasAvailableClaim)
    .addOptions(
      CLAIM_PATTERNS.map((pattern) => ({
        label: CLAIM_LABELS[pattern],
        value: pattern,
        description: pattern === "full_house" ? "All 15 numbers" : "All 5 numbers in this row",
        disabled: game.claims.has(pattern),
      })),
    );
  container.addActionRowComponents(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
  );
  const ticketButtons = [
    new ButtonBuilder()
      .setCustomId(id(game, "refresh"))
      .setLabel("Refresh")
      .setEmoji(EMOJI.loop)
      .setStyle(ButtonStyle.Secondary),
  ];
  if (!player.autoMark) {
    ticketButtons.push(
      new ButtonBuilder()
        .setCustomId(id(game, "buyautomark"))
        .setLabel("Buy auto-mark")
        .setStyle(ButtonStyle.Primary),
    );
  }
  container.addActionRowComponents(actionRow(...ticketButtons));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaClaimPayload(game: TambolaGame, player: TambolaPlayer): ReplyPayload {
  const available = CLAIM_PATTERNS.filter((pattern) => !game.claims.has(pattern));
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text("## Claim a pattern"));
  container.addTextDisplayComponents(text(`${player.tickets.length} ticket${player.tickets.length === 1 ? "" : "s"} · ${player.marked.size} marked`));
  container.addTextDisplayComponents(
    text(
      available.length
        ? CLAIM_PATTERNS.map((pattern) => {
            const claim = game.claims.get(pattern);
            return `${claim ? ICONS.success : "○"} ${CLAIM_LABELS[pattern]}${claim ? ` · <@${claim.userId}>` : ""}`;
          }).join("\n")
        : "All patterns have been claimed.",
    ),
  );
  if (available.length) {
    container.addActionRowComponents(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(id(game, "claimselect"))
          .setPlaceholder("Choose a pattern")
          .addOptions(
            CLAIM_PATTERNS.map((pattern) => ({
              label: CLAIM_LABELS[pattern],
              value: pattern,
              description: pattern === "full_house" ? "All 15 numbers" : "All 5 numbers in this row",
              disabled: game.claims.has(pattern),
            })),
          ),
      ),
    );
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaBoardPayload(game: TambolaGame): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text("## Called board"));
  container.addTextDisplayComponents(text(`**Called** · ${game.called.length}/90`));
  container.addTextDisplayComponents(text(`\`\`\`\n${calledBoard(game)}\n\`\`\``));
  container.addTextDisplayComponents(text("-# `*` = called"));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaPlayersPayload(game: TambolaGame): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text(`## Players · ${game.players.size}`));
  container.addTextDisplayComponents(text(playerList(game)));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaEndConfirmPayload(game: TambolaGame): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text("## End Tambola?"));
  container.addTextDisplayComponents(text("This stops the game and leaves voice."));
  container.addSeparatorComponents(separator());
  container.addActionRowComponents(
    actionRow(
      new ButtonBuilder()
        .setCustomId(id(game, "endconfirm"))
        .setLabel("End game")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(id(game, "endcancel"))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaRulesPayload(): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text("## Tambola rules"));
  container.addTextDisplayComponents(
    text(
      [
        "**Tickets** · 3 rows × 9 columns, 15 numbers.",
        "**Calls** · The host sets 8, 12, or 15 seconds between calls.",
        "**Marking** · Auto-marking is on by default; tap a called number when it is off.",
        "**Claims** · Top Line, Middle Line, Bottom Line, and Full House.",
        "**Winning** · The first valid claim for each pattern wins.",
        "**End** · Full House ends the game. The host can also end it.",
      ].join("\n"),
    ),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

