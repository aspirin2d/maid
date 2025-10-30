import {
  listMessages,
  markMessagesExtracted,
  type Message,
} from "./message";
import {
  embedText,
  getOpenAI,
  DEFAULT_OPENAI_MODEL,
  type Provider,
} from "./llm";
import {
  searchSimilarMemories,
  createMemory,
  updateMemory,
  softDeleteMemory,
  type Memory,
} from "./memory";

export type ExtractedFact = {
  factId: string;
  statement: string;
  confidence: number;
  sourceMessageIds: number[];
  category?: string;
};

export type FactExtractionResponse = {
  facts: ExtractedFact[];
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

export type MemoryDecisionAction = "ADD" | "UPDATE" | "DELETE";

export type MemoryDecision = {
  factId: string;
  action: MemoryDecisionAction;
  targetMemoryLabels?: string[];
  newContent?: string;
  reason?: string;
};

export type MemoryDecisionResponse = {
  decisions: MemoryDecision[];
};

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

function formatMessagesForPrompt(messages: Message[]): string {
  return messages
    .map((message, index) => {
      const createdAt = message.createdAt
        ? new Date(message.createdAt).toISOString()
        : "unknown";
      return `#${index + 1} [${message.role.toUpperCase()}|id:${message.id}|${createdAt}]\n${message.content.trim()}`;
    })
    .join("\n\n");
}

function buildFactExtractionPrompt(messages: Message[]): string {
  const formattedConversation = formatMessagesForPrompt(messages);
  return [
    "You are an AI tasked with extracting stable, long-term facts about the user from a conversation.",
    "Only extract information that is likely to remain true beyond this specific exchange.",
    "Avoid speculative or time-sensitive statements.",
    "Whenever possible, ground each fact in specific message ids.",
    "",
    "Return concise and atomic fact statements that could be stored as long-term memory.",
    "",
    "Conversation:",
    formattedConversation,
  ].join("\n");
}

const FACT_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      description:
        "List of extracted facts describing enduring user information or preferences.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          factId: {
            type: "string",
            description:
              "Stable identifier you assign for the fact within this response.",
          },
          statement: {
            type: "string",
            description:
              "Single-sentence declarative fact phrased in third person about the user.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence score between 0 and 1.",
          },
          sourceMessageIds: {
            type: "array",
            minItems: 1,
            items: {
              type: "integer",
            },
            description:
              "Message ids from the conversation that support this fact.",
          },
          category: {
            type: "string",
            description:
              "Optional category label such as preference, profile, goal, habit, or fact.",
          },
        },
        required: ["factId", "statement", "confidence", "sourceMessageIds"],
      },
    },
  },
  required: ["facts"],
} as const;

async function callStructuredJson<T>(args: {
  prompt: string;
  schemaName: string;
  schema: object;
  model?: string;
}): Promise<T> {
  const client = getOpenAI();
  const response = await client.responses.parse({
    model: args.model ?? DEFAULT_OPENAI_MODEL,
    input: args.prompt,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: args.schemaName,
        schema: args.schema,
        strict: true,
      },
    },
  });

  if (!response.output_parsed) {
    throw new Error("Failed to parse structured response from model");
  }

  return response.output_parsed as T;
}

async function extractFactsFromConversation(args: {
  messages: Message[];
  model?: string;
  minConfidence?: number;
}): Promise<ExtractedFact[]> {
  if (args.messages.length === 0) {
    return [];
  }

  const prompt = buildFactExtractionPrompt(args.messages);
  const structured = await callStructuredJson<FactExtractionResponse>({
    prompt,
    schemaName: "conversation_fact_extraction",
    schema: FACT_EXTRACTION_SCHEMA,
    model: args.model,
  });

  const minConfidence = args.minConfidence ?? 0.4;

  return structured.facts.filter((fact) => fact.confidence >= minConfidence);
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
    const embedding = await embedText(args.embeddingProvider, fact.statement);

    const similarMemories = await searchSimilarMemories(fact.statement, {
      userId: args.userId,
      provider: args.embeddingProvider,
      limit: args.similarityLimit,
      includeDeleted: true,
      embedding,
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

function buildDecisionPrompt(args: {
  facts: ExtractedFact[];
  factContexts: FactMatchContext[];
  memoryReferences: MemoryReference[];
}): string {
  const factsSection = args.facts
    .map(
      (fact) =>
        `- Fact ${fact.factId}: "${fact.statement}" (confidence ${fact.confidence.toFixed(2)})` +
        (fact.category ? ` [${fact.category}]` : ""),
    )
    .join("\n");

  const contextLookup = new Map(
    args.factContexts.map((ctx) => [ctx.fact.factId, ctx.similarMemoryLabels]),
  );

  const perFactLinks = args.facts
    .map((fact) => {
      const labels = contextLookup.get(fact.factId) ?? [];
      if (labels.length === 0) {
        return `- Fact ${fact.factId}: no similar memory labels.`;
      }
      return `- Fact ${fact.factId}: similar memories -> ${labels.join(", ")}.`;
    })
    .join("\n");

  const memorySection = args.memoryReferences
    .map((ref) => {
      const status = ref.deleted ? "deleted" : (ref.action ?? "unknown");
      const distance = Number.isFinite(ref.distance)
        ? ref.distance.toFixed(4)
        : "n/a";
      return `- ${ref.label}: (memory #${ref.memoryId}) [${status}] distance=${distance}\n  Content: ${ref.content ?? "<empty>"}`;
    })
    .join("\n");

  return [
    "You manage a user's long-term memory store.",
    "For each extracted fact, decide whether to ADD a new memory, UPDATE an existing memory, or DELETE an obsolete one.",
    "Use the provided memory labels (M1, M2, ...) instead of raw ids when referencing existing memories.",
    "",
    "Facts:",
    factsSection || "(none)",
    "",
    "Similar memory mapping per fact:",
    perFactLinks || "(no overlaps)",
    "",
    "Existing labeled memories:",
    memorySection || "(none)",
    "",
    "Rules:",
    "- ADD: Create when no suitable memory exists.",
    "- UPDATE: Choose when fact refines or corrects a labeled memory; include labels to adjust.",
    "- DELETE: Use when a labeled memory is contradicted by the fact.",
    "Provide a short reason for each decision.",
  ].join("\n");
}

const MEMORY_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          factId: {
            type: "string",
            description: "The fact identifier this decision corresponds to.",
          },
          action: {
            type: "string",
            enum: ["ADD", "UPDATE", "DELETE"],
          },
          targetMemoryLabels: {
            type: "array",
            description:
              "Labels of existing memories affected by UPDATE or DELETE actions.",
            items: {
              type: "string",
            },
          },
          newContent: {
            type: "string",
            description:
              "Rewritten memory content for ADD or UPDATE actions. Must be concise.",
          },
          reason: {
            type: "string",
            description: "Short rationale for the chosen action.",
          },
        },
        required: ["factId", "action"],
      },
    },
  },
  required: ["decisions"],
} as const;

