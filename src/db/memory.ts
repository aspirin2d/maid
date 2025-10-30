import {
  eq,
  and,
  desc,
  asc,
  gte,
  lte,
  inArray,
  sql,
  type InferSelectModel,
  type InferInsertModel,
} from "drizzle-orm";
import db from "./index";
import { memory } from "./schema";
import { embedText, type Provider } from "../llm";

// ============
// Types
// ============

export type Memory = InferSelectModel<typeof memory>;
export type NewMemory = InferInsertModel<typeof memory>;

// Create input type - only require essential fields
export type CreateMemoryInput = Pick<NewMemory, "userId" | "content"> &
  Partial<
    Omit<
      NewMemory,
      "id" | "userId" | "content" | "createdAt" | "updatedAt"
    >
  >;

// Update input type - all fields optional except automatic ones
export type UpdateMemoryInput = Partial<
  Omit<NewMemory, "id" | "userId" | "createdAt">
>;

export interface ListMemoriesOptions {
  userId: string;
  action?: Memory["action"];
  includeDeleted?: boolean;
  afterCreatedAt?: Date;
  beforeCreatedAt?: Date;
  afterUpdatedAt?: Date;
  beforeUpdatedAt?: Date;
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "updatedAt";
  orderDir?: "asc" | "desc";
}

// ============
// Embedding Operations
// ============

/**
 * Insert or update embedding in vec_memories table
 */
async function upsertMemoryEmbedding(
  memoryId: number,
  content: string,
  provider: Provider = "ollama",
): Promise<void> {
  if (!content) {
    return;
  }

  // Generate embedding
  const embedding = await embedText(provider, content);

  // Delete existing embedding if any
  await db.run(
    sql`DELETE FROM vec_memories WHERE memory_id = ${String(memoryId)}`,
  );

  // Insert new embedding
  await db.run(
    sql`INSERT INTO vec_memories(memory_id, embedding, payload)
        VALUES (${String(memoryId)}, ${JSON.stringify(embedding)}, ${content})`,
  );
}

/**
 * Search for similar memories using vector similarity with optimized INNER JOIN
 */
export async function searchSimilarMemories(
  query: string,
  options: {
    userId: string;
    limit?: number;
    provider?: Provider;
    includeDeleted?: boolean;
  },
): Promise<Array<Memory & { distance: number }>> {
  const { userId, limit = 10, provider = "ollama", includeDeleted = false } = options;

  // Generate embedding for the query
  const queryEmbedding = await embedText(provider, query);

  // Optimized: Use INNER JOIN to fetch memory rows and distances in a single query
  const results = await db.all<Memory & { distance: number }>(
    sql`
      SELECT
        m.id,
        m.user_id,
        m.content,
        m.previous_content,
        m.action,
        m.deleted,
        m.created_at,
        m.updated_at,
        v.distance
      FROM vec_memories v
      INNER JOIN memory m ON CAST(v.memory_id AS INTEGER) = m.id
      WHERE v.embedding MATCH ${JSON.stringify(queryEmbedding)}
        AND m.user_id = ${userId}
        ${includeDeleted ? sql`` : sql`AND m.deleted = 0`}
        AND k = ${limit}
      ORDER BY v.distance
    `,
  );

  return results;
}

// ============
// CRUD Operations
// ============

/**
 * Create a new memory entry with embedding
 */
export async function createMemory(
  input: CreateMemoryInput,
  provider: Provider = "ollama",
): Promise<number> {
  const [inserted] = await db
    .insert(memory)
    .values({
      userId: input.userId,
      content: input.content,
      prevContent: input.prevContent,
      action: input.action ?? "ADD",
      deleted: input.deleted ?? 0,
    })
    .returning({ id: memory.id });

  if (!inserted) {
    throw new Error("Failed to create memory");
  }

  // Generate and store embedding if content exists
  if (input.content) {
    await upsertMemoryEmbedding(inserted.id, input.content, provider);
  }

  return inserted.id;
}

/**
 * Create multiple memory entries at once with embeddings
 */
export async function createMemories(
  inputs: CreateMemoryInput[],
  provider: Provider = "ollama",
): Promise<number[]> {
  if (inputs.length === 0) {
    return [];
  }

  const insertedRecords = await db
    .insert(memory)
    .values(
      inputs.map((input) => ({
        userId: input.userId,
        content: input.content,
        prevContent: input.prevContent,
        action: input.action ?? "ADD",
        deleted: input.deleted ?? 0,
      })),
    )
    .returning({ id: memory.id });

  // Generate and store embeddings for all memories with content
  await Promise.all(
    insertedRecords.map(async (record, index) => {
      const content = inputs[index]?.content;
      if (content) {
        await upsertMemoryEmbedding(record.id, content, provider);
      }
    }),
  );

  return insertedRecords.map((r) => r.id);
}

