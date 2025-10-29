/**
 * Test script to verify cascade delete behavior:
 * When a user is deleted, their memories and vector embeddings should also be deleted
 */

import db from "./src/db/index";
import { user, memory } from "./src/db/schema";
import { createMemory } from "./src/db/memory";
import { eq } from "drizzle-orm";

async function testCascadeDelete() {
  console.log("🧪 Testing Cascade Delete Behavior\n");

  // Create a test user
  console.log("1️⃣ Creating test user...");
  const [testUser] = await db
    .insert(user)
    .values({
      name: "Test User",
      email: "test-cascade@example.com",
    })
    .returning({ id: user.id });

  console.log(`✅ Created user: ${testUser!.id}\n`);

  // Create some memories for this user
  console.log("2️⃣ Creating memories with embeddings...");
  const memoryId1 = await createMemory({
    userId: testUser!.id,
    category: "USER_FACTS",
    content: "Test user loves testing cascade deletes",
    summary: "Testing enthusiast",
    importanceScore: 8.0,
  });
  console.log(`✅ Created memory 1: ${memoryId1}`);

  const memoryId2 = await createMemory({
    userId: testUser!.id,
    category: "USER_PREFERENCES",
    content: "Test user prefers automated testing over manual testing",
    summary: "Prefers automation",
    importanceScore: 7.0,
  });
  console.log(`✅ Created memory 2: ${memoryId2}`);

  const memoryId3 = await createMemory({
    userId: testUser!.id,
    category: "USER_GOALS",
    content: "Test user wants to achieve 100% test coverage",
    summary: "Wants full coverage",
    importanceScore: 9.0,
  });
  console.log(`✅ Created memory 3: ${memoryId3}\n`);

  // Wait a bit for embeddings to be fully processed
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Check that memories and vectors exist
  console.log("3️⃣ Verifying data exists...");
  const memoriesBeforeDelete = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, testUser!.id));
  console.log(`✅ Found ${memoriesBeforeDelete.length} memories in database`);

  // Check vec_memories table
  const sqlite = (db as any).$client as any;
  const vectorsBeforeDelete = sqlite
    .prepare("SELECT memory_id FROM vec_memories WHERE memory_id IN (?, ?, ?)")
    .all(memoryId1, memoryId2, memoryId3);
  console.log(`✅ Found ${vectorsBeforeDelete.length} vector embeddings in vec_memories\n`);

  // Now delete the user
  console.log("4️⃣ Deleting user (should cascade to memories and vectors)...");
  const deleted = await db
    .delete(user)
    .where(eq(user.id, testUser!.id))
    .returning({ id: user.id });
  console.log(`✅ Deleted user: ${deleted[0]!.id}\n`);

  // Verify memories are deleted
  console.log("5️⃣ Verifying cascade deletion...");
  const memoriesAfterDelete = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, testUser!.id));
  console.log(`📊 Memories remaining: ${memoriesAfterDelete.length} (expected: 0)`);

  // Verify vec_memories are deleted
  const vectorsAfterDelete = sqlite
    .prepare("SELECT memory_id FROM vec_memories WHERE memory_id IN (?, ?, ?)")
    .all(memoryId1, memoryId2, memoryId3);
  console.log(`📊 Vector embeddings remaining: ${vectorsAfterDelete.length} (expected: 0)\n`);

  // Final verdict
  if (memoriesAfterDelete.length === 0 && vectorsAfterDelete.length === 0) {
    console.log("✅ SUCCESS: Cascade delete works correctly!");
    console.log("   ✓ User deleted");
    console.log("   ✓ Memories cascade deleted");
    console.log("   ✓ Vector embeddings trigger deleted");
  } else {
    console.log("❌ FAILURE: Cascade delete did not work as expected");
    if (memoriesAfterDelete.length > 0) {
      console.log(`   ✗ ${memoriesAfterDelete.length} memories were not deleted`);
    }
    if (vectorsAfterDelete.length > 0) {
      console.log(`   ✗ ${vectorsAfterDelete.length} vector embeddings were not deleted`);
    }
    process.exit(1);
  }
}

testCascadeDelete().catch((error) => {
  console.error("❌ Test failed with error:", error);
  process.exit(1);
});
