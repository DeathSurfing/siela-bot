export type FeatureCategory =
  | "Music"
  | "Economy"
  | "Relics"
  | "Games"
  | "Social"
  | "Community"
  | "Voice"
  | "Automation";

export interface FeatureDefinition {
  id: string;
  label: string;
  category: FeatureCategory;
  description: string;
  defaultEnabled: boolean;
  commands: readonly string[];
  dependsOn: readonly string[];
}

const FEATURE_DEFINITIONS = [
  {
    id: "music-playback",
    label: "Music playback",
    category: "Music",
    description: "Stream and control music in voice channels.",
    defaultEnabled: true,
    commands: [
      "play",
      "join",
      "pause",
      "resume",
      "skip",
      "stop",
      "queue",
      "nowplaying",
      "volume",
      "seek",
      "loop",
      "shuffle",
      "remove",
      "clearqueue",
      "move",
      "jump",
      "disconnect",
      "autoplay",
      "filters",
    ],
    dependsOn: [],
  },
  {
    id: "music-lyrics",
    label: "Lyrics",
    category: "Music",
    description: "Fetch synced lyrics for the current track.",
    defaultEnabled: true,
    commands: ["lyrics"],
    dependsOn: ["music-playback"],
  },
  {
    id: "economy-core",
    label: "Economy",
    category: "Economy",
    description: "Coins, daily rewards, work, pay, leaderboard, games, and the shop.",
    defaultEnabled: true,
    commands: ["economy"],
    dependsOn: [],
  },
  {
    id: "economy-stocks",
    label: "Stock market",
    category: "Economy",
    description: "Meme-stock market, portfolios, and trades.",
    defaultEnabled: true,
    commands: ["stocks"],
    dependsOn: ["economy-core"],
  },
  {
    id: "relics",
    label: "Relic cards and auctions",
    category: "Relics",
    description: "Daily one-of-one card auctions, vaults, showcases, and trades.",
    defaultEnabled: true,
    commands: ["relics", "inventory", "showcase"],
    dependsOn: ["economy-core"],
  },
  {
    id: "games-tambola",
    label: "Tambola",
    category: "Games",
    description: "90-ball housie with private tickets and spoken calls.",
    defaultEnabled: true,
    commands: ["tambola"],
    dependsOn: ["economy-core"],
  },
  {
    id: "games-cah",
    label: "Cards Against Humanity",
    category: "Games",
    description: "Round-based CAH games with a lobby.",
    defaultEnabled: true,
    commands: ["cah"],
    dependsOn: [],
  },
  {
    id: "social-interactions",
    label: "Interactions",
    category: "Social",
    description: "Slap, kiss, hug and the rest, with counters.",
    defaultEnabled: true,
    commands: [
      "slap",
      "kiss",
      "hug",
      "chodu",
      "wuzu",
      "socialstats",
      "socialtop",
      "optout",
      "optin",
    ],
    dependsOn: [],
  },
  {
    id: "social-family",
    label: "Family",
    category: "Social",
    description: "Marriages, adoptions, and the family tree.",
    defaultEnabled: true,
    commands: ["marry", "divorce", "adopt", "runaway", "familytree"],
    dependsOn: [],
  },
  {
    id: "social-friendship",
    label: "Friendship",
    category: "Social",
    description: "Pair levels and time-together tracking.",
    defaultEnabled: true,
    commands: ["friendship", "friendshiptop"],
    dependsOn: ["engagement-activity"],
  },
  {
    id: "social-love",
    label: "Love calculator",
    category: "Social",
    description: "Deterministic pair compatibility score.",
    defaultEnabled: true,
    commands: ["lovecalc"],
    dependsOn: [],
  },
  {
    id: "social-bias",
    label: "Bias profiles",
    category: "Social",
    description: "BTS bias and bias wrecker profiles.",
    defaultEnabled: true,
    commands: ["bias"],
    dependsOn: [],
  },
  {
    id: "social-delulu",
    label: "Delulu",
    category: "Social",
    description: "Short AI-generated bias scenarios.",
    defaultEnabled: true,
    commands: ["delulu"],
    dependsOn: ["social-bias", "economy-core"],
  },
  {
    id: "moderation-confession",
    label: "Confessions",
    category: "Community",
    description: "Anonymous confession wall.",
    defaultEnabled: true,
    commands: ["confess", "confession"],
    dependsOn: [],
  },
  {
    id: "onboarding-welcome",
    label: "Welcome messages",
    category: "Community",
    description: "Join and leave messages, cards, and DMs.",
    defaultEnabled: true,
    commands: ["welcome"],
    dependsOn: [],
  },
  {
    id: "onboarding-autorole",
    label: "Auto role",
    category: "Community",
    description: "Assign roles when a member joins.",
    defaultEnabled: true,
    commands: ["autorole"],
    dependsOn: [],
  },
  {
    id: "engagement-activity",
    label: "Activity tracking",
    category: "Community",
    description: "Message, voice, and reaction activity stats.",
    defaultEnabled: true,
    commands: ["activity", "activetop"],
    dependsOn: [],
  },
  {
    id: "engagement-leveling",
    label: "Leveling",
    category: "Community",
    description: "XP, levels, and level-up announcements.",
    defaultEnabled: true,
    commands: ["level", "levelchannel"],
    dependsOn: ["engagement-activity"],
  },
  {
    id: "engagement-birthday",
    label: "Birthdays",
    category: "Community",
    description: "Daily birthday announcements.",
    defaultEnabled: true,
    commands: ["birthday"],
    dependsOn: [],
  },
  {
    id: "voice-tts",
    label: "Text to speech",
    category: "Voice",
    description: "Reads voice-channel chat aloud.",
    defaultEnabled: true,
    commands: ["tts"],
    dependsOn: [],
  },
  {
    id: "voice-tempvc",
    label: "Temporary voice channels",
    category: "Voice",
    description: "Join-to-create channels with owner controls.",
    defaultEnabled: true,
    commands: ["vc", "tempvc", "jointocreate"],
    dependsOn: [],
  },
  {
    id: "voice-moderation",
    label: "Voice moderation",
    category: "Voice",
    description: "Move all members between voice channels.",
    defaultEnabled: true,
    commands: ["moveall"],
    dependsOn: [],
  },
  {
    id: "voice-sfx",
    label: "Voice sound effects",
    category: "Voice",
    description: "Plays a sound clip when a trigger word is typed.",
    defaultEnabled: true,
    commands: [],
    dependsOn: [],
  },
  {
    id: "automation-scheduled-events",
    label: "Scheduled audio events",
    category: "Automation",
    description: "Daily prayer and event audio in voice.",
    defaultEnabled: true,
    commands: ["test"],
    dependsOn: [],
  },
  {
    id: "automation-random-drops",
    label: "Random voice drops",
    category: "Automation",
    description: "Occasional ambient sound drops into busy channels.",
    defaultEnabled: true,
    commands: [],
    dependsOn: [],
  },
] as const satisfies readonly FeatureDefinition[];

