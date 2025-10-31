import { z } from "zod";

// Define Zod schema for fact retrieval output
export const FactRetrievalSchema = z.object({
  facts: z
    .array(
      z.object({
        text: z.string().describe("The fact about the user"),
        category: z
          .enum([
            "PERSONAL_INFO",
            "PREFERENCE",
            "GOAL",
            "ROUTINE",
            "RELATIONSHIP",
            "HEALTH",
            "EVENT",
            "WORK",
            "OTHER",
          ])
          .describe("The category of the fact"),
        importance: z
          .number()
          .min(0)
          .max(1)
          .describe("How important this fact is (0-1 scale)"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("How confident you are about this fact (0-1 scale)"),
      }),
    )
    .describe("An array of distinct facts extracted from the conversation."),
});

// Define Zod schema for memory update output
export const MemoryUpdateSchema = z.object({
  decisions: z
    .array(
      z.object({
        action: z
          .enum(["ADD", "UPDATE", "SKIP"])
          .describe(
            "The action to take: ADD (new memory), UPDATE (modify existing), SKIP (redundant).",
          ),
        fact_id: z
          .string()
          .describe("The fact ID (e.g., F1, F2) this decision is about."),
        memory_id: z
          .string()
          .optional()
          .describe(
            "For UPDATE: the memory ID (e.g., M1, M2) to update. Leave empty for ADD/SKIP.",
          ),
        combined_text: z
          .string()
          .optional()
          .describe(
            "For UPDATE: the merged text combining memory + fact. Leave empty for ADD/SKIP.",
          ),
      }),
    )
    .describe("Array of decisions for each fact."),
});

export function getFactRetrievalMessages(
  parsedMessages: string,
): [string, string] {
  const systemPrompt = `Extract important facts about the user from conversation history.

EXTRACT (with category):
• PERSONAL_INFO: name, age, identity, location | importance 0.9-1.0
• PREFERENCE: likes, dislikes, favorites | importance 0.5-0.8
• GOAL: plans, aspirations, objectives | importance 0.7-0.9
• ROUTINE: habits, schedules, regular activities | importance 0.5-0.7
• RELATIONSHIP: friends, family, connections | importance 0.5-0.7
• HEALTH: medical info, fitness, wellness | importance 0.7-0.9
• EVENT: important occurrences, milestones | importance 0.3-0.7
• WORK: career, job, professional info | importance 0.6-0.9
• OTHER: anything else relevant | importance 0.3-0.6

IGNORE:
Greetings, jokes, temporary moods, assistant messages, cancelled plans, third-party info

CONFIDENCE (0-1):
1.0 = explicitly stated | 0.8 = strongly implied | 0.5 = moderately implied | 0.3 = weakly implied

FORMAT:
{"facts": [{"text": "User [fact]", "category": "CATEGORY", "importance": 0.0, "confidence": 0.0}]}
• Start EVERY fact with "User" - never use "I", "They", "He", "She"
• One fact per object - be specific and concise
• Return empty array if no facts: {"facts": []}
• Today: ${new Date().toISOString().split("T")[0]} - convert relative dates to YYYY-MM-DD

EXAMPLES:
"I prefer coffee" → {"text": "User prefers coffee", "category": "PREFERENCE", "importance": 0.5, "confidence": 1.0}
"My name is Jack" → {"text": "User's name is Jack", "category": "PERSONAL_INFO", "importance": 1.0, "confidence": 1.0}
"I run on weekends" → {"text": "User runs on weekends", "category": "ROUTINE", "importance": 0.6, "confidence": 0.9}

RULES:
1. Extract from user messages only
2. Use latest information if corrected
3. Never fabricate facts
4. Be precise with importance and confidence scores`;

  const userPrompt = `Extract facts from this conversation:\n\n${parsedMessages}`;

  return [systemPrompt, userPrompt];
}

export function getUpdateMemoryMessages(
  retrievedOldMemory: Array<{ id: string; text: string }>,
  newRetrievedFacts: Array<{ id: string; text: string }>,
): string {
  const formattedExisting = retrievedOldMemory.length
    ? retrievedOldMemory.map(({ id, text }) => `${id}: ${text}`).join("\n")
    : "(none)";

  const formattedFacts = newRetrievedFacts.length
    ? newRetrievedFacts.map(({ id, text }) => `${id}: ${text}`).join("\n")
    : "(none)";

  return `Compare new facts with existing memories and decide the appropriate action for each fact.

EXISTING MEMORIES:
${formattedExisting}

NEW FACTS (with metadata already evaluated):
${formattedFacts}

DECISION LOGIC:

ADD - When fact is completely new:
• No existing memory covers this information
• The fact will be stored as-is with its pre-evaluated metadata

UPDATE - When fact relates to existing memory:
• Fact refines, corrects, or conflicts with existing memory
• Combine memory + fact into clear, concise statement
• Example: Memory M1 "User likes coffee" + Fact F1 "User prefers dark roast"
  → UPDATE M1 with "User likes dark roast coffee"
• The fact's metadata will replace the memory's metadata

SKIP - When fact is redundant:
• Fact duplicates existing memory with no new information
• No action needed

CONSOLIDATION:
• Multiple facts can UPDATE the same memory (combine all info)
• Multiple facts can each ADD separately if unrelated

OUTPUT FORMAT:
{"decisions": [
  {"action": "ADD", "fact_id": "F1", "memory_id": null, "combined_text": null},
  {"action": "UPDATE", "fact_id": "F2", "memory_id": "M1", "combined_text": "Updated text here"},
  {"action": "SKIP", "fact_id": "F3", "memory_id": null, "combined_text": null}
]}

RULES:
• Use memory IDs (M1, M2...) and fact IDs (F1, F2...)
• Always use "User" as subject - never "I", "They", "He", "She"
• Keep combined_text concise and factual
• One decision per fact
• For ADD/SKIP: leave memory_id and combined_text as null/empty`;
}

export function parseMessages(messages: string[]): string {
  return messages.join("\n");
}

export function removeCodeBlocks(text: string): string {
  return text.replace(/```[^`]*```/g, "");
}
