import { eq } from "drizzle-orm";
import { guildFeatures, type Database } from "@siela/db";
import {
  FEATURES,
  getFeature,
  isFeatureId,
  type FeatureDefinition,
  type FeatureId,
} from "@siela/shared";
import { UserError } from "../lib/errors.js";

const DEFAULT_CACHE_TTL_MS = 30_000;

export interface FeatureStateRow {
  featureId: string;
  enabled: boolean;
}

export interface FeatureUpdate {
  featureId: string;
  enabled: boolean;
}

export interface FeatureState {
  featureId: FeatureId;
  enabled: boolean;
}

type FeatureWriter = Pick<Database, "insert">;

/**
 * Resolve catalog defaults plus stored overrides into a complete state map.
 * Rows for ids that are not in the catalog are ignored so a newer worker's
 * data cannot break an older one.
 */
export function resolveFeatureState(
  catalog: readonly FeatureDefinition[],
  rows: readonly FeatureStateRow[],
): Map<string, boolean> {
  const state = new Map<string, boolean>();
  for (const feature of catalog) {
    state.set(feature.id, feature.defaultEnabled);
  }
  for (const row of rows) {
    if (state.has(row.featureId)) state.set(row.featureId, row.enabled);
  }
  return state;
}

interface CacheEntry {
  state: Map<string, boolean>;
  expiresAt: number;
}

export class FeatureFlagService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly db: Database,
    private readonly cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  ) {}

  async isEnabled(guildId: string, featureId: FeatureId | string): Promise<boolean> {
    if (!isFeatureId(featureId)) return true;
    const state = await this.snapshot(guildId);
    return state?.get(featureId) ?? getFeature(featureId)?.defaultEnabled ?? true;
  }

  /** Feature ids this guild has turned off. Use for hiding commands. */
  async disabledIds(guildId: string): Promise<Set<string>> {
    const state = await this.snapshot(guildId);
    const disabled = new Set<string>();
    for (const feature of FEATURES) {
      if (!(state?.get(feature.id) ?? feature.defaultEnabled)) disabled.add(feature.id);
    }
    return disabled;
  }

  async list(guildId: string): Promise<Array<FeatureDefinition & { enabled: boolean }>> {
    const state = await this.snapshot(guildId);
    return FEATURES.map((feature) => ({
      ...feature,
      enabled: state?.get(feature.id) ?? feature.defaultEnabled,
    }));
  }

  async set(
    guildId: string,
    featureId: FeatureId | string,
    enabled: boolean,
    actorId?: string,
  ): Promise<FeatureState> {
    const id = this.assertFeatureId(featureId);
    await this.write(this.db, guildId, id, enabled, actorId);
    this.invalidate(guildId);
    return { featureId: id, enabled };
  }

  async setMany(
    guildId: string,
    updates: readonly FeatureUpdate[],
    actorId?: string,
  ): Promise<FeatureState[]> {
    const validated = updates.map((update) => ({
      featureId: this.assertFeatureId(update.featureId),
      enabled: update.enabled,
    }));

    const transactional = typeof (this.db as { transaction?: unknown }).transaction === "function";
    if (transactional) {
      await this.db.transaction(async (tx) => {
        for (const update of validated) {
          await this.write(tx as unknown as FeatureWriter, guildId, update.featureId, update.enabled, actorId);
        }
      });
    } else {
      for (const update of validated) {
        await this.write(this.db, guildId, update.featureId, update.enabled, actorId);
      }
    }

    this.invalidate(guildId);
    return validated;
  }

  async snapshot(guildId: string): Promise<Map<string, boolean> | null> {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.state;

    const rows = await this.db
      .select({ featureId: guildFeatures.featureId, enabled: guildFeatures.enabled })
      .from(guildFeatures)
      .where(eq(guildFeatures.guildId, guildId));

    const state = resolveFeatureState(FEATURES, rows);
    this.cache.set(guildId, { state, expiresAt: Date.now() + this.cacheTtlMs });
    return state;
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  async ensureRows(guildId: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(guildFeatures)
      .values(
        FEATURES.map((feature) => ({
          guildId,
          featureId: feature.id,
          enabled: feature.defaultEnabled,
          updatedAt: now,
          updatedBy: null,
        })),
      )
      .onConflictDoNothing();
    this.invalidate(guildId);
  }

  async enabledMap(guildId: string): Promise<Record<string, boolean>> {
    const state = await this.snapshot(guildId);
    const map: Record<string, boolean> = {};
    for (const feature of FEATURES) {
      map[feature.id] = state?.get(feature.id) ?? feature.defaultEnabled;
    }
    return map;
  }

  private assertFeatureId(featureId: string): FeatureId {
    if (!isFeatureId(featureId)) {
      throw new UserError(`Unknown feature: ${featureId}`, "unknown_feature");
    }
    return featureId;
  }

  private async write(
    db: FeatureWriter,
    guildId: string,
    featureId: FeatureId,
    enabled: boolean,
    actorId?: string,
  ): Promise<void> {
    const now = new Date();
    await db
      .insert(guildFeatures)
      .values({
        guildId,
        featureId,
        enabled,
        updatedAt: now,
        updatedBy: actorId ?? null,
      })
      .onConflictDoUpdate({
        target: [guildFeatures.guildId, guildFeatures.featureId],
        set: {
          enabled,
          updatedAt: now,
          updatedBy: actorId ?? null,
        },
      });
  }
}
