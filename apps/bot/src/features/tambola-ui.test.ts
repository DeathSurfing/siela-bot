import { describe, expect, it } from "vitest";
import type { ReplyPayload } from "../framework/types.js";
import {
  buildTambolaBoardPayload,
  buildTambolaClaimPayload,
  buildTambolaFinalPayload,
  buildTambolaGamePayload,
  buildTambolaLobbyPayload,
  buildTambolaPlayersPayload,
  buildTambolaRulesPayload,
  buildTambolaTicketPayload,
} from "./tambola-ui.js";
import { TambolaGame, ticketNumbers } from "./tambola/game.js";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function makeGame(ticketCount: number, seed = 1) {
  const game = new TambolaGame({
    id: "ABC123",
    guildId: "guild",
    channelId: "channel",
    hostId: "host",
    autoMark: false,
    rng: mulberry32(seed),
  });
  const host = game.addPlayer("host", "Host");
  const joined = game.addPlayer("player", "Player");
  if (!host.ok || !joined.ok) throw new Error("could not arrange test players");
  for (let index = 1; index < ticketCount; index += 1) game.addTicket("player");
  return { game, player: joined.player };
}

interface ComponentNode {
  type?: number;
  custom_id?: string;
  label?: string;
  content?: string;
  disabled?: boolean;
  components?: ComponentNode[];
}

function componentRoots(payload: ReplyPayload): ComponentNode[] {
  return (payload.components ?? []).map((component) =>
    (component as { toJSON(): ComponentNode }).toJSON(),
  );
}

function countComponents(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((sum: number, item) => sum + countComponents(item), 0);
  }
  if (!node || typeof node !== "object") return 0;
  const record = node as ComponentNode;
  const self = typeof record.type === "number" ? 1 : 0;
  return self + countComponents(record.components);
}

function totalComponents(payload: ReplyPayload): number {
  return countComponents(componentRoots(payload));
}

function topLevelChildren(payload: ReplyPayload): ComponentNode[] {
  return componentRoots(payload)[0]?.components ?? [];
}

