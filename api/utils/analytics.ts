export function getBounceValue(hits: number): number {
  if (hits === 1) {
    return 1;
  }
  if (hits === 2) {
    return -1;
  }
  return 0;
}

export function extractDeviceInfo(userAgent?: string) {
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

export function parseScreenDimensions(dimensionStr: string) {
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
