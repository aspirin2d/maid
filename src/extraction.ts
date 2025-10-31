import { z, type ZodType } from "zod";

import db from "./db/index";
import {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OPENAI_MODEL,
  OLLAMA_KEEP_ALIVE,
  embedTexts,
  getOllama,
  getOpenAI,
  type Provider,
} from "./llm";
import {
  createMemory,
  searchSimilarMemories,
  updateMemory,
  type Memory,
} from "./memory";
import { listMessages, markMessagesExtracted, type Message } from "./message";
import {
  FactRetrievalSchema,
  MemoryUpdateSchema,
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  parseMessages,
  removeCodeBlocks,
} from "./prompt/extraction";

export type ExtractedFact = {
  factId: string;
  statement: string;
  confidence: number;
  importance: number;
  category:
    | "PERSONAL_INFO"
    | "PREFERENCE"
    | "GOAL"
    | "ROUTINE"
    | "RELATIONSHIP"
    | "HEALTH"
    | "EVENT"
    | "WORK"
    | "OTHER";
  sourceMessageIds: number[];
};

export type MemoryReference = {
  label: string;
  memoryId: number;
  distance: number;
  content: string | null;
  action: Memory["action"] | null;
  deleted: boolean;
  raw: Memory;
};

export type FactMatchContext = {
  fact: ExtractedFact;
  similarMemoryLabels: string[];
};

export type MemoryDecision = z.infer<
  typeof MemoryUpdateSchema
>["decisions"][number];

export type MemoryDecisionAction = MemoryDecision["action"];

export interface AppliedMemoryChange {
  decision: MemoryDecision;
  createdMemoryIds: number[];
  updatedMemoryIds: number[];
}

export interface MemoryExtractionOptions {
  userId: number;
  messageLimit?: number;
  similarityLimit?: number;
  embeddingProvider?: Provider;
  llmProvider?: Provider;
  llmModel?: string;
  minConfidence?: number;
  memoryProvider?: Provider;
}

export interface MemoryExtractionResult {
  userId: number;
  messages: Message[];
  facts: ExtractedFact[];
  factContexts: FactMatchContext[];
  memoryReferences: MemoryReference[];
  labelToMemoryId: Record<string, number>;
  decisions: MemoryDecision[];
  appliedChanges: AppliedMemoryChange[];
  createdMemoryIds: number[];
  updatedMemoryIds: number[];
  markedMessageIds: number[];
  markedMessageCount: number;
}

const DEFAULT_SIMILARITY_LIMIT = 3;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function formatMessagesForConversation(messages: Message[]): string[] {
  return messages.map((message, index) => {
    const createdAt = message.createdAt
      ? new Date(message.createdAt).toISOString()
      : "unknown";
    const cleanedContent = removeCodeBlocks(message.content).trim();
    return `#${index + 1} [${message.role.toUpperCase()}|id:${message.id}|${createdAt}]\n${cleanedContent}`;
  });
}

