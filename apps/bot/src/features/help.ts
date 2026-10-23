import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type MessageActionRowComponentBuilder,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import {
  CATEGORY_LABELS,
  COLORS,
  truncate,
  type CommandCategory,
  type CommandMetadata,
} from "@siela/shared";
import type { BotConfig } from "@siela/config";
import type { CommandRegistry } from "../framework/registry.js";
import type { ReplyPayload } from "../framework/types.js";
import { isAdmin } from "../framework/permissions.js";
import { EMOJI, actionRow, card } from "./ui.js";

export const HELP_SEARCH_MODAL_ID = "help:search:submit";
export const HELP_SEARCH_INPUT_ID = "query";

export interface HelpOptions {
  registry: CommandRegistry;
  member: GuildMember;
  config: BotConfig;
  prefix: string;
  category?: string;
  query?: string;
}

export interface HelpGroup {
  title: string;
  commands: string[];
}

export const HELP_CATEGORIES: CommandCategory[] = ["music", "social", "voice", "utility", "admin"];

const CATEGORY_BLURBS: Record<CommandCategory, string> = {
  music: "Playback, queue, lyrics, and filters",
  social: "Interactions, family, games, and relics",
  voice: "Temporary voice channel controls",
  utility: "Economy, levels, birthdays, and tools",
  admin: "Server setup, moderation, and events",
};

const CATEGORY_ACCENTS: Record<CommandCategory, number> = {
  music: COLORS.music,
  social: COLORS.social,
  voice: COLORS.voice,
  utility: COLORS.primary,
  admin: COLORS.admin,
};

const POPULAR_COMMANDS = ["play", "queue", "tambola", "relics", "economy", "vc"];

/**
 * Commands are grouped by what people are trying to do, not by internal
 * module layout. Any command missing from these lists is appended to a
 * "More" group so new features show up automatically.
 */
export const HELP_GROUPS: Record<CommandCategory, HelpGroup[]> = {
  music: [
    { title: "Playback", commands: ["play", "pause", "resume", "skip", "stop", "nowplaying"] },
    { title: "Queue", commands: ["queue", "shuffle", "remove", "clearqueue", "move", "jump"] },
    { title: "Sound", commands: ["volume", "seek", "loop", "filters", "autoplay"] },
    { title: "Session", commands: ["join", "disconnect", "lyrics"] },
  ],
  social: [
    {
      title: "Interactions",
      commands: ["slap", "kiss", "hug", "chodu", "wuzu", "socialstats", "socialtop", "optout", "optin"],
    },
    {
      title: "Relationships",
      commands: [
        "marry",
        "divorce",
        "adopt",
        "runaway",
        "familytree",
        "friendship",
        "friendshiptop",
        "lovecalc",
        "bias",
      ],
    },
    { title: "Games & fun", commands: ["tambola", "relics", "delulu", "confess"] },
  ],
  voice: [{ title: "Temporary channels", commands: ["vc"] }],
  utility: [
    { title: "Economy", commands: ["economy", "stocks"] },
    { title: "Progress", commands: ["level", "activity", "activetop", "birthday"] },
    { title: "Tools", commands: ["ping", "privacy", "tts", "help"] },
  ],
  admin: [
    { title: "Server setup", commands: ["config", "prefix", "welcome", "autorole", "tempvc", "jointocreate"] },
    { title: "Music", commands: ["musicconfig"] },
    { title: "Moderation", commands: ["confession"] },
    { title: "Levels & events", commands: ["levelchannel", "test"] },
  ],
};

export function categoriesFor(admin: boolean): CommandCategory[] {
  return admin ? HELP_CATEGORIES : HELP_CATEGORIES.filter((category) => category !== "admin");
}

export function visibleCommands(
  commands: CommandMetadata[],
  categories: CommandCategory[],
  admin: boolean,
): CommandMetadata[] {
  return commands.filter(
    (command) => categories.includes(command.category) && (admin || !command.adminOnly),
  );
}

