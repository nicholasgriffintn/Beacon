import assert from "node:assert/strict";
import test from "node:test";

import { FeatureFlagService } from "../services/feature-flag.ts";

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM feature_flags WHERE flag_key = ?")) {
      return this.db.flags.get(this.params[0]) ?? null;
    }

    if (this.sql.includes("FROM assignments")) {
      return this.db.assignments.get(`${this.params[0]}:${this.params[1]}`) ?? null;
    }

    return null;
  }

  async all() {
    if (this.sql.includes("FROM experiments")) {
      return {
        results: [...this.db.experiments.values()]
          .filter(experiment => experiment.flag_key === this.params[0] && experiment.status === "running"),
      };
    }

    if (this.sql.includes("FROM variants")) {
      return {
        results: [...this.db.variants.values()]
          .filter(variant => variant.experiment_id === this.params[0]),
      };
    }

    return { results: [] };
  }

  async run() {
    if (this.sql.includes("INSERT OR IGNORE INTO assignments")) {
      const [id, experimentId, variantId, userId, context] = this.params;
      this.db.assignments.set(`${experimentId}:${userId}`, {
        id,
        experiment_id: experimentId,
        variant_id: variantId,
        user_id: userId,
        context,
      });
    }

    if (this.sql.includes("INSERT INTO flag_evaluations")) {
      this.db.evaluations.push(this.params);
    }

    return { success: true, meta: { changes: 1 } };
  }
}

function createMockD1() {
  return {
    flags: new Map([
      ["homepage_cta", {
        id: "flag_homepage_cta",
        flag_key: "homepage_cta",
        name: "Homepage CTA",
        description: null,
        site_id: "beacon-docs",
        enabled: true,
        kill_switch: false,
        default_value: '"default"',
        targeting_rules: "[]",
        rollout_percentage: 0,
        variations: "[]",
        created_at: "2026-05-31T00:00:00.000Z",
        updated_at: "2026-05-31T00:00:00.000Z",
      }],
    ]),
    experiments: new Map([
      ["exp_homepage_cta", {
        id: "exp_homepage_cta",
        flag_key: "homepage_cta",
        name: "Homepage CTA Experiment",
        description: null,
        type: "ab_test",
        status: "running",
        site_id: "beacon-docs",
        targeting_rules: "{}",
        traffic_allocation: 100,
        start_time: null,
        end_time: null,
        created_at: "2026-05-31T00:00:00.000Z",
        updated_at: "2026-05-31T00:00:00.000Z",
      }],
    ]),
    variants: new Map([
      ["variant_treatment", {
        id: "variant_treatment",
        experiment_id: "exp_homepage_cta",
        name: "Treatment",
        type: "treatment",
        config: '{"value":"treatment"}',
        traffic_percentage: 100,
      }],
    ]),
    assignments: new Map(),
    evaluations: [],
    prepare(sql) {
      return new MockStatement(this, sql);
    },
  };
}

test("evaluates active experiments inside the feature flag evaluation path", async () => {
  const db = createMockD1();
  const service = new FeatureFlagService(db);

  const result = await service.evaluateFlag({
    flag_key: "homepage_cta",
    user_id: "user-1",
    attributes: {
      siteId: "beacon-docs",
    },
    default_value: "default",
  });

  assert.equal(result.flag_key, "homepage_cta");
  assert.equal(result.value, "treatment");
  assert.equal(result.variation_key, "variant_treatment");
  assert.equal(result.variant_name, "Treatment");
  assert.equal(result.experiment_id, "exp_homepage_cta");
  assert.equal(result.reason, "rollout");
  assert.equal(db.assignments.has("exp_homepage_cta:user-1"), true);
  assert.equal(db.evaluations.length, 1);
});
