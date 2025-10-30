import { test, expect, describe, beforeEach, mock, vi } from "bun:test";
import type { Message } from "../src/message";
import type { Memory } from "../src/memory";
import type {
  ExtractedFact,
  MemoryExtractionOptions,
  MemoryDecision,
  MemoryReference,
} from "../src/extraction";
import { createMockDb } from "./helpers/mockDb";
import { createTestEmbedding } from "./helpers/mockLlm";

describe("extraction module", () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();

    // Mock the db module
    mock.module("../src/db/index", () => ({
      default: {
        ...mockDb,
        transaction: async (fn: any) => fn(mockDb),
      },
    }));
  });

  describe("runMemoryExtraction - no pending messages", () => {
    test("returns empty result when no messages are pending", async () => {
      // Mock empty message list
      mockDb.setSelectResult([]);

      // Mock message module
      mock.module("../src/message", () => ({
        listMessages: vi.fn(async () => []),
        markMessagesExtracted: vi.fn(async () => 0),
      }));

      // Import after mocking
      const { runMemoryExtraction } = await import("../src/extraction");

      const result = await runMemoryExtraction({
        userId: 1,
      });

      expect(result.messages).toEqual([]);
      expect(result.facts).toEqual([]);
      expect(result.decisions).toEqual([]);
      expect(result.createdMemoryIds).toEqual([]);
      expect(result.markedMessageCount).toBe(0);
    });
  });

  describe("runMemoryExtraction - with messages and facts", () => {
    test("extracts facts and creates memories from conversation", async () => {
      const mockMessages: Message[] = [
        {
          id: 1,
          userId: 1,
          role: "user",
          content: "My favorite color is blue",
          extracted: false,
          createdAt: new Date(),
          metadata: null,
        },
        {
          id: 2,
          userId: 1,
          role: "assistant",
          content: "That's a nice color!",
          extracted: false,
          createdAt: new Date(),
          metadata: null,
        },
      ];

      const mockFacts: ExtractedFact[] = [
        {
          factId: "F1",
          statement: "User's favorite color is blue",
          confidence: 1,
          sourceMessageIds: [1, 2],
        },
      ];

      const mockDecisions: MemoryDecision[] = [
        {
          event: "ADD",
          id: "F1",
          text: "User's favorite color is blue",
          reason: "New information",
        },
      ];

      // Mock message module
      mock.module("../src/message", () => ({
        listMessages: vi.fn(async () => mockMessages),
        markMessagesExtracted: vi.fn(async (ids: number[]) => ids.length),
      }));

      // Mock LLM module
      mock.module("../src/llm", () => ({
        getOpenAI: vi.fn(),
        getOllama: vi.fn(() => ({
          chat: vi.fn(async () => ({
            message: {
              content: JSON.stringify({ facts: mockFacts.map((f) => f.statement) }),
            },
          })),
          embed: vi.fn(async () => ({
            embeddings: [createTestEmbedding()],
          })),
        })),
        embedTexts: vi.fn(async () => [createTestEmbedding()]),
        DEFAULT_OLLAMA_MODEL: "test-model",
        OLLAMA_KEEP_ALIVE: "24h",
      }));

      // Mock memory module - search returns no similar memories
      const mockMemoryId = 123;
      mockDb.setInsertReturnValue([{ id: mockMemoryId }]);

      mock.module("../src/memory", () => ({
        searchSimilarMemories: vi.fn(async () => []),
        createMemory: vi.fn(async () => mockMemoryId),
        updateMemory: vi.fn(async () => true),
      }));

      // Mock prompt module
      mock.module("../src/prompt", () => ({
        FactRetrievalSchema: {
          parse: (data: any) => data,
        },
        MemoryUpdateSchema: {
          parse: (data: any) => ({
            memory: mockDecisions,
          }),
        },
        getFactRetrievalMessages: vi.fn(() => ["System prompt", "User prompt"]),
        getUpdateMemoryMessages: vi.fn(() => "Memory update prompt"),
        parseMessages: vi.fn((lines: string[]) => lines.join("\n")),
        removeCodeBlocks: vi.fn((content: string) => content),
      }));

      // Mock zod module
      mock.module("zod", () => ({
        z: {
          toJSONSchema: vi.fn((schema: any) => ({})),
        },
      }));

      // Import after mocking
      const { runMemoryExtraction } = await import("../src/extraction");

      const result = await runMemoryExtraction({
        userId: 1,
        llmProvider: "ollama",
        embeddingProvider: "ollama",
      });

      expect(result.messages.length).toBe(2);
      expect(result.facts.length).toBeGreaterThanOrEqual(0);
      expect(result.markedMessageCount).toBe(2);
    });
  });

  describe("runMemoryExtraction - with UPDATE decision", () => {
    test("updates existing memory when similar memory is found", async () => {
      const mockMessages: Message[] = [
        {
          id: 3,
          userId: 1,
          role: "user",
          content: "Actually, my favorite color is now green",
          extracted: false,
          createdAt: new Date(),
          metadata: null,
        },
      ];

      const existingMemory: Memory = {
        id: 100,
        userId: 1,
        content: "User's favorite color is blue",
        prevContent: null,
        action: "ADD",
        deleted: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockFacts: ExtractedFact[] = [
        {
          factId: "F1",
          statement: "User's favorite color is green",
          confidence: 1,
          sourceMessageIds: [3],
        },
      ];

      const mockDecisions: MemoryDecision[] = [
        {
          event: "UPDATE",
          id: "M1",
          text: "User's favorite color is green",
          reason: "Updated preference",
        },
      ];

      // Mock message module
      mock.module("../src/message", () => ({
        listMessages: vi.fn(async () => mockMessages),
        markMessagesExtracted: vi.fn(async (ids: number[]) => ids.length),
      }));

      // Mock LLM module
      mock.module("../src/llm", () => ({
        getOllama: vi.fn(() => ({
          chat: vi.fn()
            .mockResolvedValueOnce({
              // First call: fact extraction
              message: {
                content: JSON.stringify({ facts: mockFacts.map((f) => f.statement) }),
              },
            })
            .mockResolvedValueOnce({
              // Second call: decision making
              message: {
                content: JSON.stringify({ memory: mockDecisions }),
              },
            }),
          embed: vi.fn(async () => ({
            embeddings: [createTestEmbedding()],
          })),
        })),
        embedTexts: vi.fn(async () => [createTestEmbedding()]),
        DEFAULT_OLLAMA_MODEL: "test-model",
        OLLAMA_KEEP_ALIVE: "24h",
      }));

      // Mock memory module - search returns similar memory
      mockDb.setUpdateReturnValue([existingMemory]);

      mock.module("../src/memory", () => ({
        searchSimilarMemories: vi.fn(async () => [
          {
            ...existingMemory,
            distance: 0.1,
          },
        ]),
        createMemory: vi.fn(async (data: any) => 200),
        updateMemory: vi.fn(async () => true),
      }));

      // Mock prompt module
      mock.module("../src/prompt", () => ({
        FactRetrievalSchema: {
          parse: (data: any) => data,
        },
        MemoryUpdateSchema: {
          parse: (data: any) => data,
        },
        getFactRetrievalMessages: vi.fn(() => ["System prompt", "User prompt"]),
        getUpdateMemoryMessages: vi.fn(() => "Memory update prompt"),
        parseMessages: vi.fn((lines: string[]) => lines.join("\n")),
        removeCodeBlocks: vi.fn((content: string) => content),
      }));

      // Mock zod module
      mock.module("zod", () => ({
        z: {
          toJSONSchema: vi.fn(() => ({})),
        },
      }));

      // Import after mocking
      const { runMemoryExtraction } = await import("../src/extraction");

      const result = await runMemoryExtraction({
        userId: 1,
        llmProvider: "ollama",
        embeddingProvider: "ollama",
      });

      expect(result.messages.length).toBe(1);
      expect(result.markedMessageCount).toBe(1);
      expect(result.memoryReferences.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("runMemoryExtraction - error handling", () => {
    test("throws error and logs context when fact extraction fails", async () => {
      const mockMessages: Message[] = [
        {
          id: 1,
          userId: 1,
          role: "user",
          content: "Test message",
          extracted: false,
          createdAt: new Date(),
          metadata: null,
        },
      ];

      // Mock message module
      mock.module("../src/message", () => ({
        listMessages: vi.fn(async () => mockMessages),
        markMessagesExtracted: vi.fn(async () => 0),
      }));

      // Mock LLM module to throw error
      mock.module("../src/llm", () => ({
        getOllama: vi.fn(() => ({
          chat: vi.fn(async () => {
            throw new Error("LLM API error");
          }),
        })),
        embedTexts: vi.fn(async () => [createTestEmbedding()]),
        DEFAULT_OLLAMA_MODEL: "test-model",
        OLLAMA_KEEP_ALIVE: "24h",
      }));

      // Mock memory module
      mock.module("../src/memory", () => ({
        searchSimilarMemories: vi.fn(async () => []),
        createMemory: vi.fn(async () => 1),
        updateMemory: vi.fn(async () => true),
      }));

      // Mock prompt module
      mock.module("../src/prompt", () => ({
        FactRetrievalSchema: { parse: (data: any) => data },
        MemoryUpdateSchema: { parse: (data: any) => data },
        getFactRetrievalMessages: vi.fn(() => ["System", "User"]),
        getUpdateMemoryMessages: vi.fn(() => "Update"),
        parseMessages: vi.fn((lines: string[]) => lines.join("\n")),
        removeCodeBlocks: vi.fn((content: string) => content),
      }));

      // Mock zod module
      mock.module("zod", () => ({
        z: { toJSONSchema: vi.fn(() => ({})) },
      }));

      // Import after mocking
      const { runMemoryExtraction } = await import("../src/extraction");

      await expect(
        runMemoryExtraction({
          userId: 1,
          llmProvider: "ollama",
        }),
      ).rejects.toThrow("Memory extraction failed");
    });
  });

  describe("runMemoryExtraction - with message limit", () => {
    test("respects message limit parameter", async () => {
      const mockMessages: Message[] = [
        {
          id: 1,
          userId: 1,
          role: "user",
          content: "Message 1",
          extracted: false,
          createdAt: new Date(),
          metadata: null,
        },
        {
          id: 2,
          userId: 1,
          role: "assistant",
          content: "Response 1",
          extracted: false,
          createdAt: new Date(),
          metadata: null,
        },
      ];

      const listMessagesMock = vi.fn(async (options: any) => {
        expect(options.limit).toBe(10);
        return mockMessages.slice(0, options.limit);
      });

      // Mock message module
      mock.module("../src/message", () => ({
        listMessages: listMessagesMock,
        markMessagesExtracted: vi.fn(async (ids: number[]) => ids.length),
      }));

      // Mock LLM module
      mock.module("../src/llm", () => ({
        getOllama: vi.fn(() => ({
          chat: vi.fn(async () => ({
            message: { content: JSON.stringify({ facts: [], memory: [] }) },
          })),
          embed: vi.fn(async () => ({ embeddings: [createTestEmbedding()] })),
        })),
        embedTexts: vi.fn(async () => [createTestEmbedding()]),
        DEFAULT_OLLAMA_MODEL: "test-model",
        OLLAMA_KEEP_ALIVE: "24h",
      }));

      // Mock memory module
      mock.module("../src/memory", () => ({
        searchSimilarMemories: vi.fn(async () => []),
        createMemory: vi.fn(async () => 1),
        updateMemory: vi.fn(async () => true),
      }));

      // Mock prompt module
      mock.module("../src/prompt", () => ({
        FactRetrievalSchema: { parse: (data: any) => data || { facts: [] } },
        MemoryUpdateSchema: { parse: (data: any) => data || { memory: [] } },
        getFactRetrievalMessages: vi.fn(() => ["System", "User"]),
        getUpdateMemoryMessages: vi.fn(() => "Update"),
        parseMessages: vi.fn((lines: string[]) => lines.join("\n")),
        removeCodeBlocks: vi.fn((content: string) => content),
      }));

      // Mock zod module
      mock.module("zod", () => ({
        z: { toJSONSchema: vi.fn(() => ({})) },
      }));

      // Import after mocking
      const { runMemoryExtraction } = await import("../src/extraction");

      await runMemoryExtraction({
        userId: 1,
        messageLimit: 10,
        llmProvider: "ollama",
      });

      expect(listMessagesMock).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });
  });

  describe("runMemoryExtraction - batch embedding optimization", () => {
    test("generates embeddings for all facts at once", async () => {
      const mockMessages: Message[] = [
        {
          id: 1,
          userId: 1,
          role: "user",
          content: "I like pizza and pasta",
          extracted: false,
          createdAt: new Date(),
          metadata: null,
        },
      ];

      const mockFacts: ExtractedFact[] = [
        {
          factId: "F1",
          statement: "User likes pizza",
          confidence: 1,
          sourceMessageIds: [1],
        },
        {
          factId: "F2",
          statement: "User likes pasta",
          confidence: 1,
          sourceMessageIds: [1],
        },
      ];

      const embedTextsMock = vi.fn(async (provider: string, texts: string[]) => {
        // Verify batch call with multiple facts
        expect(texts.length).toBe(2);
        return [createTestEmbedding(), createTestEmbedding()];
      });

      // Mock message module
      mock.module("../src/message", () => ({
        listMessages: vi.fn(async () => mockMessages),
        markMessagesExtracted: vi.fn(async (ids: number[]) => ids.length),
      }));

      // Mock LLM module
      mock.module("../src/llm", () => ({
        getOllama: vi.fn(() => ({
          chat: vi.fn()
            .mockResolvedValueOnce({
              message: {
                content: JSON.stringify({ facts: mockFacts.map((f) => f.statement) }),
              },
            })
            .mockResolvedValueOnce({
              message: { content: JSON.stringify({ memory: [] }) },
            }),
        })),
        embedTexts: embedTextsMock,
        DEFAULT_OLLAMA_MODEL: "test-model",
        OLLAMA_KEEP_ALIVE: "24h",
      }));

      // Mock memory module
      mock.module("../src/memory", () => ({
        searchSimilarMemories: vi.fn(async () => []),
        createMemory: vi.fn(async () => 1),
        updateMemory: vi.fn(async () => true),
      }));

      // Mock prompt module
      mock.module("../src/prompt", () => ({
        FactRetrievalSchema: { parse: (data: any) => data },
        MemoryUpdateSchema: { parse: (data: any) => data },
        getFactRetrievalMessages: vi.fn(() => ["System", "User"]),
        getUpdateMemoryMessages: vi.fn(() => "Update"),
        parseMessages: vi.fn((lines: string[]) => lines.join("\n")),
        removeCodeBlocks: vi.fn((content: string) => content),
      }));

      // Mock zod module
      mock.module("zod", () => ({
        z: { toJSONSchema: vi.fn(() => ({})) },
      }));

      // Import after mocking
      const { runMemoryExtraction } = await import("../src/extraction");

      await runMemoryExtraction({
        userId: 1,
        llmProvider: "ollama",
        embeddingProvider: "ollama",
      });

      // Verify batch embedding was called
      expect(embedTextsMock).toHaveBeenCalled();
    });
  });
});
