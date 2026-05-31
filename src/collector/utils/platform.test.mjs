import assert from "node:assert/strict";
import test from "node:test";

import { isProtectedManagementPath } from "./auth.ts";
import { getDeterministicBucket, isInPercentageBucket, stableStringify } from "./bucketing.ts";
import { getHostnameFromUrl, isHostnameAllowed, isValidSiteDomain } from "./domains.ts";
import { parseJsonRecord } from "./json.ts";
import { checkRateLimit, getRateLimitKey } from "./rate-limit.ts";
import { getVariantAllocationRanges, selectVariantForUser } from "./variant-allocation.ts";

test("protects management APIs while leaving client evaluation APIs public", () => {
  assert.equal(isProtectedManagementPath("GET", "/api/sites"), true);
  assert.equal(isProtectedManagementPath("POST", "/api/admin/publish/all"), true);
  assert.equal(isProtectedManagementPath("GET", "/api/experiments/exp_1/results"), true);
  assert.equal(isProtectedManagementPath("POST", "/api/experiments/exp_1/results/refresh"), true);
  assert.equal(isProtectedManagementPath("GET", "/api/experiments/client"), true);
  assert.equal(isProtectedManagementPath("POST", "/api/experiments/exp_1/assign"), false);
  assert.equal(isProtectedManagementPath("GET", "/api/cdn/experiments/latest"), false);
  assert.equal(isProtectedManagementPath("POST", "/api/flags/checkout/resolve"), false);
  assert.equal(isProtectedManagementPath("POST", "/api/flags/resolve"), false);
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
    const variant = selectVariantForUser("logo", variants, { user_id: `user-${index}` });
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
