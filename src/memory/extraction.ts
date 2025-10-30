import { DEFAULT_OPENAI_MODEL, DEFAULT_OLLAMA_MODEL, getOllama, getOpenAI, type Provider as EmbeddingProvider } from "../llm";
import {
  createMemory,
  getMemory,
  searchSimilarMemories,
  updateMemory,
  type Memory,
} from "../db/memory";
import {
  getUnextractedMessages,
  markMessagesAsExtracted,
  type Message,
} from "../db/message";

type LLMProvider = "openai" | "ollama";

export interface MemoryExtractionOptions {
  /**
   * Upper bound on how many unextracted messages to submit per run.
   * Defaults to 20.
   */
  messageLimit?: number;
  /**
   * Structured output capable LLM provider. Defaults to OpenAI.
   */
  llmProvider?: LLMProvider;
  /**
   * Embedding provider used for similarity search & deduplication. Defaults to Ollama.
   */
  embeddingProvider?: EmbeddingProvider;
  /**
   * Optional override hook for tests/examples to bypass real LLM calls.
   */
  llmOverride?: (args: {
    prompt: string;
    messages: Message[];
    relatedMemories: Memory[];
  }) => Promise<MemoryExtractionLLMResponse>;
  /**
   * Minimum cosine-style similarity (0-1) to consider an existing memory a potential duplicate/update candidate.
   * Defaults to 0.85.
   */
  similarityThreshold?: number;
  /**
   * When fetching related memories for prompt context, cap the number aggregated across messages.
   * Defaults to 12.
   */
  relatedMemoryLimit?: number;
  /**
   * Skip vector similarity lookups (helpful for offline tests).
   */
  disableSimilarity?: boolean;
  /**
   * Avoid generating embeddings when creating or updating memories.
   */
  skipEmbeddingGeneration?: boolean;
}

export interface MemoryExtractionCandidate {
  category: Memory["category"];
  content: string;
  summary?: string;
  importanceScore?: number;
  confidenceScore?: number;
  emotionalWeight?: number;
  sourceMessageIds?: string[];
  metadata?: Record<string, any> | null;
  relationship?: "new" | "update" | "contradiction" | "duplicate";
  relatedMemoryId?: string;
  rationale?: string;
}

export interface MemoryExtractionLLMResponse {
  memories: MemoryExtractionCandidate[];
  notes?: string;
}

export interface MemoryExtractionSummary {
  created: string[];
  updated: string[];
  superseded: string[];
  skipped: Array<{
    candidate: MemoryExtractionCandidate;
    reason: "duplicate" | "invalid" | "error";
    existingMemoryId?: string;
    details?: string;
  }>;
  errors: Array<{ message: string; candidate?: MemoryExtractionCandidate }>;
  messageIdsMarked: string[];
  llmProvider: LLMProvider;
  rawModelOutput?: unknown;
  warnings: Array<{
    message: string;
    candidate?: MemoryExtractionCandidate;
    relatedMemoryId?: string;
  }>;
}

