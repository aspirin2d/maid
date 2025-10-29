# Memory System Examples

This folder contains example scripts demonstrating how to use the memory CRUD functions and similarity search features.

## Prerequisites

Before running the examples, make sure you have:

1. **Run migrations** to create the database tables:
   ```bash
   bun migrate.ts
   ```

2. **Ollama running** with the embedding model loaded (if using Ollama provider):
   ```bash
   # Make sure Ollama is running at the configured URL
   # Default: http://192.168.103.223:11434
   ```

## Examples

### 1. Seed and Search (`seed-and-search.ts`)

A comprehensive example that demonstrates:
- Creating test users
- Seeding memories with different categories
- Automatic embedding generation
- Similarity search with semantic queries
- Listing top memories by importance
- Filtering memories by category

**Run it:**
```bash
bun example/seed-and-search.ts
```

**What it does:**
1. Creates 3 test users (A, B, C) with different profiles
2. Seeds realistic memories for each user:
   - `USER_FACTS` - Information about the user
   - `USER_PREFERENCES` - User preferences and likes
   - `USER_GOALS` - User objectives and ambitions
   - `EPISODIC_EVENTS` - Recent events and experiences
   - `CONTEXT_PATTERNS` - Behavioral patterns
3. **Multilingual Support**: User A's memories and queries are in **Chinese (中文)**, demonstrating cross-language semantic search capabilities
4. Performs semantic searches like:
   - User A: "用户会哪些编程语言和技术？" (Chinese queries)
   - Users B/C: "What programming languages does the user know?" (English queries)
5. Shows top memories ranked by importance
6. Lists memories organized by category

**Expected Output:**
- Confirmation of user and memory creation
- Similarity search results with scores
- Top memories by importance
- Memories organized by category

## Features Demonstrated

### CRUD Operations
- ✅ `createMemory()` - Create a single memory with automatic embedding generation
- ✅ `createMemories()` - **Batch create multiple memories** (much faster!)
- ✅ `getMemory()` - Retrieve memories with access tracking
- ✅ `updateMemory()` - Update memories (auto-regenerates embeddings)
- ✅ `deleteMemory()` - Soft/hard delete memories

### Query Operations
- ✅ `searchSimilarMemories()` - Semantic similarity search using SQLite-vec
- ✅ `listMemories()` - List memories with filtering and pagination
- ✅ `getTopMemories()` - Get most important memories
- ✅ `getMemoriesByIds()` - Batch retrieve memories

### Advanced Features
- ✅ Automatic embedding generation (Ollama/OpenAI)
- ✅ Vector similarity search with 4096-dimensional embeddings
- ✅ Category-based filtering
- ✅ Importance scoring
- ✅ Access tracking (count + timestamp)
- ✅ Status management (active/archived/deleted)

## Performance

### Batch Creation

The example uses `createMemories()` for efficient batch insertion:

```typescript
// Batch create - MUCH faster!
const memoryIds = await createMemories([
  { userId, category: "USER_FACTS", content: "...", summary: "..." },
  { userId, category: "USER_GOALS", content: "...", summary: "..." },
  // ... more memories
], { provider: "ollama" });

// Single create - use for one-off memories
const id = await createMemory({
  userId,
  category: "USER_FACTS",
  content: "...",
  summary: "..."
}, { provider: "ollama" });
```

**Performance Comparison:**
- Single creation: ~0.05s per memory (20 memories/second)
- Batch creation: ~0.02s per memory (50 memories/second)

**Example results:**
- User A: 21 memories in 0.46s (Chinese content)
- User B: 22 memories in 0.49s (English content)
- User C: 25 memories in 0.56s (English content)
- **Total: 68 memories in 1.5s!**

Batch creation generates embeddings for all texts in a single API call, making it much more efficient.

## Multilingual Support

The example demonstrates **cross-language semantic search** capabilities:

### Chinese (中文) Example

User A's profile uses Chinese for both memories and queries:

**Memory Content:**
```
A 是一位资深软件工程师，专注于机器学习和人工智能系统。
她有8年的工作经验，目前在一家科技创业公司工作，负责构建对话式AI系统。
```

**Query Examples:**
- "用户会哪些编程语言和技术？" (What programming languages does the user know?)
- "她的职业目标和抱负是什么？" (What are their career goals?)
- "她最近做了什么？" (What did they do recently?)

**Semantic Search Results:**
```
🔎 Query: "用户会哪些编程语言和技术？"
   ✅ Found 1 similar memories:
   1. [Similarity: 0.803]
      偏好 Python、TypeScript、React、Next.js、FastAPI
      Category: USER_PREFERENCES
```

The embedding model (qwen3-embedding) handles Chinese text naturally, enabling semantic search across languages!

## Customization

### Using OpenAI Instead of Ollama

Change the `provider` parameter:
```typescript
await createMemory({
  userId: "...",
  category: "USER_FACTS",
  content: "...",
}, { provider: "openai" }); // Use OpenAI embeddings
```

### Adjusting Similarity Threshold

```typescript
const results = await searchSimilarMemories({
  userId: "...",
  query: "What does the user like?",
  minSimilarity: 0.7, // Higher = more strict matching
  limit: 5,
});
```

### Filtering by Category

```typescript
const facts = await listMemories({
  userId: "...",
  category: "USER_FACTS",
  status: "active",
  orderBy: "importance",
  orderDir: "desc",
});
```

## Database Schema

The memory system uses two main tables:

1. **`memory`** - Main memory storage with metadata
   - `id`, `userId`, `category`, `content`, `summary`
   - Importance, confidence, emotional weight scores
   - Access tracking, timestamps, status

2. **`vec_memories`** - Vector embeddings for similarity search
   - `memory_id` - References `memory.id`
   - `embedding` - 4096-dimensional float vector

## Tips

1. **Semantic Search Works Best With**:
   - Clear, descriptive summaries
   - Consistent terminology
   - Sufficient context in content

2. **Importance Scoring**:
   - Scale: 0-10
   - Higher scores appear in top memories
   - Affects memory consolidation and retrieval

3. **Memory Categories**:
   - `USER_FACTS` - Objective information
   - `USER_PREFERENCES` - Likes, dislikes, preferences
   - `USER_GOALS` - Objectives, aspirations
   - `EPISODIC_EVENTS` - Specific events/conversations
   - `CONTEXT_PATTERNS` - Behavioral patterns

4. **Performance**:
   - SQLite-vec provides fast K-NN search
   - Embeddings cached in database
   - Only regenerated on content updates

## Troubleshooting

**"No such table: vec_memories"**
- Run `bun migrate.ts` to create the vector table

**"Connection refused" for Ollama**
- Check Ollama is running at configured URL
- Verify `OLLAMA_BASE_URL` in `.env`

**Low similarity scores**
- Try lowering `minSimilarity` threshold
- Check if embeddings were generated correctly
- Ensure query and content use similar language

## Next Steps

Try building your own examples:
- Custom memory categories
- Memory consolidation logic
- Automatic importance decay
- Cross-user memory patterns
- RAG (Retrieval-Augmented Generation)
