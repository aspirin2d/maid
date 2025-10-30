import {
  describe,
  it,
  beforeAll,
  beforeEach,
  afterAll,
  expect,
} from "bun:test";
import { existsSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import type { Provider } from "../src/llm";

const dbPath = join(tmpdir(), `maid-test-${process.pid}.sqlite`);
if (existsSync(dbPath)) {
  unlinkSync(dbPath);
}
process.env.SQLITE_DB_PATH = dbPath;

const { default: db } = await import("../src/db/index");
const { user } = await import("../src/db/schema");
const memoryModule = await import("../src/memory");

const {
  createMemory,
  getMemory,
  updateMemoryContent,
  softDeleteMemory,
  restoreMemory,
  hardDeleteMemory,
  getDeletedMemories,
  searchSimilarMemories,
  createMemories,
  listMemories,
  getMemoriesByIds,
  getActiveMemories,
  getRecentlyUpdatedMemories,
  getMemoryHistory,
  getMemoriesByAction,
  countUserMemories,
  getMemoryStats,
  purgeDeletedMemories,
  deleteMemoriesOlderThan,
  setEmbedTextImplementation,
  resetEmbedTextImplementation,
} = memoryModule;

const VECTOR_DIMENSIONS = 1536;

const stubEmbedText = async (
  _provider: Provider,
  text: string,
  dims = VECTOR_DIMENSIONS,
): Promise<number[]> => {
  const vector = new Array(dims).fill(0);
  const hash = Array.from(text).reduce(
    (acc, char) => acc + char.charCodeAt(0),
    0,
  );
  vector[0] = hash % 1000;
  vector[1] = (hash * 7) % 997;
  return vector;
};

async function createTestUser(name = "Test User"): Promise<number> {
  const [record] = await db
    .insert(user)
    .values({ name })
    .returning({ id: user.id });
  return record!.id;
}

function setMemoryTimestamps(
  memoryId: number,
  createdAtMs: number,
  updatedAtMs = createdAtMs,
): void {
  db.run(sql`
    UPDATE memory
    SET created_at = ${createdAtMs},
        updated_at = ${updatedAtMs}
    WHERE id = ${memoryId}
  `);
}

function setMemoryUpdatedAt(memoryId: number, updatedAtMs: number): void {
  db.run(sql`
    UPDATE memory
    SET updated_at = ${updatedAtMs}
    WHERE id = ${memoryId}
  `);
}

function countVectorRows(): number {
  const [row] = db.all<{ count: number }>(
    sql`SELECT COUNT(*) as count FROM vec_memories`,
  );
  return row?.count ?? 0;
}

function ensureDefined<T>(value: T | undefined | null): T {
  expect(value).toBeDefined();
  return value as T;
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function ensureDate(value: Date | null | undefined): Date {
  const date = ensureDefined(value);
  expect(date).toBeInstanceOf(Date);
  return date;
}

function filteredEnv(extra: Record<string, string>): Record<string, string> {
  const merged = { ...process.env, ...extra } as Record<
    string,
    string | undefined
  >;
  return Object.fromEntries(
    Object.entries(merged).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function runCommand(command: string[], env: Record<string, string>): void {
  const result = Bun.spawnSync(command, {
    cwd: process.cwd(),
    env,
  });

  if (result.exitCode !== 0) {
    const decoder = new TextDecoder();
    throw new Error(
      `Command failed: ${command.join(" ")}\n${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
    );
  }
}

function initializeDatabase(): void {
  const env = filteredEnv({ SQLITE_DB_PATH: dbPath });

  const tempOut = mkdtempSync(join(tmpdir(), "drizzle-generate-"));
  runCommand(
    [
      "bunx",
      "drizzle-kit",
      "generate",
      "--schema",
      "./src/db/schema.ts",
      "--dialect",
      "sqlite",
      "--out",
      tempOut,
    ],
    env,
  );
  rmSync(tempOut, { recursive: true, force: true });

  runCommand(["bun", "run", "migrate.ts"], env);
}

beforeAll(() => {
  setEmbedTextImplementation(stubEmbedText);

  initializeDatabase();
});

beforeEach(() => {
  db.run(sql`DELETE FROM vec_memories`);
  db.run(sql`DELETE FROM memory`);
  db.run(sql`DELETE FROM user`);
  db.run(sql`DELETE FROM sqlite_sequence WHERE name IN ('memory', 'user')`);
});

afterAll(() => {
  resetEmbedTextImplementation();
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
});

describe("memory CRUD", () => {
  it("creates, updates, soft deletes, restores, and hard deletes a memory", async () => {
    const userId = await createTestUser();

    const memoryId = await createMemory({ userId, content: "Initial memory" });
    const created = await getMemory(memoryId);
    expect(created?.content).toBe("Initial memory");
    expect(created?.deleted).toBe(0);

    await updateMemoryContent(memoryId, "Updated memory");
    const updated = await getMemory(memoryId);
    expect(updated?.content).toBe("Updated memory");
    expect(updated?.prevContent).toBe("Initial memory");

    await softDeleteMemory(memoryId);
    const deletedList = await getDeletedMemories(userId);
    expect(deletedList).toHaveLength(1);
    expect(deletedList[0]?.deleted).toBe(1);

    await restoreMemory(memoryId);
    const restored = await getMemory(memoryId);
    expect(restored?.deleted).toBe(0);

    await hardDeleteMemory(memoryId);
    const afterHardDelete = await getMemory(memoryId);
    expect(afterHardDelete).toBeUndefined();
  });
});

describe("memory similarity search", () => {
  it("returns the most relevant memories for a query", async () => {
    const userId = await createTestUser();

    const exactMemoryId = await createMemory({
      userId,
      content: "Similar content anchor",
    });
    await createMemory({ userId, content: "Different topic" });

    const results = await searchSimilarMemories("Similar content anchor", {
      userId,
      limit: 5,
      provider: "ollama",
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.id).toBe(exactMemoryId);
    expect(results[0]?.distance).toBeCloseTo(0, 5);
  });
});

describe("memory queries", () => {
  it("lists, filters, and aggregates user memories", async () => {
    const userId = await createTestUser();

    const createdIds = await createMemories([
      { userId, content: "Alpha" },
      { userId, content: "Beta" },
      { userId, content: "Gamma" },
    ]);
    expect(createdIds).toHaveLength(3);
    const [firstId, secondId, thirdId] = createdIds as [number, number, number];

    const base = Date.UTC(2020, 0, 1);
    const day = 24 * 60 * 60 * 1000;

    setMemoryTimestamps(firstId, base);
    setMemoryTimestamps(secondId, base + day);
    setMemoryTimestamps(thirdId, base + 2 * day);

    await softDeleteMemory(secondId);
    setMemoryUpdatedAt(firstId, base + 3 * day);
    setMemoryUpdatedAt(secondId, base + 4 * day);

    await updateMemoryContent(thirdId, "Gamma updated");
    setMemoryUpdatedAt(thirdId, base + 5 * day);

    const activeList = await listMemories({ userId });
    expect(activeList).toHaveLength(2);
    const firstActive = ensureDefined(activeList[0]);
    const secondActive = ensureDefined(activeList[1]);
    expect(ensureDate(firstActive.createdAt).valueOf()).toBeGreaterThanOrEqual(
      ensureDate(secondActive.createdAt).valueOf(),
    );
    expect(sorted(activeList.map((m) => m.id))).toEqual(
      sorted([firstId, thirdId]),
    );

    const includeDeleted = await listMemories({
      userId,
      includeDeleted: true,
      orderBy: "createdAt",
      orderDir: "asc",
    });
    expect(sorted(includeDeleted.map((m) => m.id))).toEqual(
      sorted([firstId, secondId, thirdId]),
    );
    const firstInclude = ensureDefined(includeDeleted[0]);
    const lastInclude = ensureDefined(includeDeleted.at(-1));
    expect(ensureDate(firstInclude.createdAt).valueOf()).toBeLessThanOrEqual(
      ensureDate(lastInclude.createdAt).valueOf(),
    );

    const activeOnly = await getActiveMemories(userId);
    expect(sorted(activeOnly.map((m) => m.id))).toEqual(
      sorted([firstId, thirdId]),
    );
    const firstActiveOnly = ensureDefined(activeOnly[0]);
    const lastActiveOnly = ensureDefined(activeOnly.at(-1));
    expect(ensureDate(firstActiveOnly.updatedAt).valueOf()).toBeGreaterThanOrEqual(
      ensureDate(lastActiveOnly.updatedAt).valueOf(),
    );

    const recent = await getRecentlyUpdatedMemories(userId, 2);
    expect(recent).toHaveLength(2);
    const firstRecent = ensureDefined(recent[0]);
    const secondRecent = ensureDefined(recent[1]);
    expect(ensureDate(firstRecent.updatedAt).valueOf()).toBeGreaterThanOrEqual(
      ensureDate(secondRecent.updatedAt).valueOf(),
    );
    expect(sorted(recent.map((m) => m.id))).toEqual(sorted([firstId, thirdId]));

    const deleted = await getDeletedMemories(userId);
    expect(deleted.map((m) => m.id)).toEqual([secondId]);

    const deletesByAction = await getMemoriesByAction(userId, "DELETE", {
      includeDeleted: true,
    });
    expect(deletesByAction.map((m) => m.id)).toEqual([secondId]);

    const updatesByAction = await getMemoriesByAction(userId, "UPDATE", {
      includeDeleted: true,
    });
    expect(updatesByAction.map((m) => m.id)).toEqual([thirdId]);

    const fullHistory = await getMemoryHistory(userId);
    expect(sorted(fullHistory.map((m) => m.id))).toEqual(
      sorted([firstId, secondId, thirdId]),
    );
    const firstHistory = ensureDefined(fullHistory[0]);
    const lastHistory = ensureDefined(fullHistory.at(-1));
    expect(ensureDate(firstHistory.createdAt).valueOf()).toBeLessThanOrEqual(
      ensureDate(lastHistory.createdAt).valueOf(),
    );

    const limitedHistory = await getMemoryHistory(userId, { limit: 2 });
    expect(limitedHistory).toHaveLength(2);
    const firstLimited = ensureDefined(limitedHistory[0]);
    const lastLimited = ensureDefined(limitedHistory.at(-1));
    expect(ensureDate(firstLimited.createdAt).valueOf()).toBeLessThanOrEqual(
      ensureDate(lastLimited.createdAt).valueOf(),
    );
    expect(limitedHistory.map((m) => m.id)).toEqual([
      firstHistory.id,
      ensureDefined(fullHistory[1]).id,
    ]);

    const byIds = await getMemoriesByIds([thirdId, secondId], true);
    expect(sorted(byIds.map((m) => m.id))).toEqual(sorted([secondId, thirdId]));

    expect(await countUserMemories(userId)).toBe(2);
    expect(await countUserMemories(userId, true)).toBe(3);

    const stats = await getMemoryStats(userId);
    expect(stats).toEqual({
      total: 3,
      active: 2,
      deleted: 1,
      byAction: { ADD: 1, UPDATE: 1, DELETE: 1 },
    });
  });

  it("purges deleted memories and removes records older than a cutoff", async () => {
    const userId = await createTestUser();

    const purgeIds = await createMemories([
      { userId, content: "Old memory" },
      { userId, content: "Medium memory" },
      { userId, content: "Recent memory" },
    ]);
    expect(purgeIds).toHaveLength(3);
    const [firstId, secondId, thirdId] = purgeIds as [number, number, number];

    const now = Date.now();
    setMemoryTimestamps(firstId, now - 10_000);
    setMemoryTimestamps(secondId, now - 5_000);
    setMemoryTimestamps(thirdId, now - 1_000);

    await softDeleteMemory(firstId);
    await softDeleteMemory(secondId);

    const purgedCount = await purgeDeletedMemories(userId);
    expect(purgedCount).toBe(2);
    expect(await countUserMemories(userId, true)).toBe(1);

    setMemoryTimestamps(thirdId, 0);

    const deletedCount = await deleteMemoriesOlderThan(userId, new Date(1));
    expect(deletedCount).toBe(1);

    expect(await countUserMemories(userId, true)).toBe(0);
    expect(await listMemories({ userId, includeDeleted: true })).toHaveLength(0);
  });
});

describe("memory vector maintenance", () => {
  it("deletes associated embeddings when memories are removed", async () => {
    const userId = await createTestUser();

    const firstId = await createMemory({ userId, content: "Cascade test A" });
    const secondId = await createMemory({ userId, content: "Cascade test B" });

    expect(countVectorRows()).toBe(2);

    await hardDeleteMemory(firstId);
    expect(countVectorRows()).toBe(1);

    await softDeleteMemory(secondId);
    expect(countVectorRows()).toBe(1);

    const purged = await purgeDeletedMemories(userId);
    expect(purged).toBe(1);
    expect(countVectorRows()).toBe(0);
  });
});
