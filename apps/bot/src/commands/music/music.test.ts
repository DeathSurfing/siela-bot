import { describe, expect, it, vi } from "vitest";
import type { Guild, GuildMember, User } from "discord.js";
import type { CommandContext, ReplyPayload, Services } from "../../framework/types.js";
import type { MusicService } from "../../features/music.js";
import type { MusicQueueState } from "@siela/shared";
import { musicCommands } from "./music.js";

function textFromPayload(payload: ReplyPayload | null | undefined): string {
  const component = payload?.components?.[0] as { toJSON(): unknown } | undefined;
  const json = component?.toJSON();
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === 10 && typeof record.content === "string") out.push(record.content);
      for (const key of Object.keys(record)) {
        if (key === "content") continue;
        visit(record[key]);
      }
    }
  };
  visit(json);
  return out.join("\n");
}

describe("play command", () => {
  it("says Playing now when the player was empty", async () => {
    const emptyState: MusicQueueState | null = null;
    const afterState: MusicQueueState = {
      playing: true,
      paused: false,
      volume: 80,
      loop: "off",
      position: 0,
      current: { title: "Track", author: "Artist", length: 1000, uri: "https://example.test", artworkUrl: null, isStream: false },
      upcoming: [],
    };
    const service = {
      state: vi.fn().mockReturnValueOnce(emptyState).mockReturnValue(afterState),
      play: vi.fn().mockResolvedValue({ added: 1 }),
      isVoiceLocked: vi.fn().mockReturnValue(false),
      setNowPlayingMessage: vi.fn(),
      setFleetNode: vi.fn(),
      getFleetNode: vi.fn().mockReturnValue(null),
    } as unknown as MusicService;

    const edited: ReplyPayload[] = [];
    const ctx = {
      guild: { id: "guild-1" } as Guild,
      member: {} as GuildMember,
      author: { id: "user-1" } as User,
      args: ["lofi"],
      rawArgs: "lofi",
      commandName: "play",
      source: "slash",
      services: { music: service, config: {} } as unknown as Services,
      client: {} as CommandContext["client"],
      channel: {} as CommandContext["channel"],
      interaction: undefined,
      message: undefined,
      reply: vi.fn().mockResolvedValue(null),
      defer: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn(async (payload: ReplyPayload) => {
        edited.push(payload);
        return null;
      }),
      followUp: vi.fn().mockResolvedValue(null),
    } as unknown as CommandContext;

    const playCommand = musicCommands.find((command) => command.name === "play");
    expect(playCommand).toBeDefined();
    await playCommand!.execute(ctx);

    expect(edited).toHaveLength(1);
    const text = textFromPayload(edited[0]);
    expect(text).toContain("Playing now");
    expect(text).not.toContain("Added to queue");
  });

  it("says Queued at #1 when a track was already playing", async () => {
    const beforeState: MusicQueueState = {
      playing: true,
      paused: false,
      volume: 80,
      loop: "off",
      position: 0,
      current: { title: "Existing", author: "Artist", length: 1000, uri: "https://example.test", artworkUrl: null, isStream: false },
      upcoming: [],
    };
    const afterState: MusicQueueState = {
      playing: true,
      paused: false,
      volume: 80,
      loop: "off",
      position: 0,
      current: { title: "Existing", author: "Artist", length: 1000, uri: "https://example.test", artworkUrl: null, isStream: false },
      upcoming: [{ title: "New", author: "Artist2", length: 1000, uri: "https://example.test/2", artworkUrl: null, isStream: false }],
    };
    const service = {
      state: vi.fn().mockReturnValueOnce(beforeState).mockReturnValue(afterState),
      play: vi.fn().mockResolvedValue({ added: 1 }),
      isVoiceLocked: vi.fn().mockReturnValue(false),
      setNowPlayingMessage: vi.fn(),
      setFleetNode: vi.fn(),
      getFleetNode: vi.fn().mockReturnValue(null),
    } as unknown as MusicService;

    const edited: ReplyPayload[] = [];
    const ctx = {
      guild: { id: "guild-1" } as Guild,
      member: {} as GuildMember,
      author: { id: "user-1" } as User,
      args: ["lofi"],
      rawArgs: "lofi",
      commandName: "play",
      source: "slash",
      services: { music: service, config: {} } as unknown as Services,
      client: {} as CommandContext["client"],
      channel: {} as CommandContext["channel"],
      interaction: undefined,
      message: undefined,
      reply: vi.fn().mockResolvedValue(null),
      defer: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn(async (payload: ReplyPayload) => {
        edited.push(payload);
        return null;
      }),
      followUp: vi.fn().mockResolvedValue(null),
    } as unknown as CommandContext;

    const playCommand = musicCommands.find((command) => command.name === "play");
    await playCommand!.execute(ctx);

    expect(edited).toHaveLength(1);
    const text = textFromPayload(edited[0]);
    expect(text).toContain("Queued at #1");
  });

  it("shows the actionable fallback for non-UserError rejections", async () => {
    const service = {
      state: vi.fn().mockReturnValue(null),
      play: vi.fn().mockRejectedValue(new Error("secret message")),
      setNowPlayingMessage: vi.fn(),
      setFleetNode: vi.fn(),
      getFleetNode: vi.fn().mockReturnValue(null),
      isVoiceLocked: vi.fn().mockReturnValue(false),
    } as unknown as MusicService;

    const edited: ReplyPayload[] = [];
    const ctx = {
      guild: { id: "guild-1" } as Guild,
      member: {} as GuildMember,
      author: { id: "user-1" } as User,
      args: ["lofi"],
      rawArgs: "lofi",
      commandName: "play",
      source: "slash",
      services: { music: service, config: {} } as unknown as Services,
      client: {} as CommandContext["client"],
      channel: {} as CommandContext["channel"],
      interaction: undefined,
      message: undefined,
      reply: vi.fn().mockResolvedValue(null),
      defer: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn(async (payload: ReplyPayload) => {
        edited.push(payload);
        return null;
      }),
      followUp: vi.fn().mockResolvedValue(null),
    } as unknown as CommandContext;

    const playCommand = musicCommands.find((command) => command.name === "play");
    await playCommand!.execute(ctx);

    expect(edited).toHaveLength(1);
    const text = textFromPayload(edited[0]);
    expect(text).toContain("Could not play that request");
    expect(text).not.toContain("secret message");
  });

  it("routes pause to the fleet node in the author's channel", async () => {
    const service = {
      state: vi.fn().mockReturnValue(null),
      play: vi.fn(),
      setNowPlayingMessage: vi.fn(),
      setFleetNode: vi.fn(),
      getFleetNode: vi.fn().mockImplementation((_g: string, ch: string) => (ch === "voice-9" ? "voice-1" : null)),
      isVoiceLocked: vi.fn().mockReturnValue(false),
      isConnected: vi.fn().mockReturnValue(false),
      channelId: vi.fn().mockReturnValue(null),
      refreshNowPlaying: vi.fn(),
      logger: { info: () => undefined, warn: () => undefined },
    } as unknown as MusicService;
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).includes("/v1/music/state")) {
          return new Response(
            JSON.stringify({
              playing: true, paused: false, volume: 80, loop: "off", position: 1000,
              current: { title: "T", author: "A", length: 60000, uri: "u", artworkUrl: null, isStream: false },
              upcoming: [], channelId: "voice-9",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        bodies.push(`${init?.method} ${String(url)} :: ${String(init?.body)}`);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const edited: ReplyPayload[] = [];
    const ctx = {
      guild: { id: "guild-1" } as Guild,
      member: { voice: { channelId: "voice-9" } } as unknown as GuildMember,
      author: { id: "user-1" } as User,
      args: [],
      rawArgs: "",
      commandName: "pause",
      source: "slash",
      services: { music: service, config: { ROUTER_URL: "http://router:3100", MCP_TOKEN: "token-1234567890123456" } } as unknown as Services,
      client: {} as CommandContext["client"],
      channel: {} as CommandContext["channel"],
      interaction: undefined,
      message: undefined,
      reply: vi.fn().mockResolvedValue(null),
      defer: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn(),
      followUp: vi.fn().mockResolvedValue(null),
    } as unknown as CommandContext;

    const pauseCommand = musicCommands.find((command) => command.name === "pause");
    await pauseCommand!.execute(ctx);
    vi.unstubAllGlobals();

    expect(service.pause).toBeUndefined();
    expect(bodies.some((b) => b.includes("/v1/music/pause") && b.includes('"nodeId":"voice-1"'))).toBe(true);
    const replied = (ctx.reply as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { content?: string };
    expect(JSON.stringify(replied)).toContain("Paused.");
  });

  it("routes skip with count to the fleet node", async () => {
    const service = {
      state: vi.fn().mockReturnValue(null),
      play: vi.fn(),
      skip: vi.fn(),
      setNowPlayingMessage: vi.fn(),
      setFleetNode: vi.fn(),
      getFleetNode: vi.fn().mockReturnValue("voice-2"),
      isVoiceLocked: vi.fn().mockReturnValue(true),
      isConnected: vi.fn().mockReturnValue(true),
      channelId: vi.fn().mockReturnValue("other-ch"),
      refreshNowPlaying: vi.fn(),
      logger: { info: () => undefined, warn: () => undefined },
    } as unknown as MusicService;
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).includes("/v1/music/state")) {
          return new Response(
            JSON.stringify({
              playing: true, paused: false, volume: 80, loop: "off", position: 0,
              current: { title: "T", author: "A", length: 60000, uri: "u", artworkUrl: null, isStream: false },
              upcoming: [], channelId: "voice-9",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        bodies.push(`${init?.method} ${String(url)} :: ${String(init?.body)}`);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const ctx = {
      guild: { id: "guild-1" } as Guild,
      member: { voice: { channelId: "voice-9" } } as unknown as GuildMember,
      author: { id: "user-1" } as User,
      args: ["2"],
      rawArgs: "2",
      commandName: "skip",
      source: "slash",
      services: { music: service, config: { ROUTER_URL: "http://router:3100", MCP_TOKEN: "token-1234567890123456" }, settings: { getMusic: vi.fn().mockResolvedValue({ djRoleIds: [] }) } } as unknown as Services,
      client: {} as CommandContext["client"],
      channel: {} as CommandContext["channel"],
      interaction: undefined,
      message: undefined,
      reply: vi.fn().mockResolvedValue("ok"),
      defer: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn(),
      followUp: vi.fn().mockResolvedValue(null),
    } as unknown as CommandContext;

    const skipCommand = musicCommands.find((command) => command.name === "skip");
    await skipCommand!.execute(ctx);
    vi.unstubAllGlobals();

    expect(service.skip).not.toHaveBeenCalled();
    expect(bodies.some((b) => b.includes("/v1/music/skip") && b.includes('"count":2'))).toBe(true);
  });

  it("queues onto the node already serving the voice channel", async () => {
    const service = {
      state: vi.fn().mockReturnValue(null),
      play: vi.fn(),
      setNowPlayingMessage: vi.fn(),
      setFleetNode: vi.fn(),
      getFleetNode: vi.fn().mockReturnValue("voice-2"),
      isVoiceLocked: vi.fn().mockReturnValue(false),
      isConnected: vi.fn().mockReturnValue(false),
      channelId: vi.fn().mockReturnValue(null),
      logger: { info: () => undefined, warn: () => undefined },
    } as unknown as MusicService;
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).includes("/v1/music/state")) {
          return new Response(
            JSON.stringify({
              playing: true,
              paused: false,
              volume: 80,
              loop: "off",
              position: 0,
              current: { title: "Sticky", author: "A", length: 1, uri: "u", artworkUrl: null, isStream: false },
              upcoming: [],
              channelId: "voice-9",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        bodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const edited: ReplyPayload[] = [];
    const ctx = {
      guild: { id: "guild-1" } as Guild,
      member: { voice: { channelId: "voice-9" } } as unknown as GuildMember,
      author: { id: "user-1" } as User,
      args: ["lofi"],
      rawArgs: "lofi",
      commandName: "play",
      source: "slash",
      services: { music: service, config: { ROUTER_URL: "http://router:3100", MCP_TOKEN: "token-1234567890123456" } } as unknown as Services,
      client: {} as CommandContext["client"],
      channel: {} as CommandContext["channel"],
      interaction: undefined,
      message: undefined,
      reply: vi.fn().mockResolvedValue(null),
      defer: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn(async (payload: ReplyPayload) => {
        edited.push(payload);
        return null;
      }),
      followUp: vi.fn().mockResolvedValue(null),
    } as unknown as CommandContext;

    const playCommand = musicCommands.find((command) => command.name === "play");
    await playCommand!.execute(ctx);
    vi.unstubAllGlobals();

    expect(service.play).not.toHaveBeenCalled();
    expect(bodies.some((b) => b.includes('"nodeId":"voice-2"'))).toBe(true);
    expect(textFromPayload(edited[0])).toContain("Playing on voice-2");
  });

  it("falls back to a fleet node when local voice is locked", async () => {
    const service = {
      state: vi.fn().mockReturnValue(null),
      play: vi.fn().mockRejectedValue(new Error("locked")),
      setNowPlayingMessage: vi.fn(),
      setFleetNode: vi.fn(),
      getFleetNode: vi.fn().mockReturnValue(null),
      isVoiceLocked: vi.fn().mockReturnValue(true),
      isConnected: vi.fn().mockReturnValue(false),
      channelId: vi.fn().mockReturnValue(null),
      logger: { info: () => undefined, warn: () => undefined },
    } as unknown as MusicService;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/v1/music/state")) {
        return new Response(
          JSON.stringify({
            playing: true,
            paused: false,
            volume: 80,
            loop: "off",
            position: 0,
            current: { title: "Fleet Song", author: "A", length: 1, uri: "u", artworkUrl: null, isStream: false },
            upcoming: [],
            channelId: "voice-9",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ nodeId: "voice-1", result: { added: 1, first: { title: "Fleet Song" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const edited: ReplyPayload[] = [];
    const ctx = {
      guild: { id: "guild-1" } as Guild,
      member: { voice: { channelId: "voice-9" } } as unknown as GuildMember,
      author: { id: "user-1" } as User,
      args: ["lofi"],
      rawArgs: "lofi",
      commandName: "play",
      source: "slash",
      services: { music: service, config: { ROUTER_URL: "http://router:3100", MCP_TOKEN: "token-1234567890123456" } } as unknown as Services,
      client: {} as CommandContext["client"],
      channel: {} as CommandContext["channel"],
      interaction: undefined,
      message: undefined,
      reply: vi.fn().mockResolvedValue(null),
      defer: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn(async (payload: ReplyPayload) => {
        edited.push(payload);
        return null;
      }),
      followUp: vi.fn().mockResolvedValue(null),
    } as unknown as CommandContext;

    const playCommand = musicCommands.find((command) => command.name === "play");
    await playCommand!.execute(ctx);
    vi.unstubAllGlobals();

    expect(edited).toHaveLength(1);
    expect(textFromPayload(edited[0])).toContain("Playing on voice-1");
  });
});