/**
 * Get a memory by ID
 */
export async function getMemory(
  memoryId: number,
): Promise<Memory | undefined> {
  const result = await db
    .select()
    .from(memory)
    .where(eq(memory.id, memoryId))
    .limit(1);

  return result[0];
}

/**
 * Update a memory entry with automatic embedding regeneration
 * Automatically updates the updatedAt timestamp
 */
export async function updateMemory(
  memoryId: number,
  updates: UpdateMemoryInput,
  provider: Provider = "ollama",
): Promise<boolean> {
  const result = await db
    .update(memory)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(memory.id, memoryId))
    .returning({ id: memory.id });

  // Regenerate embedding if content was updated
  if (result.length > 0 && updates.content) {
    await upsertMemoryEmbedding(memoryId, updates.content, provider);
  }

  return result.length > 0;
}

/**
 * Soft delete a memory (sets deleted flag to 1)
 */
export async function softDeleteMemory(memoryId: number): Promise<boolean> {
  const result = await db
    .update(memory)
    .set({
      deleted: 1,
      action: "DELETE",
      updatedAt: new Date(),
    })
    .where(eq(memory.id, memoryId))
    .returning({ id: memory.id });

  return result.length > 0;
}

/**
 * Hard delete a memory (permanently removes from database)
 */
export async function hardDeleteMemory(memoryId: number): Promise<boolean> {
  const result = await db
    .delete(memory)
    .where(eq(memory.id, memoryId))
    .returning({ id: memory.id });

  return result.length > 0;
}

/**
 * Restore a soft-deleted memory
 */
