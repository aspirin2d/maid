import { eq, sql } from "drizzle-orm";
import type { Provider } from "../src/llm";

// Parse command line arguments
function parseArgs(): { provider: Provider } {
  const args = process.argv.slice(2);
  let provider: Provider = "ollama";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Usage: bun examples/memory-extraction.ts [options]

Options:
  --provider <name>  Set the LLM/embedding provider (default: ollama)
                     Valid values: openai, ollama
  --help, -h         Show this help message

Examples:
  bun examples/memory-extraction.ts
  bun examples/memory-extraction.ts --provider openai
  bun examples/memory-extraction.ts --provider ollama
`);
      process.exit(0);
    }

    if (args[i] === "--provider" && args[i + 1]) {
      const value = args[i + 1];
      if (value === "openai" || value === "ollama") {
        provider = value;
      } else {
        console.error(
          `Invalid provider: ${value}. Must be "openai" or "ollama"`,
        );
        process.exit(1);
      }
      i++;
    }
  }

  return { provider };
}

const { provider } = parseArgs();
console.log(`Using provider: ${provider}`);

// Use an in-memory SQLite database unless the caller overrides it.
if (!process.env.SQLITE_DB_PATH) {
  process.env.SQLITE_DB_PATH = ":memory:";
}

const [{ default: db }, { user }] = await Promise.all([
  import("../src/db/index"),
  import("../src/db/schema"),
]);

const [{ createMessages }, { listMemories }] = await Promise.all([
  import("../src/message"),
  import("../src/memory"),
]);

const [{ runMemoryExtraction }] = await Promise.all([
  import("../src/extraction"),
]);

async function seedMessages(userId: number) {
  await createMessages(
    [
      {
        userId,
        role: "user",
        content:
          "Hi assistant! I'm Jordan. I live in Denver and absolutely love trail running on weekends.",
        extracted: false,
      },
      {
        userId,
        role: "assistant",
        content:
          "Nice to meet you, Jordan! I'll remember your love for trail running.",
        extracted: false,
      },
      {
        userId,
        role: "user",
        content:
          "Also, my go-to coffee order is a flat white, and I'm training for a half marathon this fall.",
        extracted: false,
      },
    ],
    db,
  );
}

async function appendAdditionalMessages(userId: number) {
  await createMessages(
    [
      {
        userId,
        role: "user",
        content:
          "Hey again, it's still Jordan - friends call me Jo. Trail running on weekends is still my favorite way to unwind!",
        extracted: false,
      },
      {
        userId,
        role: "assistant",
        content: "Got it, Jo! Trail running stays top of mind.",
        extracted: false,
      },
      {
        userId,
        role: "user",
        content:
          "I actually moved to Seattle last month, though I'm back in Denver every few weeks to see family.",
        extracted: false,
      },
      {
        userId,
        role: "assistant",
        content:
          "Thanks for the update - I'll note Seattle as home base and the frequent Denver trips.",
        extracted: false,
      },
      {
        userId,
        role: "user",
        content:
          "My coffee tastes are evolving - I'm craving cappuccinos lately, but I still order flat whites out of habit.",
        extracted: false,
      },
      {
        userId,
        role: "assistant",
        content:
          "Thanks for sharing - I'll keep both cappuccinos and flat whites in mind.",
        extracted: false,
      },
      {
        userId,
        role: "user",
        content:
          "I'm considering switching my half marathon training to focus on a trail ultra instead.",
        extracted: false,
      },
      {
        userId,
        role: "assistant",
        content:
          "A trail ultra sounds exciting - I'll track both race goals so we can revisit.",
        extracted: false,
      },
    ],
    db,
  );
}

async function cleanupUserData(userId: number | null) {
  if (!userId) {
    return;
  }

  try {
    // const allMemories = await listMemories({
    //   userId,
    //   includeDeleted: true,
    //   orderBy: "createdAt",
    //   orderDir: "asc",
    // });
    //
    // for (const record of allMemories) {
    //   db.run(
    //     sql`DELETE FROM vec_memories WHERE memory_id = ${String(record.id)}`,
    //   );
    // }
    //
    await db.delete(user).where(eq(user.id, userId));
  } catch (error) {
    console.error("Cleanup failed:", error);
  }
}

async function main() {
  const userLabel = `Example User ${Date.now()}`;
  const [createdUser] = await db
    .insert(user)
    .values({ name: userLabel })
    .returning({ id: user.id });

  if (!createdUser) {
    throw new Error("Failed to create example user");
  }

  const createdUserId = createdUser.id;

  try {
    await seedMessages(createdUserId);

    const extraction = await runMemoryExtraction({
      userId: createdUserId,
      embeddingProvider: provider,
      memoryProvider: provider,
      llmProvider: provider,
    });

    console.log("=== Memory Extraction Result ===");
    console.dir(
      {
        messages: extraction.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          extracted: m.extracted,
        })),
        facts: extraction.facts,
        decisions: extraction.decisions,
        createdMemoryIds: extraction.createdMemoryIds,
        updatedMemoryIds: extraction.updatedMemoryIds,
        markedMessageIds: extraction.markedMessageIds,
      },
      { depth: null },
    );

    await appendAdditionalMessages(createdUserId);

    const followUpExtraction = await runMemoryExtraction({
      userId: createdUserId,
      embeddingProvider: provider,
      memoryProvider: provider,
      llmProvider: provider,
    });

    console.log("=== Memory Extraction Result After Additional Messages ===");
    console.dir(
      {
        messages: followUpExtraction.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          extracted: m.extracted,
        })),
        facts: followUpExtraction.facts,
        decisions: followUpExtraction.decisions,
        createdMemoryIds: followUpExtraction.createdMemoryIds,
        updatedMemoryIds: followUpExtraction.updatedMemoryIds,
        markedMessageIds: followUpExtraction.markedMessageIds,
      },
      { depth: null },
    );

    const finalMemories = await listMemories({
      userId: createdUserId,
      orderBy: "createdAt",
      orderDir: "asc",
    });

    console.log("=== Final Memories ===");
    console.dir(
      finalMemories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        prevContent: memory.prevContent,
        category: memory.category,
        action: memory.action,
      })),
      { depth: null },
    );
  } finally {
    await cleanupUserData(createdUserId);
  }
}

main().catch((error) => {
  console.error("Example failed:", error);
  process.exit(1);
});
