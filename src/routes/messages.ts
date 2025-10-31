import { Hono, Context } from "hono";
import { z } from "zod";
import {
  createMessage,
  createMessages,
  getMessage,
  listMessages,
  updateMessage,
  deleteMessage,
  deleteMessages,
  markMessagesExtracted,
  type CreateMessageInput,
  type UpdateMessageInput,
  type ListMessagesOptions,
} from "../message";

const app = new Hono();

// Schema validators
const createMessageSchema = z.object({
  userId: z.number(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  extracted: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

const updateMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]).optional(),
  content: z.string().optional(),
  extracted: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

// POST /api/messages - Create a single message
app.post("/", async (c: Context) => {
  try {
    const body = await c.req.json();
    const input = createMessageSchema.parse(body);

    const messageId = await createMessage(input as CreateMessageInput);
    const message = await getMessage(messageId);

    return c.json({ success: true, data: message }, 201);
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create message"
    }, 400);
  }
});

// POST /api/messages/batch - Create multiple messages
app.post("/batch", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { messages } = z.object({
      messages: z.array(createMessageSchema),
    }).parse(body);

    const messageIds = await createMessages(messages as CreateMessageInput[]);

    // Fetch all created messages
    const createdMessages = await Promise.all(
      messageIds.map(id => getMessage(id))
    );

    return c.json({ success: true, data: createdMessages }, 201);
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to create messages"
    }, 400);
  }
});

// GET /api/messages - List messages with filtering
app.get("/", async (c: Context) => {
  try {
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");
    const offset = c.req.query("offset");
    const role = c.req.query("role");
    const extracted = c.req.query("extracted");
    const search = c.req.query("search");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");
    const orderBy = c.req.query("orderBy");
    const orderDirection = c.req.query("orderDirection");

    const options: ListMessagesOptions = {
      ...(userId && { userId: parseInt(userId) }),
      ...(limit && { limit: parseInt(limit) }),
      ...(offset && { offset: parseInt(offset) }),
      ...(role && { roles: [role as "user" | "assistant" | "system"] }),
      ...(extracted !== undefined && { extracted: extracted === "true" }),
      ...(search && { search }),
      ...(startDate && { startDate: new Date(startDate) }),
      ...(endDate && { endDate: new Date(endDate) }),
      ...(orderBy && { orderBy: orderBy as any }),
      ...(orderDirection && { orderDirection: orderDirection as any }),
    };

    const messages = await listMessages(options);
    return c.json({ success: true, data: messages });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to list messages"
    }, 400);
  }
});

// GET /api/messages/:id - Get a single message by ID
app.get("/:id", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    const message = await getMessage(id);

    if (!message) {
      return c.json({ success: false, error: "Message not found" }, 404);
    }

    return c.json({ success: true, data: message });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get message"
    }, 400);
  }
});

// PUT /api/messages/:id - Update a message
app.put("/:id", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const updates = updateMessageSchema.parse(body);

    await updateMessage(id, updates as UpdateMessageInput);
    const updated = await getMessage(id);

    return c.json({ success: true, data: updated });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update message"
    }, 400);
  }
});

// DELETE /api/messages/:id - Delete a single message
app.delete("/:id", async (c: Context) => {
  try {
    const id = parseInt(c.req.param("id"));
    await deleteMessage(id);

    return c.json({ success: true, message: "Message deleted" });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete message"
    }, 400);
  }
});

// POST /api/messages/bulk-delete - Delete multiple messages
app.post("/bulk-delete", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { messageIds } = z.object({
      messageIds: z.array(z.number()),
    }).parse(body);

    await deleteMessages(messageIds);

    return c.json({ success: true, message: `${messageIds.length} messages deleted` });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to bulk delete messages"
    }, 400);
  }
});

// POST /api/messages/mark-extracted - Mark messages as extracted/unextracted
app.post("/mark-extracted", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { messageIds, extracted } = z.object({
      messageIds: z.array(z.number()),
      extracted: z.boolean().default(true),
    }).parse(body);

    await markMessagesExtracted(messageIds, extracted);

    return c.json({
      success: true,
      message: `${messageIds.length} messages marked as ${extracted ? "extracted" : "unextracted"}`
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to mark messages as extracted"
    }, 400);
  }
});

// GET /api/messages/unextracted - Get unextracted messages for a user
app.get("/unextracted", async (c: Context) => {
  try {
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");

    if (!userId) {
      return c.json({ success: false, error: "userId query parameter is required" }, 400);
    }

    const options: ListMessagesOptions = {
      userId: parseInt(userId),
      extracted: false,
      ...(limit && { limit: parseInt(limit) }),
    };

    const messages = await listMessages(options);
    return c.json({ success: true, data: messages });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get unextracted messages"
    }, 400);
  }
});

// GET /api/messages/by-role/:role - Get messages by role
app.get("/by-role/:role", async (c: Context) => {
  try {
    const role = c.req.param("role");
    const userId = c.req.query("userId");
    const limit = c.req.query("limit");
    const offset = c.req.query("offset");

    if (!["user", "assistant", "system"].includes(role)) {
      return c.json({ success: false, error: "Invalid role. Must be user, assistant, or system" }, 400);
    }

    const options: ListMessagesOptions = {
      ...(userId && { userId: parseInt(userId) }),
      roles: [role as "user" | "assistant" | "system"],
      ...(limit && { limit: parseInt(limit) }),
      ...(offset && { offset: parseInt(offset) }),
    };

    const messages = await listMessages(options);
    return c.json({ success: true, data: messages });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to get messages by role"
    }, 400);
  }
});

export default app;