function buildFactRetrievalMessages(messages: Message[]): ChatMessage[] {
  const conversationLines = formatMessagesForConversation(messages);
  const parsedConversation = parseMessages(conversationLines);
  const [systemPrompt, userPrompt] =
    getFactRetrievalMessages(parsedConversation);
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function buildMemoryUpdateMessages(
  memoryReferences: MemoryReference[],
  facts: ExtractedFact[],
): ChatMessage[] {
  const snapshot = memoryReferences
    .filter((ref) => (ref.content ?? "").trim().length > 0)
    .map((ref) => ({ id: ref.label, text: ref.content ?? "" }));
  const factSummaries = facts
    .map((fact) => ({ id: fact.factId, text: fact.statement }))
    .filter((fact) => fact.text.trim().length > 0);
  const prompt = getUpdateMemoryMessages(snapshot, factSummaries);
  return [{ role: "user", content: prompt }];
}

async function callStructuredJson<Schema extends ZodType>(args: {
  messages: ChatMessage[];
  schemaName: string;
  schema: Schema;
  model?: string;
  provider?: Provider;
}): Promise<z.infer<Schema>> {
  if (!args.messages.length) {
    throw new Error("Structured call requires at least one message");
  }

  const provider = args.provider ?? "ollama";
  const jsonSchema = z.toJSONSchema(args.schema);

  if (provider === "openai") {
    const client = getOpenAI();
    const response = await client.responses.parse({
      model: args.model ?? DEFAULT_OPENAI_MODEL,
      input: args.messages,
      text: {
        format: {
          type: "json_schema",
          name: args.schemaName,
          schema: jsonSchema,
        },
      },
    });

    if (!response.output_parsed) {
      throw new Error("Failed to parse structured response from model");
    }

    return args.schema.parse(response.output_parsed);
  }

  const client = getOllama();
  const response = await client.chat({
    model: args.model ?? DEFAULT_OLLAMA_MODEL,
    messages: args.messages,
    format: jsonSchema,
    keep_alive: OLLAMA_KEEP_ALIVE,
  });

  const content = response.message?.content?.trim();
  if (!content) {
    throw new Error("Failed to receive structured content from Ollama");
  }

  const parsed = JSON.parse(content);
  return args.schema.parse(parsed);
}

async function extractFactsFromConversation(args: {
  messages: Message[];
  model?: string;
  minConfidence?: number;
  provider?: Provider;
}): Promise<ExtractedFact[]> {
  if (args.messages.length === 0) {
    return [];
  }

  const promptMessages = buildFactRetrievalMessages(args.messages);
  const structured = await callStructuredJson({
    messages: promptMessages,
    schemaName: "conversation_fact_retrieval",
    schema: FactRetrievalSchema,
    model: args.model,
    provider: args.provider,
  });

  const uniqueSourceIds = Array.from(
    new Set(args.messages.map((message) => message.id)),
  );

  return structured.facts.map((fact, index) => ({
    factId: `F${index + 1}`,
    statement: fact.text,
    confidence: fact.confidence,
    importance: fact.importance,
    category: fact.category,
    sourceMessageIds: uniqueSourceIds,
  }));
}

async function fetchPendingMessages(
  userId: number,
  limit?: number,
): Promise<Message[]> {
  return listMessages({
    userId,
    extracted: false,
    roles: ["user", "assistant"],
    orderBy: "createdAt",
    orderDir: "asc",
    limit,
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    magnitudeA += a[i]! * a[i]!;
    magnitudeB += b[i]! * b[i]!;
  }
  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

async function deduplicateFacts(
  facts: ExtractedFact[],
  embeddings: number[][],
  similarityThreshold = 0.95,
): Promise<{
  deduplicatedFacts: ExtractedFact[];
  deduplicatedEmbeddings: number[][];
}> {
  if (facts.length === 0) {
    return { deduplicatedFacts: [], deduplicatedEmbeddings: [] };
  }

  const kept: boolean[] = facts.map(() => true);
  const merged: Map<number, number[]> = new Map(); // index -> list of merged indices

  // Find similar facts
  for (let i = 0; i < facts.length; i++) {
    if (!kept[i]) continue;
    for (let j = i + 1; j < facts.length; j++) {
      if (!kept[j]) continue;
      const similarity = cosineSimilarity(embeddings[i]!, embeddings[j]!);
      if (similarity >= similarityThreshold) {
        // Merge j into i
        if (!merged.has(i)) {
          merged.set(i, [i]);
        }
        merged.get(i)!.push(j);
        kept[j] = false;
      }
    }
  }

  // Build deduplicated list
  const deduplicatedFacts: ExtractedFact[] = [];
  const deduplicatedEmbeddings: number[][] = [];

  for (let i = 0; i < facts.length; i++) {
    if (!kept[i]) continue;

    const fact = facts[i]!;
    const mergedIndices = merged.get(i) || [i];

    if (mergedIndices.length === 1) {
      // No merge, keep as-is
      deduplicatedFacts.push(fact);
      deduplicatedEmbeddings.push(embeddings[i]!);
    } else {
      // Merge: take highest importance and confidence
      const mergedFacts = mergedIndices.map((idx) => facts[idx]!);
      const maxImportance = Math.max(
        ...mergedFacts.map((f) => f.importance || 0.5),
      );
      const maxConfidence = Math.max(
        ...mergedFacts.map((f) => f.confidence || 0.5),
      );
      const allSourceIds = Array.from(
        new Set(mergedFacts.flatMap((f) => f.sourceMessageIds)),
      );

      deduplicatedFacts.push({
        ...fact,
        importance: maxImportance,
        confidence: maxConfidence,
        sourceMessageIds: allSourceIds,
      });
      deduplicatedEmbeddings.push(embeddings[i]!);
    }
  }

  return { deduplicatedFacts, deduplicatedEmbeddings };
}

async function buildSimilarityContext(args: {
  userId: number;
  facts: ExtractedFact[];
  embeddings: number[][];
  similarityLimit: number;
  embeddingProvider: Provider;
}): Promise<{
  factContexts: FactMatchContext[];
  memoryReferences: MemoryReference[];
  labelToMemoryId: Record<string, number>;
}> {
  const memoryIdToLabel = new Map<number, string>();
  const memoryReferences: MemoryReference[] = [];
  const factContexts: FactMatchContext[] = [];

  if (args.facts.length === 0) {
    return {
      factContexts: [],
      memoryReferences: [],
      labelToMemoryId: {},
    };
  }

  // Assign simple F# IDs to facts
  const factsWithIds = args.facts.map((fact, index) => ({
    ...fact,
    factId: `F${index + 1}`,
  }));

  // Process each fact with its pre-computed embedding
  for (let i = 0; i < factsWithIds.length; i++) {
    const fact = factsWithIds[i]!;
    const embedding = args.embeddings[i]!;

    const similarMemories = await searchSimilarMemories(fact.statement, {
      userId: args.userId,
      provider: args.embeddingProvider,
      limit: args.similarityLimit,
      includeDeleted: false,
      embedding, // Pass pre-computed embedding to avoid regeneration
    });

    const labelsForFact: string[] = [];

    for (const match of similarMemories) {
      const existingLabel = memoryIdToLabel.get(match.id);
      if (existingLabel) {
        labelsForFact.push(existingLabel);
        continue;
      }

      const label = `M${memoryReferences.length + 1}`;
      memoryIdToLabel.set(match.id, label);
      memoryReferences.push({
        label,
        memoryId: match.id,
        distance: match.distance,
        content: match.content ?? null,
        action: match.action ?? null,
        deleted: Boolean(match.deleted),
        raw: match,
      });
      labelsForFact.push(label);
    }

    factContexts.push({
      fact,
      similarMemoryLabels: labelsForFact,
    });
  }

  const labelToMemoryId = Object.fromEntries(
    memoryReferences.map((ref) => [ref.label, ref.memoryId]),
  );

  return { factContexts, memoryReferences, labelToMemoryId };
}

async function decideMemoryActions(args: {
  facts: ExtractedFact[];
  memoryReferences: MemoryReference[];
  model?: string;
  provider?: Provider;
}): Promise<MemoryDecision[]> {
  if (args.facts.length === 0) {
    return [];
  }

  const messages = buildMemoryUpdateMessages(args.memoryReferences, args.facts);

  const structured = await callStructuredJson({
    messages,
    schemaName: "memory_decision_planning",
    schema: MemoryUpdateSchema,
    model: args.model,
    provider: args.provider,
  });

  return structured.decisions;
}

async function applyMemoryDecisions(args: {
  userId: number;
  decisions: MemoryDecision[];
  memoryReferences: MemoryReference[];
  provider: Provider;
  facts: ExtractedFact[];
}): Promise<{
  changes: AppliedMemoryChange[];
  createdMemoryIds: number[];
  updatedMemoryIds: number[];
}> {
  const memoryByLabel = new Map(
    args.memoryReferences.map((ref) => [ref.label, ref]),
  );
  const factByLabel = new Map(args.facts.map((fact) => [fact.factId, fact]));

  // Wrap all memory operations in a transaction for atomicity
  return await db.transaction(async () => {
    const changes: AppliedMemoryChange[] = [];
    const createdMemoryIds: number[] = [];
    const updatedMemoryIds: number[] = [];

    for (const decision of args.decisions) {
      const change: AppliedMemoryChange = {
        decision,
        createdMemoryIds: [],
        updatedMemoryIds: [],
      };

      const fact = factByLabel.get(decision.fact_id);
      if (!fact) {
        throw new Error(
          `Decision references unknown fact ${decision.fact_id}`,
        );
      }

      switch (decision.action) {
        case "ADD": {
          const content = fact.statement.trim();
          if (!content) {
            throw new Error(
              `ADD decision for fact ${decision.fact_id} has empty statement`,
            );
          }

          // Always use the fact's metadata (evaluated during extraction)
          const memoryId = await createMemory(
            {
              userId: args.userId,
              content,
              category: fact.category,
              importance: fact.importance,
              confidence: fact.confidence,
              action: "ADD",
            },
            args.provider,
          );

          change.createdMemoryIds.push(memoryId);
          createdMemoryIds.push(memoryId);
          break;
        }

        case "UPDATE": {
          if (!decision.memory_id) {
            throw new Error(
              `UPDATE decision for fact ${decision.fact_id} is missing memory_id`,
            );
          }

          const ref = memoryByLabel.get(decision.memory_id);
          if (!ref) {
            throw new Error(
              `UPDATE decision references unknown memory ${decision.memory_id}`,
            );
          }

          const newContent = (decision.combined_text ?? "").trim();
          if (!newContent) {
            throw new Error(
              `UPDATE decision for fact ${decision.fact_id} is missing combined_text`,
            );
          }

          const previousContent = ref.content ?? ref.raw.content ?? null;

          // Always use the fact's metadata (simplifies logic)
          const success = await updateMemory(
            ref.memoryId,
            {
              content: newContent,
              prevContent: previousContent ?? undefined,
              category: fact.category,
              importance: fact.importance,
              confidence: fact.confidence,
              action: "UPDATE",
              deleted: 0,
            },
            args.provider,
          );

          if (!success) {
            throw new Error(`Failed to update memory ${ref.memoryId}`);
          }

          // Update reference for consistency
          ref.raw.prevContent = previousContent;
          ref.raw.content = newContent;
          ref.raw.category = fact.category;
          ref.raw.importance = fact.importance;
          ref.raw.confidence = fact.confidence;
          ref.raw.deleted = 0;
          ref.raw.action = "UPDATE";
          ref.raw.updatedAt = new Date();
          ref.content = newContent;
          ref.deleted = false;
          ref.action = "UPDATE";

          change.updatedMemoryIds.push(ref.memoryId);
          updatedMemoryIds.push(ref.memoryId);
          break;
        }

        case "SKIP": {
          // No action needed - fact is redundant
          break;
        }

        default: {
          throw new Error(
            `Unsupported decision action: ${(decision as any).action}`,
          );
        }
      }

      changes.push(change);
    }

    return { changes, createdMemoryIds, updatedMemoryIds };
  });
}

export async function runMemoryExtraction(
  options: MemoryExtractionOptions,
): Promise<MemoryExtractionResult> {
  const embeddingProvider = options.embeddingProvider ?? "ollama";
  const memoryProvider = options.memoryProvider ?? embeddingProvider;
  const llmProvider = options.llmProvider ?? "ollama";
  const similarityLimit = options.similarityLimit ?? DEFAULT_SIMILARITY_LIMIT;

  let messages: Message[] = [];
  let facts: ExtractedFact[] = [];
  let factContexts: FactMatchContext[] = [];
  let memoryReferences: MemoryReference[] = [];
  let labelToMemoryId: Record<string, number> = {};
  let decisions: MemoryDecision[] = [];
  let appliedChanges: AppliedMemoryChange[] = [];
  let createdMemoryIds: number[] = [];
  let updatedMemoryIds: number[] = [];

  try {
    // Step 1: Fetch pending messages
    messages = await fetchPendingMessages(options.userId, options.messageLimit);

    if (messages.length === 0) {
      return {
        userId: options.userId,
        messages: [],
        facts: [],
        factContexts: [],
        memoryReferences: [],
        labelToMemoryId: {},
        decisions: [],
        appliedChanges: [],
        createdMemoryIds: [],
        updatedMemoryIds: [],
        markedMessageIds: [],
        markedMessageCount: 0,
      };
    }

    // Step 2: Extract facts from conversation
    facts = await extractFactsFromConversation({
      messages,
      model: options.llmModel,
      minConfidence: options.minConfidence,
      provider: llmProvider,
    });

    if (facts.length === 0) {
      // No facts extracted, mark messages as processed
      const markedMessageIds = messages.map((message) => message.id);
      const markedMessageCount = await markMessagesExtracted(
        markedMessageIds,
        true,
      );

      return {
        userId: options.userId,
        messages,
        facts: [],
        factContexts: [],
        memoryReferences: [],
        labelToMemoryId: {},
        decisions: [],
        appliedChanges: [],
        createdMemoryIds: [],
        updatedMemoryIds: [],
        markedMessageIds,
        markedMessageCount,
      };
    }

    // Step 3: Batch embed all facts for deduplication
    const factStatements = facts.map((fact) => fact.statement);
    const embeddings = await embedTexts(embeddingProvider, factStatements);

    // Step 4: Deduplicate facts
    const { deduplicatedFacts, deduplicatedEmbeddings } =
      await deduplicateFacts(facts, embeddings);

    // Step 5: Build similarity context with deduplicated facts
    ({ factContexts, memoryReferences, labelToMemoryId } =
      await buildSimilarityContext({
        userId: options.userId,
        facts: deduplicatedFacts,
        embeddings: deduplicatedEmbeddings,
        similarityLimit,
        embeddingProvider,
      }));

    // Update facts reference to use facts with F# IDs from factContexts
    facts = factContexts.map((ctx) => ctx.fact);

    // Step 6: Decide memory actions for ALL facts (unified decision logic)
    decisions = await decideMemoryActions({
      facts,
      memoryReferences,
      model: options.llmModel,
      provider: llmProvider,
    });

    // Step 7: Apply memory decisions (within transaction)
    ({
      changes: appliedChanges,
      createdMemoryIds,
      updatedMemoryIds,
    } = await applyMemoryDecisions({
      userId: options.userId,
      decisions,
      memoryReferences,
      facts,
      provider: memoryProvider,
    }));

    // Step 8: Mark messages as extracted (only after successful processing)
    const markedMessageIds = messages.map((message) => message.id);
    const markedMessageCount = markedMessageIds.length
      ? await markMessagesExtracted(markedMessageIds, true)
      : 0;

    return {
      userId: options.userId,
      messages,
      facts,
      factContexts,
      memoryReferences,
      labelToMemoryId,
      decisions,
      appliedChanges,
      createdMemoryIds,
      updatedMemoryIds,
      markedMessageIds,
      markedMessageCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(
      `[Memory Extraction] Failed for user ${options.userId}:`,
      errorMessage,
    );
    if (errorStack) {
      console.error(`[Memory Extraction] Stack trace:`, errorStack);
    }

    // Log context for debugging
    console.error(`[Memory Extraction] Context:`, {
      messagesFound: messages.length,
      factsExtracted: facts.length,
      memoriesReferenced: memoryReferences.length,
      decisionsGenerated: decisions.length,
      changesApplied: appliedChanges.length,
    });

    // Re-throw with enhanced error message
    throw new Error(
      `Memory extraction failed for user ${options.userId}: ${errorMessage}`,
      { cause: error },
    );
  }
}
