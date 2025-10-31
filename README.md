# MAID - Memory-Augmented Intelligence Database

A TypeScript/Bun-powered memory management system with vector embeddings and semantic search capabilities. Built with Drizzle ORM, SQLite, and SQLite-vec for efficient vector similarity search.

## Features

- 🧠 **Advanced Memory Management** - CRUD operations for user memories with automatic embedding generation
- 🔍 **Semantic Search** - Vector similarity search using SQLite-vec with 4096-dimensional embeddings
- ⚡ **High Performance** - Batch memory creation (~50 memories/second) with efficient K-NN search
- 🔗 **Cascade Deletes** - Automatic cleanup of memories and vectors when users are deleted
- 🌍 **Multilingual Support** - Works with multiple languages (Chinese, English, Spanish, etc.)
- 📊 **Memory Categories** - Organize memories by type: PERSONAL_INFO, PREFERENCE, GOAL, ROUTINE, RELATIONSHIP, HEALTH, EVENT, WORK, OTHER
- 🎯 **Importance Scoring** - Track memory importance (0-1), confidence (0-1), and metadata
- 💬 **Message Tracking** - Store and manage conversation history with extraction status
- 🤖 **Intelligent Memory Extraction** - Automatically extract facts from conversations and decide whether to add or update memories
- 🔄 **Version History** - Track content changes with previous_content field
- 🎚️ **Flexible LLM Support** - Works with both Ollama (local) and OpenAI (cloud) providers

## Prerequisites

