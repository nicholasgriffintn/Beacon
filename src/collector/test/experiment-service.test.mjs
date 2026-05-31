import assert from "node:assert/strict";
import test from "node:test";

import { ExperimentService } from "../services/experiment.ts";

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
    if (this.sql.includes("FROM experiments WHERE id = ?")) {
      return this.db.experiments.get(this.params[0]) ?? null;
    }

    if (this.sql.includes("FROM experiments") && this.sql.includes("WHERE flag_key = ?")) {
      return [...this.db.experiments.values()]
        .filter(experiment => experiment.flag_key === this.params[0] && experiment.status === "running")
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null;
    }

    if (this.sql.includes("FROM feature_flags WHERE flag_key = ?")) {
      return this.db.featureFlags.get(this.params[0]) ?? null;
    }

    if (this.sql.includes("FROM assignments")) {
      return this.db.assignments.get(`${this.params[0]}:${this.params[1]}`) ?? null;
    }

    return null;
  }

  async all() {
    if (this.sql.includes("FROM variants")) {
      return {
        results: [...this.db.variants.values()]
          .filter(variant => variant.experiment_id === this.params[0])
          .sort((left, right) => `${left.type}:${left.name}:${left.id}`.localeCompare(`${right.type}:${right.name}:${right.id}`)),
      };
    }

    return { results: [] };
  }

  async run() {
    if (this.sql.includes("INSERT INTO assignments")) {
      const [id, experimentId, variantId, userId, context] = this.params;
      this.db.assignments.set(`${experimentId}:${userId}`, {
        id,
        experiment_id: experimentId,
        variant_id: variantId,
        user_id: userId,
        context,
      });
    }

    return { success: true, meta: { changes: 1 } };
  }
}

function createMockD1() {
  return {
    experiments: new Map(),
    featureFlags: new Map([
      ["homepage_cta", { flag_key: "homepage_cta" }],
      ["site_scoped_cta", { flag_key: "site_scoped_cta" }],
    ]),
    variants: new Map(),
    assignments: new Map(),
    preparedSql: [],
    batchCalls: [],
    prepare(sql) {
      this.preparedSql.push(sql);
      return new MockStatement(this, sql);
    },
    async batch(statements) {
      this.batchCalls.push(statements);

      for (const statement of statements) {
        assert.equal(/BEGIN TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT/i.test(statement.sql), false);

        if (statement.sql.includes("INSERT INTO experiments")) {
          const [
            id,
            flagKey,
            name,
            description,
            type,
            status,
            siteId,
            targetingRules,
            trafficAllocation,
            startTime,
            endTime,
          ] = statement.params;

          this.experiments.set(id, {
            id,
            flag_key: flagKey,
            name,
            description,
            type,
            status,
            site_id: siteId,
            targeting_rules: targetingRules,
            traffic_allocation: trafficAllocation,
            start_time: startTime,
            end_time: endTime,
            created_at: "2026-05-31T00:00:00.000Z",
            updated_at: "2026-05-31T00:00:00.000Z",
          });
        }

        if (statement.sql.includes("INSERT INTO variants")) {
          const [id, experimentId, name, type, config, trafficPercentage] = statement.params;
          this.variants.set(id, {
            id,
            experiment_id: experimentId,
            name,
            type,
            config,
            traffic_percentage: trafficPercentage,
          });
        }
      }

      return statements.map(() => ({ success: true }));
    },
  };
}

test("requires OpenFeature flag keys when creating experiments", async () => {
  const db = createMockD1();
  const service = new ExperimentService(db);

  await assert.rejects(() => service.createExperiment({
    name: "Homepage CTA",
    type: "ab_test",
    traffic_allocation: 100,
    variants: [
      { name: "Control", type: "control", config: { value: "control" }, traffic_percentage: 50 },
      { name: "Treatment", type: "treatment", config: { value: "treatment" }, traffic_percentage: 50 },
    ],
  }), /flag_key is required/);

  await assert.rejects(() => service.createExperiment({
    flag_key: "homepage/cta",
    name: "Homepage CTA",
    type: "ab_test",
    traffic_allocation: 100,
    variants: [
      { name: "Control", type: "control", config: { value: "control" }, traffic_percentage: 50 },
      { name: "Treatment", type: "treatment", config: { value: "treatment" }, traffic_percentage: 50 },
    ],
  }), /OpenFeature flag key/);

  await assert.rejects(() => service.createExperiment({
    flag_key: "missing_flag",
    name: "Homepage CTA",
    type: "ab_test",
    traffic_allocation: 100,
    variants: [
      { name: "Control", type: "control", config: { value: "control" }, traffic_percentage: 50 },
      { name: "Treatment", type: "treatment", config: { value: "treatment" }, traffic_percentage: 50 },
    ],
  }), /existing feature flag/);
});

test("creates experiments attached to feature flags", async () => {
  const db = createMockD1();
  const service = new ExperimentService(db);
  const experiment = await service.createExperiment({
    flag_key: "homepage_cta",
    name: "Homepage CTA",
    type: "ab_test",
    traffic_allocation: 100,
    variants: [
      { name: "Control", type: "control", config: { value: "control" }, traffic_percentage: 50 },
      { name: "Treatment", type: "treatment", config: { value: "treatment" }, traffic_percentage: 50 },
    ],
  });

  assert.equal(experiment.flag_key, "homepage_cta");
  assert.equal(db.experiments.get(experiment.id).flag_key, "homepage_cta");
});
