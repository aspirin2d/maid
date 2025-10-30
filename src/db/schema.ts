import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: int("id").primaryKey({ autoIncrement: true }),
  name: text("name"),
});

export const messages = sqliteTable(
  "messages",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    userId: int("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    extracted: int("is_extracted", {
      mode: "boolean",
    }).default(false),
    createdAt: int("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, any>>(),
  },
  (table) => [
    index("message_user_extracted_idx").on(table.userId, table.extracted),
  ],
);

export const memory = sqliteTable(
  "memory",
  {
    id: int("id").primaryKey({ autoIncrement: true }),
    userId: int("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content"),
    prevContent: text("previous_content"),

    action: text("action", { enum: ["ADD", "UPDATE", "DELETE"] }),
    deleted: int("deleted")
      .notNull()
      .$default(() => 0), // 0 represents not deleted, 1 represents deleted

    createdAt: int("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: int("updated_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => [index("memory_user_idx").on(table.userId)],
);
