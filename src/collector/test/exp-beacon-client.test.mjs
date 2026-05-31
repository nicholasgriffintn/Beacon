import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createBeaconExperiments({ assignmentDelay = 0 } = {}) {
  const assignCalls = [];
  const localStorageData = new Map();
  const script = readFileSync("public/exp-beacon.js", "utf8");

  const window = {
    crypto: {
      randomUUID: () => "test-user",
    },
    Beacon: {
      config: {
        siteId: "beacon-docs",
      },
      getUserId: () => "test-user",
      trackEvent: () => {},
    },
    localStorage: {
      getItem: (key) => localStorageData.get(key) ?? null,
      setItem: (key, value) => localStorageData.set(key, value),
      removeItem: (key) => localStorageData.delete(key),
    },
    fetch: async (url) => {
      if (String(url).includes("/assign")) {
        assignCalls.push(String(url));
        if (assignmentDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, assignmentDelay));
        }

        return {
          ok: true,
          json: async () => ({
            experiment_id: "color_scheme",
            variant_id: "control",
            variant_name: "control",
            config: {},
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          experiments: [
            {
              id: "color_scheme",
              variants: [],
            },
          ],
        }),
      };
    },
  };

  window.window = window;
  vm.runInNewContext(script, window);

  return {
    BeaconExperiments: window.BeaconExperiments,
    assignCalls,
  };
}

test("deduplicates concurrent variant assignment requests", async () => {
  const { BeaconExperiments, assignCalls } = createBeaconExperiments({ assignmentDelay: 10 });
  await BeaconExperiments.init({
    endpoint: "https://beacon.polychat.app",
    siteId: "beacon-docs",
  });

  const [first, second] = await Promise.all([
    BeaconExperiments.getVariant("color_scheme"),
    BeaconExperiments.getVariant("color_scheme"),
  ]);

  assert.equal(assignCalls.length, 1);
  assert.equal(first.variant_id, "control");
  assert.equal(second.variant_id, "control");
});
