/**
 * Example usage of memory CRUD functions
 * Run with: bun run examples/memory-usage.ts
 */

import {
  createMemory,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  searchSimilarMemories,
  getTopMemories,
  archiveMemories,
} from "../src/db/memory";
import { createUser, deleteUser } from "../src/db/user";

async function main() {
  console.log("🧪 Testing Memory CRUD Functions\n");

  // Create a test user
  console.log("1️⃣ Creating test user...");
  const userId = await createUser({
    name: "Memory Test User",
    email: `memory-test-${Date.now()}@example.com`,
  });
  console.log(`✅ Created user: ${userId}\n`);

  // ============
  // 1. CREATE MEMORY
  // ============
  console.log("1. Creating memories...");
  const memoryId1 = await createMemory({
    userId,
    category: "USER_FACTS",
    content: "User is a software engineer who loves TypeScript and Bun",
    summary: "Software engineer, TypeScript/Bun enthusiast",
    importanceScore: 8.5,
    confidenceScore: 0.95,
  });
  console.log(`✅ Created memory: ${memoryId1}`);

  const memoryId2 = await createMemory({
    userId,
    category: "USER_PREFERENCES",
    content: "User prefers dark mode and minimal UI designs",
    summary: "Prefers dark mode, minimal UI",
    importanceScore: 7.0,
    emotionalWeight: 2.5,
  });
  console.log(`✅ Created memory: ${memoryId2}`);

  const memoryId3 = await createMemory({
    userId,
    category: "EPISODIC_EVENTS",
    content:
      "User mentioned they're building an AI assistant with memory features",
    summary: "Building AI assistant project",
    importanceScore: 9.0,
    sourceMessageIds: ["msg-123", "msg-124"],
  });
  console.log(`✅ Created memory: ${memoryId3}\n`);

  // ============
  // 2. READ MEMORY
  // ============
  console.log("2. Reading memory...");
  const retrieved = await getMemory(memoryId1);
  console.log(`✅ Retrieved memory:`, {
    id: retrieved?.id,
    content: retrieved?.content,
    accessCount: retrieved?.accessCount,
  });
  console.log();

  // ============
  // 3. UPDATE MEMORY
  // ============
  console.log("3. Updating memory...");
  await updateMemory(memoryId2, {
    content: "User prefers dark mode, minimal UI, and monospace fonts",
    summary: "Prefers dark mode, minimal UI, monospace fonts",
    importanceScore: 7.5,
  });
  console.log(`✅ Updated memory: ${memoryId2}\n`);

  // ============
  // 4. LIST MEMORIES
  // ============
  console.log("4. Listing memories...");
  const allMemories = await listMemories({
    userId,
    status: "active",
    orderBy: "importance",
    orderDir: "desc",
  });
  console.log(`✅ Found ${allMemories.length} active memories:`);
  allMemories.forEach((m) => {
    console.log(
      `  - [${m.category}] ${m.summary} (importance: ${m.importanceScore})`,
    );
  });
  console.log();

  // ============
  // 5. SIMILARITY SEARCH
  // ============
  console.log("5. Searching similar memories...");
  const similarMemories = await searchSimilarMemories({
    userId,
    query: "What does the user do for work?",
    limit: 3,
    minSimilarity: 0.5,
  });
  console.log(`✅ Found ${similarMemories.length} similar memories:`);
  similarMemories.forEach((result) => {
    console.log(
      `  - ${result.memory.summary} (similarity: ${result.similarity.toFixed(3)})`,
    );
  });
  console.log();

  // ============
  // 6. GET TOP MEMORIES
  // ============
  console.log("6. Getting top memories...");
  const topMemories = await getTopMemories(userId, 2);
  console.log(`✅ Top ${topMemories.length} memories:`);
  topMemories.forEach((m) => {
    console.log(`  - ${m.summary} (importance: ${m.importanceScore})`);
  });
  console.log();

  // ============
  // 7. ARCHIVE MEMORIES
  // ============
  console.log("7. Archiving low-importance memories...");
  const archivedCount = await archiveMemories(userId, {
    maxImportance: 7.0,
    limit: 1,
  });
  console.log(`✅ Archived ${archivedCount} memories\n`);

  // ============
  // 8. DELETE MEMORY (soft)
  // ============
  console.log("8. Soft deleting memory...");
  await deleteMemory(memoryId3);
  console.log(`✅ Soft deleted memory: ${memoryId3}\n`);

  // ============
  // 9. DELETE MEMORY (hard)
  // ============
  console.log("9. Hard deleting memory...");
  await deleteMemory(memoryId1, { hard: true });
  console.log(`✅ Hard deleted memory: ${memoryId1}\n`);

  console.log();

  // ============
  // 10. CLEANUP
  // ============
  console.log("🧹 Cleaning up test data...");
  await deleteUser(userId);
  console.log("✅ Test user and memories deleted (cascade)\n");

  console.log("✨ All tests completed successfully!");
}

main().catch(console.error);
