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
    async batch(statements) {
      for (const statement of statements) {
        if (statement.sql.includes("DELETE FROM assignments")) {
          const [flagKey] = statement.params;
          const experimentIds = new Set(
            [...this.experiments.values()]
              .filter(experiment => experiment.flag_key === flagKey)
              .map(experiment => experiment.id),
          );

          for (const [key, assignment] of this.assignments) {
            if (experimentIds.has(assignment.experiment_id)) {
              this.assignments.delete(key);
            }
          }
        }

        if (statement.sql.includes("DELETE FROM variants")) {
          const [flagKey] = statement.params;
          const experimentIds = new Set(
            [...this.experiments.values()]
              .filter(experiment => experiment.flag_key === flagKey)
              .map(experiment => experiment.id),
          );

          for (const [key, variant] of this.variants) {
            if (experimentIds.has(variant.experiment_id)) {
              this.variants.delete(key);
            }
          }
        }

        if (statement.sql.includes("DELETE FROM experiments WHERE flag_key = ?")) {
          const [flagKey] = statement.params;
          for (const [key, experiment] of this.experiments) {
            if (experiment.flag_key === flagKey) {
              this.experiments.delete(key);
            }
          }
        }

        if (statement.sql.includes("DELETE FROM flag_evaluations WHERE flag_key = ?")) {
          const [flagKey] = statement.params;
          this.evaluations = this.evaluations.filter(evaluation => evaluation[2] !== flagKey);
        }

        if (statement.sql.includes("DELETE FROM feature_flags WHERE flag_key = ?")) {
          this.flags.delete(statement.params[0]);
        }
      }

      return statements.map(() => ({ success: true }));
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

test("deletes a feature flag with nested experiments", async () => {
  const db = createMockD1();
  db.assignments.set("exp_homepage_cta:user-1", {
    experiment_id: "exp_homepage_cta",
    user_id: "user-1",
  });
  const service = new FeatureFlagService(db);

  assert.equal(await service.deleteFlag("homepage_cta"), true);
  assert.equal(await service.deleteFlag("homepage_cta"), false);
  assert.equal(db.flags.has("homepage_cta"), false);
  assert.equal(db.experiments.has("exp_homepage_cta"), false);
  assert.equal(db.variants.has("variant_treatment"), false);
  assert.equal(db.assignments.has("exp_homepage_cta:user-1"), false);
});
