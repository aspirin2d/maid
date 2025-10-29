import {
  eq,
  and,
  desc,
  asc,
  sql,
  gte,
  lte,
  inArray,
  type InferSelectModel,
  type InferInsertModel,
} from "drizzle-orm";
import db from "./index";
import { memory } from "./schema";
import { embedText, embedTexts, type Provider, EMBEDDING_DIMS } from "../llm";

// ============
// Types
// ============

export type Memory = InferSelectModel<typeof memory>;
export type NewMemory = InferInsertModel<typeof memory>;

// Create input type - only require essential fields
export type CreateMemoryInput = Pick<
  NewMemory,
  "userId" | "category" | "content"
> &
  Partial<
    Omit<
      NewMemory,
      | "id"
      | "userId"
      | "category"
      | "content"
      | "createdAt"
      | "updatedAt"
      | "accessCount"
      | "lastAccessedAt"
    >
  >;

// Update input type - all fields optional except automatic ones
export type UpdateMemoryInput = Partial<
  Omit<
    NewMemory,
    | "id"
    | "userId"
    | "createdAt"
    | "updatedAt"
    | "accessCount"
    | "lastAccessedAt"
  >
>;

export interface ListMemoriesOptions {
  userId: string;
  category?: Memory["category"];
  status?: Memory["status"];
  minImportance?: number;
  maxImportance?: number;
  temporalContext?: Memory["temporalContext"];
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "importance" | "lastAccessed" | "accessCount";
  orderDir?: "asc" | "desc";
}

export interface SimilaritySearchOptions {
  userId: string;
  query: string;
  provider?: Provider;
  limit?: number;
  minSimilarity?: number;
  category?: Memory["category"];
  status?: Memory["status"];
}

// ============
// Helper Functions
// ============

/**
 * Generate embedding for text and store it in vec_memories
 */
async function generateAndStoreEmbedding(
  memoryId: string,
  text: string,
  provider: Provider = "ollama",
): Promise<void> {
  try {
    // Generate embedding
    const embedding = await embedText(provider, text, EMBEDDING_DIMS);

    // Convert embedding array to SQLite-vec format (serialized floats)
    const embeddingBlob = new Float32Array(embedding);

    // Get the underlying SQLite connection from Drizzle
    const sqlite = (db as any).$client as any;

    // Insert or replace the embedding in vec_memories
    sqlite
      .prepare(
        `
      INSERT OR REPLACE INTO vec_memories(memory_id, embedding)
      VALUES (?, ?)
    `,
      )
      .run(memoryId, embeddingBlob);
  } catch (error) {
    console.error(
      `Failed to generate embedding for memory ${memoryId}:`,
      error,
    );
    throw error;
  }
}

/**
 * Increment access count and update last accessed timestamp
 */
async function trackMemoryAccess(memoryId: string): Promise<void> {
  await db
    .update(memory)
    .set({
      accessCount: sql`${memory.accessCount} + 1`,
      lastAccessedAt: new Date(),
    })
    .where(eq(memory.id, memoryId));
}

// ============
// CRUD Operations
// ============

/**
 * Create a new memory with automatic embedding generation
 */
export async function createMemory(
  input: CreateMemoryInput,
  options?: { provider?: Provider; skipEmbedding?: boolean },
): Promise<string> {
  const provider = options?.provider ?? "ollama";

  // Insert memory into database
  const [inserted] = await db
    .insert(memory)
    .values({
      userId: input.userId,
      category: input.category,
      content: input.content,
      summary: input.summary,
      importanceScore: input.importanceScore ?? 5.0,
      confidenceScore: input.confidenceScore ?? 1.0,
      emotionalWeight: input.emotionalWeight ?? 0,
      sourceMessageIds: input.sourceMessageIds,
      temporalContext: input.temporalContext ?? "always",
      decayRate: input.decayRate ?? 0.1,
      metadata: input.metadata,
    })
    .returning({ id: memory.id });

  if (!inserted) {
    throw new Error("Failed to create memory");
  }

  // Generate and store embedding unless explicitly skipped
  if (!options?.skipEmbedding) {
    const embeddingText = input.content;
    await generateAndStoreEmbedding(inserted.id, embeddingText, provider);
  }

  return inserted.id;
}

/**
 * Create multiple memories at once with batch embedding generation
 * More efficient than creating memories one by one
 */
