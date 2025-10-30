import { Ollama } from "ollama";
import OpenAI from "openai";

export type Provider = "openai" | "ollama";

// Shared embedding configuration
export const EMBEDDING_DIMS = 1536;
export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = "qwen3-embedding";
// Central default for Ollama generation model
export const DEFAULT_OLLAMA_MODEL = "alibayram/Qwen3-30B-A3B-Instruct-2507";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1";

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE ?? "24h"; // e.g. "30m", "2h", "-1"

export function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. Please add it to your .env file.",
    );
  }
  return new OpenAI({
    apiKey,
  });
}

export function getOllama(): Ollama {
  const host = OLLAMA_BASE_URL || "http://localhost:11434";
  return new Ollama({ host });
}

export function fitToDims(vec: number[], dims = EMBEDDING_DIMS): number[] {
  if (vec.length === dims) return vec;
  if (vec.length > dims) return vec.slice(0, dims);
  const out = vec.slice();
  while (out.length < dims) out.push(0);
  return out;
}

export async function embedTexts(
  provider: Provider,
  texts: string[],
  dims = EMBEDDING_DIMS,
): Promise<number[][]> {
  if (provider === "openai") {
    const client = getOpenAI();
    const res = await client.embeddings.create({
      model: DEFAULT_OPENAI_EMBEDDING_MODEL,
      input: texts,
      dimensions: dims,
    });
    return res.data.map((d) => d.embedding);
  }

  const client = getOllama();
  const res = await client.embed({
    model: DEFAULT_OLLAMA_EMBEDDING_MODEL,
    input: texts,
    keep_alive: OLLAMA_KEEP_ALIVE,
  });
  return res.embeddings.map((e) => fitToDims(e, dims));
}

export async function embedText(
  provider: Provider,
  text: string,
  dims = EMBEDDING_DIMS,
): Promise<number[]> {
  const [first] = await embedTexts(provider, [text], dims);
  return first!;
}

// ============
// Streaming IO
// ============

export type StreamEvent =
  | { type: "delta"; data: string }
  | { type: "refusal"; data: string }
  | { type: "thinking"; data: string }
  | { type: "error"; data: string }
  | { type: "done"; data: "" };

export interface StructuredFormat {
  name: string;
  schema: Record<string, any>;
}

export async function* streamOpenAIStructured(args: {
  prompt: string;
  format: StructuredFormat;
}): AsyncGenerator<StreamEvent> {
  const { prompt, format } = args;
  const client = getOpenAI();
  const stream = client.responses.stream({
    model: DEFAULT_OPENAI_MODEL,
    input: prompt,
    text: { format: { ...format, strict: true, type: "json_schema" } },
  });
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      yield { type: "delta", data: event.delta };
    }
    if (event.type === "response.refusal.delta") {
      yield { type: "refusal", data: event.delta };
    }
    if (event.type === "error") {
      yield { type: "error", data: String(event.message) };
      return;
    }
    if (event.type === "response.completed") {
      yield { type: "done", data: "" };
      return;
    }
  }
}

export async function* streamOllamaStructured(args: {
  prompt: string;
  format: StructuredFormat;
}): AsyncGenerator<StreamEvent> {
  const { prompt, format } = args;
  const client = getOllama();
  const stream = await client.chat({
    model: DEFAULT_OLLAMA_MODEL,
    messages: [{ role: "user", content: prompt }],
    stream: true,
    // Pass through experimental flag; ignored by models that don't support it
    options: {
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
    },
    format: format.schema,
    keep_alive: OLLAMA_KEEP_ALIVE,
  });
  for await (const chunk of stream) {
    if (chunk && typeof chunk === "object" && "error" in chunk) {
      yield { type: "error", data: String(chunk.error) };
    }
    if (chunk && typeof chunk === "object" && "done" in chunk && chunk.done) {
      yield { type: "done", data: "" };
      return;
    }

    if (chunk?.message?.content) {
      yield { type: "delta", data: chunk.message.content };
    }
  }
}
