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
} from "./prompt";

export type ExtractedFact = {
  factId: string;
  statement: string;
  confidence: number;
  sourceMessageIds: number[];
  category?: string;
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
>["memory"][number];

export type MemoryDecisionAction = MemoryDecision["event"];

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

  return structured.facts.map((statement, index) => ({
    factId: `F${index + 1}`,
    statement,
    confidence: 1,
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

async function buildSimilarityContext(args: {
  userId: number;
  facts: ExtractedFact[];
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

  // Optimization: Batch generate embeddings for all facts at once
  if (args.facts.length === 0) {
    return {
      factContexts: [],
      memoryReferences: [],
      labelToMemoryId: {},
    };
  }

  const factStatements = args.facts.map((fact) => fact.statement);
  const embeddings = await embedTexts(args.embeddingProvider, factStatements);

  // Process each fact with its pre-computed embedding
  for (let i = 0; i < args.facts.length; i++) {
    const fact = args.facts[i]!;
    const embedding = embeddings[i]!;

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
  if (args.facts.length === 0 && args.memoryReferences.length === 0) {
    return [];
  }

  const messages = buildMemoryUpdateMessages(args.memoryReferences, args.facts);
  const decisionPrompt = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n\n");

  if (decisionPrompt.trim().length > 0) {
    console.log("=== Memory Update Prompt ===");
    console.log(decisionPrompt);
    console.log("=== End Memory Update Prompt ===");
  }
  const structured = await callStructuredJson({
    messages,
    schemaName: "memory_update_planning",
    schema: MemoryUpdateSchema,
    model: args.model,
    provider: args.provider,
  });

  return structured.memory;
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

      switch (decision.event) {
        case "ADD": {
          const referencedFact = decision.id
            ? factByLabel.get(decision.id)
            : undefined;

          let content = referencedFact?.statement.trim();
          if (!content) {
            throw new Error(
              `ADD decision for label ${decision.id} is missing text content and does not reference a known fact`,
            );
          }

          const memoryId = await createMemory(
            {
              userId: args.userId,
              content,
              action: "ADD",
            },
            args.provider,
          );

          change.createdMemoryIds.push(memoryId);
          createdMemoryIds.push(memoryId);

          break;
        }

        case "UPDATE": {
          const ref = memoryByLabel.get(decision.id);
          if (!ref) {
            throw new Error(
              `UPDATE decision referenced unknown memory label ${decision.id}`,
            );
          }

          const newContent = (decision.text ?? "").trim();
          if (!newContent) {
            throw new Error(
              `UPDATE decision for memory ${decision.id} is missing text content`,
            );
          }

          const previousContent = ref.content ?? ref.raw.content ?? null;
          const success = await updateMemory(
            ref.memoryId,
            {
              content: newContent,
              prevContent: previousContent ?? undefined,
              action: "UPDATE",
              deleted: 0,
            },
            args.provider,
          );
          if (!success) {
            throw new Error(`Failed to update memory ${ref.memoryId}`);
          }

          ref.raw.prevContent = previousContent;
          ref.raw.content = newContent;
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

        default: {
          throw new Error(
            `Unsupported memory decision event: ${decision.event}`,
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
    console.log(
      `[Memory Extraction] Fetching pending messages for user ${options.userId}`,
    );
    messages = await fetchPendingMessages(options.userId, options.messageLimit);

    if (messages.length === 0) {
      console.log(`[Memory Extraction] No pending messages found`);
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

    console.log(
      `[Memory Extraction] Found ${messages.length} pending messages`,
    );

    // Step 2: Extract facts from conversation
    console.log(`[Memory Extraction] Extracting facts from conversation`);
    facts = await extractFactsFromConversation({
      messages,
      model: options.llmModel,
      minConfidence: options.minConfidence,
      provider: llmProvider,
    });
    console.log(`[Memory Extraction] Extracted ${facts.length} facts`);

    // Step 3: Build similarity context
    console.log(`[Memory Extraction] Building similarity context`);
    ({ factContexts, memoryReferences, labelToMemoryId } =
      await buildSimilarityContext({
        userId: options.userId,
        facts,
        similarityLimit,
        embeddingProvider,
      }));
    console.log(
      `[Memory Extraction] Found ${memoryReferences.length} similar memories`,
    );

    // Step 4: Decide memory actions
    console.log(`[Memory Extraction] Deciding memory actions`);

    // Separate facts with and without similar memories
    const factsWithSimilarMemories: ExtractedFact[] = [];
    const factsWithoutSimilarMemories: ExtractedFact[] = [];

    for (const context of factContexts) {
      if (context.similarMemoryLabels.length === 0) {
        factsWithoutSimilarMemories.push(context.fact);
      } else {
        factsWithSimilarMemories.push(context.fact);
      }
    }

    console.log(
      `[Memory Extraction] ${factsWithoutSimilarMemories.length} facts without similar memories will be added directly`,
    );
    console.log(
      `[Memory Extraction] ${factsWithSimilarMemories.length} facts with similar memories need LLM decision`,
    );

    // Create ADD decisions for facts without similar memories
    const directAddDecisions: MemoryDecision[] = factsWithoutSimilarMemories.map(
      (fact) => ({
        event: "ADD" as const,
        id: fact.factId,
        text: fact.statement,
        rationale: "No similar memories found, adding fact directly",
      }),
    );

    // Only call LLM for facts that have similar memories
    let llmDecisions: MemoryDecision[] = [];
    if (factsWithSimilarMemories.length > 0) {
      llmDecisions = await decideMemoryActions({
        facts: factsWithSimilarMemories,
        memoryReferences,
        model: options.llmModel,
        provider: llmProvider,
      });
    }

    // Combine direct ADD decisions with LLM decisions
    decisions = [...directAddDecisions, ...llmDecisions];

    console.log(
      `[Memory Extraction] Generated ${decisions.length} memory decisions (${directAddDecisions.length} direct, ${llmDecisions.length} from LLM)`,
    );

    // Step 5: Apply memory decisions (within transaction)
    console.log(`[Memory Extraction] Applying memory decisions`);
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
    console.log(
      `[Memory Extraction] Applied ${appliedChanges.length} changes: ` +
        `${createdMemoryIds.length} created, ${updatedMemoryIds.length} updated`,
    );

    // Step 6: Mark messages as extracted (only after successful processing)
    const markedMessageIds = messages.map((message) => message.id);
    const markedMessageCount = markedMessageIds.length
      ? await markMessagesExtracted(markedMessageIds, true)
      : 0;
    console.log(
      `[Memory Extraction] Marked ${markedMessageCount} messages as extracted`,
    );

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
