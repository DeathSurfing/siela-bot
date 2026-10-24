import { randomInt } from "node:crypto";

export type CahStatus = "lobby" | "active" | "finished" | "cancelled";
export type CahPhase = "submit" | "judge" | "reveal";

export interface CahPlayer {
  userId: string;
  displayName: string;
  hand: string[];
  score: number;
  joinedAt: number;
}

export interface CahSubmission {
  playerId: string;
  whiteCardIds: string[];
}

export interface CahRound {
  index: number;
  blackCardId: string;
  judgeId: string;
  submissions: Map<string, CahSubmission>;
  winnerSlot: string | null;
}

export interface CahGameState {
  id: string;
  guildId: string;
  channelId: string;
  hostId: string;
  status: CahStatus;
  phase: CahPhase;
  players: Map<string, CahPlayer>;
  judgeOrder: string[];
  judgeIndex: number;
  whiteDeck: string[];
  whiteDiscard: string[];
  blackDeck: string[];
  blackDiscard: string[];
  round: CahRound | null;
  pointsGoal: number;
  maxPlayers: number;
}

export interface CahGameOptions {
  id: string;
  guildId: string;
  channelId: string;
  hostId: string;
  maxPlayers?: number;
  pointsGoal?: number;
  whiteCards?: string[];
  blackCards?: string[];
  whiteDeck?: string[];
  blackDeck?: string[];
  whites?: string[];
  blacks?: string[];
  cards?: { white?: string[]; black?: string[]; whiteCards?: string[]; blackCards?: string[] };
  rng?: () => number;
}

export type JoinResult =
  | { ok: true; player: CahPlayer }
  | { ok: false; reason: string };

export type StartResult = { ok: true } | { ok: false; reason: string };

export type SubmitResult =
  | { ok: true; slot: string }
  | { ok: false; reason: string };

export type PickWinnerResult =
  | { ok: true; playerId: string; score: number }
  | { ok: false; reason: string };

export type NextRoundResult = { ok: true } | { ok: false; reason: string };

export type EndGameResult = { ok: true } | { ok: false; reason: string };

export type LeaveResult = { ok: true } | { ok: false; reason: string };

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const HAND_SIZE = 7;
export const PICK_COUNT = 1;
export const DEFAULT_POINTS_GOAL = 7;

const CRYPTO_RANGE = 0x1_0000_0000;

function defaultRng(): number {
  return randomInt(0, CRYPTO_RANGE) / CRYPTO_RANGE;
}

function randomIndex(rng: () => number, max: number): number {
  if (max <= 0) return 0;
  return Math.floor(rng() * max);
}

const rngByGame = new WeakMap<CahGameState, () => number>();

function getRng(game: CahGameState): () => number {
  return rngByGame.get(game) ?? defaultRng;
}

export function shuffleDeck<T>(cards: T[], rng: () => number = defaultRng): T[] {
  const deck = [...cards];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(rng, index + 1);
    [deck[index], deck[swap]] = [deck[swap]!, deck[index]!];
  }
  return deck;
}

export function shuffleCards<T>(cards: T[], rng: () => number = defaultRng): T[] {
  return shuffleDeck(cards, rng);
}

export function shuffle<T>(cards: T[], rng: () => number = defaultRng): T[] {
  return shuffleDeck(cards, rng);
}

function extractDecks(options: CahGameOptions): { white: string[]; black: string[] } {
  const o = options as any;
  const white =
    (o.whiteCards as string[] | undefined) ??
    (o.whiteDeck as string[] | undefined) ??
    (o.whites as string[] | undefined) ??
    (o.white as string[] | undefined) ??
    (o.deck?.white as string[] | undefined) ??
    (o.cards?.white as string[] | undefined) ??
    (o.cards?.whiteCards as string[] | undefined) ??
    (o.decks?.white as string[] | undefined) ??
    [];
  const black =
    (o.blackCards as string[] | undefined) ??
    (o.blackDeck as string[] | undefined) ??
    (o.blacks as string[] | undefined) ??
    (o.black as string[] | undefined) ??
    (o.deck?.black as string[] | undefined) ??
    (o.cards?.black as string[] | undefined) ??
    (o.cards?.blackCards as string[] | undefined) ??
    (o.decks?.black as string[] | undefined) ??
    [];
  return { white: [...white], black: [...black] };
}

