import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import type { Env, EventData, ExperimentCreate, ExperimentUpdate, UserContext, SiteCreate, SiteUpdate, FlagCreate, FlagUpdate, FlagEvaluationRequest, BulkFlagEvaluationRequest } from "./types";
import { handleBatch } from "./services/batch";
import { handleEvent } from "./services/event";
import { ExperimentService } from "./services/experiment";
import { SiteService } from "./services/site";
import { CDNPublisher } from "./services/cdn-publisher";
import { FeatureFlagService } from "./services/feature-flag";
import { createMiddleware } from "./utils/middleware";

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

app.use("*", createMiddleware());

app.post("/api/events/batch", async (c: Context) => {
  let batchData: EventData;
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

app.post("/api/events/collect", async (c: Context) => {
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

app.get("/api/experiments", async (c: Context) => {
  try {
    const experimentService = new ExperimentService(c.env.DB);
    const experiments = await experimentService.listExperiments();
    return c.json(experiments);
  } catch (e) {
    console.error(e);
    return c.json({ error: "Error listing experiments" }, 500);
  }
});

app.post("/api/experiments", async (c: Context) => {
  try {
    let experimentData: ExperimentCreate;
    try {
      experimentData = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const experimentService = new ExperimentService(c.env.DB);
    const experiment = await experimentService.createExperiment(experimentData);
    
    return c.json(experiment, 201);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error creating experiment" }, 500);
  }
});

app.get("/api/experiments/:id", async (c: Context) => {
  try {
    const experimentService = new ExperimentService(c.env.DB);
    const experiment = await experimentService.getExperiment(c.req.param("id"));
    
    if (!experiment) {
      return c.json({ error: "Experiment not found" }, 404);
    }
    
    return c.json(experiment);
  } catch (e) {
    console.error(e);
    return c.json({ error: "Error getting experiment" }, 500);
  }
});

app.put("/api/experiments/:id", async (c: Context) => {
  try {
    let updateData: ExperimentUpdate;
    try {
      updateData = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const experimentService = new ExperimentService(c.env.DB);
    const experiment = await experimentService.updateExperiment(c.req.param("id"), updateData);
    
    if (!experiment) {
      return c.json({ error: "Experiment not found" }, 404);
    }
  
    return c.json(experiment);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error updating experiment" }, 500);
  }
});

app.post("/api/experiments/:id/assign", async (c: Context) => {
  try {
    let userContext: UserContext;
    try {
      userContext = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    if (!userContext.user_id) {
      return c.json({ error: "user_id is required" }, 400);
    }

    const experimentService = new ExperimentService(c.env.DB);
    const assignment = await experimentService.assignVariant(c.req.param("id"), userContext);
    
    if (!assignment) {
      return c.json({ error: "No variant assigned" }, 404);
    }
    
    return c.json(assignment);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error assigning variant" }, 500);
  }
});

app.get("/api/sites", async (c: Context) => {
  try {
    const siteService = new SiteService(c.env.DB, c.env.CACHE_KV);
    const sites = await siteService.listSites();
    return c.json(sites);
  } catch (e) {
    console.error(e);
    return c.json({ error: "Error listing sites" }, 500);
  }
});

app.post("/api/sites", async (c: Context) => {
  try {
    let siteData: SiteCreate;
    try {
      siteData = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    if (!siteData.site_id || !siteData.name || !siteData.domains || !Array.isArray(siteData.domains)) {
      return c.json({ error: "site_id, name, and domains are required" }, 400);
    }

    const siteService = new SiteService(c.env.DB, c.env.CACHE_KV);
    const site = await siteService.createSite(siteData);
    
    return c.json(site, 201);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error creating site" }, 500);
  }
});

app.get("/api/sites/:siteId", async (c: Context) => {
  try {
    const siteService = new SiteService(c.env.DB, c.env.CACHE_KV);
    const site = await siteService.getSite(c.req.param("siteId"));
    
    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }
    
    return c.json(site);
  } catch (e) {
    console.error(e);
    return c.json({ error: "Error getting site" }, 500);
  }
});

app.put("/api/sites/:siteId", async (c: Context) => {
  try {
    let updateData: SiteUpdate;
    try {
      updateData = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const siteService = new SiteService(c.env.DB, c.env.CACHE_KV);
    const site = await siteService.updateSite(c.req.param("siteId"), updateData);
    
    if (!site) {
      return c.json({ error: "Site not found" }, 404);
    }
  
    return c.json(site);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error updating site" }, 500);
  }
});

app.delete("/api/sites/:siteId", async (c: Context) => {
  try {
    const siteService = new SiteService(c.env.DB, c.env.CACHE_KV);
    const deleted = await siteService.deleteSite(c.req.param("siteId"));
    
    if (!deleted) {
      return c.json({ error: "Site not found" }, 404);
    }
    
    return c.json({ message: "Site deleted successfully" });
  } catch (e) {
    console.error(e);
    return c.json({ error: "Error deleting site" }, 500);
  }
});

app.post("/api/admin/publish/experiments", async (c: Context) => {
  try {
    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const result = await publisher.publishExperiments();
    
    return c.json({
      message: "Experiments published successfully",
      ...result
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error publishing experiments" }, 500);
  }
});

app.post("/api/admin/publish/sites", async (c: Context) => {
  try {
    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const result = await publisher.publishSites();
    
    return c.json({
      message: "Sites published successfully",
      ...result
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error publishing sites" }, 500);
  }
});

app.post("/api/admin/publish/all", async (c: Context) => {
  try {
    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const results = await publisher.publishAll();
    
    return c.json({
      message: "All definitions published successfully",
      ...results
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error publishing definitions" }, 500);
  }
});

app.get("/api/cdn/experiments/info", async (c: Context) => {
  try {
    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const info = await publisher.getPublishedInfo('experiments');
    
    if (!info) {
      return c.json({ error: "No published experiments found" }, 404);
    }
    
    return c.json(info);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error getting experiment info" }, 500);
  }
});

app.get("/api/cdn/sites/info", async (c: Context) => {
  try {
    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const info = await publisher.getPublishedInfo('sites');
    
    if (!info) {
      return c.json({ error: "No published sites found" }, 404);
    }
    
    return c.json(info);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error getting sites info" }, 500);
  }
});

app.get("/api/cdn/:type/versions", async (c: Context) => {
  try {
    const type = c.req.param("type");
    if (type !== 'experiments' && type !== 'sites') {
      return c.json({ error: "Invalid type. Must be 'experiments' or 'sites'" }, 400);
    }

    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const versions = await publisher.listVersions(type);
    
    return c.json({ type, versions });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error listing versions" }, 500);
  }
});

app.get("/api/experiments/:id/results", async (c: Context) => {
  try {
    const experimentId = c.req.param("id");
    const cacheKey = `experiment_results:${experimentId}`;
    
    const cached = await c.env.CACHE_KV.get(cacheKey, "json");
    if (cached) {
      return c.json(cached, 200, {
        "Cache-Control": "public, max-age=1800", // 30 minutes
        "X-Cache": "HIT"
      });
    }
    
    try {
      const resultsObject = await c.env.CDN_BUCKET.get(`experiment-results/${experimentId}/latest.json`);
      if (!resultsObject) {
        return c.json({ error: "No results available for this experiment" }, 404);
      }
      
      const results = await resultsObject.json();
      
      await c.env.CACHE_KV.put(cacheKey, JSON.stringify(results), { expirationTtl: 1800 });
      
      return c.json(results, 200, {
        "Cache-Control": "public, max-age=1800",
        "X-Cache": "MISS",
        "Last-Modified": resultsObject.uploaded?.toUTCString() || new Date().toUTCString()
      });
    } catch (r2Error) {
      console.error("R2 fetch error:", r2Error);
      return c.json({ error: "Results temporarily unavailable" }, 503);
    }
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error fetching experiment results" }, 500);
  }
});

app.get("/api/experiments/:id/results/history", async (c: Context) => {
  try {
    const experimentId = c.req.param("id");
    const limit = parseInt(c.req.query("limit") || "10");
    
    const list = await c.env.CDN_BUCKET.list({ 
      prefix: `experiment-results/${experimentId}/`,
      limit: Math.min(limit, 50) // Cap at 50
    });
    
    const history = await Promise.all(
      list.objects
        .filter((obj: Record<string, any>) => !obj.key.endsWith('latest.json'))
        .sort((a: Record<string, any>, b: Record<string, any>) => (b.uploaded?.getTime() || 0) - (a.uploaded?.getTime() || 0))
        .slice(0, limit)
        .map(async (obj: Record<string, any>) => {
          const timestamp = obj.key.split('/').pop()?.replace('.json', '');
          return {
            timestamp,
            uploaded: obj.uploaded?.toISOString(),
            size: obj.size,
            url: `${c.req.url.split('/api/')[0]}/api/experiments/${experimentId}/results/${timestamp}`
          };
        })
    );
    
    return c.json({
      experiment_id: experimentId,
      total_results: list.objects.length,
      history
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error fetching results history" }, 500);
  }
});

app.get("/api/experiments/:id/results/:timestamp", async (c: Context) => {
  try {
    const experimentId = c.req.param("id");
    const timestamp = c.req.param("timestamp");
    
    if (!/^\d{8}_\d{6}$/.test(timestamp)) {
      return c.json({ error: "Invalid timestamp format. Expected: YYYYMMDD_HHMMSS" }, 400);
    }
    
    const resultsObject = await c.env.CDN_BUCKET.get(`experiment-results/${experimentId}/${timestamp}.json`);
    if (!resultsObject) {
      return c.json({ error: "Results not found for the specified timestamp" }, 404);
    }
    
    const results = await resultsObject.json();
    
    return c.json(results, 200, {
      "Cache-Control": "public, max-age=86400", // 1 day for historical data
      "Last-Modified": resultsObject.uploaded?.toUTCString() || new Date().toUTCString()
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error fetching historical results" }, 500);
  }
});

// Feature flags endpoints
app.get("/api/flags", async (c: Context) => {
  try {
    const flagService = new FeatureFlagService(c.env.DB, c.env.CACHE_KV);
    const flags = await flagService.listFlags();
    return c.json(flags);
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error listing feature flags" }, 500);
  }
});

app.post("/api/flags", async (c: Context) => {
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

app.get("/api/flags/:flagKey", async (c: Context) => {
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

app.put("/api/flags/:flagKey", async (c: Context) => {
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

app.delete("/api/flags/:flagKey", async (c: Context) => {
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

app.post("/api/flags/:flagKey/resolve", async (c: Context) => {
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

app.post("/api/flags/resolve", async (c: Context) => {
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

app.get("*", async (c: Context) => {
  return c.json({
    status: 404,
    message: "Not Found",
  }, 404);
});

export default app;