- [Bun](https://bun.sh) v1.3.1 or higher
- [Ollama](https://ollama.ai) (if using Ollama for embeddings) or OpenAI API key
- SQLite 3.50.4+ with [sqlite-vec](https://github.com/asg017/sqlite-vec) support

## Installation

```bash
# Install dependencies
bun install
```

## Setup

### 1. Configure Environment

Create a `.env` file:

```bash
# Ollama Configuration (default)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=qwen3-embedding

# Or use OpenAI
OPENAI_API_KEY=your-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# Optional: Custom SQLite library path (macOS only)
# By default, automatically detects latest Homebrew SQLite version
# SQLITE_LIBRARY_PATH=/path/to/libsqlite3.dylib

# Optional: Custom database path
# SQLITE_DB_PATH=./custom-db.sqlite
```

### 2. Run Database Migrations

```bash
# Create database tables and vector embeddings table
bun migrate.ts
```

This will:

- Run Drizzle migrations to create `user` and `memory` tables
- Create `vec_memories` virtual table for vector embeddings
- Set up triggers for automatic vector cleanup
- Enable foreign key constraints for cascade deletes

## Development

### Run Development Server

```bash
bun run dev
```

Open http://localhost:3000

### Database Migrations

```bash
# Run migrations
bun migrate
```

### Type Checking

```bash
bun --bun tsc --noEmit
```

### Run Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/memory.test.ts
```

## Usage Examples

### Basic Memory Operations

```typescript
import { createMemory, listMemories, searchSimilarMemories } from "./src/memory";

// Create a memory
const memoryId = await createMemory({
  userId: 1,
  content: "User loves hiking in the mountains",
  category: "PREFERENCE",
  importance: 0.8,
  confidence: 0.9,
});

// List all memories for a user
const memories = await listMemories({
  userId: 1,
  limit: 10,
});

// Search for similar memories
const similar = await searchSimilarMemories("outdoor activities", {
  userId: 1,
  limit: 5,
  provider: "ollama",
});
```

### Memory Extraction from Conversations

```typescript
import { runMemoryExtraction } from "./src/extraction";
import { createMessages } from "./src/message";

// Store conversation messages
await createMessages([
  {
    userId: 1,
    role: "user",
    content: "I love trail running on weekends",
    extracted: false,
  },
  {
    userId: 1,
    role: "assistant",
    content: "That's great! I'll remember that.",
    extracted: false,
  },
]);

// Extract memories from unprocessed messages
const result = await runMemoryExtraction({
  userId: 1,
  embeddingProvider: "ollama",
  llmProvider: "ollama",
});

console.log(`Created ${result.createdMemoryIds.length} new memories`);
console.log(`Updated ${result.updatedMemoryIds.length} existing memories`);
```

### Run Complete Example

```bash
# Run the memory extraction example
bun examples/memory-extraction.ts

# Use OpenAI instead of Ollama
bun examples/memory-extraction.ts --provider openai
```

## API Documentation

### Memory Module (`src/memory.ts`)

**Core Functions:**
- `createMemory(input, provider?)` - Create a single memory with embedding
- `createMemories(inputs, provider?)` - Batch create multiple memories
- `getMemory(memoryId)` - Retrieve a memory by ID
- `updateMemory(memoryId, updates, provider?)` - Update memory and regenerate embedding
- `softDeleteMemory(memoryId)` - Mark memory as deleted
- `hardDeleteMemory(memoryId)` - Permanently remove memory
- `restoreMemory(memoryId)` - Restore a soft-deleted memory
- `listMemories(options)` - List memories with filtering and pagination
- `searchSimilarMemories(query, options)` - Vector similarity search

**Statistics & Utilities:**
- `countUserMemories(userId, includeDeleted?)` - Count memories for a user
- `getMemoryStats(userId)` - Get aggregated statistics
- `getActiveMemories(userId, limit?)` - Get all non-deleted memories
- `getDeletedMemories(userId, limit?)` - Get soft-deleted memories
- `getMemoryHistory(userId, options?)` - Get all memory versions

### Message Module (`src/message.ts`)

**Functions:**
- `createMessage(input, db?)` - Create a single message
- `createMessages(inputs, db?)` - Batch create messages
- `listMessages(options)` - List messages with filtering
- `markMessagesExtracted(messageIds, extracted)` - Mark messages as processed

### Extraction Module (`src/extraction.ts`)

**Main Function:**
- `runMemoryExtraction(options)` - Extract facts from conversations and update memories

**Options:**
- `userId` - The user ID to process
- `messageLimit?` - Max messages to process
- `similarityLimit?` - Max similar memories to consider per fact (default: 3)
- `embeddingProvider?` - Provider for embeddings ("ollama" | "openai")
- `llmProvider?` - Provider for LLM calls ("ollama" | "openai")
- `llmModel?` - Specific model to use
- `minConfidence?` - Minimum confidence threshold for facts
- `memoryProvider?` - Provider for memory operations

**Returns:**
- `messages` - Processed messages
- `facts` - Extracted facts from conversation
- `decisions` - Memory ADD/UPDATE decisions
- `createdMemoryIds` - IDs of newly created memories
- `updatedMemoryIds` - IDs of updated memories
- `markedMessageIds` - Messages marked as extracted

## Troubleshooting

**"No such table: vec_memories"**

- Run `bun migrate.ts` to create the vector table

**"Connection refused" for Ollama**

- Ensure Ollama is running: `ollama serve`
- Check `OLLAMA_BASE_URL` in `.env`
- Verify embedding model is available: `ollama pull qwen3-embedding`

**Low similarity scores**

- Lower `minSimilarity` threshold (try 0.3-0.5)
- Use content-based embeddings (enabled by default)
- Ensure query and content use similar language

**Cascade deletes not working**

- Foreign keys are enabled by default in `src/db/index.ts`
- Run tests to verify: `bun test-cascade-delete.ts`

## License

MIT

## Contributing

Contributions are welcome! Please ensure:

- Tests pass for cascade deletes and data preservation
- Code follows existing patterns and TypeScript types
- Examples are updated if adding new features

---

Built with ❤️ using [Bun](https://bun.sh), [Drizzle ORM](https://orm.drizzle.team), and [SQLite-vec](https://github.com/asg017/sqlite-vec)
