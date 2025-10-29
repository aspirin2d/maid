import {
  eq,
  and,
  desc,
  asc,
  gte,
  lte,
  inArray,
  type InferSelectModel,
  type InferInsertModel,
} from "drizzle-orm";
import db from "./index";
import { messages } from "./schema";

// ============
// Types
// ============

export type Message = InferSelectModel<typeof messages>;
export type NewMessage = InferInsertModel<typeof messages>;

// Create input type - only require essential fields
export type CreateMessageInput = Pick<
  NewMessage,
  "userId" | "role" | "content"
> &
  Partial<Omit<NewMessage, "id" | "userId" | "role" | "content" | "timestamp">>;

// Update input type - all fields optional except automatic ones
export type UpdateMessageInput = Partial<
  Omit<NewMessage, "id" | "userId" | "timestamp">
>;

export interface ListMessagesOptions {
  userId: string;
  role?: Message["role"];
  includedInMemoryExtraction?: boolean;
  afterTimestamp?: Date;
  beforeTimestamp?: Date;
  limit?: number;
  offset?: number;
  orderDir?: "asc" | "desc";
}

// ============
// CRUD Operations
// ============

/**
 * Create a new message
 */
export async function createMessage(
  input: CreateMessageInput,
): Promise<string> {
  const [inserted] = await db
    .insert(messages)
    .values({
      userId: input.userId,
      role: input.role,
      content: input.content,
      includedInMemoryExtraction: input.includedInMemoryExtraction ?? false,
      metadata: input.metadata,
    })
    .returning({ id: messages.id });

  if (!inserted) {
    throw new Error("Failed to create message");
  }

  return inserted.id;
}

/**
 * Create multiple messages at once
 */
export async function createMessages(
  inputs: CreateMessageInput[],
): Promise<string[]> {
  if (inputs.length === 0) {
    return [];
  }

  const insertedRecords = await db
    .insert(messages)
    .values(
      inputs.map((input) => ({
        userId: input.userId,
        role: input.role,
        content: input.content,
        includedInMemoryExtraction: input.includedInMemoryExtraction ?? false,
        metadata: input.metadata,
      })),
    )
    .returning({ id: messages.id });

  return insertedRecords.map((r) => r.id);
}

/**
 * Get a message by ID
 */
export async function getMessage(
  messageId: string,
): Promise<Message | undefined> {
  const result = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  return result[0];
}

/**
 * Update a message
 */
export async function updateMessage(
  messageId: string,
  updates: UpdateMessageInput,
): Promise<boolean> {
  const result = await db
    .update(messages)
    .set(updates)
    .where(eq(messages.id, messageId))
    .returning({ id: messages.id });

  return result.length > 0;
}

/**
 * Delete a message (hard delete only)
 */
export async function deleteMessage(messageId: string): Promise<boolean> {
  const result = await db
    .delete(messages)
    .where(eq(messages.id, messageId))
    .returning({ id: messages.id });

  return result.length > 0;
}

/**
 * List messages with filtering and pagination
 */
export async function listMessages(
  options: ListMessagesOptions,
): Promise<Message[]> {
  let query = db.select().from(messages);

  // Build WHERE conditions
  const conditions = [eq(messages.userId, options.userId)];

  if (options.role) {
    conditions.push(eq(messages.role, options.role));
  }

  if (options.includedInMemoryExtraction !== undefined) {
    conditions.push(
      eq(messages.includedInMemoryExtraction, options.includedInMemoryExtraction),
    );
  }

  if (options.afterTimestamp) {
    conditions.push(gte(messages.timestamp, options.afterTimestamp));
  }

  if (options.beforeTimestamp) {
    conditions.push(lte(messages.timestamp, options.beforeTimestamp));
  }

  query = query.where(and(...conditions)) as any;

  // Order by timestamp
  const orderDir = options.orderDir ?? "desc";
  const orderFn = orderDir === "desc" ? desc : asc;
  query = query.orderBy(orderFn(messages.timestamp)) as any;

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
 * Get messages by multiple IDs
 */
export async function getMessagesByIds(
  messageIds: string[],
): Promise<Message[]> {
  if (messageIds.length === 0) {
    return [];
  }

  return await db
    .select()
    .from(messages)
    .where(inArray(messages.id, messageIds));
}

/**
 * Get recent messages for a user
 */
export async function getRecentMessages(
  userId: string,
  limit = 10,
): Promise<Message[]> {
  return await db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.timestamp))
    .limit(limit);
}

/**
 * Get conversation history (messages in chronological order)
 */
export async function getConversationHistory(
  userId: string,
  options?: {
    limit?: number;
    afterTimestamp?: Date;
    beforeTimestamp?: Date;
  },
): Promise<Message[]> {
  let query = db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(asc(messages.timestamp));

  const conditions = [eq(messages.userId, userId)];

  if (options?.afterTimestamp) {
    conditions.push(gte(messages.timestamp, options.afterTimestamp));
  }

  if (options?.beforeTimestamp) {
    conditions.push(lte(messages.timestamp, options.beforeTimestamp));
  }

  query = db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(asc(messages.timestamp)) as any;

  if (options?.limit) {
    query = query.limit(options.limit) as any;
  }

  return await query;
}

/**
 * Mark messages as included in memory extraction
 */
export async function markMessagesAsExtracted(
  messageIds: string[],
): Promise<number> {
  if (messageIds.length === 0) {
    return 0;
  }

  const result = await db
    .update(messages)
    .set({ includedInMemoryExtraction: true })
    .where(inArray(messages.id, messageIds))
    .returning({ id: messages.id });

  return result.length;
}

/**
 * Get messages not yet included in memory extraction
 */
export async function getUnextractedMessages(
  userId: string,
  options?: { limit?: number },
): Promise<Message[]> {
  let query = db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.includedInMemoryExtraction, false),
      ),
    )
    .orderBy(asc(messages.timestamp));

  if (options?.limit) {
    query = query.limit(options.limit) as any;
  }

  return await query;
}

/**
 * Delete messages older than specified date
 */
export async function deleteMessagesOlderThan(
  userId: string,
  cutoffDate: Date,
): Promise<number> {
  const result = await db
    .delete(messages)
    .where(and(eq(messages.userId, userId), lte(messages.timestamp, cutoffDate)))
    .returning({ id: messages.id });

  return result.length;
}

/**
 * Count total messages for a user
 */
export async function countUserMessages(userId: string): Promise<number> {
  const result = await db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId));

  return result.length;
}

/**
 * Get message statistics for a user
 */
export async function getMessageStats(userId: string): Promise<{
  total: number;
  byRole: Record<string, number>;
  extracted: number;
  unextracted: number;
}> {
  const allMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId));

  const byRole: Record<string, number> = {};
  let extracted = 0;
  let unextracted = 0;

  for (const msg of allMessages) {
    byRole[msg.role] = (byRole[msg.role] || 0) + 1;
    if (msg.includedInMemoryExtraction) {
      extracted++;
    } else {
      unextracted++;
    }
  }

  return {
    total: allMessages.length,
    byRole,
    extracted,
    unextracted,
  };
}
