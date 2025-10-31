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
  memory: z
    .array(
      z.object({
        id: z
          .string()
          .describe("The unique identifier of the memory/fact item."),
        text: z.string().describe("The content of the memory/fact item."),
        event: z
          .enum(["ADD", "UPDATE"])
          .describe(
            "The action taken for this memory item (ADD, UPDATE, or DELETE).",
          ),
      }),
    )
    .describe(
      "An array representing the state of memory items after processing new facts.",
    ),
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
  // Labels are already unified (1, 2, 3...) when passed in
  const formattedExisting = retrievedOldMemory.length
    ? retrievedOldMemory.map(({ id, text }) => `${id}. ${text}`).join("\n")
    : "(none)";

  const formattedFacts = newRetrievedFacts.length
    ? newRetrievedFacts.map(({ id, text }) => `${id}. ${text}`).join("\n")
    : "(none)";

  const memoryCount = retrievedOldMemory.length;
  const exampleFactId = memoryCount > 0 ? memoryCount + 1 : 1;
  const exampleMemoryId = memoryCount > 0 ? 1 : "(none)";

  return `Compare new facts with existing memories and decide: ADD or UPDATE?

EXISTING MEMORIES:
${formattedExisting}

NEW FACTS:
${formattedFacts}

DECISION LOGIC:

ADD - Use when fact is completely new:
• No existing memory covers this information
• Format: {"id":"${exampleFactId}","text":"","event":"ADD"}
• Leave "text" empty - system copies the fact automatically
• Fact's metadata (category, importance, confidence) is preserved

UPDATE - Use when fact relates to existing memory:
• Fact refines, corrects, or conflicts with an existing memory
• Format: {"id":"${exampleMemoryId}","text":"Updated combined text","event":"UPDATE"}
• Combine old memory + new fact into one clear, concise statement
• Example: Memory "User likes coffee" + Fact "User prefers dark roast" → "User likes dark roast coffee"
• Fact's metadata will replace memory's metadata

SKIP - When:
• Fact is redundant with existing memory (no new information)
• Simply omit from output

CONSOLIDATION:
• If multiple facts relate to same memory, UPDATE it once with all information combined
• If multiple facts are unrelated, ADD each separately

FORMAT:
{"memory":[{"id":"X","text":"...","event":"ADD/UPDATE"}]}
• Always use "User" as subject - never "I", "They", "He", "She"
• Keep text concise and factual
• Use numbers (${retrievedOldMemory.length > 0 ? `1-${memoryCount}` : "none"} for memories, ${exampleFactId}+ for facts) to reference items`;
}

export function parseMessages(messages: string[]): string {
  return messages.join("\n");
}

export function removeCodeBlocks(text: string): string {
  return text.replace(/```[^`]*```/g, "");
}
