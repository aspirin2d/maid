/**
 * Example usage of user CRUD helpers
 * Run with: bun run examples/user-usage.ts
 */

import {
  createUser,
  getUser,
  getUserByEmail,
  updateUser,
  deleteUser,
  listUsers,
  type CreateUserInput,
} from "../src/db/user";

async function main() {
  console.log("🧪 Testing User CRUD Functions\n");

  // ============
  // CREATE USER
  // ============
  console.log("1️⃣ Creating user...");
  const input: CreateUserInput = {
    name: "Example User",
    email: `user-crud-${Date.now()}@example.com`,
    preferences: { theme: "dark", language: "en" },
    memoryStats: {
      totalMemories: 42,
      byCategory: { USER_FACTS: 10, USER_PREFERENCES: 8 },
    },
  };

  const userId = await createUser(input);
  console.log(`✅ Created user with id: ${userId}\n`);

  // ============
  // READ USER
  // ============
  console.log("2️⃣ Fetching user by id...");
  const byId = await getUser(userId);
  console.log("✅ Retrieved:", {
    id: byId?.id,
    name: byId?.name,
    email: byId?.email,
    totalMessages: byId?.totalMessages,
  });
  console.log();

  console.log("3️⃣ Fetching user by email...");
  const byEmail = await getUserByEmail(input.email!);
  console.log("✅ Retrieved same user:", {
    id: byEmail?.id,
    name: byEmail?.name,
  });
  console.log();

  // ============
  // UPDATE USER
  // ============
  console.log("4️⃣ Updating user stats...");
  const updated = await updateUser(userId, {
    totalMessages: 7,
    lastInteraction: new Date(),
    preferences: { theme: "light", language: "en" },
  });
  console.log(`✅ Update successful: ${updated}`);

  const afterUpdate = await getUser(userId);
  console.log("✅ After update:", {
    totalMessages: afterUpdate?.totalMessages,
    lastInteraction: afterUpdate?.lastInteraction,
    preferences: afterUpdate?.preferences,
  });
  console.log();

  // ============
  // LIST USERS
  // ============
  console.log("5️⃣ Listing users...");
  const allUsers = await listUsers({ limit: 5, orderBy: "createdAt", orderDir: "desc" });
  console.log(`✅ Latest ${allUsers.length} users (showing id & email):`);
  allUsers.forEach((u, index) => {
    console.log(`   ${index + 1}. ${u.id} -> ${u.email}`);
  });
  console.log();

  console.log("6️⃣ Searching users by name/email substring...");
  const searchResults = await listUsers({ search: "crud" });
  console.log(`✅ Search returned ${searchResults.length} users`);
  searchResults.forEach((u) => {
    console.log(`   - ${u.email}`);
  });
  console.log();

  // ============
  // DELETE USER
  // ============
  console.log("7️⃣ Deleting user...");
  const deleted = await deleteUser(userId);
  console.log(`✅ Delete successful: ${deleted}`);

  const afterDelete = await getUser(userId);
  console.log(`✅ Fetch after delete returns: ${afterDelete}`);

  console.log("\n🎉 User CRUD example complete!");
}

main().catch((error) => {
  console.error("❌ Example failed", error);
});
