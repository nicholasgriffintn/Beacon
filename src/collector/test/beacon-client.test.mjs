import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createBeaconClient({ localStorageData = new Map(), idSource } = {}) {
  const script = readFileSync("public/beacon.js", "utf8");
  const window = {
    crypto: {
      randomUUID: idSource,
    },
    document: {
      title: "Beacon",
      referrer: "",
      cookie: "",
      addEventListener: () => {},
    },
    navigator: {
      language: "en",
    },
    screen: {
      width: 1440,
      height: 900,
    },
    screenX: 0,
    screenY: 0,
    innerWidth: 1440,
    innerHeight: 900,
    location: {
      pathname: "/",
    },
    history: {},
    addEventListener: () => {},
    localStorage: {
      getItem: key => localStorageData.get(key) ?? null,
      setItem: (key, value) => localStorageData.set(key, value),
      removeItem: key => localStorageData.delete(key),
    },
    fetch: async () => ({ ok: true }),
  };
  window.window = window;

  vm.runInNewContext(script, window);
  return window.Beacon;
}

test("persists the analytics user id across page reloads", () => {
  const localStorageData = new Map();
  let index = 0;
  const idSource = () => `generated-user-${++index}`;

  const firstClient = createBeaconClient({ localStorageData, idSource });
  const firstUserId = firstClient.getUserId();

  const reloadedClient = createBeaconClient({ localStorageData, idSource });
  const secondUserId = reloadedClient.getUserId();

  assert.equal(firstUserId, "generated-user-1");
  assert.equal(secondUserId, firstUserId);
});

test("accepts a server-rendered analytics user id", () => {
  const localStorageData = new Map();

  const client = createBeaconClient({
    localStorageData,
    idSource: () => "generated-user",
  });
  client.init({
    siteId: "beacon-docs",
    trackPageViews: false,
    userId: "server-user-1",
  });

  const reloadedClient = createBeaconClient({
    localStorageData,
    idSource: () => "generated-user",
  });

  assert.equal(client.getUserId(), "server-user-1");
  assert.equal(reloadedClient.getUserId(), "server-user-1");
});
