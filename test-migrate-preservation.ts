/**
 * Test that migration preserves existing vec_memories data
 */

import db from "./src/db/index";
import { user, memory } from "./src/db/schema";
import { createMemory } from "./src/db/memory";
import { eq, sql } from "drizzle-orm";

async function testMigrationPreservation() {
  console.log("🧪 Testing Migration Data Preservation\n");

  // Create a test user and memory
  console.log("1️⃣ Creating test data...");
  const [testUser] = await db
    .insert(user)
    .values({
      name: "Migration Test User",
      email: "migrate-test@example.com",
    })
    .returning({ id: user.id });

  const memoryId = await createMemory({
    userId: testUser!.id,
    category: "USER_FACTS",
    content: "This memory should survive migration",
    summary: "Migration test memory",
    importanceScore: 9.0,
  });

  console.log(`   ✅ Created user: ${testUser!.id}`);
  console.log(`   ✅ Created memory: ${memoryId}`);

  // Wait for embedding
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Check vector exists
  const sqlite = (db as any).$client as any;
  const vectorBefore = sqlite
    .prepare("SELECT memory_id FROM vec_memories WHERE memory_id = ?")
    .get(memoryId);

  console.log(`   📊 Vector before migration: ${vectorBefore ? "EXISTS" : "MISSING"}\n`);

  if (!vectorBefore) {
    console.log("   ❌ Vector was not created!");
    process.exit(1);
  }

  // Simulate running migration again
  console.log("2️⃣ Simulating migration run (should preserve data)...");

  // This is what happens in migrate.ts
  try {
    db.run(sql`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        memory_id TEXT,
        embedding FLOAT[4096]
      )
    `);
    console.log("   ✅ Migration command executed (table already exists)\n");
  } catch (error: any) {
    console.log(`   ❌ Migration failed: ${error.message}`);
    process.exit(1);
  }

  // Check vector still exists
  console.log("3️⃣ Verifying data preservation...");
  const vectorAfter = sqlite
    .prepare("SELECT memory_id FROM vec_memories WHERE memory_id = ?")
    .get(memoryId);

  console.log(`   📊 Vector after migration: ${vectorAfter ? "EXISTS" : "MISSING"}`);

  if (!vectorAfter) {
    console.log("   ❌ Vector was lost during migration!");
    process.exit(1);
  }

  // Verify the memory itself is still there
  const memoryRecord = await db.select().from(memory).where(eq(memory.id, memoryId));
  console.log(`   📊 Memory after migration: ${memoryRecord.length > 0 ? "EXISTS" : "MISSING"}`);

  if (memoryRecord.length === 0) {
    console.log("   ❌ Memory was lost!");
    process.exit(1);
  }

  console.log("\n✅ SUCCESS: Migration preserves existing data!");
  console.log("   ✓ vec_memories table not dropped");
  console.log("   ✓ Existing vectors preserved");
  console.log("   ✓ Existing memories preserved");

  // Cleanup
  console.log("\n🧹 Cleaning up test data...");
  await db.delete(user).where(eq(user.id, testUser!.id));
  console.log("   ✅ Cleanup complete\n");
}

testMigrationPreservation().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
