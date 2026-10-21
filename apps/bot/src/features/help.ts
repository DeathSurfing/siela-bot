import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type GuildMember,
} from "discord.js";
import {
  APP_NAME,
  APP_VERSION,
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  COLORS,
  type CommandCategory,
  type CommandMetadata,
} from "@siela/shared";
import type { BotConfig } from "@siela/config";
import type { CommandRegistry } from "../framework/registry.js";
import type { ReplyPayload } from "../framework/types.js";
import { isAdmin } from "../framework/permissions.js";

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

function commandLine(command: CommandMetadata, prefix: string): string {
  const invocation = command.slash ? `/${command.name}` : `${prefix}${command.name}`;
  const usage = command.usage ? ` \`${command.usage}\`` : "";
  const lock = command.adminOnly ? " 🔒" : "";
  const nsfw = command.nsfw ? " 🔞" : "";
  return `**${invocation}**${usage} — ${command.description}${lock}${nsfw}`;
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

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: `${APP_NAME} • ${APP_VERSION}` })
    .setFooter({ text: `Prefix ${prefix} • hybrid commands` })
    .setTimestamp();

  if (selected) {
    embed
      .setTitle(`${CATEGORY_EMOJI[selected.category]} ${selected.name}`)
      .setDescription(selected.description)
      .addFields(
        { name: "Usage", value: `\`${prefix}${selected.name}${selected.usage ? ` ${selected.usage}` : ""}\``, inline: false },
        { name: "Category", value: CATEGORY_LABELS[selected.category], inline: true },
        { name: "Cooldown", value: selected.cooldownMs ? `${selected.cooldownMs / 1000}s` : "none", inline: true },
        { name: "Access", value: selected.adminOnly ? "Admin" : "Everyone", inline: true },
      );
    if (selected.aliases.length) embed.addFields({ name: "Aliases", value: selected.aliases.join(", "), inline: false });
    if (selected.examples.length) {
      embed.addFields({
        name: "Examples",
        value: selected.examples.map((example) => `\`${prefix}${example}\``).join("\n"),
        inline: false,
      });
    }
  } else if (category) {
    const list = commands.filter((command) => command.category === category);
    embed
      .setTitle(`${CATEGORY_EMOJI[category]} ${CATEGORY_LABELS[category]} commands`)
      .setDescription(list.map((command) => commandLine(command, prefix)).join("\n") || "No commands.");
  } else {
    const summary = categories.map((cat) => {
      const count = commands.filter((command) => command.category === cat).length;
      return `${CATEGORY_EMOJI[cat]} **${CATEGORY_LABELS[cat]}** — ${count} commands`;
    });
    embed
      .setTitle(`${APP_NAME} help`)
      .setDescription(
        [
          `Use the menu below or \`${prefix}help <command>\` for details.`,
          "",
          ...summary,
          "",
          "**Hybrid** — every command works with prefix and slash where available.",
        ].join("\n"),
      );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("help:category")
    .setPlaceholder("Choose a category…")
    .addOptions(
      categories.map((cat) => ({
        label: CATEGORY_LABELS[cat],
        value: cat,
        emoji: CATEGORY_EMOJI[cat],
        default: category === cat,
      })),
    );

  const close = new ButtonBuilder()
    .setCustomId("help:close")
    .setLabel("Close")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(close),
    ],
    ephemeral: true,
  };
}
