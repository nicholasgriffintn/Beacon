import { Hono, type Context } from "hono";

import type { Env, FlagCreate, FlagUpdate, FlagEvaluationRequest, BulkFlagEvaluationRequest } from "../types";
import { FeatureFlagService } from "../services/feature-flag";

const flagsRouter = new Hono<{ Bindings: Env }>();

flagsRouter.get("/", async (c: Context) => {
  try {
    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const flags = await flagService.listFlags();
    return c.json(flags);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error listing feature flags" }, 500);
  }
});

flagsRouter.post("/", async (c: Context) => {
  try {
    let flagData: FlagCreate;
    try {
      flagData = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    if (!flagData.flag_key || !flagData.name) {
      return c.json({ error: "flag_key and name are required" }, 400);
    }

    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const flag = await flagService.createFlag(flagData);
    
    return c.json(flag, 201);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error creating feature flag" }, 500);
  }
});

flagsRouter.get("/:flagKey", async (c: Context) => {
  try {
    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const flag = await flagService.getFlag(c.req.param("flagKey"));
    
    if (!flag) {
      return c.json({ error: "Feature flag not found" }, 404);
    }
    
    return c.json(flag);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error getting feature flag" }, 500);
  }
});

flagsRouter.put("/:flagKey", async (c: Context) => {
  try {
    let updateData: FlagUpdate;
    try {
      updateData = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const flag = await flagService.updateFlag(c.req.param("flagKey"), updateData);
    
    if (!flag) {
      return c.json({ error: "Feature flag not found" }, 404);
    }
  
    return c.json(flag);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error updating feature flag" }, 500);
  }
});

flagsRouter.delete("/:flagKey", async (c: Context) => {
  try {
    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const deleted = await flagService.deleteFlag(c.req.param("flagKey"));
    
    if (!deleted) {
      return c.json({ error: "Feature flag not found" }, 404);
    }
    
    return c.json({ message: "Feature flag deleted successfully" });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error deleting feature flag" }, 500);
  }
});

flagsRouter.post("/:flagKey/resolve", async (c: Context) => {
  try {
    let evaluationRequest: FlagEvaluationRequest;
    try {
      const body = await c.req.json();
      evaluationRequest = {
        flag_key: c.req.param("flagKey"),
        user_id: body.user_id,
        attributes: body.attributes || {},
        default_value: body.default_value
      };
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    if (!evaluationRequest.user_id) {
      return c.json({ error: "user_id is required" }, 400);
    }

    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const evaluation = await flagService.evaluateFlag(evaluationRequest);
    
    return c.json(evaluation, 200, {
      "Cache-Control": "public, max-age=60", // 1 minute cache
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error evaluating feature flag" }, 500);
  }
});

flagsRouter.post("/resolve", async (c: Context) => {
  try {
    let bulkRequest: BulkFlagEvaluationRequest;
    try {
      bulkRequest = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    if (!bulkRequest.user_id) {
      return c.json({ error: "user_id is required" }, 400);
    }

    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const evaluations = await flagService.evaluateFlags(bulkRequest);
    
    return c.json(evaluations, 200, {
      "Cache-Control": "public, max-age=60", // 1 minute cache
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error evaluating feature flags" }, 500);
  }
});

export { flagsRouter };