export function groupCategoryCommands(
  commands: CommandMetadata[],
  category: CommandCategory,
): HelpGroup[] {
  const inCategory = commands.filter((command) => command.category === category);
  const byName = new Map(inCategory.map((command) => [command.name, command]));
  const used = new Set<string>();
  const groups: HelpGroup[] = [];

  for (const group of HELP_GROUPS[category]) {
    const names = group.commands.filter((name) => {
      if (!byName.has(name) || used.has(name)) return false;
      used.add(name);
      return true;
    });
    if (names.length) groups.push({ title: group.title, commands: names });
  }

  const remaining = inCategory
    .map((command) => command.name)
    .filter((name) => !used.has(name))
    .sort((left, right) => left.localeCompare(right));
  if (remaining.length) groups.push({ title: "More", commands: remaining });

  return groups;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/^[/!]+/, "").replace(/\s+/g, " ");
}

export function findCategory(query: string): CommandCategory | null {
  const value = normalizeQuery(query);
  if (!value) return null;
  const singular = value.endsWith("s") ? value.slice(0, -1) : value;
  return HELP_CATEGORIES.find((category) => category === value || category === singular) ?? null;
}

export function findCommand(
  commands: CommandMetadata[],
  query: string,
): CommandMetadata | null {
  const value = normalizeQuery(query);
  if (!value) return null;
  const compactValue = compact(value);
  return (
    commands.find(
      (command) =>
        command.name === value ||
        command.aliases.some((alias) => alias.toLowerCase() === value) ||
        (compactValue.length > 0 &&
          (compact(command.name) === compactValue ||
            command.aliases.some((alias) => compact(alias) === compactValue))),
    ) ?? null
  );
}

function scoreCommand(command: CommandMetadata, query: string, tokens: string[]): number {
  const name = command.name.toLowerCase();
  const aliases = command.aliases.map((alias) => alias.toLowerCase());
  const compactQuery = compact(query);
  const compactName = compact(name);

  if (name === query || aliases.includes(query)) return 100;
  if (compactQuery && aliases.some((alias) => compact(alias) === compactQuery)) return 95;
  if (name.startsWith(query)) return 80;
  if (aliases.some((alias) => alias.startsWith(query))) return 70;
  if (compactQuery && compactName.includes(compactQuery)) return 60;
  if (name.includes(query)) return 55;
  if (aliases.some((alias) => alias.includes(query))) return 50;

  const haystack = `${name} ${aliases.join(" ")} ${command.description.toLowerCase()} ${command.usage.toLowerCase()}`;
  if (tokens.length && tokens.every((token) => haystack.includes(token))) return 30;
  return 0;
}

export function searchCommands(
  commands: CommandMetadata[],
  query: string,
  limit = 6,
): CommandMetadata[] {
  const value = normalizeQuery(query);
  if (!value) return [];
  const tokens = value.split(" ").filter(Boolean);
  return commands
    .map((command) => ({ command, score: scoreCommand(command, value, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.command.name.localeCompare(right.command.name))
    .slice(0, limit)
    .map((entry) => entry.command);
}

function levenshtein(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let column = 1; column <= right.length; column += 1) {
    let previous = rows[0]!;
    rows[0] = column;
    for (let row = 1; row <= left.length; row += 1) {
      const current = rows[row]!;
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      rows[row] = Math.min(rows[row]! + 1, rows[row - 1]! + 1, previous + cost);
      previous = current;
    }
  }
  return rows[left.length]!;
}

export function suggestCommands(
  commands: CommandMetadata[],
  query: string,
  limit = 5,
): CommandMetadata[] {
  const value = normalizeQuery(query);
  if (value.length < 2) return [];
  const direct = searchCommands(commands, value, limit);
  if (direct.length) return direct;

  const maxDistance = Math.max(2, Math.ceil(value.length / 3));
  return commands
    .map((command) => ({
      command,
      distance: Math.min(
        levenshtein(value, command.name.toLowerCase()),
        ...command.aliases.map((alias) => levenshtein(value, alias.toLowerCase())),
      ),
    }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance || left.command.name.localeCompare(right.command.name))
    .slice(0, limit)
    .map((entry) => entry.command);
}

function countCategories(commands: CommandMetadata[]): Record<CommandCategory, number> {
  const counts: Record<CommandCategory, number> = {
    music: 0,
    social: 0,
    voice: 0,
    utility: 0,
    admin: 0,
  };
  for (const command of commands) counts[command.category] += 1;
  return counts;
}

function commandCountLabel(count: number): string {
  return `${count} command${count === 1 ? "" : "s"}`;
}

function searchButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId("help:search")
    .setLabel("Search")
    .setEmoji(EMOJI.search)
    .setStyle(ButtonStyle.Primary);
}

function homeButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId("help:home")
    .setLabel("All categories")
    .setEmoji(EMOJI.home)
    .setStyle(ButtonStyle.Secondary);
}

function closeButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId("help:close")
    .setLabel("Close")
    .setEmoji(EMOJI.close)
    .setStyle(ButtonStyle.Secondary);
}

