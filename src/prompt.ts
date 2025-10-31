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
  const systemPrompt = `Your task: Extract important facts about the user from conversations.

WHAT TO EXTRACT:
1. User's name, identity, and personal details (PERSONAL_INFO)
2. Preferences (likes, dislikes, choices) (PREFERENCE)
3. Goals and plans (GOAL)
4. Routines and habits (ROUTINE)
5. Relationships (RELATIONSHIP)
6. Health needs (HEALTH)
7. Important events (EVENT)
8. Work and career (WORK)
9. Other relevant information (OTHER)

WHAT TO IGNORE:
1. Greetings and small talk
2. Jokes and casual chat
3. Temporary moods
4. What the assistant says
5. Cancelled plans
6. Third-party information

FORMATTING RULES:
1. Return JSON only with this structure:
   {"facts": [{"text": "...", "category": "...", "importance": 0.0, "confidence": 0.0}]}
2. No markdown, no extra text
3. One fact per object
4. ALWAYS start with "User" as the subject
5. Never use "I", "They", "He", "She"

CATEGORIES:
- PERSONAL_INFO: name, age, identity, location
- PREFERENCE: likes, dislikes, favorites
- GOAL: plans, aspirations, objectives
- ROUTINE: habits, schedules, regular activities
- RELATIONSHIP: friends, family, connections
- HEALTH: medical info, fitness, wellness
- EVENT: important occurrences, milestones
- WORK: career, job, professional info
- OTHER: anything else relevant

IMPORTANCE SCALE (0-1):
- 0.9-1.0: Critical identity info (name, core values)
- 0.7-0.9: Important preferences and goals
- 0.5-0.7: Regular routines and relationships
- 0.3-0.5: Minor preferences and events
- 0.1-0.3: Casual mentions

CONFIDENCE SCALE (0-1):
- 0.9-1.0: Explicitly stated facts
- 0.7-0.9: Strongly implied information
- 0.5-0.7: Moderately implied
- 0.3-0.5: Weakly implied
- 0.1-0.3: Uncertain inference

EXAMPLES:
- "I prefer coffee" → {"text": "User prefers coffee", "category": "PREFERENCE", "importance": 0.5, "confidence": 0.95}
- "My name is Jack" → {"text": "User's name is Jack", "category": "PERSONAL_INFO", "importance": 1.0, "confidence": 1.0}
- "I run on weekends" → {"text": "User runs on weekends", "category": "ROUTINE", "importance": 0.6, "confidence": 0.9}

DATES:
- Today is ${new Date().toISOString().split("T")[0]}
- Convert relative dates to absolute dates (YYYY-MM-DD format)
- Example: "next Monday" → "2025-11-03"

IMPORTANT:
- Only extract facts from user messages, not assistant messages
- If user corrects information, use the new version only
- Never make up facts
- If no facts found, return {"facts": []}
- One clear fact per object`;

  const userPrompt = `Read this conversation and extract facts about the user. Return JSON format: {"facts": [{"text": "...", "category": "...", "importance": 0.0, "confidence": 0.0}]}\n\nConversation:\n${parsedMessages}`;

  return [systemPrompt, userPrompt];
}

export function getUpdateMemoryMessages(
  retrievedOldMemory: Array<{ id: string; text: string }>,
  newRetrievedFacts: Array<{ id: string; text: string }>,
): string {
  // Labels are already unified (1, 2, 3...) when passed in
  const formattedExisting = retrievedOldMemory.length
    ? retrievedOldMemory.map(({ id, text }) => `${id}. ${text}`).join("\n")
    : "- None";

  const formattedFacts = newRetrievedFacts.length
    ? newRetrievedFacts.map(({ id, text }) => `${id}. ${text}`).join("\n")
    : "- None";

  const memoryCount = retrievedOldMemory.length;
  const firstFactId = memoryCount + 1;

  return `Your task: Compare new facts with existing memories and decide what to do.

RECENT MEMORIES:
${formattedExisting}

NEW EXTRACTED FACTS:
${formattedFacts}

YOUR JOB:
For each new fact, decide: ADD or UPDATE?

WHEN TO ADD:
- The fact is completely new
- No existing memory covers this information
- Use the fact's number: {"id":"${firstFactId}","text":"","event":"ADD"}
- Leave "text" empty, system will copy the fact automatically
- The fact's category, importance, and confidence will be preserved

WHEN TO UPDATE:
- The fact refines an existing memory
- The fact corrects an existing memory
- The fact conflicts with an existing memory
- Use the memory's number: {"id":"2","text":"Updated text here","event":"UPDATE"}
- Combine old and new information into one clear sentence
- The fact's category, importance, and confidence will be used

WHEN TO SKIP:
- Existing memory already says the same thing
- Don't include it in the output

FORMATTING:
1. Return JSON: {"memory":[...]}
2. Always use "User" as subject
3. Never use "I", "They", "He", "She"
4. Keep sentences clear and simple
5. Use the unified numbers (1, 2, 3...) to reference items
`;
}

export function parseMessages(messages: string[]): string {
  return messages.join("\n");
}

export function removeCodeBlocks(text: string): string {
  return text.replace(/```[^`]*```/g, "");
}
