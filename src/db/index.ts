import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH ?? "sqlite.db";

/**
 * Attempt to configure a custom SQLite library on macOS for sqlite-vec compatibility.
 * Tries multiple strategies in order:
 * 1. Environment variable SQLITE_LIBRARY_PATH
 * 2. Latest version in Homebrew Cellar
 * 3. Silently continue with system default if not found
 */
function setupCustomSQLite(): void {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    // Strategy 1: Check for explicit override via environment variable
    const customPath = process.env.SQLITE_LIBRARY_PATH;
    if (customPath && existsSync(customPath)) {
      Database.setCustomSQLite(customPath);
      console.log(`Using custom SQLite library: ${customPath}`);
      return;
    }

    // Strategy 2: Find latest version in Homebrew Cellar
    const homebrewBase = "/opt/homebrew/Cellar/sqlite";
    if (existsSync(homebrewBase)) {
      const versions = readdirSync(homebrewBase).sort().reverse();
      for (const version of versions) {
        const libDir = join(homebrewBase, version, "lib");
        if (existsSync(libDir)) {
          const libs = readdirSync(libDir).filter((f) =>
            f.startsWith("libsqlite3") && f.endsWith(".dylib")
          );
          if (libs.length > 0) {
            const libPath = join(libDir, libs[0]!);
            Database.setCustomSQLite(libPath);
            console.log(`Using Homebrew SQLite ${version}: ${libPath}`);
            return;
          }
        }
      }
    }

    // Strategy 3: Silently continue with Bun's default SQLite
    console.log("Using Bun's default SQLite library");
  } catch (error) {
    // Silently continue - Bun's default SQLite should work
    console.warn("Could not set custom SQLite library, using default:", error);
  }
}

setupCustomSQLite();

type DrizzleClient = ReturnType<typeof drizzle>;

export interface DbHandle {
  sqlite: Database;
  db: DrizzleClient;
  close: () => void;
}

export function createDb(filePath: string = SQLITE_DB_PATH): DbHandle {
  const sqlite = new Database(filePath);
  sqliteVec.load(sqlite);

  // Enable foreign key constraints (required for CASCADE deletes)
  sqlite.run("PRAGMA foreign_keys = ON;");

  const { sqlite_version, vec_version } = sqlite
    .prepare(
      "select sqlite_version() as sqlite_version, vec_version() as vec_version;",
    )
    .get() as { sqlite_version: string; vec_version: string };

  console.log(
    `platform:${process.platform}, sqlite:${sqlite_version}, vec:${vec_version}`,
  );

  const db = drizzle({ client: sqlite });

  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      sqlite.close();
    } catch (error) {
      if (error instanceof Error && error.message.includes("closed")) {
        return;
      }
      throw error;
    }
  };

  return { sqlite, db, close };
}

const defaultHandle = createDb();

export type DbClient = typeof defaultHandle.db;

export const sqlite = defaultHandle.sqlite;
export default defaultHandle.db;
