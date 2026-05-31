import { Hono, type Context } from "hono";

import type { Env } from "../types";

const healthRouter = new Hono<{ Bindings: Env }>();

healthRouter.get("/", async (c: Context) => {
  const checks = {
    db: false,
    kv: false,
    r2: false,
  };

  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.db = true;
  } catch {
    checks.db = false;
  }

  try {
    await c.env.CACHE_KV.get("__healthcheck__");
    checks.kv = true;
  } catch {
    checks.kv = false;
  }

  try {
    await c.env.CDN_BUCKET.head("__healthcheck__");
    checks.r2 = true;
  } catch {
    checks.r2 = false;
  }

  const healthy = checks.db && checks.kv && checks.r2;

  return c.json({
    status: healthy ? "ok" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  }, healthy ? 200 : 503);
});

export { healthRouter };
