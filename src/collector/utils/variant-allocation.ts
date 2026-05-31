import type { UserContext, Variant } from "../types";

import { getDeterministicBucket } from "./bucketing.ts";

interface VariantAllocationRange {
  variant: Variant;
  lower: number;
  upper: number;
  traffic_percentage: number;
}

export function getVariantAllocationRanges(variants: Variant[]): VariantAllocationRange[] {
  const allocatableVariants = variants.filter((variant) => {
    return Number.isFinite(variant.traffic_percentage) && variant.traffic_percentage > 0;
  });
  const totalTraffic = allocatableVariants.reduce((sum, variant) => sum + variant.traffic_percentage, 0);

  if (totalTraffic <= 0) {
    return [];
  }

  let lower = 0;
  return allocatableVariants.map((variant, index) => {
    const normalisedTraffic = (variant.traffic_percentage / totalTraffic) * 100;
    const upper = index === allocatableVariants.length - 1 ? 100 : lower + normalisedTraffic;
    const range = {
      variant,
      lower,
      upper,
      traffic_percentage: normalisedTraffic,
    };

    lower = upper;
    return range;
  });
}

export function selectVariantForUser(experimentId: string, variants: Variant[], userContext: UserContext): Variant | null {
  const bucket = getDeterministicBucket(`${experimentId}:${userContext.user_id}:variant`);

  for (const range of getVariantAllocationRanges(variants)) {
    if (bucket >= range.lower && bucket < range.upper) {
      return range.variant;
    }
  }

  return null;
}
