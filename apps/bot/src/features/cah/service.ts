import { randomBytes } from "node:crypto";
import {
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type StringSelectMenuInteraction,
  type ChannelSelectMenuInteraction,
  ContainerBuilder,
} from "discord.js";
import type { BotConfig } from "@siela/config";
import type { ReplyPayload } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { UI_ACCENT, text, separator, actionRow, card } from "../ui.js";
import { loadBasePack, type CahPack } from "./cards.js";
import {
  createGame,
  joinGame,
  leaveGame,
  startGame,
  submitCards,
  pickWinner,
  nextRound,
  endGame,
  cancelGame,
  type CahGameState,
  MIN_PLAYERS,
  HAND_SIZE,
  DEFAULT_POINTS_GOAL,
  MAX_PLAYERS,
} from "./game.js";

const LOBBY_TIMEOUT_MS = 10 * 60 * 1000;
const GAME_TIMEOUT_MS = 90 * 60 * 1000;

type ComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

interface CahSession {
  game: CahGameState;
  cardMessage: Message | null;
  lobbyTimer: NodeJS.Timeout | null;
  gameTimer: NodeJS.Timeout | null;
}

type OutgoingMessage = Pick<ReplyPayload, "content" | "embeds" | "components" | "files" | "allowedMentions"> & {
  flags: number;
};

