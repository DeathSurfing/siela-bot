import { describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";
import type { BotConfig } from "@siela/config";
import type { Logger } from "../lib/logger.js";

const voiceMocks = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("./tambola/voice.js", () => ({
  TambolaVoice: class {
    connected = true;
    async join(): Promise<boolean> {
      voiceMocks.order.push("join");
      return true;
    }
    leave(): void {
      voiceMocks.order.push("leave");
    }
    async speak(): Promise<void> {
      voiceMocks.order.push("speak");
    }
  },
}));

import { TtsService } from "./tts.js";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
} as unknown as Logger;

const config = {
  NODE_ID: "commander",
  ROUTER_URL: "http://router:3100",
  MCP_TOKEN: "token-1234567890123456",
} as unknown as BotConfig;

describe("TtsService local enable", () => {
  it("stops music before joining so an existing connection does not block TTS", async () => {
    voiceMocks.order.length = 0;
    const music = {
      async disconnect(): Promise<void> {
        voiceMocks.order.push("disconnect");
      },
      lockVoice(): void {
        voiceMocks.order.push("lock");
      },
      unlockVoice: () => undefined,
      isConnected: () => true,
    };
    const tts = new TtsService(music as never, config, logger);
    const channel = { id: "ch1", type: ChannelType.GuildVoice };
    const guild = {
      id: "g1",
      channels: { cache: new Map([["ch1", channel]]), fetch: async () => null },
    };
    const member = { guild, voice: { channelId: "ch1" } };

    await tts.enable("g1", member as never, null);

    expect(voiceMocks.order).toEqual(["disconnect", "join", "lock"]);
    expect(tts.isLocal("g1")).toBe(true);
    tts.stop();
  });
});
