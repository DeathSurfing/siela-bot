import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabase, runMigrations } from "@siela/db";
import { sleep } from "@siela/shared";
import { sql } from "drizzle-orm";

function findMigrationsFolder(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(process.cwd(), "packages/db/drizzle"),
    resolve(process.cwd(), "../../packages/db/drizzle"),
    resolve(process.cwd(), "../../../packages/db/drizzle"),
    "/app/packages/db/drizzle",
  ].filter((value): value is string => Boolean(value));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Migrations folder not found. Tried:\n${candidates.join("\n")}`);
  }
  return found;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const folder = findMigrationsFolder();
  const handle = createDatabase(url);
  let attempt = 0;
  let lastError: unknown;

  try {
    while (attempt < 30) {
      attempt += 1;
      try {
        await handle.db.execute(sql`select 1`);
        break;
      } catch (error) {
        lastError = error;
        console.log(`database not ready (attempt ${attempt}/30), retrying...`);
        await sleep(2_000);
      }
    }
    if (attempt >= 30) {
      throw lastError ?? new Error("database did not become ready");
    }
    console.log(`running migrations from ${folder}`);
    await runMigrations(handle, folder);
    console.log("migrations complete");
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
