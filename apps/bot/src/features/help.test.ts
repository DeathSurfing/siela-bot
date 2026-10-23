import { describe, expect, it } from "vitest";
import { MessageFlags, type GuildMember } from "discord.js";
import type { BotConfig } from "@siela/config";
import type { CommandCategory, CommandMetadata } from "@siela/shared";
import type { CommandRegistry } from "../framework/registry.js";
import {
  buildHelpPayload,
  categoriesFor,
  findCategory,
  findCommand,
  groupCategoryCommands,
  searchCommands,
  suggestCommands,
  visibleCommands,
} from "./help.js";

function meta(
  name: string,
  category: CommandCategory,
  extra: Partial<CommandMetadata> = {},
): CommandMetadata {
  return {
    name,
    aliases: [],
    category,
    description: `${name} description`,
    usage: "",
    examples: [],
    adminOnly: false,
    nsfw: false,
    cooldownMs: 0,
    slash: true,
    ...extra,
  };
}

const commands: CommandMetadata[] = [
  meta("play", "music", {
    aliases: ["p"],
    description: "Play a search, track URL, or playlist.",
    usage: "<query or url>",
    examples: ["play lofi girl"],
    cooldownMs: 3_000,
  }),
  meta("queue", "music", { aliases: ["q"] }),
  meta("tambola", "social", { aliases: ["housie"] }),
  meta("relics", "social", { aliases: ["relic", "cards"] }),
  meta("familytree", "social", { aliases: ["family", "tree"] }),
  meta("mystery", "social"),
  meta("economy", "utility", { aliases: ["eco", "balance"] }),
  meta("help", "utility", { aliases: ["h"] }),
  meta("secret", "utility", { adminOnly: true }),
  meta("config", "admin", { adminOnly: true }),
  meta("vc", "voice"),
];

const registry = { metadata: () => commands } as unknown as CommandRegistry;
const config = { botOwnerId: null, adminRoleIds: [] } as unknown as BotConfig;

function member(admin = false): GuildMember {
  return {
    id: "user",
    guild: { ownerId: "owner" },
    permissions: { has: () => admin },
    roles: { cache: { has: () => admin } },
  } as unknown as GuildMember;
}

describe("help command visibility", () => {
  it("hides admin categories and admin-only commands from non-admins", () => {
    const names = visibleCommands(commands, categoriesFor(false), false).map((command) => command.name);
    expect(names).not.toContain("config");
    expect(names).not.toContain("secret");
    expect(names).toContain("play");
  });

  it("shows admin commands to admins", () => {
    const names = visibleCommands(commands, categoriesFor(true), true).map((command) => command.name);
    expect(names).toContain("config");
    expect(names).toContain("secret");
  });
});

const realCommandNames: Record<CommandCategory, string[]> = {
  music: [
    "play",
    "join",
    "pause",
    "resume",
    "skip",
    "stop",
    "queue",
    "lyrics",
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
  social: [
    "bias",
    "confess",
    "delulu",
    "marry",
    "divorce",
    "adopt",
    "runaway",
    "familytree",
    "friendship",
    "friendshiptop",
    "lovecalc",
    "relics",
    "tambola",
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
  voice: ["vc"],
  utility: ["economy", "stocks", "level", "activity", "activetop", "birthday", "ping", "privacy", "tts", "help"],
  admin: [
    "config",
    "prefix",
    "welcome",
    "autorole",
    "tempvc",
    "jointocreate",
    "musicconfig",
    "confession",
    "levelchannel",
    "test",
  ],
};

const realCommands = (Object.entries(realCommandNames) as [CommandCategory, string[]][]).flatMap(
  ([category, names]) => names.map((name) => meta(name, category)),
);

describe("help command grouping", () => {
  it("covers every shipped command in its category", () => {
    for (const [category, names] of Object.entries(realCommandNames) as [CommandCategory, string[]][]) {
      const grouped = groupCategoryCommands(realCommands, category).flatMap((group) => group.commands);
      expect(grouped.sort()).toEqual([...names].sort());
    }
  });

  it("groups every command exactly once and falls back to More", () => {
    const groups = groupCategoryCommands(commands, "social");
    const names = groups.flatMap((group) => group.commands);
    expect(names.sort()).toEqual(["familytree", "mystery", "relics", "tambola"]);
    expect(groups.find((group) => group.title === "More")?.commands).toEqual(["mystery"]);
  });

  it("uses curated headings for known commands", () => {
    const groups = groupCategoryCommands(commands, "music");
    expect(groups.map((group) => group.title)).toContain("Playback");
    expect(groups.flatMap((group) => group.commands)).toEqual(["play", "queue"]);
  });
});

describe("help command lookup and search", () => {
  it("resolves names, aliases, and multi-word names", () => {
    expect(findCommand(commands, "p")?.name).toBe("play");
    expect(findCommand(commands, "family tree")?.name).toBe("familytree");
    expect(findCategory("musics")).toBe("music");
  });

  it("searches names and descriptions without leaking hidden commands", () => {
    const visible = visibleCommands(commands, categoriesFor(false), false);
    expect(searchCommands(visible, "play")[0]?.name).toBe("play");
    expect(searchCommands(visible, "track URL").map((command) => command.name)).toContain("play");
    expect(searchCommands(visible, "secret")).toHaveLength(0);
  });

  it("suggests a close spelling", () => {
    expect(suggestCommands(commands, "tambla").map((command) => command.name)).toContain("tambola");
  });
});

describe("help payloads", () => {
  it("renders the overview as a Components V2 card", async () => {
    const payload = await buildHelpPayload({
      registry,
      member: member(),
      config,
      prefix: "!",
    });
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const json = JSON.stringify(payload.components);
    expect(json).toContain("Siela Help");
    expect(json).toContain("Browse a category");
    expect(json).toContain("Popular");
  });

  it("renders a compact category view with every category command", async () => {
    const payload = await buildHelpPayload({
      registry,
      member: member(),
      config,
      prefix: "!",
      category: "music",
    });
    const json = JSON.stringify(payload.components);
    expect(json).toContain("Playback");
    expect(json).toContain("Queue");
    expect(json).toContain("`play`");
    expect(json).toContain("`queue`");
  });

  it("renders command usage and examples", async () => {
    const payload = await buildHelpPayload({
      registry,
      member: member(),
      config,
      prefix: "!",
      query: "play",
    });
    const json = JSON.stringify(payload.components);
    expect(json).toContain("Usage");
    expect(json).toContain("!play <query or url>");
    expect(json).toContain("!play lofi girl");
  });

  it("does not reveal admin commands when a non-admin asks for them", async () => {
    const payload = await buildHelpPayload({
      registry,
      member: member(),
      config,
      prefix: "!",
      query: "config",
    });
    const json = JSON.stringify(payload.components);
    expect(json).toContain("No match");
    expect(json).not.toContain("config description");
  });

  it("explains restricted categories instead of silently redirecting", async () => {
    const payload = await buildHelpPayload({
      registry,
      member: member(),
      config,
      prefix: "!",
      query: "admin",
    });
    const json = JSON.stringify(payload.components);
    expect(json).toContain("Restricted category");
    expect(json).not.toContain("config");
  });
});
