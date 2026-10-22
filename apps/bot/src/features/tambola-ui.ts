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
} from "./tambola/game.js";

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

function ticketGrid(player: TambolaPlayer): string {
  const header = `   ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => ` ${number} `).join("")}`;
  const rows = player.ticket.rows.map((row, index) => {
    const cells = row.map((number) => {
      if (number === null) return " · ";
      return `${String(number).padStart(2, " ")}${player.marked.has(number) ? "*" : " "}`;
    });
    return `R${index + 1} ${cells.join("")}`;
  });
  return [header, ...rows].join("\n");
}

function voiceLabel(game: TambolaGame, voiceChannelId: string | null): string {
  if (!voiceChannelId) return "Text only";
  return `Voice · <#${voiceChannelId}>`;
}

export function buildTambolaLobbyPayload(
  game: TambolaGame,
  voiceChannelId: string | null,
  voiceNote?: string,
): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text(`## ${ICONS.music} Tambola · Lobby`));
  container.addTextDisplayComponents(text(`Host · <@${game.hostId}>`));
  container.addTextDisplayComponents(
    text(
      `Players ${game.players.size}/${game.maxPlayers} · Auto-call ${game.intervalSeconds}s · Marking ${game.autoMark ? "Auto" : "Manual"}`,
    ),
  );
  container.addTextDisplayComponents(text(voiceLabel(game, voiceChannelId)));
  container.addTextDisplayComponents(
    text(`**TTS** · ${voiceNote ?? (voiceChannelId ? "Ready" : "Text only")}`),
  );
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
  container.addTextDisplayComponents(text(`## ${ICONS.music} Tambola settings`));
  container.addTextDisplayComponents(
    text(`**Auto-marking** · ${game.autoMark ? "On" : "Off"}`),
  );
  container.addTextDisplayComponents(
    text(`**Voice** · ${voiceChannelId ? `<#${voiceChannelId}>` : "Text only"}`),
  );
  container.addTextDisplayComponents(
    text(`**TTS** · ${voiceNote ?? (voiceChannelId ? "Ready" : "Text only")}`),
  );
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
  container.addTextDisplayComponents(text(`## ${ICONS.music} Tambola · Live`));
  container.addTextDisplayComponents(text(`Host · <@${game.hostId}>`));
  container.addTextDisplayComponents(
    text(`**Last call** · ${last ? `\`${last}\`` : "Waiting"}   **Called** · ${game.called.length}/90`),
  );
  container.addTextDisplayComponents(
    text(
      `**Status** · ${game.status === "paused" ? "Paused" : "Live"} · ${game.intervalSeconds}s calls · Marking ${game.autoMark ? "Auto" : "Manual"} · ${voiceChannelId ? voiceLabel(game, voiceChannelId) : voiceNote ?? "Text only"}`,
    ),
  );
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(text("**Called board**"));
  container.addTextDisplayComponents(text(`\`\`\`\n${calledBoard(game)}\n\`\`\``));
  container.addTextDisplayComponents(text("-# `*` = called"));
  container.addTextDisplayComponents(text("**Claims**"));
  container.addTextDisplayComponents(text(claimList(game)));
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(text(`**Players** · ${game.players.size}`));
  container.addTextDisplayComponents(text(playerList(game)));
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
  container.addTextDisplayComponents(text(`## ${ICONS.music} ${title}`));
  if (note) container.addTextDisplayComponents(text(note));
  if (game.winnerId) {
    container.addTextDisplayComponents(text(`**Full House** · <@${game.winnerId}>`));
  } else {
    container.addTextDisplayComponents(text("**Full House** · Not claimed"));
  }
  container.addTextDisplayComponents(text(`**Called** · ${game.called.length}/90`));
  container.addTextDisplayComponents(text(`**Players** · ${game.players.size}`));
  container.addSeparatorComponents(separator());
  container.addTextDisplayComponents(text("**Claims**"));
  container.addTextDisplayComponents(text(claimList(game)));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaTicketPayload(game: TambolaGame, player: TambolaPlayer): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  const playable = game.status !== "finished" && game.status !== "cancelled";
  container.addTextDisplayComponents(text(`## ${ICONS.music} Your Tambola ticket`));
  container.addTextDisplayComponents(text(`Game \`${game.id}\` · ${player.marked.size}/15 marked`));
  container.addTextDisplayComponents(text(`\`\`\`\n${ticketGrid(player)}\n\`\`\``));
  container.addTextDisplayComponents(
    text(
      game.autoMark
        ? "-# Auto-marking is on. Use Refresh to see your marks."
        : "-# `*` = marked · Tap a called number to mark it.",
    ),
  );

  for (const row of player.ticket.rows) {
    const numbers = row.filter((number): number is number => number !== null);
    container.addActionRowComponents(
      actionRow(
        ...numbers.map((number) => {
          const marked = player.marked.has(number);
          return new ButtonBuilder()
            .setCustomId(id(game, "mark", String(number)))
            .setLabel(String(number))
            .setStyle(marked ? ButtonStyle.Success : game.calledSet.has(number) ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!playable || marked || game.autoMark);
        }),
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
  container.addActionRowComponents(
    actionRow(
      new ButtonBuilder()
        .setCustomId(id(game, "refresh"))
        .setLabel("Refresh")
        .setEmoji(EMOJI.loop)
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildTambolaClaimPayload(game: TambolaGame, player: TambolaPlayer): ReplyPayload {
  const available = CLAIM_PATTERNS.filter((pattern) => !game.claims.has(pattern));
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text(`## ${ICONS.music} Claim a pattern`));
  container.addTextDisplayComponents(text(`Game \`${game.id}\` · ${player.marked.size}/15 marked`));
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

export function buildTambolaEndConfirmPayload(game: TambolaGame): ReplyPayload {
  const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
  container.addTextDisplayComponents(text(`## ${ICONS.music} End Tambola?`));
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
  container.addTextDisplayComponents(text(`## ${ICONS.music} Tambola rules`));
  container.addTextDisplayComponents(
    text(
      [
        "**Tickets** · 3 rows × 9 columns, 15 numbers.",
        "**Calls** · Numbers 1–90 are called every 8 seconds.",
        "**Marking** · Tap a called number on your ticket to mark it.",
        "**Claims** · Top Line, Middle Line, Bottom Line, and Full House.",
        "**Winning** · The first valid claim for each pattern wins.",
        "**End** · Full House ends the game. The host can also end it.",
      ].join("\n"),
    ),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

