import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import type { Env, EventData } from "./types";
import { handleBatch } from "./services/batch";
import { handleEvent } from "./services/event";

const app = new Hono<{ Bindings: Env }>();

const origin = () => {
  return "*";
};

app.use(
  "*",
  cors({
    origin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
    ],
    credentials: true,
    maxAge: 86400,
  }),
);

app.post("/batch", async (c: Context) => {
  let batchData: EventData;
  try {
    batchData = await c.req.json();
  } catch (e) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const { success, processed, nextLastModifiedDate } = await handleBatch(c, batchData);

  return c.json(
    {
      success,
      processed
    },
    200,
    {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
      "Last-Modified": nextLastModifiedDate?.toUTCString() || "",
      Expires: "Mon, 01 Jan 1990 00:00:00 GMT",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    }
  );
});

app.post("/event", async (c: Context) => {
  let eventData: EventData;
  try {
    eventData = await c.req.json();
  } catch (e) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const { success, nextLastModifiedDate } = await handleEvent(c, eventData);

  return c.json(
    { success },
    200,
    {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
      "Last-Modified": nextLastModifiedDate?.toUTCString() || "",
      Expires: "Mon, 01 Jan 1990 00:00:00 GMT",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    }
  );
});

app.all("*", async (c: Context) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
};