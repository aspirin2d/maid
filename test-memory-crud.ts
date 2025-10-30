import {
  createMemory,
  createMemories,
  getMemory,
  updateMemory,
  softDeleteMemory,
  hardDeleteMemory,
  restoreMemory,
  listMemories,
  getMemoriesByIds,
  getActiveMemories,
  getRecentlyUpdatedMemories,
  getMemoryHistory,
  getMemoriesByAction,
  getDeletedMemories,
  countUserMemories,
  getMemoryStats,
  updateMemoryContent,
  bulkSoftDeleteMemories,
  bulkHardDeleteMemories,
  purgeDeletedMemories,
  deleteMemoriesOlderThan,
} from "./src/db/memory";

async function main() {
  console.log("=== Testing Memory CRUD Functions ===\n");

  const testUserId = "test-user-123";

  // Test 1: Create a memory
  console.log("1. Creating a memory...");
  const memoryId = await createMemory({
    userId: testUserId,
    content: "User likes coffee in the morning",
    action: "ADD",
  });
  console.log(`   Created memory with ID: ${memoryId}\n`);

  // Test 2: Get the memory
  console.log("2. Getting memory by ID...");
  const memory = await getMemory(memoryId);
  console.log(`   Memory: ${JSON.stringify(memory, null, 2)}\n`);

  // Test 3: Create multiple memories
  console.log("3. Creating multiple memories...");
  const memoryIds = await createMemories([
    {
      userId: testUserId,
      content: "User prefers dark mode",
      action: "ADD",
    },
    {
      userId: testUserId,
      content: "User is learning TypeScript",
      action: "ADD",
    },
  ]);
  console.log(`   Created memories with IDs: ${memoryIds.join(", ")}\n`);

  // Test 4: List all active memories
  console.log("4. Listing all active memories...");
  const activeMemories = await getActiveMemories(testUserId);
  console.log(`   Found ${activeMemories.length} active memories\n`);

  // Test 5: Update memory content
  console.log("5. Updating memory content...");
  const updated = await updateMemoryContent(
    memoryId,
    "User loves coffee in the morning (updated)",
  );
  console.log(`   Update successful: ${updated}`);
  const updatedMemory = await getMemory(memoryId);
  console.log(
    `   New content: ${updatedMemory?.content}`,
  );
  console.log(
    `   Previous content: ${updatedMemory?.prevContent}\n`,
  );

  // Test 6: Get memory stats
  console.log("6. Getting memory statistics...");
  const stats = await getMemoryStats(testUserId);
  console.log(`   Stats: ${JSON.stringify(stats, null, 2)}\n`);

  // Test 7: Soft delete a memory
  console.log("7. Soft deleting a memory...");
  await softDeleteMemory(memoryId);
  const deletedMemory = await getMemory(memoryId);
  console.log(`   Deleted flag: ${deletedMemory?.deleted}`);
  console.log(`   Action: ${deletedMemory?.action}\n`);

  // Test 8: Count active memories
  console.log("8. Counting active memories...");
  const activeCount = await countUserMemories(testUserId, false);
  const totalCount = await countUserMemories(testUserId, true);
  console.log(`   Active: ${activeCount}, Total: ${totalCount}\n`);

  // Test 9: Get deleted memories
  console.log("9. Getting deleted memories...");
  const deletedMemories = await getDeletedMemories(testUserId);
  console.log(`   Found ${deletedMemories.length} deleted memories\n`);

  // Test 10: Restore the deleted memory
  console.log("10. Restoring deleted memory...");
  await restoreMemory(memoryId);
  const restoredMemory = await getMemory(memoryId);
  console.log(`   Deleted flag: ${restoredMemory?.deleted}\n`);

  // Test 11: Get memories by action
  console.log("11. Getting memories by action (UPDATE)...");
  const updateMemories = await getMemoriesByAction(testUserId, "UPDATE");
  console.log(`   Found ${updateMemories.length} UPDATE memories\n`);

  // Test 12: Get recently updated memories
  console.log("12. Getting recently updated memories...");
  const recentMemories = await getRecentlyUpdatedMemories(testUserId, 5);
  console.log(`   Found ${recentMemories.length} recent memories\n`);

  // Test 13: Bulk soft delete
  console.log("13. Bulk soft deleting memories...");
  const deletedCount = await bulkSoftDeleteMemories(memoryIds);
  console.log(`   Soft deleted ${deletedCount} memories\n`);

  // Test 14: List with filters
  console.log("14. Listing memories with filters...");
  const filteredMemories = await listMemories({
    userId: testUserId,
    action: "DELETE",
    includeDeleted: true,
    limit: 10,
  });
  console.log(`   Found ${filteredMemories.length} DELETE action memories\n`);

  // Test 15: Memory history
  console.log("15. Getting memory history...");
  const history = await getMemoryHistory(testUserId);
  console.log(`   Found ${history.length} total memory entries\n`);

  // Test 16: Final stats
  console.log("16. Final memory statistics...");
  const finalStats = await getMemoryStats(testUserId);
  console.log(`   Final stats: ${JSON.stringify(finalStats, null, 2)}\n`);

  // Test 17: Purge deleted memories
  console.log("17. Purging deleted memories...");
  const purgedCount = await purgeDeletedMemories(testUserId);
  console.log(`   Purged ${purgedCount} deleted memories\n`);

  // Test 18: Hard delete remaining memories
  console.log("18. Hard deleting all remaining test memories...");
  const remainingMemories = await getActiveMemories(testUserId);
  if (remainingMemories.length > 0) {
    const hardDeletedCount = await bulkHardDeleteMemories(
      remainingMemories.map((m) => m.id),
    );
    console.log(`   Hard deleted ${hardDeletedCount} memories\n`);
  }

  console.log("=== All tests completed successfully! ===");
}

main().catch(console.error);
