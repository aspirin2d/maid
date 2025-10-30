import { test, expect, describe } from "bun:test";
import {
  FactRetrievalSchema,
  MemoryUpdateSchema,
  getFactRetrievalMessages,
  getUpdateMemoryMessages,
  parseMessages,
  removeCodeBlocks,
} from "../src/prompt";

describe("prompt module", () => {
  describe("FactRetrievalSchema", () => {
    test("validates correct fact retrieval output", () => {
      const validOutput = {
        facts: ["User likes pizza", "User works as a software engineer"],
      };

      const result = FactRetrievalSchema.parse(validOutput);
      expect(result.facts).toEqual(validOutput.facts);
    });

    test("validates empty facts array", () => {
      const validOutput = { facts: [] };
      const result = FactRetrievalSchema.parse(validOutput);
      expect(result.facts).toEqual([]);
    });

    test("rejects invalid schema without facts key", () => {
      const invalidOutput = { items: ["fact1"] };
      expect(() => FactRetrievalSchema.parse(invalidOutput)).toThrow();
    });

    test("rejects non-array facts", () => {
      const invalidOutput = { facts: "not an array" };
      expect(() => FactRetrievalSchema.parse(invalidOutput)).toThrow();
    });

    test("rejects facts with non-string elements", () => {
      const invalidOutput = { facts: ["valid", 123, null] };
      expect(() => FactRetrievalSchema.parse(invalidOutput)).toThrow();
    });
  });

  describe("MemoryUpdateSchema", () => {
    test("validates correct memory update output with ADD event", () => {
      const validOutput = {
        memory: [
          {
            id: "F1",
            text: "User's favorite color is blue",
            event: "ADD",
          },
        ],
      };

      const result = MemoryUpdateSchema.parse(validOutput);
      expect(result.memory).toHaveLength(1);
      expect(result.memory[0]?.event).toBe("ADD");
    });

    test("validates correct memory update output with UPDATE event", () => {
      const validOutput = {
        memory: [
          {
            id: "M1",
            text: "User's favorite color is now green",
            event: "UPDATE",
          },
        ],
      };

      const result = MemoryUpdateSchema.parse(validOutput);
      expect(result.memory[0]?.event).toBe("UPDATE");
    });

    test("validates empty memory array", () => {
      const validOutput = { memory: [] };
      const result = MemoryUpdateSchema.parse(validOutput);
      expect(result.memory).toEqual([]);
    });

    test("validates multiple memory operations", () => {
      const validOutput = {
        memory: [
          { id: "F1", text: "New fact", event: "ADD" },
          { id: "M2", text: "Updated memory", event: "UPDATE" },
        ],
      };

      const result = MemoryUpdateSchema.parse(validOutput);
      expect(result.memory).toHaveLength(2);
    });

    test("rejects invalid event type", () => {
      const invalidOutput = {
        memory: [
          {
            id: "F1",
            text: "Some text",
            event: "INVALID",
          },
        ],
      };

      expect(() => MemoryUpdateSchema.parse(invalidOutput)).toThrow();
    });

    test("rejects missing required fields", () => {
      const invalidOutput = {
        memory: [
          {
            id: "F1",
            // missing text and event
          },
        ],
      };

      expect(() => MemoryUpdateSchema.parse(invalidOutput)).toThrow();
    });

    test("rejects memory update without memory key", () => {
      const invalidOutput = { items: [] };
      expect(() => MemoryUpdateSchema.parse(invalidOutput)).toThrow();
    });
  });

  describe("getFactRetrievalMessages", () => {
    test("returns system and user prompts", () => {
      const parsedMessages = "User: Hello\nAssistant: Hi there!";
      const [systemPrompt, userPrompt] = getFactRetrievalMessages(parsedMessages);

      expect(systemPrompt).toContain("memory curator");
      expect(systemPrompt).toContain("AI companion");
      expect(userPrompt).toContain(parsedMessages);
      expect(userPrompt).toContain("Input:");
    });

    test("includes reference date in system prompt", () => {
      const parsedMessages = "User: I will visit Paris on Friday";
      const [systemPrompt] = getFactRetrievalMessages(parsedMessages);

      const today = new Date().toISOString().split("T")[0];
      expect(systemPrompt).toContain(`Reference date: ${today}`);
      expect(systemPrompt).toContain("YYYY-MM-DD");
    });

    test("includes core retention principles in system prompt", () => {
      const [systemPrompt] = getFactRetrievalMessages("test");

      expect(systemPrompt).toContain("identity");
      expect(systemPrompt).toContain("relationships");
      expect(systemPrompt).toContain("preferences");
      expect(systemPrompt).toContain("goals");
    });

    test("includes safety guardrails in system prompt", () => {
      const [systemPrompt] = getFactRetrievalMessages("test");

      expect(systemPrompt).toContain("Never invent facts");
      expect(systemPrompt).toContain("privacy");
    });

    test("includes output contract in system prompt", () => {
      const [systemPrompt] = getFactRetrievalMessages("test");

      expect(systemPrompt).toContain('{"facts": []}');
      expect(systemPrompt).toContain("valid JSON");
    });

    test("user prompt includes conversation content", () => {
      const conversation = "User: My name is Alice\nAssistant: Nice to meet you!";
      const [, userPrompt] = getFactRetrievalMessages(conversation);

      expect(userPrompt).toContain("My name is Alice");
      expect(userPrompt).toContain("Nice to meet you");
    });
  });

  describe("getUpdateMemoryMessages", () => {
    test("formats existing memories correctly", () => {
      const existingMemories = [
        { id: "M1", text: "User likes coffee" },
        { id: "M2", text: "User works remotely" },
      ];
      const newFacts = [{ id: "F1", text: "User also likes tea" }];

      const prompt = getUpdateMemoryMessages(existingMemories, newFacts);

      expect(prompt).toContain("M1: User likes coffee");
      expect(prompt).toContain("M2: User works remotely");
      expect(prompt).toContain("F1: User also likes tea");
    });

    test("formats new facts correctly", () => {
      const existingMemories = [{ id: "M1", text: "User likes pizza" }];
      const newFacts = [
        { id: "F1", text: "User prefers thin crust" },
        { id: "F2", text: "User is vegetarian" },
      ];

      const prompt = getUpdateMemoryMessages(existingMemories, newFacts);

      expect(prompt).toContain("F1: User prefers thin crust");
      expect(prompt).toContain("F2: User is vegetarian");
    });

    test("handles empty existing memories", () => {
      const existingMemories: Array<{ id: string; text: string }> = [];
      const newFacts = [{ id: "F1", text: "User's first fact" }];

      const prompt = getUpdateMemoryMessages(existingMemories, newFacts);

      expect(prompt).toContain("Existing labeled memories");
      expect(prompt).toContain("- None");
      expect(prompt).toContain("F1: User's first fact");
    });

    test("handles empty new facts", () => {
      const existingMemories = [{ id: "M1", text: "Existing memory" }];
      const newFacts: Array<{ id: string; text: string }> = [];

      const prompt = getUpdateMemoryMessages(existingMemories, newFacts);

      expect(prompt).toContain("M1: Existing memory");
      expect(prompt).toContain("Newly extracted facts");
      expect(prompt).toContain("- None");
    });

    test("handles empty inputs for both memories and facts", () => {
      const existingMemories: Array<{ id: string; text: string }> = [];
      const newFacts: Array<{ id: string; text: string }> = [];

      const prompt = getUpdateMemoryMessages(existingMemories, newFacts);

      expect(prompt).toContain("Existing labeled memories");
      expect(prompt).toContain("Newly extracted facts");
      expect(prompt).toMatch(/- None/g);
    });

    test("includes decision rules in prompt", () => {
      const prompt = getUpdateMemoryMessages([], []);

      expect(prompt).toContain("Decision rules");
      expect(prompt).toContain("ADD");
      expect(prompt).toContain("UPDATE");
      expect(prompt).toContain("memory planner");
    });

    test("includes label usage instructions", () => {
      const prompt = getUpdateMemoryMessages([], []);

      expect(prompt).toContain("F1");
      expect(prompt).toContain("M2");
      expect(prompt).toContain("fact label");
      expect(prompt).toContain("memory label");
    });

    test("includes example output format", () => {
      const prompt = getUpdateMemoryMessages([], []);

      expect(prompt).toContain('{"memory":[');
      expect(prompt).toContain('"event":"ADD"');
      expect(prompt).toContain('"event":"UPDATE"');
    });

    test("instructs to avoid redundant operations", () => {
      const prompt = getUpdateMemoryMessages([], []);

      expect(prompt).toContain("Never emit redundant operations");
      expect(prompt).toContain("already matches");
    });

    test("includes conflict resolution instructions", () => {
      const prompt = getUpdateMemoryMessages([], []);

      expect(prompt).toContain("conflict");
      expect(prompt).toContain("overwrite");
    });
  });

  describe("parseMessages", () => {
    test("joins messages with newlines", () => {
      const messages = ["Message 1", "Message 2", "Message 3"];
      const result = parseMessages(messages);

      expect(result).toBe("Message 1\nMessage 2\nMessage 3");
    });

    test("handles single message", () => {
      const messages = ["Single message"];
      const result = parseMessages(messages);

      expect(result).toBe("Single message");
    });

    test("handles empty array", () => {
      const messages: string[] = [];
      const result = parseMessages(messages);

      expect(result).toBe("");
    });

    test("preserves message content exactly", () => {
      const messages = [
        "User: Hello, how are you?",
        "Assistant: I'm doing well, thank you!",
        "User: Great to hear!",
      ];
      const result = parseMessages(messages);

      expect(result).toContain("User: Hello, how are you?");
      expect(result).toContain("Assistant: I'm doing well, thank you!");
      expect(result).toContain("User: Great to hear!");
    });

    test("handles messages with special characters", () => {
      const messages = ["Message with @#$%", "Message with émojis 🎉"];
      const result = parseMessages(messages);

      expect(result).toContain("@#$%");
      expect(result).toContain("🎉");
    });
  });

  describe("removeCodeBlocks", () => {
    test("removes single code block", () => {
      const text = "Here is code:\n```\nfunction test() {}\n```\nEnd of code.";
      const result = removeCodeBlocks(text);

      expect(result).toBe("Here is code:\n\nEnd of code.");
      expect(result).not.toContain("```");
      expect(result).not.toContain("function test()");
    });

    test("removes multiple code blocks", () => {
      const text = "First: ```code1```\nSecond: ```code2```\nThird: ```code3```";
      const result = removeCodeBlocks(text);

      expect(result).toBe("First: \nSecond: \nThird: ");
      expect(result).not.toContain("code1");
      expect(result).not.toContain("code2");
      expect(result).not.toContain("code3");
    });

    test("removes code blocks with language specifiers", () => {
      const text = "Python code:\n```python\nprint('hello')\n```\nDone.";
      const result = removeCodeBlocks(text);

      expect(result).toBe("Python code:\n\nDone.");
      expect(result).not.toContain("python");
      expect(result).not.toContain("print");
    });

    test("handles text without code blocks", () => {
      const text = "This is plain text without any code blocks.";
      const result = removeCodeBlocks(text);

      expect(result).toBe(text);
    });

    test("handles empty string", () => {
      const text = "";
      const result = removeCodeBlocks(text);

      expect(result).toBe("");
    });

    test("handles text with only backticks", () => {
      const text = "Use `inline code` for this.";
      const result = removeCodeBlocks(text);

      // Single backticks should be preserved
      expect(result).toBe("Use `inline code` for this.");
    });

    test("removes nested content within code blocks", () => {
      const text = "Text before\n```\nSome code\nMore code\nEven more\n```\nText after";
      const result = removeCodeBlocks(text);

      expect(result).toBe("Text before\n\nText after");
      expect(result).not.toContain("Some code");
      expect(result).not.toContain("More code");
    });

    test("handles adjacent code blocks", () => {
      const text = "```code1``````code2```";
      const result = removeCodeBlocks(text);

      expect(result).toBe("");
    });

    test("preserves text between code blocks", () => {
      const text = "Start ```code1``` Middle ```code2``` End";
      const result = removeCodeBlocks(text);

      expect(result).toBe("Start  Middle  End");
    });
  });
});
