import { describe, expect, it } from "vitest";
import type { Database } from "@siela/db";
import { FEATURES } from "@siela/shared";
import { FeatureFlagService, resolveFeatureState } from "./features.js";

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";

interface FakeRow {
  guildId: string;
  featureId: string;
  enabled: boolean;
  updatedBy: string | null;
}

interface FakeWrite {
  guildId: string;
  featureId: string;
  enabled: boolean;
  updatedAt?: Date;
  updatedBy?: string | null;
}

/**
 * Minimal stand-in for the Drizzle query builder used by FeatureFlagService.
 * The service only calls select().from().where(eq(...)) and
 * insert().values().onConflictDo{Update,Nothing}(), so this fake mirrors exactly
 * that chain and records what was written.
 */
function makeDb({ withTransaction = true } = {}) {
  const rows: FakeRow[] = [];
  const writes: FakeWrite[] = [];
  const counters = { selects: 0, upserts: 0, transactions: 0 };

  const db: Record<string, unknown> = {
    select() {
      return {
        from() {
          return {
            where(condition: unknown) {
              counters.selects += 1;
              const guildId = guildIdFromCondition(condition);
              return Promise.resolve(
                rows
                  .filter((row) => row.guildId === guildId)
                  .map((row) => ({ featureId: row.featureId, enabled: row.enabled })),
              );
            },
          };
        },
      };
    },
    insert() {
      return {
        values(values: FakeWrite | FakeWrite[]) {
          const list = Array.isArray(values) ? values : [values];
          writes.push(...list.map((value) => ({ ...value })));
          return {
            onConflictDoUpdate({ set }: { set: Partial<FakeRow> }) {
              counters.upserts += 1;
              for (const value of list) {
                const existing = rows.find(
                  (row) => row.guildId === value.guildId && row.featureId === value.featureId,
                );
                if (existing) Object.assign(existing, set);
                else
                  rows.push({
                    guildId: value.guildId,
                    featureId: value.featureId,
                    enabled: value.enabled,
                    updatedBy: value.updatedBy ?? null,
                  });
              }
              return Promise.resolve();
            },
            onConflictDoNothing() {
              for (const value of list) {
                const existing = rows.some(
                  (row) => row.guildId === value.guildId && row.featureId === value.featureId,
                );
                if (!existing)
                  rows.push({
                    guildId: value.guildId,
                    featureId: value.featureId,
                    enabled: value.enabled,
                    updatedBy: value.updatedBy ?? null,
                  });
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  if (withTransaction) {
    db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
      counters.transactions += 1;
      return fn(db);
    };
  }

  return { db: db as unknown as Database, rows, writes, counters };
}

function guildIdFromCondition(condition: unknown): string {
  const chunks = (condition as { queryChunks?: readonly unknown[] }).queryChunks ?? [];
  for (const chunk of chunks) {
    const value = (chunk as { value?: unknown }).value;
    if (typeof value === "string") return value;
  }
  throw new Error("fake db: could not read a guild id from the where clause");
}

describe("resolveFeatureState", () => {
  it("fills catalog defaults and applies overrides", () => {
    const state = resolveFeatureState(FEATURES, [
      { featureId: "relics", enabled: false },
      { featureId: "voice-tts", enabled: false },
    ]);
    expect(state.get("relics")).toBe(false);
    expect(state.get("voice-tts")).toBe(false);
    expect(state.get("music-playback")).toBe(true);
    expect([...state.keys()]).toEqual(FEATURES.map((feature) => feature.id));
  });

  it("returns all defaults for an empty row set", () => {
    const state = resolveFeatureState(FEATURES, []);
    expect(state.size).toBe(FEATURES.length);
    for (const feature of FEATURES) expect(state.get(feature.id)).toBe(true);
  });

  it("ignores rows for features that are not in the catalog", () => {
    const state = resolveFeatureState(FEATURES, [{ featureId: "from-the-future", enabled: false }]);
    expect(state.has("from-the-future")).toBe(false);
    expect(state.size).toBe(FEATURES.length);
  });
});

describe("FeatureFlagService", () => {
  it("defaults every catalog feature to enabled", async () => {
    const { db, counters } = makeDb();
    const service = new FeatureFlagService(db);

    expect(await service.isEnabled(GUILD_A, "relics")).toBe(true);
    expect(await service.isEnabled(GUILD_A, "automation-random-drops")).toBe(true);

    const list = await service.list(GUILD_A);
    expect(list).toHaveLength(FEATURES.length);
    expect(list.map((feature) => feature.id)).toEqual(FEATURES.map((feature) => feature.id));
    expect(list.every((feature) => feature.enabled)).toBe(true);
    expect(counters.selects).toBe(1);
  });

  it("reports the disabled id set for command hiding", async () => {
    const { db, rows } = makeDb();
    rows.push({ guildId: GUILD_A, featureId: "relics", enabled: false, updatedBy: null });
    rows.push({ guildId: GUILD_A, featureId: "voice-tempvc", enabled: false, updatedBy: null });
    const service = new FeatureFlagService(db);

    const disabled = await service.disabledIds(GUILD_A);
    expect([...disabled].sort()).toEqual(["relics", "voice-tempvc"]);
    expect(await service.disabledIds(GUILD_B)).toEqual(new Set());
  });

  it("honours an explicit off override", async () => {
    const { db, rows } = makeDb();
    rows.push({ guildId: GUILD_A, featureId: "relics", enabled: false, updatedBy: null });
    const service = new FeatureFlagService(db);

    expect(await service.isEnabled(GUILD_A, "relics")).toBe(false);
    expect(await service.isEnabled(GUILD_A, "music-playback")).toBe(true);

    const list = await service.list(GUILD_A);
    expect(list.find((feature) => feature.id === "relics")?.enabled).toBe(false);

    const map = await service.enabledMap(GUILD_A);
    expect(map.relics).toBe(false);
    expect(map["music-playback"]).toBe(true);
  });

  it("is permissive for unknown ids but rejects them on write", async () => {
    const { db, writes, counters } = makeDb();
    const service = new FeatureFlagService(db);

    expect(await service.isEnabled(GUILD_A, "does-not-exist")).toBe(true);
    expect(counters.selects).toBe(0);

    await expect(service.set(GUILD_A, "does-not-exist", false)).rejects.toMatchObject({
      name: "UserError",
      code: "unknown_feature",
    });
    expect(writes).toHaveLength(0);
  });

  it("keeps cache and writes isolated per guild", async () => {
    const { db, rows, counters } = makeDb();
    const service = new FeatureFlagService(db);

    await service.set(GUILD_A, "relics", false);

    expect(await service.isEnabled(GUILD_A, "relics")).toBe(false);
    expect(await service.isEnabled(GUILD_B, "relics")).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.guildId).toBe(GUILD_A);

    await service.isEnabled(GUILD_A, "relics");
    await service.isEnabled(GUILD_B, "relics");
    const selectsBefore = counters.selects;

    await service.set(GUILD_A, "voice-tts", false);
    await service.isEnabled(GUILD_B, "relics");
    expect(counters.selects).toBe(selectsBefore);
    await service.isEnabled(GUILD_A, "relics");
    expect(counters.selects).toBe(selectsBefore + 1);
  });

  it("invalidates the cached view after a write", async () => {
    const { db, counters } = makeDb();
    const service = new FeatureFlagService(db);

    expect(await service.isEnabled(GUILD_A, "relics")).toBe(true);
    expect(await service.isEnabled(GUILD_A, "relics")).toBe(true);
    expect(counters.selects).toBe(1);

    await service.set(GUILD_A, "relics", false, "actor-1");
    expect(counters.selects).toBe(1);

    expect(await service.isEnabled(GUILD_A, "relics")).toBe(false);
    expect(counters.selects).toBe(2);
  });

  it("can run without caching when the TTL is zero", async () => {
    const { db, counters } = makeDb();
    const service = new FeatureFlagService(db, 0);

    await service.isEnabled(GUILD_A, "relics");
    await service.isEnabled(GUILD_A, "relics");
    expect(counters.selects).toBe(2);
  });

  it("upserts instead of duplicating rows when a feature is set twice", async () => {
    const { db, rows, counters } = makeDb();
    const service = new FeatureFlagService(db);

    expect(await service.set(GUILD_A, "relics", false, "actor-1")).toEqual({
      featureId: "relics",
      enabled: false,
    });
    expect(await service.set(GUILD_A, "relics", true, "actor-2")).toEqual({
      featureId: "relics",
      enabled: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
    expect(rows[0]?.updatedBy).toBe("actor-2");
    expect(counters.upserts).toBe(2);
  });

  it("validates every id in setMany before writing anything", async () => {
    const { db, writes, counters } = makeDb();
    const service = new FeatureFlagService(db);

    await expect(
      service.setMany(GUILD_A, [
        { featureId: "relics", enabled: false },
        { featureId: "bogus", enabled: true },
      ]),
    ).rejects.toMatchObject({ name: "UserError", code: "unknown_feature" });

    expect(writes).toHaveLength(0);
    expect(counters.upserts).toBe(0);
    expect(counters.transactions).toBe(0);
  });

  it("writes a valid setMany batch in one transaction", async () => {
    const { db, rows, counters } = makeDb();
    const service = new FeatureFlagService(db);

    const result = await service.setMany(
      GUILD_A,
      [
        { featureId: "relics", enabled: false },
        { featureId: "music-playback", enabled: false },
      ],
      "actor-1",
    );

    expect(result).toEqual([
      { featureId: "relics", enabled: false },
      { featureId: "music-playback", enabled: false },
    ]);
    expect(counters.transactions).toBe(1);
    expect(counters.upserts).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.featureId === "relics")?.updatedBy).toBe("actor-1");
    expect(await service.isEnabled(GUILD_A, "relics")).toBe(false);
  });

  it("falls back to sequential upserts when the handle has no transaction", async () => {
    const { db, rows, counters } = makeDb({ withTransaction: false });
    const service = new FeatureFlagService(db);

    await service.setMany(GUILD_A, [
      { featureId: "relics", enabled: false },
      { featureId: "voice-tts", enabled: false },
    ]);

    expect(counters.transactions).toBe(0);
    expect(counters.upserts).toBe(2);
    expect(rows).toHaveLength(2);
  });

  it("ensureRows writes a default row per feature without overwriting overrides", async () => {
    const { db, rows, writes } = makeDb();
    rows.push({ guildId: GUILD_A, featureId: "relics", enabled: false, updatedBy: null });
    const service = new FeatureFlagService(db);

    await service.ensureRows(GUILD_A);

    expect(writes).toHaveLength(FEATURES.length);
    expect(rows).toHaveLength(FEATURES.length);
    expect(rows.find((row) => row.featureId === "relics")?.enabled).toBe(false);
    expect(rows.find((row) => row.featureId === "music-playback")?.enabled).toBe(true);
  });
});
