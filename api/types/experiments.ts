export type ExperimentType = 'ab_test' | 'feature_flag' | 'holdout';
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'stopped';
export type VariantType = 'control' | 'treatment' | 'feature_flag';
export type MetricDataType = 'continuous' | 'binary' | 'count';

export interface Experiment {
  id: string;
  name: string;
  description?: string;
  type: ExperimentType;
  status: ExperimentStatus;
  targeting_rules: Record<string, any>;
  traffic_allocation: number;
  start_time?: string;
  end_time?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  ended_at?: string;
  stopped_reason?: string;
  variants: Variant[];
}

export interface Variant {
  id: string;
  experiment_id: string;
  name: string;
  type: VariantType;
  config: Record<string, any>;
  traffic_percentage: number;
}

export interface UserContext {
  user_id: string;
  session_id?: string;
  attributes?: Record<string, any>;
}

export interface VariantAssignment {
  experiment_id: string;
  variant_id: string;
  variant_name: string;
  config: Record<string, any>;
}

export interface Metric {
  name: string;
  description?: string;
  data_type: MetricDataType;
  aggregation_method: string;
}

export interface ExperimentCreate {
  name: string;
  description?: string;
  type: ExperimentType;
  targeting_rules?: Record<string, any>;
  traffic_allocation?: number;
  start_time?: string;
  end_time?: string;
  variants: Array<Omit<Variant, 'id' | 'experiment_id'>>;
}

export interface ExperimentUpdate {
  name?: string;
  description?: string;
  targeting_rules?: Record<string, any>;
  traffic_allocation?: number;
  start_time?: string;
  end_time?: string;
  status?: ExperimentStatus;
  stopped_reason?: string;
} 