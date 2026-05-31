import type { Context } from "hono";
import type { KVNamespace } from "@cloudflare/workers-types";

import type { Env } from "../types";
import { hashToUint32 } from "./bucketing.ts";

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_EVENTS_PER_MINUTE = 600;
const DEFAULT_EVALUATIONS_PER_MINUTE = 300;

export type RateLimitKind = "events" | "evaluations";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

function getLimit(env: Env, kind: RateLimitKind): number {
  const configured = kind === "events"
    ? env.RATE_LIMIT_EVENTS_PER_MINUTE
    : env.RATE_LIMIT_EVALUATIONS_PER_MINUTE;
  const fallback = kind === "events"
    ? DEFAULT_EVENTS_PER_MINUTE
    : DEFAULT_EVALUATIONS_PER_MINUTE;
  const parsed = Number(configured);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function getClientAddressHash(c: Context<{ Bindings: Env }>): string {
  const rawAddress =
    c.req.raw.headers.get("CF-Connecting-IP") ||
    c.req.raw.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";

  return hashToUint32(rawAddress).toString(16);
}

export function getRateLimitKey(kind: RateLimitKind, scope: string, clientHash: string, now = Date.now()): string {
  const windowId = Math.floor(now / (DEFAULT_WINDOW_SECONDS * 1000));
  return `rate:${kind}:${scope}:${clientHash}:${windowId}`;
}

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
): Promise<RateLimitResult> {
  let currentCount = 0;

  try {
    const storedCount = await kv.get(key);
    currentCount = storedCount ? Number(storedCount) : 0;
  } catch {
    return {
      allowed: true,
      limit,
      remaining: limit,
      resetSeconds: DEFAULT_WINDOW_SECONDS,
    };
  }

  const nextCount = currentCount + 1;
  const allowed = nextCount <= limit;

  if (allowed) {
    try {
      await kv.put(key, String(nextCount), { expirationTtl: DEFAULT_WINDOW_SECONDS * 2 });
    } catch {
      return {
        allowed: true,
        limit,
        remaining: Math.max(limit - nextCount, 0),
        resetSeconds: DEFAULT_WINDOW_SECONDS,
      };
    }
  }

  return {
    allowed,
    limit,
    remaining: Math.max(limit - nextCount, 0),
    resetSeconds: DEFAULT_WINDOW_SECONDS,
  };
}

export async function checkRequestRateLimit(
  c: Context<{ Bindings: Env }>,
  kind: RateLimitKind,
  scope: string,
): Promise<RateLimitResult> {
  return checkRateLimit(
    c.env.CACHE_KV,
    getRateLimitKey(kind, scope, getClientAddressHash(c)),
    getLimit(c.env, kind),
  );
}
