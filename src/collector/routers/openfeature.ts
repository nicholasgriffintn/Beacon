import { Hono, type Context } from "hono";

import { OpenFeatureService } from "../services/openfeature";
import { handleEvent } from "../services/event";
import type { Env, OpenFeatureEvaluationRequest, OpenFeatureTrackingRequest } from "../types";
import { createOpenFeatureTrackingEvent } from "../utils/openfeature";

const openFeatureRouter = new Hono<{ Bindings: Env }>();

openFeatureRouter.get("/provider/metadata", async (c: Context) => {
  return c.json({
    name: "beacon",
  });
});

openFeatureRouter.get("/provider/status", async (c: Context) => {
  return c.json({
    status: "READY",
  });
});

openFeatureRouter.post("/evaluate", async (c: Context<{ Bindings: Env }>) => {
  try {
    let request: OpenFeatureEvaluationRequest;
    try {
      request = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const service = new OpenFeatureService(c.env.DB, c.env.CACHE_KV);
    return c.json(await service.evaluate(request));
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error evaluating flag" }, 500);
  }
});

openFeatureRouter.post("/track", async (c: Context<{ Bindings: Env }>) => {
  try {
    let request: OpenFeatureTrackingRequest;
    try {
      request = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    if (!request.trackingEventName) {
      return c.json({ error: "trackingEventName is required" }, 400);
    }

    const eventData = createOpenFeatureTrackingEvent(request);
    if (!eventData) {
      return c.json({ error: "context.siteId and context.targetingKey are required" }, 400);
    }

    const result = await handleEvent(c, eventData);
    if (!result.success) {
      if (result.status === 502) {
        return c.json({ accepted: false, error: result.error }, 502);
      }

      return c.json({ accepted: false, error: result.error }, 400);
    }

    return c.json({ accepted: true }, 202);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error tracking event" }, 500);
  }
});

export { openFeatureRouter };
