import {
  and,
  asc,
  desc,
  eq,
  inArray,
  like,
  type InferInsertModel,
  type InferSelectModel,
  type SQL,
} from "drizzle-orm";
import db, { type DbClient } from "./db/index";
import { messages } from "./db/schema";

export type Message = InferSelectModel<typeof messages>;
export type NewMessage = InferInsertModel<typeof messages>;

export type CreateMessageInput = Pick<NewMessage, "userId" | "role" | "content"> &
  Partial<
    Omit<NewMessage, "id" | "userId" | "role" | "content" | "createdAt">
  >;

export type UpdateMessageInput = Partial<
  Omit<NewMessage, "id" | "userId" | "createdAt">
>;

export interface ListMessagesOptions {
  userId?: number;
  roles?: Message["role"][];
  extracted?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "id";
  orderDir?: "asc" | "desc";
}

export async function createMessage(
  input: CreateMessageInput,
  client: DbClient = db,
): Promise<Message> {
  const [created] = await client
    .insert(messages)
    .values({
      userId: input.userId,
      role: input.role,
      content: input.content,
      extracted: input.extracted,
      metadata: input.metadata,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create message");
  }

  return created;
}

export async function createMessages(
  inputs: CreateMessageInput[],
  client: DbClient = db,
): Promise<Message[]> {
  if (inputs.length === 0) {
    return [];
  }

  const created = await client
    .insert(messages)
    .values(
      inputs.map((input) => ({
        userId: input.userId,
        role: input.role,
        content: input.content,
        extracted: input.extracted,
        metadata: input.metadata,
      })),
    )
    .returning();

  return created;
}

export async function getMessage(
  id: number,
  client: DbClient = db,
): Promise<Message | undefined> {
  const [message] = await client
    .select()
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1);

  return message;
}

export async function listMessages(
  options: ListMessagesOptions = {},
  client: DbClient = db,
): Promise<Message[]> {
  let query = client.select().from(messages);
  const conditions: SQL[] = [];

  if (options.userId !== undefined) {
    conditions.push(eq(messages.userId, options.userId));
  }

  if (options.roles?.length) {
    conditions.push(inArray(messages.role, options.roles));
  }

  if (options.extracted !== undefined) {
    conditions.push(eq(messages.extracted, options.extracted));
  }

  if (options.search) {
    conditions.push(like(messages.content, `%${options.search}%`));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const orderBy = options.orderBy ?? "createdAt";
  const orderDir = options.orderDir ?? "desc";
  const orderFn = orderDir === "desc" ? desc : asc;
  const orderColumn = orderBy === "id" ? messages.id : messages.createdAt;

  query = query.orderBy(orderFn(orderColumn)) as typeof query;

  if (options.limit !== undefined) {
    query = query.limit(options.limit) as typeof query;
  }

  if (options.offset !== undefined) {
    query = query.offset(options.offset) as typeof query;
  }

  return query;
}

export async function updateMessage(
  id: number,
  updates: UpdateMessageInput,
  client: DbClient = db,
): Promise<Message | undefined> {
  const [updated] = await client
    .update(messages)
    .set(updates)
    .where(eq(messages.id, id))
    .returning();

  return updated;
}

export async function deleteMessage(
  id: number,
  client: DbClient = db,
): Promise<boolean> {
  const deleted = await client
    .delete(messages)
    .where(eq(messages.id, id))
    .returning({ id: messages.id });

  return deleted.length > 0;
}

export async function deleteMessages(
  ids: number[],
  client: DbClient = db,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const deleted = await client
    .delete(messages)
    .where(inArray(messages.id, ids))
    .returning({ id: messages.id });

  return deleted.length;
}

export async function markMessagesExtracted(
  ids: number[],
  extracted = true,
  client: DbClient = db,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const updated = await client
    .update(messages)
    .set({ extracted })
    .where(inArray(messages.id, ids))
    .returning({ id: messages.id });

  return updated.length;
}
