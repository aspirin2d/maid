import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as sqliteVec from "sqlite-vec";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

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

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || "sqlite.db";
const sqlite = new Database(SQLITE_DB_PATH);
sqliteVec.load(sqlite);

const db = drizzle({ client: sqlite });

// Initialize vector table for memories
function initVectorTable() {
  try {
    console.log("Initializing vec_memories table...");

    // Create virtual table for vector embeddings if it doesn't exist
    // Note: rowid is auto-generated, memory_id is TEXT reference to memory.id
    db.run(sql`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        memory_id TEXT,
        embedding FLOAT[1536],
        payload TEXT NOT NULL
      )
    `);

    // Create trigger to cleanup vectors when memory is deleted
    db.run(sql`
      CREATE TRIGGER IF NOT EXISTS cleanup_memory_vectors
      AFTER DELETE ON memory
      BEGIN
        DELETE FROM vec_memories WHERE memory_id = OLD.id;
      END;
    `);

    console.log("✅ vec_memories table initialized");
  } catch (error) {
    console.error("❌ Error initializing vector table:", error);
    throw error;
  }
}

console.log("Running migrations...");
migrate(db, { migrationsFolder: "./drizzle" });
console.log("✅ Migrations complete");

initVectorTable();
