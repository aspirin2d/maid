import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync } from "node:fs";
import { sql } from "drizzle-orm";

const dbPath = join(tmpdir(), `maid-debug-${process.pid}.sqlite`);
if (existsSync(dbPath)) {
  unlinkSync(dbPath);
}
process.env.SQLITE_DB_PATH = dbPath;

const dbModule = await import("./src/db/index");
const { default: db } = dbModule;

await import("./migrate.ts");

try {
  db.run(sql`DELETE FROM user`);
  console.log("delete succeeded");
} catch (error) {
  console.error("delete failed", error);
}
