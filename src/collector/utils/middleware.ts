import type { Context } from "hono";

import { SiteService } from "../services/site";
import type { Env } from "../types";
import { hasValidApiKey, isProtectedManagementPath } from "./auth";
import { getOriginFromHeaders } from "./domains";
import { checkRequestRateLimit, type RateLimitResult } from "./rate-limit";

const MAX_BATCH_EVENTS = 100;

function rateLimitedResponse(c: Context, result: RateLimitResult) {
  return c.json({ error: "Rate limit exceeded" }, 429, {
    "Retry-After": String(result.resetSeconds),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
  });
}

function getExperimentAssignmentScope(path: string): string | null {
  const match = /^\/api\/experiments\/([^/]+)\/assign$/.exec(path);
  return match?.[1] ? `experiment:${match[1]}` : null;
}

function getFlagEvaluationScope(path: string): string | null {
  if (path === "/api/flags/resolve") {
    return "flags:bulk";
  }

  const match = /^\/api\/flags\/([^/]+)\/resolve$/.exec(path);
  return match?.[1] ? `flag:${match[1]}` : null;
}

export async function validateSite(c: Context<{ Bindings: Env }>, siteId: string): Promise<{ valid: boolean; error?: string }> {
  if (!siteId) {
    return { valid: false, error: "Site ID is required" };
  }

  const siteService = new SiteService(c.env.DB, c.env.CACHE_KV);
  const refererUrl = getOriginFromHeaders(c.req.raw.headers);
  
  const validation = await siteService.validateSiteAndDomain(siteId, refererUrl || undefined);
  
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }

  return { valid: true };
}

export function createMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    const path = c.req.path;
    const method = c.req.method;

    if (isProtectedManagementPath(method, path)) {
      if (!hasValidApiKey(c)) {
        return c.json({ error: "A valid API key is required for this endpoint" }, 403);
      }

      return next();
    }

    const evaluationScope = getExperimentAssignmentScope(path) || getFlagEvaluationScope(path);
    if (method === "POST" && evaluationScope) {
      const rateLimit = await checkRequestRateLimit(c, "evaluations", evaluationScope);
      if (!rateLimit.allowed) {
        return rateLimitedResponse(c, rateLimit);
      }
    }

    const isEventsApi = path.startsWith("/api/events/");

    if (!isEventsApi) {
      await next();
      return;
    }

    let requestData: { siteId?: string; s?: string; [key: string]: unknown };
    try {
      const clonedRequest = c.req.raw.clone();
      requestData = await clonedRequest.json();
    } catch {
      return c.json({ error: "Invalid JSON payload" }, 400);
    }

    const siteId = requestData.siteId || requestData.s;
    const batchEvents = Array.isArray(requestData.events) ? requestData.events : null;

    if (!siteId) {
      return c.json({ error: "Site ID is required" }, 400);
    }

    if (batchEvents && batchEvents.length > MAX_BATCH_EVENTS) {
      return c.json({ error: `Batch size cannot exceed ${MAX_BATCH_EVENTS} events` }, 413);
    }

    const rateLimit = await checkRequestRateLimit(c, "events", String(siteId));
    if (!rateLimit.allowed) {
      return rateLimitedResponse(c, rateLimit);
    }
    
    const validation = await validateSite(c, siteId);
    
    if (!validation.valid) {
      console.warn(`Site validation failed for siteId: ${siteId}, error: ${validation.error}`);
      return c.json({ 
        error: "Site validation failed",
      }, 403);
    }

    await next();
  };
}
