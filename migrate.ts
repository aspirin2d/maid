import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { sql } from "drizzle-orm";

import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite(
      "/opt/homebrew/Cellar/sqlite/3.50.4/lib/libsqlite3.3.50.4.dylib",
    );
  } catch {}
}

const sqlite = new Database("sqlite.db");

// Initialize vector table for memories
export function initVectorTable() {
  try {
    // Create virtual table for vector embeddings
    // Using 4096 dimensions for qwen3-embedding model
    db.run(sql`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        memory_id INTEGER PRIMARY KEY,
        embedding FLOAT[4096]
      )
    `);
    db.run(sql`
      CREATE TRIGGER IF NOT EXISTS cleanup_memory_vectors
      AFTER DELETE ON memories
      BEGIN
        DELETE FROM vec_memories WHERE memory_id = OLD.id;
      END;
    `);
  } catch (error) {
    console.error("error initializing vector table:", error);
    throw error;
  }
}

const db = drizzle(sqlite);
migrate(db, { migrationsFolder: "./drizzle" });