function messageOptions(payload: ReplyPayload, ephemeral: boolean): OutgoingMessage {
  return {
    content: payload.content,
    embeds: payload.embeds,
    components: payload.components,
    files: payload.files,
    flags: (payload.flags ?? 0) | (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: payload.allowedMentions,
  };
}

export class CahService {
  private readonly client: Client;
  private readonly config: BotConfig | null;
  private readonly logger: Logger | null;
  private readonly byGuild = new Map<string, CahSession>();
  private readonly byId = new Map<string, CahSession>();
  private pack: CahPack | null = null;

  constructor(client: Client, a?: BotConfig | Logger | null, b?: Logger | null) {
    this.client = client;
    if (a && typeof (a as Logger).debug === "function") {
      this.config = null;
      this.logger = a as Logger;
    } else {
      this.config = (a as BotConfig | null) ?? null;
      this.logger = b ?? null;
    }
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string, meta?: unknown): void {
    const logger = this.logger as { [key: string]: (...args: unknown[]) => void } | null;
    if (logger && typeof logger[level] === "function") {
      logger[level]({ ...(meta as object) }, message);
    }
  }

  private ensurePack(): CahPack {
    if (!this.pack) this.pack = loadBasePack();
    return this.pack;
  }

  private cardText(id: string, type: "white" | "black"): string {
    const pack = this.ensurePack();
    const list = type === "white" ? pack.white : pack.black;
    return list.find((card) => card.id === id)?.text ?? id;
  }

  get(guildId: string): CahSession | null {
    return this.byGuild.get(guildId) ?? null;
  }

  require(guildId: string): CahSession {
    const session = this.get(guildId);
    if (!session) throw new UserError("No CAH game is running in this server.");
    return session;
  }

  async host(options: {
    guild: Guild;
    channel: GuildBasedChannel;
    host: GuildMember;
    pointsGoal?: number;
    maxPlayers?: number;
  }): Promise<CahSession> {
    const existing = this.byGuild.get(options.guild.id);
    if (existing) {
      throw new UserError(`A CAH game is already running in <#${existing.game.channelId}>.`);
    }
    if (!options.channel.isTextBased()) {
      throw new UserError("CAH needs a text channel.");
    }

    const pack = this.ensurePack();
    const id = this.newId();
    const game = createGame({
      id,
      guildId: options.guild.id,
      channelId: options.channel.id,
      hostId: options.host.id,
      maxPlayers: options.maxPlayers ?? MAX_PLAYERS,
      pointsGoal: options.pointsGoal ?? DEFAULT_POINTS_GOAL,
      whiteCards: pack.white.map((card) => card.id),
      blackCards: pack.black.map((card) => card.id),
    });
    joinGame(game, options.host.id, options.host.displayName);

    const session: CahSession = {
      game,
      cardMessage: null,
      lobbyTimer: null,
      gameTimer: null,
    };
    this.byGuild.set(game.guildId, session);
    this.byId.set(game.id, session);

    try {
      session.cardMessage = await options.channel.send(
        messageOptions(this.buildLobbyPayload(game), false),
      );
    } catch (error) {
      this.byGuild.delete(game.guildId);
      this.byId.delete(game.id);
      throw error;
    }

    session.lobbyTimer = setTimeout(() => {
      void this.cancel(session, "The lobby timed out.");
    }, LOBBY_TIMEOUT_MS);

    await this.updateCard(session);
    return session;
  }

  async join(guildId: string, member: GuildMember): Promise<CahSession> {
    const session = this.require(guildId);
    if (member.user.bot) throw new UserError("Bots cannot join CAH.");
    const result = joinGame(session.game, member.id, member.displayName);
    if (!result.ok) throw new UserError(result.reason);
    await this.updateCard(session);
    return session;
  }

  leave(guildId: string, userId: string): void {
    const session = this.require(guildId);
    if (session.game.status !== "lobby") {
      throw new UserError("You cannot leave after the game has started.");
    }
    const result = leaveGame(session.game, userId);
    if (!result.ok) throw new UserError(result.reason);
    if (session.game.players.size === 0) {
      void this.cancel(session, "Everyone left the lobby.");
      return;
    }
    void this.updateCard(session);
  }

  async start(guildId: string, member: GuildMember): Promise<void> {
    const session = this.require(guildId);
    if (member.id !== session.game.hostId) {
      throw new UserError("Only the host can start the game.");
    }
    const result = startGame(session.game);
    if (!result.ok) throw new UserError(result.reason);
    this.clearLobbyTimer(session);
    session.gameTimer = setTimeout(() => {
      if (session.game.status === "active") {
        void this.finish(session, "The game timed out.");
      }
    }, GAME_TIMEOUT_MS);
    await this.updateCard(session);
  }

  async reveal(guildId: string, member?: GuildMember): Promise<void> {
    const session = this.require(guildId);
    if (member && member.id !== session.game.hostId && member.id !== session.game.round?.judgeId) {
      throw new UserError("Only the host or judge can force a reveal.");
    }
    if (session.game.status !== "active" || !session.game.round) {
      throw new UserError("That game is not active.");
    }
    if (session.game.phase !== "submit") {
      throw new UserError("This round is not in the submission phase.");
    }
    session.game.phase = "judge";
    await this.updateCard(session);
  }
  async forceReveal(guildId: string): Promise<void> {
    await this.reveal(guildId);
  }

  async submit(guildId: string, userId: string, cardIds: string | string[]): Promise<{ slot: string }> {
    const session = this.require(guildId);
    const result = submitCards(session.game, userId, cardIds);
    if (!result.ok) throw new UserError(result.reason);
    await this.updateCard(session);
    return { slot: result.slot };
  }

  submitCards(guildId: string, userId: string, cardIds: string | string[]): Promise<{ slot: string }> {
    return this.submit(guildId, userId, cardIds);
  }
  submitCard(guildId: string, userId: string, cardId: string): Promise<{ slot: string }> {
    return this.submit(guildId, userId, [cardId]);
  }
  play(guildId: string, userId: string, cardIds: string | string[]): Promise<{ slot: string }> {
    return this.submit(guildId, userId, cardIds);
  }

  hand(guildId: string, userId: string): ReplyPayload {
    const session = this.require(guildId);
    return this.buildHandPayload(session.game, userId);
  }

  async pick(guildId: string, userIdOrMember: string | GuildMember, slot: string): Promise<{ playerId: string; score: number }> {
    const userId = typeof userIdOrMember === "string" ? userIdOrMember : userIdOrMember.id;
    const session = this.require(guildId);
    const result = pickWinner(session.game, userId, slot);
    if (!result.ok) throw new UserError(result.reason);
    await this.updateCard(session);
    return { playerId: result.playerId, score: result.score };
  }
  pickWinner(guildId: string, userIdOrMember: string | GuildMember, slot: string): Promise<{ playerId: string; score: number }> {
    return this.pick(guildId, userIdOrMember, slot);
  }

  async next(guildId: string, member?: GuildMember): Promise<void> {
    const session = this.require(guildId);
    if (member && member.id !== session.game.hostId && member.id !== session.game.round?.judgeId) {
      throw new UserError("Only the host or judge can advance the round.");
    }
    if (session.game.phase !== "reveal") {
      throw new UserError("The current round has not been revealed.");
    }
    const result = nextRound(session.game);
    if (!result.ok) throw new UserError(result.reason);
    await this.updateCard(session);
  }
  async nextRound(guildId: string): Promise<void> {
    await this.next(guildId);
  }

  scores(guildId: string): ReplyPayload {
    const session = this.require(guildId);
    return this.buildScoresPayload(session.game);
  }

  status(guildId: string): ReplyPayload | null {
    const session = this.get(guildId);
    if (!session) return null;
    return this.buildStatusPayload(session.game);
  }

  promptEnd(guildId: string, member: GuildMember): ReplyPayload {
    const session = this.require(guildId);
    this.assertControl(session, member);
    return this.buildEndConfirmPayload(session.game);
  }

  async end(guildId: string, member?: GuildMember): Promise<void> {
    const session = this.require(guildId);
    if (member) this.assertControl(session, member);
    await this.finish(session, "The host ended the game.");
  }
  async endGame(guildId: string): Promise<void> {
    await this.end(guildId);
  }

  rules(): ReplyPayload {
    return this.buildRulesPayload();
  }

  async handleInteraction(interaction: ComponentInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    if (parts[0] !== "cah") return;
    const action = parts[1];
    const gameId = parts[2];
    if (!action || !gameId) return;
    const session = this.byId.get(gameId);
    if (!session) {
      await this.privateReply(interaction, {
        content: "That CAH game is no longer active.",
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const member = guild
      ? await guild.members.fetch(interaction.user.id).catch(() => null)
      : null;

    try {
      if (action === "rules") {
        await this.privateReply(interaction, this.buildRulesPayload());
        return;
      }
      if (action === "join") {
        if (!member) throw new UserError("Join from the server lobby.");
        await this.deferPrivate(interaction);
        await this.join(session.game.guildId, member);
        await this.editPrivate(interaction, { content: "You joined the game.", ephemeral: true });
        return;
      }
      if (action === "leave") {
        if (!member) throw new UserError("Leave from the server lobby.");
        this.leave(session.game.guildId, member.id);
        await this.privateReply(interaction, { content: "You left the lobby.", ephemeral: true });
        return;
      }
      if (action === "start") {
        if (!member) throw new UserError("Start from the server lobby.");
        await this.deferPrivate(interaction);
        await this.start(session.game.guildId, member);
        await this.editPrivate(interaction, { content: "CAH started.", ephemeral: true });
        return;
      }
      if (action === "reveal") {
        if (!member) throw new UserError("Reveal from the server card.");
        await this.deferPrivate(interaction);
        await this.reveal(session.game.guildId, member);
        await this.editPrivate(interaction, { content: "Reveal forced.", ephemeral: true });
        return;
      }
      if (action === "next") {
        if (!member) throw new UserError("Advance from the server card.");
        await this.deferPrivate(interaction);
        await this.next(session.game.guildId, member);
        await this.editPrivate(interaction, { content: "Next round.", ephemeral: true });
        return;
      }
      if (action === "end") {
        if (!member) throw new UserError("End from the server card.");
        await this.privateReply(interaction, this.promptEnd(session.game.guildId, member));
        return;
      }
      if (action === "endconfirm") {
        if (!member) throw new UserError("End from the server card.");
        this.assertControl(session, member);
        await this.deferPrivate(interaction);
        await this.finish(session, "The host ended the game.");
        await this.editPrivate(interaction, { content: "CAH ended.", ephemeral: true });
        return;
      }
      if (action === "endcancel") {
        await interaction
          .update(messageOptions(this.buildStatusPayload(session.game), false))
          .catch(() => undefined);
        return;
      }
      if (action === "submit") {
        const cardId = parts.slice(3).join(":");
        if (!cardId) throw new UserError("Invalid card.");
        await this.deferPrivate(interaction);
        const result = await this.submit(session.game.guildId, interaction.user.id, [cardId]);
        await this.editPrivate(interaction, {
          content: `Submitted your card as slot ${result.slot}.`,
          ephemeral: true,
        });
        return;
      }
      if (action === "pick") {
        const slot = parts[3];
        if (!slot) throw new UserError("Invalid slot.");
        await this.deferPrivate(interaction);
        const result = await this.pick(session.game.guildId, interaction.user.id, slot);
        const winnerName = await this.safeDisplayName(session.game.guildId, result.playerId);
        await this.editPrivate(interaction, {
          content: `Picked slot ${slot}. Winner: ${winnerName}.`,
          ephemeral: true,
        });
        return;
      }
      if (action === "hand") {
        const payload = this.hand(session.game.guildId, interaction.user.id);
        await this.privateReply(interaction, payload);
        return;
      }
      if (action === "scores") {
        await this.privateReply(interaction, this.scores(session.game.guildId));
        return;
      }
      if (action === "status") {
        const payload = this.status(session.game.guildId);
        await this.privateReply(interaction, payload ?? { content: "No CAH game is running.", ephemeral: true });
        return;
      }
    } catch (error) {
      await this.replyError(interaction, error);
    }
  }

  onChannelDelete(channelId: string): void {
    for (const session of this.byGuild.values()) {
      if (session.game.channelId === channelId) {
        void this.cancel(session, "The game channel was deleted.");
      }
    }
  }

  onMemberRemove(guildId: string, userId: string): void {
    const session = this.byGuild.get(guildId);
    if (!session) return;
    if (session.game.status === "lobby") {
      if (session.game.players.has(userId)) {
        leaveGame(session.game, userId);
      }
      if (userId === session.game.hostId) {
        const next = [...session.game.players.keys()][0];
        if (next) session.game.hostId = next;
      }
      if (session.game.players.size === 0) {
        void this.cancel(session, "The host left the server.");
        return;
      }
      void this.updateCard(session);
      return;
    }
    if (session.game.players.has(userId)) {
      session.game.players.delete(userId);
    }
    session.game.judgeOrder = session.game.judgeOrder.filter((id) => id !== userId);
    if (userId === session.game.hostId) {
      const next = session.game.judgeOrder.find((id) => id !== userId) ?? [...session.game.players.keys()][0];
      if (next) session.game.hostId = next;
    }
    if (session.game.round && session.game.round.judgeId === userId) {
      const nextJudge = session.game.judgeOrder.find((id) => id !== userId) ?? [...session.game.players.keys()][0];
      if (nextJudge) session.game.round.judgeId = nextJudge;
    }
    if (session.game.players.size === 0) {
      void this.finish(session, "Everyone left the game.");
      return;
    }
    void this.updateCard(session);
  }

  stop(): void {
    for (const session of this.byGuild.values()) {
      this.clearTimers(session);
      try {
        cancelGame(session.game);
      } catch {
        // ignore
      }
      session.cardMessage = null;
    }
    this.byGuild.clear();
    this.byId.clear();
  }

  private async safeDisplayName(guildId: string, userId: string): Promise<string> {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) return member.displayName;
      }
      const user = await this.client.users.fetch(userId).catch(() => null);
      return user?.username ?? userId;
    } catch {
      return userId;
    }
  }

  private assertControl(session: CahSession, member: GuildMember): void {
    if (member.id === session.game.hostId) return;
    const isAdmin = member.permissions && typeof member.permissions.has === "function"
      ? member.permissions.has("Administrator")
      : false;
    const roleAdmin = this.config?.adminRoleIds?.includes?.(member.id) ?? false;
    if (isAdmin || roleAdmin) return;
    throw new UserError("Only the host or an admin can do that.");
  }

  private clearLobbyTimer(session: CahSession): void {
    if (session.lobbyTimer) {
      clearTimeout(session.lobbyTimer);
      session.lobbyTimer = null;
    }
  }

  private clearTimers(session: CahSession): void {
    this.clearLobbyTimer(session);
    if (session.gameTimer) {
      clearTimeout(session.gameTimer);
      session.gameTimer = null;
    }
  }

  private async finish(session: CahSession, note: string): Promise<void> {
    this.clearTimers(session);
    if (session.game.status !== "finished" && session.game.status !== "cancelled") {
      endGame(session.game);
    }
    await this.updateCard(session, note);
    this.detach(session);
  }

  private async cancel(session: CahSession, note: string): Promise<void> {
    this.clearTimers(session);
    if (session.game.status !== "finished" && session.game.status !== "cancelled") {
      cancelGame(session.game);
    }
    await this.updateCard(session, note);
    this.detach(session);
  }

  private detach(session: CahSession): void {
    if (this.byGuild.get(session.game.guildId) === session) {
      this.byGuild.delete(session.game.guildId);
    }
    if (this.byId.get(session.game.id) === session) {
      this.byId.delete(session.game.id);
    }
  }

  private newId(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = randomBytes(3).toString("hex").toUpperCase();
      if (!this.byId.has(id)) return id;
    }
    throw new Error("Could not allocate a CAH game ID.");
  }

  private async updateCard(session: CahSession, note?: string): Promise<void> {
    if (!session.cardMessage) return;
    const payload = note && (session.game.status === "finished" || session.game.status === "cancelled")
      ? this.buildFinalPayload(session.game, note)
      : this.buildStatusPayload(session.game);
    try {
      await session.cardMessage.edit(messageOptions(payload, false));
    } catch (error) {
      this.log("debug", "cah card update failed", { err: error, gameId: session.game.id });
    }
  }

  private async deferPrivate(interaction: ComponentInteraction): Promise<void> {
    if (interaction.replied || interaction.deferred) return;
    if (interaction.inGuild()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }
  }

  private async editPrivate(interaction: ComponentInteraction, payload: ReplyPayload): Promise<void> {
    await interaction.editReply(messageOptions(payload, false));
  }

  private async privateReply(interaction: ComponentInteraction, payload: ReplyPayload): Promise<void> {
    const data = messageOptions(payload, interaction.inGuild());
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(data).catch(() => undefined);
    } else {
      await interaction.reply(data).catch(() => undefined);
    }
  }

  private async replyError(interaction: ComponentInteraction, error: unknown): Promise<void> {
    const message = error instanceof UserError ? error.message : "That CAH action failed.";
    this.log("warn", "cah interaction failed", { err: error, customId: interaction.customId });
    if (interaction.deferred) {
      await interaction.editReply(messageOptions({ content: message }, false)).catch(() => undefined);
      return;
    }
    await this.privateReply(interaction, { content: message, ephemeral: true });
  }

  // ---------- payload builders ----------

  private buildLobbyPayload(game: CahGameState): ReplyPayload {
    const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
    container.addTextDisplayComponents(text("## CAH · Lobby"));
    container.addTextDisplayComponents(
      text(`Host · <@${game.hostId}> · Players ${game.players.size}/${game.maxPlayers} · Goal ${game.pointsGoal}`),
    );
    container.addSeparatorComponents(separator());
    const playerList = [...game.players.values()]
      .map((player, index) => `${index + 1}. ${player.displayName}`)
      .join("\n");
    container.addTextDisplayComponents(text(playerList || "-# No players yet."));
    container.addActionRowComponents(
      actionRow(
        new ButtonBuilder()
          .setCustomId(`cah:join:${game.id}`)
          .setLabel("Join")
          .setStyle(ButtonStyle.Success)
          .setDisabled(game.players.size >= game.maxPlayers),
        new ButtonBuilder()
          .setCustomId(`cah:leave:${game.id}`)
          .setLabel("Leave")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`cah:start:${game.id}`)
          .setLabel("Start")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(game.players.size < MIN_PLAYERS),
        new ButtonBuilder()
          .setCustomId(`cah:rules:${game.id}`)
          .setLabel("Rules")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  private buildStatusPayload(game: CahGameState): ReplyPayload {
    if (game.status === "lobby") return this.buildLobbyPayload(game);
    if (game.status === "finished" || game.status === "cancelled") {
      return this.buildFinalPayload(game);
    }
    return this.buildRoundPayload(game);
  }

  private buildRoundPayload(game: CahGameState): ReplyPayload {
    const round = game.round!;
    const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
    container.addTextDisplayComponents(text("## CAH · Round"));
    container.addTextDisplayComponents(text(`Black card · ${this.cardText(round.blackCardId, "black")}`));
    container.addTextDisplayComponents(text(`Judge · <@${round.judgeId}>`));
    container.addTextDisplayComponents(
      text(`Submissions · ${round.submissions.size}/${Math.max(1, game.players.size - 1)}`),
    );

    if (game.phase === "judge" || game.phase === "reveal") {
      const slots = [...round.submissions.entries()]
        .map(([slot, submission]) => {
          const shown = game.phase === "reveal"
            ? this.cardText(submission.whiteCardIds[0] ?? "", "white")
            : "Hidden";
          return `Slot ${slot} · ${shown}`;
        })
        .join("\n");
      container.addTextDisplayComponents(text(slots || "-# No submissions yet."));
    }

    if (game.phase === "reveal" && round.winnerSlot) {
      const winner = round.submissions.get(round.winnerSlot);
      if (winner) {
        const winnerPlayer = game.players.get(winner.playerId);
        container.addTextDisplayComponents(
          text(`Winner · ${winnerPlayer?.displayName ?? winner.playerId} · Slot ${round.winnerSlot}`),
        );
      }
    }

    container.addSeparatorComponents(separator());
    const scores = [...game.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((player) => `${player.displayName} · ${player.score}`)
      .join("\n");
    container.addTextDisplayComponents(text(scores || "-# No players."));

    // buttons
    const rowButtons: ButtonBuilder[] = [];
    if (game.phase === "submit") {
      rowButtons.push(
        new ButtonBuilder()
          .setCustomId(`cah:reveal:${game.id}`)
          .setLabel("Force reveal")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (game.phase === "judge") {
      for (const slot of round.submissions.keys()) {
        rowButtons.push(
          new ButtonBuilder()
            .setCustomId(`cah:pick:${game.id}:${slot}`)
            .setLabel(`Pick ${slot}`)
            .setStyle(ButtonStyle.Primary),
        );
      }
    }
    if (game.phase === "reveal") {
      rowButtons.push(
        new ButtonBuilder()
          .setCustomId(`cah:next:${game.id}`)
          .setLabel("Next round")
          .setStyle(ButtonStyle.Primary),
      );
    }
    rowButtons.push(
      new ButtonBuilder()
        .setCustomId(`cah:hand:${game.id}`)
        .setLabel("My hand")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cah:end:${game.id}`)
        .setLabel("End")
        .setStyle(ButtonStyle.Danger),
    );
    if (rowButtons.length) {
      container.addActionRowComponents(actionRow(...(rowButtons as never[])));
    }
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  private buildFinalPayload(game: CahGameState, note?: string): ReplyPayload {
    const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
    const title = game.status === "cancelled" ? "CAH · Cancelled" : "CAH · Finished";
    container.addTextDisplayComponents(text(`## ${title}`));
    if (note) container.addTextDisplayComponents(text(note));
    const winner = [...game.players.values()].sort((a, b) => b.score - a.score)[0];
    if (winner) {
      container.addTextDisplayComponents(text(`Winner · ${winner.displayName}`));
    }
    container.addSeparatorComponents(separator());
    const scores = [...game.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((player) => `${player.displayName} · ${player.score}`)
      .join("\n");
    container.addTextDisplayComponents(text(scores || "-# No players."));
    container.addTextDisplayComponents(text("-# Start a new game with `/cah host`."));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  private buildHandPayload(game: CahGameState, userId: string): ReplyPayload {
    const player = game.players.get(userId);
    if (!player) throw new UserError("You are not in this game.");
    const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
    container.addTextDisplayComponents(text("## Your hand"));
    const isJudge = game.round?.judgeId === userId;
    const alreadySubmitted = game.round
      ? [...game.round.submissions.values()].some((s) => s.playerId === userId)
      : false;
    const canSubmit = game.status === "active" && game.phase === "submit" && !isJudge && !alreadySubmitted;

    if (!player.hand.length) {
      container.addTextDisplayComponents(text("-# No cards in hand."));
    }

    const buttons = player.hand.map((cardId) =>
      new ButtonBuilder()
        .setCustomId(`cah:submit:${game.id}:${cardId}`)
        .setLabel(this.cardText(cardId, "white") || cardId)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canSubmit),
    );
    if (buttons.length) {
      // discord allows max 5 per row
      for (let i = 0; i < buttons.length; i += 5) {
        container.addActionRowComponents(actionRow(...(buttons.slice(i, i + 5) as never[])));
      }
    }
    container.addTextDisplayComponents(
      text(
        alreadySubmitted
          ? "-# You already submitted this round."
          : isJudge
            ? "-# The judge sits out this round."
            : canSubmit
              ? "-# Tap a card to submit it."
              : "-# Submissions are closed right now.",
      ),
    );
    return { components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true };
  }

  private buildScoresPayload(game: CahGameState): ReplyPayload {
    const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
    container.addTextDisplayComponents(text("## CAH · Scores"));
    const rows = [...game.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((player, index) => `${index + 1}. ${player.displayName} · ${player.score}/${game.pointsGoal}`);
    container.addTextDisplayComponents(text(rows.join("\n") || "-# No players."));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  private buildEndConfirmPayload(game: CahGameState): ReplyPayload {
    const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
    container.addTextDisplayComponents(text("## End CAH?"));
    container.addTextDisplayComponents(text("This ends the game for everyone."));
    container.addSeparatorComponents(separator());
    container.addActionRowComponents(
      actionRow(
        new ButtonBuilder()
          .setCustomId(`cah:endconfirm:${game.id}`)
          .setLabel("End game")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`cah:endcancel:${game.id}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    );
    return { components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true };
  }

  private buildRulesPayload(): ReplyPayload {
    const container = new ContainerBuilder().setAccentColor(UI_ACCENT);
    container.addTextDisplayComponents(text("## CAH · Rules"));
    container.addTextDisplayComponents(
      text(
        [
          `**Players** · ${MIN_PLAYERS} to ${MAX_PLAYERS}.`,
          `**Goal** · First to the points goal (default ${DEFAULT_POINTS_GOAL}).`,
          "**Rounds** · Judge draws a black card; everyone else submits one white card.",
          "**Judging** · The judge picks the funniest submission; that player scores.",
          "**Judge** · Rotates each round; the judge sits out submissions.",
          `**Hand** · ${HAND_SIZE} white cards, refilled after each round.`,
          "**Controls** · Host can force reveal, advance rounds, and end the game.",
        ].join("\n"),
      ),
    );
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }
}
