import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    status: "ok",
    message: "MAID - Memory-Augmented Intelligence Database",
    version: "0.0.1",
  });
});

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
};
