# MAID Project Guidelines

This document provides AI assistants with context about the MAID (Memory-Augmented Intelligence Database) project architecture, coding standards, and best practices.

## Technology Stack

### Runtime & Package Manager
Default to using Bun instead of Node.js:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv

### Core Dependencies
- **Database**: Drizzle ORM with SQLite and sqlite-vec for vector embeddings
- **Web Framework**: Hono (lightweight web framework)
- **LLM Providers**: Ollama (local) and OpenAI (cloud)
- **Validation**: Zod for schema validation and type safety

### Bun-Specific APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa

## Project Architecture

### Core Modules

**`src/db/`** - Database layer
- `schema.ts` - Drizzle schema definitions for users, messages, and memories
- `index.ts` - Database connection and initialization with sqlite-vec support

**`src/memory.ts`** - Memory management module
- CRUD operations for memories with automatic embedding generation
- Vector similarity search using sqlite-vec
- Soft delete, hard delete, and restore operations
- Memory statistics and history tracking
- **Important**: Always regenerate embeddings when content is updated

**`src/message.ts`** - Message tracking module
- Store conversation history between users and assistants
- Track extraction status to avoid reprocessing
- Support for filtering by role, extraction status, and timestamps

**`src/extraction.ts`** - Intelligent memory extraction
- Extract facts from conversation messages using LLMs
- Search for similar existing memories using vector embeddings
- Decide whether to ADD new memories or UPDATE existing ones
- Atomic transactions for all memory operations
- **Optimization**: Batch embed all facts at once to reduce API calls

**`src/llm.ts`** - LLM provider abstraction
- Support for both Ollama (local) and OpenAI (cloud)
- Text embedding generation (qwen3-embedding, text-embedding-3-large)
- Structured JSON output parsing with Zod schemas

**`src/prompt.ts`** - Prompt engineering
- System prompts for fact extraction
- Prompts for memory update decisions
- Schema definitions for structured outputs

## Coding Standards

### TypeScript
- Use strict TypeScript with proper type inference
- Prefer Drizzle's `InferSelectModel` and `InferInsertModel` for schema types
- Use Zod schemas for runtime validation and type inference
- Export types alongside functions for better developer experience

### Database Patterns
- Use Drizzle ORM query builder, not raw SQL (except for sqlite-vec operations)
- Always handle transactions for multi-step operations
- Enable foreign key constraints for referential integrity
- Use soft deletes (deleted flag) to preserve history
- Track content changes with `previous_content` field

### Memory Operations
- Always generate embeddings when creating or updating memory content
- Use batch operations (`createMemories`) for multiple inserts
- Delete vector embeddings when memories are hard deleted
- Use INNER JOIN for vector search to get full memory data in one query

### LLM Integration
- Default to Ollama for local development
- Support OpenAI as alternative provider
- Use structured JSON output with Zod validation
- Always specify `keep_alive` for Ollama to manage model lifecycle
- Batch embedding generation when processing multiple texts

### Error Handling
- Wrap LLM and database operations in try-catch blocks
- Provide descriptive error messages with context
- Use transactions to ensure atomic memory updates
- Clean up resources (embeddings) on failures

## Testing

Use `bun test` to run tests:

```ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Test Patterns
- Use in-memory SQLite (`:memory:`) for tests
- Mock LLM calls with test embeddings
- Test cascade deletes and foreign key constraints
- Verify embedding generation and vector search

## Environment Configuration

Required environment variables:

```bash
# Ollama (default)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=qwen3-embedding

# OpenAI (alternative)
OPENAI_API_KEY=your-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# Database (optional)
SQLITE_DB_PATH=./maid.sqlite  # defaults to :memory:
SQLITE_LIBRARY_PATH=/path/to/libsqlite3.dylib  # macOS only, auto-detected
```

## Development Workflow

1. **Run migrations**: `bun migrate` to set up database schema
2. **Start dev server**: `bun run dev` for the Hono web server
3. **Run tests**: `bun test` to verify functionality
4. **Run examples**: `bun examples/memory-extraction.ts` to test end-to-end

## Common Patterns

### Creating Memories with Metadata
```typescript
const memoryId = await createMemory({
  userId: 1,
  content: "User prefers dark mode",
  category: "PREFERENCE",
  importance: 0.7,
  confidence: 0.9,
  action: "ADD",
}, "ollama");
```

### Searching for Similar Memories
```typescript
const similar = await searchSimilarMemories("user interface preferences", {
  userId: 1,
  limit: 5,
  provider: "ollama",
  includeDeleted: false,
});
```

### Running Memory Extraction
```typescript
const result = await runMemoryExtraction({
  userId: 1,
  messageLimit: 50,
  similarityLimit: 3,
  embeddingProvider: "ollama",
  llmProvider: "ollama",
  memoryProvider: "ollama",
});
```

## Best Practices

1. **Always use transactions** for operations that modify multiple records
2. **Batch embeddings** when processing multiple texts to reduce API calls
3. **Include metadata** (category, importance, confidence) when creating memories
4. **Use soft deletes** to preserve history and allow restoration
5. **Track content changes** by storing previous_content on updates
6. **Validate inputs** with Zod schemas before database operations
7. **Handle provider failures** gracefully with fallbacks or retries
8. **Test with both providers** (Ollama and OpenAI) to ensure compatibility

## Performance Optimization

- Use `INNER JOIN` in vector search to fetch memory data in one query
- Batch embed multiple facts at once in extraction pipeline
- Use prepared statements via Drizzle for repeated queries
- Limit vector search results to reasonable numbers (3-10)
- Consider using `includeDeleted: false` to filter out soft-deleted memories

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.