function commandOption(command: CommandMetadata): StringSelectMenuOptionBuilder {
  const option = new StringSelectMenuOptionBuilder()
    .setLabel(command.name)
    .setValue(command.name)
    .setDescription(truncate(command.description, 100));
  if (command.nsfw) option.setEmoji(EMOJI.nsfw);
  else if (command.adminOnly) option.setEmoji(EMOJI.admin);
  return option;
}

function commandPicker(
  customId: string,
  commands: CommandMetadata[],
  placeholder: string,
): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  if (!commands.length) return null;
  return actionRow(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(commands.slice(0, 25).map(commandOption)),
  );
}

function buildOverview(commands: CommandMetadata[], categories: CommandCategory[], prefix: string): ReplyPayload {
  const counts = countCategories(commands);
  const popular = POPULAR_COMMANDS
    .map((name) => commands.find((command) => command.name === name))
    .filter((command): command is CommandMetadata => Boolean(command));

  const body = [
    popular.length ? `**Popular** · ${popular.map((command) => `\`${command.name}\``).join(" · ")}` : "",
    `-# Pick a category below, or use \`${prefix}help <command>\` for a direct answer.`,
  ]
    .filter(Boolean)
    .join("\n");

  const menu = new StringSelectMenuBuilder()
    .setCustomId("help:category")
    .setPlaceholder("Browse a category…")
    .addOptions(
      categories.map((category) => ({
        label: `${CATEGORY_LABELS[category]} · ${counts[category]}`,
        value: category,
        description: CATEGORY_BLURBS[category],
        emoji: EMOJI[category],
      })),
    );

  return card({
    title: `${EMOJI.help} Siela Help`,
    subtitle: `${commandCountLabel(commands.length)} · prefix \`${prefix}\` · slash works too`,
    body,
    rows: [actionRow(menu), actionRow(searchButton(), closeButton())],
    ephemeral: true,
  });
}

function buildCategory(
  category: CommandCategory,
  commands: CommandMetadata[],
  prefix: string,
): ReplyPayload {
  const categoryCommands = commands.filter((command) => command.category === category);
  const groups = groupCategoryCommands(commands, category);
  const body = groups
    .map(
      (group) =>
        `**${group.title}**\n${group.commands.map((name) => `\`${name}\``).join(" · ")}`,
    )
    .join("\n\n");

  const overflow =
    categoryCommands.length > 25
      ? `\n\n-# The menu lists 25 of ${categoryCommands.length}. Use \`${prefix}help <command>\` for the rest.`
      : "";
  const picker = commandPicker(
    `help:command:${category}`,
    categoryCommands,
    "Choose a command…",
  );

  return card({
    title: `${EMOJI[category]} ${CATEGORY_LABELS[category]}`,
    subtitle: `${commandCountLabel(categoryCommands.length)} · select one for usage`,
    body: `${body}${overflow}`,
    accent: CATEGORY_ACCENTS[category],
    rows: [
      ...(picker ? [picker] : []),
      actionRow(homeButton(), searchButton(), closeButton()),
    ],
    ephemeral: true,
  });
}

