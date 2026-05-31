import type {
  OpenFeatureErrorCode,
  OpenFeatureEvaluationDetails,
  OpenFeatureReason,
  OpenFeatureTrackingRequest,
  OpenFeatureValueType,
} from "../types/openfeature";
import type { EventData } from "../types/data";

export function getOpenFeatureValueType(value: unknown): OpenFeatureValueType {
  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    return "number";
  }

  return "object";
}

export function matchesOpenFeatureValueType(value: unknown, expectedType: OpenFeatureValueType): boolean {
  if (expectedType === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  return typeof value === expectedType;
}

export function createOpenFeatureDetails({
  flagKey,
  value,
  reason,
  variant,
  flagMetadata,
}: {
  flagKey: string;
  value: unknown;
  reason: OpenFeatureReason;
  variant?: string;
  flagMetadata?: OpenFeatureEvaluationDetails["flagMetadata"];
}): OpenFeatureEvaluationDetails {
  return {
    flagKey,
    value,
    reason,
    variant,
    flagMetadata: flagMetadata || {},
  };
}

export function createOpenFeatureErrorDetails({
  flagKey,
  defaultValue,
  errorCode,
  errorMessage,
}: {
  flagKey: string;
  defaultValue: unknown;
  errorCode: OpenFeatureErrorCode;
  errorMessage?: string;
}): OpenFeatureEvaluationDetails {
  return {
    flagKey,
    value: defaultValue,
    reason: "ERROR",
    errorCode,
    errorMessage,
    flagMetadata: {},
  };
}

export function getTargetingKey(context: Record<string, unknown> | undefined): string | null {
  const value = context?.targetingKey;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function getSiteIdFromEvaluationContext(context: Record<string, unknown> | undefined): string | null {
  const siteId = context?.siteId || context?.site_id;
  return typeof siteId === "string" && siteId.trim() !== "" ? siteId : null;
}

export function matchesEvaluationSite(definitionSiteId: string | null | undefined, context: Record<string, unknown> | undefined): boolean {
  if (!definitionSiteId) {
    return true;
  }

  return definitionSiteId === getSiteIdFromEvaluationContext(context);
}

function stringifyOpenFeatureProperty(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

export function createOpenFeatureTrackingEvent(request: OpenFeatureTrackingRequest): EventData | null {
  const context = request.context || {};
  const siteId = getSiteIdFromEvaluationContext(context);
  const targetingKey = getTargetingKey(context);

  if (!siteId || !targetingKey) {
    return null;
  }

  const details = request.details || {};
  const properties = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, stringifyOpenFeatureProperty(value)]),
  );
  const flagKey = stringifyOpenFeatureProperty(details.flagKey || properties.flag_key);
  const flagSource = stringifyOpenFeatureProperty(details.flagSource || properties.flag_source);
  const conversionId = stringifyOpenFeatureProperty(details.conversionId || properties.conversion_id || request.trackingEventName);
  const eventValue = typeof details.value === "number" ? details.value : 0;

  return {
    type: "event",
    s: siteId,
    ts: Date.now().toString(),
    vtag: "openfeature-1",
    r: "NA",
    re: "NA",
    lng: "NA",
    title: "NA",
    library_version: "beacon-openfeature",
    app_name: "beacon",
    app_type: "openfeature",
    user_id: targetingKey,
    p: "",
    ref: "",
    content_type: "openfeature",
    event_name: "feature_flag_tracking",
    event_category: "openfeature",
    event_label: request.trackingEventName,
    event_value: eventValue,
    non_interaction: false,
    event_type: "tracking",
    properties: {
      ...properties,
      tracking_event_name: request.trackingEventName,
      flag_key: flagKey,
      flag_source: flagSource,
      experiment_id: stringifyOpenFeatureProperty(details.experimentId || properties.experiment_id),
      conversion_id: conversionId,
      targeting_key: targetingKey,
    },
  };
}
