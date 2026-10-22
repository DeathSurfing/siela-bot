import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LyricsService,
  cleanLyricsArtist,
  cleanLyricsTitle,
  lyricsBody,
  type LyricsResult,
} from "./lyrics.js";

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("lyrics metadata", () => {
  it("cleans YouTube decorations from titles", () => {
    expect(cleanLyricsTitle("Taylor Swift - Anti-Hero (Official Music Video)")).toBe(
      "Taylor Swift - Anti-Hero",
    );
    expect(cleanLyricsTitle("Song [Lyric Video]")).toBe("Song");
    expect(cleanLyricsTitle("Song (feat. Someone)")).toBe("Song");
  });

  it("cleans channel suffixes from artists", () => {
    expect(cleanLyricsArtist("Taylor Swift - Topic")).toBe("Taylor Swift");
    expect(cleanLyricsArtist("ArtistVEVO")).toBe("Artist");
  });

  it("turns synced lyrics into readable text", () => {
    const result: LyricsResult = {
      trackName: "Song",
      artistName: "Artist",
      albumName: null,
      duration: 200,
      instrumental: false,
      plainLyrics: null,
      syncedLyrics: "[00:12.34] Hello\n[00:15.00] World\n\n[00:20.00] Again",
    };
    expect(lyricsBody(result)).toBe("Hello\nWorld\n\nAgain");
  });
});

describe("LyricsService", () => {
  it("searches LRCLIB and caches the result", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            trackName: "Anti-Hero",
            artistName: "Taylor Swift",
            duration: 204,
            instrumental: false,
            plainLyrics: "It's me, hi",
            syncedLyrics: "[00:01.00] It's me, hi",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new LyricsService(logger as never);
    const track = {
      title: "Taylor Swift - Anti-Hero (Official Music Video)",
      author: "Taylor Swift",
      length: 204_000,
    };

    const result = await service.forTrack(track);
    expect(result.trackName).toBe("Anti-Hero");
    expect(lyricsBody(result)).toBe("It's me, hi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("track_name=Anti-Hero");
    expect(url).toContain("artist_name=Taylor+Swift");

    await service.forTrack(track);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a friendly error when no lyrics are found", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new LyricsService(logger as never);

    await expect(
      service.forTrack({ title: "Missing Song", author: "Nobody", length: 180_000 }),
    ).rejects.toThrow("No lyrics found");
  });
});
