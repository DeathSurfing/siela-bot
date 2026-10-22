import { describe, expect, it, vi } from "vitest";
import { TambolaService } from "./service.js";
import { rowNumbers, ticketNumbers } from "./game.js";

function fakeUser(id: string, name: string) {
  const sent: unknown[] = [];
  return {
    id,
    send: vi.fn(async (payload: unknown) => {
      sent.push(payload);
      return {};
    }),
    sent,
  };
}

function fakeMember(id: string, name: string) {
  const user = fakeUser(id, name);
  return {
    id,
    displayName: name,
    user,
    permissions: { has: () => false },
    roles: { cache: { has: () => false } },
  };
}

function fakeInteraction(
  customId: string,
  userId: string,
  options: { guild?: unknown; values?: string[]; select?: boolean } = {},
) {
  const state = {
    updated: null as unknown,
    replied: null as unknown,
    followed: null as unknown,
    edited: null as unknown,
  };
  return {
    ...state,
    customId,
    user: { id: userId },
    guild: options.guild ?? null,
    values: options.values ?? [],
    replied: false,
    deferred: false,
    inGuild: () => Boolean(options.guild),
    isStringSelectMenu: () => Boolean(options.select),
    async update(payload: unknown) {
      state.updated = payload;
      return {};
    },
    async reply(payload: unknown) {
      state.replied = payload;
      return {};
    },
    async followUp(payload: unknown) {
      state.followed = payload;
      return {};
    },
    async deferReply() {
      this.deferred = true;
    },
    async editReply(payload: unknown) {
      state.edited = payload;
      return {};
    },
    getState: () => state,
  };
}

function createService() {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const music = { isConnected: () => false };
  const client = {
    users: { fetch: async (id: string) => fakeUser(id, id) },
    guilds: { cache: new Map() },
  };
  const config = { adminRoleIds: [], botOwnerId: null };
  const service = new TambolaService(client as never, music as never, config as never, logger as never);
  const edits: unknown[] = [];
  const message = {
    id: "msg",
    edit: vi.fn(async (payload: unknown) => {
      edits.push(payload);
      return message;
    }),
  };
  const channel = {
    id: "channel",
    isTextBased: () => true,
    send: vi.fn(async () => message),
  };
  const guild = {
    id: "guild",
    ownerId: "host",
    channels: { cache: new Map(), fetch: async () => null },
    members: { fetch: async (id: string) => fakeMember(id, id) },
  };
  return { service, channel, guild, edits };
}

describe("TambolaService", () => {
  it("hosts a lobby, joins players, starts, and calls a number", async () => {
    const { service, channel, guild } = createService();
    const host = fakeMember("host", "Host");
    const player = fakeMember("player", "Player");

    const session = await service.host({
      guild: guild as never,
      channel: channel as never,
      host: host as never,
      maxPlayers: 20,
      autoMark: false,
      voiceChannelId: null,
    });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(session.game.players.size).toBe(0);

    const join = await service.join("guild", player as never);
    expect(join.dmSent).toBe(true);
    expect(player.user.send).toHaveBeenCalledTimes(1);

    await service.join("guild", host as never);
    expect(session.game.players.size).toBe(2);

    await service.start("guild", host as never);
    expect(session.game.status).toBe("active");

    const number = await service.call("guild", host as never);
    expect(number).not.toBeNull();
    expect(session.game.called).toContain(number);

    service.stop();
  });

  it("toggles auto-marking from the lobby settings", async () => {
    const { service, channel, guild } = createService();
    const host = fakeMember("host", "Host");
    const session = await service.host({
      guild: guild as never,
      channel: channel as never,
      host: host as never,
      maxPlayers: 20,
      autoMark: false,
      voiceChannelId: null,
    });
    await service.join("guild", host as never);
    const interaction = fakeInteraction(
      `tambola:toggleautomark:${session.game.id}`,
      "host",
      { guild },
    );
    await service.handleInteraction(interaction as never);
    expect(session.game.autoMark).toBe(true);
    expect(interaction.getState().updated).not.toBeNull();
    service.stop();
  });

  it("accepts a DM mark interaction", async () => {
    const { service, channel, guild } = createService();
    const host = fakeMember("host", "Host");
    const player = fakeMember("player", "Player");
    const session = await service.host({
      guild: guild as never,
      channel: channel as never,
      host: host as never,
      maxPlayers: 20,
      autoMark: false,
      voiceChannelId: null,
    });
    await service.join("guild", player as never);
    await service.join("guild", host as never);
    await service.start("guild", host as never);
    const game = session.game;
    const playerTicket = game.player("player")!;
    const ticket = ticketNumbers(playerTicket.ticket);
    let target: number | null = null;
    while (target === null) {
      const called = game.nextCall();
      if (called === null) break;
      if (ticket.includes(called)) target = called;
    }
    expect(target).not.toBeNull();
    const interaction = fakeInteraction(`tambola:mark:${game.id}:${target!}`, "player");
    await service.handleInteraction(interaction as never);
    expect(playerTicket.marked.has(target!)).toBe(true);
    expect(interaction.getState().updated).not.toBeNull();
    service.stop();
  });

  it("accepts a line claim from a select interaction", async () => {
    const { service, channel, guild } = createService();
    const host = fakeMember("host", "Host");
    const player = fakeMember("player", "Player");
    const session = await service.host({
      guild: guild as never,
      channel: channel as never,
      host: host as never,
      maxPlayers: 20,
      autoMark: false,
      voiceChannelId: null,
    });
    await service.join("guild", player as never);
    await service.join("guild", host as never);
    await service.start("guild", host as never);
    const game = session.game;
    for (let index = 0; index < 90; index += 1) game.nextCall();
    const playerState = game.player("player")!;
    for (const number of rowNumbers(playerState.ticket, 0)) game.mark("player", number);
    const interaction = fakeInteraction(
      `tambola:claimselect:${game.id}`,
      "player",
      { values: ["top_line"], select: true },
    );
    await service.handleInteraction(interaction as never);
    expect(game.claims.get("top_line")?.userId).toBe("player");
    expect(interaction.getState().replied).not.toBeNull();
    service.stop();
  });
});
