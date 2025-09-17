export interface ExperimentAssignment {
  experiment_id: string;
  variant_id: string;
}

export interface EventData {
  siteId: string;
  events?: Record<string, string>[];
  commonParams?: Record<string, string>;
  queryParams?: Record<string, string>;
  experiments?: ExperimentAssignment[];
  exp?: string; // Compact format: "expId:variantId;expId2:variantId2"
  [key: string]: unknown;
}

