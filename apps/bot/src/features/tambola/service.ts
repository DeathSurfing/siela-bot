import { styleMessage } from "../ui.js";
import { randomBytes } from "node:crypto";
import { getVoiceConnection } from "@discordjs/voice";
import {
  ChannelType,
  MessageFlags,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type StringSelectMenuInteraction,
  type VoiceChannel,
  ContainerBuilder,
} from "discord.js";
import type { BotConfig } from "@siela/config";
import { isAdmin } from "../../framework/permissions.js";
import type { ReplyPayload } from "../../framework/types.js";
import { UserError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import type { MusicService } from "../music.js";
import { FleetClient } from "../fleetClient.js";
import type { EconomyService } from "./../economy.js";
import { UI_ACCENT, text } from "../ui.js";
import {
  buildTambolaBoardPayload,
  buildTambolaClaimPayload,
  buildTambolaEndConfirmPayload,
  buildTambolaFinalPayload,
  buildTambolaGamePayload,
  buildTambolaLobbyPayload,
  buildTambolaPlayersPayload,
  buildTambolaRulesPayload,
  buildTambolaSettingsPayload,
  buildTambolaTicketPayload,
} from "../tambola-ui.js";
import { buildCallPhrase } from "./calls.js";
import { CLAIM_LABELS, CLAIM_PATTERNS, TambolaGame, type ClaimPattern, type TambolaPlayer } from "./game.js";
import { TambolaVoice } from "./voice.js";

const LOBBY_TIMEOUT_MS = 5 * 60 * 1000;
const FINAL_CLAIM_WINDOW_MS = 30_000;
const GAME_TIMEOUT_MS = 45 * 60 * 1000;
const MANUAL_CALL_THROTTLE_MS = 2_000;
const REWARD_PARTICIPATION = 5;
const REWARD_LINE = 10;
const REWARD_FULL_HOUSE = 40;

type ComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction;

interface TambolaSession {
  game: TambolaGame;
  cardMessage: Message | null;
  lobbyTimer: NodeJS.Timeout | null;
  callTimer: NodeJS.Timeout | null;
  finalizeTimer: NodeJS.Timeout | null;
  voiceTimer: NodeJS.Timeout | null;
  gameTimer: NodeJS.Timeout | null;
  voice: TambolaVoice | null;
  voiceTask: Promise<boolean> | null;
  voiceChannelId: string | null;
  voiceNote: string | null;
  lastGenericIndex: number | null;
  lastManualCallAt: number;
  calling: boolean;
  ticketCooldowns: Map<string, number>;
  lobbyActionCooldowns: Map<string, number>;
  lastSettingsAt: number;
  lastTicketRefreshAt: number;
}

type OutgoingMessage = Pick<
  ReplyPayload,
  "content" | "embeds" | "components" | "files" | "allowedMentions"
> & { flags: number };

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

export class TambolaService {
  private readonly byGuild = new Map<string, TambolaSession>();
  private readonly byId = new Map<string, TambolaSession>();

  constructor(
    private readonly client: Client,
    private readonly music: MusicService,
    private readonly config: BotConfig,
    private readonly logger: Logger,
    private readonly economy: EconomyService | null = null,
  ) {}

  private sessionEndHook: ((guildId: string) => void) | null = null;

  /** Notified when a game ends so idle consumers can release shared resources. */
  setSessionEndHook(hook: ((guildId: string) => void) | null): void {
    this.sessionEndHook = hook;
  }

  get(guildId: string): TambolaSession | null {
    return this.byGuild.get(guildId) ?? null;
  }

  isUsingVoice(guildId: string): boolean {
    // The game owns the channel while it is live, even if the voice socket
    // is briefly reconnecting. `connected` would release the lock on a blip.
    const session = this.get(guildId);
    return Boolean(session?.voice && session.voiceChannelId);
  }

  /** Voice channel this guild's game owns, or null when voice is off. */
  voiceChannel(guildId: string): string | null {
    return this.get(guildId)?.voiceChannelId ?? null;
  }

  require(guildId: string): TambolaSession {
    const session = this.get(guildId);
    if (!session) throw new UserError("No Tambola game is running in this server.");
    return session;
  }

  async host(options: {
    guild: Guild;
    channel: GuildBasedChannel;
    host: GuildMember;
    maxPlayers: number;
    intervalSeconds?: number;
    autoMark?: boolean;
    voiceChannelId: string | null;
  }): Promise<TambolaSession> {
    const existing = this.byGuild.get(options.guild.id);
    if (existing) {
      throw new UserError(`A Tambola game is already running in <#${existing.game.channelId}>.`);
    }
    if (!options.channel.isTextBased()) {
      throw new UserError("Tambola needs a text channel.");
    }
    if (options.voiceChannelId) {
      const channel = options.guild.channels.cache.get(options.voiceChannelId)
        ?? await options.guild.channels.fetch(options.voiceChannelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        throw new UserError("Choose a voice channel for Tambola.");
      }
    }

    const id = this.newId();
    const game = new TambolaGame({
      id,
      guildId: options.guild.id,
      channelId: options.channel.id,
      hostId: options.host.id,
      maxPlayers: options.maxPlayers,
      intervalSeconds: options.intervalSeconds,
      autoMark: options.autoMark,
    });
    const session: TambolaSession = {
      game,
      cardMessage: null,
      lobbyTimer: null,
      callTimer: null,
      finalizeTimer: null,
      voiceTimer: null,
      gameTimer: null,
      voice: null,
      voiceTask: null,
      voiceChannelId: options.voiceChannelId,
      voiceNote: options.voiceChannelId ? "Connecting voice…" : "Text only",
      lastGenericIndex: null,
      lastManualCallAt: 0,
      calling: false,
      ticketCooldowns: new Map(),
      lobbyActionCooldowns: new Map(),
      lastSettingsAt: 0,
      lastTicketRefreshAt: 0,
    };
    this.byGuild.set(game.guildId, session);
    this.byId.set(game.id, session);
    try {
      session.cardMessage = await options.channel.send(
        styleMessage(messageOptions(
          buildTambolaLobbyPayload(game, session.voiceChannelId, session.voiceNote ?? undefined),
          false,
        )),
      );
    } catch (error) {
      this.byGuild.delete(game.guildId);
      this.byId.delete(game.id);
      throw error;
    }
    session.lobbyTimer = setTimeout(
      () => void this.cancel(session, "The lobby timed out."),
      LOBBY_TIMEOUT_MS,
    );
    await this.ensureVoice(session);
    await this.updateCard(session);
    return session;
  }

  async join(
    guildId: string,
    member: GuildMember,
  ): Promise<{ session: TambolaSession; dmSent: boolean; payload: ReplyPayload }> {
    const session = this.require(guildId);
    if (member.user.bot) throw new UserError("Bots cannot join Tambola.");
    this.assertLobbyCooldown(session, member.id);
    const result = session.game.addPlayer(member.id, member.displayName);
    if (!result.ok) throw new UserError(result.reason);
    const payload = buildTambolaTicketPayload(session.game, result.player);
    const dmSent = await this.sendTicketDm(member.user, payload);
    await this.updateCard(session);
    return { session, dmSent, payload };
  }

  leave(guildId: string, userId: string): void {
    const session = this.require(guildId);
    if (session.game.status !== "lobby") throw new UserError("You cannot leave after the game has started.");
    this.assertLobbyCooldown(session, userId);
    if (!session.game.removePlayer(userId)) throw new UserError("You are not in this lobby.");
    void this.updateCard(session);
  }

  async buyTicket(guildId: string, userId: string): Promise<number> {
    const session = this.require(guildId);
    if (session.game.status !== "lobby") throw new UserError("Tickets can only be bought in the lobby.");
    const player = session.game.player(userId);
    if (!player) throw new UserError("Join the lobby before buying a ticket.");
    if (!this.economy) throw new UserError("Economy is not available.");
    const nextNumber = player.tickets.length + 1;
    try {
      await this.economy.spend(guildId, userId, 25, "tambola_ticket", `tambola:${session.game.id}:ticket:${userId}:${nextNumber}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Purchase failed.";
      if (message === "INSUFFICIENT_FUNDS") throw new UserError("You need 25 SC to buy a ticket.");
      throw new UserError(message);
    }
    const ticket = session.game.addTicket(userId);
    if (!ticket) {
      await this.economy.award(guildId, userId, 25, "tambola_ticket_refund", `tambola:${session.game.id}:ticket-refund:${userId}:${nextNumber}`).catch(() => undefined);
      throw new UserError("Could not generate a ticket. Your coins have been refunded.");
    }
    await this.updateCard(session);
    return player.tickets.length;
  }

  async buyAutoMark(guildId: string, userId: string): Promise<void> {
    const session = this.require(guildId);
    if (session.game.status !== "lobby") throw new UserError("Auto-mark can only be bought in the lobby.");
    const player = session.game.player(userId);
    if (!player) throw new UserError("Join the lobby before buying auto-mark.");
    if (player.autoMark) throw new UserError("You already have auto-marking.");
    if (!this.economy) throw new UserError("Economy is not available.");
    try {
      await this.economy.spend(guildId, userId, 10, "tambola_automark", `tambola:${session.game.id}:automark:${userId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Purchase failed.";
      if (message === "INSUFFICIENT_FUNDS") throw new UserError("You need 10 SC to buy auto-marking.");
      throw new UserError(message);
    }
    if (!session.game.setPlayerAutoMark(userId, true)) {
      await this.economy.award(guildId, userId, 10, "tambola_automark_refund", `tambola:${session.game.id}:automark-refund:${userId}`).catch(() => undefined);
      throw new UserError("Could not enable auto-marking. Your coins have been refunded.");
    }
    await this.updateCard(session);
  }

  async start(guildId: string, member: GuildMember): Promise<void> {
    const session = this.require(guildId);
    if (member.id !== session.game.hostId) throw new UserError("Only the host can start the game.");
    const result = session.game.start();
    if (!result.ok) throw new UserError(result.reason);
    this.clearTimers(session, "lobby");
    await this.ensureVoice(session);
    await this.updateCard(session);
    if (session.voice) void session.voice.speak("Eyes down, let's play Tambola!");
    session.gameTimer = setTimeout(() => {
      if (session.game.status === "active" || session.game.status === "paused") {
        void this.finishGame(session, "The game timed out.");
      }
    }, GAME_TIMEOUT_MS);
    session.callTimer = setTimeout(() => void this.callNext(session), 5_000);
  }

  async ticket(
    guildId: string,
    userId: string,
  ): Promise<{ dmSent: boolean; payload: ReplyPayload; player: TambolaPlayer }> {
    const session = this.require(guildId);
    const player = session.game.player(userId);
    if (!player) throw new UserError("You are not in this game.");
    this.assertTicketCooldown(session, userId);
    const payload = buildTambolaTicketPayload(session.game, player);
    const dmSent = await this.sendTicketDm(
      await this.client.users.fetch(userId),
      payload,
    );
    return { dmSent, payload, player };
  }

  async call(guildId: string, member: GuildMember): Promise<number | null> {
    const session = this.require(guildId);
    if (member.id !== session.game.hostId) throw new UserError("Only the host can call numbers.");
    if (session.calling) throw new UserError("A number is already being called.");
    if (Date.now() - session.lastManualCallAt < MANUAL_CALL_THROTTLE_MS) {
      throw new UserError("Wait a moment before calling the next number.");
    }
    return this.callNext(session, true);
  }

  async pause(guildId: string, member: GuildMember): Promise<void> {
    const session = this.require(guildId);
    if (member.id !== session.game.hostId) throw new UserError("Only the host can pause the game.");
    if (session.game.status !== "active") throw new UserError("The game is not running.");
    session.game.pause();
    this.clearTimers(session, "call");
    await this.updateCard(session);
    if (session.voice) void session.voice.speak("Game paused.");
  }

  async resume(guildId: string, member: GuildMember): Promise<void> {
    const session = this.require(guildId);
    if (member.id !== session.game.hostId) throw new UserError("Only the host can resume the game.");
    if (session.game.status !== "paused") throw new UserError("The game is not paused.");
    session.game.resume();
    await this.updateCard(session);
    this.scheduleCall(session);
    if (session.voice) void session.voice.speak("Game resumed.");
  }

  settingsPayload(guildId: string, member: GuildMember): ReplyPayload {
    const session = this.require(guildId);
    this.assertHost(session, member);
    if (session.game.status !== "lobby") {
      throw new UserError("Settings can only be changed in the lobby.");
    }
    return buildTambolaSettingsPayload(
      session.game,
      session.voiceChannelId,
      session.voiceNote ?? (session.voice?.connected ? "Ready" : "Text only"),
    );
  }

  promptEnd(guildId: string, member: GuildMember): ReplyPayload {
    const session = this.require(guildId);
    this.assertControl(session, member);
    return buildTambolaEndConfirmPayload(session.game);
  }

  async end(guildId: string, member: GuildMember): Promise<void> {
    const session = this.require(guildId);
    this.assertControl(session, member);
    await this.finishGame(session, "The host ended the game.");
  }

  status(guildId: string): ReplyPayload | null {
    const session = this.get(guildId);
    if (!session) return null;
    return this.cardPayload(session);
  }

  rules(): ReplyPayload {
    return buildTambolaRulesPayload();
  }

  async handleInteraction(interaction: ComponentInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    if (parts[0] !== "tambola") return;
    const action = parts[1];
    const gameId = parts[2];
    if (!action || !gameId) return;
    const session = this.byId.get(gameId);
    if (!session) {
      await this.privateReply(interaction, {
        content: "That Tambola game is no longer active.",
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
        await this.privateReply(interaction, buildTambolaRulesPayload());
        return;
      }
      if (action === "settings") {
        if (!member) throw new UserError("Open settings from the server lobby.");
        await this.privateReply(interaction, this.settingsPayload(session.game.guildId, member));
        return;
      }
      if (action === "toggleautomark") {
        if (!member) throw new UserError("Change settings from the server lobby.");
        this.assertHost(session, member);
        if (session.game.status !== "lobby") throw new UserError("Settings can only be changed in the lobby.");
        this.assertSettingsCooldown(session);
        await interaction.deferUpdate();
        session.game.setAutoMark(!session.game.autoMark);
        await this.updateCard(session);
        void this.refreshPlayerTickets(session).catch((error) =>
          this.logger.warn({ err: error, gameId: session.game.id }, "tambola ticket refresh failed"),
        );
        await interaction.editReply(
          styleMessage(messageOptions(
            buildTambolaSettingsPayload(
              session.game,
              session.voiceChannelId,
              session.voiceNote ?? (session.voice?.connected ? "Ready" : "Text only"),
            ),
            false,
          )),
        );
        return;
      }
      if (action === "novoice") {
        if (!member) throw new UserError("Change settings from the server lobby.");
        this.assertHost(session, member);
        if (session.game.status !== "lobby") throw new UserError("Settings can only be changed in the lobby.");
        this.assertSettingsCooldown(session);
        await interaction.deferUpdate();
        await this.clearVoice(session);
        session.voiceChannelId = null;
        session.voiceNote = "Text only";
        this.music.unlockVoice(session.game.guildId);
        await this.updateCard(session);
        await interaction.editReply(
          styleMessage(messageOptions(
            buildTambolaSettingsPayload(
              session.game,
              session.voiceChannelId,
              session.voiceNote ?? (session.voice?.connected ? "Ready" : "Text only"),
            ),
            false,
          )),
        );
        return;
      }
      if (action === "voice") {
        if (!member) throw new UserError("Change settings from the server lobby.");
        this.assertHost(session, member);
        if (session.game.status !== "lobby") throw new UserError("Settings can only be changed in the lobby.");
        this.assertSettingsCooldown(session);
        if (session.voiceTask) throw new UserError("A voice change is already in progress.");
        if (!interaction.isChannelSelectMenu()) throw new UserError("Choose a voice channel.");
        const channelId = interaction.values[0];
        if (!channelId) throw new UserError("Choose a voice channel.");
        const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildVoice) {
          throw new UserError("Choose a voice channel.");
        }
        if (channelId === session.voiceChannelId && session.voice?.connected) {
          await interaction.update(
            styleMessage(messageOptions(
              buildTambolaSettingsPayload(
                session.game,
                session.voiceChannelId,
                session.voiceNote ?? "Ready",
              ),
              false,
            )),
          );
          return;
        }
        await interaction.deferUpdate();
        await this.clearVoice(session);
        session.voiceChannelId = channelId;
        session.voiceNote = null;
        await this.ensureVoice(session);
        await this.updateCard(session);
        await interaction.editReply(
          styleMessage(messageOptions(
            buildTambolaSettingsPayload(
              session.game,
              session.voiceChannelId,
              session.voiceNote ?? (session.voice?.connected ? "Ready" : "Text only"),
            ),
            false,
          )),
        );
        return;
      }
      if (action === "join") {
        if (!member) throw new UserError("Join from the server lobby.");
        await this.handleJoin(interaction, session, member);
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
        await this.editPrivate(interaction, { content: "Tambola started.", ephemeral: true });
        return;
      }
      if (action === "call") {
        if (!member) throw new UserError("Call numbers from the server game card.");
        const number = await this.call(session.game.guildId, member);
        await this.privateReply(interaction, {
          content: number === null ? "No numbers remain." : `Called ${number}.`,
          ephemeral: true,
        });
        return;
      }
      if (action === "pause") {
        if (!member) throw new UserError("Pause from the server game card.");
        await this.pause(session.game.guildId, member);
        await this.privateReply(interaction, { content: "Game paused.", ephemeral: true });
        return;
      }
      if (action === "resume") {
        if (!member) throw new UserError("Resume from the server game card.");
        await this.resume(session.game.guildId, member);
        await this.privateReply(interaction, { content: "Game resumed.", ephemeral: true });
        return;
      }
      if (action === "end") {
        if (!member) throw new UserError("End the game from the server game card.");
        await this.privateReply(interaction, this.promptEnd(session.game.guildId, member));
        return;
      }
      if (action === "endconfirm") {
        if (!member) throw new UserError("End the game from the server game card.");
        this.assertControl(session, member);
        await this.deferPrivate(interaction);
        await this.finishGame(session, "The host ended the game.");
        await this.editPrivate(interaction, { content: "Tambola ended.", ephemeral: true });
        return;
      }
      if (action === "endcancel") {
        await interaction
          .update(
            styleMessage(messageOptions(
              {
                components: [
                  new ContainerBuilder()
                    .setAccentColor(UI_ACCENT)
                    .addTextDisplayComponents(text("## Tambola"))
                    .addTextDisplayComponents(text("The game continues.")),
                ],
                flags: MessageFlags.IsComponentsV2,
              },
              false,
            )),
          )
          .catch(() => undefined);
        return;
      }
      if (action === "ticket") {
        const player = session.game.player(interaction.user.id);
        if (!player) throw new UserError("You are not in this game.");
        this.assertTicketCooldown(session, interaction.user.id);
        await this.deferPrivate(interaction);
        const payload = buildTambolaTicketPayload(session.game, player);
        const dmSent = await this.sendTicketDm(interaction.user, payload);
        await this.editPrivate(interaction, dmSent ? { content: "Ticket sent by DM." } : payload);
        return;
      }
      if (action === "ticketpage") {
        const player = session.game.player(interaction.user.id);
        if (!player) throw new UserError("You are not in this game.");
        const page = Number(parts[3]);
        await interaction.update(
          styleMessage(messageOptions(buildTambolaTicketPayload(session.game, player, { page }), false)),
        );
        return;
      }
      if (action === "board") {
        await this.privateReply(interaction, buildTambolaBoardPayload(session.game));
        return;
      }
      if (action === "players") {
        await this.privateReply(interaction, buildTambolaPlayersPayload(session.game));
        return;
      }
      if (action === "claim") {
        const player = session.game.player(interaction.user.id);
        if (!player) throw new UserError("You are not in this game.");
        await this.privateReply(interaction, buildTambolaClaimPayload(session.game, player));
        return;
      }
      if (action === "claimselect") {
        const player = session.game.player(interaction.user.id);
        if (!player) throw new UserError("You are not in this game.");
        if (!interaction.isStringSelectMenu()) throw new UserError("Choose a pattern from the menu.");
        const pattern = interaction.values[0] as ClaimPattern | undefined;
        if (!pattern || !CLAIM_PATTERNS.includes(pattern)) throw new UserError("Choose a valid pattern.");
        const result = session.game.claim(interaction.user.id, pattern);
        if (!result.ok) {
          await this.privateReply(interaction, { content: result.reason, ephemeral: true });
          return;
        }
        await this.updateCard(session);
        if (pattern === "full_house") {
          const winner = interaction.user.id;
          this.reward(
            session.game.guildId,
            winner,
            REWARD_FULL_HOUSE,
            "tambola_win",
            `tambola:${session.game.id}:full_house:${winner}`,
          );
          await this.finishGame(session, `<@${winner}> claimed Full House.`);
          await this.privateReply(interaction, {
            content: "Full House! Congratulations!",
            ephemeral: true,
          });
          return;
        }
        this.reward(
          session.game.guildId,
          interaction.user.id,
          REWARD_LINE,
          "tambola_line",
          `tambola:${session.game.id}:line:${pattern}:${interaction.user.id}`,
        );
        if (session.voice) void session.voice.speak(`${CLAIM_LABELS[pattern]} claimed!`);
        await this.privateReply(interaction, {
          content: `${CLAIM_LABELS[pattern]} claimed!`,
          ephemeral: true,
        });
        return;
      }
      if (action === "mark") {
        const player = session.game.player(interaction.user.id);
        if (!player) throw new UserError("You are not in this game.");
        const number = Number(parts[3]);
        if (!Number.isInteger(number)) throw new UserError("Invalid number.");
        const result = session.game.mark(interaction.user.id, number);
        if (!result.ok) {
          await this.privateReply(interaction, { content: result.reason, ephemeral: true });
          return;
        }
        await interaction.update(
          styleMessage(messageOptions(
            buildTambolaTicketPayload(session.game, player, { focusNumber: number }),
            false,
          )),
        );
        return;
      }
      if (action === "buyticket") {
        if (!member) throw new UserError("Buy tickets from the server lobby.");
        await this.deferPrivate(interaction);
        const count = await this.buyTicket(session.game.guildId, member.id);
        await this.editPrivate(interaction, { content: `You now have ${count} ticket${count === 1 ? "" : "s"}.`, ephemeral: true });
        return;
      }
      if (action === "buyautomark") {
        if (!member) throw new UserError("Buy auto-mark from your ticket.");
        await this.deferPrivate(interaction);
        await this.buyAutoMark(session.game.guildId, member.id);
        const player = session.game.player(interaction.user.id);
        const payload = player ? buildTambolaTicketPayload(session.game, player) : null;
        await this.editPrivate(interaction, payload ? payload : { content: "Auto-marking enabled.", ephemeral: true });
        return;
      }
      if (action === "refresh") {
        const player = session.game.player(interaction.user.id);
        if (!player) throw new UserError("You are not in this game.");
        await interaction.update(styleMessage(messageOptions(buildTambolaTicketPayload(session.game, player), false)));
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
        return;
      }
      if (session.voiceChannelId === channelId) {
        session.voiceChannelId = null;
        session.voice?.leave();
        session.voice = null;
        session.voiceNote = "Text only";
        this.music.unlockVoice(session.game.guildId);
        void this.updateCard(session);
      }
    }
  }

  onMemberRemove(guildId: string, userId: string): void {
    const session = this.byGuild.get(guildId);
    if (!session) return;
    if (session.game.status === "lobby") {
      if (userId === session.game.hostId) {
        void this.cancel(session, "The host left the server.");
        return;
      }
      if (session.game.removePlayer(userId)) void this.updateCard(session);
      return;
    }
    if (userId === session.game.hostId) {
      const next = [...session.game.players.keys()].find((id) => id !== userId);
      if (next) {
        session.game.transferHost(next);
        void this.updateCard(session);
      } else {
        void this.cancel(session, "The host left the server.");
      }
    }
  }

  stop(): void {
    for (const session of this.byGuild.values()) {
      this.clearTimers(session);
      session.game.cancel();
      session.voice?.leave();
      session.voice = null;
      this.music.unlockVoice(session.game.guildId);
    }
    this.byGuild.clear();
    this.byId.clear();
  }

  private async handleJoin(
    interaction: ComponentInteraction,
    session: TambolaSession,
    member: GuildMember,
  ): Promise<void> {
    if (member.user.bot) throw new UserError("Bots cannot join Tambola.");
    this.assertLobbyCooldown(session, member.id);
    await this.deferPrivate(interaction);
    const result = session.game.addPlayer(member.id, member.displayName);
    if (!result.ok) throw new UserError(result.reason);
    const payload = buildTambolaTicketPayload(session.game, result.player);
    const dmSent = await this.sendTicketDm(member.user, payload);
    await this.updateCard(session);
    await this.editPrivate(
      interaction,
      dmSent ? { content: "You joined. Your ticket was sent by DM." } : payload,
    );
  }

  private ensureVoice(session: TambolaSession): Promise<boolean> {
    if (session.voiceTask) return session.voiceTask;
    const task = this.connectVoice(session)
      .catch((error) => {
        this.logger.warn({ err: error, gameId: session.game.id }, "tambola voice setup failed");
        session.voiceNote = "Text only · TTS unavailable";
        return false;
      })
      .finally(() => {
        if (session.voiceTask === task) session.voiceTask = null;
      });
    session.voiceTask = task;
    return task;
  }

  private async connectVoice(session: TambolaSession): Promise<boolean> {
    const guildId = session.game.guildId;
    if (!session.voiceChannelId) {
      session.voiceNote = "Text only";
      this.music.unlockVoice(guildId);
      this.logger.info({ guildId }, "tambola voice not configured; running text-only");
      return false;
    }
    // The selected channel may be served by a fleet worker. The commander's
    // own player can't see it, so stop that node explicitly before joining.
    const fleetNode = this.music.getFleetNode(guildId, session.voiceChannelId);
    if (fleetNode && this.config.ROUTER_URL) {
      try {
        await new FleetClient(this.config.ROUTER_URL, this.config.MCP_TOKEN, this.logger)
          .control(fleetNode, "disconnect");
        this.logger.info(
          { guildId, nodeId: fleetNode, channelId: session.voiceChannelId },
          "tambola stopped fleet music",
        );
      } catch (error) {
        this.logger.warn({ err: error, guildId, nodeId: fleetNode }, "tambola could not stop fleet music");
      }
      this.music.setFleetNode(guildId, session.voiceChannelId, null);
    }
    if (this.music.isConnected(guildId)) {
      try {
        await this.music.disconnect(guildId);
        this.logger.info({ guildId }, "tambola stopped music to use the voice channel");
      } catch (error) {
        this.logger.warn({ err: error, guildId }, "tambola could not stop music");
        session.voiceNote = "Text only · music active";
        this.music.unlockVoice(guildId);
        return false;
      }
      if (session.voice) {
        session.voice.leave();
        session.voice = null;
      }
    }
    if (!session.voice?.connected && session.voice) {
      session.voice.leave();
      session.voice = null;
    }
    if (session.voice?.connected) {
      session.voiceNote = null;
      this.music.lockVoice(guildId);
      return true;
    }
    const lingering = getVoiceConnection(guildId);
    if (lingering) {
      lingering.destroy();
      this.logger.debug({ guildId }, "tambola cleared a lingering voice connection");
    }
    session.voiceNote = "Connecting voice…";
    const guild = this.client.guilds.cache.get(guildId);
    const channel = guild
      ? await guild.channels.fetch(session.voiceChannelId).catch(() => null)
      : null;
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      session.voiceNote = "Text only · voice channel unavailable";
      this.music.unlockVoice(guildId);
      this.logger.warn({ guildId, channelId: session.voiceChannelId }, "tambola voice channel unavailable");
      return false;
    }
    let joined = false;
    const voice = new TambolaVoice(this.logger);
    try {
      joined = await voice.join(channel as VoiceChannel);
    } catch (error) {
      this.logger.warn({ err: error, guildId, channelId: session.voiceChannelId }, "tambola voice join failed");
    }
    if (!joined) {
      session.voiceNote = "Text only · TTS unavailable";
      this.music.unlockVoice(guildId);
      return false;
    }
    if (
      this.byId.get(session.game.id) !== session ||
      session.game.status === "cancelled" ||
      session.voiceChannelId !== channel.id
    ) {
      voice.leave();
      this.music.unlockVoice(guildId);
      return false;
    }
    session.voice = voice;
    session.voiceNote = null;
    this.music.lockVoice(guildId);
    this.logger.info({ guildId, channelId: session.voiceChannelId }, "tambola voice ready");
    return true;
  }

  private async callNext(session: TambolaSession, manual = false): Promise<number | null> {
    const game = session.game;
    if (game.status !== "active" && !(manual && game.status === "paused")) return null;
    if (session.calling) return null;
    session.calling = true;
    this.clearTimers(session, "call");
    try {
      const number = game.nextCall();
      if (number === null) {
        this.scheduleFinalize(session);
        return null;
      }
      const phrase = buildCallPhrase(number, session.lastGenericIndex);
      session.lastGenericIndex = phrase.genericIndex;
      if (manual) session.lastManualCallAt = Date.now();
      await this.updateCard(session);
      if (session.voice) void session.voice.speak(phrase.text);
      if (game.status === "active" && game.remainingCalls > 0) {
        this.scheduleCall(session);
      } else if (game.remainingCalls === 0) {
        this.scheduleFinalize(session);
      }
      return number;
    } finally {
      session.calling = false;
    }
  }

  private scheduleCall(session: TambolaSession): void {
    this.clearTimers(session, "call");
    if (session.game.status !== "active") return;
    session.callTimer = setTimeout(
      () => void this.callNext(session),
      session.game.intervalSeconds * 1000,
    );
  }

  private scheduleFinalize(session: TambolaSession): void {
    if (session.finalizeTimer) return;
    session.finalizeTimer = setTimeout(() => {
      if (session.game.status === "active" || session.game.status === "paused") {
        void this.finishGame(session, "All 90 numbers were called.");
      }
    }, FINAL_CLAIM_WINDOW_MS);
  }

  private reward(
    guildId: string,
    userId: string,
    amount: number,
    kind: string,
    key: string,
  ): void {
    if (!this.economy) return;
    void this.economy.award(guildId, userId, amount, kind, key).catch((error) => {
      this.logger.warn({ err: error, guildId, userId, kind }, "tambola reward failed");
    });
  }

  private async finishGame(session: TambolaSession, note?: string): Promise<void> {
    if (session.game.status === "lobby") {
      await this.cancel(session, "The lobby was closed.");
      return;
    }
    this.clearTimers(session);
    const winner = session.game.winnerId;
    if (session.game.status !== "finished" && session.game.status !== "cancelled") {
      session.game.finish();
    }
    if (session.game.called.length >= 10) {
      for (const userId of session.game.players.keys()) {
        this.reward(
          session.game.guildId,
          userId,
          REWARD_PARTICIPATION,
          "tambola_participation",
          `tambola:${session.game.id}:participation:${userId}`,
        );
      }
    }
    await this.updateCard(session, note);
    const voice = session.voice;
    session.voice = null;
    if (voice) {
      if (winner) void voice.speak("Full house! Congratulations!");
      session.voiceTimer = setTimeout(() => {
        voice.leave();
        if (!this.byGuild.has(session.game.guildId)) {
          this.music.unlockVoice(session.game.guildId);
        }
        session.voiceTimer = null;
      }, 6_000);
    } else {
      this.music.unlockVoice(session.game.guildId);
    }
    this.detach(session);
    this.sessionEndHook?.(session.game.guildId);
  }

  private async cancel(session: TambolaSession, note: string): Promise<void> {
    this.clearTimers(session);
    session.game.cancel();
    await this.updateCard(session, note);
    session.voice?.leave();
    session.voice = null;
    this.music.unlockVoice(session.game.guildId);
    this.detach(session);
    this.sessionEndHook?.(session.game.guildId);
  }

  private detach(session: TambolaSession): void {
    if (this.byGuild.get(session.game.guildId) === session) {
      this.byGuild.delete(session.game.guildId);
    }
    if (this.byId.get(session.game.id) === session) this.byId.delete(session.game.id);
  }

  private clearTimers(session: TambolaSession, kind?: "lobby" | "call"): void {
    if (session.voiceTimer) {
      clearTimeout(session.voiceTimer);
      session.voiceTimer = null;
    }
    if (kind !== "call" && session.lobbyTimer) {
      clearTimeout(session.lobbyTimer);
      session.lobbyTimer = null;
    }
    if (kind !== "lobby" && session.callTimer) {
      clearTimeout(session.callTimer);
      session.callTimer = null;
    }
    if (!kind && session.finalizeTimer) {
      clearTimeout(session.finalizeTimer);
      session.finalizeTimer = null;
    }
    if (!kind && session.gameTimer) {
      clearTimeout(session.gameTimer);
      session.gameTimer = null;
    }
  }

  private cardPayload(session: TambolaSession): ReplyPayload {
    const game = session.game;
    if (game.status === "lobby") {
      return buildTambolaLobbyPayload(game, session.voiceChannelId, session.voiceNote ?? undefined);
    }
    if (game.status === "finished" || game.status === "cancelled") {
      return buildTambolaFinalPayload(game);
    }
    const voiceConnected = Boolean(session.voice?.connected && !session.voice.disabled);
    return buildTambolaGamePayload(
      game,
      voiceConnected ? session.voiceChannelId : null,
      session.voice?.disabled
        ? "Text only · TTS unavailable"
        : session.voiceNote ?? undefined,
    );
  }

  private async updateCard(session: TambolaSession, note?: string): Promise<void> {
    if (!session.cardMessage) return;
    const payload = note && (session.game.status === "finished" || session.game.status === "cancelled")
      ? buildTambolaFinalPayload(session.game, note)
      : this.cardPayload(session);
    try {
      await session.cardMessage.edit(styleMessage(messageOptions(payload, false)));
    } catch (error) {
      this.logger.debug({ err: error, gameId: session.game.id }, "tambola card update failed");
    }
  }

  private async refreshPlayerTickets(session: TambolaSession): Promise<void> {
    if (Date.now() - session.lastTicketRefreshAt < 10_000) return;
    session.lastTicketRefreshAt = Date.now();
    for (const player of session.game.players.values()) {
      const user = await this.client.users.fetch(player.userId).catch(() => null);
      if (!user) continue;
      await this.sendTicketDm(user, buildTambolaTicketPayload(session.game, player));
    }
  }

  private async clearVoice(session: TambolaSession): Promise<void> {
    if (session.voiceTask) await session.voiceTask.catch(() => false);
    session.voice?.leave();
    session.voice = null;
  }

  private async sendTicketDm(user: { send(options: OutgoingMessage): Promise<unknown> }, payload: ReplyPayload): Promise<boolean> {
    try {
      await user.send(styleMessage(messageOptions(payload, false)));
      return true;
    } catch (error) {
      this.logger.debug({ err: error }, "tambola ticket DM failed");
      return false;
    }
  }

  private assertLobbyCooldown(session: TambolaSession, userId: string): void {
    const last = session.lobbyActionCooldowns.get(userId) ?? 0;
    if (Date.now() - last < 2_000) {
      throw new UserError("Wait a moment before joining or leaving again.");
    }
    session.lobbyActionCooldowns.set(userId, Date.now());
  }

  private assertSettingsCooldown(session: TambolaSession): void {
    if (Date.now() - session.lastSettingsAt < 2_000) {
      throw new UserError("Wait a moment before changing settings again.");
    }
    session.lastSettingsAt = Date.now();
  }

  private assertTicketCooldown(session: TambolaSession, userId: string): void {
    const last = session.ticketCooldowns.get(userId) ?? 0;
    if (Date.now() - last < 8_000) {
      throw new UserError("Wait a few seconds before requesting your ticket again.");
    }
    session.ticketCooldowns.set(userId, Date.now());
  }

  private assertHost(session: TambolaSession, member: GuildMember): void {
    if (member.id !== session.game.hostId) throw new UserError("Only the host can change Tambola settings.");
  }

  private assertControl(session: TambolaSession, member: GuildMember): void {
    if (member.id === session.game.hostId) return;
    if (isAdmin(member, this.config, member.guild)) return;
    throw new UserError("Only the host or an admin can do that.");
  }

  private newId(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = randomBytes(3).toString("hex").toUpperCase();
      if (!this.byId.has(id)) return id;
    }
    throw new Error("Could not allocate a Tambola game ID.");
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
    await interaction.editReply(styleMessage(messageOptions(payload, false)));
  }

  private async privateReply(interaction: ComponentInteraction, payload: ReplyPayload): Promise<void> {
    const data = messageOptions(payload, interaction.inGuild());
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(styleMessage(data)).catch(() => undefined);
    } else {
      await interaction.reply(styleMessage(data)).catch(() => undefined);
    }
  }

  private async replyError(interaction: ComponentInteraction, error: unknown): Promise<void> {
    const message = error instanceof UserError ? error.message : "That Tambola action failed.";
    this.logger.warn({ err: error, customId: interaction.customId }, "tambola interaction failed");
    if (interaction.deferred) {
      await interaction.editReply(styleMessage(messageOptions({ content: message }, false))).catch(() => undefined);
      return;
    }
    await this.privateReply(interaction, { content: message, ephemeral: true });
  }
}
