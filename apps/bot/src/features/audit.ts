import { desc, eq, lt } from "drizzle-orm";
import { auditLog, type Database } from "@siela/db";
import type { AuditEntry } from "@siela/shared";
import type { Logger } from "../lib/logger.js";

export interface AuditInput {
  guildId: string;
  actorId?: string | null;
  actorType?: "user" | "mcp" | "system";
  source?: "discord" | "mcp" | "control" | "system";
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

export class AuditService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async log(input: AuditInput): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        guildId: input.guildId,
        actorId: input.actorId ?? null,
        actorType: input.actorType ?? "system",
        source: input.source ?? "system",
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        requestId: input.requestId ?? null,
      });
    } catch (error) {
      this.logger.error({ err: error, action: input.action }, "failed to write audit log");
    }
  }

  async tail(guildId: string, limit = 25): Promise<AuditEntry[]> {
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.guildId, guildId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: String(row.id),
      guildId: row.guildId,
      actorId: row.actorId,
      actorType: row.actorType as AuditEntry["actorType"],
      source: row.source as AuditEntry["source"],
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      before: row.before,
      after: row.after,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async purge(guildId: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const result = await this.db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, cutoff))
      .returning({ id: auditLog.id });
    return result.length;
  }
}
