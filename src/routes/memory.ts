import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  createMemory,
  createMemories,
  getMemory,
  updateMemory,
  softDeleteMemory,
  hardDeleteMemory,
  restoreMemory,
  searchSimilarMemories,
  listMemories,
  bulkSoftDeleteMemories,
  bulkHardDeleteMemories,
  purgeDeletedMemories,
  deleteMemoriesOlderThan,
  getMemoriesByIds,
  getActiveMemories,
  getRecentlyUpdatedMemories,
  getMemoryHistory,
  getMemoriesByAction,
  getDeletedMemories,
  countUserMemories,
  getMemoryStats,
  updateMemoryContent,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  type ListMemoriesOptions,
} from "../memory";

const app = new Hono();

// Schema validators
const createMemorySchema = z.object({
  userId: z.number(),
  content: z.string(),
  category: z.enum(["FACT", "PREFERENCE", "GOAL", "RELATIONSHIP", "OTHER"]).optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  action: z.enum(["ADD", "UPDATE", "DELETE"]).optional(),
  source: z.string().optional(),
  provider: z.enum(["ollama", "openai"]).optional(),
});

const updateMemorySchema = z.object({
  content: z.string().optional(),
  category: z.enum(["FACT", "PREFERENCE", "GOAL", "RELATIONSHIP", "OTHER"]).optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  action: z.enum(["ADD", "UPDATE", "DELETE"]).optional(),
  source: z.string().optional(),
  provider: z.enum(["ollama", "openai"]).optional(),
});

const searchMemoriesSchema = z.object({
  query: z.string(),
  userId: z.number().optional(),
  limit: z.number().optional(),
  provider: z.enum(["ollama", "openai"]).optional(),
  includeDeleted: z.boolean().optional(),
  embedding: z.array(z.number()).optional(),
});

// POST /api/memories - Create a single memory
app.post("/", async (c: Context) => {
  try {
    const body = await c.req.json();
    const input = createMemorySchema.parse(body);
    const { provider, ...memoryInput } = input;

    const memoryId = await createMemory(memoryInput as CreateMemoryInput, provider);
    const memory = await getMemory(memoryId);

    return c.json({ success: true, data: memory }, 201);
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create memory"
    }, 400);
  }
});

// POST /api/memories/batch - Create multiple memories
app.post("/batch", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { memories, provider } = z.object({
      memories: z.array(createMemorySchema.omit({ provider: true })),
      provider: z.enum(["ollama", "openai"]).optional(),
    }).parse(body);

    const memoryIds = await createMemories(memories as CreateMemoryInput[], provider);
    const createdMemories = await getMemoriesByIds(memoryIds);

    return c.json({ success: true, data: createdMemories }, 201);
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create memories"
    }, 400);
  }
});

// GET /api/memories - List memories with filtering
app.get("/", async (c: Context) => {
  try {
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");
    const offset = c.req.query("offset");
    const includeDeleted = c.req.query("includeDeleted");
    const category = c.req.query("category");
    const action = c.req.query("action");
    const minImportance = c.req.query("minImportance");
    const minConfidence = c.req.query("minConfidence");
    const orderBy = c.req.query("orderBy");
    const orderDirection = c.req.query("orderDirection");

    const options: ListMemoriesOptions = {
      ...(userId && { userId: parseInt(userId) }),
      ...(limit && { limit: parseInt(limit) }),
      ...(offset && { offset: parseInt(offset) }),
      ...(includeDeleted && { includeDeleted: includeDeleted === "true" }),
      ...(category && { category: category as any }),
      ...(action && { action: action as any }),
      ...(minImportance && { minImportance: parseFloat(minImportance) }),
      ...(minConfidence && { minConfidence: parseFloat(minConfidence) }),
      ...(orderBy && { orderBy: orderBy as any }),
      ...(orderDirection && { orderDirection: orderDirection as any }),
    };

    const memories = await listMemories(options);
    return c.json({ success: true, data: memories });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list memories"
    }, 400);
  }
});

// GET /api/memories/search - Vector similarity search
app.get("/search", async (c: Context) => {
  try {
    const query = c.req.query("query");
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");
    const provider = c.req.query("provider");
    const includeDeleted = c.req.query("includeDeleted");

    if (!query) {
      return c.json({ success: false, error: "Query parameter is required" }, 400);
    }

    const options = {
      ...(userId && { userId: parseInt(userId) }),
      ...(limit && { limit: parseInt(limit) }),
      ...(provider && { provider: provider as "ollama" | "openai" }),
      ...(includeDeleted && { includeDeleted: includeDeleted === "true" }),
    };

    const results = await searchSimilarMemories(query, options);
    return c.json({ success: true, data: results });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to search memories"
    }, 400);
  }
});

// GET /api/memories/stats - Get memory statistics
app.get("/stats", async (c: Context) => {
  try {
    const userId = c.req.query("userId");

    if (!userId) {
      return c.json({ success: false, error: "userId query parameter is required" }, 400);
    }

    const stats = await getMemoryStats(parseInt(userId));
    return c.json({ success: true, data: stats });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get memory stats"
    }, 400);
  }
});

