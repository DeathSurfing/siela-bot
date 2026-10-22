import {
  StringSelectMenuBuilder,
  type GuildMember,
} from "discord.js";
import {
  CATEGORY_LABELS,
  type CommandCategory,
  type CommandMetadata,
} from "@siela/shared";
import type { BotConfig } from "@siela/config";
import type { CommandRegistry } from "../framework/registry.js";
import type { ReplyPayload } from "../framework/types.js";
import { isAdmin } from "../framework/permissions.js";
import { actionRow, card } from "./ui.js";

export interface HelpOptions {
  registry: CommandRegistry;
  member: GuildMember;
  config: BotConfig;
  prefix: string;
  category?: string;
  query?: string;
}

const CATEGORIES: CommandCategory[] = ["music", "social", "voice", "utility", "admin"];

function allowedCategories(member: GuildMember, config: BotConfig): CommandCategory[] {
  return isAdmin(member, config, member.guild) ? CATEGORIES : CATEGORIES.filter((c) => c !== "admin");
}

function commandLine(command: CommandMetadata): string {
  const lock = command.adminOnly ? " · Admin" : "";
  const nsfw = command.nsfw ? " · NSFW" : "";
  return `**${command.name}** — ${command.description}${lock}${nsfw}`;
}

function commandDetail(command: CommandMetadata, prefix: string): string {
  const lines = [
    `**Usage** · \`${prefix}${command.name}${command.usage ? ` ${command.usage}` : ""}\``,
    `**Access** · ${command.adminOnly ? "Admin" : "Everyone"}${command.nsfw ? " · NSFW" : ""}`,
    `**Cooldown** · ${command.cooldownMs ? `${command.cooldownMs / 1000}s` : "none"}`,
  ];
  if (command.aliases.length) lines.push(`**Aliases** · ${command.aliases.join(", ")}`);
  if (command.examples.length) {
    lines.push(`**Examples** · ${command.examples.slice(0, 3).map((example) => `\`${prefix}${example}\``).join(" · ")}`);
  }
  return lines.join("\n");
}

export async function buildHelpPayload(options: HelpOptions): Promise<ReplyPayload> {
  const { registry, member, config, prefix } = options;
  const categories = allowedCategories(member, config);
  const commands = registry.metadata().filter((command) => categories.includes(command.category));
  const query = options.query?.trim().toLowerCase().replace(/^[/!]/, "");
  const selected = query
    ? commands.find((command) => command.name === query || command.aliases.includes(query))
    : null;
  const category = options.category && categories.includes(options.category as CommandCategory)
    ? (options.category as CommandCategory)
    : null;

  let title = "Help";
  let subtitle = `${commands.length} command${commands.length === 1 ? "" : "s"} · prefix \`${prefix}\``;
  let body: string;

  if (selected) {
    title = selected.name;
    subtitle = CATEGORY_LABELS[selected.category];
    body = [`${selected.description}`, "", commandDetail(selected, prefix)].join("\n");
  } else if (category) {
    const list = commands.filter((command) => command.category === category);
    title = CATEGORY_LABELS[category];
    subtitle = `${list.length} command${list.length === 1 ? "" : "s"}`;
    body = list.map(commandLine).join("\n") || "No commands.";
  } else {
    const summary = categories.map((cat) => {
      const count = commands.filter((command) => command.category === cat).length;
      return `**${CATEGORY_LABELS[cat]}** — ${count} command${count === 1 ? "" : "s"}`;
    });
    body = [
      summary.join("\n"),
      "",
      `-# Use the menu below or \`${prefix}help <command>\` for details.`,
    ].join("\n");
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("help:category")
    .setPlaceholder("Browse categories…")
    .addOptions(
      categories.map((cat) => ({
        label: CATEGORY_LABELS[cat],
        value: cat,
        default: category === cat,
      })),
    );

  return card({
    title,
    subtitle,
    body,
    rows: [actionRow(menu)],
    ephemeral: true,
  });
}
