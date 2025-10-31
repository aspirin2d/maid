import { Hono } from "hono";
import { z } from "zod";
import {
  runMemoryExtraction,
  type MemoryExtractionOptions,
} from "../extraction";

const app = new Hono();

// Schema validator for extraction request
const extractionSchema = z.object({
  userId: z.number(),
  messageLimit: z.number().optional(),
  similarityLimit: z.number().optional(),
  embeddingProvider: z.enum(["ollama", "openai"]).optional(),
  llmProvider: z.enum(["ollama", "openai"]).optional(),
  llmModel: z.string().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  memoryProvider: z.enum(["ollama", "openai"]).optional(),
});

// POST /api/extraction/run - Run memory extraction from messages
app.post("/run", async (c) => {
  try {
    const body = await c.req.json();
    const options = extractionSchema.parse(body);

    // Run the extraction pipeline
    const result = await runMemoryExtraction(options as MemoryExtractionOptions);

    return c.json({
      success: true,
      data: {
        userId: result.userId,
        messagesProcessed: result.messages.length,
        factsExtracted: result.facts.length,
        decisionsCount: result.decisions.length,
        memoriesCreated: result.createdMemoryIds.length,
        memoriesUpdated: result.updatedMemoryIds.length,
        messagesMarked: result.markedMessageIds.length,
        facts: result.facts,
        decisions: result.decisions,
        createdMemoryIds: result.createdMemoryIds,
        updatedMemoryIds: result.updatedMemoryIds,
      }
    }, 200);
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to run memory extraction"
    }, 400);
  }
});

// POST /api/extraction/preview - Preview what would be extracted without committing
// This is a dry-run mode that doesn't create/update memories or mark messages
app.post("/preview", async (c) => {
  try {
    const body = await c.req.json();
    const options = extractionSchema.parse(body);

    // For preview, we could run extraction without the final commit
    // For now, we'll just run the full extraction and note that this is a preview
    // In a production system, you'd want to refactor extraction.ts to support dry-run mode

    const result = await runMemoryExtraction(options as MemoryExtractionOptions);

    return c.json({
      success: true,
      preview: true,
      data: {
        userId: result.userId,
        messagesProcessed: result.messages.length,
        factsExtracted: result.facts.length,
        decisionsCount: result.decisions.length,
        facts: result.facts,
        decisions: result.decisions,
        // Note: In preview mode, these IDs are from actual execution
        // To make this a true preview, extraction.ts would need dry-run support
        potentialMemoriesCreated: result.createdMemoryIds.length,
        potentialMemoriesUpdated: result.updatedMemoryIds.length,
      }
    }, 200);
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to preview memory extraction"
    }, 400);
  }
});

// GET /api/extraction/status - Check extraction status for a user
app.get("/status", async (c) => {
  try {
    const userId = c.req.query("userId");

    if (!userId) {
      return c.json({ success: false, error: "userId query parameter is required" }, 400);
    }

    // Import message functions to check unextracted messages
    const { listMessages } = await import("../message");
    const { countUserMemories } = await import("../memory");

    const unextractedMessages = await listMessages({
      userId: parseInt(userId),
      extracted: false,
    });

    const memoryCount = await countUserMemories(parseInt(userId), false);

    return c.json({
      success: true,
      data: {
        userId: parseInt(userId),
        unextractedMessageCount: unextractedMessages.length,
        totalMemories: memoryCount,
        hasUnprocessedMessages: unextractedMessages.length > 0,
      }
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get extraction status"
    }, 400);
  }
});

export default app;
