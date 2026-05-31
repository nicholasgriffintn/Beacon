import { Hono, type Context } from "hono";

import type { Env, FlagCreate, FlagUpdate } from "../types";
import { FeatureFlagService } from "../services/feature-flag";
import { publishCdnForMutation } from "../services/cdn-sync";
import { getCdnPublishHeaders, type CdnPublishResult } from "../utils/cdn-publish";
import { InputValidationError } from "../utils/errors";

const flagsRouter = new Hono<{ Bindings: Env }>();

flagsRouter.get("/", async (c: Context<{ Bindings: Env }>) => {
  try {
    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const flags = await flagService.listFlags();
    return c.json(flags);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error listing feature flags" }, 500);
  }
});

flagsRouter.post("/", async (c: Context<{ Bindings: Env }>) => {
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
    let cdnPublish: CdnPublishResult;
    try {
      cdnPublish = await publishCdnForMutation(c.env.DB, c.env.CDN_BUCKET, "flag");
    } catch (publishError) {
      console.error("CDN publish failed after feature flag create", publishError);
      return c.json({ error: "Feature flag created but CDN publish failed", flag }, 502);
    }
    
    return c.json(flag, 201, getCdnPublishHeaders(cdnPublish));
  } catch (error) {
    console.error(error);
    if (error instanceof InputValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Error creating feature flag" }, 500);
  }
});

flagsRouter.get("/:flagKey", async (c: Context<{ Bindings: Env }>) => {
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

flagsRouter.put("/:flagKey", async (c: Context<{ Bindings: Env }>) => {
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

    let cdnPublish: CdnPublishResult;
    try {
      cdnPublish = await publishCdnForMutation(c.env.DB, c.env.CDN_BUCKET, "flag");
    } catch (publishError) {
      console.error("CDN publish failed after feature flag update", publishError);
      return c.json({ error: "Feature flag updated but CDN publish failed", flag }, 502);
    }
  
    return c.json(flag, 200, getCdnPublishHeaders(cdnPublish));
  } catch (error) {
    console.error(error);
    if (error instanceof InputValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Error updating feature flag" }, 500);
  }
});

flagsRouter.delete("/:flagKey", async (c: Context<{ Bindings: Env }>) => {
  try {
    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const deleted = await flagService.deleteFlag(c.req.param("flagKey"));
    
    if (!deleted) {
      return c.json({ error: "Feature flag not found" }, 404);
    }

    let cdnPublish: CdnPublishResult;
    try {
      cdnPublish = await publishCdnForMutation(c.env.DB, c.env.CDN_BUCKET, "flag");
    } catch (publishError) {
      console.error("CDN publish failed after feature flag delete", publishError);
      return c.json({ error: "Feature flag deleted but CDN publish failed" }, 502);
    }
    
    return c.json(
      { message: "Feature flag deleted successfully" },
      200,
      getCdnPublishHeaders(cdnPublish),
    );
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error deleting feature flag" }, 500);
  }
});

export { flagsRouter };
