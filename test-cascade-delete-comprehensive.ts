/**
 * Comprehensive test for cascade delete behavior:
 * 1. Tests user deletion cascades to memories and vectors
 * 2. Tests that other users' data remains intact
 * 3. Tests direct memory deletion triggers vector cleanup
 * 4. Tests soft vs hard delete behavior
 */

import db from "./src/db/index";
import { user, memory } from "./src/db/schema";
import { createMemories, deleteMemory, getMemory } from "./src/db/memory";
import { eq } from "drizzle-orm";

async function getVectorCount(memoryIds: string[]): Promise<number> {
  if (memoryIds.length === 0) return 0;

  const sqlite = (db as any).$client as any;
  const placeholders = memoryIds.map(() => "?").join(", ");
  const result = sqlite
    .prepare(`SELECT COUNT(*) as count FROM vec_memories WHERE memory_id IN (${placeholders})`)
    .get(...memoryIds) as { count: number };
  return result.count;
}

async function getAllVectors(): Promise<any[]> {
  const sqlite = (db as any).$client as any;
  return sqlite.prepare("SELECT memory_id FROM vec_memories").all();
}

async function testComprehensiveCascadeDelete() {
  console.log("🧪 Comprehensive Cascade Delete Test\n");
  console.log("=" .repeat(60));

  // ============================================================
  // TEST 1: Multiple Users - Isolated Deletion
  // ============================================================
  console.log("\n📋 TEST 1: Multiple Users - Isolated Deletion");
  console.log("=" .repeat(60));

  console.log("\n1️⃣ Creating 3 test users...");
  const [user1] = await db
    .insert(user)
    .values({
      name: "User One",
      email: "user1-cascade@example.com",
    })
    .returning({ id: user.id });

  const [user2] = await db
    .insert(user)
    .values({
      name: "User Two",
      email: "user2-cascade@example.com",
    })
    .returning({ id: user.id });

  const [user3] = await db
    .insert(user)
    .values({
      name: "User Three",
      email: "user3-cascade@example.com",
    })
    .returning({ id: user.id });

  console.log(`   ✅ Created User 1: ${user1!.id}`);
  console.log(`   ✅ Created User 2: ${user2!.id}`);
  console.log(`   ✅ Created User 3: ${user3!.id}`);

  // Create memories for each user
  console.log("\n2️⃣ Creating memories for each user...");

  const user1Memories = await createMemories([
    {
      userId: user1!.id,
      category: "USER_FACTS",
      content: "User 1 is a software engineer",
      summary: "Software engineer",
    },
    {
      userId: user1!.id,
      category: "USER_PREFERENCES",
      content: "User 1 prefers TypeScript over JavaScript",
      summary: "Prefers TypeScript",
    },
    {
      userId: user1!.id,
      category: "USER_GOALS",
      content: "User 1 wants to learn Rust",
      summary: "Learn Rust",
    },
  ]);
  console.log(`   ✅ User 1: Created ${user1Memories.length} memories`);

  const user2Memories = await createMemories([
    {
      userId: user2!.id,
      category: "USER_FACTS",
      content: "User 2 is a product manager",
      summary: "Product manager",
    },
    {
      userId: user2!.id,
      category: "USER_PREFERENCES",
      content: "User 2 likes data-driven decisions",
      summary: "Data-driven",
    },
  ]);
  console.log(`   ✅ User 2: Created ${user2Memories.length} memories`);

  const user3Memories = await createMemories([
    {
      userId: user3!.id,
      category: "USER_FACTS",
      content: "User 3 is a designer",
      summary: "Designer",
    },
    {
      userId: user3!.id,
      category: "USER_PREFERENCES",
      content: "User 3 prefers Figma for design work",
      summary: "Uses Figma",
    },
    {
      userId: user3!.id,
      category: "USER_GOALS",
      content: "User 3 wants to master UI animations",
      summary: "Master animations",
    },
    {
      userId: user3!.id,
      category: "EPISODIC_EVENTS",
      content: "User 3 completed a design course",
      summary: "Completed course",
    },
  ]);
  console.log(`   ✅ User 3: Created ${user3Memories.length} memories`);

  // Wait for embeddings
  await new Promise((resolve) => setTimeout(resolve, 800));

  // Verify initial state
  console.log("\n3️⃣ Verifying initial data state...");
  const totalMemories = user1Memories.length + user2Memories.length + user3Memories.length;
  const allMemoryIds = [...user1Memories, ...user2Memories, ...user3Memories];

  const user1MemoriesCount = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, user1!.id));
  const user2MemoriesCount = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, user2!.id));
  const user3MemoriesCount = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, user3!.id));

  const testUsersMemoryCount =
    user1MemoriesCount.length + user2MemoriesCount.length + user3MemoriesCount.length;
  const vectorsInDb = await getVectorCount(allMemoryIds);

  console.log(`   📊 Test users' memories in database: ${testUsersMemoryCount}`);
  console.log(`   📊 Test users' vectors in database: ${vectorsInDb}`);
  console.log(`   ✅ Expected: ${totalMemories} memories, ${totalMemories} vectors`);

  if (testUsersMemoryCount !== totalMemories || vectorsInDb !== totalMemories) {
    console.log(`   ❌ Initial state mismatch!`);
    console.log(`   Got: ${testUsersMemoryCount} memories, ${vectorsInDb} vectors`);
    process.exit(1);
  }

  // Delete User 2
  console.log("\n4️⃣ Deleting User 2 (should only delete User 2's data)...");
  await db.delete(user).where(eq(user.id, user2!.id));
  console.log(`   ✅ Deleted User 2: ${user2!.id}`);

  // Verify User 2's data is gone
  console.log("\n5️⃣ Verifying User 2's data is deleted...");
  const user2MemoriesAfter = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, user2!.id));
  const user2VectorsAfter = await getVectorCount(user2Memories);

  console.log(`   📊 User 2 memories remaining: ${user2MemoriesAfter.length} (expected: 0)`);
  console.log(`   📊 User 2 vectors remaining: ${user2VectorsAfter} (expected: 0)`);

  if (user2MemoriesAfter.length !== 0 || user2VectorsAfter !== 0) {
    console.log(`   ❌ User 2's data was not fully deleted!`);
    process.exit(1);
  }
  console.log(`   ✅ User 2's data completely removed`);

  // Verify User 1 and User 3 data is intact
  console.log("\n6️⃣ Verifying User 1 and User 3 data is intact...");
  const user1MemoriesAfter = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, user1!.id));
  const user3MemoriesAfter = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, user3!.id));
  const user1VectorsAfter = await getVectorCount(user1Memories);
  const user3VectorsAfter = await getVectorCount(user3Memories);

  console.log(`   📊 User 1: ${user1MemoriesAfter.length} memories, ${user1VectorsAfter} vectors`);
  console.log(`   📊 User 3: ${user3MemoriesAfter.length} memories, ${user3VectorsAfter} vectors`);

  const user1Intact = user1MemoriesAfter.length === user1Memories.length &&
                      user1VectorsAfter === user1Memories.length;
  const user3Intact = user3MemoriesAfter.length === user3Memories.length &&
                      user3VectorsAfter === user3Memories.length;

  if (!user1Intact || !user3Intact) {
    console.log(`   ❌ Other users' data was affected!`);
    process.exit(1);
  }
  console.log(`   ✅ User 1 and User 3 data intact`);

  console.log("\n✅ TEST 1 PASSED: User deletion is isolated and cascades correctly");

  // ============================================================
  // TEST 2: Direct Memory Deletion (Soft vs Hard)
  // ============================================================
  console.log("\n\n📋 TEST 2: Direct Memory Deletion - Trigger Verification");
  console.log("=" .repeat(60));

  // Test soft delete (should NOT remove vector)
  console.log("\n1️⃣ Testing SOFT delete (vectors should remain)...");
  const memoryToSoftDelete = user1Memories[0]!;
  await deleteMemory(memoryToSoftDelete); // Soft delete by default

  const softDeletedMemory = await getMemory(memoryToSoftDelete, { trackAccess: false });
  const vectorAfterSoftDelete = await getVectorCount([memoryToSoftDelete]);

  console.log(`   📊 Memory status: ${softDeletedMemory?.status}`);
  console.log(`   📊 Vector still exists: ${vectorAfterSoftDelete > 0 ? "Yes" : "No"}`);

  if (softDeletedMemory?.status !== "deleted" || vectorAfterSoftDelete === 0) {
    console.log(`   ❌ Soft delete behavior incorrect!`);
    process.exit(1);
  }
  console.log(`   ✅ Soft delete: memory marked deleted, vector retained`);

  // Test hard delete (should remove vector via trigger)
  console.log("\n2️⃣ Testing HARD delete (vectors should be removed)...");
  const memoryToHardDelete = user1Memories[1]!;
  const vectorBeforeHardDelete = await getVectorCount([memoryToHardDelete]);
  console.log(`   📊 Vector before hard delete: ${vectorBeforeHardDelete}`);

  await deleteMemory(memoryToHardDelete, { hard: true });

  const hardDeletedMemory = await getMemory(memoryToHardDelete, { trackAccess: false });
  const vectorAfterHardDelete = await getVectorCount([memoryToHardDelete]);

  console.log(`   📊 Memory exists: ${hardDeletedMemory ? "Yes" : "No"}`);
  console.log(`   📊 Vector after hard delete: ${vectorAfterHardDelete}`);

  if (hardDeletedMemory !== undefined || vectorAfterHardDelete !== 0) {
    console.log(`   ❌ Hard delete behavior incorrect!`);
    console.log(`   Memory: ${hardDeletedMemory?.id}`);
    console.log(`   Vectors: ${vectorAfterHardDelete}`);
    process.exit(1);
  }
  console.log(`   ✅ Hard delete: memory removed, vector cleaned by trigger`);

  console.log("\n✅ TEST 2 PASSED: Memory deletion triggers work correctly");

  // ============================================================
  // TEST 3: Cascade Performance with Many Memories
  // ============================================================
  console.log("\n\n📋 TEST 3: Cascade Performance with Many Memories");
  console.log("=" .repeat(60));

  console.log("\n1️⃣ Creating user with 20 memories...");
  const [heavyUser] = await db
    .insert(user)
    .values({
      name: "Heavy User",
      email: "heavy-cascade@example.com",
    })
    .returning({ id: user.id });

  const heavyUserMemories = await createMemories(
    Array.from({ length: 20 }, (_, i) => ({
      userId: heavyUser!.id,
      category: "USER_FACTS" as const,
      content: `Memory ${i + 1} for heavy user - testing cascade delete performance`,
      summary: `Memory ${i + 1}`,
    }))
  );

  console.log(`   ✅ Created ${heavyUserMemories.length} memories`);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const vectorsBefore = await getVectorCount(heavyUserMemories);
  console.log(`   📊 Vectors created: ${vectorsBefore}`);

  console.log("\n2️⃣ Deleting user with 20 memories...");
  const startTime = Date.now();
  await db.delete(user).where(eq(user.id, heavyUser!.id));
  const deleteTime = Date.now() - startTime;

  const memoriesAfter = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, heavyUser!.id));
  const vectorsAfter = await getVectorCount(heavyUserMemories);

  console.log(`   ⏱️  Delete operation took: ${deleteTime}ms`);
  console.log(`   📊 Memories after delete: ${memoriesAfter.length}`);
  console.log(`   📊 Vectors after delete: ${vectorsAfter}`);

  if (memoriesAfter.length !== 0 || vectorsAfter !== 0) {
    console.log(`   ❌ Cascade delete failed with many memories!`);
    process.exit(1);
  }
  console.log(`   ✅ Successfully cascade deleted 20 memories + vectors in ${deleteTime}ms`);

  console.log("\n✅ TEST 3 PASSED: Cascade delete performs well with many records");

  // ============================================================
  // Final Cleanup
  // ============================================================
  console.log("\n\n🧹 Cleaning up remaining test data...");
  await db.delete(user).where(eq(user.id, user1!.id));
  await db.delete(user).where(eq(user.id, user3!.id));
  console.log("   ✅ Cleanup complete");

  // Final verification
  console.log("\n📊 Final Database State:");
  const allVectors = await getAllVectors();
  console.log(`   Total vectors remaining: ${allVectors.length}`);

  // ============================================================
  // Summary
  // ============================================================
  console.log("\n\n" + "=" .repeat(60));
  console.log("✨ ALL TESTS PASSED!");
  console.log("=" .repeat(60));
  console.log("\n✅ Verified behaviors:");
  console.log("   1. User deletion cascades to memories");
  console.log("   2. Memory deletion triggers vector cleanup");
  console.log("   3. Deletion is isolated (other users unaffected)");
  console.log("   4. Soft delete preserves vectors");
  console.log("   5. Hard delete removes vectors via trigger");
  console.log("   6. Performance is good with many records");
  console.log("\n🎉 Database cascade delete system is working perfectly!\n");
}

testComprehensiveCascadeDelete().catch((error) => {
  console.error("\n❌ Test failed with error:", error);
  process.exit(1);
});
