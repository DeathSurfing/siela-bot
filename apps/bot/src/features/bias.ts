import { and, eq } from "drizzle-orm";
import { userBiases, type Database, type UserBiasRow } from "@siela/db";

export class BiasService {
  constructor(private readonly db: Database) {}

  async get(guildId: string, userId: string): Promise<UserBiasRow | null> {
    const [row] = await this.db
      .select()
      .from(userBiases)
      .where(and(eq(userBiases.guildId, guildId), eq(userBiases.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async set(guildId: string, userId: string, bias: string, biasWrecker: string): Promise<UserBiasRow> {
    const [row] = await this.db
      .insert(userBiases)
      .values({ guildId, userId, bias, biasWrecker })
      .onConflictDoUpdate({
        target: [userBiases.guildId, userBiases.userId],
        set: { bias, biasWrecker, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Failed to save bias");
    return row;
  }

  async clear(guildId: string, userId: string): Promise<void> {
    await this.db
      .delete(userBiases)
      .where(and(eq(userBiases.guildId, guildId), eq(userBiases.userId, userId)));
  }
}