const MEMORY_CATEGORIES: Memory["category"][] = [
  "USER_FACTS",
  "USER_PREFERENCES",
  "USER_GOALS",
  "EPISODIC_EVENTS",
  "CONTEXT_PATTERNS",
];

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    memories: {
      type: "array",
      description: "Memory candidates extracted from the provided dialogue",
      default: [],
      items: {
        type: "object",
        additionalProperties: true,
        required: ["category", "content"],
        properties: {
          category: { type: "string", enum: MEMORY_CATEGORIES },
          content: { type: "string", minLength: 6 },
          summary: { type: "string" },
          importanceScore: { type: "number", minimum: 0, maximum: 10 },
          confidenceScore: { type: "number", minimum: 0, maximum: 1 },
          emotionalWeight: { type: "number", minimum: -5, maximum: 5 },
          sourceMessageIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          metadata: {
            type: "object",
            description: "Additional structured metadata",
            additionalProperties: true,
          },
          relationship: {
            type: "string",
            enum: ["new", "update", "contradiction", "duplicate"],
          },
          relatedMemoryId: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
    notes: { type: "string" },
  },
  required: ["memories"],
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  const intersection = [...tokensA].filter((token) => tokensB.has(token));
  const union = new Set([...tokensA, ...tokensB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function isDuplicateContent(existing: string, incoming: string): boolean {
  const normalizedExisting = normalizeText(existing);
  const normalizedIncoming = normalizeText(incoming);
  if (normalizedExisting === normalizedIncoming) return true;
  if (
    normalizedExisting.length > 0 &&
    normalizedIncoming.length > 0 &&
    (normalizedExisting.includes(normalizedIncoming) ||
      normalizedIncoming.includes(normalizedExisting))
  ) {
    return true;
  }
  const similarity = jaccardSimilarity(existing, incoming);
  return similarity >= 0.9;
}

function mergeContent(existing: string, incoming: string): string {
  const trimmedExisting = existing.trim();
  const trimmedIncoming = incoming.trim();
  if (!trimmedExisting) return trimmedIncoming;
  if (!trimmedIncoming) return trimmedExisting;
  const normalizedExisting = normalizeText(trimmedExisting);
  const normalizedIncoming = normalizeText(trimmedIncoming);
  if (normalizedExisting.includes(normalizedIncoming)) return trimmedExisting;
  return `${trimmedExisting}\n${trimmedIncoming}`.trim();
}

function mergeSourceIds(existing: string[] | null | undefined, incoming: string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...incoming]));
}

function nowIso(): string {
  return new Date().toISOString();
}

function toMillis(value: Date | string | number | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

interface GuardResult {
  pass: boolean;
  reason?: string;
}

function evaluateContradictionGuard(
  existing: Memory,
  candidate: MemoryExtractionCandidate,
  messageIndex: Map<string, Message>,
  fallbackMessageIds: string[],
): GuardResult {
  const existingConfidence = existing.confidenceScore ?? 0;
  const candidateConfidence = candidate.confidenceScore ?? 0;

  if (candidateConfidence < existingConfidence) {
    return {
      pass: false,
      reason: `Candidate confidence ${candidateConfidence.toFixed(2)} lower than existing ${existingConfidence.toFixed(2)}`,
    };
  }

  const relevantIds =
    candidate.sourceMessageIds && candidate.sourceMessageIds.length > 0
      ? candidate.sourceMessageIds
      : fallbackMessageIds;

  const candidateTimes = relevantIds
    .map((id) => messageIndex.get(id)?.timestamp)
    .map((value) => toMillis(value as Date | string | number | null | undefined))
    .filter((value): value is number => value !== null);

  const latestCandidateTime = candidateTimes.length > 0 ? Math.max(...candidateTimes) : null;
  const existingTimestamp = toMillis(
    (existing.updatedAt as Date | string | number | null | undefined) ??
      (existing.createdAt as Date | string | number | null | undefined),
  );

  if (existingTimestamp !== null && latestCandidateTime !== null) {
    if (latestCandidateTime < existingTimestamp) {
      return {
        pass: false,
        reason: "Contradiction evidence is not more recent than existing memory",
      };
    }
  }

  return { pass: true };
}

async function callOpenAI(prompt: string): Promise<MemoryExtractionLLMResponse> {
  const client = getOpenAI();
  const parsed = await client.responses.parse({
    model: DEFAULT_OPENAI_MODEL,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "user_memory_extraction",
        schema: EXTRACTION_SCHEMA,
        strict: true,
      },
    },
  });

  if (parsed.output_parsed) {
    return parsed.output_parsed as MemoryExtractionLLMResponse;
  }

  const outputTextRaw = parsed.output_text as unknown;
  const outputText =
    typeof outputTextRaw === "string"
      ? outputTextRaw
      : Array.isArray(outputTextRaw)
        ? outputTextRaw.join("\n")
        : undefined;

  if (!outputText) {
    throw new Error("OpenAI response missing structured output");
  }

  return JSON.parse(outputText) as MemoryExtractionLLMResponse;
}

