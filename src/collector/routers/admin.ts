import { Hono, type Context } from "hono";

import type { Env } from "../types";
import { CDNPublisher } from "../services/cdn-publisher";

const adminRouter = new Hono<{ Bindings: Env }>();

adminRouter.post("/publish/experiments", async (c: Context) => {
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

adminRouter.post("/publish/sites", async (c: Context) => {
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

adminRouter.post("/publish/all", async (c: Context) => {
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

export { adminRouter };
