import { randomInt } from "node:crypto";

export type TambolaStatus = "lobby" | "active" | "paused" | "finished" | "cancelled";

export type ClaimPattern = "top_line" | "middle_line" | "bottom_line" | "full_house";

export const CLAIM_PATTERNS: ClaimPattern[] = [
  "top_line",
  "middle_line",
  "bottom_line",
  "full_house",
];

export const CLAIM_LABELS: Record<ClaimPattern, string> = {
  top_line: "Top Line",
  middle_line: "Middle Line",
  bottom_line: "Bottom Line",
  full_house: "Full House",
};

export interface TambolaTicket {
  rows: Array<Array<number | null>>;
}

export interface TambolaPlayer {
  userId: string;
  displayName: string;
  ticket: TambolaTicket;
  marked: Set<number>;
  joinedAt: number;
}

export interface TambolaClaim {
  userId: string;
  atCall: number;
}

export interface TambolaGameOptions {
  id: string;
  guildId: string;
  channelId: string;
  hostId: string;
  maxPlayers?: number;
  intervalSeconds?: number;
  autoMark?: boolean;
  rng?: () => number;
}

export type MarkFailureCode =
  | "not_active"
  | "not_player"
  | "not_on_ticket"
  | "not_called"
  | "already_marked";

export type MarkResult =
  | { ok: true; number: number }
  | { ok: false; code: MarkFailureCode; reason: string };

export type ClaimFailureCode =
  | "not_active"
  | "not_player"
  | "already_claimed"
  | "not_complete"
  | "unmarked";

export type ClaimResult =
  | { ok: true; pattern: ClaimPattern; userId: string }
  | { ok: false; code: ClaimFailureCode; reason: string };

export type JoinResult =
  | { ok: true; player: TambolaPlayer }
  | { ok: false; reason: string };

export type StartResult = { ok: true } | { ok: false; reason: string };

const COLUMN_RANGES: Array<[number, number]> = [
  [1, 9],
  [10, 19],
  [20, 29],
  [30, 39],
  [40, 49],
  [50, 59],
  [60, 69],
  [70, 79],
  [80, 90],
];

const MAX_PLAYERS = 20;
const CRYPTO_RANGE = 0x1_0000_0000;

function defaultRng(): number {
  return randomInt(0, CRYPTO_RANGE) / CRYPTO_RANGE;
}

function randomIndex(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

function chooseColumns(rng: () => number): number[] {
  const pool = Array.from({ length: 9 }, (_, index) => index);
  for (let index = 0; index < 5; index += 1) {
    const swap = index + randomIndex(rng, pool.length - index);
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  return pool.slice(0, 5).sort((left, right) => left - right);
}

function pickNumbers(rng: () => number, start: number, end: number, count: number): number[] {
  const pool = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  for (let index = 0; index < count; index += 1) {
    const swap = index + randomIndex(rng, pool.length - index);
    [pool[index], pool[swap]] = [pool[swap]!, pool[index]!];
  }
  return pool.slice(0, count).sort((left, right) => left - right);
}

export function generateTicket(rng: () => number = defaultRng): TambolaTicket {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const rowColumns = [chooseColumns(rng), chooseColumns(rng), chooseColumns(rng)];
    const columnCounts = Array.from({ length: 9 }, () => 0);
    for (const columns of rowColumns) {
      for (const column of columns) columnCounts[column] = (columnCounts[column] ?? 0) + 1;
    }
    if (columnCounts.some((count) => count < 1 || count > 3)) continue;

    const rows: Array<Array<number | null>> = [
      Array.from({ length: 9 }, () => null),
      Array.from({ length: 9 }, () => null),
      Array.from({ length: 9 }, () => null),
    ];
    for (let column = 0; column < 9; column += 1) {
      const count = columnCounts[column] ?? 0;
      const [start, end] = COLUMN_RANGES[column]!;
      const numbers = pickNumbers(rng, start, end, count);
      const selectedRows = [0, 1, 2].filter((row) => rowColumns[row]!.includes(column));
      selectedRows.forEach((row, index) => {
        rows[row]![column] = numbers[index] ?? null;
      });
    }
    return { rows };
  }
  throw new Error("Could not generate a valid Tambola ticket.");
}

export function ticketNumbers(ticket: TambolaTicket): number[] {
  return ticket.rows.flatMap((row) => row.filter((number): number is number => number !== null));
}

export function rowNumbers(ticket: TambolaTicket, row: number): number[] {
  return ticket.rows[row]?.filter((number): number is number => number !== null) ?? [];
}

export function shuffleDeck(rng: () => number = defaultRng): number[] {
  const deck = Array.from({ length: 90 }, (_, index) => index + 1);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(rng, index + 1);
    [deck[index], deck[swap]] = [deck[swap]!, deck[index]!];
  }
  return deck;
}

export class TambolaGame {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  hostId: string;
  readonly maxPlayers: number;
  readonly intervalSeconds: number;
  readonly autoMark: boolean;
  readonly players = new Map<string, TambolaPlayer>();
  readonly called: number[] = [];
  readonly calledSet = new Set<number>();
  readonly claims = new Map<ClaimPattern, TambolaClaim>();
  status: TambolaStatus = "lobby";
  startedAt: number | null = null;
  endedAt: number | null = null;
  winnerId: string | null = null;

  private readonly rng: () => number;
  private deck: number[] = [];

