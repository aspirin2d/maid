import { z, type ZodType } from "zod";

import { listMessages, markMessagesExtracted, type Message } from "./message";
import {
  getOpenAI,
  getOllama,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OLLAMA_MODEL,
  OLLAMA_KEEP_ALIVE,
  type Provider,
} from "./llm";
import {
  searchSimilarMemories,
  createMemory,
  updateMemory,
  softDeleteMemory,
  type Memory,
} from "./memory";
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
  deletedMemoryIds: number[];
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
  deletedMemoryIds: number[];
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

  for (const fact of args.facts) {
    const similarMemories = await searchSimilarMemories(fact.statement, {
      userId: args.userId,
      provider: args.embeddingProvider,
      limit: args.similarityLimit,
      includeDeleted: false,
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
  deletedMemoryIds: number[];
}> {
  const memoryByLabel = new Map(
    args.memoryReferences.map((ref) => [ref.label, ref]),
  );
  const factByLabel = new Map(args.facts.map((fact) => [fact.factId, fact]));

  const changes: AppliedMemoryChange[] = [];
  const createdMemoryIds: number[] = [];
  const updatedMemoryIds: number[] = [];
  const deletedMemoryIds: number[] = [];

  for (const decision of args.decisions) {
    const change: AppliedMemoryChange = {
      decision,
      createdMemoryIds: [],
      updatedMemoryIds: [],
      deletedMemoryIds: [],
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

      case "DELETE": {
        const ref = memoryByLabel.get(decision.id);
        if (!ref) {
          throw new Error(
            `DELETE decision referenced unknown memory label ${decision.id}`,
          );
        }

        const success = await softDeleteMemory(ref.memoryId);
        if (!success) {
          throw new Error(`Failed to delete memory ${ref.memoryId}`);
        }

        ref.deleted = true;
        ref.raw.deleted = 1;
        ref.raw.action = "DELETE";
        ref.action = "DELETE";

        change.deletedMemoryIds.push(ref.memoryId);
        deletedMemoryIds.push(ref.memoryId);

        break;
      }

      default: {
        throw new Error(`Unsupported memory decision event`);
      }
    }

    changes.push(change);
  }

  return { changes, createdMemoryIds, updatedMemoryIds, deletedMemoryIds };
}

export async function runMemoryExtraction(
  options: MemoryExtractionOptions,
): Promise<MemoryExtractionResult> {
  const embeddingProvider = options.embeddingProvider ?? "ollama";
  const memoryProvider = options.memoryProvider ?? embeddingProvider;
  const llmProvider = options.llmProvider ?? "ollama";
  const similarityLimit = options.similarityLimit ?? DEFAULT_SIMILARITY_LIMIT;

  const messages = await fetchPendingMessages(
    options.userId,
    options.messageLimit,
  );

  const facts = await extractFactsFromConversation({
    messages,
    model: options.llmModel,
    minConfidence: options.minConfidence,
    provider: llmProvider,
  });

  const { factContexts, memoryReferences, labelToMemoryId } =
    await buildSimilarityContext({
      userId: options.userId,
      facts,
      similarityLimit,
      embeddingProvider,
    });

  const decisions = await decideMemoryActions({
    facts,
    memoryReferences,
    model: options.llmModel,
    provider: llmProvider,
  });

  const {
    changes: appliedChanges,
    createdMemoryIds,
    updatedMemoryIds,
    deletedMemoryIds,
  } = await applyMemoryDecisions({
    userId: options.userId,
    decisions,
    memoryReferences,
    facts,
    provider: memoryProvider,
  });

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
    deletedMemoryIds,
    markedMessageIds,
    markedMessageCount,
  };
}
