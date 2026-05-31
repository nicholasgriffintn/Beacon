import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import * as Sentry from "@sentry/cloudflare";

import type { Env } from "./types";
import { createMiddleware } from "./utils/middleware";
import { createSentryMiddleware, createSentryOptions } from "./utils/sentry";
import { eventsRouter } from "./routers/events";
import { experimentsRouter } from "./routers/experiments";
import { sitesRouter } from "./routers/sites";
import { adminRouter } from "./routers/admin";
import { cdnRouter } from "./routers/cdn";
import { flagsRouter } from "./routers/flags";
import { healthRouter } from "./routers/health";
import { openFeatureRouter } from "./routers/openfeature";

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
      "X-API-Key",
    ],
    maxAge: 86400,
  }),
);

app.use("*", createSentryMiddleware());
app.use("*", createMiddleware());

app.route("/api/events", eventsRouter);
app.route("/api/experiments", experimentsRouter);
app.route("/api/sites", sitesRouter);
app.route("/api/admin", adminRouter);
app.route("/api/cdn", cdnRouter);
app.route("/api/flags", flagsRouter);
app.route("/api/health", healthRouter);
app.route("/api/openfeature/v1", openFeatureRouter);

app.get("*", async (c: Context) => {
  return c.json({
    status: 404,
    message: "Not Found",
  }, 404);
});

export default Sentry.withSentry(createSentryOptions, app);
