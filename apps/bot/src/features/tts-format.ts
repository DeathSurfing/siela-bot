export interface TtsNameLookups {
  users?: Map<string, string> | Record<string, string>;
  channels?: Map<string, string> | Record<string, string>;
  roles?: Map<string, string> | Record<string, string>;
}

function lookupName(
  source: Map<string, string> | Record<string, string> | undefined,
  id: string,
): string | undefined {
  if (!source) return undefined;
  if (source instanceof Map) return source.get(id);
  return source[id];
}

function cleanSpokenName(name: string): string {
  return name
    .replace(/[<@#>]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Display name safe for TTS ("@everyone" -> "everyone", "a-b_c" -> "a b c"). */
export function sanitizeSpeakerName(name: string): string {
  const withoutPrefix = name.replace(/^[@#]+/, "");
  const cleaned = cleanSpokenName(withoutPrefix);
  return cleaned.length > 32 ? cleaned.slice(0, 32).trim() : cleaned;
}

export function resolveDiscordMentions(raw: string, lookups: TtsNameLookups = {}): string {
  let text = raw;

  text = text.replace(/<@!?(\d+)>/g, (_match, id: string) => {
    const name = lookupName(lookups.users, id);
    return name ? ` ${cleanSpokenName(name)} ` : " someone ";
  });

  text = text.replace(/<#(\d+)>/g, (_match, id: string) => {
    const name = lookupName(lookups.channels, id);
    return name ? ` ${cleanSpokenName(name)} ` : " a channel ";
  });

  text = text.replace(/<@&(\d+)>/g, (_match, id: string) => {
    const name = lookupName(lookups.roles, id);
    if (!name) return " a role ";
    if (name === "@everyone") return " everyone ";
    return ` ${cleanSpokenName(name)} `;
  });

  text = text.replace(/<a?:([A-Za-z0-9_~+-]+):\d+>/g, (_match, name: string) => ` ${cleanSpokenName(name)} `);

  text = text.replace(/<\/([^:>]+):\d+>/g, (_match, name: string) => ` ${cleanSpokenName(name)} `);

  text = text.replace(/<t:\d+(?::[tTdDfFR])?>/g, " a time ");

  text = text.replace(/@everyone/g, " everyone ");
  text = text.replace(/@here/g, " everyone here ");

  return text;
}

const URL_PATTERN = /https?:\/\/[^\s<>()"']+|www\.[^\s<>()"']+/g;
const TRAILING_PUNCT = new Set([".", ",", "!", "?", ":", ";", ")", "'", '"', "…"]);

function replaceUrlsWithLink(text: string): { text: string; linkCount: number } {
  let linkCount = 0;
  const replaced = text.replace(URL_PATTERN, (match) => {
    let end = match.length;
    while (end > 0 && TRAILING_PUNCT.has(match[end - 1] ?? "")) end -= 1;
    const trail = match.slice(end);
    linkCount += 1;
    return `a link${trail}`;
  });
  return { text: replaced, linkCount };
}

function stripMarkdown(text: string): string {
  let out = text;
  out = out.replace(/```(?:\w+\n)?([\s\S]*?)```/g, " $1 ");
  out = out.replace(/`([^`]+)`/g, " $1 ");
  out = out.replace(/\*\*([^*]+)\*\*/g, " $1 ");
  out = out.replace(/__([^_]+)__/g, " $1 ");
  out = out.replace(/\*([^*]+)\*/g, " $1 ");
  out = out.replace(/~~([^~]+)~~/g, " $1 ");
  out = out.replace(/\|\|([^|]+)\|\|/g, " $1 ");
  out = out.replace(/^>\s?/gm, "");
  out = out.replace(/^(#{1,3})\s+/gm, "");
  return out;
}

export interface SanitizedTtsBody {
  /** Sanitized body with URLs already replaced by "a link". Empty when nothing speakable. */
  text: string;
  /** True when the raw message held only links (and whitespace/punctuation). */
  linkOnly: boolean;
}

/**
 * Turn raw Discord message text (with mention IDs already resolved) into
 * speakable text. URLs become "a link", markdown/formatting is stripped and
 * plain "@user" / "#channel" prefixes are dropped.
 */
export function sanitizeTtsText(raw: string): SanitizedTtsBody {
  const unwrapped = raw.replace(/<(https?:\/\/[^>\s]+)>/g, "$1");

  const { text: withLinks, linkCount } = replaceUrlsWithLink(unwrapped);

  let out = stripMarkdown(withLinks);
  out = out.replace(/<3\b/g, " heart ");
  out = out.replace(/(^|\s)@([A-Za-z0-9_.-]+)/g, "$1$2");
  out = out.replace(/(^|\s)#([A-Za-z0-9_-]+)/g, "$1$2");
  out = out.replace(/[<>]/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(/\s+([.,!?:;])/g, "$1");

  if (!out) {
    return { text: "", linkOnly: linkCount > 0 };
  }

  if (linkCount > 0) {
    const withoutLinks = out.replace(/\ba links?\b/gi, "").replace(/[.,!?:;()"'…\s]/g, "");
    if (!withoutLinks) return { text: "", linkOnly: true };
  }

  return { text: out, linkOnly: false };
}

/** Resolve `<@id>` / `<#id>` / emoji mentions, then sanitize for speech. */
export function formatTtsBody(raw: string, lookups: TtsNameLookups = {}): SanitizedTtsBody {
  return sanitizeTtsText(resolveDiscordMentions(raw, lookups));
}

/**
 * Add the "{User} said, ..." prefix for a new speaker. Pass
 * isNewSpeaker=false for consecutive messages from the same person so the
 * name is not repeated.
 */
export function buildTtsUtterance(
  body: string,
  speakerName: string | null,
  isNewSpeaker: boolean,
): string {
  const cleanBody = body.replace(/\s+/g, " ").trim();
  const speaker = speakerName ? sanitizeSpeakerName(speakerName) : "";
  if (!cleanBody) return "";
  if (speaker && isNewSpeaker) return `${speaker} said, ${cleanBody}`;
  return cleanBody;
}

/** "{User} sent a link" for link-only messages (name only for new speakers). */
export function buildLinkUtterance(speakerName: string | null, isNewSpeaker: boolean): string {
  const speaker = speakerName ? sanitizeSpeakerName(speakerName) : "";
  if (speaker && isNewSpeaker) return `${speaker} sent a link`;
  return "sent a link";
}

/** "{User} sent an image/file/..." for attachment-only messages. */
export function buildAttachmentUtterance(
  speakerName: string | null,
  isNewSpeaker: boolean,
  kind: string,
): string {
  const speaker = speakerName ? sanitizeSpeakerName(speakerName) : "";
  if (speaker && isNewSpeaker) return `${speaker} sent ${kind}`;
  return `sent ${kind}`;
}
