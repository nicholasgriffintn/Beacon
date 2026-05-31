export type OpenFeatureValueType = "boolean" | "string" | "number" | "object";

export type OpenFeatureReason =
  | "STATIC"
  | "DEFAULT"
  | "TARGETING_MATCH"
  | "SPLIT"
  | "CACHED"
  | "DISABLED"
  | "UNKNOWN"
  | "STALE"
  | "ERROR";

export type OpenFeatureErrorCode =
  | "PROVIDER_NOT_READY"
  | "FLAG_NOT_FOUND"
  | "PARSE_ERROR"
  | "TYPE_MISMATCH"
  | "TARGETING_KEY_MISSING"
  | "INVALID_CONTEXT"
  | "PROVIDER_FATAL"
  | "GENERAL";

export type OpenFeatureFlagMetadataValue = boolean | string | number;

export interface OpenFeatureEvaluationContext {
  targetingKey?: string;
  siteId?: string;
  site_id?: string;
  [key: string]: unknown;
}

export interface OpenFeatureEvaluationRequest {
  flagKey: string;
  defaultValue: unknown;
  context?: OpenFeatureEvaluationContext;
  flagValueType?: OpenFeatureValueType;
}

export interface OpenFeatureEvaluationDetails {
  flagKey: string;
  value: unknown;
  reason?: OpenFeatureReason;
  variant?: string;
  errorCode?: OpenFeatureErrorCode;
  errorMessage?: string;
  flagMetadata: Record<string, OpenFeatureFlagMetadataValue>;
}

export interface OpenFeatureTrackingEventDetails {
  value?: number;
  flagKey?: string;
  conversionId?: string;
  [key: string]: unknown;
}

export interface OpenFeatureTrackingRequest {
  trackingEventName: string;
  context?: OpenFeatureEvaluationContext;
  details?: OpenFeatureTrackingEventDetails;
}
