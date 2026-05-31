import type { Context } from "hono";

import type { Env } from "../types";

export const API_KEY_HEADER = "X-API-Key";

const normalizePath = (path: string): string => {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
};

const isExperimentAssignmentPath = (path: string): boolean => {
  return /^\/api\/experiments\/[^/]+\/assign$/.test(path);
};

const isFlagResolutionPath = (method: string, path: string): boolean => {
  return (
    method === "POST" &&
    (path === "/api/flags/resolve" || /^\/api\/flags\/[^/]+\/resolve$/.test(path))
  );
};

export function isProtectedManagementPath(method: string, rawPath: string): boolean {
  const path = normalizePath(rawPath);

  if (path === "/api/admin" || path.startsWith("/api/admin/")) {
    return true;
  }

  if (path === "/api/sites" || path.startsWith("/api/sites/")) {
    return true;
  }

  if (path === "/api/experiments" || path.startsWith("/api/experiments/")) {
    return !isExperimentAssignmentPath(path);
  }

  if (path === "/api/flags" || path.startsWith("/api/flags/")) {
    return !isFlagResolutionPath(method, path);
  }

  return false;
}

function timingSafeEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  return diff === 0;
}

export function hasValidApiKey(c: Context<{ Bindings: Env }>): boolean {
  const expected = c.env.ADMIN_API_KEY;
  const actual = c.req.header(API_KEY_HEADER);

  if (!expected || !actual) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
