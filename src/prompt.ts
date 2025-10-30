import { z } from "zod";

// Define Zod schema for fact retrieval output
export const FactRetrievalSchema = z.object({
  facts: z
    .array(z.string())
    .describe("An array of distinct facts extracted from the conversation."),
});

// Define Zod schema for memory update output
export const MemoryUpdateSchema = z.object({
  memory: z
    .array(
      z.object({
        id: z.string().describe("The unique identifier of the memory item."),
        text: z.string().describe("The content of the memory item."),
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
1. User's name, identity, and personal details
2. Preferences (likes, dislikes, choices)
3. Goals and plans
4. Routines and habits
5. Relationships
6. Health needs
7. Important events

WHAT TO IGNORE:
1. Greetings and small talk
2. Jokes and casual chat
3. Temporary moods
4. What the assistant says
5. Cancelled plans
6. Third-party information

FORMATTING RULES:
1. Return JSON only: {"facts": ["..."]}
2. No markdown, no extra text
3. One fact per sentence
4. ALWAYS start with "User" as the subject
5. Never use "I", "They", "He", "She"

EXAMPLES:
- "I prefer coffee" → "User prefers coffee over coke"
- "My name is Jack" → "User's name is Jack"
- "I run on weekends" → "User runs on weekends"

DATES:
- Today is ${new Date().toISOString().split("T")[0]}
- Convert relative dates to absolute dates (YYYY-MM-DD format)
- Example: "next Monday" → "2025-11-03"

IMPORTANT:
- Only extract facts from user messages, not assistant messages
- If user corrects information, use the new version only
- Never make up facts
- If no facts found, return {"facts": []}
- One clear fact per string`;

  const userPrompt = `Read this conversation and extract facts about the user. Return JSON format: {"facts": ["..."]}\n\nConversation:\n${parsedMessages}`;

  return [systemPrompt, userPrompt];
}

export function getUpdateMemoryMessages(
  retrievedOldMemory: Array<{ id: string; text: string }>,
  newRetrievedFacts: Array<{ id: string; text: string }>,
): string {
  const formattedExisting = retrievedOldMemory.length
    ? retrievedOldMemory.map(({ id, text }) => `- ${id}: ${text}`).join("\n")
    : "- None";

  const formattedFacts = newRetrievedFacts.length
    ? newRetrievedFacts.map(({ id, text }) => `- ${id}: ${text}`).join("\n")
    : "- None";

  return `Your task: Compare new facts with existing memories and decide what to do.

EXISTING MEMORIES (M#):
${formattedExisting}

NEW FACTS (F#):
${formattedFacts}

YOUR JOB:
For each new fact, decide: ADD or UPDATE?

WHEN TO ADD:
- The fact is completely new
- No existing memory covers this information
- Use: {"id":"F1","text":"","event":"ADD"}
- Leave "text" empty, system will copy the fact

WHEN TO UPDATE:
- The fact refines an existing memory
- The fact corrects an existing memory
- The fact conflicts with an existing memory
- Use: {"id":"M2","text":"Updated text here","event":"UPDATE"}
- Combine old and new information into one clear sentence

WHEN TO SKIP:
- Existing memory already says the same thing
- Don't include it in the output

FORMATTING:
1. Return JSON: {"memory":[...]}
2. Always use "User" as subject
3. Never use "I", "They", "He", "She"
4. Keep sentences clear and simple

EXAMPLES:
Good: "User prefers cappuccinos"
Good: "User's name is Jordan"
Good: "User lives in Seattle"
Bad: "I prefer cappuccinos"
Bad: "They live in Seattle"
Bad: "Name is Jordan"

OUTPUT FORMAT:
{"memory":[{"id":"F1","text":"","event":"ADD"},{"id":"M2","text":"User drinks coffee black on weekdays","event":"UPDATE"}]}`;
}

export function parseMessages(messages: string[]): string {
  return messages.join("\n");
}

export function removeCodeBlocks(text: string): string {
  return text.replace(/```[^`]*```/g, "");
}
