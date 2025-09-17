import type { Context } from "hono";

import { SiteService } from "../services/site";

export async function validateSite(c: Context, siteId: string): Promise<{ valid: boolean; error?: string }> {
  if (!siteId) {
    return { valid: false, error: "Site ID is required" };
  }

  const siteService = new SiteService(c.env.DB, c.env.CACHE_KV);
  const refererUrl = c.req.header("referer") || c.req.header("origin");
  
  const validation = await siteService.validateSiteAndDomain(siteId, refererUrl);
  
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }

  return { valid: true };
}

export function createMiddleware() {
  return async (c: Context, next: () => Promise<void>) => {
    const path = c.req.path;

    const isAdminApi = path.includes('/api/admin/');

    if (isAdminApi) {
      const apiKeyHeader = c.req.header('X-API-Key');

      if (!apiKeyHeader) {
        return c.json({error: "An api key is required for this endpoint"}, 403)
      }

      // TODO: Validate API key against a secret value - potentially site specific
      return next();
    }

    const isEventsApi = path.includes('/api/events/');

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

    if (!siteId) {
      return c.json({ error: "Site ID is required" }, 400);
    }
    
    const validation = await validateSite(c, siteId);
    
    if (!validation.valid) {
      console.warn(`Site validation failed for siteId: ${siteId}, error: ${validation.error}`);
      return c.json({ 
        error: "Site validation failed",
        details: validation.error 
      }, 403);
    }

    await next();
  };
}
