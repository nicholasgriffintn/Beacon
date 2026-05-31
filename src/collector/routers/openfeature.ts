import { Hono, type Context } from "hono";

import { OpenFeatureService } from "../services/openfeature";
import { handleEvent } from "../services/event";
import type { Env, OpenFeatureEvaluationRequest, OpenFeatureTrackingRequest } from "../types";
import { parseOpenFeatureBootstrapRequest } from "../utils/openfeature-bootstrap";
import { createOpenFeatureEvaluationEvent, createOpenFeatureTrackingEvent } from "../utils/openfeature";

const openFeatureRouter = new Hono<{ Bindings: Env }>();
const MAX_BOOTSTRAP_EVALUATIONS = 25;

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

openFeatureRouter.post("/bootstrap", async (c: Context<{ Bindings: Env }>) => {
  try {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const parsed = parseOpenFeatureBootstrapRequest(body, MAX_BOOTSTRAP_EVALUATIONS);
    if (parsed.error) {
      return c.json({ error: parsed.error.message }, parsed.error.status);
    }
    if (!parsed.request) {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const service = new OpenFeatureService(c.env.DB, c.env.CACHE_KV);
    const response = await service.bootstrap(parsed.request);

    await Promise.all(
      Object.values(response.evaluations).map(async details => {
        const eventData = createOpenFeatureEvaluationEvent(details, response.context);
        if (!eventData) {
          return;
        }

        const result = await handleEvent(c, eventData);
        if (!result.success) {
          console.error("Failed to record OpenFeature bootstrap exposure", result.error);
        }
      }),
    );

    return c.json(response);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error bootstrapping flags" }, 500);
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
