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

# Run migrations

```
bun migrate
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
