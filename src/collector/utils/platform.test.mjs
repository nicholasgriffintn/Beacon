import assert from "node:assert/strict";
import test from "node:test";

import { isProtectedManagementPath } from "./auth.ts";
import { getDeterministicBucket, isInPercentageBucket, stableStringify } from "./bucketing.ts";
import { getCdnPublishHeaders, getCdnPublishScopesForMutation } from "./cdn-publish.ts";
import { getHostnameFromUrl, isHostnameAllowed, isValidSiteDomain } from "./domains.ts";
import { parseJsonRecord } from "./json.ts";
import { parseOpenFeatureBootstrapRequest } from "./openfeature-bootstrap.ts";
import { createOpenFeatureEvaluationEvent, createOpenFeatureTrackingEvent, matchesOpenFeatureValueType } from "./openfeature.ts";
import { checkRateLimit, getRateLimitKey } from "./rate-limit.ts";
import { getVariantAllocationRanges, selectVariantForTargetingKey } from "./variant-allocation.ts";

test("protects management APIs while leaving client evaluation APIs public", () => {
  assert.equal(isProtectedManagementPath("GET", "/api/sites"), true);
  assert.equal(isProtectedManagementPath("POST", "/api/admin/publish/all"), true);
  assert.equal(isProtectedManagementPath("GET", "/api/experiments/exp_1/results"), true);
  assert.equal(isProtectedManagementPath("POST", "/api/experiments/exp_1/results/refresh"), true);
  assert.equal(isProtectedManagementPath("GET", "/api/experiments/client"), true);
  assert.equal(isProtectedManagementPath("PUT", "/api/experiments/exp_1"), true);
  assert.equal(isProtectedManagementPath("POST", "/api/openfeature/v1/evaluate"), false);
  assert.equal(isProtectedManagementPath("POST", "/api/openfeature/v1/bootstrap"), false);
  assert.equal(isProtectedManagementPath("POST", "/api/openfeature/v1/track"), false);
  assert.equal(isProtectedManagementPath("GET", "/api/cdn/openfeature/latest"), false);
});

test("selects CDN publish scopes for management mutations", () => {
  assert.deepEqual(getCdnPublishScopesForMutation("site"), ["sites", "flags", "openfeature"]);
  assert.deepEqual(getCdnPublishScopesForMutation("experiment"), ["openfeature"]);
  assert.deepEqual(getCdnPublishScopesForMutation("flag"), ["flags", "openfeature"]);

  assert.deepEqual(getCdnPublishHeaders({
    flags: {
      version: "123",
      etag: "abc",
      lastModified: "2026-05-31T00:00:00.000Z",
      url: "https://cdn.example/config/v1/flags/123.json",
    },
  }), {
    "X-CDN-Published": "flags",
    "X-CDN-flags-Version": "123",
  });
});

test("validates and matches configured site domains", () => {
  assert.equal(isValidSiteDomain("example.com"), true);
  assert.equal(isValidSiteDomain("*.example.com"), true);
  assert.equal(isValidSiteDomain("*.bad_domain"), false);

  assert.equal(getHostnameFromUrl("https://docs.example.com/path"), "docs.example.com");
  assert.equal(isHostnameAllowed("*.example.com", "docs.example.com"), true);
  assert.equal(isHostnameAllowed("*.example.com", "example.com"), true);
  assert.equal(isHostnameAllowed("app.example.com", "docs.example.com"), false);
});

test("uses stable bucketing inputs for deterministic rollout decisions", () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
  assert.equal(getDeterministicBucket("flag:user"), getDeterministicBucket("flag:user"));
  assert.equal(isInPercentageBucket("flag:user", 100), true);
  assert.equal(isInPercentageBucket("flag:user", 0), false);
});

test("allocates users across all positive-weight variants", () => {
  const variants = [
    { id: "control", experiment_id: "logo", name: "control", type: "control", config: {}, traffic_percentage: 25 },
    { id: "abstract", experiment_id: "logo", name: "Abstract", type: "treatment", config: {}, traffic_percentage: 25 },
    { id: "minimalist", experiment_id: "logo", name: "Minimalist", type: "treatment", config: {}, traffic_percentage: 25 },
    { id: "tropical", experiment_id: "logo", name: "Tropical", type: "treatment", config: {}, traffic_percentage: 25 },
  ];
  const counts = Object.fromEntries(variants.map(variant => [variant.id, 0]));

  for (let index = 0; index < 10000; index += 1) {
    const variant = selectVariantForTargetingKey("logo", variants, `user-${index}`);
    counts[variant.id] += 1;
  }

  assert.equal(Object.values(counts).every(count => count > 2000 && count < 3000), true);
});