export type FeatureId = (typeof FEATURE_DEFINITIONS)[number]["id"];

export const FEATURES: readonly FeatureDefinition[] = FEATURE_DEFINITIONS;

export const FEATURE_IDS: readonly FeatureId[] = FEATURE_DEFINITIONS.map(
  (feature) => feature.id,
);

export interface FeatureCategoryGroup {
  category: FeatureCategory;
  features: readonly FeatureDefinition[];
}

const FEATURE_BY_ID = new Map<string, FeatureDefinition>(
  FEATURE_DEFINITIONS.map((feature) => [feature.id, feature]),
);

const FEATURE_ID_SET = new Set<string>(FEATURE_IDS);

const COMMAND_TO_FEATURE = new Map<string, FeatureId>();
for (const feature of FEATURE_DEFINITIONS) {
  for (const command of feature.commands) {
    COMMAND_TO_FEATURE.set(command, feature.id);
  }
}

export function getFeature(id: string): FeatureDefinition | undefined {
  return FEATURE_BY_ID.get(id);
}

export function isFeatureId(value: string): value is FeatureId {
  return FEATURE_ID_SET.has(value);
}

export function featureForCommand(name: string): FeatureId | undefined {
  return COMMAND_TO_FEATURE.get(name);
}

export function featureCatalogByCategory(): FeatureCategoryGroup[] {
  const groups = new Map<FeatureCategory, FeatureDefinition[]>();
  for (const feature of FEATURE_DEFINITIONS) {
    const group = groups.get(feature.category);
    if (group) group.push(feature);
    else groups.set(feature.category, [feature]);
  }
  return [...groups].map(([category, features]) => ({ category, features }));
}
