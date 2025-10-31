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
  createMemoriesWithEmbeddings,
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

export type MemoryMatch = {
  label: string;
  memoryId: number;
  distance: number;
  content: string | null;
  action: Memory["action"] | null;
  deleted: boolean;
  raw: Memory;
};

export type FactMatch = {
  fact: ExtractedFact;
  similarMemoryLabels: string[];
};

export type MemoryDecision = z.infer<
  typeof MemoryUpdateSchema
>["memory"][number];

export type MemoryDecisionAction = MemoryDecision["event"];

interface MemoryChangeRecord {
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
  decisions: MemoryDecision[];
  createdMemoryIds: number[];
  updatedMemoryIds: number[];
  markedMessageIds: number[];
}

const DEFAULT_SIMILARITY_LIMIT = 3;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function formatConversationLog(messages: Message[]): string[] {
  return messages.map((message, index) => {
    const createdAt = message.createdAt
      ? new Date(message.createdAt).toISOString()
      : "unknown";
    const cleanedContent = removeCodeBlocks(message.content).trim();
    return `#${index + 1} [${message.role.toUpperCase()}|id:${message.id}|${createdAt}]\n${cleanedContent}`;
  });
}

function createFactRetrievalMessages(messages: Message[]): ChatMessage[] {
  const conversationLines = formatConversationLog(messages);
  const parsedConversation = parseMessages(conversationLines);
  const [systemPrompt, userPrompt] =
    getFactRetrievalMessages(parsedConversation);
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}

function createMemoryUpdateMessages(
  memoryMatches: MemoryMatch[],
  facts: ExtractedFact[],
): ChatMessage[] {
  const snapshot = memoryMatches
    .filter((match) => (match.content ?? "").trim().length > 0)
    .map((match) => ({ id: match.label, text: match.content ?? "" }));
  const factSummaries = facts
    .map((fact) => ({ id: fact.factId, text: fact.statement }))
    .filter((fact) => fact.text.trim().length > 0);
  const prompt = getUpdateMemoryMessages(snapshot, factSummaries);
  return [{ role: "user", content: prompt }];
}

