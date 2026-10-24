import { describe, expect, it, vi } from "vitest";
import { MusicService, isPlaylistUrl } from "./music.js";
import type { MusicQueueState } from "@siela/shared";
import type { ReplyPayload } from "../framework/types.js";

describe("isPlaylistUrl", () => {
  it("detects YouTube and YouTube Music playlists", () => {
    expect(isPlaylistUrl("https://music.youtube.com/watch?v=abc&list=PL123")).toBe(true);
    expect(isPlaylistUrl("https://www.youtube.com/playlist?list=PL123")).toBe(true);
    expect(isPlaylistUrl("https://youtu.be/abc?list=PL123")).toBe(true);
  });

  it("does not treat normal tracks as playlists", () => {
    expect(isPlaylistUrl("https://music.youtube.com/watch?v=abc")).toBe(false);
    expect(isPlaylistUrl("lofi beats")).toBe(false);
  });
});

type RefreshHarness = {
  nowPlayingMessages: Map<string, { edit: (payload: ReplyPayload) => Promise<void> }>;
  nowPlayingUpdating: Set<string>;
  state: (guildId: string) => MusicQueueState | null;
  refreshNowPlaying(guildId: string): void;
};

describe("MusicService refreshNowPlaying", () => {
  it("edits a paused tracked message with a Resume control", async () => {
    const service = Object.create(MusicService.prototype) as unknown as RefreshHarness;
    const edit = vi.fn<(payload: ReplyPayload) => Promise<void>>().mockResolvedValue(undefined);
    const message = { edit };
    service.nowPlayingMessages = new Map([["guild-1", message]]);
    service.nowPlayingUpdating = new Set();
    const pausedState: MusicQueueState = {
      playing: false,
      paused: true,
      volume: 80,
      loop: "off",
      position: 0,
      current: { title: "Track", author: "Artist", length: 1000, uri: "https://example.test", artworkUrl: null, isStream: false },
      upcoming: [],
    };
    service.state = () => pausedState;

    service.refreshNowPlaying("guild-1");

    await vi.waitFor(() => {
      expect(edit).toHaveBeenCalledTimes(1);
    });

    expect(JSON.stringify(edit.mock.calls[0]?.[0])).toContain("Resume");
  });
});
