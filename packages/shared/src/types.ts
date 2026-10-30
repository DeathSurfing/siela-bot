export type InteractionKind = "slap" | "kiss" | "hug" | "chodu" | "wuzu";

export type CommandCategory = "music" | "social" | "voice" | "utility" | "admin";

export interface GuildSettings {
  guildId: string;
  prefix: string;
  locale: string;
}

export interface WelcomeSettings {
  guildId: string;
  enabled: boolean;
  channelId: string | null;
  message: string;
  embed: boolean;
  pingUser: boolean;
  dmEnabled: boolean;
  dmMessage: string | null;
  goodbyeEnabled: boolean;
  goodbyeChannelId: string | null;
  goodbyeMessage: string | null;
}

export interface AutoRoleSettings {
  guildId: string;
  enabled: boolean;
  roleIds: string[];
  includeBots: boolean;
  minAccountAgeDays: number;
  delayMs: number;
}

export interface TempVcSettings {
  guildId: string;
  enabled: boolean;
  hubChannelId: string | null;
  categoryId: string | null;
  nameTemplate: string;
  defaultUserLimit: number;
  defaultLocked: boolean;
  autoDelete: boolean;
  graceSeconds: number;
  maxChannels: number;
  maxPerUser: number;
}

export interface MusicSettings {
  guildId: string;
  djRoleIds: string[];
  defaultVolume: number;
  maxQueueSize: number;
  musicChannelId: string | null;
  aloneTimeoutSeconds: number;
}

export interface CounterStat {
  kind: InteractionKind;
  count: number;
  lastUsedAt: string | null;
}

export interface CounterPair {
  actorId: string;
  targetId: string;
  kind: InteractionKind;
  count: number;
}

export interface TempVoiceChannel {
  channelId: string;
  guildId: string;
  ownerId: string;
  hubId: string;
  status: "active" | "deleted";
  locked: boolean;
  userLimit: number;
  createdAt: string;
  deletedAt: string | null;
  lastEmptyAt: string | null;
}

export interface AuditEntry {
  id: string;
  guildId: string;
  actorId: string | null;
  actorName?: string | null;
  actorType: "user" | "mcp" | "system";
  source: "discord" | "mcp" | "control" | "system";
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: string;
}

export interface BotStatus {
  ready: boolean;
  uptimeSeconds: number;
  gatewayPing: number | null;
  guildId: string | null;
  guildCount: number;
  database: "up" | "down";
  music: "up" | "down" | "unknown";
  activePlayers: number;
  activeTempVcs: number;
  version: string;
}

export interface CommandMetadata {
  name: string;
  aliases: string[];
  category: CommandCategory;
  description: string;
  usage: string;
  examples: string[];
  adminOnly: boolean;
  nsfw: boolean;
  cooldownMs: number;
  slash: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export type MusicLoopMode = "off" | "track" | "queue";

export interface MusicTrackInfo {
  title: string;
  author: string;
  length: number;
  uri: string | null;
  artworkUrl: string | null;
  isStream: boolean;
}

export interface MusicQueueState {
  playing: boolean;
  paused: boolean;
  volume: number;
  loop: MusicLoopMode;
  position: number;
  current: MusicTrackInfo | null;
  upcoming: MusicTrackInfo[];
}
