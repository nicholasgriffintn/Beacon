import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createBeaconOpenFeature({ evaluationDelay = 0, withBeacon = true } = {}) {
  const configCalls = [];
  const eventCalls = [];
  const trackedEvents = [];
  const localStorageData = new Map();
  const script = readFileSync("public/exp-beacon.js", "utf8");

  const window = {
    crypto: {
      randomUUID: () => "test-user",
    },
    Beacon: withBeacon ? {
      config: {
        siteId: "beacon-docs",
      },
      getUserId: () => "test-user",
      trackEvent: event => trackedEvents.push(event),
    } : undefined,
    localStorage: {
      getItem: key => localStorageData.get(key) ?? null,
      setItem: (key, value) => localStorageData.set(key, value),
      removeItem: key => localStorageData.delete(key),
    },
    fetch: async (url, options) => {
      if (String(url).endsWith("/config/v1/openfeature/latest.json")) {
        configCalls.push({
          url: String(url),
        });
        if (evaluationDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, evaluationDelay));
        }

        return {
          ok: true,
          json: async () => ({
            version: "test",
            updated_at: "2026-05-31T00:00:00.000Z",
            flags: [
              {
                flagKey: "color_scheme",
                name: "Color Scheme",
                site_id: "beacon-docs",
                enabled: true,
                kill_switch: false,
                defaultValue: { bgColor: "#ffffff" },
                targetingRules: [],
                rolloutPercentage: 0,
                variations: [],
                experiment: {
                  id: "exp_color_scheme",
                  name: "Color Scheme Experiment",
                  trafficAllocation: 100,
                  variants: [
                    { key: "color_scheme_control", name: "control", value: { bgColor: "#ffffff" }, trafficPercentage: 0 },
                    { key: "color_scheme_dark", name: "dark", value: { bgColor: "#111111" }, trafficPercentage: 100 },
                  ],
                },
              },
              {
                flagKey: "headline_copy",
                name: "Headline Copy",
                site_id: "beacon-docs",
                enabled: true,
                kill_switch: false,
                defaultValue: "default headline",
                targetingRules: [],
                rolloutPercentage: 100,
                variations: [
                  { key: "headline_flag_rollout", value: "flag rollout headline" },
                ],
                experiment: {
                  id: "exp_headline_copy",
                  name: "Headline Experiment",
                  trafficAllocation: 0,
                  variants: [
                    { key: "headline_treatment", name: "treatment", value: "experiment headline", trafficPercentage: 100 },
                  ],
                },
              },
            ],
          }),
        };
      }

      if (String(url).endsWith("/api/events/collect")) {
        eventCalls.push({
          url: String(url),
          body: JSON.parse(options.body),
        });

        return {
          ok: true,
          json: async () => ({ accepted: true }),
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    },
  };

  window.window = window;
  vm.runInNewContext(script, window);

  return {
    BeaconOpenFeature: window.BeaconOpenFeature,
    configCalls,
    eventCalls,
    trackedEvents,
  };
}

test("loads OpenFeature config from CDN and evaluates experiments locally", async () => {
  const { BeaconOpenFeature, configCalls, trackedEvents } = createBeaconOpenFeature({ evaluationDelay: 10 });
  await BeaconOpenFeature.init({
    endpoint: "https://beacon.polychat.app",
    cdnEndpoint: "https://beacon-cdn.polychat.app",
    siteId: "beacon-docs",
  });

  const [first, second] = await Promise.all([
    BeaconOpenFeature.getObjectDetails("color_scheme", {}),
    BeaconOpenFeature.getObjectDetails("color_scheme", {}),
  ]);

  assert.equal(configCalls.length, 1);
  assert.equal(configCalls[0].url, "https://beacon-cdn.polychat.app/config/v1/openfeature/latest.json");
  assert.equal(first.variant, "color_scheme_dark");
  assert.equal(second.variant, "color_scheme_dark");
  assert.equal(trackedEvents.length, 1);
});

test("falls back to normal flag evaluation outside an experiment allocation", async () => {
  const { BeaconOpenFeature, trackedEvents } = createBeaconOpenFeature();
  await BeaconOpenFeature.init({
    endpoint: "https://beacon.polychat.app",
    cdnEndpoint: "https://beacon-cdn.polychat.app",
    siteId: "beacon-docs",
  });

  const details = await BeaconOpenFeature.getStringDetails("headline_copy", "default");

  assert.equal(details.value, "flag rollout headline");
  assert.equal(details.variant, "headline_flag_rollout");
  assert.equal(details.flagMetadata.experiment_id, undefined);
  assert.equal(trackedEvents.at(-1).properties.experiment_id, "");
});