// GET /api/memories/active - Get active (non-deleted) memories
app.get("/active", async (c: Context) => {
  try {
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");

    if (!userId) {
      return c.json({ success: false, error: "userId query parameter is required" }, 400);
    }

    const memories = await getActiveMemories(
      parseInt(userId),
      limit ? parseInt(limit) : undefined
    );
    return c.json({ success: true, data: memories });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get active memories"
    }, 400);
  }
});

// GET /api/memories/recent - Get recently updated memories
app.get("/recent", async (c: Context) => {
  try {
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");

    if (!userId) {
      return c.json({ success: false, error: "userId query parameter is required" }, 400);
    }

    const memories = await getRecentlyUpdatedMemories(
      parseInt(userId),
      limit ? parseInt(limit) : undefined
    );
    return c.json({ success: true, data: memories });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get recent memories"
    }, 400);
  }
});

// GET /api/memories/deleted - Get soft-deleted memories
app.get("/deleted", async (c: Context) => {
  try {
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");

    if (!userId) {
      return c.json({ success: false, error: "userId query parameter is required" }, 400);
    }

    const memories = await getDeletedMemories(
      parseInt(userId),
      limit ? parseInt(limit) : undefined
    );
    return c.json({ success: true, data: memories });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get deleted memories"
    }, 400);
  }
});

// GET /api/memories/history - Get memory history
app.get("/history", async (c: Context) => {
  try {
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");
    const includeDeleted = c.req.query("includeDeleted");

    if (!userId) {
      return c.json({ success: false, error: "userId query parameter is required" }, 400);
    }

    const options = {
      ...(limit && { limit: parseInt(limit) }),
      ...(includeDeleted && { includeDeleted: includeDeleted === "true" }),
    };

    const history = await getMemoryHistory(parseInt(userId), options);
    return c.json({ success: true, data: history });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get memory history"
    }, 400);
  }
});

// GET /api/memories/:id - Get a single memory by ID
app.get("/:id", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    const memory = await getMemory(id);

    if (!memory) {
      return c.json({ success: false, error: "Memory not found" }, 404);
    }

    return c.json({ success: true, data: memory });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get memory"
    }, 400);
  }
});

// PUT /api/memories/:id - Update a memory
app.put("/:id", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const updates = updateMemorySchema.parse(body);
    const { provider, ...memoryUpdates } = updates;

    await updateMemory(id, memoryUpdates as UpdateMemoryInput, provider);
    const updated = await getMemory(id);

    return c.json({ success: true, data: updated });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update memory"
    }, 400);
  }
});

// PATCH /api/memories/:id/content - Update memory content only
app.patch("/:id/content", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const { content, provider } = z.object({
      content: z.string(),
      provider: z.enum(["ollama", "openai"]).optional(),
    }).parse(body);

    await updateMemoryContent(id, content, provider);
    const updated = await getMemory(id);

    return c.json({ success: true, data: updated });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update memory content"
    }, 400);
  }
});

// DELETE /api/memories/:id - Soft delete a memory
app.delete("/:id", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    await softDeleteMemory(id);

    return c.json({ success: true, message: "Memory soft deleted" });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to soft delete memory"
    }, 400);
  }
});

// DELETE /api/memories/:id/hard - Hard delete a memory
app.delete("/:id/hard", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    await hardDeleteMemory(id);

    return c.json({ success: true, message: "Memory permanently deleted" });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to hard delete memory"
    }, 400);
  }
});

// POST /api/memories/:id/restore - Restore a soft-deleted memory
app.post("/:id/restore", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    await restoreMemory(id);
    const restored = await getMemory(id);

    return c.json({ success: true, data: restored });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to restore memory"
    }, 400);
  }
});

// POST /api/memories/bulk-delete - Bulk soft delete memories
app.post("/bulk-delete", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { memoryIds } = z.object({
      memoryIds: z.array(z.number()),
    }).parse(body);

    await bulkSoftDeleteMemories(memoryIds);

    return c.json({ success: true, message: `${memoryIds.length} memories soft deleted` });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to bulk soft delete memories"
    }, 400);
  }
});

// POST /api/memories/bulk-hard-delete - Bulk hard delete memories
app.post("/bulk-hard-delete", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { memoryIds } = z.object({
      memoryIds: z.array(z.number()),
    }).parse(body);

    await bulkHardDeleteMemories(memoryIds);

    return c.json({ success: true, message: `${memoryIds.length} memories permanently deleted` });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to bulk hard delete memories"
    }, 400);
  }
});

// POST /api/memories/purge-deleted - Purge all soft-deleted memories for a user
app.post("/purge-deleted", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { userId } = z.object({
      userId: z.number(),
    }).parse(body);

    const count = await purgeDeletedMemories(userId);

    return c.json({ success: true, message: `${count} deleted memories purged` });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to purge deleted memories"
    }, 400);
  }
});

// POST /api/memories/delete-older-than - Delete memories older than a cutoff date
app.post("/delete-older-than", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { userId, cutoffDate } = z.object({
      userId: z.number(),
      cutoffDate: z.string().transform((val: string) => new Date(val)),
    }).parse(body);

    const count = await deleteMemoriesOlderThan(userId, cutoffDate);

    return c.json({ success: true, message: `${count} memories deleted` });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete old memories"
    }, 400);
  }
});

export default app;