  constructor(options: TambolaGameOptions) {
    this.id = options.id;
    this.guildId = options.guildId;
    this.channelId = options.channelId;
    this.hostId = options.hostId;
    this.maxPlayers = Math.max(2, Math.min(options.maxPlayers ?? MAX_PLAYERS, MAX_PLAYERS));
    this.intervalSeconds = Math.max(5, Math.min(options.intervalSeconds ?? 12, 20));
    this.autoMark = Boolean(options.autoMark);
    this.rng = options.rng ?? defaultRng;
  }

  get playerCount(): number {
    return this.players.size;
  }

  get remainingCalls(): number {
    return this.deck.length;
  }

  addPlayer(userId: string, displayName: string): JoinResult {
    if (this.status !== "lobby") {
      return { ok: false, reason: "This game has already started." };
    }
    if (this.players.has(userId)) {
      return { ok: false, reason: "You are already in this game." };
    }
    if (this.players.size >= this.maxPlayers) {
      return { ok: false, reason: "This game is full." };
    }
    const player: TambolaPlayer = {
      userId,
      displayName,
      ticket: generateTicket(this.rng),
      marked: new Set(),
      joinedAt: Date.now(),
    };
    this.players.set(userId, player);
    return { ok: true, player };
  }

  removePlayer(userId: string): boolean {
    if (this.status !== "lobby") return false;
    return this.players.delete(userId);
  }

  canStart(): StartResult {
    if (this.status !== "lobby") return { ok: false, reason: "This game has already started." };
    if (this.players.size < 2) return { ok: false, reason: "At least two players are needed." };
    return { ok: true };
  }

  start(): StartResult {
    const canStart = this.canStart();
    if (!canStart.ok) return canStart;
    this.deck = shuffleDeck(this.rng);
    this.called.length = 0;
    this.calledSet.clear();
    this.claims.clear();
    for (const player of this.players.values()) player.marked.clear();
    this.status = "active";
    this.startedAt = Date.now();
    return { ok: true };
  }

  nextCall(): number | null {
    if (this.status !== "active" && this.status !== "paused") return null;
    const number = this.deck.pop();
    if (number === undefined) return null;
    this.called.push(number);
    this.calledSet.add(number);
    if (this.autoMark) {
      for (const player of this.players.values()) {
        if (ticketNumbers(player.ticket).includes(number)) player.marked.add(number);
      }
    }
    return number;
  }

  pause(): void {
    if (this.status === "active") this.status = "paused";
  }

  resume(): void {
    if (this.status === "paused") this.status = "active";
  }

  isPlayer(userId: string): boolean {
    return this.players.has(userId);
  }

  player(userId: string): TambolaPlayer | null {
    return this.players.get(userId) ?? null;
  }

  mark(userId: string, number: number): MarkResult {
    if (this.status !== "active" && this.status !== "paused") {
      return { ok: false, code: "not_active", reason: "That game is not accepting marks." };
    }
    const player = this.players.get(userId);
    if (!player) return { ok: false, code: "not_player", reason: "You are not in this game." };
    if (!ticketNumbers(player.ticket).includes(number)) {
      return { ok: false, code: "not_on_ticket", reason: "That number is not on your ticket." };
    }
    if (!this.calledSet.has(number)) {
      return { ok: false, code: "not_called", reason: "That number has not been called yet." };
    }
    if (player.marked.has(number)) {
      return { ok: false, code: "already_marked", reason: "You already marked that number." };
    }
    player.marked.add(number);
    return { ok: true, number };
  }

  claim(userId: string, pattern: ClaimPattern): ClaimResult {
    if (this.status !== "active" && this.status !== "paused") {
      return { ok: false, code: "not_active", reason: "That game has already ended." };
    }
    const player = this.players.get(userId);
    if (!player) return { ok: false, code: "not_player", reason: "You are not in this game." };
    if (this.claims.has(pattern)) {
      return { ok: false, code: "already_claimed", reason: `${CLAIM_LABELS[pattern]} has already been claimed.` };
    }

    const required = pattern === "full_house"
      ? ticketNumbers(player.ticket)
      : rowNumbers(player.ticket, pattern === "top_line" ? 0 : pattern === "middle_line" ? 1 : 2);
    const unmarked = required.filter((number) => !player.marked.has(number));
    if (unmarked.length) {
      const notCalled = unmarked.filter((number) => !this.calledSet.has(number));
      if (notCalled.length) {
        return {
          ok: false,
          code: "not_complete",
          reason: `${CLAIM_LABELS[pattern]} is not complete yet.`,
        };
      }
      return {
        ok: false,
        code: "unmarked",
        reason: `Mark every number in ${CLAIM_LABELS[pattern]} before claiming.`,
      };
    }

    this.claims.set(pattern, { userId, atCall: this.called.length });
    if (pattern === "full_house") {
      this.status = "finished";
      this.winnerId = userId;
      this.endedAt = Date.now();
    }
    return { ok: true, pattern, userId };
  }

  transferHost(userId: string): boolean {
    if (!this.players.has(userId)) return false;
    this.hostId = userId;
    return true;
  }

  finish(winnerId: string | null = this.winnerId): void {
    if (this.status === "finished" || this.status === "cancelled") return;
    this.status = "finished";
    this.winnerId = winnerId;
    this.endedAt = Date.now();
  }

  cancel(): void {
    if (this.status === "finished" || this.status === "cancelled") return;
    this.status = "cancelled";
    this.endedAt = Date.now();
  }
}
