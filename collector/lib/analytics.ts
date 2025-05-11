import type { Context } from "hono";

import { handleCacheHeaders, getBounceValue, extractDeviceInfo, parseScreenDimensions } from "../utils";

export function collectCommonAnalyticsData(c: Context, queryParams: Record<string, string>, isPageView = true) {
  const { userAgent } = c.req.header();
  const ifModifiedSince = c.req.header('if-modified-since');
  const ip = c.req.raw.headers.get("CF-Connecting-IP") || "unknown";
  const { referer } = c.req.header();
  const url = c.req.url;
  const path = new URL(c.req.url).pathname;

  const {
    s: siteId = "",
    ts: timestamp = "",
    vtag: versionTag = "",
    r: screenDimensions = "",
    re: viewportDimensions = "",
    lng: language = "",
    content_type: contentType = "",
    library_version: libraryVersion = "",
    app_name: appName = "",
    app_type: appType = "",
    user_id: userId = "",
    p: pagePath = "",
    ref: referrer = referer || "",
  } = queryParams;

  let hits = 0;
  let isVisit = false;
  let bounceValue = 0;
  let nextLastModifiedDate: Date | undefined;

  if (isPageView) {
    const cacheResult = handleCacheHeaders(ifModifiedSince || null);
    hits = cacheResult.hits;
    nextLastModifiedDate = cacheResult.nextLastModifiedDate;

    isVisit = hits === 1;
    bounceValue = getBounceValue(hits);
  }

  const { browser, os, device } = extractDeviceInfo(userAgent);
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
      new_visitor: isVisit ? 1 : 0,
      bounce: bounceValue,
    },
    event_data: {
      event_id: Math.floor(Math.random() * 1000),
      version_tag: versionTag,
      content_type: contentType,
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
      userAgent,
      screen: parsedScreenDimensions,
      viewport: parsedViewport,
    },
    referrer: referrer || "NA",
    page: {
      url,
      path: pagePath || path,
    },
    ip,
    raw_query_params: queryParams,
  };

  return { analyticsData, nextLastModifiedDate };
}