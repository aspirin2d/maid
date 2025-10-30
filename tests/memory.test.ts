import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
  vi,
} from "bun:test";

import { createMockDb } from "./helpers/mockDb";
import type { Memory } from "../src/memory";

describe("memory helpers", () => {
  let dbMock: any;

  beforeEach(() => {
    dbMock = createMockDb();
    mock.module("../src/db/index", () => ({
      __esModule: true,
      default: dbMock,
    }));
  });

  afterEach(async () => {
    const module = await import("../src/memory");
    module.resetEmbedTextImplementation();
    vi.restoreAllMocks();
  });

  test("createMemory inserts record and upserts embedding", async () => {
    const embedStub = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const { createMemory, setEmbedTextImplementation } = await import(
      "../src/memory"
    );

    dbMock.setInsertReturnValue([{ id: 101 }]);
    setEmbedTextImplementation(embedStub);

    const id = await createMemory(
      { userId: 7, content: "Remember me" },
      "openai",
    );

    expect(id).toBe(101);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.__calls.insertCalls[0]?.values).toMatchObject({
      userId: 7,
      content: "Remember me",
      action: "ADD",
      deleted: 0,
    });
    expect(embedStub).toHaveBeenCalledWith("openai", "Remember me");
    expect(dbMock.run).toHaveBeenCalledTimes(2);
  });

  test("createMemories returns ids and only embeds when content exists", async () => {
    const embedStub = vi.fn().mockResolvedValue([0.4, 0.5, 0.6]);
    const { createMemories, setEmbedTextImplementation } = await import(
      "../src/memory"
    );

    dbMock.setInsertReturnValue([{ id: 201 }, { id: 202 }]);
    setEmbedTextImplementation(embedStub);

    const ids = await createMemories(
      [
        { userId: 9, content: "first" },
        { userId: 9, content: "" },
      ],
      "ollama",
    );

    expect(ids).toEqual([201, 202]);
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.__calls.insertCalls[0]?.values).toHaveLength(2);
    expect(embedStub).toHaveBeenCalledTimes(1);
    expect(embedStub).toHaveBeenCalledWith("ollama", "first");
    expect(dbMock.run).toHaveBeenCalledTimes(2);
  });

  test("updateMemory regenerates embedding when content changes", async () => {
    const embedStub = vi.fn().mockResolvedValue([0.7, 0.8, 0.9]);
    const { updateMemory, setEmbedTextImplementation } = await import(
      "../src/memory"
    );

    dbMock.setUpdateReturnValue([{ id: 301 }]);
    setEmbedTextImplementation(embedStub);

    const result = await updateMemory(301, { content: "updated" }, "openai");

    expect(result).toBe(true);
    expect(dbMock.update).toHaveBeenCalledTimes(1);
    const updateCall = dbMock.__calls.updateCalls[0];
    expect(updateCall.updates).toMatchObject({ content: "updated" });
    expect(updateCall.updates.updatedAt).toBeInstanceOf(Date);
    expect(embedStub).toHaveBeenCalledWith("openai", "updated");
    expect(dbMock.run).toHaveBeenCalledTimes(2);
  });

  test("createMemory throws when insert fails", async () => {
    const embedStub = vi.fn();
    const { createMemory, setEmbedTextImplementation } = await import(
      "../src/memory"
    );

    dbMock.setInsertReturnValue([]);
    setEmbedTextImplementation(embedStub);

    expect(
      createMemory({ userId: 5, content: "should fail" }, "ollama"),
    ).rejects.toThrow("Failed to create memory");

    expect(embedStub).not.toHaveBeenCalled();
    expect(dbMock.run).not.toHaveBeenCalled();
  });

  test("searchSimilarMemories uses embeddings and returns db results", async () => {
    const embedStub = vi.fn().mockResolvedValue([1, 2, 3]);
    const { searchSimilarMemories, setEmbedTextImplementation } = await import(
      "../src/memory"
    );

    const now = new Date();
    const records: Array<Memory & { distance: number }> = [
      {
        id: 1,
        userId: 4,
        content: "match",
        prevContent: null,
        action: "ADD",
        deleted: 0,
        createdAt: now,
        updatedAt: now,
        distance: 0.12,
      },
    ];

    dbMock.setSelectResult(records);
    setEmbedTextImplementation(embedStub);

    const result = await searchSimilarMemories("find", {
      userId: 4,
      limit: 5,
      provider: "ollama",
      includeDeleted: true,
    });

    expect(embedStub).toHaveBeenCalledWith("ollama", "find");
    expect(dbMock.all).toHaveBeenCalledTimes(1);
    expect(result).toBe(records);
  });
});