async function invokeStructuredModel<Schema extends ZodType>(args: {
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

  const promptMessages = createFactRetrievalMessages(args.messages);
  const structured = await invokeStructuredModel({
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

async function prepareMemoryMatches(args: {
  userId: number;
  facts: ExtractedFact[];
  similarityLimit: number;
  embeddingProvider: Provider;
}): Promise<{
  factMatches: FactMatch[];
  memoryMatches: MemoryMatch[];
  factVectors: Record<string, number[]>;
}> {
  // Optimization: Batch generate embeddings for all facts at once
  if (args.facts.length === 0) {
    return {
      factMatches: [],
      memoryMatches: [],
      factVectors: {},
    };
  }

  const factStatements = args.facts.map((fact) => fact.statement);
  const embeddings = await embedTexts(args.embeddingProvider, factStatements);

  // Simplified: Use unified numeric IDs from the start
  // Memories: 1, 2, 3, ...
  // Facts: memoryCount+1, memoryCount+2, ...
  const memoryIdToLabel = new Map<number, string>();
  const memoryMatches: MemoryMatch[] = [];
  const tempFactMatches: Array<{
    fact: ExtractedFact;
    similarMemoryLabels: string[];
  }> = [];

  // First pass: Collect all unique memories and their relationships to facts
  const similarityResults = await Promise.all(
    args.facts.map((fact, index) =>
      searchSimilarMemories(fact.statement, {
        userId: args.userId,
        provider: args.embeddingProvider,
        limit: args.similarityLimit,
        includeDeleted: false,
        embedding: embeddings[index]!,
      }),
    ),
  );

  for (let i = 0; i < args.facts.length; i++) {
    const fact = args.facts[i]!;
    const similarMemories = similarityResults[i]!;

    const labelsForFact: string[] = [];

    for (const match of similarMemories) {
      const existingLabel = memoryIdToLabel.get(match.id);
      if (existingLabel) {
        labelsForFact.push(existingLabel);
        continue;
      }

      // Assign numeric labels starting from 1
      const label = (memoryMatches.length + 1).toString();
      memoryIdToLabel.set(match.id, label);
      memoryMatches.push({
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

    tempFactMatches.push({
      fact,
      similarMemoryLabels: labelsForFact,
    });
  }

  // Second pass: Assign fact IDs after all memories are collected
  const memoryCount = memoryMatches.length;
  const factVectorMap = new Map<string, number[]>();
  const factMatches = tempFactMatches.map((entry, index) => {
    const factId = (memoryCount + index + 1).toString();
    factVectorMap.set(factId, embeddings[index]!);
    return {
      fact: { ...entry.fact, factId },
      similarMemoryLabels: entry.similarMemoryLabels,
    };
  });

  return {
    factMatches,
    memoryMatches,
    factVectors: Object.fromEntries(factVectorMap),
  };
}

async function decideMemoryActions(args: {
  facts: ExtractedFact[];
  memoryMatches: MemoryMatch[];
  model?: string;
  provider?: Provider;
}): Promise<MemoryDecision[]> {
  if (args.facts.length === 0 && args.memoryMatches.length === 0) {
    return [];
  }

  const messages = createMemoryUpdateMessages(args.memoryMatches, args.facts);

  const structured = await invokeStructuredModel({
    messages,
    schemaName: "memory_update_planning",
    schema: MemoryUpdateSchema,
    model: args.model,
    provider: args.provider,
  });

  // No mapping needed - unified IDs are used throughout
  return structured.memory;
}

async function applyMemoryDecisions(args: {
  userId: number;
  decisions: MemoryDecision[];
  memoryMatches: MemoryMatch[];
  provider: Provider;
  facts: ExtractedFact[];
  factMatches?: FactMatch[];
  messageIds: number[];
  factVectors?: Record<string, number[]>;
}): Promise<{
  changes: MemoryChangeRecord[];
  createdMemoryIds: number[];
  updatedMemoryIds: number[];
  markedMessageCount: number;
}> {
  const memoryByLabel = new Map(
    args.memoryMatches.map((match) => [match.label, match]),
  );
  const factByLabel = new Map(args.facts.map((fact) => [fact.factId, fact]));

  // Wrap all memory operations in a transaction for atomicity
  return await db.transaction(async (tx) => {
    const changes: MemoryChangeRecord[] = [];
    const createdMemoryIds: number[] = [];
    const updatedMemoryIds: number[] = [];

    // Batch optimization: Collect all ADD decisions first
    const addDecisions: Array<{
      decision: MemoryDecision;
      content: string;
      category: ExtractedFact["category"];
      importance: number;
      confidence: number;
      embedding?: number[];
    }> = [];

    const updateDecisions: Array<{
      decision: MemoryDecision;
      match: MemoryMatch;
      newContent: string;
      previousContent: string | null;
      updateFields: any;
    }> = [];

    // First pass: Validate and prepare all decisions
    for (const decision of args.decisions) {
      switch (decision.event) {
        case "ADD": {
          const referencedFact = decision.id
            ? factByLabel.get(decision.id)
            : undefined;

          if (!referencedFact) {
            throw new Error(
              `ADD decision with ID ${decision.id} does not reference a known fact`,
            );
          }

          const content = referencedFact.statement?.trim();
          if (!content) {
            throw new Error(
              `ADD decision with ID ${decision.id} has empty content (fact: "${referencedFact.statement}")`,
            );
          }

          // Always use the fact's metadata (never re-evaluate in decision phase)
          const category = referencedFact?.category ?? "OTHER";
          const importance = referencedFact?.importance ?? 0.5;
          const confidence = referencedFact?.confidence ?? 0.5;

          addDecisions.push({
            decision,
            content,
            category,
            importance,
            confidence,
            embedding: args.factVectors?.[referencedFact.factId],
          });

          break;
        }

        case "UPDATE": {
          const match = memoryByLabel.get(decision.id);
          if (!match) {
            throw new Error(
              `UPDATE decision with ID ${decision.id} does not reference a known memory`,
            );
          }

          const newContent = decision.text?.trim();
          if (!newContent) {
            throw new Error(
              `UPDATE decision with ID ${decision.id} has empty content (text: "${decision.text}")`,
            );
          }

          const previousContent = match.content ?? match.raw.content ?? null;

          // Prepare update fields
          const updateFields: any = {
            content: newContent,
            prevContent: previousContent ?? undefined,
            action: "UPDATE",
            deleted: 0,
          };

          // Metadata update policy: Use the most important triggering fact's metadata
          // A memory UPDATE is triggered when new facts are similar to it
          const triggeringFacts =
            args.factMatches
              ?.filter((ctx) => ctx.similarMemoryLabels.includes(decision.id))
              .map((ctx) => ctx.fact) ?? [];

          if (triggeringFacts.length > 0) {
            // Use the fact with highest importance score
            const primaryFact = triggeringFacts.reduce((prev, current) =>
              current.importance > prev.importance ? current : prev,
            );

            updateFields.category = primaryFact.category;
            updateFields.importance = primaryFact.importance;
            updateFields.confidence = primaryFact.confidence;
          }
          // If no triggering facts found, keep existing memory metadata

          updateDecisions.push({
            decision,
            match,
            newContent,
            previousContent,
            updateFields,
          });

          break;
        }

        default: {
          throw new Error(
            `Unsupported memory decision event: ${decision.event}`,
          );
        }
      }
    }

    // Second pass: Batch create memories with pre-computed embeddings
    if (addDecisions.length > 0) {
      // Ensure embeddings exist for all new memories
      const missingEmbeddingIndices: number[] = [];
      addDecisions.forEach((add, index) => {
        if (!add.embedding || add.embedding.length === 0) {
          missingEmbeddingIndices.push(index);
        }
      });

      if (missingEmbeddingIndices.length > 0) {
        const contentsToEmbed = missingEmbeddingIndices.map(
          (index) => addDecisions[index]!.content,
        );
        const generatedEmbeddings = await embedTexts(
          args.provider,
          contentsToEmbed,
        );
        missingEmbeddingIndices.forEach((index, generatedIndex) => {
          addDecisions[index]!.embedding = generatedEmbeddings[generatedIndex];
        });
      }

      const embeddings = addDecisions.map((add) => {
        if (!add.embedding || add.embedding.length === 0) {
          throw new Error(
            `Missing embedding for ADD decision ${add.decision.id ?? "unknown"}`,
          );
        }
        return add.embedding;
      });

      // Create memories with embeddings in batch
      const inputs = addDecisions.map((add) => ({
        userId: args.userId,
        content: add.content,
        category: add.category,
        importance: add.importance,
        confidence: add.confidence,
        action: "ADD" as const,
      }));

      const insertedIds = await createMemoriesWithEmbeddings(
        inputs,
        embeddings,
        tx,
      );

      // Track changes
      insertedIds.forEach((memoryId, index) => {
        const add = addDecisions[index]!;
        const change: MemoryChangeRecord = {
          decision: add.decision,
          createdMemoryIds: [memoryId],
          updatedMemoryIds: [],
        };
        changes.push(change);
        createdMemoryIds.push(memoryId);
      });
    }

    // Third pass: Apply all UPDATE decisions
    for (const update of updateDecisions) {
      const success = await updateMemory(
        update.match.memoryId,
        update.updateFields,
        args.provider,
        tx,
      );
      if (!success) {
        throw new Error(`Failed to update memory ${update.match.memoryId}`);
      }

      update.match.raw.prevContent = update.previousContent;
      update.match.raw.content = update.newContent;
      update.match.raw.deleted = 0;
      update.match.raw.action = "UPDATE";
      update.match.raw.updatedAt = new Date();
      update.match.content = update.newContent;
      update.match.deleted = false;
      update.match.action = "UPDATE";

      const change: MemoryChangeRecord = {
        decision: update.decision,
        createdMemoryIds: [],
        updatedMemoryIds: [update.match.memoryId],
      };
      changes.push(change);
      updatedMemoryIds.push(update.match.memoryId);
    }

    // Mark messages as extracted within the same transaction
    const markedMessageCount = args.messageIds.length
      ? await markMessagesExtracted(args.messageIds, true, tx)
      : 0;

    return { changes, createdMemoryIds, updatedMemoryIds, markedMessageCount };
  });
}

export async function runMemoryExtraction(
  options: MemoryExtractionOptions,
): Promise<MemoryExtractionResult> {
  const embeddingProvider = options.embeddingProvider ?? "ollama";
  const memoryProvider = options.memoryProvider ?? embeddingProvider;
  const llmProvider = options.llmProvider ?? "ollama";
  const similarityLimit = options.similarityLimit ?? DEFAULT_SIMILARITY_LIMIT;
  const timingEnabled = process.env.NODE_ENV === "development";
  const phaseTimings: Array<{ phase: string; durationMs: number }> = [];

  const timePhase = async <T>(
    phase: string,
    fn: () => Promise<T> | T,
  ): Promise<T> => {
    if (!timingEnabled) {
      return await fn();
    }

    const start = Date.now();
    try {
      return await fn();
    } finally {
      const durationMs = Date.now() - start;
      phaseTimings.push({ phase, durationMs });
    }
  };

  const flushTimings = () => {
    if (!timingEnabled || phaseTimings.length === 0) {
      return;
    }

    const timingSummary = phaseTimings
      .map(({ phase, durationMs }) => `${phase}=${durationMs.toFixed(2)}ms`)
      .join(", ");

    console.log(
      `[Memory Extraction][timing][user:${options.userId}] ${timingSummary}`,
    );
  };

  let messages: Message[] = [];
  let facts: ExtractedFact[] = [];
  let factMatches: FactMatch[] = [];
  let memoryMatches: MemoryMatch[] = [];
  let factVectors: Record<string, number[]> = {};
  let decisions: MemoryDecision[] = [];
  let appliedChanges: MemoryChangeRecord[] = [];
  let createdMemoryIds: number[] = [];
  let updatedMemoryIds: number[] = [];

  try {
    // Step 1: Fetch pending messages
    messages = await timePhase("fetchMessages", () =>
      fetchPendingMessages(options.userId, options.messageLimit),
    );

    if (messages.length === 0) {
      const result: MemoryExtractionResult = {
        userId: options.userId,
        messages: [],
        facts: [],
        decisions: [],
        createdMemoryIds: [],
        updatedMemoryIds: [],
        markedMessageIds: [],
      };

      flushTimings();
      return result;
    }

    // Step 2: Extract facts from conversation
    facts = await timePhase("extractFacts", () =>
      extractFactsFromConversation({
        messages,
        model: options.llmModel,
        minConfidence: options.minConfidence,
        provider: llmProvider,
      }),
    );

    // Step 3: Prepare similarity context (with unified IDs: 1, 2, 3...)
    await timePhase("prepareMemoryMatches", async () => {
      ({ factMatches, memoryMatches, factVectors } =
        await prepareMemoryMatches({
          userId: options.userId,
          facts,
          similarityLimit,
          embeddingProvider,
        }));

      // Update facts reference to use the unified facts from factMatches
      facts = factMatches.map((match) => match.fact);
    });

    // Step 4: Decide memory actions
    // Separate facts with and without similar memories
    await timePhase("decideMemoryActions", async () => {
      const factsWithSimilarMemories: ExtractedFact[] = [];
      const factsWithoutSimilarMemories: ExtractedFact[] = [];

      for (const match of factMatches) {
        if (match.similarMemoryLabels.length === 0) {
          factsWithoutSimilarMemories.push(match.fact);
        } else {
          factsWithSimilarMemories.push(match.fact);
        }
      }

      // Create ADD decisions for facts without similar memories
      const directAddDecisions: MemoryDecision[] =
        factsWithoutSimilarMemories.map((fact) => ({
          event: "ADD" as const,
          id: fact.factId,
          text: fact.statement,
          category: fact.category,
          importance: fact.importance,
          confidence: fact.confidence,
        }));

      // Only call LLM for facts that have similar memories
      let llmDecisions: MemoryDecision[] = [];
      if (factsWithSimilarMemories.length > 0) {
        llmDecisions = await decideMemoryActions({
          facts: factsWithSimilarMemories,
          memoryMatches,
          model: options.llmModel,
          provider: llmProvider,
        });
      }

      // Combine direct ADD decisions with LLM decisions
      decisions = [...directAddDecisions, ...llmDecisions];
    });

    // Step 5: Apply memory decisions and mark messages (within transaction)
    const markedMessageIds = messages.map((message) => message.id);

    await timePhase("applyMemoryDecisions", async () => {
      ({
        changes: appliedChanges,
        createdMemoryIds,
        updatedMemoryIds,
      } = await applyMemoryDecisions({
        userId: options.userId,
        decisions,
        memoryMatches,
        facts,
        factMatches,
        provider: memoryProvider,
        messageIds: markedMessageIds,
        factVectors,
      }));
    });

    const result: MemoryExtractionResult = {
      userId: options.userId,
      messages,
      facts,
      decisions,
      createdMemoryIds,
      updatedMemoryIds,
      markedMessageIds,
    };

    flushTimings();
    return result;
  } catch (error) {
    flushTimings();
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
      memoriesReferenced: memoryMatches.length,
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
