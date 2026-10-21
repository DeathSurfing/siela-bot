import type {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Guild,
  GuildBasedChannel,
  GuildMember,
  Message,
  MessageActionRowComponentBuilder,
  MessageContextMenuCommandInteraction,
  MessageMentionOptions,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  User,
} from "discord.js";
import type { CommandCategory, CommandMetadata } from "@siela/shared";
import type { BotConfig } from "@siela/config";
import type { SettingsService } from "../features/settings.js";
import type { AuditService } from "../features/audit.js";
import type { CounterService } from "../features/counters.js";
import type { WelcomeService } from "../features/welcome.js";
import type { AutoRoleService } from "../features/autorole.js";
import type { TempVcService } from "../features/tempvc.js";
import type { TranslationService } from "../features/translation.js";
import type { MusicService } from "../features/music.js";
import type { PrivacyService } from "../features/privacy.js";
import type { CommandRegistry } from "./registry.js";

export interface Services {
  config: BotConfig;
  registry: CommandRegistry;
  settings: SettingsService;
  audit: AuditService;
  counters: CounterService;
  welcome: WelcomeService;
  autoRole: AutoRoleService;
  tempVc: TempVcService;
  translation: TranslationService;
  privacy: PrivacyService;
  music: MusicService | null;
}

export interface ReplyPayload {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  files?: AttachmentBuilder[];
  ephemeral?: boolean;
  allowedMentions?: MessageMentionOptions;
}

export type CommandSource = "prefix" | "slash" | "context";

export interface CommandContext {
  client: Client;
  services: Services;
  guild: Guild;
  member: GuildMember;
  channel: GuildBasedChannel;
  author: User;
  args: string[];
  rawArgs: string;
  commandName: string;
  source: CommandSource;
  interaction?: ChatInputCommandInteraction | MessageContextMenuCommandInteraction;
  message?: Message;
  reply(payload: ReplyPayload): Promise<unknown>;
  defer(ephemeral?: boolean): Promise<void>;
  edit(payload: ReplyPayload): Promise<unknown>;
  followUp(payload: ReplyPayload): Promise<unknown>;
}

export type AnySlashBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface Command {
  name: string;
  aliases?: string[];
  category: CommandCategory;
  description: string;
  usage: string;
  examples?: string[];
  adminOnly?: boolean;
  nsfw?: boolean;
  cooldownMs?: number;
  userPermissions?: bigint[];
  botPermissions?: bigint[];
  slash?: AnySlashBuilder;
  execute(ctx: CommandContext): Promise<void>;
}

export interface RegisteredCommand extends Command {
  metadata(): CommandMetadata;
}
