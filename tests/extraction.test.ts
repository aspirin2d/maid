import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "bun:test";

type Message = {
  id: number;
  userId: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: Date;
  extracted?: boolean;
};

describe("runMemoryExtraction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns empty result when no pending messages", async () => {
    const messageModule = await import("../src/message");
    const memoryModule = await import("../src/memory");
    const llmModule = await import("../src/llm");
    const dbModule = await import("../src/db/index");

    const listMessagesMock = vi
      .spyOn(messageModule, "listMessages")
      .mockResolvedValue([]);
    const markMessagesExtractedMock = vi
      .spyOn(messageModule, "markMessagesExtracted")
      .mockResolvedValue(0);

    vi.spyOn(dbModule.default, "transaction").mockImplementation(
      async (callback: () => unknown) => callback(),
    );

    vi.spyOn(memoryModule, "createMemory").mockResolvedValue(0);
    vi.spyOn(memoryModule, "updateMemory").mockResolvedValue(true);
    vi.spyOn(memoryModule, "searchSimilarMemories").mockResolvedValue([]);

    vi.spyOn(llmModule, "embedTexts").mockResolvedValue([]);
    vi.spyOn(llmModule, "getOllama").mockReturnValue({
      chat: vi.fn(),
    } as any);

    const { runMemoryExtraction } = await import("../src/extraction");

    const result = await runMemoryExtraction({ userId: 42 });

    expect(listMessagesMock).toHaveBeenCalledWith({
      userId: 42,
      extracted: false,
      roles: ["user", "assistant"],
      orderBy: "createdAt",
      orderDir: "asc",
      limit: undefined,
    });
    expect(result.messages).toHaveLength(0);
    expect(result.facts).toHaveLength(0);
    expect(result.decisions).toHaveLength(0);
    expect(result.createdMemoryIds).toHaveLength(0);
    expect(result.updatedMemoryIds).toHaveLength(0);
    expect(markMessagesExtractedMock).not.toHaveBeenCalled();
  });

  test("creates new memories for facts without similar matches", async () => {
    const createdAt = new Date("2025-10-30T10:00:00.000Z");
    const messages: Message[] = [
      {
        id: 7,
        userId: 9,
        role: "user",
        content: "I have started practicing yoga every morning.",
        createdAt,
        extracted: false,
      },
    ];

    const messageModule = await import("../src/message");
    const memoryModule = await import("../src/memory");
    const llmModule = await import("../src/llm");
    const dbModule = await import("../src/db/index");

    const listMessagesMock = vi
      .spyOn(messageModule, "listMessages")
      .mockResolvedValue(messages);
    const markMessagesExtractedMock = vi
      .spyOn(messageModule, "markMessagesExtracted")
      .mockResolvedValue(messages.length);

    const chatMock = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            facts: [
              {
                text: "User practices yoga every morning",
                category: "ROUTINE",
                importance: 0.6,
                confidence: 0.9,
              },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            decisions: [
              {
                action: "ADD",
                fact_id: "F1",
                memory_id: null,
                combined_text: null,
              },
            ],
          }),
        },
      });

    vi.spyOn(llmModule, "getOllama").mockReturnValue({ chat: chatMock } as any);
    const embedTextsMock = vi
      .spyOn(llmModule, "embedTexts")
      .mockResolvedValue([[0.1, 0.2, 0.3]]);

    const searchSimilarMemoriesMock = vi
      .spyOn(memoryModule, "searchSimilarMemories")
      .mockResolvedValue([]);
    const createMemoryMock = vi
      .spyOn(memoryModule, "createMemory")
      .mockResolvedValue(101);
    vi.spyOn(memoryModule, "updateMemory").mockResolvedValue(true);

    const transactionMock = vi
      .spyOn(dbModule.default, "transaction")
      .mockImplementation(async (callback: () => unknown) => callback());

    const { runMemoryExtraction } = await import("../src/extraction");

    const result = await runMemoryExtraction({ userId: 9 });

    expect(listMessagesMock).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledTimes(2); // fact extraction + decision
    expect(embedTextsMock).toHaveBeenCalledWith("ollama", [
      "User practices yoga every morning",
    ]);
    expect(searchSimilarMemoriesMock).toHaveBeenCalledWith(
      "User practices yoga every morning",
      expect.objectContaining({
        userId: 9,
        limit: 3,
        provider: "ollama",
        includeDeleted: false,
        embedding: [0.1, 0.2, 0.3],
      }),
    );
    expect(createMemoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        content: "User practices yoga every morning",
        category: "ROUTINE",
        importance: 0.6,
        confidence: 0.9,
        action: "ADD",
      }),
      "ollama",
    );
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(markMessagesExtractedMock).toHaveBeenCalledWith([7], true);

    expect(result.createdMemoryIds).toEqual([101]);
    expect(result.updatedMemoryIds).toEqual([]);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        action: "ADD",
        fact_id: "F1",
      }),
    ]);
    expect(result.memoryReferences).toHaveLength(0);
    expect(result.factContexts).toHaveLength(1);
    expect(result.markedMessageCount).toBe(1);
  });

  test("updates existing memories when LLM requests update", async () => {
    const createdAt = new Date("2025-10-30T11:00:00.000Z");
    const messages: Message[] = [
      {
        id: 12,
        userId: 15,
        role: "user",
        content: "These days I bike to work every weekday morning.",
        createdAt,
        extracted: false,
      },
    ];

    const existingMemory = {
      id: 33,
      userId: 15,
      content: "User bikes to work",
      prevContent: "User bikes to work",
      category: "ROUTINE",
      importance: 0.5,
      confidence: 0.8,
      action: "ADD",
      deleted: 0,
      createdAt: new Date("2025-09-01T08:00:00.000Z"),
      updatedAt: new Date("2025-09-01T08:00:00.000Z"),
      distance: 0.11,
    };

    const messageModule = await import("../src/message");
    const memoryModule = await import("../src/memory");
    const llmModule = await import("../src/llm");
    const dbModule = await import("../src/db/index");

    const listMessagesMock = vi
      .spyOn(messageModule, "listMessages")
      .mockResolvedValue(messages);
    const markMessagesExtractedMock = vi
      .spyOn(messageModule, "markMessagesExtracted")
      .mockResolvedValue(messages.length);

    const chatMock = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            facts: [
              {
                text: "User bikes to work every weekday morning",
                category: "ROUTINE",
                importance: 0.7,
                confidence: 0.95,
              },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            decisions: [
              {
                action: "UPDATE",
                fact_id: "F1",
                memory_id: "M1",
                combined_text: "User bikes to work every weekday morning",
              },
            ],
          }),
        },
      });

    vi.spyOn(llmModule, "getOllama").mockReturnValue({ chat: chatMock } as any);
    const embedTextsMock = vi
      .spyOn(llmModule, "embedTexts")
      .mockResolvedValue([[0.3, 0.4, 0.5]]);

    const searchSimilarMemoriesMock = vi
      .spyOn(memoryModule, "searchSimilarMemories")
      .mockResolvedValue([existingMemory as any]);
    const createMemoryMock = vi
      .spyOn(memoryModule, "createMemory")
      .mockResolvedValue(0);
    const updateMemoryMock = vi
      .spyOn(memoryModule, "updateMemory")
      .mockResolvedValue(true);

    vi.spyOn(dbModule.default, "transaction").mockImplementation(
      async (callback: () => unknown) => callback(),
    );

    const { runMemoryExtraction } = await import("../src/extraction");

    const result = await runMemoryExtraction({ userId: 15 });

    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(embedTextsMock).toHaveBeenCalledWith("ollama", [
      "User bikes to work every weekday morning",
    ]);
    expect(searchSimilarMemoriesMock).toHaveBeenCalledWith(
      "User bikes to work every weekday morning",
      expect.objectContaining({
        userId: 15,
        embedding: [0.3, 0.4, 0.5],
      }),
    );
    expect(createMemoryMock).not.toHaveBeenCalled();
    expect(updateMemoryMock).toHaveBeenCalledWith(
      33,
      expect.objectContaining({
        content: "User bikes to work every weekday morning",
        prevContent: "User bikes to work",
        action: "UPDATE",
        deleted: 0,
        category: "ROUTINE",
        importance: 0.7,
        confidence: 0.95,
      }),
      "ollama",
    );
    expect(markMessagesExtractedMock).toHaveBeenCalledWith([12], true);

    expect(result.createdMemoryIds).toEqual([]);
    expect(result.updatedMemoryIds).toEqual([33]);
    expect(result.decisions).toEqual([
      {
        action: "UPDATE",
        fact_id: "F1",
        memory_id: "M1",
        combined_text: "User bikes to work every weekday morning",
      },
    ]);
    expect(result.factContexts[0]?.fact.factId).toBe("F1");
    expect(result.labelToMemoryId["M1"]).toBe(33);
    expect(result.markedMessageCount).toBe(1);
  });

  test("handles mix of updates and additions for multiple facts", async () => {
    const createdAt = new Date("2025-10-30T12:00:00.000Z");
    const messages: Message[] = [
      {
        id: 20,
        userId: 21,
        role: "user",
        content: "I'm cycling to the office every weekday and painting landscapes at night.",
        createdAt,
        extracted: false,
      },
    ];

    const existingMemory = {
      id: 88,
      userId: 21,
      content: "User cycles to work",
      prevContent: "User cycles to work",
      category: "ROUTINE",
      importance: 0.5,
      confidence: 0.8,
      action: "ADD",
      deleted: 0,
      createdAt: new Date("2025-09-15T07:00:00.000Z"),
      updatedAt: new Date("2025-09-15T07:00:00.000Z"),
      distance: 0.13,
    };

    const messageModule = await import("../src/message");
    const memoryModule = await import("../src/memory");
    const llmModule = await import("../src/llm");
    const dbModule = await import("../src/db/index");

    const listMessagesMock = vi
      .spyOn(messageModule, "listMessages")
      .mockResolvedValue(messages);
    const markMessagesExtractedMock = vi
      .spyOn(messageModule, "markMessagesExtracted")
      .mockResolvedValue(messages.length);

    const chatMock = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            facts: [
              {
                text: "User cycles to the office every weekday",
                category: "ROUTINE",
                importance: 0.8,
                confidence: 0.95,
              },
              {
                text: "User paints landscapes at night",
                category: "OTHER",
                importance: 0.4,
                confidence: 0.85,
              },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            decisions: [
              {
                action: "UPDATE",
                fact_id: "F1",
                memory_id: "M1",
                combined_text: "User cycles to the office every weekday",
              },
              {
                action: "ADD",
                fact_id: "F2",
                memory_id: null,
                combined_text: null,
              },
            ],
          }),
        },
      });

    vi.spyOn(llmModule, "getOllama").mockReturnValue({ chat: chatMock } as any);
    const embedTextsMock = vi
      .spyOn(llmModule, "embedTexts")
      .mockResolvedValue([[0.5, 0.6, 0.7], [0.2, 0.3, 0.4]]);

    const searchSimilarMemoriesMock = vi
      .spyOn(memoryModule, "searchSimilarMemories")
      .mockResolvedValueOnce([existingMemory as any])
      .mockResolvedValueOnce([]);
    const createMemoryMock = vi
      .spyOn(memoryModule, "createMemory")
      .mockResolvedValue(144);
    const updateMemoryMock = vi
      .spyOn(memoryModule, "updateMemory")
      .mockResolvedValue(true);

    const transactionMock = vi
      .spyOn(dbModule.default, "transaction")
      .mockImplementation(async (callback: () => unknown) => callback());

    const { runMemoryExtraction } = await import("../src/extraction");

    const result = await runMemoryExtraction({ userId: 21 });

    expect(listMessagesMock).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(embedTextsMock).toHaveBeenCalledWith("ollama", [
      "User cycles to the office every weekday",
      "User paints landscapes at night",
    ]);
    expect(searchSimilarMemoriesMock).toHaveBeenCalledTimes(2);
    expect(searchSimilarMemoriesMock).toHaveBeenNthCalledWith(
      1,
      "User cycles to the office every weekday",
      expect.objectContaining({ embedding: [0.5, 0.6, 0.7] }),
    );
    expect(searchSimilarMemoriesMock).toHaveBeenNthCalledWith(
      2,
      "User paints landscapes at night",
      expect.objectContaining({ embedding: [0.2, 0.3, 0.4] }),
    );
    expect(updateMemoryMock).toHaveBeenCalledWith(
      88,
      expect.objectContaining({
        content: "User cycles to the office every weekday",
        prevContent: "User cycles to work",
        category: "ROUTINE",
        importance: 0.8,
        confidence: 0.95,
        action: "UPDATE",
        deleted: 0,
      }),
      "ollama",
    );
    expect(createMemoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 21,
        content: "User paints landscapes at night",
        category: "OTHER",
        importance: 0.4,
        confidence: 0.85,
        action: "ADD",
      }),
      "ollama",
    );
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(markMessagesExtractedMock).toHaveBeenCalledWith([20], true);

    expect(result.decisions).toEqual([
      {
        action: "UPDATE",
        fact_id: "F1",
        memory_id: "M1",
        combined_text: "User cycles to the office every weekday",
      },
      {
        action: "ADD",
        fact_id: "F2",
        memory_id: null,
        combined_text: null,
      },
    ]);
    expect(result.createdMemoryIds).toEqual([144]);
    expect(result.updatedMemoryIds).toEqual([88]);
    expect(result.factContexts).toHaveLength(2);
    expect(result.factContexts[0]?.similarMemoryLabels).toEqual(["M1"]);
    expect(result.factContexts[1]?.similarMemoryLabels).toEqual([]);
    expect(result.labelToMemoryId["M1"]).toBe(88);
    expect(result.markedMessageCount).toBe(1);
  });

  test("propagates errors from memory updates and avoids marking messages", async () => {
    const createdAt = new Date("2025-10-30T13:00:00.000Z");
    const messages: Message[] = [
      {
        id: 30,
        userId: 31,
        role: "user",
        content: "Please update that I now jog every evening.",
        createdAt,
        extracted: false,
      },
    ];

    const existingMemory = {
      id: 222,
      userId: 31,
      content: "User jogs on weekends",
      prevContent: "User jogs on weekends",
      category: "ROUTINE",
      importance: 0.4,
      confidence: 0.7,
      action: "ADD",
      deleted: 0,
      createdAt: new Date("2025-08-10T06:00:00.000Z"),
      updatedAt: new Date("2025-08-10T06:00:00.000Z"),
      distance: 0.09,
    };

    const messageModule = await import("../src/message");
    const memoryModule = await import("../src/memory");
    const llmModule = await import("../src/llm");
    const dbModule = await import("../src/db/index");

    vi.spyOn(messageModule, "listMessages").mockResolvedValue(messages);
    const markMessagesExtractedMock = vi
      .spyOn(messageModule, "markMessagesExtracted")
      .mockResolvedValue(messages.length);

    const chatMock = vi
      .fn()
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            facts: [
              {
                text: "User jogs every evening",
                category: "ROUTINE",
                importance: 0.7,
                confidence: 0.9,
              },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        message: {
          content: JSON.stringify({
            memory: [
              {
                id: "1",
                text: "User jogs every evening",
                event: "UPDATE",
              },
            ],
          }),
        },
      });

    vi.spyOn(llmModule, "getOllama").mockReturnValue({ chat: chatMock } as any);
    vi.spyOn(llmModule, "embedTexts").mockResolvedValue([[0.9, 0.8, 0.7]]);

    vi.spyOn(memoryModule, "searchSimilarMemories").mockResolvedValue([
      existingMemory as any,
    ]);
    vi.spyOn(memoryModule, "createMemory").mockResolvedValue(0);
    vi.spyOn(memoryModule, "updateMemory").mockResolvedValue(false);

    vi.spyOn(dbModule.default, "transaction").mockImplementation(
      async (callback: () => unknown) => callback(),
    );

    vi.spyOn(console, "error").mockImplementation(() => {});

    const { runMemoryExtraction } = await import("../src/extraction");

    await expect(runMemoryExtraction({ userId: 31 })).rejects.toThrow(
      "Memory extraction failed for user 31: Failed to update memory",
    );

    expect(markMessagesExtractedMock).not.toHaveBeenCalled();
  });
});
