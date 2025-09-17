export type FlagReason = 'targeting' | 'rollout' | 'default' | 'kill_switch' | 'disabled';

export interface TargetingRule {
  id: string;
  description?: string;
  conditions: TargetingCondition[];
  variation_key: string;
  rollout_percentage?: number; // 0-100, for gradual rollout within this rule
}

export interface TargetingCondition {
  attribute: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'matches' | 'not_matches';
  values: (string | number | boolean)[];
}

export interface FlagVariation {
  key: string;
  value: any;
  name?: string;
  description?: string;
}

export interface FeatureFlag {
  id: string;
  flag_key: string;
  name: string;
  description?: string;
  site_id?: string;
  enabled: boolean;
  kill_switch: boolean;
  default_value: any;
  targeting_rules: TargetingRule[];
  rollout_percentage: number;
  variations: FlagVariation[];
  created_at: string;
  updated_at: string;
}

export interface FlagCreate {
  flag_key: string;
  name: string;
  description?: string;
  site_id?: string;
  enabled?: boolean;
  default_value?: any;
  targeting_rules?: TargetingRule[];
  rollout_percentage?: number;
  variations?: FlagVariation[];
}

export interface FlagUpdate {
  name?: string;
  description?: string;
  enabled?: boolean;
  kill_switch?: boolean;
  default_value?: any;
  targeting_rules?: TargetingRule[];
  rollout_percentage?: number;
  variations?: FlagVariation[];
}

export interface FlagEvaluation {
  id: string;
  flag_id: string;
  flag_key: string;
  user_id: string;
  variation_key?: string;
  variation_value: any;
  reason: FlagReason;
  context: Record<string, any>;
  evaluated_at: string;
}

export interface FlagEvaluationRequest {
  flag_key: string;
  user_id: string;
  attributes?: Record<string, any>;
  default_value?: any;
}

export interface FlagEvaluationResponse {
  flag_key: string;
  user_id: string;
  variation_key?: string;
  value: any;
  reason: FlagReason;
  enabled: boolean;
  cached?: boolean;
}

export interface BulkFlagEvaluationRequest {
  user_id: string;
  attributes?: Record<string, any>;
  flag_keys?: string[]; // If not provided, evaluates all flags
}

export interface BulkFlagEvaluationResponse {
  user_id: string;
  flags: Record<string, FlagEvaluationResponse>;
  evaluated_at: string;
}
