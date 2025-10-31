import { Hono } from "hono";
import memoryRoutes from "./routes/memory";
import messageRoutes from "./routes/messages";
import extractionRoutes from "./routes/extraction";

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "MAID - Memory-Augmented Intelligence Database",
    version: "0.0.1",
  });
});

// Register API routes
app.route("/api/memories", memoryRoutes);
app.route("/api/messages", messageRoutes);
app.route("/api/extraction", extractionRoutes);

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
};
