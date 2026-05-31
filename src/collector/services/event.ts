import type { Context } from "hono";

import { collectCommonAnalyticsData } from "../lib";
import type { AnalyticsFullEventData, EventData } from "../types";
import { parseExperimentAssignments, returnCompactedAssignments } from "../utils";
import { ExperimentResultsService } from "./experiment-results";

export async function handleEvent(c: Context, eventData: EventData) {
  const isValidEventData = eventData.s && eventData.event_name;
  if (!isValidEventData) {
    return {
      success: false,
      error: "Event payload must include s and event_name",
      status: 400,
      nextLastModifiedDate: null
    };
  }

  const { analyticsData, nextLastModifiedDate } = collectCommonAnalyticsData(c, eventData, false);

  const experimentAssignments = parseExperimentAssignments([], eventData.exp);
  const compactedAssignments = returnCompactedAssignments(experimentAssignments);

  const fullEventData: AnalyticsFullEventData = {
    ...analyticsData,
    experiment_assignments: compactedAssignments,
    data_type: "event",
  };

  try {
    await c.env.ANALYTICS_PIPELINE.send([fullEventData]);
  } catch (error) {
    console.error("Error sending events", error);
    return {
      success: false,
      processed: 0,
      error: "Failed to send event to analytics pipeline",
      status: 502,
      nextLastModifiedDate
    };
  }

  try {
    await new ExperimentResultsService(c.env.DB, c.env.CDN_BUCKET, c.env.CACHE_KV)
      .recordExperimentEvents(fullEventData);
  } catch (error) {
    console.error("Error recording experiment event mirror", error);
  }

  return {
    success: true,
    processed: 1,
    nextLastModifiedDate
  };
}
