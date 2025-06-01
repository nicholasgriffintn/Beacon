import type { Context } from "hono";

import type { EventData } from "../types";
import { collectCommonAnalyticsData } from "../lib";

export async  function handleBatch(c: Context, batchData: EventData) {
  if (!batchData.s || !Array.isArray(batchData.events) || batchData.events.length === 0) {
    console.error("Invalid batch data", batchData);
    return {
      success: false,
      processed: 0,
      nextLastModifiedDate: null
    };
  }

  const commonParams = batchData.commonParams || {};

  const { analyticsData, nextLastModifiedDate } = collectCommonAnalyticsData(c, commonParams, false);

  if (!batchData.events) {
    console.error("Invalid batch data", batchData);
    return {
      success: false,
      processed: 0,
      nextLastModifiedDate
    };
  }

  const processedEvents = batchData.events.map((event) => {
    if (event.type === 'pageview') {
      return {
        ...analyticsData,
        event_data: {
          event_type: 'pageview',
          content_type: event.contentType || 'page',
          virtual_pageview: event.virtualPageview || false,
        },
        page: {
          path: event.path || commonParams.p || '',
          title: event.title || commonParams.title || '',
          language: event.language || commonParams.lng || '',
        },
        properties: event.properties || {},
        data_type: 'pageview',
      };
    }

    if (event.type === 'event') {
      return {
        ...analyticsData,
        event_data: {
          event_type: 'custom',
          event_name: event.eventName,
          event_category: event.eventCategory || 'interaction',
          event_label: event.eventLabel || '',
          event_value: event.eventValue || 0,
          non_interaction: event.nonInteraction || false,
        },
        properties: event.properties || {},
        data_type: 'event',
      };
    }

    return {
      ...analyticsData,
      event_data: {
        event_type: 'unknown',
      },
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
