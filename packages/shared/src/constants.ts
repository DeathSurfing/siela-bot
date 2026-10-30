import type { CommandCategory, InteractionKind } from "./types.js";

export const APP_NAME = "Siela";
export const APP_VERSION = "0.1.0";

export const COLORS = {
  primary: 0x8b5cf6,
  success: 0x22c55e,
  warning: 0xf59e0b,
  danger: 0xef4444,
  muted: 0x64748b,
  music: 0x06b6d4,
  social: 0xf472b6,
  voice: 0x38bdf8,
  admin: 0xfb923c,
} as const;

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  music: "Music",
  social: "Social",
  voice: "Voice",
  utility: "Utility",
  admin: "Admin",
};

export const CATEGORY_EMOJI: Record<CommandCategory, string> = {
  music: "🎵",
  social: "💗",
  voice: "🔊",
  utility: "🧰",
  admin: "🛡️",
};

export const BTS_MEMBERS = ["RM", "Jin", "Suga", "J-Hope", "Jimin", "V", "Jungkook"] as const;
export type BtsMember = (typeof BTS_MEMBERS)[number];

export const INTERACTION_KINDS: InteractionKind[] = ["slap", "kiss", "hug", "chodu", "wuzu"];

export const INTERACTION_META: Record<
  InteractionKind,
  { label: string; verb: string; emoji: string; gif: boolean }
> = {
  slap: { label: "Slap", verb: "slapped", emoji: "👋", gif: true },
  kiss: { label: "Kiss", verb: "kissed", emoji: "💋", gif: true },
  hug: { label: "Hug", verb: "hugged", emoji: "🤗", gif: true },
  chodu: { label: "Chodu", verb: "chodu'd", emoji: "💥", gif: true },
  wuzu: { label: "Wuzu", verb: "wuzu'd", emoji: "💧", gif: true },
};

export const DEFAULTS = {
  prefix: "!",
  welcomeMessage: "Welcome {mention} to **{server}**! You are member #{memberCount}.",
  goodbyeMessage: "{username} left the server.",
  tempVcNameTemplate: "{user}'s VC",
  tempVcDefaultLimit: 0,
  tempVcGraceSeconds: 30,
  tempVcMaxChannels: 50,
  tempVcMaxPerUser: 1,
  musicDefaultVolume: 80,
  musicMaxQueueSize: 100,
  musicAloneTimeoutSeconds: 120,
  auditRetentionDays: 90,
} as const;

export const COOLDOWNS = {
  social: 3_000,
  music: 3_000,
  vc: 2_000,
  admin: 2_000,
} as const;

export const MAX_WELCOME_MESSAGE = 2_000;
export const MAX_WELCOME_DM = 2_000;
export const MAX_PREFIX_LENGTH = 5;
export const MAX_AUTOROLES = 10;
export const MAX_TEMPVC_NAME = 100;
export const MAX_MUSIC_QUERY = 500;
export const MAX_MESSAGE_SEND = 2_000;
export const MAX_CASINO_BET = 10_000;
