import { ServiceUnavailableError, UserError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

const LRCLIB_API = "https://lrclib.net/api";
const USER_AGENT = "SielaBot/1.0 (Discord music bot)";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;

interface LrclibTrack {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface LyricsTrackInput {
  title: string;
  author: string;
  length: number;
}

export interface LyricsResult {
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

class LyricsRateLimitError extends ServiceUnavailableError {
  constructor() {
    super("The lyrics service is busy. Try again in a moment.");
    this.name = "LyricsRateLimitError";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanLyricsTitle(value: string): string {
  let title = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  title = title.replace(/\((?:official\s+)?(?:music\s+)?video\)/gi, " ");
  title = title.replace(/\[(?:official\s+)?(?:music\s+)?video\]/gi, " ");
  title = title.replace(/\((?:official\s+)?audio\)/gi, " ");
  title = title.replace(/\[(?:official\s+)?audio\]/gi, " ");
  title = title.replace(/\((?:lyrics?|lyric\s+video|color\s+coded\s+lyrics)\)/gi, " ");
  title = title.replace(/\[(?:lyrics?|lyric\s+video|color\s+coded\s+lyrics)\]/gi, " ");
  title = title.replace(/\((?:visuali[sz]er|hd|hq|4k|explicit|clean)\)/gi, " ");
  title = title.replace(/\[(?:visuali[sz]er|hd|hq|4k|explicit|clean)\]/gi, " ");
  title = title.replace(/\((?:live|acoustic|remaster(?:ed)?(?:\s+\d{4})?)\)/gi, " ");
  title = title.replace(/\[(?:live|acoustic|remaster(?:ed)?(?:\s+\d{4})?)\]/gi, " ");
  title = title.replace(/\((?:from|music\s+from)\s+[^)]+\)/gi, " ");
  title = title.replace(/\[(?:from|music\s+from)\s+[^\]]+\]/gi, " ");
  title = title.replace(/\s*[([{]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]}]+[)\]}]\s*/gi, " ");
  title = title.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/gi, " ");
  title = title.replace(/\s*[-–—]\s*(?:topic|official(?:\s+.*)?)$/gi, " ");
  title = title.replace(/\s{2,}/g, " ");
  title = title.replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, "");
  return title || value.trim();
}

export function cleanLyricsArtist(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[-–—]\s*topic$/gi, "")
    .replace(/\s*vevo$/gi, "")
    .trim();
}

export function lyricsBody(result: LyricsResult): string | null {
  const plain = result.plainLyrics?.replace(/\r\n?/g, "\n").trim();
  if (plain) return plain.replace(/\n{3,}/g, "\n\n").trim();
  if (!result.syncedLyrics) return null;
  const lines = result.syncedLyrics
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^(?:\[[^\]]*\]\s*)+/, "").trimEnd());
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text || null;
}

function hasLyrics(track: LrclibTrack): boolean {
  return Boolean(track.instrumental || track.plainLyrics?.trim() || track.syncedLyrics?.trim());
}

