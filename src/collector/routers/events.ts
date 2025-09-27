import { Hono, type Context } from "hono";

import type { Env, BatchEventData, EventData } from "../types";
import { handleBatch } from "../services/batch";
import { handleEvent } from "../services/event";

const eventsRouter = new Hono<{ Bindings: Env }>();

eventsRouter.post("/batch", async (c: Context) => {
  let batchData: BatchEventData;
  try {
    batchData = await c.req.json();
  } catch (e) {
    console.error(e);
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

eventsRouter.post("/collect", async (c: Context) => {
  let eventData: EventData;
  try {
    eventData = await c.req.json();
  } catch (e) {
    console.error(e);
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

export { eventsRouter };
