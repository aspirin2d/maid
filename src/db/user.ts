import {
  eq,
  and,
  desc,
  asc,
  sql,
  type SQL,
  type InferInsertModel,
  type InferSelectModel,
} from "drizzle-orm";
import db from "./index";
import { user } from "./schema";

// ============
// Types
// ============

export type User = InferSelectModel<typeof user>;
export type NewUser = InferInsertModel<typeof user>;

export type CreateUserInput = Partial<Omit<NewUser, "createdAt">>;
export type UpdateUserInput = Partial<Omit<NewUser, "id" | "createdAt">>;

export interface ListUsersOptions {
  search?: string;
  email?: string;
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "lastInteraction" | "name" | "totalMessages";
  orderDir?: "asc" | "desc";
}

// ============
// CRUD Operations
// ============

/**
 * Create a new user record
 */
export async function createUser(input: CreateUserInput = {}): Promise<string> {
  const [inserted] = await db
    .insert(user)
    .values({
      id: input.id,
      name: input.name,
      email: input.email,
      lastInteraction: input.lastInteraction,
      totalMessages: input.totalMessages,
      preferences: input.preferences,
      memoryStats: input.memoryStats,
    })
    .returning({ id: user.id });

  if (!inserted) {
    throw new Error("Failed to create user");
  }

  return inserted.id;
}

/**
 * Retrieve a user by their primary key
 */
export async function getUser(userId: string): Promise<User | undefined> {
  const result = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return result[0];
}

/**
 * Retrieve a user by their email address
 */
export async function getUserByEmail(email: string): Promise<User | undefined> {
  const result = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  return result[0];
}

/**
 * Update a user record
 */
export async function updateUser(
  userId: string,
  updates: UpdateUserInput,
): Promise<boolean> {
  const result = await db
    .update(user)
    .set(updates)
    .where(eq(user.id, userId))
    .returning({ id: user.id });

  return result.length > 0;
}

/**
 * Delete a user
 */
export async function deleteUser(userId: string): Promise<boolean> {
  const result = await db
    .delete(user)
    .where(eq(user.id, userId))
    .returning({ id: user.id });

  return result.length > 0;
}

/**
 * List users with optional filters and pagination
 */
export async function listUsers(
  options: ListUsersOptions = {},
): Promise<User[]> {
  const conditions: SQL[] = [];

  if (options.email) {
    conditions.push(eq(user.email, options.email));
  }

  if (options.search) {
    const query = `%${options.search}%`;
    conditions.push(
      sql`coalesce(${user.name}, '') LIKE ${query} OR coalesce(${user.email}, '') LIKE ${query}`,
    );
  }

  let queryBuilder = db.select().from(user);

  if (conditions.length === 1) {
    queryBuilder = queryBuilder.where(conditions[0]) as any;
  } else if (conditions.length > 1) {
    queryBuilder = queryBuilder.where(and(...conditions)) as any;
  }

  const orderBy = options.orderBy ?? "createdAt";
  const orderDir = options.orderDir ?? "desc";
  const orderFn = orderDir === "desc" ? desc : asc;

  const orderColumn =
    orderBy === "lastInteraction"
      ? user.lastInteraction
      : orderBy === "name"
        ? user.name
        : orderBy === "totalMessages"
          ? user.totalMessages
          : user.createdAt;

  queryBuilder = queryBuilder.orderBy(orderFn(orderColumn)) as any;

  if (options.limit) {
    queryBuilder = queryBuilder.limit(options.limit) as any;
  }

  if (options.offset) {
    queryBuilder = queryBuilder.offset(options.offset) as any;
  }

  return await queryBuilder;
}
