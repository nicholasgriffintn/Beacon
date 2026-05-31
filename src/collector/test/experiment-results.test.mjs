import assert from "node:assert/strict";
import test from "node:test";

import { createRecommendedAction, getWilsonInterval } from "../services/experiment-results.ts";

function result(name, totalUsers, convertedUsers, conversionCount = convertedUsers) {
  return {
    variant_id: name.toLowerCase(),
    variant_name: name,
    metrics: {
      total_users: totalUsers,
      exposed_users: totalUsers,
      conversion_count: conversionCount,
      converted_users: convertedUsers,
      conversion_rate: totalUsers > 0 ? convertedUsers / totalUsers : 0,
      conversion_value: 0,
      average_order_value: 0,
    },
    statistics: {
      statistical_significance: false,
      confidence_interval: getWilsonInterval(convertedUsers, totalUsers),
    },
  };
}

test("calculates bounded Wilson confidence intervals", () => {
  assert.deepEqual(getWilsonInterval(0, 0), { lower: 0, upper: 0 });

  const interval = getWilsonInterval(20, 100);
  assert.equal(interval.lower >= 0, true);
  assert.equal(interval.upper <= 1, true);
  assert.equal(interval.lower < 0.2, true);
  assert.equal(interval.upper > 0.2, true);
});

test("summarises experiment result readiness and observed winner", () => {
  assert.equal(createRecommendedAction([]), "No assignment data is available yet.");
  assert.equal(
    createRecommendedAction([result("Control", 40, 5), result("Treatment", 40, 10)]),
    "Keep collecting data before making a decision.",
  );
  assert.equal(
    createRecommendedAction([result("Control", 60, 0), result("Treatment", 60, 0)]),
    "No conversions have been recorded yet.",
  );
  assert.equal(
    createRecommendedAction([result("Control", 80, 8), result("Treatment", 80, 16)]),
    "Review Treatment; it currently has the highest observed conversion rate.",
  );
});
