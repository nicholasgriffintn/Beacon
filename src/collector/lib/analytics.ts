import type { Context } from "hono";

import { handleCacheHeaders, hasUserBounced, extractDeviceInfo, parseScreenDimensions } from "../utils";
import type { AnalyticsEventData, BatchEventData, EventData } from "../types/data";

export function collectCommonAnalyticsData(c: Context, eventData: EventData | BatchEventData, isPageView = true): {
  analyticsData: AnalyticsEventData;
  nextLastModifiedDate: Date | undefined;
} {
  const userAgent = c.req.header("user-agent");
  const ifModifiedSince = c.req.header('if-modified-since');
  const ip = c.req.raw.headers.get("CF-Connecting-IP") || "unknown";
  const referer = c.req.header("referer");
  const url = c.req.url;
  const path = new URL(c.req.url).pathname;

  const {
    s: siteId = "NA",
    ts: timestamp = "NA",
    vtag: versionTag = "NA",
    r: screenDimensions = "NA",
    re: viewportDimensions = "NA",
    lng: language = "NA",
    content_type: contentType = "NA",
    library_version: libraryVersion = "NA",
    app_name: appName = "NA",
    app_type: appType = "NA",
    user_id: userId = "NA",
    p: pagePath = "",
    ref: referrer = referer || "NA",
    event_name: eventName = "NA",
    event_category: eventCategory = "interaction",
    event_label: eventLabel = "NA",
    event_value: eventValue = 0,
    non_interaction: nonInteraction = false,
    virtual_pageview: virtualPageview = false,
    event_type: eventType = "NA",
    properties = {},
  } = eventData;

  let hits = 0;
  let isVisit = false;
  let isBounce = false;
  let nextLastModifiedDate: Date | undefined;

  if (isPageView) {
    const cacheResult = handleCacheHeaders(ifModifiedSince || null);
    hits = cacheResult.hits;
    nextLastModifiedDate = cacheResult.nextLastModifiedDate;

    isVisit = hits === 1;
    isBounce = hasUserBounced(hits);
  }

  const { browser, os, device, user_agent } = extractDeviceInfo(userAgent);
  const parsedScreenDimensions = parseScreenDimensions(screenDimensions);
  const parsedViewport = parseScreenDimensions(viewportDimensions);
  const currentTimestamp = new Date().toISOString();

  const analyticsData = {
    timestamp: currentTimestamp,
    session_data: {
      site_id: siteId,
      client_timestamp: timestamp || Date.now().toString(),
      user_id: userId || `user${Math.floor(Math.random() * 1000)}`,
      hits,
      new_visitor: isVisit,
      bounce: isBounce,
    },
    event_data: {
      event_id: Math.floor(Math.random() * 1000),
      version_tag: versionTag,
      content_type: contentType,
      event_name: eventName,
      event_category: eventCategory,
      event_label: eventLabel,
      event_value: eventValue,
      non_interaction: nonInteraction,
      virtual_pageview: virtualPageview,
      event_type: eventType,
    },
    app_data: {
      app_name: appName,
      app_type: appType,
      library_version: libraryVersion,
      language: language,
    },
    device_info: {
      browser,
      os,
      device,
      user_agent,
      screen: parsedScreenDimensions,
      viewport: parsedViewport,
    },
    referrer: referrer || "NA",
    page: {
      url,
      path: pagePath || path,
    },
    ip,
    properties: properties,
  };

  return { analyticsData, nextLastModifiedDate };
}