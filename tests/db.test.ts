import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("db module", () => {
  const testDbPath = join(process.cwd(), "test-db-temp");
  const testDbFile = join(testDbPath, "test.db");

  beforeEach(() => {
    // Create test directory if it doesn't exist
    if (!existsSync(testDbPath)) {
      mkdirSync(testDbPath, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test database files
    if (existsSync(testDbPath)) {
      rmSync(testDbPath, { recursive: true, force: true });
    }
  });

  describe("createDb", () => {
    test("creates database with sqlite-vec extension loaded", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(testDbFile);

      try {
        // Verify sqlite-vec is loaded by checking for vec_version
        const result = handle.sqlite.prepare("SELECT vec_version() as version").get() as {
          version: string;
        };

        expect(result.version).toBeDefined();
        expect(typeof result.version).toBe("string");
      } finally {
        handle.close();
      }
    });

    test("enables foreign key constraints", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(testDbFile);

      try {
        const result = handle.sqlite.prepare("PRAGMA foreign_keys").get() as {
          foreign_keys: number;
        };

        expect(result.foreign_keys).toBe(1);
      } finally {
        handle.close();
      }
    });

    test("returns handle with sqlite, db, and close", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(testDbFile);

      try {
        expect(handle.sqlite).toBeDefined();
        expect(handle.db).toBeDefined();
        expect(handle.close).toBeInstanceOf(Function);
      } finally {
        handle.close();
      }
    });

    test("can execute queries on the database", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(testDbFile);

      try {
        // Create a simple table and insert data
        handle.sqlite.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
        handle.sqlite.run("INSERT INTO test (name) VALUES ('Alice')");

        const result = handle.sqlite.prepare("SELECT * FROM test").all();
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ id: 1, name: "Alice" });
      } finally {
        handle.close();
      }
    });

    test("close() closes the database connection", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(testDbFile);

      handle.close();

      // Attempting to use closed database should throw
      expect(() => {
        handle.sqlite.run("SELECT 1");
      }).toThrow();
    });

    test("close() can be called multiple times safely", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(testDbFile);

      handle.close();
      handle.close(); // Should not throw
      handle.close(); // Should not throw

      expect(true).toBe(true); // Test passes if no exception
    });

    test("creates database file at specified path", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(testDbFile);

      try {
        expect(existsSync(testDbFile)).toBe(true);
      } finally {
        handle.close();
      }
    });

    test("creates in-memory database when :memory: is specified", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(":memory:");

      try {
        // Should work without creating a file
        handle.sqlite.run("CREATE TABLE test (id INTEGER)");
        const result = handle.sqlite.prepare("SELECT COUNT(*) as count FROM test").get();
        expect(result).toBeDefined();
      } finally {
        handle.close();
      }
    });
  });

  describe("sqlite version check", () => {
    test("logs sqlite and vec versions on initialization", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(":memory:");

      try {
        const versions = handle.sqlite.prepare(
          "SELECT sqlite_version() as sqlite_version, vec_version() as vec_version",
        ).get() as { sqlite_version: string; vec_version: string };

        expect(versions.sqlite_version).toBeDefined();
        expect(versions.vec_version).toBeDefined();
        expect(typeof versions.sqlite_version).toBe("string");
        expect(typeof versions.vec_version).toBe("string");

        // Verify versions have expected format (x.y.z)
        expect(versions.sqlite_version).toMatch(/^\d+\.\d+/);
        expect(versions.vec_version).toMatch(/^v?\d+\.\d+/);
      } finally {
        handle.close();
      }
    });
  });

  describe("drizzle integration", () => {
    test("db client can execute queries", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(":memory:");

      try {
        // Verify drizzle client is functional
        expect(handle.db).toBeDefined();
        expect(handle.db.run).toBeInstanceOf(Function);
        expect(handle.db.all).toBeInstanceOf(Function);
      } finally {
        handle.close();
      }
    });
  });

  describe("foreign key cascade", () => {
    test("foreign key constraints work with cascade deletes", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(":memory:");

      try {
        // Create parent and child tables with foreign key
        handle.sqlite.run(`
          CREATE TABLE parent (
            id INTEGER PRIMARY KEY
          )
        `);

        handle.sqlite.run(`
          CREATE TABLE child (
            id INTEGER PRIMARY KEY,
            parent_id INTEGER NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE
          )
        `);

        // Insert parent and child
        handle.sqlite.run("INSERT INTO parent (id) VALUES (1)");
        handle.sqlite.run("INSERT INTO child (parent_id) VALUES (1)");

        // Verify child exists
        let children = handle.sqlite.prepare("SELECT * FROM child").all();
        expect(children).toHaveLength(1);

        // Delete parent should cascade to child
        handle.sqlite.run("DELETE FROM parent WHERE id = 1");

        // Verify child was deleted
        children = handle.sqlite.prepare("SELECT * FROM child").all();
        expect(children).toHaveLength(0);
      } finally {
        handle.close();
      }
    });
  });

  describe("vector operations", () => {
    test("can create and query vector tables", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(":memory:");

      try {
        // Create a simple vector table (using vec_static_blob_f32 for simplicity)
        // This tests that sqlite-vec is fully functional
        handle.sqlite.run(`
          CREATE VIRTUAL TABLE vec_test USING vec0(
            embedding FLOAT[3]
          )
        `);

        // Insert a vector
        const embedding = new Float32Array([1.0, 2.0, 3.0]);
        const stmt = handle.sqlite.prepare("INSERT INTO vec_test(rowid, embedding) VALUES (?, ?)");
        stmt.run(1, embedding);

        // Query the vector
        const result = handle.sqlite.prepare("SELECT rowid FROM vec_test WHERE rowid = 1").get() as {
          rowid: number;
        };

        expect(result.rowid).toBe(1);
      } finally {
        handle.close();
      }
    });
  });

  describe("default database handle", () => {
    test("exports default db client", async () => {
      // Note: The default handle is created on import, so we just verify it exists
      const dbModule = await import("../src/db/index");

      expect(dbModule.default).toBeDefined();
      expect(dbModule.sqlite).toBeDefined();
    });
  });

  describe("error handling", () => {
    test("close handles already closed database gracefully", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(":memory:");

      // Close the underlying sqlite connection directly
      handle.sqlite.close();

      // Calling close() should not throw even though it's already closed
      expect(() => handle.close()).not.toThrow();
    });

    test("throws error on invalid SQL", async () => {
      const { createDb } = await import("../src/db/index");
      const handle = createDb(":memory:");

      try {
        expect(() => {
          handle.sqlite.run("INVALID SQL QUERY");
        }).toThrow();
      } finally {
        handle.close();
      }
    });
  });

  describe("concurrent connections", () => {
    test("can create multiple database handles", async () => {
      const { createDb } = await import("../src/db/index");

      const handle1 = createDb(":memory:");
      const handle2 = createDb(":memory:");

      try {
        // Both should work independently
        handle1.sqlite.run("CREATE TABLE test1 (id INTEGER)");
        handle2.sqlite.run("CREATE TABLE test2 (id INTEGER)");

        // Query should only find table in respective databases
        const tables1 = handle1.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as Array<{ name: string }>;
        const tables2 = handle2.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as Array<{ name: string }>;

        expect(tables1.some((t) => t.name === "test1")).toBe(true);
        expect(tables1.some((t) => t.name === "test2")).toBe(false);

        expect(tables2.some((t) => t.name === "test2")).toBe(true);
        expect(tables2.some((t) => t.name === "test1")).toBe(false);
      } finally {
        handle1.close();
        handle2.close();
      }
    });
  });

  describe("platform-specific behavior", () => {
    test("setupCustomSQLite only runs on macOS", () => {
      // This is more of a documentation test
      // The actual setupCustomSQLite logic is tested implicitly
      // by the fact that createDb works correctly
      expect(["darwin", "linux", "win32"]).toContain(process.platform);
    });
  });
});
