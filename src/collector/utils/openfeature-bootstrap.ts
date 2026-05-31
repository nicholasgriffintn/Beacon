import type { OpenFeatureBootstrapRequest, OpenFeatureValueType } from "../types";
import { isRecord } from "./json.ts";

const OPENFEATURE_VALUE_TYPES = new Set<OpenFeatureValueType>(["boolean", "string", "number", "object"]);

interface ParseOpenFeatureBootstrapResult {
  request?: OpenFeatureBootstrapRequest;
  error?: {
    message: string;
    status: 400 | 413;
  };
}

function parseFlagValueType(value: unknown): OpenFeatureValueType | undefined {
  return typeof value === "string" && OPENFEATURE_VALUE_TYPES.has(value as OpenFeatureValueType)
    ? value as OpenFeatureValueType
    : undefined;
}

export function parseOpenFeatureBootstrapRequest(
  body: unknown,
  maxEvaluations: number,
): ParseOpenFeatureBootstrapResult {
  if (!isRecord(body)) {
    return { error: { message: "Invalid JSON payload", status: 400 } };
  }

  const context = isRecord(body.context) ? body.context : {};
  if (typeof context.targetingKey !== "string" || context.targetingKey.trim() === "") {
    return { error: { message: "context.targetingKey is required", status: 400 } };
  }

  if (!Array.isArray(body.evaluations) || body.evaluations.length === 0) {
    return { error: { message: "evaluations must contain at least one flag request", status: 400 } };
  }

  if (body.evaluations.length > maxEvaluations) {
    return { error: { message: `evaluations cannot exceed ${maxEvaluations} requests`, status: 413 } };
  }

  const evaluations = [];
  for (const evaluation of body.evaluations) {
    if (!isRecord(evaluation) || typeof evaluation.flagKey !== "string" || evaluation.flagKey.trim() === "") {
      return { error: { message: "each evaluation must include flagKey", status: 400 } };
    }

    if (!("defaultValue" in evaluation)) {
      return { error: { message: "each evaluation must include defaultValue", status: 400 } };
    }

    const flagValueType = parseFlagValueType(evaluation.flagValueType);
    if (evaluation.flagValueType !== undefined && !flagValueType) {
      return { error: { message: "flagValueType must be boolean, string, number, or object", status: 400 } };
    }

    evaluations.push({
      flagKey: evaluation.flagKey.trim(),
      defaultValue: evaluation.defaultValue,
      ...(flagValueType ? { flagValueType } : {}),
    });
  }

  return {
    request: {
      context,
      evaluations,
    },
  };
}
