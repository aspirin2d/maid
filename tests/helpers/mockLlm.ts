import { vi } from "bun:test";
import type { Provider, StreamEvent, StructuredFormat } from "../../src/llm";

type EmbedCall = {
  provider: Provider;
  texts: string[];
  dims: number;
};

type StructuredCallArgs = {
  prompt: string;
  format: StructuredFormat;
};

type StructuredCall = {
  provider: Provider;
  args: StructuredCallArgs;
};

/**
 * Mock LLM helper for testing
 * Tracks all embedding and structured generation calls
 */
export function createMockLlm() {
  // Default embedding response (1536-dimensional vector of zeros)
  let embedResponse: number[][] = [Array(1536).fill(0)];

  // Default structured response
  let structuredResponse: AsyncGenerator<StreamEvent> = (async function* () {
    yield { type: "delta", data: '{"test": "response"}' };
    yield { type: "done", data: "" };
  })();

  // Call tracking
  const embedCalls: EmbedCall[] = [];
  const structuredCalls: StructuredCall[] = [];

  // Mock embedTexts function
  const embedTexts = vi.fn(
    async (provider: Provider, texts: string[], dims = 1536): Promise<number[][]> => {
      embedCalls.push({ provider, texts, dims });
      // Return array of embeddings matching the number of input texts
      return embedResponse.slice(0, texts.length);
    },
  );

  // Mock embedText function
  const embedText = vi.fn(
    async (provider: Provider, text: string, dims = 1536): Promise<number[]> => {
      embedCalls.push({ provider, texts: [text], dims });
      return embedResponse[0] || Array(dims).fill(0);
    },
  );

  // Mock streamOpenAIStructured function
  const streamOpenAIStructured = vi.fn(
    async function* (args: StructuredCallArgs): AsyncGenerator<StreamEvent> {
      structuredCalls.push({ provider: "openai", args });
      yield* structuredResponse;
    },
  );

  // Mock streamOllamaStructured function
  const streamOllamaStructured = vi.fn(
    async function* (args: StructuredCallArgs): AsyncGenerator<StreamEvent> {
      structuredCalls.push({ provider: "ollama", args });
      yield* structuredResponse;
    },
  );

  return {
    embedTexts,
    embedText,
    streamOpenAIStructured,
    streamOllamaStructured,

    // Setters for mock responses
    setEmbedResponse(response: number[][]) {
      embedResponse = response;
    },

    setStructuredResponse(response: AsyncGenerator<StreamEvent>) {
      structuredResponse = response;
    },

    // Helper to set structured response from a simple object
    setStructuredResponseFromObject(obj: any) {
      structuredResponse = (async function* () {
        yield { type: "delta", data: JSON.stringify(obj) };
        yield { type: "done", data: "" };
      })();
    },

    // Helper to create an error response
    setStructuredError(errorMessage: string) {
      structuredResponse = (async function* () {
        yield { type: "error", data: errorMessage };
      })();
    },

    // Call tracking
    __calls: {
      embedCalls,
      structuredCalls,
    },

    // Reset all tracking
    reset() {
      embedCalls.length = 0;
      structuredCalls.length = 0;
      embedResponse = [Array(1536).fill(0)];
      embedTexts.mockClear();
      embedText.mockClear();
      streamOpenAIStructured.mockClear();
      streamOllamaStructured.mockClear();
    },
  };
}

/**
 * Helper to create a simple embedding vector for testing
 * Creates a vector with a specific pattern for easy verification
 */
export function createTestEmbedding(dims = 1536, seed = 1): number[] {
  return Array.from({ length: dims }, (_, i) => (i + seed) / dims);
}

/**
 * Helper to collect all events from a stream
 */
export async function collectStreamEvents(
  stream: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

/**
 * Helper to collect only delta data from a stream
 */
export async function collectStreamDeltas(
  stream: AsyncGenerator<StreamEvent>,
): Promise<string> {
  let result = "";
  for await (const event of stream) {
    if (event.type === "delta") {
      result += event.data;
    }
  }
  return result;
}