export async function createMemories(
  inputs: CreateMemoryInput[],
  options?: { provider?: Provider; skipEmbedding?: boolean },
): Promise<string[]> {
  const provider = options?.provider ?? "ollama";

  if (inputs.length === 0) {
    return [];
  }

  // Insert all memories into database
  const insertedRecords = await db
    .insert(memory)
    .values(
      inputs.map((input) => ({
        userId: input.userId,
        category: input.category,
        content: input.content,
        summary: input.summary,
        importanceScore: input.importanceScore ?? 5.0,
        confidenceScore: input.confidenceScore ?? 1.0,
        emotionalWeight: input.emotionalWeight ?? 0,
        sourceMessageIds: input.sourceMessageIds,
        temporalContext: input.temporalContext ?? "always",
        decayRate: input.decayRate ?? 0.1,
        metadata: input.metadata,
      })),
    )
    .returning({ id: memory.id });

  const memoryIds = insertedRecords.map((r) => r.id);

  // Generate and store embeddings unless explicitly skipped
  if (!options?.skipEmbedding) {
    // Prepare texts for batch embedding
    const embeddingTexts = inputs.map((input) => input.content);

    try {
      // Generate embeddings in batch (more efficient)
      const embeddings = await embedTexts(
        provider,
        embeddingTexts,
        EMBEDDING_DIMS,
      );

      // Get the underlying SQLite connection
      const sqlite = (db as any).$client as any;

      // Store all embeddings
      const stmt = sqlite.prepare(
        `INSERT OR REPLACE INTO vec_memories(memory_id, embedding) VALUES (?, ?)`,
      );

      for (let i = 0; i < memoryIds.length; i++) {
        const embeddingBlob = new Float32Array(embeddings[i]!);
        stmt.run(memoryIds[i], embeddingBlob);
      }
    } catch (error) {
      console.error("Failed to generate batch embeddings:", error);
      throw error;
    }
  }

  return memoryIds;
}

/**
 * Get a memory by ID and track access
 */
export async function getMemory(
  memoryId: string,
  options?: { trackAccess?: boolean },
): Promise<Memory | undefined> {
  const result = await db
    .select()
    .from(memory)
    .where(eq(memory.id, memoryId))
    .limit(1);

  if (result.length === 0) {
    return undefined;
  }

  // Track access unless explicitly disabled
  if (options?.trackAccess !== false) {
    await trackMemoryAccess(memoryId);
  }

  return result[0];
}

/**
 * Update a memory and regenerate embedding if content changed
 */
export async function updateMemory(
  memoryId: string,
  updates: UpdateMemoryInput,
  options?: { provider?: Provider; skipEmbedding?: boolean },
): Promise<boolean> {
  const provider = options?.provider ?? "ollama";

  // Update the memory
  const result = await db
    .update(memory)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(memory.id, memoryId))
    .returning({ id: memory.id });

  if (result.length === 0) {
    return false;
  }

  // Regenerate embedding if content changed
  if (!options?.skipEmbedding && updates.content !== undefined) {
    // Fetch the updated memory to get the latest content
    const updated = await getMemory(memoryId, { trackAccess: false });
    if (updated) {
      const embeddingText = updated.content;
      await generateAndStoreEmbedding(memoryId, embeddingText, provider);
    }
  }

  return true;
}

/**
 * Delete a memory (soft delete by setting status to 'deleted')
 */
export async function deleteMemory(
  memoryId: string,
  options?: { hard?: boolean },
): Promise<boolean> {
  if (options?.hard) {
    // Hard delete - removes the memory completely
    // The trigger will automatically clean up vec_memories
    const result = await db
      .delete(memory)
      .where(eq(memory.id, memoryId))
      .returning({ id: memory.id });
    return result.length > 0;
  }

  // Soft delete - mark as deleted
  return await updateMemory(
    memoryId,
    { status: "deleted" },
    { skipEmbedding: true },
  );
}

/**
 * List memories with filtering and pagination
 */
export async function listMemories(
  options: ListMemoriesOptions,
): Promise<Memory[]> {
  let query = db.select().from(memory);

  // Build WHERE conditions
  const conditions = [eq(memory.userId, options.userId)];

  if (options.category) {
    conditions.push(eq(memory.category, options.category));
  }

  if (options.status) {
    conditions.push(eq(memory.status, options.status));
  }

  if (options.minImportance !== undefined) {
    conditions.push(gte(memory.importanceScore, options.minImportance));
  }

  if (options.maxImportance !== undefined) {
    conditions.push(lte(memory.importanceScore, options.maxImportance));
  }

  if (options.temporalContext) {
    conditions.push(eq(memory.temporalContext, options.temporalContext));
  }

  query = query.where(and(...conditions)) as any;

  // Order by
  const orderBy = options.orderBy ?? "createdAt";
  const orderDir = options.orderDir ?? "desc";
  const orderFn = orderDir === "desc" ? desc : asc;

  switch (orderBy) {
    case "importance":
      query = query.orderBy(orderFn(memory.importanceScore)) as any;
      break;
    case "lastAccessed":
      query = query.orderBy(orderFn(memory.lastAccessedAt)) as any;
      break;
    case "accessCount":
      query = query.orderBy(orderFn(memory.accessCount)) as any;
      break;
    default:
      query = query.orderBy(orderFn(memory.createdAt)) as any;
  }

  // Pagination
  if (options.limit) {
    query = query.limit(options.limit) as any;
  }

  if (options.offset) {
    query = query.offset(options.offset) as any;
  }

  return await query;
}

/**
 * Get memories by multiple IDs
 */
