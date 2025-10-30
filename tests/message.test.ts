import { describe, test, expect, vi, afterEach } from "bun:test";

import {
  createMessage,
  createMessages,
  listMessages,
  markMessagesExtracted,
  deleteMessages,
} from "../src/message";
import { messages } from "../src/db/schema";
import { createMockDb } from "./helpers/mockDb";
import type { Message } from "../src/message";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("message helpers", () => {
  test("createMessage inserts a row and returns it", async () => {
    const client = createMockDb();
    const record: Message = {
      id: 1,
      userId: 42,
      role: "user",
      content: "hello",
      extracted: false,
      metadata: null,
      createdAt: new Date(),
    };

    client.setInsertReturnValue([record]);

    const result = await createMessage(
      { userId: 42, role: "user", content: "hello" },
      client,
    );

    expect(result).toBe(record);
    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(client.__calls.insertCalls[0]?.values).toMatchObject({
      userId: 42,
      role: "user",
      content: "hello",
    });
  });

  test("createMessage throws when insert returns nothing", async () => {
    const client = createMockDb();
    client.setInsertReturnValue([]);

    expect(
      createMessage({ userId: 1, role: "assistant", content: "oops" }, client),
    ).rejects.toThrow("Failed to create message");
  });

  test("createMessages performs bulk insert", async () => {
    const client = createMockDb();
    const records: Message[] = [
      {
        id: 11,
        userId: 7,
        role: "user",
        content: "a",
        extracted: false,
        metadata: null,
        createdAt: new Date(),
      },
      {
        id: 12,
        userId: 7,
        role: "assistant",
        content: "b",
        extracted: true,
        metadata: null,
        createdAt: new Date(),
      },
    ];

    client.setInsertReturnValue(records);

    const result = await createMessages(
      [
        { userId: 7, role: "user", content: "a" },
        { userId: 7, role: "assistant", content: "b", extracted: true },
      ],
      client,
    );

    expect(result).toBe(records);
    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(client.__calls.insertCalls[0]?.values).toHaveLength(2);
  });

  test("listMessages applies filters and ordering", async () => {
    const created = new Date();
    const selectRecords: Message[] = [
      {
        id: 99,
        userId: 8,
        role: "assistant",
        content: "filtered",
        extracted: true,
        metadata: null,
        createdAt: created,
      },
    ];
    const client = createMockDb(selectRecords);

    const result = await listMessages(
      {
        userId: 8,
        roles: ["assistant", "system"],
        extracted: true,
        search: "filter",
        limit: 20,
        offset: 5,
        orderBy: "id",
        orderDir: "asc",
      },
      client,
    );

    const expected: Message[] = [
      {
        id: 99,
        userId: 8,
        role: "assistant",
        content: "filtered",
        extracted: true,
        metadata: null,
        createdAt: created,
      },
    ];

    expect(result).toEqual(expected);

    expect(client.select).toHaveBeenCalledTimes(1);
    const state = client.__calls.selectStates[0];
    expect(state.from).toBe(messages);
    expect(state.conditions).toHaveLength(1);
    expect(state.conditions[0]).toBeTruthy();
    expect(state.orderings).toHaveLength(1);
    expect(state.limit).toBe(20);
    expect(state.offset).toBe(5);
  });

  test("markMessagesExtracted updates extracted flag", async () => {
    const client = createMockDb();
    client.setUpdateReturnValue([{ id: 1 }, { id: 2 }]);

    const updated = await markMessagesExtracted([1, 2], false, client);

    expect(updated).toBe(2);
    expect(client.update).toHaveBeenCalledTimes(1);
    expect(client.__calls.updateCalls[0]?.updates).toEqual({
      extracted: false,
    });
  });

  test("deleteMessages short-circuits on empty ids", async () => {
    const client = createMockDb();

    const deleted = await deleteMessages([], client);

    expect(deleted).toBe(0);
    expect(client.delete).not.toHaveBeenCalled();
  });

  test("deleteMessages returns number of deleted rows", async () => {
    const client = createMockDb();
    client.setDeleteReturnValue([{ id: 55 }]);

    const deleted = await deleteMessages([55], client);

    expect(deleted).toBe(1);
    expect(client.delete).toHaveBeenCalledTimes(1);
  });
});