export async function restoreMemory(memoryId: number): Promise<boolean> {
  const result = await db
    .update(memory)
    .set({
      deleted: 0,
      updatedAt: new Date(),
    })
    .where(eq(memory.id, memoryId))
    .returning({ id: memory.id });

  return result.length > 0;
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

  // By default, exclude deleted memories unless explicitly requested
  if (!options.includeDeleted) {
    conditions.push(eq(memory.deleted, 0));
  }

  if (options.action) {
    conditions.push(eq(memory.action, options.action));
  }

  if (options.afterCreatedAt) {
    conditions.push(gte(memory.createdAt, options.afterCreatedAt));
  }

  if (options.beforeCreatedAt) {
    conditions.push(lte(memory.createdAt, options.beforeCreatedAt));
  }

  if (options.afterUpdatedAt) {
    conditions.push(gte(memory.updatedAt, options.afterUpdatedAt));
  }

  if (options.beforeUpdatedAt) {
    conditions.push(lte(memory.updatedAt, options.beforeUpdatedAt));
  }

  query = query.where(and(...conditions)) as any;

  // Order by timestamp
  const orderBy = options.orderBy ?? "createdAt";
  const orderDir = options.orderDir ?? "desc";
  const orderFn = orderDir === "desc" ? desc : asc;
  const orderColumn = orderBy === "updatedAt" ? memory.updatedAt : memory.createdAt;

  query = query.orderBy(orderFn(orderColumn)) as any;

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
export async function getMemoriesByIds(
  memoryIds: number[],
  includeDeleted = false,
): Promise<Memory[]> {
  if (memoryIds.length === 0) {
    return [];
  }

  const conditions = [inArray(memory.id, memoryIds)];

  if (!includeDeleted) {
    conditions.push(eq(memory.deleted, 0));
  }

  return await db
    .select()
    .from(memory)
    .where(and(...conditions));
}

/**
 * Get all active (non-deleted) memories for a user
 */
export async function getActiveMemories(
  userId: string,
  limit?: number,
): Promise<Memory[]> {
  let query = db
    .select()
    .from(memory)
    .where(and(eq(memory.userId, userId), eq(memory.deleted, 0)))
    .orderBy(desc(memory.updatedAt));

  if (limit) {
    query = query.limit(limit) as any;
  }

  return await query;
}

/**
 * Get recently updated memories for a user
 */
export async function getRecentlyUpdatedMemories(
  userId: string,
  limit = 10,
): Promise<Memory[]> {
  return await db
    .select()
    .from(memory)
    .where(and(eq(memory.userId, userId), eq(memory.deleted, 0)))
    .orderBy(desc(memory.updatedAt))
    .limit(limit);
}

/**
 * Get memory history (all versions including deleted)
 */
export async function getMemoryHistory(
  userId: string,
  options?: {
    limit?: number;
    afterTimestamp?: Date;
    beforeTimestamp?: Date;
  },
): Promise<Memory[]> {
  const conditions = [eq(memory.userId, userId)];

  if (options?.afterTimestamp) {
    conditions.push(gte(memory.createdAt, options.afterTimestamp));
  }

  if (options?.beforeTimestamp) {
    conditions.push(lte(memory.createdAt, options.beforeTimestamp));
  }

  let query = db
    .select()
    .from(memory)
    .where(and(...conditions))
    .orderBy(asc(memory.createdAt)) as any;

  if (options?.limit) {
    query = query.limit(options.limit) as any;
  }

  return await query;
}

/**
 * Get memories by action type
 */
export async function getMemoriesByAction(
  userId: string,
  action: "ADD" | "UPDATE" | "DELETE",
  options?: { includeDeleted?: boolean; limit?: number },
): Promise<Memory[]> {
  const conditions = [
    eq(memory.userId, userId),
    eq(memory.action, action),
  ];

  if (!options?.includeDeleted) {
    conditions.push(eq(memory.deleted, 0));
  }

  let query = db
    .select()
    .from(memory)
    .where(and(...conditions))
    .orderBy(desc(memory.createdAt)) as any;

  if (options?.limit) {
    query = query.limit(options.limit) as any;
  }

  return await query;
}

/**
 * Get deleted memories for a user
 */
export async function getDeletedMemories(
  userId: string,
  limit?: number,
): Promise<Memory[]> {
  let query = db
    .select()
    .from(memory)
    .where(and(eq(memory.userId, userId), eq(memory.deleted, 1)))
    .orderBy(desc(memory.updatedAt));

  if (limit) {
    query = query.limit(limit) as any;
  }

  return await query;
}

/**
 * Count total memories for a user
 */
export async function countUserMemories(
  userId: string,
  includeDeleted = false,
): Promise<number> {
  const conditions = [eq(memory.userId, userId)];

  if (!includeDeleted) {
    conditions.push(eq(memory.deleted, 0));
  }

  const result = await db
    .select()
    .from(memory)
    .where(and(...conditions));

  return result.length;
}

/**
 * Get memory statistics for a user
 */
export async function getMemoryStats(userId: string): Promise<{
  total: number;
  active: number;
  deleted: number;
  byAction: Record<string, number>;
}> {
  const allMemories = await db
    .select()
    .from(memory)
    .where(eq(memory.userId, userId));

  const byAction: Record<string, number> = {
    ADD: 0,
    UPDATE: 0,
    DELETE: 0,
  };
  let active = 0;
  let deleted = 0;

  for (const mem of allMemories) {
    if (mem.action) {
      byAction[mem.action] = (byAction[mem.action] || 0) + 1;
    }
    if (mem.deleted === 0) {
      active++;
    } else {
      deleted++;
    }
  }

  return {
    total: allMemories.length,
    active,
    deleted,
    byAction,
  };
}

/**
 * Update memory content and track the change with embedding regeneration
 * Creates a new version with action="UPDATE" and stores previous content
 */
export async function updateMemoryContent(
  memoryId: number,
  newContent: string,
  provider: Provider = "ollama",
): Promise<boolean> {
  const existing = await getMemory(memoryId);

  if (!existing) {
    throw new Error(`Memory with ID ${memoryId} not found`);
  }

  const result = await db
    .update(memory)
    .set({
      content: newContent,
      prevContent: existing.content,
      action: "UPDATE",
      updatedAt: new Date(),
    })
    .where(eq(memory.id, memoryId))
    .returning({ id: memory.id });

  // Regenerate embedding with new content
  if (result.length > 0) {
    await upsertMemoryEmbedding(memoryId, newContent, provider);
  }

  return result.length > 0;
}

/**
 * Bulk soft delete memories
 */
export async function bulkSoftDeleteMemories(
  memoryIds: number[],
): Promise<number> {
  if (memoryIds.length === 0) {
    return 0;
  }

  const result = await db
    .update(memory)
    .set({
      deleted: 1,
      action: "DELETE",
      updatedAt: new Date(),
    })
    .where(inArray(memory.id, memoryIds))
    .returning({ id: memory.id });

  return result.length;
}

/**
 * Bulk hard delete memories
 */
export async function bulkHardDeleteMemories(
  memoryIds: number[],
): Promise<number> {
  if (memoryIds.length === 0) {
    return 0;
  }

  const result = await db
    .delete(memory)
    .where(inArray(memory.id, memoryIds))
    .returning({ id: memory.id });

  return result.length;
}

/**
 * Permanently delete all soft-deleted memories for a user
 */
export async function purgeDeletedMemories(userId: string): Promise<number> {
  const result = await db
    .delete(memory)
    .where(and(eq(memory.userId, userId), eq(memory.deleted, 1)))
    .returning({ id: memory.id });

  return result.length;
}

/**
 * Delete memories older than specified date (hard delete)
 */
export async function deleteMemoriesOlderThan(
  userId: string,
  cutoffDate: Date,
): Promise<number> {
  const result = await db
    .delete(memory)
    .where(and(eq(memory.userId, userId), lte(memory.createdAt, cutoffDate)))
    .returning({ id: memory.id });

  return result.length;
}