async function decideMemoryActions(args: {
  facts: ExtractedFact[];
  factContexts: FactMatchContext[];
  memoryReferences: MemoryReference[];
  model?: string;
}): Promise<MemoryDecision[]> {
  if (args.facts.length === 0) {
    return [];
  }

  const prompt = buildDecisionPrompt(args);
  const structured = await callStructuredJson<MemoryDecisionResponse>({
    prompt,
    schemaName: "memory_action_planning",
    schema: MEMORY_DECISION_SCHEMA,
    model: args.model,
  });

  return structured.decisions;
}

async function applyMemoryDecisions(args: {
  userId: number;
  decisions: MemoryDecision[];
  facts: ExtractedFact[];
  memoryReferences: MemoryReference[];
  provider: Provider;
}): Promise<{
  changes: AppliedMemoryChange[];
  createdMemoryIds: number[];
  updatedMemoryIds: number[];
  deletedMemoryIds: number[];
}> {
  const factById = new Map(args.facts.map((fact) => [fact.factId, fact]));
  const memoryByLabel = new Map(
    args.memoryReferences.map((ref) => [ref.label, ref]),
  );

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

    switch (decision.action) {
      case "ADD": {
        const fact = factById.get(decision.factId);
        const content = (decision.newContent ?? fact?.statement ?? "").trim();
        if (!content) {
          throw new Error(
            `ADD decision for fact ${decision.factId} is missing content`,
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
        const labels = decision.targetMemoryLabels ?? [];
        if (labels.length === 0) {
          throw new Error(
            `UPDATE decision for fact ${decision.factId} is missing targetMemoryLabels`,
          );
        }

        const fact = factById.get(decision.factId);
        const newContent = (decision.newContent ?? fact?.statement ?? "").trim();
        if (!newContent) {
          throw new Error(
            `UPDATE decision for fact ${decision.factId} is missing new content`,
          );
        }

        for (const label of labels) {
          const ref = memoryByLabel.get(label);
          if (!ref) {
            throw new Error(
              `UPDATE decision referenced unknown memory label ${label}`,
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
          ref.content = newContent;
          ref.deleted = false;
          ref.action = "UPDATE";

          change.updatedMemoryIds.push(ref.memoryId);
          updatedMemoryIds.push(ref.memoryId);
        }

        break;
      }

      case "DELETE": {
        const labels = decision.targetMemoryLabels ?? [];
        if (labels.length === 0) {
          throw new Error(
            `DELETE decision for fact ${decision.factId} is missing targetMemoryLabels`,
          );
        }

        for (const label of labels) {
          const ref = memoryByLabel.get(label);
          if (!ref) {
            throw new Error(
              `DELETE decision referenced unknown memory label ${label}`,
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
        }

        break;
      }

      default: {
        const exhaustive: never = decision.action;
        throw new Error(`Unsupported memory decision action ${exhaustive}`);
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
  const similarityLimit = options.similarityLimit ?? DEFAULT_SIMILARITY_LIMIT;

  const messages = await fetchPendingMessages(
    options.userId,
    options.messageLimit,
  );

  const facts = await extractFactsFromConversation({
    messages,
    model: options.llmModel,
    minConfidence: options.minConfidence,
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
    factContexts,
    memoryReferences,
    model: options.llmModel,
  });

  const {
    changes: appliedChanges,
    createdMemoryIds,
    updatedMemoryIds,
    deletedMemoryIds,
  } = await applyMemoryDecisions({
    userId: options.userId,
    decisions,
    facts,
    memoryReferences,
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
