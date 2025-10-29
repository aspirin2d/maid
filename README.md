# MAID - Memory-Augmented Intelligence Database

A TypeScript/Bun-powered memory management system with vector embeddings and semantic search capabilities. Built with Drizzle ORM, SQLite, and SQLite-vec for efficient vector similarity search.

## Features

- 🧠 **Advanced Memory Management** - CRUD operations for user memories with automatic embedding generation
- 🔍 **Semantic Search** - Vector similarity search using SQLite-vec with 4096-dimensional embeddings
- ⚡ **High Performance** - Batch memory creation (~50 memories/second) with efficient K-NN search
- 🔗 **Cascade Deletes** - Automatic cleanup of memories and vectors when users are deleted
- 🌍 **Multilingual Support** - Works with multiple languages (Chinese, English, Spanish, etc.)
- 📊 **Memory Categories** - Organize memories by type: facts, preferences, goals, events, patterns
- 🎯 **Importance Scoring** - Track memory importance, confidence, and emotional weight
- 📈 **Access Tracking** - Monitor memory access patterns with counts and timestamps

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

## Usage

### Memory CRUD Operations

```typescript
import {
  createMemory,
  createMemories,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  searchSimilarMemories,
  getTopMemories,
  archiveMemories,
} from "./src/db/memory";

// Create a single memory
const memoryId = await createMemory({
  userId: "user-123",
  category: "USER_FACTS",
  content: "User is a software engineer who loves TypeScript",
  summary: "Software engineer, TypeScript enthusiast",
  importanceScore: 8.5,
  confidenceScore: 0.95,
});

// Batch create memories (much faster!)
const memoryIds = await createMemories([
  {
    userId: "user-123",
    category: "USER_PREFERENCES",
    content: "User prefers dark mode and minimal UI",
    summary: "Dark mode, minimal UI",
    importanceScore: 7.0,
  },
  {
    userId: "user-123",
    category: "USER_GOALS",
    content: "User wants to learn Rust",
    summary: "Learn Rust",
    importanceScore: 8.0,
  },
]);

// Semantic search
const results = await searchSimilarMemories({
  userId: "user-123",
  query: "What programming languages does the user know?",
  limit: 5,
  minSimilarity: 0.7,
});

// List memories with filtering
const memories = await listMemories({
  userId: "user-123",
  category: "USER_FACTS",
  status: "active",
  orderBy: "importance",
  orderDir: "desc",
  limit: 10,
});

// Get top memories by importance
const topMemories = await getTopMemories("user-123", 10);

// Update memory (auto-regenerates embeddings)
await updateMemory(memoryId, {
  content: "User is a senior software engineer specializing in TypeScript and AI",
  importanceScore: 9.0,
});

// Soft delete (marks as deleted, keeps vectors)
await deleteMemory(memoryId);

// Hard delete (removes memory and vectors)
await deleteMemory(memoryId, { hard: true });

// Archive old memories
const archivedCount = await archiveMemories("user-123", {
  olderThanDays: 90,
  maxImportance: 5.0,
});
```

### Memory Categories

- **USER_FACTS** - Objective information about the user
- **USER_PREFERENCES** - User likes, dislikes, and preferences
- **USER_GOALS** - Objectives, aspirations, and ambitions
- **EPISODIC_EVENTS** - Specific events and conversations
- **CONTEXT_PATTERNS** - Behavioral patterns and habits

## Examples

### Run the Demo

```bash
# Comprehensive example with 68 test memories
bun example/seed-and-search.ts
```

This demonstrates:
- Creating test users
- Batch memory creation
- Semantic similarity search
- Multilingual support (Chinese/English)
- Category filtering
- Top memories by importance

See [example/README.md](example/README.md) for detailed documentation.

### Simple CRUD Example

```bash
# Basic CRUD operations walkthrough
bun example-memory-usage.ts
```

## Testing

### Cascade Delete Verification

```bash
# Basic cascade delete test
bun test-cascade-delete.ts

# Comprehensive multi-scenario test
bun test-cascade-delete-comprehensive.ts
```

Verifies:
- User deletion cascades to memories
- Memory deletion triggers vector cleanup
- Deletion is isolated (other users unaffected)
- Soft delete preserves vectors
- Hard delete removes vectors via trigger
- Performance with many records

### Migration Safety

```bash
# Verify migrations preserve existing data
bun test-migrate-preservation.ts
```

## Architecture

### Database Schema

#### `user` table
- User information and preferences
- Foreign key parent for memories

#### `memory` table
- Memory content, category, and metadata
- Importance, confidence, and emotional scoring
- Access tracking and temporal context
- Status management (active/archived/deleted)
- Cascades delete to vec_memories

#### `vec_memories` virtual table (SQLite-vec)
- 4096-dimensional vector embeddings
- K-NN similarity search
- Automatic cleanup via triggers

### Embedding Flow

```
User creates memory
    ↓
Insert into memory table
    ↓
Generate embedding (Ollama/OpenAI)
    ↓
Store in vec_memories
    ↓
Available for similarity search
```

### Cascade Delete Flow

```
User deleted
    ↓ (Foreign Key CASCADE)
Memories deleted
    ↓ (Database TRIGGER)
Vector embeddings deleted
```

## Performance

- **Batch Creation**: ~50 memories/second vs ~20 for single
- **Similarity Search**: Fast K-NN with SQLite-vec
- **Cascade Delete**: 20 memories + vectors deleted in ~7ms
- **Embeddings**: Cached in database, only regenerated on content updates

## API Reference

See [src/db/memory.ts](src/db/memory.ts) for complete API documentation with TypeScript types.

### Core Functions

- `createMemory(input, options?)` - Create single memory with embedding
- `createMemories(inputs, options?)` - Batch create memories
- `getMemory(memoryId, options?)` - Get memory by ID with access tracking
- `updateMemory(memoryId, updates, options?)` - Update memory and regenerate embedding
- `deleteMemory(memoryId, options?)` - Soft or hard delete
- `listMemories(options)` - List and filter memories
- `searchSimilarMemories(options)` - Vector similarity search
- `getTopMemories(userId, limit)` - Get most important memories
- `getMemoriesByIds(memoryIds)` - Batch retrieve memories
- `archiveMemories(userId, options?)` - Archive old/low-importance memories

## Configuration

### Embedding Providers

#### Ollama (default)
```typescript
await createMemory({...}, { provider: "ollama" });
```

#### OpenAI
```typescript
await createMemory({...}, { provider: "openai" });
```

### Skip Embedding Generation

```typescript
await createMemory({...}, { skipEmbedding: true });
```

Useful for:
- Testing without embedding service
- Importing existing memories without regenerating embeddings
- Soft deletes (update status without re-embedding)

## Development

### Run Development Server

```bash
bun run dev
```

Open http://localhost:3000

### Database Migrations

```bash
# Generate new migration
bun drizzle-kit generate

# Run migrations
bun migrate.ts
```

### Type Checking

```bash
bun --bun tsc --noEmit
```

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
