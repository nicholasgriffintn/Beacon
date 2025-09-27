import { Hono, type Context } from "hono";

import type { Env, SiteCreate, SiteUpdate } from "../types";
import { SiteService } from "../services/site";

const sitesRouter = new Hono<{ Bindings: Env }>();

sitesRouter.get("/", async (c: Context) => {
  try {
    const siteService = new SiteService(c.env.DB, c.env.CACHE_KV);
    const sites = await siteService.listSites();
    return c.json(sites);
  } catch (e) {
    console.error(e);
    return c.json({ error: "Error listing sites" }, 500);
  }
});

sitesRouter.post("/", async (c: Context) => {
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

sitesRouter.get("/:siteId", async (c: Context) => {
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

sitesRouter.put("/:siteId", async (c: Context) => {
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

sitesRouter.delete("/:siteId", async (c: Context) => {
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

export { sitesRouter };
