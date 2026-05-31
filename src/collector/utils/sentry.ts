import * as Sentry from "@sentry/cloudflare";
import type { Context } from "hono";

import type { Env } from "../types";

const DEFAULT_TRACES_SAMPLE_RATE = 0;
const REDACTED = "[redacted]";
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "x-api-key",
]);

type SentryEnv = Pick<Env, "SENTRY_DSN" | "SENTRY_TRACES_SAMPLE_RATE">;

export function parseSentryTracesSampleRate(value?: string): number {
  if (!value) {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }

  const rate = Number(value);
  if (!Number.isFinite(rate)) {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }

  return Math.min(Math.max(rate, 0), 1);
}

export function redactSensitiveHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) {
    return headers;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? REDACTED : value,
    ]),
  );
}

export function createSentryOptions(env: SentryEnv): Sentry.CloudflareOptions | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) {
    return undefined;
  }

  return {
    dsn,
    tracesSampleRate: parseSentryTracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        event.request.headers = redactSensitiveHeaders(event.request.headers);
        delete event.request.cookies;
        delete event.request.data;
      }

      return event;
    },
  };
}

export function createSentryMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    await next();

    if (c.res.status < 500) {
      return;
    }

    Sentry.withScope((scope) => {
      scope.setTag("collector.method", c.req.method);
      scope.setTag("collector.path", c.req.path);
      scope.setTag("collector.status", c.res.status);
      Sentry.captureMessage("Collector returned a server error response", "error");
    });
  };
}
