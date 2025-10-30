import { test, expect, describe, beforeEach, mock } from "bun:test";
import {
  embedText,
  embedTexts,
  fitToDims,
  streamOpenAIStructured,
  streamOllamaStructured,
  EMBEDDING_DIMS,
  type StreamEvent,
  type StructuredFormat,
} from "../src/llm";
import {
  createMockLlm,
  createTestEmbedding,
  collectStreamEvents,
  collectStreamDeltas,
} from "./helpers/mockLlm";

describe("llm module", () => {
  describe("fitToDims", () => {
    test("returns same vector if dimensions match", () => {
      const vec = [1, 2, 3, 4, 5];
      const result = fitToDims(vec, 5);
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    test("truncates vector if too long", () => {
      const vec = [1, 2, 3, 4, 5];
      const result = fitToDims(vec, 3);
      expect(result).toEqual([1, 2, 3]);
    });

    test("pads vector with zeros if too short", () => {
      const vec = [1, 2, 3];
      const result = fitToDims(vec, 5);
      expect(result).toEqual([1, 2, 3, 0, 0]);
    });

    test("uses default EMBEDDING_DIMS if not specified", () => {
      const vec = [1, 2, 3];
      const result = fitToDims(vec);
      expect(result.length).toBe(EMBEDDING_DIMS);
      expect(result.slice(0, 3)).toEqual([1, 2, 3]);
    });
  });

  describe("embedText with mocked OpenAI", () => {
    beforeEach(() => {
      // Mock OpenAI client
      const mockEmbedding = createTestEmbedding(1536, 42);
      mock.module("openai", () => ({
        default: class MockOpenAI {
          embeddings = {
            create: async ({ input, dimensions }: any) => ({
              data: Array.isArray(input)
                ? input.map(() => ({ embedding: mockEmbedding.slice(0, dimensions) }))
                : [{ embedding: mockEmbedding.slice(0, dimensions) }],
            }),
          };
        },
      }));
    });

    test("embeds single text with OpenAI provider", async () => {
      const result = await embedText("openai", "Hello world");
      expect(result).toBeDefined();
      expect(result.length).toBe(EMBEDDING_DIMS);
      expect(typeof result[0]).toBe("number");
    });

    test("respects custom dimensions", async () => {
      const result = await embedText("openai", "Hello world", 512);
      expect(result.length).toBe(512);
    });
  });

  describe("embedTexts with mocked OpenAI", () => {
    beforeEach(() => {
      const mockEmbedding1 = createTestEmbedding(1536, 1);
      const mockEmbedding2 = createTestEmbedding(1536, 2);
      mock.module("openai", () => ({
        default: class MockOpenAI {
          embeddings = {
            create: async ({ input, dimensions }: any) => ({
              data: [
                { embedding: mockEmbedding1.slice(0, dimensions) },
                { embedding: mockEmbedding2.slice(0, dimensions) },
              ].slice(0, input.length),
            }),
          };
        },
      }));
    });

    test("embeds multiple texts with OpenAI provider", async () => {
      const texts = ["Hello", "World"];
      const results = await embedTexts("openai", texts);
      expect(results.length).toBe(2);
      expect(results[0]?.length).toBe(EMBEDDING_DIMS);
      expect(results[1]?.length).toBe(EMBEDDING_DIMS);
    });
  });

  describe("embedText with mocked Ollama", () => {
    beforeEach(() => {
      const mockEmbedding = createTestEmbedding(2048, 99); // Ollama might return different dims
      mock.module("ollama", () => ({
        Ollama: class MockOllama {
          async embed({ input }: any) {
            return {
              embeddings: Array.isArray(input) ? input.map(() => mockEmbedding) : [mockEmbedding],
            };
          }
        },
      }));
    });

    test("embeds text with Ollama provider and fits to dims", async () => {
      const result = await embedText("ollama", "Hello world");
      expect(result).toBeDefined();
      expect(result.length).toBe(EMBEDDING_DIMS);
    });
  });

  describe("streamOpenAIStructured with mocked client", () => {
    test("streams structured output from OpenAI", async () => {
      const mockEvents = [
        { type: "response.output_text.delta", delta: '{"name": "' },
        { type: "response.output_text.delta", delta: 'John' },
        { type: "response.output_text.delta", delta: '"}' },
        { type: "response.completed" },
      ];

      let eventIndex = 0;
      mock.module("openai", () => ({
        default: class MockOpenAI {
          responses = {
            stream: () => ({
              async *[Symbol.asyncIterator]() {
                for (const event of mockEvents) {
                  yield event;
                }
              },
            }),
          };
        },
      }));

      const format: StructuredFormat = {
        name: "test_schema",
        schema: { type: "object", properties: { name: { type: "string" } } },
      };

      const stream = streamOpenAIStructured({
        prompt: "Extract the name",
        format,
      });

      const events = await collectStreamEvents(stream);
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1]?.type).toBe("done");
    });

    test("handles OpenAI streaming errors", async () => {
      mock.module("openai", () => ({
        default: class MockOpenAI {
          responses = {
            stream: () => ({
              async *[Symbol.asyncIterator]() {
                yield { type: "error", message: "API error" };
              },
            }),
          };
        },
      }));

      const format: StructuredFormat = {
        name: "test_schema",
        schema: { type: "object" },
      };

      const stream = streamOpenAIStructured({
        prompt: "Test prompt",
        format,
      });

      const events = await collectStreamEvents(stream);
      expect(events.some((e) => e.type === "error")).toBe(true);
    });

    test("handles refusal events", async () => {
      mock.module("openai", () => ({
        default: class MockOpenAI {
          responses = {
            stream: () => ({
              async *[Symbol.asyncIterator]() {
                yield { type: "response.refusal.delta", delta: "I cannot help with that" };
                yield { type: "response.completed" };
              },
            }),
          };
        },
      }));

      const format: StructuredFormat = {
        name: "test_schema",
        schema: { type: "object" },
      };

      const stream = streamOpenAIStructured({
        prompt: "Malicious prompt",
        format,
      });

      const events = await collectStreamEvents(stream);
      expect(events.some((e) => e.type === "refusal")).toBe(true);
    });
  });

  describe("streamOllamaStructured with mocked client", () => {
    test("streams structured output from Ollama", async () => {
      mock.module("ollama", () => ({
        Ollama: class MockOllama {
          async chat({ messages, stream }: any) {
            const mockChunks = [
              { message: { content: '{"fact": "' } },
              { message: { content: "test fact" } },
              { message: { content: '"}' } },
              { done: true },
            ];
            return (async function* () {
              for (const chunk of mockChunks) {
                yield chunk;
              }
            })();
          }
        },
      }));

      const format: StructuredFormat = {
        name: "test_schema",
        schema: { type: "object", properties: { fact: { type: "string" } } },
      };

      const stream = streamOllamaStructured({
        prompt: "Extract facts",
        format,
      });

      const events = await collectStreamEvents(stream);
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1]?.type).toBe("done");

      const deltas = events.filter((e) => e.type === "delta");
      expect(deltas.length).toBeGreaterThan(0);
    });

    test("handles Ollama streaming errors", async () => {
      mock.module("ollama", () => ({
        Ollama: class MockOllama {
          async chat() {
            return (async function* () {
              yield { error: "Connection failed" };
            })();
          }
        },
      }));

      const format: StructuredFormat = {
        name: "test_schema",
        schema: { type: "object" },
      };

      const stream = streamOllamaStructured({
        prompt: "Test prompt",
        format,
      });

      const events = await collectStreamEvents(stream);
      expect(events.some((e) => e.type === "error")).toBe(true);
    });

    test("collects full JSON output from deltas", async () => {
      const expectedJson = { facts: ["fact1", "fact2"], count: 2 };

      mock.module("ollama", () => ({
        Ollama: class MockOllama {
          async chat() {
            return (async function* () {
              const jsonStr = JSON.stringify(expectedJson);
              // Simulate streaming character by character
              for (const char of jsonStr) {
                yield { message: { content: char } };
              }
              yield { done: true };
            })();
          }
        },
      }));

      const format: StructuredFormat = {
        name: "test_schema",
        schema: { type: "object" },
      };

      const stream = streamOllamaStructured({
        prompt: "Test",
        format,
      });

      const collected = await collectStreamDeltas(stream);
      expect(JSON.parse(collected)).toEqual(expectedJson);
    });
  });
});
