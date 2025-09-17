import type { Context } from "hono";

import { collectCommonAnalyticsData } from "../lib";
import type { EventData } from "../types";
import { parseExperimentAssignments } from "../utils";

export async function handleEvent(c: Context, eventData: EventData) {
  const isValidEventData = eventData.s && eventData.eventName;
  if (!isValidEventData) {
    return {
      success: false,
      nextLastModifiedDate: null
    };
  }

  const queryParams = eventData.queryParams || {};
  queryParams.s = eventData.siteId;

  const { analyticsData, nextLastModifiedDate } = collectCommonAnalyticsData(c, queryParams, false);

  const experimentAssignments = parseExperimentAssignments(eventData.experiments, eventData.exp);

  const fullEventData = {
    ...analyticsData,
    event_data: {
      ...analyticsData.event_data,
      event_name: eventData.eventName,
      event_category: eventData.eventCategory || 'interaction',
      event_label: eventData.eventLabel || "",
      event_value: eventData.eventValue || 0,
    },
    experiment_assignments: experimentAssignments,
    properties: eventData.properties || {},
    data_type: "event",
  };

  await c.env.ANALYTICS_PIPELINE.send([fullEventData]);

  return {
    success: true,
    nextLastModifiedDate
  };
}
