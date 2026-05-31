import type { Context } from "hono";

import {
  anonymizeIp,
  extractDeviceInfo,
  formatScreenDimensions,
  getOriginFromHeaders,
  getPathFromUrl,
  handleCacheHeaders,
  hasUserBounced,
  parseScreenDimensions,
  toBoolean,
  toEventNumber,
} from "../utils";
import type { AnalyticsEventData, BatchEventData, EventData } from "../types/data";

export function collectCommonAnalyticsData(c: Context, eventData: EventData | BatchEventData, isPageView = true): {
  analyticsData: AnalyticsEventData;
  nextLastModifiedDate: Date | undefined;
} {
  const userAgent = c.req.header("user-agent");
  const ifModifiedSince = c.req.header('if-modified-since');
  const ip = anonymizeIp(
    c.req.raw.headers.get("CF-Connecting-IP") ||
      c.req.raw.headers.get("X-Forwarded-For") ||
      "unknown",
  );
  const requestOrigin = getOriginFromHeaders(c.req.raw.headers);
  const url = requestOrigin || c.req.url;
  const urlPath = getPathFromUrl(requestOrigin) || getPathFromUrl(c.req.url) || "";

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
    ref: referrer = requestOrigin || "NA",
    event_name: rawEventName = "NA",
    event_category: rawEventCategory = "interaction",
    event_label: rawEventLabel = "NA",
    event_value: rawEventValue = 0,
    non_interaction: nonInteraction = false,
    virtual_pageview: rawVirtualPageview = false,
    virtual_page_view: rawLegacyVirtualPageview = false,
    event_type: eventType = "NA",
    properties = {},
  } = eventData;

  const eventName = rawEventName !== "NA" ? rawEventName : "unknown_event";
  const eventCategory = rawEventCategory !== "interaction" ? rawEventCategory : "general";
  const eventValue = toEventNumber(rawEventValue);
  const virtualPageview = toBoolean(rawVirtualPageview) || toBoolean(rawLegacyVirtualPageview);

  let eventLabel = rawEventLabel;
  if (eventLabel === "NA" || !eventLabel) {
    if (eventName !== 'unknown_event') {
      eventLabel = eventName;
    } else if (pagePath) {
      eventLabel = pagePath;
    } else {
      eventLabel = 'event';
    }
  }

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
      non_interaction: toBoolean(nonInteraction),
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
      screen: formatScreenDimensions(parsedScreenDimensions),
      viewport: formatScreenDimensions(parsedViewport),
    },
    referrer: referrer || "NA",
    page: {
      url,
      path: pagePath || urlPath,
    },
    ip,
    properties: properties,
  };

  return { analyticsData, nextLastModifiedDate };
}