async function callOllama(prompt: string): Promise<MemoryExtractionLLMResponse> {
  const client = getOllama();
  const res = await client.chat({
    model: DEFAULT_OLLAMA_MODEL,
    messages: [{ role: "user", content: prompt }],
    format: {
      type: "object",
      properties: EXTRACTION_SCHEMA.properties,
      required: EXTRACTION_SCHEMA.required,
      additionalProperties: false,
    },
    stream: false,
    keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "24h",
  });

  const content = res?.message?.content;
  if (!content) {
    throw new Error("Ollama response missing content");
  }

  return JSON.parse(content) as MemoryExtractionLLMResponse;
}

function buildPrompt(args: {
  messages: Message[];
  relatedMemories: Memory[];
}): string {
  const { messages, relatedMemories } = args;
  const messageLines = messages
    .map((msg, index) => {
      const timestamp = msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : "unknown";
      return `${index + 1}. [${msg.role} | ${timestamp} | id=${msg.id}] ${msg.content}`;
    })
    .join("\n");

  const memoryLines = relatedMemories
    .map((memory) => {
      const updatedAt = memory.updatedAt
        ? new Date(memory.updatedAt).toISOString()
        : "unknown";
      const summary = memory.summary ?? memory.content.slice(0, 120);
      return `- id=${memory.id} [${memory.category}] importance=${memory.importanceScore?.toFixed?.(2) ?? "n/a"}, confidence=${memory.confidenceScore?.toFixed?.(2) ?? "n/a"}, updated=${updatedAt}\n  summary: ${summary}\n  content: ${memory.content}`;
    })
    .join("\n");

  return `You are an AI assistant that extracts durable, factual memories about a user from conversation logs.

Messages to analyze (oldest first):
${messageLines || "(no new user messages)"}

Existing related memories:
${memoryLines || "(no related memories found)"}

Instructions:
- Focus on persistent user information: facts, preferences, goals, recent episodic events, or behavioral patterns.
- Ignore small talk, transient questions, or assistant-only content.
- Compare with the related memories to avoid duplicates, updates, or contradictions. Reference memory ids when appropriate.
- If a message contradicts an existing memory, mark it as a contradiction targeting that memory id.
- Provide concise summaries when possible and estimate importance (0-10) and confidence (0-1).
- Output ONLY compliant JSON matching the provided schema.
- Populate sourceMessageIds with relevant message ids.
`;
}

// Ensure LLM output includes the minimum metadata before touching persistent state.
function validateCandidate(
  candidate: MemoryExtractionCandidate,
  fallbackMessageIds: string[],
): { candidate: MemoryExtractionCandidate | null; reason?: string } {
  if (!candidate) return { candidate: null, reason: "candidate_missing" };
  if (!candidate.category || !MEMORY_CATEGORIES.includes(candidate.category)) {
    return { candidate: null, reason: "invalid_category" };
  }
  if (!candidate.content || !candidate.content.trim()) {
    return { candidate: null, reason: "empty_content" };
  }
  if (!candidate.sourceMessageIds || candidate.sourceMessageIds.length === 0) {
    return { candidate: null, reason: "missing_source_ids" };
  }

  return {
    candidate: {
      category: candidate.category,
      content: candidate.content.trim(),
      summary: candidate.summary?.trim(),
      importanceScore:
        typeof candidate.importanceScore === "number"
          ? Math.min(10, Math.max(0, candidate.importanceScore))
          : undefined,
      confidenceScore:
        typeof candidate.confidenceScore === "number"
          ? Math.min(1, Math.max(0, candidate.confidenceScore))
          : undefined,
      emotionalWeight:
        typeof candidate.emotionalWeight === "number"
          ? Math.min(5, Math.max(-5, candidate.emotionalWeight))
          : undefined,
      sourceMessageIds: candidate.sourceMessageIds,
      metadata: candidate.metadata ?? null,
      relationship: candidate.relationship,
      relatedMemoryId: candidate.relatedMemoryId,
      rationale: candidate.rationale,
    },
  };
}

