import type { Context } from "hono";

import { collectCommonAnalyticsData } from "../lib";
import type { AnalyticsFullEventData, EventData } from "../types";
import { parseExperimentAssignments } from "../utils";

export async function handleEvent(c: Context, eventData: EventData) {
  const isValidEventData = eventData.s && eventData.event_name;
  if (!isValidEventData) {
    return {
      success: false,
      nextLastModifiedDate: null
    };
  }

  const { analyticsData, nextLastModifiedDate } = collectCommonAnalyticsData(c, eventData, false);

  const experimentAssignments = parseExperimentAssignments([], eventData.exp);

  const fullEventData: AnalyticsFullEventData = {
    ...analyticsData,
    experiment_assignments: experimentAssignments,
    data_type: "event",
  };

  await c.env.ANALYTICS_PIPELINE.send([fullEventData]);

  return {
    success: true,
    nextLastModifiedDate
  };
}
