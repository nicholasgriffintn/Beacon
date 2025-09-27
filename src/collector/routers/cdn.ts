import { Hono, type Context } from "hono";

import type { Env } from "../types";
import { CDNPublisher } from "../services/cdn-publisher";

const cdnRouter = new Hono<{ Bindings: Env }>();

cdnRouter.get("/experiments/info", async (c: Context) => {
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

cdnRouter.get("/sites/info", async (c: Context) => {
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

cdnRouter.get("/:type/versions", async (c: Context) => {
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

export { cdnRouter };
