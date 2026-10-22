import { eq, sql } from "drizzle-orm";
import { drizzle, type BunSQLDatabase } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { SQL } from "bun";
import * as schema from "./schema.js";

export type Database = BunSQLDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  client: SQL;
  close(): Promise<void>;
}

export function createDatabase(url: string): DatabaseHandle {
  const client = new SQL(url);
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    async close() {
      client.close();
    },
  };
}

export async function runMigrations(handle: DatabaseHandle, migrationsFolder: string): Promise<void> {
  await migrate(handle.db, { migrationsFolder });
}

export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function ensureGuild(db: Database, guildId: string): Promise<void> {
  await db
    .insert(schema.guildSettings)
    .values({ guildId })
    .onConflictDoNothing({ target: schema.guildSettings.guildId });
  await db
    .insert(schema.welcomeSettings)
    .values({ guildId })
    .onConflictDoNothing({ target: schema.welcomeSettings.guildId });
  await db
    .insert(schema.autoroleSettings)
    .values({ guildId })
    .onConflictDoNothing({ target: schema.autoroleSettings.guildId });
  await db
    .insert(schema.tempvcSettings)
    .values({ guildId })
    .onConflictDoNothing({ target: schema.tempvcSettings.guildId });
  await db
    .insert(schema.musicSettings)
    .values({ guildId })
    .onConflictDoNothing({ target: schema.musicSettings.guildId });
}

export async function deleteGuild(db: Database, guildId: string): Promise<void> {
  await db.delete(schema.guildSettings).where(eq(schema.guildSettings.guildId, guildId));
}