function toResult(track: LrclibTrack): LyricsResult {
  return {
    trackName: track.trackName?.trim() || "Unknown track",
    artistName: track.artistName?.trim() || "Unknown artist",
    albumName: track.albumName?.trim() || null,
    duration: typeof track.duration === "number" ? track.duration : null,
    instrumental: Boolean(track.instrumental),
    plainLyrics: track.plainLyrics?.trim() || null,
    syncedLyrics: track.syncedLyrics?.trim() || null,
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export class LyricsService {
  private readonly cache = new Map<string, { expiresAt: number; value: LyricsResult | null }>();

  constructor(private readonly logger: Logger) {}

  async forTrack(track: LyricsTrackInput): Promise<LyricsResult> {
    const artist = cleanLyricsArtist(track.author);
    let title = cleanLyricsTitle(track.title);
    if (artist && normalize(artist) !== "unknown artist") {
      const withoutPrefix = title.replace(
        new RegExp(`^${escapeRegExp(artist)}\\s*[-–—]\\s*`, "i"),
        "",
      );
      title = withoutPrefix.trim() || title;
    }
    const key = `${normalize(title)}|${normalize(artist)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.value) return cached.value;
      throw this.notFound(title, artist);
    }

    const result = await this.lookup(title, artist, track.title, track.length);
    this.cache.set(key, {
      expiresAt: Date.now() + (result ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
      value: result,
    });
    this.trimCache();
    if (!result) throw this.notFound(title, artist);
    return result;
  }

  private trimCache(): void {
    if (this.cache.size <= 500) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    while (this.cache.size > 500) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }

  private notFound(title: string, artist: string): UserError {
    return new UserError(`No lyrics found for **${title}**${artist ? ` — ${artist}` : ""}.`);
  }

  private async lookup(
    title: string,
    artist: string,
    rawTitle: string,
    lengthMs: number,
  ): Promise<LyricsResult | null> {
    const primaryArtist = artist.replace(/\s*(?:,|&|feat\.?|ft\.?|featuring)\s*.*$/i, "").trim();
    const attempts: Array<{ track_name?: string; artist_name?: string; q?: string }> = [
      { track_name: title, artist_name: artist || undefined },
      { track_name: title, artist_name: primaryArtist || undefined },
      { track_name: rawTitle, artist_name: artist || undefined },
      { track_name: title },
      { q: [title, primaryArtist || artist].filter(Boolean).join(" ") },
      { q: title },
    ];

    const seen = new Set<string>();
    let hadResponse = false;
    let serviceError: ServiceUnavailableError | null = null;
    for (const attempt of attempts) {
      const key = JSON.stringify(attempt);
      if (seen.has(key)) continue;
      seen.add(key);
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(attempt)) {
        if (value) params.set(name, value);
      }
      const url = `${LRCLIB_API}/search?${params.toString()}`;
      try {
        const data = await this.request(url);
        hadResponse = true;
        if (!Array.isArray(data)) continue;
        const result = this.pick(data as LrclibTrack[], title, artist, lengthMs);
        if (result) return result;
      } catch (error) {
        if (error instanceof LyricsRateLimitError) throw error;
        if (error instanceof ServiceUnavailableError) {
          serviceError = error;
          continue;
        }
        throw error;
      }
    }

    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    try {
      const exact = await this.request(`${LRCLIB_API}/get?${params.toString()}`);
      hadResponse = true;
      if (exact && typeof exact === "object" && !Array.isArray(exact)) {
        const track = exact as LrclibTrack;
        if (hasLyrics(track)) return toResult(track);
      }
    } catch (error) {
      if (error instanceof LyricsRateLimitError) throw error;
      if (!(error instanceof ServiceUnavailableError)) throw error;
      serviceError = error;
    }
    if (!hadResponse && serviceError) throw serviceError;
    return null;
  }

  private pick(
    tracks: LrclibTrack[],
    title: string,
    artist: string,
    lengthMs: number,
  ): LyricsResult | null {
    const candidates = tracks.filter(hasLyrics);
    if (!candidates.length) return null;
    const wantedTitle = normalize(title);
    const wantedArtist = normalize(artist);
    const score = (track: LrclibTrack): number => {
      let value = 0;
      if (track.plainLyrics?.trim()) value += 2;
      if (track.syncedLyrics?.trim()) value += 1;
      if (normalize(track.trackName ?? "") === wantedTitle) value += 10;
      if (normalize(track.artistName ?? "") === wantedArtist) value += 5;
      if (typeof track.duration === "number" && track.duration > 0 && lengthMs > 0) {
        value -= Math.min(20, Math.abs(track.duration * 1000 - lengthMs) / 1000);
      }
      return value;
    };
    const best = [...candidates].sort((left, right) => score(right) - score(left))[0];
    return best ? toResult(best) : null;
  }

  private async request(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      this.logger.warn({ err: error, url }, "lyrics request failed");
      throw new ServiceUnavailableError("Could not reach the lyrics service. Try again in a moment.");
    }
    if (response.status === 404) return null;
    if (response.status === 429) {
      throw new LyricsRateLimitError();
    }
    if (!response.ok) {
      this.logger.warn({ status: response.status, url }, "lyrics service returned an error");
      throw new ServiceUnavailableError("The lyrics service is unavailable right now.");
    }
    try {
      return await response.json();
    } catch (error) {
      this.logger.warn({ err: error, url }, "lyrics response was not valid JSON");
      throw new ServiceUnavailableError("The lyrics service returned an invalid response.");
    }
  }
}
