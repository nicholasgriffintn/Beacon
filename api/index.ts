import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

import type { Env, EventData, ExperimentCreate, ExperimentUpdate, UserContext } from "./types";
import { handleBatch } from "./services/batch";
import { handleEvent } from "./services/event";
import { ExperimentService } from "./services/experiment";

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

app.post("/api/events/batch", async (c: Context) => {
  let batchData: EventData;
  try {
    batchData = await c.req.json();
  } catch (e) {
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
  const experimentService = new ExperimentService(c.env.DB);
  const experiments = await experimentService.listExperiments();
  return c.json(experiments);
});

app.get("/api/experiments/:id", async (c: Context) => {
  const experimentService = new ExperimentService(c.env.DB);
  const experiment = await experimentService.getExperiment(c.req.param("id"));
  
  if (!experiment) {
    return c.json({ error: "Experiment not found" }, 404);
  }
  
  return c.json(experiment);
});

app.post("/api/experiments", async (c: Context) => {
  let experimentData: ExperimentCreate;
  try {
    experimentData = await c.req.json();
  } catch (e) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const experimentService = new ExperimentService(c.env.DB);
  const experiment = await experimentService.createExperiment(experimentData);
  
  return c.json(experiment, 201);
});

app.put("/api/experiments/:id", async (c: Context) => {
  let updateData: ExperimentUpdate;
  try {
    updateData = await c.req.json();
  } catch (e) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const experimentService = new ExperimentService(c.env.DB);
  const experiment = await experimentService.updateExperiment(c.req.param("id"), updateData);
  
  if (!experiment) {
    return c.json({ error: "Experiment not found" }, 404);
  }
  
  return c.json(experiment);
});

app.post("/api/experiments/:id/assign", async (c: Context) => {
  let userContext: UserContext;
  try {
    userContext = await c.req.json();
  } catch (e) {
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
});

app.get("*", async (c: Context) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
};