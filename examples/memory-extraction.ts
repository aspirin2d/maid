/**
 * Example end-to-end memory extraction flow using the structured override hook.
 * Run with: bun run examples/memory-extraction.ts
 */

import { createUser, deleteUser } from "../src/db/user";
import {
  createMessage,
  getUnextractedMessages,
  type Message,
} from "../src/db/message";
import {
  createMemory,
  getMemoriesByIds,
  listMemories,
  type Memory,
} from "../src/db/memory";
import {
  extractMemoriesForUser,
  type MemoryExtractionLLMResponse,
} from "../src/memory/extraction";

function logHeading(title: string): void {
  console.log("\n" + "=".repeat(title.length));
  console.log(title);
  console.log("=".repeat(title.length));
}

async function logMemories(label: string, memories: Memory[]): Promise<void> {
  logHeading(label);
  memories.forEach((memory, index) => {
    console.log(`${index + 1}. id=${memory.id}`);
    console.log(`   [${memory.category}] importance=${memory.importanceScore?.toFixed?.(2) ?? "n/a"}, confidence=${memory.confidenceScore?.toFixed?.(2) ?? "n/a"}`);
    console.log(`   content: ${memory.content}`);
    if (memory.metadata) {
      console.log(`   metadata: ${JSON.stringify(memory.metadata)}`);
    }
  });
  if (memories.length === 0) {
    console.log("(none)");
  }
}

async function main(): Promise<void> {
  const userId = await createUser({
    name: "Extraction Example",
    email: `memory-extraction-${Date.now()}@example.com`,
  });
  console.log(`Created test user: ${userId}`);

  try {
    // Seed a baseline memory so we can demonstrate updates + contradiction guards.
    const baseMemoryId = await createMemory(
      {
        userId,
        category: "USER_PREFERENCES",
        content: "User enjoys a strong cup of coffee every morning.",
        summary: "Coffee every morning",
        importanceScore: 7.5,
        confidenceScore: 0.9,
        emotionalWeight: 1.0,
      },
      { skipEmbedding: true },
    );
    console.log(`Seeded baseline memory: ${baseMemoryId}`);

    // Phase 1: Add a new fact about hiking.
    const hikeMessageId = await createMessage({
      userId,
      role: "user",
      content: "Just so you know, I love going on long hikes every weekend.",
    });
    console.log(`Created hike message: ${hikeMessageId}`);

    const phase1Override = async (): Promise<MemoryExtractionLLMResponse> => ({
      memories: [
        {
          category: "USER_PREFERENCES",
          content: "User loves spending weekends on long hikes.",
          summary: "Enjoys long weekend hikes",
          importanceScore: 7,
          confidenceScore: 0.82,
          emotionalWeight: 1.5,
          sourceMessageIds: [hikeMessageId],
          metadata: { rationale: "Manual test override" },
        },
      ],
    });

    const phase1 = await extractMemoriesForUser(userId, {
      llmOverride: phase1Override,
      disableSimilarity: true,
      skipEmbeddingGeneration: true,
    });

    logHeading("Phase 1 Summary");
    console.log(phase1);

    const memoriesAfterPhase1 = await listMemories({ userId, orderBy: "createdAt", orderDir: "desc" });
    await logMemories("Memories after Phase 1", memoriesAfterPhase1);

    // Phase 2: Contradiction with lower confidence -> guard should skip supersede, messages remain unextracted.
    const coffeeChangeMessageId = await createMessage({
      userId,
      role: "user",
      content: "Actually, I've developed a coffee allergy so I avoid it now.",
    });
    console.log(`Created low-confidence contradiction message: ${coffeeChangeMessageId}`);

    const phase2Override = async (): Promise<MemoryExtractionLLMResponse> => ({
      memories: [
        {
          category: "USER_PREFERENCES",
          content: "User avoids coffee due to an allergy.",
          summary: "Coffee allergy",
          importanceScore: 8,
          confidenceScore: 0.3, // Lower than existing 0.9, guard should trigger
          relationship: "contradiction",
          relatedMemoryId: baseMemoryId,
          sourceMessageIds: [coffeeChangeMessageId],
          metadata: { contradiction: true },
        },
      ],
    });

    const phase2 = await extractMemoriesForUser(userId, {
      llmOverride: phase2Override,
      disableSimilarity: true,
      skipEmbeddingGeneration: true,
    });

    logHeading("Phase 2 Summary (guard expected)");
    console.log(phase2);

    const unextractedAfterPhase2 = await getUnextractedMessages(userId);
    logHeading("Unextracted messages after Phase 2");
    unextractedAfterPhase2.forEach((msg: Message) => {
      console.log(`- ${msg.id}: included=${msg.includedInMemoryExtraction}, content="${msg.content}"`);
    });

    // Phase 3: Same contradiction with higher confidence -> supersede the original memory.
    const phase3Override = async (): Promise<MemoryExtractionLLMResponse> => ({
      memories: [
        {
          category: "USER_PREFERENCES",
          content: "User is allergic to coffee and now avoids drinking it.",
          summary: "Avoids coffee due to allergy",
          importanceScore: 8.5,
          confidenceScore: 0.95,
          relationship: "contradiction",
          relatedMemoryId: baseMemoryId,
          sourceMessageIds: [coffeeChangeMessageId],
          metadata: { contradiction: true },
        },
      ],
    });

    const phase3 = await extractMemoriesForUser(userId, {
      llmOverride: phase3Override,
      disableSimilarity: true,
      skipEmbeddingGeneration: true,
    });

    logHeading("Phase 3 Summary (supersede expected)");
    console.log(phase3);

    const finalMemories = await listMemories({ userId, orderBy: "createdAt", orderDir: "desc" });
    await logMemories("Memories after Phase 3", finalMemories);

    const supersededMemory = await getMemoriesByIds([baseMemoryId]);
    await logMemories("Superseded memory record", supersededMemory);
  } finally {
    await deleteUser(userId);
    console.log(`Deleted test user: ${userId}`);
  }
}

main().catch((error) => {
  console.error("Example failed", error);
  process.exit(1);
});