function normalizeOptions(...args: unknown[]): CahGameOptions {
  if (typeof args[0] === "string") {
    const id = args[0] as string;
    const guildId = (args[1] as string) ?? "";
    const channelId = (args[2] as string) ?? "";
    const hostId = (args[3] as string) ?? "";
    let rest: Record<string, unknown> = {};
    if (typeof args[4] === "object" && args[4] !== null) {
      rest = args[4] as Record<string, unknown>;
    } else if (args[4] !== undefined) {
      rest = { whiteCards: args[4], blackCards: args[5] };
    }
    return {
      id,
      guildId,
      channelId,
      hostId,
      ...(rest as Partial<CahGameOptions>),
    } as CahGameOptions;
  }
  return (args[0] ?? {}) as CahGameOptions;
}

export function createGame(...args: unknown[]): CahGameState {
  const options = normalizeOptions(...args);
  const rng = options.rng ?? defaultRng;
  const decks = extractDecks(options);
  const game: CahGameState = {
    id: options.id,
    guildId: options.guildId,
    channelId: options.channelId,
    hostId: options.hostId,
    status: "lobby",
    phase: "submit",
    players: new Map(),
    judgeOrder: [],
    judgeIndex: 0,
    whiteDeck: shuffleDeck(decks.white, rng),
    whiteDiscard: [],
    blackDeck: shuffleDeck(decks.black, rng),
    blackDiscard: [],
    round: null,
    pointsGoal: options.pointsGoal ?? DEFAULT_POINTS_GOAL,
    maxPlayers: Math.max(MIN_PLAYERS, Math.min(options.maxPlayers ?? MAX_PLAYERS, MAX_PLAYERS)),
  };
  rngByGame.set(game, rng);
  return game;
}

export function joinGame(game: CahGameState, userIdOrPlayer: string | { userId: string; displayName?: string }, displayName?: string): JoinResult {
  if (game.status !== "lobby") {
    return { ok: false, reason: "This game has already started." };
  }
  const userId = typeof userIdOrPlayer === "string" ? userIdOrPlayer : userIdOrPlayer.userId;
  const name = typeof userIdOrPlayer === "string" ? (displayName ?? userId) : (userIdOrPlayer.displayName ?? userId);
  if (game.players.has(userId)) {
    return { ok: false, reason: "You are already in this game." };
  }
  if (game.players.size >= game.maxPlayers) {
    return { ok: false, reason: "This game is full." };
  }
  const player: CahPlayer = {
    userId,
    displayName: name,
    hand: [],
    score: 0,
    joinedAt: Date.now(),
  };
  game.players.set(userId, player);
  game.judgeOrder.push(userId);
  return { ok: true, player };
}

export function leaveGame(game: CahGameState, userIdOrPlayer: string | { userId: string }): LeaveResult {
  if (game.status !== "lobby") {
    return { ok: false, reason: "This game has already started." };
  }
  const userId = typeof userIdOrPlayer === "string" ? userIdOrPlayer : userIdOrPlayer.userId;
  if (!game.players.has(userId)) {
    return { ok: false, reason: "You are not in this game." };
  }
  game.players.delete(userId);
  game.judgeOrder = game.judgeOrder.filter((id) => id !== userId);
  if (game.hostId === userId) {
    const next = game.judgeOrder[0];
    if (next) game.hostId = next;
  }
  return { ok: true };
}

function drawCards(game: CahGameState, count: number, type: "white" | "black"): string[] {
  const rng = getRng(game);
  const deck = type === "white" ? game.whiteDeck : game.blackDeck;
  const discard = type === "white" ? game.whiteDiscard : game.blackDiscard;
  const drawn: string[] = [];
  while (drawn.length < count) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      const reshuffled = shuffleDeck(discard.splice(0, discard.length), rng);
      deck.push(...reshuffled);
    }
    const card = deck.pop();
    if (card === undefined) break;
    drawn.push(card);
  }
  return drawn;
}

export function startGame(game: CahGameState): StartResult {
  if (game.status !== "lobby") {
    return { ok: false, reason: "This game has already started." };
  }
  if (game.players.size < MIN_PLAYERS) {
    return { ok: false, reason: `At least ${MIN_PLAYERS} players are needed.` };
  }
  const rng = getRng(game);
  game.whiteDeck = shuffleDeck(game.whiteDeck, rng);
  game.blackDeck = shuffleDeck(game.blackDeck, rng);
  game.whiteDiscard = [];
  game.blackDiscard = [];
  game.judgeOrder = [...game.players.keys()];
  game.judgeIndex = 0;

  for (const player of game.players.values()) {
    player.hand = drawCards(game, HAND_SIZE, "white");
    player.score = 0;
  }

  const blackCardId = drawCards(game, 1, "black")[0] ?? "";
  game.round = {
    index: 0,
    blackCardId,
    judgeId: game.judgeOrder[0] ?? "",
    submissions: new Map(),
    winnerSlot: null,
  };
  game.status = "active";
  game.phase = "submit";
  return { ok: true };
}

