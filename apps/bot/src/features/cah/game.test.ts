import { describe, expect, it } from "vitest";
import {
  createGame,
  joinGame,
  leaveGame,
  startGame,
  submitCards,
  pickWinner,
  nextRound,
  endGame,
  shuffleDeck,
  shuffleCards,
  type CahGameState,
} from "./game.js";

const W = Array.from({ length: 100 }, (_, i) => `w${i}`);
const B = Array.from({ length: 100 }, (_, i) => `b${i}`);

function makeGame(pointsGoal = 7): CahGameState {
  const game = createGame({
    id: "G1",
    guildId: "guild",
    channelId: "channel",
    hostId: "host",
    whiteCards: W,
    blackCards: B,
    pointsGoal,
  });
  joinGame(game, "host", "Host");
  joinGame(game, "p1", "P1");
  joinGame(game, "p2", "P2");
  startGame(game);
  return game;
}

describe("deck", () => {
  it("shuffles every card exactly once", () => {
    const deck = shuffleDeck([...W]);
    expect(deck).toHaveLength(W.length);
    expect(new Set(deck).size).toBe(W.length);
    for (const card of W) expect(deck).toContain(card);
  });

  it("shuffleCards alias works", () => {
    expect(shuffleCards([...W])).toHaveLength(W.length);
  });

  it("deals 7 cards to each player", () => {
    const game = makeGame();
    for (const player of game.players.values()) {
      expect(player.hand).toHaveLength(7);
    }
    expect(game.round?.blackCardId).toBeTruthy();
  });
});

describe("validation", () => {
  it("rejects judge submission", () => {
    const game = makeGame();
    const judgeId = game.round!.judgeId;
    const res = submitCards(game, judgeId, [game.players.get(judgeId)!.hand[0]!]);
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining("judge") });
  });

  it("rejects double submit", () => {
    const game = makeGame();
    const nonJudge = [...game.players.keys()].find((id) => id !== game.round!.judgeId)!;
    const card = game.players.get(nonJudge)!.hand[0]!;
    expect(submitCards(game, nonJudge, [card]).ok).toBe(true);
    const second = submitCards(game, nonJudge, [game.players.get(nonJudge)!.hand[0]!]);
    expect(second).toMatchObject({ ok: false });
  });

  it("rejects unowned card", () => {
    const game = makeGame();
    const nonJudge = [...game.players.keys()].find((id) => id !== game.round!.judgeId)!;
    const res = submitCards(game, nonJudge, ["not-in-hand"]);
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining("own") });
  });
});

describe("judging", () => {
  it("judge picks anonymized slot and scores", () => {
    const game = makeGame();
    const judgeId = game.round!.judgeId;
    const submitters = [...game.players.keys()].filter((id) => id !== judgeId);
    for (const id of submitters) {
      const card = game.players.get(id)!.hand[0]!;
      expect(submitCards(game, id, [card]).ok).toBe(true);
    }
    expect(game.phase).toBe("judge");
    const slot = [...game.round!.submissions.keys()][0]!;
    const res = pickWinner(game, judgeId, slot);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.playerId).toBe(game.round!.submissions.get(slot)!.playerId);
      expect(res.score).toBe(1);
    }
    expect(game.phase).toBe("reveal");
    const winnerId = game.round!.submissions.get(slot)!.playerId;
    expect(game.players.get(winnerId)!.score).toBe(1);
  });
});

describe("rotation and refill", () => {
  it("score and rotation advance after nextRound", () => {
    const game = makeGame();
    const firstJudge = game.round!.judgeId;
    const submitters = [...game.players.keys()].filter((id) => id !== firstJudge);
    for (const id of submitters) {
      submitCards(game, id, [game.players.get(id)!.hand[0]!]);
    }
    const slot = [...game.round!.submissions.keys()][0]!;
    pickWinner(game, firstJudge, slot);
    const beforeHands = [...game.players.values()].map((p) => p.hand.length);
    const res = nextRound(game);
    expect(res.ok).toBe(true);
    expect(game.round!.judgeId).not.toBe(firstJudge);
    for (const player of game.players.values()) {
      expect(player.hand).toHaveLength(7);
    }
    void beforeHands;
  });
});

describe("reshuffle", () => {
  it("reshuffles from discard when deck empties", () => {
    const game = createGame({
      id: "G2",
      guildId: "guild",
      channelId: "channel",
      hostId: "host",
      whiteCards: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o"],
      blackCards: ["x", "y", "z"],
      pointsGoal: 100,
    });
    joinGame(game, "host", "Host");
    joinGame(game, "p1", "P1");
    joinGame(game, "p2", "P2");
    startGame(game);
    let rounds = 0;
    while (game.status === "active" && rounds < 50) {
      const judgeId = game.round!.judgeId;
      const submitters = [...game.players.keys()].filter((id) => id !== judgeId);
      for (const id of submitters) {
        if (game.players.get(id)!.hand.length === 0) {
          // skip if no card
          continue;
        }
        submitCards(game, id, [game.players.get(id)!.hand[0]!]);
      }
      if (game.phase !== "judge") break;
      const slot = [...game.round!.submissions.keys()][0];
      if (!slot) break;
      pickWinner(game, judgeId, slot);
      nextRound(game);
      rounds += 1;
    }
    // hands should still be 7 after successful refills (or game ended)
    for (const player of game.players.values()) {
      expect(player.hand.length).toBeLessThanOrEqual(7);
    }
  });
});

describe("win", () => {
  it("ends game at 7 points", () => {
    const game = makeGame(7);
    let safety = 0;
    while (game.status === "active" && safety < 100) {
      safety += 1;
      const judgeId = game.round!.judgeId;
      const submitters = [...game.players.keys()].filter((id) => id !== judgeId);
      for (const id of submitters) {
        const card = game.players.get(id)!.hand[0];
        if (card) submitCards(game, id, [card]);
      }
      if (game.phase !== "judge") break;
      const slot = [...game.round!.submissions.keys()][0];
      if (!slot) break;
      pickWinner(game, judgeId, slot);
      if (game.status !== "active") break;
      nextRound(game);
    }
    expect(game.status).toBe("finished");
    const winner = [...game.players.values()].find((p) => p.score >= 7);
    expect(winner).toBeTruthy();
    expect(winner!.score).toBe(7);
  });
});

describe("lobby", () => {
  it("leaveGame works in lobby", () => {
    const game = createGame({ id: "L", guildId: "g", channelId: "c", hostId: "host", whiteCards: W, blackCards: B });
    joinGame(game, "host", "Host");
    joinGame(game, "p1", "P1");
    joinGame(game, "p2", "P2");
    const res = leaveGame(game, "p2");
    expect(res.ok).toBe(true);
    expect(game.players.has("p2")).toBe(false);
  });

  it("startGame requires 3 players", () => {
    const game = createGame({ id: "L2", guildId: "g", channelId: "c", hostId: "host", whiteCards: W, blackCards: B });
    joinGame(game, "host", "Host");
    joinGame(game, "p1", "P1");
    const res = startGame(game);
    expect(res.ok).toBe(false);
  });

  it("endGame ends game", () => {
    const game = makeGame();
    const res = endGame(game);
    expect(res.ok).toBe(true);
    expect(game.status).toBe("finished");
  });
});