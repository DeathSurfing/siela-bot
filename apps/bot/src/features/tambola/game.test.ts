import { describe, expect, it } from "vitest";
import {
  TambolaGame,
  generateTicket,
  rowNumbers,
  shuffleDeck,
  ticketNumbers,
  type TambolaTicket,
} from "./game.js";

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

function makeGame(seed = 42): TambolaGame {
  const game = new TambolaGame({
    id: "ABC123",
    guildId: "guild",
    channelId: "channel",
    hostId: "host",
    rng: mulberry32(seed),
  });
  game.addPlayer("host", "Host");
  game.addPlayer("player", "Player");
  return game;
}

function callAll(game: TambolaGame): void {
  for (let index = 0; index < 90; index += 1) game.nextCall();
}

describe("ticket generation", () => {
  it("always produces a valid 3x9 ticket", () => {
    const rng = mulberry32(1234);
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const ticket = generateTicket(rng);
      expect(ticket.rows).toHaveLength(3);
      expect(ticket.rows.every((row) => row.length === 9)).toBe(true);
      for (const row of ticket.rows) {
        expect(row.filter((number) => number !== null)).toHaveLength(5);
      }
      const all = ticketNumbers(ticket);
      expect(all).toHaveLength(15);
      expect(new Set(all).size).toBe(15);
      for (let column = 0; column < 9; column += 1) {
        const values = ticket.rows
          .map((row) => row[column])
          .filter((number): number is number => number !== null);
        expect(values.length).toBeGreaterThanOrEqual(1);
        expect(values.length).toBeLessThanOrEqual(3);
        const min = column === 0 ? 1 : column * 10;
        const max = column === 8 ? 90 : column * 10 + 9;
        for (const number of values) {
          expect(number).toBeGreaterThanOrEqual(min);
          expect(number).toBeLessThanOrEqual(max);
        }
        expect(values).toEqual([...values].sort((left, right) => left - right));
      }
    }
  });

  it("shuffles every number exactly once", () => {
    const deck = shuffleDeck(mulberry32(9));
    expect(deck).toHaveLength(90);
    expect(new Set(deck).size).toBe(90);
    expect(Math.min(...deck)).toBe(1);
    expect(Math.max(...deck)).toBe(90);
  });
});

describe("TambolaGame", () => {
  it("moves through the lobby and game states", () => {
    const game = makeGame();
    expect(game.status).toBe("lobby");
    expect(game.start().ok).toBe(true);
    expect(game.status).toBe("active");
    expect(game.nextCall()).not.toBeNull();
    game.pause();
    expect(game.status).toBe("paused");
    expect(game.nextCall()).not.toBeNull();
    game.resume();
    expect(game.status).toBe("active");
    game.finish("host");
    expect(game.status).toBe("finished");
  });

  it("requires two players to start", () => {
    const game = new TambolaGame({
      id: "ONE",
      guildId: "guild",
      channelId: "channel",
      hostId: "host",
      rng: mulberry32(7),
    });
    game.addPlayer("host", "Host");
    expect(game.canStart().ok).toBe(false);
    expect(game.start().ok).toBe(false);
  });

  it("validates marks against the ticket and called numbers", () => {
    const game = makeGame();
    const player = game.player("host")!;
    const ticket = ticketNumbers(player.ticket);
    game.start();

    const beforeCall = game.mark("host", ticket[0]!);
    expect(beforeCall).toMatchObject({ ok: false, code: "not_called" });

    callAll(game);
    expect(game.mark("host", ticket[0]!)).toEqual({ ok: true, number: ticket[0] });
    expect(game.mark("host", ticket[0]!)).toMatchObject({ ok: false, code: "already_marked" });

    const notOnTicket = Array.from({ length: 90 }, (_, index) => index + 1)
      .find((number) => !ticket.includes(number))!;
    expect(game.mark("host", notOnTicket)).toMatchObject({ ok: false, code: "not_on_ticket" });
  });

  it("validates line and full-house claims", () => {
    const game = makeGame();
    const player = game.player("host")!;
    game.start();
    callAll(game);

    expect(game.claim("host", "top_line")).toMatchObject({ ok: false, code: "unmarked" });
    const top = rowNumbers(player.ticket, 0);
    for (const number of top) game.mark("host", number);
    expect(game.claim("host", "top_line")).toMatchObject({ ok: true, pattern: "top_line" });
    expect(game.claim("host", "top_line")).toMatchObject({ ok: false, code: "already_claimed" });

    for (const number of ticketNumbers(player.ticket)) game.mark("host", number);
    expect(game.claim("host", "full_house")).toMatchObject({ ok: true, pattern: "full_house" });
    expect(game.status).toBe("finished");
    expect(game.winnerId).toBe("host");
  });

  it("rejects claims before the line has been called", () => {
    const game = makeGame();
    game.start();
    expect(game.claim("host", "top_line")).toMatchObject({ ok: false, code: "not_complete" });
  });

  it("transfers the host to another player", () => {
    const game = makeGame();
    expect(game.transferHost("player")).toBe(true);
    expect(game.hostId).toBe("player");
    expect(game.transferHost("missing")).toBe(false);
  });

  it("keeps tickets valid after generation helpers", () => {
    const ticket: TambolaTicket = generateTicket(mulberry32(3));
    expect(rowNumbers(ticket, 0)).toHaveLength(5);
    expect(rowNumbers(ticket, 1)).toHaveLength(5);
    expect(rowNumbers(ticket, 2)).toHaveLength(5);
  });
});
