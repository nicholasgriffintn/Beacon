import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  ANALYTICS_PIPELINE: {
    send(records: Record<string, unknown>[]): Promise<void>;
  };
}

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

function getMidnightDate(): Date {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return midnight;
}

function getNextLastModifiedDate(current: Date | null): Date {
  let originalCurrent = current;
  // Handle invalid date
  if (current && Number.isNaN(current.getTime())) {
    originalCurrent = null;
  }

  const midnight = getMidnightDate();

  let next = originalCurrent ? originalCurrent : midnight;
  next = midnight.getTime() - next.getTime() > 0 ? midnight : next;

  const currentSeconds = next.getSeconds();
  next.setSeconds(Math.min(3, currentSeconds + 1));

  return next;
}

function getBounceValue(hits: number): number {
  if (hits === 1) {
    return 1;
  }
  if (hits === 2) {
    return -1;
  }
  return 0;
}

function checkVisitorSession(ifModifiedSince: string | null): {
  newVisitor: boolean;
} {
  let newVisitor = true;

  if (ifModifiedSince) {
    const today = new Date();
    const ifModifiedSinceDate = new Date(ifModifiedSince);
    if (
      today.getFullYear() === ifModifiedSinceDate.getFullYear() &&
      today.getMonth() === ifModifiedSinceDate.getMonth() &&
      today.getDate() === ifModifiedSinceDate.getDate()
    ) {
      newVisitor = false;
    }
  }

  return { newVisitor };
}

function handleCacheHeaders(ifModifiedSince: string | null): {
  hits: number;
  nextLastModifiedDate: Date;
} {
  const { newVisitor } = checkVisitorSession(ifModifiedSince);
  const nextLastModifiedDate = getNextLastModifiedDate(
    ifModifiedSince ? new Date(ifModifiedSince) : null,
  );

  // Calculate hits from the seconds component of the date
  // If it's a new day or first visit, hits will be 1
  // Otherwise, it's based on the seconds value, but capped at 3
  let hits = newVisitor ? 1 : nextLastModifiedDate.getSeconds();

  if (hits > 3) {
    hits = 3;
  }

  return {
    hits,
    nextLastModifiedDate,
  };
}

function extractDeviceInfo(userAgent?: string) {
  let browser = "Unknown";
  let os = "Unknown";
  let device = "Unknown";

  if (!userAgent) {
    return { browser, os, device };
  }

  if (userAgent.includes("Firefox")) {
    browser = "Firefox";
  } else if (userAgent.includes("Chrome")) {
    browser = "Chrome";
  } else if (userAgent.includes("Safari")) {
    browser = "Safari";
  } else if (userAgent.includes("Opera") || userAgent.includes("OPR")) {
    browser = "Opera";
  } else if (userAgent.includes("Edge")) {
    browser = "Edge";
  } else if (userAgent.includes("MSIE") || userAgent.includes("Trident/")) {
    browser = "Internet Explorer";
  }

  if (userAgent.includes("Win")) {
    os = "Windows";
  } else if (userAgent.includes("Mac")) {
    os = "MacOS";
  } else if (userAgent.includes("Linux")) {
    os = "Linux";
  } else if (userAgent.includes("Android")) {
    os = "Android";
  } else if (userAgent.includes("iOS")) {
    os = "iOS";
  }

  const mobileKeywords = [
    "Android",
    "webOS",
    "iPhone",
    "iPad",
    "iPod",
    "BlackBerry",
    "Windows Phone",
  ];
  device = mobileKeywords.some((keyword) => userAgent.includes(keyword))
    ? "Mobile"
    : "Desktop";

  return { browser, os, device };
}

function parseScreenDimensions(dimensionStr: string) {
  if (!dimensionStr) return null;

  const parts = dimensionStr.split('x');
  if (parts.length < 2) return null;

  return {
    width: Number.parseInt(parts[0], 10) || 0,
    height: Number.parseInt(parts[1], 10) || 0,
    offsetX: parts.length > 2 ? (Number.parseInt(parts[2], 10) || 0) : 0,
    offsetY: parts.length > 3 ? (Number.parseInt(parts[3], 10) || 0) : 0,
  };
}

function collectCommonAnalyticsData(c: Context, queryParams: Record<string, string>, isPageView = true) {
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

app.post("/batch", async (c: Context) => {
  let batchData: any;
  try {
    batchData = await c.req.json();
  } catch (e) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  if (!batchData.siteId || !Array.isArray(batchData.events) || batchData.events.length === 0) {
    return c.json({ error: "Missing required fields: siteId and events" }, 400);
  }

  const commonParams = batchData.commonParams || {};

  const { analyticsData, nextLastModifiedDate } = collectCommonAnalyticsData(c, commonParams, false);

  const processedEvents = batchData.events.map((event: any) => {
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

  return c.json(
    {
      success: true,
      processed: processedEvents.length
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

app.post("/event", async (c: Context) => {
  let eventData: any;
  try {
    eventData = await c.req.json();
  } catch (e) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  if (!eventData.siteId || !eventData.eventName) {
    return c.json({ error: "Missing required fields: siteId and eventName" }, 400);
  }

  const queryParams = eventData.queryParams || {};
  queryParams.s = eventData.siteId;

  const { analyticsData, nextLastModifiedDate } = collectCommonAnalyticsData(c, queryParams, false);

  const fullEventData = {
    ...analyticsData,
    event_data: {
      ...analyticsData.event_data,
      event_name: eventData.eventName,
      event_category: eventData.eventCategory || "interaction",
      event_label: eventData.eventLabel || "",
      event_value: eventData.eventValue || 0,
    },
    properties: eventData.properties || {},
    data_type: "event",
  };

  await c.env.ANALYTICS_PIPELINE.send([fullEventData]);

  return c.json(
    { success: true },
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

app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

  export default {
    fetch: app.fetch,
  };