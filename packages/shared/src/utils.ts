const SNOWFLAKE_RE = /^\d{17,20}$/;

export function isSnowflake(value: string): boolean {
  return SNOWFLAKE_RE.test(value);
}

export function assertSnowflake(value: string, name = "id"): string {
  if (!isSnowflake(value)) {
    throw new Error(`Invalid ${name}: expected a Discord snowflake`);
  }
  return value;
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>~])/g, "\\$1");
}

export function truncate(value: string, max: number, suffix = "…"): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

export function chunkString(value: string, max: number): string[] {
  if (max <= 0) return [value];
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += max) {
    chunks.push(value.slice(i, i + max));
  }
  return chunks.length ? chunks : [""];
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function parseDuration(input: string): number | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const clock = value.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const first = Number(clock[1]);
    const second = Number(clock[2]);
    const third = clock[3] === undefined ? null : Number(clock[3]);
    if (second > 59 || (third !== null && third > 59)) return null;
    return third === null
      ? (first * 60 + second) * 1000
      : (first * 3600 + second * 60 + third) * 1000;
  }
  const units = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    const h = Number(units[1] ?? 0);
    const m = Number(units[2] ?? 0);
    const s = Number(units[3] ?? 0);
    return (h * 3600 + m * 60 + s) * 1000;
  }
  return null;
}

export function sanitizeChannelName(value: string, fallback = "Private VC"): string {
  const cleaned = value
    .replace(/<@[!&]?\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

export interface TemplateValues {
  user?: string;
  mention?: string;
  username?: string;
  displayName?: string;
  server?: string;
  memberCount?: number | string;
  createdAt?: string;
  joinedAt?: string;
}

export function renderTemplate(template: string, values: TemplateValues): string {
  const map: Record<string, string> = {
    user: values.user ?? "",
    mention: values.mention ?? "",
    username: values.username ?? "",
    displayName: values.displayName ?? "",
    server: values.server ?? "",
    memberCount: values.memberCount === undefined ? "" : String(values.memberCount),
    createdAt: values.createdAt ?? "",
    joinedAt: values.joinedAt ?? "",
  };
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
    return key in map ? map[key]! : match;
  });
}

export const TEMPLATE_KEYS = [
  "user",
  "mention",
  "username",
  "displayName",
  "server",
  "memberCount",
  "createdAt",
  "joinedAt",
] as const;

const PLACEHOLDER_BASE = 0xe000;

export interface ProtectedText {
  text: string;
  restore(value: string): string;
}

/**
 * Protect mentions, custom emoji, and URLs from machine translation.
 * Uses private-use characters so the surrounding words remain translatable.
 */
export function protectMentions(input: string): ProtectedText {
  const protectedValues: string[] = [];
  const pattern =
    /<@[!&]?\d+>|<#\d+>|<a?:[a-zA-Z0-9_]+:\d+>|https?:\/\/[^\s<>]+/g;
  const text = input.replace(pattern, (match) => {
    const index = protectedValues.length;
    protectedValues.push(match);
    return `${String.fromCodePoint(PLACEHOLDER_BASE + index)}`;
  });
  return {
    text,
    restore(value: string): string {
      return value.replace(/[\uE000-\uF8FF]/g, (char) => {
        const index = char.codePointAt(0)! - PLACEHOLDER_BASE;
        return protectedValues[index] ?? char;
      });
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function relativeTimestamp(date: Date | number): string {
  const timestamp = typeof date === "number" ? date : date.getTime();
  return `<t:${Math.floor(timestamp / 1000)}:R>`;
}