export function submitCards(game: CahGameState, playerId: string, whiteCardIds: string | string[]): SubmitResult {
  const cards = Array.isArray(whiteCardIds) ? whiteCardIds : [whiteCardIds];
  if (game.status !== "active" || !game.round) {
    return { ok: false, reason: "That game is not accepting submissions." };
  }
  if (game.phase !== "submit") {
    return { ok: false, reason: "This round is not in the submission phase." };
  }
  const round = game.round;
  const player = game.players.get(playerId);
  if (!player) {
    return { ok: false, reason: "You are not in this game." };
  }
  if (playerId === round.judgeId) {
    return { ok: false, reason: "The judge cannot submit cards." };
  }
  for (const submission of round.submissions.values()) {
    if (submission.playerId === playerId) {
      return { ok: false, reason: "You have already submitted cards." };
    }
  }
  if (cards.length !== PICK_COUNT) {
    return { ok: false, reason: `You must submit exactly ${PICK_COUNT} card.` };
  }
  for (const cardId of cards) {
    if (!player.hand.includes(cardId)) {
      return { ok: false, reason: "You do not own that card." };
    }
  }

  for (const cardId of cards) {
    const index = player.hand.indexOf(cardId);
    if (index !== -1) player.hand.splice(index, 1);
  }

  const slot = String(round.submissions.size + 1);
  round.submissions.set(slot, { playerId, whiteCardIds: [...cards] });

  const nonJudgeCount = game.players.size - 1;
  if (round.submissions.size >= nonJudgeCount && nonJudgeCount > 0) {
    game.phase = "judge";
  }

  return { ok: true, slot };
}

export function pickWinner(game: CahGameState, judgeIdOrSlot: string, slot?: string): PickWinnerResult {
  let judgeId: string;
  let chosenSlot: string;
  if (slot === undefined) {
    judgeId = game.round?.judgeId ?? "";
    chosenSlot = judgeIdOrSlot;
  } else {
    judgeId = judgeIdOrSlot;
    chosenSlot = slot;
  }
  if (game.status !== "active" || !game.round) {
    return { ok: false, reason: "That game is not accepting judgments." };
  }
  const round = game.round;
  if (game.phase !== "judge") {
    return { ok: false, reason: "This round is not in the judging phase." };
  }
  if (judgeId !== round.judgeId) {
    return { ok: false, reason: "You are not the judge for this round." };
  }
  const submission = round.submissions.get(chosenSlot);
  if (!submission) {
    return { ok: false, reason: "That slot does not exist." };
  }
  if (round.winnerSlot !== null) {
    return { ok: false, reason: "A winner has already been picked for this round." };
  }

  round.winnerSlot = chosenSlot;
  const winner = game.players.get(submission.playerId);
  if (winner) winner.score += 1;

  for (const entry of round.submissions.values()) {
    game.whiteDiscard.push(...entry.whiteCardIds);
  }
  game.blackDiscard.push(round.blackCardId);

  game.phase = "reveal";

  if (winner && winner.score >= game.pointsGoal) {
    game.status = "finished";
  }

  return { ok: true, playerId: submission.playerId, score: winner?.score ?? 0 };
}

export function nextRound(game: CahGameState): NextRoundResult {
  if (game.status !== "active" || !game.round) {
    return { ok: false, reason: "That game is not active." };
  }
  if (game.phase !== "reveal") {
    return { ok: false, reason: "The current round has not been revealed." };
  }
  if (game.players.size === 0) {
    return { ok: false, reason: "There are no players." };
  }

  game.judgeIndex = (game.judgeIndex + 1) % game.judgeOrder.length;

  for (const player of game.players.values()) {
    const needed = HAND_SIZE - player.hand.length;
    if (needed > 0) player.hand.push(...drawCards(game, needed, "white"));
  }

  const blackCardId = drawCards(game, 1, "black")[0] ?? "";
  game.round = {
    index: game.round.index + 1,
    blackCardId,
    judgeId: game.judgeOrder[game.judgeIndex] ?? "",
    submissions: new Map(),
    winnerSlot: null,
  };
  game.phase = "submit";
  return { ok: true };
}

export function endGame(game: CahGameState): EndGameResult {
  if (game.status === "finished" || game.status === "cancelled") {
    return { ok: false, reason: "This game has already ended." };
  }
  game.status = "finished";
  return { ok: true };
}

export const removePlayer = leaveGame;
export const finishGame = endGame;
export function cancelGame(game: CahGameState): EndGameResult {
  if (game.status === "finished" || game.status === "cancelled") {
    return { ok: false, reason: "This game has already ended." };
  }
  game.status = "cancelled";
  return { ok: true };
}