interface DedupDecision {
  action: "create" | "skip_duplicate" | "update" | "supersede";
  target?: Memory;
  reason?: string;
}

// Decide how to treat a candidate, preferring explicit references over nearest-neighbour guesses.
function determineAction(
  candidate: MemoryExtractionCandidate,
  args: {
    similarityMatch?: Memory;
    similarity?: number;
    explicitTarget?: Memory;
    threshold: number;
  },
): DedupDecision {
  const target = args.explicitTarget ?? args.similarityMatch;
  const similarity = args.explicitTarget ? 1 : args.similarity;

  if (!target || similarity === undefined || similarity < args.threshold) {
    return { action: "create" };
  }

  if (candidate.relationship === "contradiction") {
    return { action: "supersede", target, reason: "LLM flagged contradiction" };
  }

  if (candidate.relationship === "duplicate") {
    return { action: "skip_duplicate", target, reason: "LLM flagged duplicate" };
  }

  const candidateMetadataTarget = candidate.metadata?.contradictsMemoryId
    ? (candidate.metadata.contradictsMemoryId as string)
    : candidate.relatedMemoryId;
  if (candidateMetadataTarget && target.id && candidateMetadataTarget === target.id) {
    if (candidate.metadata?.contradiction === true) {
      return { action: "supersede", target, reason: "Candidate metadata contradiction" };
    }
    if (candidate.relationship === "update") {
      return { action: "update", target, reason: "Candidate metadata update" };
    }
  }

  if (isDuplicateContent(target.content, candidate.content)) {
    return { action: "skip_duplicate", target, reason: "Content duplicate" };
  }

  return { action: "update", target, reason: "High similarity => treat as update" };
}

async function applyUpdate(
  existing: Memory,
  candidate: MemoryExtractionCandidate,
  messageIds: string[],
  skipEmbedding: boolean,
): Promise<string> {
  const mergedContent = mergeContent(existing.content, candidate.content);
  const mergedSourceIds = mergeSourceIds(existing.sourceMessageIds, candidate.sourceMessageIds ?? messageIds);

  const mergedMetadata = {
    ...(existing.metadata ?? {}),
    ...(candidate.metadata ?? {}),
    history: [
      ...(((existing.metadata ?? {}) as any).history ?? []),
      {
        type: "update",
        at: nowIso(),
        previousContent: existing.content,
        rationale: candidate.rationale,
      },
    ],
  };

  let importance = existing.importanceScore ?? 5;
  if (candidate.importanceScore !== undefined) {
    importance = candidate.importanceScore;
  } else if (candidate.relationship === "update") {
    importance = Math.min(10, importance + 0.25);
  }

  await updateMemory(
    existing.id,
    {
      content: mergedContent,
      summary: candidate.summary ?? existing.summary ?? candidate.content.slice(0, 120),
      importanceScore: importance,
      confidenceScore: candidate.confidenceScore ?? existing.confidenceScore,
      emotionalWeight: candidate.emotionalWeight ?? existing.emotionalWeight,
      metadata: mergedMetadata,
      sourceMessageIds: mergedSourceIds,
    },
    { skipEmbedding },
  );

  return existing.id;
}

async function applySupersede(
  existing: Memory,
  candidate: MemoryExtractionCandidate,
  messageIds: string[],
  skipEmbedding: boolean,
): Promise<string> {
  const supersedeMetadata = {
    ...(candidate.metadata ?? {}),
    superseded: {
      previousMemoryId: existing.id,
      previousContent: existing.content,
      replacedAt: nowIso(),
    },
  };

  const importance =
    candidate.importanceScore !== undefined
      ? candidate.importanceScore
      : existing.importanceScore ?? 5;

  await updateMemory(
    existing.id,
    {
      content: candidate.content,
      summary: candidate.summary ?? existing.summary ?? candidate.content.slice(0, 120),
      importanceScore: importance,
      confidenceScore: candidate.confidenceScore ?? existing.confidenceScore,
      emotionalWeight: candidate.emotionalWeight ?? existing.emotionalWeight,
      metadata: supersedeMetadata,
      sourceMessageIds: mergeSourceIds(
        existing.sourceMessageIds,
        candidate.sourceMessageIds ?? messageIds,
      ),
    },
    { skipEmbedding },
  );

  return existing.id;
}

