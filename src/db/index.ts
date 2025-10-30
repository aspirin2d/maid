import "dotenv/config";

import * as sqliteVec from "sqlite-vec";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH ?? "sqlite.db";

if (process.platform === "darwin") {
  try {
    Database.setCustomSQLite(
      "/opt/homebrew/Cellar/sqlite/3.50.4/lib/libsqlite3.3.50.4.dylib",
    );
  } catch {}
}

const sqlite = new Database(SQLITE_DB_PATH);
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
export default db;