export async function getMemoriesByIds(memoryIds: string[]): Promise<Memory[]> {
  if (memoryIds.length === 0) {
    return [];
  }

  return await db.select().from(memory).where(inArray(memory.id, memoryIds));
}

// ============
// Similarity Search
// ============

export interface SimilaritySearchResult {
  memory: Memory;
  similarity: number;
}

/**
 * Search for similar memories using vector similarity
 */
export async function searchSimilarMemories(
  options: SimilaritySearchOptions,
): Promise<SimilaritySearchResult[]> {
  const provider = options.provider ?? "ollama";
  const limit = options.limit ?? 10;
  const minSimilarity = options.minSimilarity ?? 0.5;

  // Generate query embedding
  const queryEmbedding = await embedText(
    provider,
    options.query,
    EMBEDDING_DIMS,
  );
  const queryBlob = new Float32Array(queryEmbedding);

  // Get the underlying SQLite connection
  const sqlite = (db as any).$client as any;

  // Build the SQL query for similarity search using sqlite-vec syntax
  // Note: vec0 requires 'k = ?' constraint for K-NN search
  let sqlQuery = `
    SELECT
      m.id,
      m.user_id,
      m.category,
      m.content,
      m.summary,
      m.importance_score,
      m.confidence_score,
      m.emotional_weight,
      m.access_count,
      m.last_accessed_at,
      m.created_at,
      m.updated_at,
      m.source_message_ids,
      m.temporal_context,
      m.decay_rate,
      m.status,
      m.metadata,
      v.distance as similarity
    FROM vec_memories v
    INNER JOIN memory m ON v.memory_id = m.id
    WHERE v.embedding MATCH ?
      AND k = ?
  `;

  const params: any[] = [queryBlob, limit];

  // Add user filter and other conditions after the JOIN
  sqlQuery = `
    SELECT * FROM (
      ${sqlQuery}
    ) WHERE user_id = ?
  `;
  params.push(options.userId);

  // Add optional filters
  if (options.category) {
    sqlQuery += " AND category = ?";
    params.push(options.category);
  }

  if (options.status) {
    sqlQuery += " AND status = ?";
    params.push(options.status);
  } else {
    // Default to active memories only
    sqlQuery += " AND status = 'active'";
  }

  // Add similarity filter
  if (minSimilarity > 0) {
    sqlQuery += " AND similarity > ?";
    params.push(minSimilarity);
  }

  // Note: vec0 returns results sorted by distance ASC (closest first)
  // which is what we want for similarity search

  // Execute the query
  const results = sqlite.prepare(sqlQuery).all(...params) as any[];

  // Transform results
  return results.map((row) => ({
    memory: {
      id: row.id,
      userId: row.user_id,
      category: row.category,
      content: row.content,
      summary: row.summary,
      importanceScore: row.importance_score,
      confidenceScore: row.confidence_score,
      emotionalWeight: row.emotional_weight,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at
        ? new Date(row.last_accessed_at * 1000)
        : null,
      createdAt: new Date(row.created_at * 1000),
      updatedAt: row.updated_at ? new Date(row.updated_at * 1000) : null,
      sourceMessageIds: row.source_message_ids
        ? JSON.parse(row.source_message_ids)
        : null,
      temporalContext: row.temporal_context,
      decayRate: row.decay_rate,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    },
    similarity: row.similarity,
  }));
}

/**
 * Get the most important memories for a user
 */
export async function getTopMemories(
  userId: string,
  limit = 10,
): Promise<Memory[]> {
  return await db
    .select()
    .from(memory)
    .where(and(eq(memory.userId, userId), eq(memory.status, "active")))
    .orderBy(desc(memory.importanceScore), desc(memory.accessCount))
    .limit(limit);
}

/**
 * Archive old or low-importance memories
 */
export async function archiveMemories(
  userId: string,
  options?: {
    olderThanDays?: number;
    maxImportance?: number;
    limit?: number;
  },
): Promise<number> {
  const conditions = [eq(memory.userId, userId), eq(memory.status, "active")];

  if (options?.olderThanDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.olderThanDays);
    conditions.push(lte(memory.createdAt, cutoffDate));
  }

  if (options?.maxImportance !== undefined) {
    conditions.push(lte(memory.importanceScore, options.maxImportance));
  }

  let query = db
    .update(memory)
    .set({ status: "archived" })
    .where(and(...conditions));

  if (options?.limit) {
    // SQLite doesn't support LIMIT in UPDATE, so we need to select IDs first
    const toArchive = await db
      .select({ id: memory.id })
      .from(memory)
      .where(and(...conditions))
      .limit(options.limit);

    if (toArchive.length === 0) {
      return 0;
    }

    const result = await db
      .update(memory)
      .set({ status: "archived" })
      .where(
        inArray(
          memory.id,
          toArchive.map((m) => m.id),
        ),
      )
      .returning({ id: memory.id });

    return result.length;
  }

  const result = await query.returning({ id: memory.id });
  return result.length;
}