test("enriches tracking events with the latest nested experiment metadata", async () => {
  const { BeaconOpenFeature, trackedEvents } = createBeaconOpenFeature();
  await BeaconOpenFeature.init({
    endpoint: "https://beacon.polychat.app",
    cdnEndpoint: "https://beacon-cdn.polychat.app",
    siteId: "beacon-docs",
  });

  await BeaconOpenFeature.getObjectDetails("color_scheme", {});
  BeaconOpenFeature.track("theme_apply", {}, {
    flagKey: "color_scheme",
    conversionId: "theme_apply",
    value: 1,
  });

  const trackingEvent = trackedEvents.find(event => event.name === "feature_flag_tracking");
  assert.equal(trackingEvent.properties.flag_source, "feature_flag");
  assert.equal(trackingEvent.properties.experiment_id, "exp_color_scheme");
  assert.equal(trackingEvent.properties.variant_id, "color_scheme_dark");
});

test("hydrates server-rendered OpenFeature decisions", async () => {
  const { BeaconOpenFeature, trackedEvents } = createBeaconOpenFeature();
  await BeaconOpenFeature.init({
    endpoint: "https://beacon.polychat.app",
    cdnEndpoint: "https://beacon-cdn.polychat.app",
    siteId: "beacon-docs",
    bootstrap: {
      context: {
        siteId: "beacon-docs",
        targetingKey: "server-user-1",
      },
      evaluations: {
        color_scheme: {
          flagKey: "color_scheme",
          value: { bgColor: "#111111" },
          reason: "SPLIT",
          variant: "color_scheme_dark",
          flagMetadata: {
            source: "feature_flag",
            experiment_id: "exp_color_scheme",
            variant_id: "color_scheme_dark",
            variant_name: "dark",
          },
        },
      },
    },
  });

  const details = await BeaconOpenFeature.getObjectDetails("color_scheme", {});
  BeaconOpenFeature.track("theme_apply", {}, {
    flagKey: "color_scheme",
    conversionId: "theme_apply",
    value: 1,
  });

  const evaluationEvents = trackedEvents.filter(event => event.name === "feature_flag_evaluation");
  const trackingEvent = trackedEvents.find(event => event.name === "feature_flag_tracking");

  assert.equal(details.value.bgColor, "#111111");
  assert.equal(details.variant, "color_scheme_dark");
  assert.equal(evaluationEvents.length, 0);
  assert.equal(trackingEvent.properties.experiment_id, "exp_color_scheme");
  assert.equal(trackingEvent.properties.variant_id, "color_scheme_dark");
});

test("returns default error details before initialization", async () => {
  const { BeaconOpenFeature, configCalls } = createBeaconOpenFeature();
  const details = await BeaconOpenFeature.getBooleanDetails("ready_flag", false);

  assert.equal(configCalls.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(details)), {
    flagKey: "ready_flag",
    value: false,
    reason: "ERROR",
    errorCode: "PROVIDER_NOT_READY",
    errorMessage: "Beacon OpenFeature provider is not initialized",
    flagMetadata: {},
  });
});

test("sends tracking requests without the Beacon analytics client", async () => {
  const { BeaconOpenFeature, eventCalls, trackedEvents } = createBeaconOpenFeature({ withBeacon: false });
  await BeaconOpenFeature.init({
    endpoint: "https://beacon.polychat.app",
    siteId: "beacon-docs",
  });

  BeaconOpenFeature.track("signup_click", {}, {
    flagKey: "home_hero_test",
    flagSource: "feature_flag",
    experimentId: "exp_home_hero_test",
    conversionId: "signup_click",
    value: 1,
  });

  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(trackedEvents.length, 0);
  assert.equal(eventCalls.length, 1);
  assert.equal(eventCalls[0].url, "https://beacon.polychat.app/api/events/collect");
  assert.equal(eventCalls[0].body.s, "beacon-docs");
  assert.equal(eventCalls[0].body.user_id, "test-user");
  assert.equal(eventCalls[0].body.event_name, "feature_flag_tracking");
  assert.equal(eventCalls[0].body.properties.flag_key, "home_hero_test");
  assert.equal(eventCalls[0].body.properties.flag_source, "feature_flag");
  assert.equal(eventCalls[0].body.properties.experiment_id, "exp_home_hero_test");
});