function walk(node: unknown, visit: (node: ComponentNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as ComponentNode;
  visit(record);
  walk(record.components, visit);
}

function allText(payload: ReplyPayload): string[] {
  const values: string[] = [];
  walk(componentRoots(payload), (node) => {
    if (typeof node.content === "string") values.push(node.content);
  });
  return values;
}

function allButtons(payload: ReplyPayload): ComponentNode[] {
  const values: ComponentNode[] = [];
  walk(componentRoots(payload), (node) => {
    if (node.custom_id) values.push(node);
  });
  return values;
}

function markButtons(payload: ReplyPayload): ComponentNode[] {
  return allButtons(payload).filter((button) => button.custom_id?.startsWith("tambola:mark:"));
}

function pageFromPayload(payload: ReplyPayload): number {
  const text = allText(payload).join("\n");
  const match = text.match(/Page (\d+)\/(\d+)/);
  if (match) return Number(match[1]);
  return 1;
}

function totalPagesFromPayload(payload: ReplyPayload): number {
  const text = allText(payload).join("\n");
  const match = text.match(/Page (\d+)\/(\d+)/);
  if (match) return Number(match[2]);
  return 1;
}

describe("tambola ticket component budget", () => {
  for (const ticketCount of [1, 2, 3, 6, 12]) {
    it(`keeps a ${ticketCount}-ticket player within Discord's component limits on every page`, () => {
      const { game, player } = makeGame(ticketCount);
      const first = buildTambolaTicketPayload(game, player);
      const totalPages = totalPagesFromPayload(first);
      expect(totalPages).toBeGreaterThanOrEqual(1);
      const seenMarks = new Set<number>();
      for (let page = 1; page <= totalPages; page += 1) {
        const payload = buildTambolaTicketPayload(game, player, { page });
        expect(totalComponents(payload)).toBeLessThanOrEqual(40);
        expect(topLevelChildren(payload).length).toBeLessThanOrEqual(10);
        for (const button of markButtons(payload)) {
          const value = Number(button.custom_id?.split(":").pop());
          seenMarks.add(value);
        }
      }
      const unique = new Set(player.tickets.flatMap((ticket) => ticketNumbers(ticket)));
      expect(seenMarks).toEqual(unique);
      for (const button of markButtons(first)) {
        expect(button.custom_id).toMatch(/^tambola:mark:ABC123:\d+$/);
      }
    });
  }

  it("clamps explicit page values", () => {
    const { game, player } = makeGame(6);
    const low = buildTambolaTicketPayload(game, player, { page: 0 });
    const high = buildTambolaTicketPayload(game, player, { page: 999 });
    expect(pageFromPayload(low)).toBe(1);
    expect(pageFromPayload(high)).toBe(totalPagesFromPayload(high));
  });

  it("selects the page containing a focused number", () => {
    const { game, player } = makeGame(6);
    const unique = player.tickets.flatMap((ticket) => ticketNumbers(ticket));
    const deduped = [...new Set(unique)].sort((a, b) => a - b);
    const target = deduped[25] ?? deduped[deduped.length - 1]!;
    const payload = buildTambolaTicketPayload(game, player, { focusNumber: target });
    const index = deduped.indexOf(target);
    const expectedPage = Math.floor(index / 20) + 1;
    expect(pageFromPayload(payload)).toBe(expectedPage);
  });

  it("falls back to page 1 when the focus number is absent", () => {
    const { game, player } = makeGame(6);
    const payload = buildTambolaTicketPayload(game, player, { focusNumber: 99999 });
    expect(pageFromPayload(payload)).toBe(1);
  });

  it("disables Previous on the first page and Next on the last page", () => {
    const { game, player } = makeGame(6);
    const totalPages = totalPagesFromPayload(buildTambolaTicketPayload(game, player));
    expect(totalPages).toBeGreaterThanOrEqual(2);
    const first = buildTambolaTicketPayload(game, player, { page: 1 });
    const firstButtons = allButtons(first);
    const prevFirst = firstButtons.find((button) => button.label === "Previous");
    const nextFirst = firstButtons.find((button) => button.label === "Next");
    expect(prevFirst?.disabled).toBe(true);
    expect(nextFirst?.disabled).toBe(false);

    const last = buildTambolaTicketPayload(game, player, { page: totalPages });
    const lastButtons = allButtons(last);
    const prevLast = lastButtons.find((button) => button.label === "Previous");
    const nextLast = lastButtons.find((button) => button.label === "Next");
    expect(prevLast?.disabled).toBe(false);
    expect(nextLast?.disabled).toBe(true);
  });

  it("builds a compact live card without board or full player list", () => {
    const { game } = makeGame(2);
    const payload = buildTambolaGamePayload(game, null, "Text only");
    const text = allText(payload).join("\n");
    expect(text).toContain("2 players");
    expect(text).not.toContain("```");
    expect(text).not.toMatch(/^\\d+\\. /m);
    const buttons = allButtons(payload);
    expect(buttons.some((button) => button.label === "Board")).toBe(true);
    expect(buttons.some((button) => button.label === "Players")).toBe(true);
  });

  it("builds a board detail payload with full content and no mutating controls", () => {
    const { game } = makeGame(2);
    const payload = buildTambolaBoardPayload(game);
    const text = allText(payload).join("\n");
    expect(text).toContain("```");
    expect(text).toContain("`*` = called");
    expect(allButtons(payload)).toHaveLength(0);
    expect(totalComponents(payload)).toBeLessThanOrEqual(40);
    expect(topLevelChildren(payload).length).toBeLessThanOrEqual(10);
  });

  it("builds a players detail payload with full content and no mutating controls", () => {
    const { game } = makeGame(2);
    const payload = buildTambolaPlayersPayload(game);
    const text = allText(payload).join("\n");
    expect(text).toContain("1. Host");
    expect(text).toContain("2. Player");
    expect(allButtons(payload)).toHaveLength(0);
    expect(totalComponents(payload)).toBeLessThanOrEqual(40);
    expect(topLevelChildren(payload).length).toBeLessThanOrEqual(10);
  });

  it("uses corrected rules copy", () => {
    const payload = buildTambolaRulesPayload();
    const text = allText(payload).join("\n");
    expect(text).toContain("8, 12, or 15 seconds");
    expect(text).toContain("Auto-marking is on by default");
    expect(text).not.toContain("every 8 seconds");
  });

  it("has exactly one Text only occurrence in a no-voice lobby", () => {
    const { game } = makeGame(1);
    const payload = buildTambolaLobbyPayload(game, null);
    const serialized = JSON.stringify(componentRoots(payload));
    const count = (serialized.match(/Text only/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("does not include the internal game id in ticket or claim headers", () => {
    const { game, player } = makeGame(1);
    const ticket = buildTambolaTicketPayload(game, player);
    const claim = buildTambolaClaimPayload(game, player);
    const ticketHeader = allText(ticket)[0] ?? "";
    const claimHeader = allText(claim)[0] ?? "";
    expect(ticketHeader).not.toContain(game.id);
    expect(claimHeader).not.toContain(game.id);
  });

  it("includes the next-lobby hint on the final card", () => {
    const { game } = makeGame(1);
    const payload = buildTambolaFinalPayload(game);
    const text = allText(payload).join("\n");
    expect(text).toContain("Start the next lobby with `/tambola host`.");
  });
});
