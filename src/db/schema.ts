import { sql } from "drizzle-orm";
import { index, int, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const test = sqliteTable("test", {
  id: int().primaryKey({ autoIncrement: true }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

export const user = sqliteTable(
  "user",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    name: text("name"),
    email: text("email"),
    createdAt: int("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    lastInteraction: int("last_interaction", { mode: "timestamp" }),
    totalMessages: int("total_messages").default(0),
    preferences: text("preferences", { mode: "json" }).$type<{
      theme?: string;
      language?: string;
    }>(),
    memoryStats: text("memory_stats", { mode: "json" }).$type<{
      totalMemories?: number;
      byCategory?: Record<string, number>;
      lastConsolidation?: string;
    }>(),
  },
  (table) => [index("user_email_idx").on(table.email)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    timestamp: int("timestamp", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    includedInMemoryExtraction: int("included_in_memory_extraction", {
      mode: "boolean",
    }).default(false),
    metadata: text("metadata", { mode: "json" }).$type<{
      sentiment?: number;
      intent?: string;
      entities?: string[];
      emotionalTone?: string;
    }>(),
  },
  (table) => [
    index("message_user_extraction_idx").on(
      table.userId,
      table.includedInMemoryExtraction,
    ),
    index("message_timestamp_idx").on(table.timestamp),
  ],
);

export const memory = sqliteTable(
  "memory",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // content
    category: text("category", {
      enum: [
        "USER_FACTS",
        "USER_PREFERENCES",
        "USER_GOALS",
        "EPISODIC_EVENTS",
        "CONTEXT_PATTERNS",
      ],
    }).notNull(),
    content: text("content").notNull(),
    summary: text("summary"), // Short version for quick display/search

    // Scoring & Importance
    importanceScore: real("importance_score").notNull().default(5.0), // 0-10
    confidenceScore: real("confidence_score").notNull().default(1.0), // 0-1
    emotionalWeight: real("emotional_weight").default(0), // -5 to +5

    // Access patterns
    accessCount: int("access_count").notNull().default(0),
    lastAccessedAt: int("last_accessed_at", { mode: "timestamp" }),

    // Temporal data
    createdAt: int("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: int("updated_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),

    // Source tracking
    sourceMessageIds: text("source_message_ids", { mode: "json" }).$type<
      string[]
    >(),

    // Lifecycle management
    temporalContext: text("temporal_context", {
      enum: ["always", "current", "past", "future"],
    }).default("always"),
    decayRate: real("decay_rate").default(0.1), // How fast importance decays
    status: text("status", {
      enum: ["active", "archived", "deleted", "superseded", "merged_into"],
    }).default("active"),

    // Flexible metadata
    metadata: text("metadata", { mode: "json" }).$type<Record<string, any>>(),
  },
  (table) => [
    index("memory_user_idx").on(table.userId),
    index("memory_category_idx").on(table.category),
    index("memory_status_idx").on(table.status),

    // Importance-based retrieval
    index("memory_importance_idx").on(table.importanceScore),
    index("memory_created_at_idx").on(table.createdAt),
    index("memory_last_accessed_idx").on(table.lastAccessedAt),

    index("memory_user_status_idx").on(table.userId, table.status),
    index("memory_user_category_idx").on(table.userId, table.category),
    index("memory_user_importance_idx").on(table.userId, table.importanceScore),
  ],
);
