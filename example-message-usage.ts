/**
 * Example usage of message CRUD functions
 * Run with: bun example-message-usage.ts
 */

import db from "./src/db/index";
import { user } from "./src/db/schema";
import {
  createMessage,
  createMessages,
  getMessage,
  updateMessage,
  deleteMessage,
  listMessages,
  getMessagesByIds,
  getRecentMessages,
  getConversationHistory,
  markMessagesAsExtracted,
  getUnextractedMessages,
  deleteMessagesOlderThan,
  countUserMessages,
  getMessageStats,
} from "./src/db/message";

async function main() {
  console.log("🧪 Testing Message CRUD Functions\n");

  // Create a test user
  console.log("1️⃣ Creating test user...");
  const [testUser] = await db
    .insert(user)
    .values({
      name: "Message Test User",
      email: "message-test@example.com",
    })
    .returning({ id: user.id });

  const userId = testUser!.id;
  console.log(`✅ Created user: ${userId}\n`);

  // ============
  // CREATE MESSAGES
  // ============
  console.log("2️⃣ Creating messages...");

  // Single message
  const messageId1 = await createMessage({
    userId,
    role: "user",
    content: "Hello! I'm looking for information about TypeScript.",
  });
  console.log(`✅ Created message: ${messageId1}`);

  const messageId2 = await createMessage({
    userId,
    role: "assistant",
    content:
      "Hello! I'd be happy to help you with TypeScript. What would you like to know?",
  });
  console.log(`✅ Created message: ${messageId2}`);

  // Batch create
  const conversationIds = await createMessages([
    {
      userId,
      role: "user",
      content: "Can you explain TypeScript generics?",
    },
    {
      userId,
      role: "assistant",
      content:
        "TypeScript generics allow you to create reusable components that work with multiple types...",
      metadata: {
        sentiment: 0.8,
        intent: "education",
      },
    },
    {
      userId,
      role: "user",
      content: "That makes sense! Can you give me an example?",
    },
    {
      userId,
      role: "assistant",
      content:
        "Sure! Here's a simple example: function identity<T>(arg: T): T { return arg; }",
      metadata: {
        sentiment: 0.9,
        intent: "education",
      },
    },
  ]);
  console.log(`✅ Created ${conversationIds.length} messages in batch\n`);

  // ============
  // READ MESSAGES
  // ============
  console.log("3️⃣ Reading messages...");
  const retrieved = await getMessage(messageId1);
  console.log(`✅ Retrieved message:`, {
    id: retrieved?.id,
    role: retrieved?.role,
    content: retrieved?.content.substring(0, 50) + "...",
  });
  console.log();

  // ============
  // LIST MESSAGES
  // ============
  console.log("4️⃣ Listing messages...");

  // All messages
  const allMessages = await listMessages({
    userId,
    orderDir: "asc",
  });
  console.log(`✅ Found ${allMessages.length} messages total`);

  // User messages only
  const userMessages = await listMessages({
    userId,
    role: "user",
    orderDir: "asc",
  });
  console.log(`✅ Found ${userMessages.length} user messages`);

  // Assistant messages only
  const assistantMessages = await listMessages({
    userId,
    role: "assistant",
    orderDir: "asc",
  });
  console.log(`✅ Found ${assistantMessages.length} assistant messages\n`);

  // ============
  // CONVERSATION HISTORY
  // ============
  console.log("5️⃣ Getting conversation history...");
  const history = await getConversationHistory(userId);
  console.log(`✅ Conversation history (${history.length} messages):`);
  history.forEach((msg, i) => {
    console.log(
      `   ${i + 1}. [${msg.role}] ${msg.content.substring(0, 60)}...`,
    );
  });
  console.log();

  // ============
  // RECENT MESSAGES
  // ============
  console.log("6️⃣ Getting recent messages...");
  const recent = await getRecentMessages(userId, 3);
  console.log(`✅ Last 3 messages (most recent first):`);
  recent.forEach((msg, i) => {
    console.log(
      `   ${i + 1}. [${msg.role}] ${msg.content.substring(0, 60)}...`,
    );
  });
  console.log();

  // ============
  // UPDATE MESSAGE
  // ============
  console.log("7️⃣ Updating message...");
  await updateMessage(messageId1, {
    metadata: {
      sentiment: 0.9,
      intent: "greeting",
      emotionalTone: "friendly",
    },
  });
  const updated = await getMessage(messageId1);
  console.log(`✅ Updated message metadata:`, updated?.metadata);
  console.log();

  // ============
  // MEMORY EXTRACTION TRACKING
  // ============
  console.log("8️⃣ Testing memory extraction tracking...");

  // Get unextracted messages
  const unextracted = await getUnextractedMessages(userId);
  console.log(`✅ Unextracted messages: ${unextracted.length}`);

  // Mark some as extracted
  const toExtract = unextracted.slice(0, 3).map((m) => m.id);
  const extractedCount = await markMessagesAsExtracted(toExtract);
  console.log(`✅ Marked ${extractedCount} messages as extracted`);

  // Check again
  const stillUnextracted = await getUnextractedMessages(userId);
  console.log(
    `✅ Remaining unextracted messages: ${stillUnextracted.length}\n`,
  );

  // ============
  // MESSAGE STATISTICS
  // ============
  console.log("9️⃣ Getting message statistics...");
  const stats = await getMessageStats(userId);
  console.log(`✅ Message statistics:`, {
    total: stats.total,
    byRole: stats.byRole,
    extracted: stats.extracted,
    unextracted: stats.unextracted,
  });
  console.log();

  // ============
  // GET BY IDS
  // ============
  console.log("🔟 Getting messages by IDs...");
  const byIds = await getMessagesByIds([messageId1, messageId2]);
  console.log(`✅ Retrieved ${byIds.length} messages by IDs\n`);

  // ============
  // DELETE OLD MESSAGES
  // ============
  console.log("1️⃣1️⃣ Testing time-based deletion...");
  const cutoffDate = new Date();
  cutoffDate.setMinutes(cutoffDate.getMinutes() - 1); // 1 minute ago
  const deletedCount = await deleteMessagesOlderThan(userId, cutoffDate);
  console.log(`✅ Deleted ${deletedCount} messages older than 1 minute ago\n`);

  // ============
  // DELETE MESSAGE
  // ============
  console.log("1️⃣2️⃣ Deleting a message...");
  await deleteMessage(messageId2);
  const deleted = await getMessage(messageId2);
  console.log(`✅ Message deleted: ${deleted === undefined}\n`);

  // ============
  // COUNT MESSAGES
  // ============
  console.log("1️⃣3️⃣ Counting remaining messages...");
  const totalCount = await countUserMessages(userId);
  console.log(`✅ Total messages remaining: ${totalCount}\n`);

  // ============
  // CLEANUP
  // ============
  console.log("🧹 Cleaning up test data...");
  const { eq } = await import("drizzle-orm");
  await db.delete(user).where(eq(user.id, userId));
  console.log("✅ Test user and all messages deleted (cascade)\n");

  console.log("✨ All tests completed successfully!");
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
