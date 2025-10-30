import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as sqliteVec from "sqlite-vec";

if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite(
      "/opt/homebrew/Cellar/sqlite/3.50.4/lib/libsqlite3.3.50.4.dylib",
    );
  } catch {}
}

const sqlite = new Database(process.env.SQLITE_DB_PATH!);
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
