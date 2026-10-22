import { and, eq, or } from "drizzle-orm";
import { familyChildren, familyMarriages, type Database } from "@siela/db";
import type { Logger } from "../lib/logger.js";
import { UserError } from "../lib/errors.js";

export interface FamilyNode {
  id: string;
}

export interface FamilyEdge {
  from: string;
  to: string;
  type: "marriage" | "parent";
}

export interface FamilyTree {
  nodes: string[];
  edges: FamilyEdge[];
  truncated: boolean;
}

export class FamilyService {
  constructor(private readonly db: Database, private readonly logger: Logger) {}

  private normalizePair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  async getActiveMarriage(guildId: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(familyMarriages)
      .where(
        and(
          eq(familyMarriages.guildId, guildId),
          eq(familyMarriages.status, "active"),
          or(eq(familyMarriages.spouseA, userId), eq(familyMarriages.spouseB, userId)),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async marry(guildId: string, firstUserId: string, secondUserId: string): Promise<void> {
    if (firstUserId === secondUserId) throw new UserError("You cannot marry yourself.");
    const existingA = await this.getActiveMarriage(guildId, firstUserId);
    const existingB = await this.getActiveMarriage(guildId, secondUserId);
    if (existingA) throw new UserError("You are already married.");
    if (existingB) throw new UserError("That member is already married.");
    const [spouseA, spouseB] = this.normalizePair(firstUserId, secondUserId);
    await this.db.insert(familyMarriages).values({ guildId, spouseA, spouseB });
  }

  async divorce(guildId: string, userId: string): Promise<string> {
    const marriage = await this.getActiveMarriage(guildId, userId);
    if (!marriage) throw new UserError("You are not currently married.");
    const spouse = marriage.spouseA === userId ? marriage.spouseB : marriage.spouseA;
    await this.db
      .update(familyMarriages)
      .set({ status: "divorced", divorcedAt: new Date(), divorcedBy: userId })
      .where(eq(familyMarriages.id, marriage.id));
    return spouse;
  }

  async hasActiveParentChild(guildId: string, parentId: string, childId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: familyChildren.id })
      .from(familyChildren)
      .where(
        and(
          eq(familyChildren.guildId, guildId),
          eq(familyChildren.parentId, parentId),
          eq(familyChildren.childId, childId),
          eq(familyChildren.status, "active"),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  private async descendantsOf(guildId: string, userId: string): Promise<Set<string>> {
    const result = new Set<string>();
    const queue = [userId];
    while (queue.length) {
      const current = queue.shift()!;
      const rows = await this.db
        .select({ childId: familyChildren.childId })
        .from(familyChildren)
        .where(
          and(
            eq(familyChildren.guildId, guildId),
            eq(familyChildren.parentId, current),
            eq(familyChildren.status, "active"),
          ),
        );
      for (const row of rows) {
        if (!result.has(row.childId)) {
          result.add(row.childId);
          queue.push(row.childId);
        }
      }
    }
    return result;
  }

  async adopt(guildId: string, parentId: string, childId: string): Promise<void> {
    if (parentId === childId) throw new UserError("You cannot adopt yourself.");
    if (await this.hasActiveParentChild(guildId, parentId, childId)) {
      throw new UserError("That adoption already exists.");
    }
    const descendants = await this.descendantsOf(guildId, childId);
    if (descendants.has(parentId)) {
      throw new UserError("That would create a family cycle.");
    }
    await this.db.insert(familyChildren).values({ guildId, parentId, childId });
  }

  async runaway(guildId: string, actorId: string, targetId?: string): Promise<number> {
    if (!targetId) {
      const result = await this.db
        .update(familyChildren)
        .set({ status: "runaway", endedAt: new Date(), endedBy: actorId })
        .where(
          and(
            eq(familyChildren.guildId, guildId),
            eq(familyChildren.childId, actorId),
            eq(familyChildren.status, "active"),
          ),
        )
        .returning({ id: familyChildren.id });
      return result.length;
    }

    const asParent = await this.db
      .update(familyChildren)
      .set({ status: "runaway", endedAt: new Date(), endedBy: actorId })
      .where(
        and(
          eq(familyChildren.guildId, guildId),
          eq(familyChildren.parentId, actorId),
          eq(familyChildren.childId, targetId),
          eq(familyChildren.status, "active"),
        ),
      )
      .returning({ id: familyChildren.id });
    if (asParent.length) return asParent.length;

    const asChild = await this.db
      .update(familyChildren)
      .set({ status: "runaway", endedAt: new Date(), endedBy: actorId })
      .where(
        and(
          eq(familyChildren.guildId, guildId),
          eq(familyChildren.childId, actorId),
          eq(familyChildren.parentId, targetId),
          eq(familyChildren.status, "active"),
        ),
      )
      .returning({ id: familyChildren.id });
    if (asChild.length) return asChild.length;

    throw new UserError("There is no matching family relationship to remove.");
  }

  async buildTree(guildId: string, rootUserId: string, maxNodes = 45): Promise<FamilyTree> {
    const nodes = new Set<string>([rootUserId]);
    const edges: FamilyEdge[] = [];
    const edgeKeys = new Set<string>();
    const queue: Array<{ userId: string; depth: number }> = [{ userId: rootUserId, depth: 0 }];
    const visited = new Set<string>([rootUserId]);
    let truncated = false;

    const addEdge = (edge: FamilyEdge) => {
      const key = `${edge.type}:${edge.from}:${edge.to}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push(edge);
    };

    while (queue.length) {
      const current = queue.shift()!;
      if (current.depth >= 3) continue;

      const marriages = await this.db
        .select()
        .from(familyMarriages)
        .where(
          and(
            eq(familyMarriages.guildId, guildId),
            eq(familyMarriages.status, "active"),
            or(eq(familyMarriages.spouseA, current.userId), eq(familyMarriages.spouseB, current.userId)),
          ),
        );
      for (const marriage of marriages) {
        const spouse = marriage.spouseA === current.userId ? marriage.spouseB : marriage.spouseA;
        addEdge({ from: marriage.spouseA, to: marriage.spouseB, type: "marriage" });
        if (!nodes.has(spouse)) {
          if (nodes.size >= maxNodes) {
            truncated = true;
            continue;
          }
          nodes.add(spouse);
          visited.add(spouse);
          queue.push({ userId: spouse, depth: current.depth + 1 });
        }
      }

      const asParent = await this.db
        .select({ childId: familyChildren.childId })
        .from(familyChildren)
        .where(
          and(
            eq(familyChildren.guildId, guildId),
            eq(familyChildren.parentId, current.userId),
            eq(familyChildren.status, "active"),
          ),
        );
      for (const row of asParent) {
        addEdge({ from: current.userId, to: row.childId, type: "parent" });
        if (!nodes.has(row.childId)) {
          if (nodes.size >= maxNodes) {
            truncated = true;
            continue;
          }
          nodes.add(row.childId);
          visited.add(row.childId);
          queue.push({ userId: row.childId, depth: current.depth + 1 });
        }
      }

      const asChild = await this.db
        .select({ parentId: familyChildren.parentId })
        .from(familyChildren)
        .where(
          and(
            eq(familyChildren.guildId, guildId),
            eq(familyChildren.childId, current.userId),
            eq(familyChildren.status, "active"),
          ),
        );
      for (const row of asChild) {
        addEdge({ from: row.parentId, to: current.userId, type: "parent" });
        if (!nodes.has(row.parentId)) {
          if (nodes.size >= maxNodes) {
            truncated = true;
            continue;
          }
          nodes.add(row.parentId);
          visited.add(row.parentId);
          queue.push({ userId: row.parentId, depth: current.depth + 1 });
        }
      }
    }

    return { nodes: [...nodes], edges, truncated };
  }
}
