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
