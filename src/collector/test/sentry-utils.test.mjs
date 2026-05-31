import assert from "node:assert/strict";
import test from "node:test";

import {
  createSentryOptions,
  parseSentryTracesSampleRate,
  redactSensitiveHeaders,
} from "../utils/sentry.ts";

test("parses Sentry trace sample rates defensively", () => {
  assert.equal(parseSentryTracesSampleRate(), 0);
  assert.equal(parseSentryTracesSampleRate("bad"), 0);
  assert.equal(parseSentryTracesSampleRate("-1"), 0);
  assert.equal(parseSentryTracesSampleRate("0.25"), 0.25);
  assert.equal(parseSentryTracesSampleRate("2"), 1);
});

test("redacts sensitive request headers before sending Sentry events", () => {
  assert.deepEqual(redactSensitiveHeaders({
    Authorization: "Bearer token",
    Cookie: "session=value",
    "X-API-Key": "secret",
    "Content-Type": "application/json",
  }), {
    Authorization: "[redacted]",
    Cookie: "[redacted]",
    "X-API-Key": "[redacted]",
    "Content-Type": "application/json",
  });
});

test("creates Sentry options only when a DSN is configured", () => {
  assert.equal(createSentryOptions({}), undefined);

  const options = createSentryOptions({
    SENTRY_DSN: " https://example.com/1 ",
    SENTRY_TRACES_SAMPLE_RATE: "0.5",
  });

  assert.equal(options?.dsn, "https://example.com/1");
  assert.equal(options?.tracesSampleRate, 0.5);
  assert.equal(options?.sendDefaultPii, false);
});

test("Sentry beforeSend removes request bodies, cookies, and sensitive headers", () => {
  const options = createSentryOptions({
    SENTRY_DSN: "https://example.com/1",
  });

  const event = options?.beforeSend?.({
    request: {
      headers: {
        Authorization: "Bearer token",
        Accept: "application/json",
      },
      cookies: {
        session: "value",
      },
      data: {
        email: "person@example.com",
      },
    },
  }, {});

  assert.deepEqual(event?.request, {
    headers: {
      Authorization: "[redacted]",
      Accept: "application/json",
    },
  });
});