function buildCommand(command: CommandMetadata, prefix: string): ReplyPayload {
  const access = command.adminOnly ? " · Admin only" : command.nsfw ? " · NSFW" : "";
  const lines = [
    command.description,
    "",
    "**Usage**",
    `\`${prefix}${command.name}${command.usage ? ` ${command.usage}` : ""}\``,
  ];

  const example = command.examples[0];
  if (example) {
    lines.push("", "**Example**", `\`${prefix}${example}\``);
  }

  const also = [
    ...(command.slash ? [`\`/${command.name}\``] : []),
    ...command.aliases.slice(0, 5).map((alias) => `\`${alias}\``),
  ];
  if (also.length) lines.push("", `**Also** · ${also.join(" · ")}`);
  if (command.cooldownMs > 0) {
    lines.push("", `**Cooldown** · ${command.cooldownMs / 1000}s`);
  }

  return card({
    title: `${EMOJI[command.category]} ${command.name}`,
    subtitle: `${CATEGORY_LABELS[command.category]}${access}`,
    body: lines.join("\n"),
    accent: CATEGORY_ACCENTS[command.category],
    rows: [
      actionRow(
        new ButtonBuilder()
          .setCustomId(`help:nav:${command.category}`)
          .setLabel(`Back to ${CATEGORY_LABELS[command.category]}`)
          .setEmoji(EMOJI.home)
          .setStyle(ButtonStyle.Secondary),
        homeButton(),
        closeButton(),
      ),
    ],
    ephemeral: true,
  });
}

function buildSearch(
  matches: CommandMetadata[],
  query: string,
  prefix: string,
): ReplyPayload {
  const picker = commandPicker("help:pick", matches, "Open a match…");
  return card({
    title: `${EMOJI.search} Search`,
    subtitle: `${matches.length} match${matches.length === 1 ? "" : "es"} for \`${truncate(query, 40)}\``,
    body: [
      `**Matches** · ${matches.map((command) => `\`${command.name}\``).join(" · ")}`,
      `-# Pick one below, or use \`${prefix}help <command>\` for a direct answer.`,
    ].join("\n"),
    rows: [...(picker ? [picker] : []), actionRow(searchButton(), homeButton(), closeButton())],
    ephemeral: true,
  });
}

function buildNoMatch(
  query: string,
  suggestions: CommandMetadata[],
  prefix: string,
): ReplyPayload {
  const picker = commandPicker("help:pick", suggestions, "Did you mean…");
  const body = [
    `Nothing matched \`${truncate(query, 50)}\`.`,
    suggestions.length
      ? `\n**Did you mean**\n${suggestions.map((command) => `\`${command.name}\``).join(" · ")}`
      : `\nTry a command name like \`play\`, or browse a category below.`,
    `-# You can also use \`${prefix}help <command>\`.`,
  ].join("\n");

  return card({
    title: `${EMOJI.search} No match`,
    subtitle: "Search",
    body,
    rows: [...(picker ? [picker] : []), actionRow(searchButton(), homeButton(), closeButton())],
    ephemeral: true,
  });
}

function buildLockedCategory(): ReplyPayload {
  return card({
    title: `${EMOJI.lock} Admin`,
    subtitle: "Restricted category",
    body: "Admin commands are only visible to server admins.",
    rows: [actionRow(homeButton(), closeButton())],
    ephemeral: true,
  });
}

export async function buildHelpPayload(options: HelpOptions): Promise<ReplyPayload> {
  const { registry, member, config, prefix } = options;
  const admin = isAdmin(member, config, member.guild);
  const categories = categoriesFor(admin);
  const commands = visibleCommands(registry.metadata(), categories, admin);

  const explicitCategory = options.category ? findCategory(options.category) : null;
  if (explicitCategory) {
    if (!categories.includes(explicitCategory)) return buildLockedCategory();
    return buildCategory(explicitCategory, commands, prefix);
  }

  const query = normalizeQuery(options.query ?? "");
  if (!query) return buildOverview(commands, categories, prefix);

  const category = findCategory(query);
  if (category) {
    if (!categories.includes(category)) return buildLockedCategory();
    return buildCategory(category, commands, prefix);
  }

  const selected = findCommand(commands, query);
  if (selected) return buildCommand(selected, prefix);

  const matches = searchCommands(commands, query);
  if (matches.length === 1) return buildCommand(matches[0]!, prefix);
  if (matches.length > 1) return buildSearch(matches, query, prefix);

  const suggestions = suggestCommands(commands, query);
  return buildNoMatch(query, suggestions, prefix);
}

export function buildHelpSearchModal(initialQuery?: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(HELP_SEARCH_INPUT_ID)
    .setLabel("Command or category")
    .setPlaceholder("play, tambola, economy…")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  if (initialQuery) input.setValue(truncate(initialQuery, 80));

  return new ModalBuilder()
    .setCustomId(HELP_SEARCH_MODAL_ID)
    .setTitle("Search commands")
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input),
    );
}