test("normalises stale variant weights to avoid dead bucket ranges", () => {
  const ranges = getVariantAllocationRanges([
    { id: "control", experiment_id: "logo", name: "control", type: "control", config: {}, traffic_percentage: 10 },
    { id: "treatment", experiment_id: "logo", name: "Treatment", type: "treatment", config: {}, traffic_percentage: 10 },
    { id: "disabled", experiment_id: "logo", name: "Disabled", type: "treatment", config: {}, traffic_percentage: 0 },
  ]);

  assert.deepEqual(ranges.map(range => ({
    id: range.variant.id,
    lower: range.lower,
    upper: range.upper,
    traffic_percentage: range.traffic_percentage,
  })), [
    { id: "control", lower: 0, upper: 50, traffic_percentage: 50 },
    { id: "treatment", lower: 50, upper: 100, traffic_percentage: 50 },
  ]);
});

test("parses JSON object columns defensively", () => {
  assert.deepEqual(parseJsonRecord('{"enabled":true}'), { enabled: true });
  assert.deepEqual(parseJsonRecord("[1,2,3]"), {});
  assert.deepEqual(parseJsonRecord("not json"), {});
});

test("matches OpenFeature object values as structured objects only", () => {
  assert.equal(matchesOpenFeatureValueType({ enabled: true }, "object"), true);
  assert.equal(matchesOpenFeatureValueType(null, "object"), false);
  assert.equal(matchesOpenFeatureValueType(["enabled"], "object"), false);
});

test("maps OpenFeature tracking requests into analytics events", () => {
  const event = createOpenFeatureTrackingEvent({
    trackingEventName: "signup_click",
    context: {
      siteId: "beacon-docs",
      targetingKey: "user-1",
    },
    details: {
      flagKey: "home_hero_test",
      flagSource: "feature_flag",
      experimentId: "exp_home_hero_test",
      conversionId: "signup_click",
      value: 1,
    },
  });

  assert.equal(event?.s, "beacon-docs");
  assert.equal(event?.user_id, "user-1");
  assert.equal(event?.event_name, "feature_flag_tracking");
  assert.equal(event?.event_value, 1);
  assert.equal(event?.properties.flag_key, "home_hero_test");
  assert.equal(event?.properties.flag_source, "feature_flag");
  assert.equal(event?.properties.experiment_id, "exp_home_hero_test");
  assert.equal(event?.properties.conversion_id, "signup_click");
});

test("maps bootstrapped OpenFeature decisions into exposure events", () => {
  const event = createOpenFeatureEvaluationEvent({
    flagKey: "home_hero_test",
    value: { layout: "treatment" },
    reason: "SPLIT",
    variant: "variant_a",
    flagMetadata: {
      source: "feature_flag",
      experiment_id: "exp_home_hero_test",
      variant_id: "variant_a",
      variant_name: "Treatment",
    },
  }, {
    siteId: "beacon-docs",
    targetingKey: "user-1",
  });

  assert.equal(event?.s, "beacon-docs");
  assert.equal(event?.user_id, "user-1");
  assert.equal(event?.event_name, "feature_flag_evaluation");
  assert.equal(event?.event_label, "home_hero_test");
  assert.equal(event?.properties.experiment_id, "exp_home_hero_test");
  assert.equal(event?.properties.variant_id, "variant_a");
  assert.equal(event?.properties.variant_name, "Treatment");
});

test("validates OpenFeature bootstrap requests", () => {
  const parsed = parseOpenFeatureBootstrapRequest({
    context: {
      siteId: "beacon-docs",
      targetingKey: "user-1",
    },
    evaluations: [
      {
        flagKey: "home_hero_test",
        defaultValue: { layout: "default" },
        flagValueType: "object",
      },
    ],
  }, 25);

  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.request?.evaluations[0], {
    flagKey: "home_hero_test",
    defaultValue: { layout: "default" },
    flagValueType: "object",
  });

  assert.deepEqual(
    parseOpenFeatureBootstrapRequest({ context: { targetingKey: "user-1" }, evaluations: [{ flagKey: "a" }] }, 25).error,
    { message: "each evaluation must include defaultValue", status: 400 },
  );
});

test("enforces fixed-window KV rate limits", async () => {
  const store = new Map();
  const kv = {
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => {
      store.set(key, value);
    },
  };
  const key = getRateLimitKey("events", "beacon-docs", "client", 0);

  assert.deepEqual(await checkRateLimit(kv, key, 2), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetSeconds: 60,
  });
  assert.deepEqual(await checkRateLimit(kv, key, 2), {
    allowed: true,
    limit: 2,
    remaining: 0,
    resetSeconds: 60,
  });
  assert.deepEqual(await checkRateLimit(kv, key, 2), {
    allowed: false,
    limit: 2,
    remaining: 0,
    resetSeconds: 60,
  });
});
