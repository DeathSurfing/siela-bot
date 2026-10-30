import { describe, expect, it, vi } from "vitest";
import { PermissionsBitField } from "discord.js";
import { CahService } from "./service.js";

function member(id: string, displayName: string, administrator = false) {
  return {
    id,
    displayName,
    user: { bot: false },
    permissions: {
      has: (flag: unknown) => administrator && flag === PermissionsBitField.Flags.Administrator,
    },
  };
}

function createService() {
  const message = { edit: vi.fn(async () => message) };
  const channel = {
    id: "channel",
    guildId: "guild",
    isTextBased: () => true,
    send: vi.fn(async () => message),
  };
  const guild = {
    id: "guild",
    channels: { cache: new Map(), fetch: async () => channel },
    members: { fetch: async (id: string) => member(id, id) },
  };
  const client = {
    guilds: { cache: new Map([["guild", guild]]) },
    users: { fetch: async (id: string) => ({ id, username: id }) },
  };
  const service = new CahService(client as never, null);
  return { service, channel, guild, message };
}

async function hosted(pointsGoal = 7) {
  const context = createService();
  const host = member("host", "Host");
  const second = member("second", "Second");
  const third = member("third", "Third");
  await context.service.host({
    guild: context.guild as never,
    channel: context.channel as never,
    host: host as never,
    pointsGoal,
    maxPlayers: 5,
  });
  await context.service.join("guild", second as never);
  await context.service.join("guild", third as never);
  return { ...context, host, second, third };
}

describe("CahService snapshot", () => {
  it("keeps hands, decks, submission owners, and timers out of the judge view", async () => {
    const { service, host, second, third } = await hosted();
    const game = service.get("guild")!.game;
    await service.start("guild", host as never);
    await service.submit("guild", second.id, game.players.get(second.id)!.hand[0]!);
    await service.submit("guild", third.id, game.players.get(third.id)!.hand[0]!);

    const snapshot = service.snapshot("guild")!;
    expect(snapshot.status).toBe("active");
    expect(snapshot.phase).toBe("judge");
    expect(snapshot.players.map((player) => player.displayName).sort()).toEqual(["Host", "Second", "Third"]);
    expect(snapshot.slots).toHaveLength(2);
    expect(Object.keys(snapshot.slots[0]!)).toEqual(["slot", "card"]);
    expect(Object.keys(snapshot)).toEqual([
      "id", "channelId", "hostId", "hostName", "status", "phase", "pointsGoal", "maxPlayers",
      "players", "blackCard", "roundIndex", "judgeId", "judgeName", "submissionCount",
      "submissionExpected", "slots", "winnerSlot", "winnerId", "winnerName",
    ]);

    const serialized = JSON.stringify(snapshot.slots);
    expect(serialized).not.toContain(second.id);
    expect(serialized).not.toContain(third.id);
    expect(serialized).not.toContain("playerId");
    expect(serialized).not.toContain("hand");
    expect(serialized).not.toContain("deck");
    expect(serialized).not.toContain("timer");
    service.stop();
  });

  it("keeps submission owners out of the reveal view and names only the winner", async () => {
    const { service, host, second, third } = await hosted();
    const game = service.get("guild")!.game;
    await service.start("guild", host as never);
    await service.submit("guild", second.id, game.players.get(second.id)!.hand[0]!);
    await service.submit("guild", third.id, game.players.get(third.id)!.hand[0]!);
    await service.pick("guild", host.id, "1");

    const snapshot = service.snapshot("guild")!;
    expect(snapshot.phase).toBe("reveal");
    expect(snapshot.winnerSlot).toBe("1");
    expect(snapshot.winnerName).toBe("Second");
    expect(JSON.stringify(snapshot.slots)).not.toContain(second.id);
    expect(JSON.stringify(snapshot.slots)).not.toContain(third.id);
    service.stop();
  });

  it("detaches a game that reaches the points goal and keeps a redacted result", async () => {
    const { service, host, second, third } = await hosted(1);
    const game = service.get("guild")!.game;
    await service.start("guild", host as never);
    await service.submit("guild", second.id, game.players.get(second.id)!.hand[0]!);
    await service.submit("guild", third.id, game.players.get(third.id)!.hand[0]!);
    await service.pick("guild", host.id, "1");

    expect(service.get("guild")).toBeNull();
    const result = service.lastResult("guild")!;
    expect(result.status).toBe("finished");
    expect(result.winnerName).toBe("Second");
    expect(result.players.find((player) => player.id === second.id)?.score).toBe(1);
    service.stop();
  });
});
