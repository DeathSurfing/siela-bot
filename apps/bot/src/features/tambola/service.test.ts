import { describe, expect, it, vi } from "vitest";
import { ChannelType, MessageFlags } from "discord.js";
import { TambolaService } from "./service.js";
import { rowNumbers, ticketNumbers } from "./game.js";

const voiceSpies = vi.hoisted(() => ({
  join: vi.fn(async () => true),
  leave: vi.fn(),
  speak: vi.fn(async () => undefined),
}));

vi.mock("./voice.js", () => ({
  TambolaVoice: class {
    connected = true;
    join = voiceSpies.join;
    leave = voiceSpies.leave;
    speak = voiceSpies.speak;
  },
}));

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
    async deferUpdate() {
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
  const music = {
    isConnected: () => false,
    lockVoice: vi.fn(),
    unlockVoice: vi.fn(),
    getFleetNode: vi.fn().mockReturnValue(null),
    setFleetNode: vi.fn(),
  };
  const config = {
    adminRoleIds: [],
    botOwnerId: null,
    ROUTER_URL: "http://router:3100",
    MCP_TOKEN: "token-1234567890123456",
  };
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
  const channelCache = new Map<string, unknown>();
  const guild = {
    id: "guild",
    ownerId: "host",
    channels: { cache: channelCache, fetch: async (id: string) => channelCache.get(id) ?? null },
    members: { fetch: async (id: string) => fakeMember(id, id) },
  };
  const client = {
    users: { fetch: async (id: string) => fakeUser(id, id) },
    guilds: { cache: new Map([["guild", guild]]) },
  };
  const service = new TambolaService(client as never, music as never, config as never, logger as never);
  return { service, channel, guild, edits, music };
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
    expect(interaction.getState().edited).not.toBeNull();
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
    const ticket = ticketNumbers(playerTicket.tickets[0]!);
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
    for (const number of rowNumbers(playerState.tickets[0]!, 0)) game.mark("player", number);
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

  it("updates the ticket page through ticketpage interaction", async () => {
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
    const game = session.game;
    game.addTicket("player");
    game.addTicket("player");
    const interaction = fakeInteraction(`tambola:ticketpage:${game.id}:2`, "player");
    await service.handleInteraction(interaction as never);
    const updated = interaction.getState().updated as { components?: unknown[] } | null;
    expect(updated).not.toBeNull();
    expect(JSON.stringify(updated)).toContain("Page 2");
    service.stop();
  });

  it("replies ephemerally with the board payload", async () => {
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
    const game = session.game;
    const interaction = fakeInteraction(`tambola:board:${game.id}`, "host", { guild });
    await service.handleInteraction(interaction as never);
    const replied = interaction.getState().replied as { flags?: number } | null;
    expect(replied).not.toBeNull();
    expect(JSON.stringify(replied)).toContain("Called board");
    expect(JSON.stringify(replied)).toContain("```");
    expect((replied?.flags ?? 0) & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    service.stop();
  });

  it("replies ephemerally with the players payload", async () => {
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
    const game = session.game;
    const interaction = fakeInteraction(`tambola:players:${game.id}`, "host", { guild });
    await service.handleInteraction(interaction as never);
    const replied = interaction.getState().replied as { flags?: number } | null;
    expect(replied).not.toBeNull();
    expect(JSON.stringify(replied)).toContain("Players");
    expect((replied?.flags ?? 0) & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    service.stop();
  });

  it("replies for stale games on ticketpage, board, and players", async () => {
    const { service } = createService();
    for (const action of ["ticketpage:1", "board", "players"]) {
      const interaction = fakeInteraction(`tambola:${action}:NOPE`, "host");
      await service.handleInteraction(interaction as never);
      const replied = interaction.getState().replied as { content?: string } | null;
      expect(JSON.stringify(replied)).toContain("That Tambola game is no longer active.");
    }
  });

  it("stops fleet music in the selected channel before joining", async () => {
    const { service, channel, guild, music } = createService();
    const host = fakeMember("host", "Host");
    const voiceChannel = {
      id: "vc1",
      type: ChannelType.GuildVoice,
      guild: { id: "guild", members: { me: null, fetchMe: async () => null }, voiceAdapterCreator: {} },
    };
    (guild.channels.cache as Map<string, unknown>).set("vc1", voiceChannel);
    music.getFleetNode.mockReturnValue("voice-1");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    voiceSpies.join.mockClear();

    await service.host({
      guild: guild as never,
      channel: channel as never,
      host: host as never,
      maxPlayers: 20,
      autoMark: false,
      voiceChannelId: "vc1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/music/disconnect"),
      expect.objectContaining({ body: expect.stringContaining('"nodeId":"voice-1"') }),
    );
    expect(music.setFleetNode).toHaveBeenCalledWith("guild", "vc1", null);
    expect(voiceSpies.join).toHaveBeenCalled();
    service.stop();
    vi.unstubAllGlobals();
  });

  it("keeps the voice lock while the game socket reconnects", async () => {
    const { service, channel, guild } = createService();
    const host = fakeMember("host", "Host");
    const voiceChannel = {
      id: "vc1",
      type: ChannelType.GuildVoice,
      guild: { id: "guild", members: { me: null, fetchMe: async () => null }, voiceAdapterCreator: {} },
    };
    (guild.channels.cache as Map<string, unknown>).set("vc1", voiceChannel);
    const session = await service.host({
      guild: guild as never,
      channel: channel as never,
      host: host as never,
      maxPlayers: 20,
      autoMark: false,
      voiceChannelId: "vc1",
    });
    expect(service.isUsingVoice("guild")).toBe(true);
    (session.voice as unknown as { connected: boolean }).connected = false;
    expect(service.isUsingVoice("guild")).toBe(true);
    service.stop();
  });

  it("leaves voice six seconds after a game ends", async () => {
    vi.useFakeTimers();
    const { service, channel, guild } = createService();
    try {
      const host = fakeMember("host", "Host");
      const player = fakeMember("player", "Player");
      const voiceChannel = {
        id: "vc1",
        type: ChannelType.GuildVoice,
        guild: { id: "guild", members: { me: null, fetchMe: async () => null }, voiceAdapterCreator: {} },
      };
      (guild.channels.cache as Map<string, unknown>).set("vc1", voiceChannel);
      voiceSpies.leave.mockClear();
      await service.host({
        guild: guild as never,
        channel: channel as never,
        host: host as never,
        maxPlayers: 20,
        autoMark: false,
        voiceChannelId: "vc1",
      });
      await service.join("guild", player as never);
      await service.join("guild", host as never);
      await service.start("guild", host as never);
      await service.end("guild", host as never);
      expect(voiceSpies.leave).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(voiceSpies.leave).toHaveBeenCalled();
    } finally {
      service.stop();
      vi.useRealTimers();
    }
  });

  it("reports a redacted live snapshot and pauses and resumes for the host", async () => {
    const { service, channel, guild } = createService();
    const host = fakeMember("host", "Host");
    const player = fakeMember("player", "Player");
    await service.host({
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
    const number = await service.call("guild", host as never);

    const snapshot = service.snapshot("guild")!;
    expect(snapshot).toMatchObject({
      status: "active",
      hostId: "host",
      hostName: "Host",
      playerCount: 2,
      calledCount: 1,
      lastCall: number,
      autoMark: false,
      intervalSeconds: 12,
      voiceChannelId: null,
      voiceConnected: false,
    });
    expect(snapshot.players.map((entry) => entry.displayName).sort()).toEqual(["Host", "Player"]);
    expect(Object.keys(snapshot)).toEqual([
      "id", "channelId", "hostId", "hostName", "status", "maxPlayers", "playerCount", "players",
      "calledCount", "lastCall", "remainingCalls", "claims", "autoMark", "intervalSeconds",
      "voiceChannelId", "voiceConnected", "voiceNote", "winnerId", "winnerName",
    ]);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("tickets");
    expect(serialized).not.toContain("marked");
    expect(serialized).not.toContain("rows");

    await service.pause("guild", host as never);
    expect(service.snapshot("guild")!.status).toBe("paused");
    await service.resume("guild", host as never);
    expect(service.snapshot("guild")!.status).toBe("active");
    service.stop();
  });
});
