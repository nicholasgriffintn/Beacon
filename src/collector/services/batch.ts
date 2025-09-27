import type { Context } from "hono";

import type { BatchEventData } from "../types";
import { collectCommonAnalyticsData } from "../lib";
import { parseExperimentAssignments, returnCompactedAssignments } from "../utils";

export async  function handleBatch(c: Context, batchData: BatchEventData) {
  const isValidBatchData = batchData.s && Array.isArray(batchData.events) && batchData.events.length > 0;
  if (!isValidBatchData) {
    console.error("Invalid batch data", batchData);
    return {
      success: false,
      processed: 0,
      nextLastModifiedDate: null
    };
  }

  const { analyticsData, nextLastModifiedDate } = collectCommonAnalyticsData(c, batchData, false);

  if (!batchData.events) {
    console.error("Invalid batch data", batchData);
    return {
      success: false,
      processed: 0,
      nextLastModifiedDate
    };
  }

  const experimentAssignments = parseExperimentAssignments([], batchData.exp);
  const compactedAssignments = returnCompactedAssignments(experimentAssignments);

  const processedEvents = batchData.events.map((event) => {
    if (event.type === 'pageview') {
      return {
        ...analyticsData,
        event_data: {
          ...analyticsData.event_data,
          event_type: 'pageview',
          content_type: event.content_type || 'page',
          virtual_pageview: event.virtual_pageview || false,
        },
        page: {
          ...analyticsData.page,
          path: event.p || '',
          title: event.title || '',
          language: event.lng || '',
        },
        experiment_assignments: compactedAssignments,
        properties: event.properties || {},
        data_type: 'pageview',
      };
    }

    if (event.type === 'event') {
      return {
        ...analyticsData,
        event_data: {
          ...analyticsData.event_data,
          event_type: 'custom',
          event_name: event.event_name,
          event_category: event.event_category || 'interaction',
          event_label: event.event_label || '',
          event_value: event.event_value || 0,
          non_interaction: event.non_interaction || false,
        },
        experiment_assignments: compactedAssignments,
        properties: event.properties || {},
        data_type: 'event',
      };
    }

    return {
      ...analyticsData,
      event_data: {
        ...analyticsData.event_data,
        event_type: 'unknown',
      },
      experiment_assignments: compactedAssignments,
      raw_event: event,
      data_type: 'unknown',
    };
  });

  await c.env.ANALYTICS_PIPELINE.send(processedEvents);

  return {
    success: true,
    processed: processedEvents.length,
    nextLastModifiedDate
  };
}