async function applyCreate(
  userId: string,
  candidate: MemoryExtractionCandidate,
  messageIds: string[],
  embeddingProvider: EmbeddingProvider,
  skipEmbedding: boolean,
): Promise<string> {
  const memoryId = await createMemory(
    {
      userId,
      category: candidate.category,
      content: candidate.content,
      summary: candidate.summary ?? candidate.content.slice(0, 120),
      importanceScore: candidate.importanceScore ?? 5,
      confidenceScore: candidate.confidenceScore ?? 0.6,
      emotionalWeight: candidate.emotionalWeight ?? 0,
      sourceMessageIds: candidate.sourceMessageIds ?? messageIds,
      metadata: candidate.metadata ?? undefined,
    },
    skipEmbedding ? { skipEmbedding: true } : { provider: embeddingProvider },
  );

  return memoryId;
}

// Fetch a lightweight set of nearby memories to prime the LLM without overloading it.
async function fetchRelatedMemories(
  userId: string,
  messages: Message[],
  embeddingProvider: EmbeddingProvider,
  limit: number,
): Promise<Memory[]> {
  const seen = new Map<string, Memory>();
  const batchSize = 5;
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const combinedQuery = batch
      .map((message) => message.content)
      .join("\n---\n");
    const similarities = await searchSimilarMemories({
      userId,
      query: combinedQuery,
      provider: embeddingProvider,
      limit: Math.min(6, limit),
      minSimilarity: 0.55,
    });
    for (const match of similarities) {
      if (!seen.has(match.memory.id)) {
        seen.set(match.memory.id, match.memory);
      }
      if (seen.size >= limit) {
        return Array.from(seen.values());
      }
    }
  }
  return Array.from(seen.values());
}

