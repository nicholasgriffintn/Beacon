import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

import type {
  FeatureFlag,
  FlagEvaluationResponse,
  OpenFeatureEvaluationDetails,
  OpenFeatureEvaluationRequest,
  OpenFeatureReason,
} from "../types";
import { FeatureFlagService } from "./feature-flag";
import {
  createOpenFeatureDetails,
  createOpenFeatureErrorDetails,
  getOpenFeatureValueType,
  getTargetingKey,
  matchesEvaluationSite,
  matchesOpenFeatureValueType,
} from "../utils/openfeature.ts";

const FLAG_REASON_MAP: Record<string, OpenFeatureReason> = {
  targeting: "TARGETING_MATCH",
  rollout: "SPLIT",
  default: "DEFAULT",
  kill_switch: "DISABLED",
  disabled: "DISABLED",
};

export class OpenFeatureService {
  private readonly flags: FeatureFlagService;

  constructor(db: D1Database, kv?: KVNamespace) {
    this.flags = new FeatureFlagService(db, kv);
  }

  async evaluate(request: OpenFeatureEvaluationRequest): Promise<OpenFeatureEvaluationDetails> {
    if (!request.flagKey) {
      return createOpenFeatureErrorDetails({
        flagKey: "",
        defaultValue: request.defaultValue,
        errorCode: "INVALID_CONTEXT",
        errorMessage: "flagKey is required",
      });
    }

    const context = request.context || {};
    const targetingKey = getTargetingKey(context);
    if (!targetingKey) {
      return createOpenFeatureErrorDetails({
        flagKey: request.flagKey,
        defaultValue: request.defaultValue,
        errorCode: "TARGETING_KEY_MISSING",
        errorMessage: "The evaluation context must include targetingKey",
      });
    }

    const expectedType = request.flagValueType || getOpenFeatureValueType(request.defaultValue);
    const flag = await this.flags.getFlag(request.flagKey);
    if (!flag) {
      return createOpenFeatureErrorDetails({
        flagKey: request.flagKey,
        defaultValue: request.defaultValue,
        errorCode: "FLAG_NOT_FOUND",
        errorMessage: `Flag not found: ${request.flagKey}`,
      });
    }

    return this.evaluateFeatureFlag(flag, request, targetingKey, expectedType);
  }

  private async evaluateFeatureFlag(
    flag: FeatureFlag,
    request: OpenFeatureEvaluationRequest,
    targetingKey: string,
    expectedType: ReturnType<typeof getOpenFeatureValueType>,
  ): Promise<OpenFeatureEvaluationDetails> {
    if (!matchesEvaluationSite(flag.site_id, request.context)) {
      return createOpenFeatureErrorDetails({
        flagKey: request.flagKey,
        defaultValue: request.defaultValue,
        errorCode: "FLAG_NOT_FOUND",
        errorMessage: `Flag not found: ${request.flagKey}`,
      });
    }

    const result = await this.flags.evaluateFlag({
      flag_key: request.flagKey,
      user_id: targetingKey,
      attributes: request.context || {},
      default_value: request.defaultValue,
    });

    if (!matchesOpenFeatureValueType(result.value, expectedType)) {
      return createOpenFeatureErrorDetails({
        flagKey: request.flagKey,
        defaultValue: request.defaultValue,
        errorCode: "TYPE_MISMATCH",
        errorMessage: `Resolved value for ${request.flagKey} did not match requested type ${expectedType}`,
      });
    }

    return this.featureFlagResultToDetails(flag, result);
  }

  private featureFlagResultToDetails(flag: FeatureFlag, result: FlagEvaluationResponse): OpenFeatureEvaluationDetails {
    return createOpenFeatureDetails({
      flagKey: result.flag_key,
      value: result.value,
      reason: FLAG_REASON_MAP[result.reason] || "UNKNOWN",
      variant: result.variation_key,
      flagMetadata: {
        provider_name: "beacon",
        source: "feature_flag",
        flag_id: flag.id,
        flag_name: flag.name,
        flag_enabled: flag.enabled,
        kill_switch: flag.kill_switch,
        ...(result.experiment_id ? { experiment_id: result.experiment_id } : {}),
        ...(result.experiment_name ? { experiment_name: result.experiment_name } : {}),
        ...(result.variant_name ? { variant_name: result.variant_name } : {}),
      },
    });
  }
}
