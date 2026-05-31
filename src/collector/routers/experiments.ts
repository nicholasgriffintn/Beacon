import { Hono, type Context } from "hono";

import type { Env, ExperimentCreate, ExperimentUpdate } from "../types";
import { ExperimentService } from "../services/experiment";
import { ExperimentResultsService } from "../services/experiment-results";
import { publishCdnForMutation } from "../services/cdn-sync";
import { getCdnPublishHeaders, type CdnPublishResult } from "../utils/cdn-publish";
import { InputValidationError } from "../utils/errors";

const experimentsRouter = new Hono<{ Bindings: Env }>();

experimentsRouter.get("/", async (c: Context) => {
  try {
    const experimentService = new ExperimentService(c.env.DB);
    const experiments = await experimentService.listExperiments();
    return c.json(experiments);
  } catch (e) {
    console.error(e);
    return c.json({ error: "Error listing experiments" }, 500);
  }
});

experimentsRouter.post("/", async (c: Context) => {
  try {
    let experimentData: ExperimentCreate;
    try {
      experimentData = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const experimentService = new ExperimentService(c.env.DB);
    const experiment = await experimentService.createExperiment(experimentData);
    let cdnPublish: CdnPublishResult;
    try {
      cdnPublish = await publishCdnForMutation(c.env.DB, c.env.CDN_BUCKET, "experiment");
    } catch (publishError) {
      console.error("CDN publish failed after experiment create", publishError);
      return c.json({ error: "Experiment created but CDN publish failed", experiment }, 502);
    }
    
    return c.json(experiment, 201, getCdnPublishHeaders(cdnPublish));
  } catch (error) {
    console.error(error);
    if (error instanceof InputValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Error creating experiment" }, 500);
  }
});

experimentsRouter.get("/:id", async (c: Context) => {
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

experimentsRouter.put("/:id", async (c: Context) => {
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

    let cdnPublish: CdnPublishResult;
    try {
      cdnPublish = await publishCdnForMutation(c.env.DB, c.env.CDN_BUCKET, "experiment");
    } catch (publishError) {
      console.error("CDN publish failed after experiment update", publishError);
      return c.json({ error: "Experiment updated but CDN publish failed", experiment }, 502);
    }
  
    return c.json(experiment, 200, getCdnPublishHeaders(cdnPublish));
  } catch (error) {
    console.error(error);
    if (error instanceof InputValidationError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Error updating experiment" }, 500);
  }
});

experimentsRouter.post("/:id/results/refresh", async (c: Context) => {
  try {
    const experimentId = c.req.param("id");
    const resultsService = new ExperimentResultsService(c.env.DB, c.env.CDN_BUCKET, c.env.CACHE_KV);
    const results = await resultsService.generateResults(experimentId);

    if (!results) {
      return c.json({ error: "Experiment not found" }, 404);
    }

    return c.json({
      message: "Experiment results refreshed",
      results,
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error refreshing experiment results" }, 500);
  }
});

experimentsRouter.get("/:id/results", async (c: Context) => {
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

experimentsRouter.get("/:id/results/history", async (c: Context) => {
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

experimentsRouter.get("/:id/results/:timestamp", async (c: Context) => {
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

export { experimentsRouter };
