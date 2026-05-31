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

  const { success, processed, nextLastModifiedDate, error, status } = await handleBatch(c, batchData);

  if (!success) {
    const responseBody = {
      success,
      processed,
      error
    };

    if (status === 413) {
      return c.json(responseBody, 413);
    }

    if (status === 502) {
      return c.json(responseBody, 502);
    }

    return c.json(
      responseBody,
      400
    );
  }

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

  const { success, nextLastModifiedDate, error, status } = await handleEvent(c, eventData);

  if (!success) {
    const responseBody = {
      success,
      error
    };

    if (status === 502) {
      return c.json(responseBody, 502);
    }

    return c.json(
      responseBody,
      400
    );
  }

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
