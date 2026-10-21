import { describe, expect, it } from "vitest";
import { isPlaylistUrl } from "./music.js";

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
