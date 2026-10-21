import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  interactionCounters,
  interactionOptouts,
  type Database,
} from "@siela/db";
import type { CountersQuery, CountersReset, CounterPair, InteractionKind } from "@siela/shared";

export class CounterService {
  constructor(private readonly db: Database) {}

  async increment(
    guildId: string,
    actorId: string,
    targetId: string,
    kind: InteractionKind,
  ): Promise<number> {
    const [row] = await this.db
      .insert(interactionCounters)
      .values({ guildId, actorId, targetId, kind, count: 1 })
      .onConflictDoUpdate({
        target: [
          interactionCounters.guildId,
          interactionCounters.actorId,
          interactionCounters.targetId,
          interactionCounters.kind,
        ],
        set: {
          count: sql`${interactionCounters.count} + 1`,
          lastUsedAt: new Date(),
        },
      })
      .returning({ count: interactionCounters.count });
    return row?.count ?? 1;
  }

  async isOptedOut(guildId: string, userId: string, kind: InteractionKind): Promise<boolean> {
    const rows = await this.db
      .select({ kind: interactionOptouts.kind })
      .from(interactionOptouts)
      .where(
        and(
          eq(interactionOptouts.guildId, guildId),
          eq(interactionOptouts.userId, userId),
          inArray(interactionOptouts.kind, [kind, "*"]),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async optOut(guildId: string, userId: string, kind: InteractionKind | "*" = "*"): Promise<void> {
    await this.db
      .insert(interactionOptouts)
      .values({ guildId, userId, kind })
      .onConflictDoNothing();
  }

  async optIn(guildId: string, userId: string, kind: InteractionKind | "*" = "*"): Promise<void> {
    await this.db
      .delete(interactionOptouts)
      .where(
        and(
          eq(interactionOptouts.guildId, guildId),
          eq(interactionOptouts.userId, userId),
          eq(interactionOptouts.kind, kind),
        ),
      );
  }

  async pair(
    guildId: string,
    actorId: string,
    targetId: string,
    kind: InteractionKind,
  ): Promise<number> {
    const [row] = await this.db
      .select({ count: interactionCounters.count })
      .from(interactionCounters)
      .where(
        and(
          eq(interactionCounters.guildId, guildId),
          eq(interactionCounters.actorId, actorId),
          eq(interactionCounters.targetId, targetId),
          eq(interactionCounters.kind, kind),
        ),
      )
      .limit(1);
    return row?.count ?? 0;
  }

  async query(input: Omit<CountersQuery, "limit"> & { guildId: string; limit?: number }): Promise<CounterPair[]> {
    const conditions: SQL[] = [eq(interactionCounters.guildId, input.guildId)];
    if (input.userId) {
      conditions.push(
        or(
          eq(interactionCounters.actorId, input.userId),
          eq(interactionCounters.targetId, input.userId),
        )!,
      );
    }
    if (input.actorId) conditions.push(eq(interactionCounters.actorId, input.actorId));
    if (input.targetId) conditions.push(eq(interactionCounters.targetId, input.targetId));
    if (input.kind) conditions.push(eq(interactionCounters.kind, input.kind));
    const rows = await this.db
      .select()
      .from(interactionCounters)
      .where(and(...conditions))
      .orderBy(desc(interactionCounters.count))
      .limit(input.limit ?? 25);
    return rows.map((row) => ({
      actorId: row.actorId,
      targetId: row.targetId,
      kind: row.kind as InteractionKind,
      count: row.count,
    }));
  }

  async leaderboard(
    guildId: string,
    kind: InteractionKind | undefined,
    limit = 10,
  ): Promise<Array<{ userId: string; kind: InteractionKind; total: number }>> {
    const conditions: SQL[] = [eq(interactionCounters.guildId, guildId)];
    if (kind) conditions.push(eq(interactionCounters.kind, kind));
    const rows = await this.db
      .select({
        userId: interactionCounters.actorId,
        kind: interactionCounters.kind,
        total: sql<string>`sum(${interactionCounters.count})`,
      })
      .from(interactionCounters)
      .where(and(...conditions))
      .groupBy(interactionCounters.actorId, interactionCounters.kind)
      .orderBy(desc(sql`sum(${interactionCounters.count})`))
      .limit(limit);
    return rows.map((row) => ({
      userId: row.userId,
      kind: row.kind as InteractionKind,
      total: Number(row.total),
    }));
  }

  async reset(guildId: string, input: CountersReset): Promise<number> {
    const conditions: SQL[] = [eq(interactionCounters.guildId, guildId)];
    if (input.scope === "all") {
      // no additional filters
    } else if (input.scope === "kind") {
      if (!input.kind) throw new Error("kind is required for kind scope");
      conditions.push(eq(interactionCounters.kind, input.kind));
    } else if (input.scope === "pair") {
      if (!input.actorId || !input.targetId) throw new Error("actorId and targetId are required for pair scope");
      conditions.push(eq(interactionCounters.actorId, input.actorId));
      conditions.push(eq(interactionCounters.targetId, input.targetId));
      if (input.kind) conditions.push(eq(interactionCounters.kind, input.kind));
    } else if (input.scope === "user") {
      if (!input.userId) throw new Error("userId is required for user scope");
      conditions.push(
        or(
          eq(interactionCounters.actorId, input.userId),
          eq(interactionCounters.targetId, input.userId),
        )!,
      );
      if (input.kind) conditions.push(eq(interactionCounters.kind, input.kind));
    }
    const rows = await this.db
      .delete(interactionCounters)
      .where(and(...conditions))
      .returning({ id: interactionCounters.actorId });
    return rows.length;
  }

  async listOptouts(guildId: string): Promise<Array<{ userId: string; kind: string; createdAt: string }>> {
    const rows = await this.db
      .select()
      .from(interactionOptouts)
      .where(eq(interactionOptouts.guildId, guildId))
      .orderBy(desc(interactionOptouts.createdAt));
    return rows.map((row) => ({
      userId: row.userId,
      kind: row.kind,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async deleteUserData(guildId: string, userId: string): Promise<void> {
    await this.db
      .delete(interactionCounters)
      .where(
        and(
          eq(interactionCounters.guildId, guildId),
          or(eq(interactionCounters.actorId, userId), eq(interactionCounters.targetId, userId))!,
        ),
      );
    await this.db
      .delete(interactionOptouts)
      .where(and(eq(interactionOptouts.guildId, guildId), eq(interactionOptouts.userId, userId)));
  }
}
