import "dotenv/config";

import { Hono } from "hono";
import db from "./db";
import { test } from "./db/schema";

const app = new Hono();

app.get("/", (c) => {
  // sync mode
  const { id } = db.insert(test).values({}).returning().get();
  return c.text("Hello Hono! " + id);
});

export default {
  port: process.env.PORT!,
  fetch: app.fetch,
};
