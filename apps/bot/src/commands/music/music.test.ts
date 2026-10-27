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

  it("falls back to a fleet node when local voice is locked", async () => {
    const service = {
      state: vi.fn().mockReturnValue(null),
      play: vi.fn().mockRejectedValue(new Error("locked")),
      setNowPlayingMessage: vi.fn(),
      setFleetNode: vi.fn(),
      getFleetNode: vi.fn().mockReturnValue(null),
      isVoiceLocked: vi.fn().mockReturnValue(true),
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