import { PermissionFlagsBits } from "discord.js";
import type { Guild, GuildBasedChannel, GuildMember } from "discord.js";
import type { BotConfig } from "@siela/config";
import { describe, expect, it } from "vitest";
import {
  canManageMusic,
  canManageTempVc,
  hasBotPermissions,
  hasUserPermissions,
  isAdmin,
  isNsfwChannel,
} from "./permissions.js";

function config(overrides: Partial<{ botOwnerId: string; adminRoleIds: string[] }> = {}) {
  return {
    botOwnerId: null,
    adminRoleIds: [],
    ...overrides,
  } as unknown as BotConfig;
}

function guild(options: { ownerId?: string; botPermissions?: bigint[]; hasBot?: boolean } = {}) {
  return {
    ownerId: options.ownerId ?? "owner",
    members: {
      me: options.hasBot === false
        ? null
        : {
            permissions: {
              has: (permission: bigint) => (options.botPermissions ?? []).includes(permission),
            },
          },
    },
  } as unknown as Guild;
}

function member(options: {
  id?: string;
  permissions?: bigint[];
  roles?: string[];
  guild?: Guild;
} = {}) {
  return {
    id: options.id ?? "member",
    permissions: {
      has: (permission: bigint) => (options.permissions ?? []).includes(permission),
    },
    roles: {
      cache: {
        has: (roleId: string) => (options.roles ?? []).includes(roleId),
      },
    },
    guild: options.guild ?? guild(),
  } as unknown as GuildMember;
}

describe("isAdmin", () => {
  it("accepts the configured bot owner", () => {
    expect(isAdmin(member({ id: "bot-owner" }), config({ botOwnerId: "bot-owner" }), guild())).toBe(
      true,
    );
  });

  it("accepts the guild owner", () => {
    expect(isAdmin(member({ id: "owner" }), config(), guild({ ownerId: "owner" }))).toBe(true);
  });

  it("accepts Manage Guild", () => {
    expect(
      isAdmin(
        member({ permissions: [PermissionFlagsBits.ManageGuild] }),
        config(),
        guild(),
      ),
    ).toBe(true);
  });

  it("accepts a configured admin role", () => {
    expect(
      isAdmin(member({ roles: ["admin-role"] }), config({ adminRoleIds: ["admin-role"] }), guild()),
    ).toBe(true);
  });

  it("rejects a regular member", () => {
    expect(isAdmin(member(), config(), guild())).toBe(false);
  });
});

describe("permission helpers", () => {
  it("requires every user permission", () => {
    const permissions = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageGuild];
    expect(hasUserPermissions(member({ permissions }), permissions)).toBe(true);
    expect(hasUserPermissions(member({ permissions: [permissions[0]!] }), permissions)).toBe(
      false,
    );
  });

  it("fails bot permission checks when the member is missing", () => {
    expect(hasBotPermissions(guild({ hasBot: false }), [])).toBe(false);
    expect(
      hasBotPermissions(guild({ botPermissions: [PermissionFlagsBits.ManageRoles] }), [
        PermissionFlagsBits.ManageRoles,
      ]),
    ).toBe(true);
  });

  it("reads NSFW from channels and thread parents", () => {
    expect(isNsfwChannel({ nsfw: true } as unknown as GuildBasedChannel)).toBe(true);
    expect(isNsfwChannel({ nsfw: false } as unknown as GuildBasedChannel)).toBe(false);
    expect(
      isNsfwChannel({
        isThread: () => true,
        parent: { nsfw: true },
      } as unknown as GuildBasedChannel),
    ).toBe(true);
    expect(
      isNsfwChannel({ isThread: () => false } as unknown as GuildBasedChannel),
    ).toBe(false);
  });
});

describe("management gates", () => {
  it("allows temp VC owners and admins", () => {
    const regular = member({ id: "regular" });
    expect(canManageTempVc(regular, "regular", config())).toBe(true);
    expect(canManageTempVc(regular, "someone-else", config())).toBe(false);
    expect(
      canManageTempVc(
        member({ roles: ["admin-role"] }),
        "someone-else",
        config({ adminRoleIds: ["admin-role"] }),
      ),
    ).toBe(true);
  });

  it("opens music control when no DJ roles are configured", () => {
    expect(canManageMusic(member(), [], config())).toBe(true);
  });

  it("requires a DJ role when configured", () => {
    expect(canManageMusic(member(), ["dj"], config())).toBe(false);
    expect(canManageMusic(member({ roles: ["dj"] }), ["dj"], config())).toBe(true);
  });

  it("lets admins bypass the DJ role", () => {
    expect(
      canManageMusic(
        member({ permissions: [PermissionFlagsBits.ManageGuild] }),
        ["dj"],
        config(),
      ),
    ).toBe(true);
  });
});