export async function extractMemoriesForUser(
  userId: string,
  options: MemoryExtractionOptions = {},
): Promise<MemoryExtractionSummary> {
  const messageLimit = options.messageLimit ?? 20;
  const llmProvider: LLMProvider = options.llmProvider ?? "openai";
  const embeddingProvider = options.embeddingProvider ?? "ollama";
  const similarityThreshold = options.similarityThreshold ?? 0.85;
  const relatedMemoryLimit = options.relatedMemoryLimit ?? 12;
  const disableSimilarity = options.disableSimilarity ?? false;
  const skipEmbedding = options.skipEmbeddingGeneration ?? false;

  const messages = await getUnextractedMessages(userId, { limit: messageLimit });
  if (messages.length === 0) {
    return {
      created: [],
      updated: [],
      superseded: [],
      skipped: [],
      errors: [],
      messageIdsMarked: [],
      llmProvider,
      warnings: [],
    };
  }

  const relatedMemories = disableSimilarity
    ? []
    : await fetchRelatedMemories(
        userId,
        messages,
        embeddingProvider,
        relatedMemoryLimit,
      );

  const prompt = buildPrompt({ messages, relatedMemories });

  let llmResponse: MemoryExtractionLLMResponse;
  try {
    if (options.llmOverride) {
      llmResponse = await options.llmOverride({
        prompt,
        messages,
        relatedMemories,
      });
    } else {
      llmResponse =
        llmProvider === "openai" ? await callOpenAI(prompt) : await callOllama(prompt);
    }
  } catch (error) {
    throw new Error(`Failed to execute memory extraction with ${llmProvider}: ${String(error)}`);
  }

  const fallbackMessageIds = messages.map((msg) => msg.id);
  const messageIndex = new Map<string, Message>(messages.map((msg) => [msg.id, msg]));
  const memoryCache = new Map<string, Memory>();
  async function resolveMemory(memoryId: string | undefined): Promise<Memory | undefined> {
    if (!memoryId) return undefined;
    if (memoryCache.has(memoryId)) {
      return memoryCache.get(memoryId);
    }
    const fetched = await getMemory(memoryId, { trackAccess: false });
    if (fetched) {
      memoryCache.set(memoryId, fetched);
      return fetched;
    }
    return undefined;
  }
  const summary: MemoryExtractionSummary = {
    created: [],
    updated: [],
    superseded: [],
    skipped: [],
    errors: [],
    messageIdsMarked: [],
    llmProvider,
    rawModelOutput: llmResponse,
    warnings: [],
  };
  let shouldMarkMessages = true;

  for (const rawCandidate of llmResponse.memories ?? []) {
    const { candidate, reason } = validateCandidate(rawCandidate, fallbackMessageIds);
    if (!candidate) {
      summary.skipped.push({
        candidate: rawCandidate,
        reason: "invalid",
        details:
          reason === "missing_source_ids"
            ? "Candidate missing sourceMessageIds"
            : "Candidate missing required fields or invalid content",
      });
      if (reason === "missing_source_ids") {
        // Missing provenance usually means the LLM ignored the schema; flag it for monitoring.
        summary.warnings.push({
          message: "Candidate rejected due to missing sourceMessageIds",
          candidate: rawCandidate,
        });
      }
      shouldMarkMessages = false;
      continue;
    }

    try {
      const matches = disableSimilarity
        ? []
        : await searchSimilarMemories({
            userId,
            query: candidate.content,
            provider: embeddingProvider,
            limit: 3,
            minSimilarity: 0.0,
          });

      let bestMatch = matches[0]?.memory;
      let bestSimilarity = matches[0]?.similarity;

      const explicitTarget = candidate.relatedMemoryId
        ? await resolveMemory(candidate.relatedMemoryId)
        : undefined;

      const decision = determineAction(candidate, {
        similarityMatch: bestMatch,
        similarity: bestSimilarity,
        explicitTarget,
        threshold: similarityThreshold,
      });

      if (decision.action === "skip_duplicate") {
        summary.skipped.push({
          candidate,
          reason: "duplicate",
          existingMemoryId: decision.target?.id,
          details: decision.reason,
        });
        continue;
      }

      if (decision.action === "update" && decision.target) {
        const updatedId = await applyUpdate(
          decision.target,
          candidate,
          fallbackMessageIds,
          skipEmbedding,
        );
        summary.updated.push(updatedId);
        continue;
      }

      if (decision.action === "supersede" && decision.target) {
        const guard = evaluateContradictionGuard(
          decision.target,
          candidate,
          messageIndex,
          fallbackMessageIds,
        );
        if (!guard.pass) {
          summary.skipped.push({
            candidate,
            reason: "invalid",
            existingMemoryId: decision.target.id,
            details: guard.reason,
          });
          // Keep a breadcrumb for operators when guards block a supersede.
          summary.warnings.push({
            message: guard.reason ?? "Contradiction guard failed",
            candidate,
            relatedMemoryId: decision.target.id,
          });
          shouldMarkMessages = false;
          continue;
        }
        const supersededId = await applySupersede(
          decision.target,
          candidate,
          fallbackMessageIds,
          skipEmbedding,
        );
        summary.superseded.push(supersededId);
        continue;
      }

      const createdId = await applyCreate(
        userId,
        candidate,
        fallbackMessageIds,
        embeddingProvider,
        skipEmbedding,
      );
      summary.created.push(createdId);
    } catch (error) {
      summary.errors.push({
        candidate,
        message: String(error),
      });
      shouldMarkMessages = false;
    }
  }

  const messageIds = messages.map((msg) => msg.id);
  if (shouldMarkMessages && messageIds.length > 0) {
    await markMessagesAsExtracted(messageIds);
    summary.messageIdsMarked = messageIds;
  }

  // Optionally refresh updated memory metadata for callers wanting resolved data.
  // We keep current behavior simple by resolving IDs only.

  return summary;
}

export type { Memory } from "../db/memory";
