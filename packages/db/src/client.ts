import { eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  client: postgres.Sql;
  close(): Promise<void>;
}

export function createDatabase(url: string): DatabaseHandle {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    async close() {
      await client.end({ timeout: 5 });
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
