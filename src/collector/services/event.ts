import type { Context } from "hono";

import { collectCommonAnalyticsData } from "../lib";
import type { AnalyticsFullEventData, EventData } from "../types";
import { parseExperimentAssignments, returnCompactedAssignments } from "../utils";

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
  const compactedAssignments = returnCompactedAssignments(experimentAssignments);

  const fullEventData: AnalyticsFullEventData = {
    ...analyticsData,
    experiment_assignments: compactedAssignments,
    data_type: "event",
  };

  await c.env.ANALYTICS_PIPELINE.send([fullEventData]);

  return {
    success: true,
    nextLastModifiedDate
  };
}
