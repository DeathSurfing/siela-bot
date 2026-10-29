import { eq, sql } from "drizzle-orm";
import { createRequire } from "node:module";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SQL } from "bun";
import * as schema from "./schema.js";

export type Database = BunSQLDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  client: SQL;
  close(): Promise<void>;
}

const require = createRequire(import.meta.url);

/**
 * Load the Bun SQL driver only when a database is actually opened. Tests run
 * under Node and import this module for its schema helpers; an eager import
 * of `drizzle-orm/bun-sql` would pull in the `bun` builtin and fail there.
 */
function loadDriver(): { drizzle: typeof import("drizzle-orm/bun-sql").drizzle; SQL: new (url: string) => SQL } {
  const driver = require("drizzle-orm/bun-sql") as typeof import("drizzle-orm/bun-sql");
  const bun = (globalThis as { Bun?: { SQL: new (url: string) => SQL } }).Bun;
  if (!bun?.SQL) throw new Error("createDatabase requires the Bun runtime");
  return { drizzle: driver.drizzle, SQL: bun.SQL };
}

export function createDatabase(url: string): DatabaseHandle {
  const { drizzle, SQL: BunSQL } = loadDriver();
  const client = new BunSQL(url);
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
  const { migrate } = require("drizzle-orm/bun-sql/migrator") as typeof import("drizzle-orm/bun-sql/migrator");
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
