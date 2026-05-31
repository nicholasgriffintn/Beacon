import type { D1Database, R2Bucket, KVNamespace } from "@cloudflare/workers-types";

import type { AnalyticsFullEventData, Experiment, Variant } from "../types";
import { parseExperimentAssignments } from "../utils/experiments.ts";
import { parseJsonRecord } from "../utils/json.ts";

interface VariantMetrics {
  total_users: number;
  exposed_users: number;
  conversion_count: number;
  converted_users: number;
  conversion_rate: number;
  conversion_value: number;
  average_order_value: number;
}

interface VariantStatistics {
  statistical_significance: boolean;
  confidence_interval: {
    lower: number;
    upper: number;
  };
  p_value?: number;
}

interface VariantResult {
  variant_id: string;
  variant_name: string;
  metrics: VariantMetrics;
  statistics: VariantStatistics;
}

interface ExperimentResults {
  experiment_id: string;
  experiment_name: string;
  generated_at: string;
  source: "d1";
  variants: VariantResult[];
  summary: {
    total_users: number;
    total_conversions: number;
    recommended_action: string;
  };
}

interface EventRecord {
  experiment_id: string;
  variant_id?: string;
  variant_name?: string;
  user_id: string;
  event_name: string;
  event_type: "exposure" | "conversion" | "event";
  conversion_id?: string;
  value: number;
  properties: Record<string, unknown>;
  occurred_at: string;
}

interface ExperimentRow {
  id: string;
  name: string;
  description?: string | null;
  type: Experiment["type"];
  status: Experiment["status"];
  site_id?: string | null;
  targeting_rules: unknown;
  traffic_allocation: number;
  start_time?: string | null;
  end_time?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  stopped_reason?: string | null;
}

interface VariantRow {
  id: string;
  experiment_id: string;
  name: string;
  type: Variant["type"];
  config: unknown;
  traffic_percentage: number;
}

function getProperty(properties: Record<string, unknown>, key: string): string | undefined {
  const value = properties[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function classifyEvent(eventName: string): EventRecord["event_type"] {
  if (eventName === "experiment_exposure") {
    return "exposure";
  }

  if (eventName === "experiment_conversion") {
    return "conversion";
  }

  return "event";
}

function getConversionId(properties: Record<string, unknown>, eventName: string, eventLabel: string): string | undefined {
  const explicitConversionId = getProperty(properties, "conversion_id");
  if (explicitConversionId) {
    return explicitConversionId;
  }

  if (eventLabel && eventLabel !== eventName && eventLabel !== "event" && eventLabel !== "NA") {
    return eventLabel;
  }

  return undefined;
}

function timestampForPath(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "_");
}

export function getWilsonInterval(successes: number, total: number): { lower: number; upper: number } {
  if (total <= 0) {
    return { lower: 0, upper: 0 };
  }

  const z = 1.96;
  const rate = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = rate + (z * z) / (2 * total);
  const margin = z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * total)) / total);

  return {
    lower: Math.max(0, (centre - margin) / denominator),
    upper: Math.min(1, (centre + margin) / denominator),
  };
}

export function createRecommendedAction(results: VariantResult[]): string {
  if (results.length === 0) {
    return "No assignment data is available yet.";
  }

  const totalUsers = results.reduce((sum, result) => sum + result.metrics.total_users, 0);
  if (totalUsers < 100) {
    return "Keep collecting data before making a decision.";
  }

  const best = [...results].sort((left, right) => {
    return right.metrics.conversion_rate - left.metrics.conversion_rate;
  })[0];

  if (!best || best.metrics.conversion_count === 0) {
    return "No conversions have been recorded yet.";
  }

  return `Review ${best.variant_name}; it currently has the highest observed conversion rate.`;
}

export class ExperimentResultsService {
  private readonly db: D1Database;
  private readonly bucket: R2Bucket;
  private readonly kv: KVNamespace;

  constructor(db: D1Database, bucket: R2Bucket, kv: KVNamespace) {
    this.db = db;
    this.bucket = bucket;
    this.kv = kv;
  }

  async recordExperimentEvents(event: AnalyticsFullEventData): Promise<void> {
    const records = this.extractEventRecords(event);
    if (records.length === 0) {
      return;
    }

    const statements = records.map(record => {
      return this.db
        .prepare(`
          INSERT INTO experiment_events (
            id, experiment_id, variant_id, variant_name, user_id,
            event_name, event_type, conversion_id, value, properties, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          crypto.randomUUID(),
          record.experiment_id,
          record.variant_id || null,
          record.variant_name || null,
          record.user_id,
          record.event_name,
          record.event_type,
          record.conversion_id || null,
          record.value,
          JSON.stringify(record.properties),
          record.occurred_at,
        );
    });

    await this.db.batch(statements);
  }

  async generateResults(experimentId: string): Promise<ExperimentResults | null> {
    const experiment = await this.getExperiment(experimentId);
    if (!experiment) {
      return null;
    }

    const variants = await this.getVariantResults(experiment);
    const results: ExperimentResults = {
      experiment_id: experiment.id,
      experiment_name: experiment.name,
      generated_at: new Date().toISOString(),
      source: "d1",
      variants,
      summary: {
        total_users: variants.reduce((sum, variant) => sum + variant.metrics.total_users, 0),
        total_conversions: variants.reduce((sum, variant) => sum + variant.metrics.conversion_count, 0),
        recommended_action: createRecommendedAction(variants),
      },
    };

    await this.publishResults(experiment.id, results);
    return results;
  }

  private extractEventRecords(event: AnalyticsFullEventData): EventRecord[] {
    const eventName = event.event_data.event_name;
    const eventType = classifyEvent(eventName);
    const properties = event.properties || {};
    const explicitExperimentId = getProperty(properties, "experiment_id");
    const explicitVariantId = getProperty(properties, "variant_id");
    const explicitVariantName = getProperty(properties, "variant_name");
    const conversionId = getConversionId(properties, eventName, event.event_data.event_label);
    const assignments = parseExperimentAssignments([], event.experiment_assignments);

    if (explicitExperimentId) {
      return [{
        experiment_id: explicitExperimentId,
        variant_id: explicitVariantId,
        variant_name: explicitVariantName,
        user_id: event.session_data.user_id,
        event_name: eventName,
        event_type: eventType,
        conversion_id: eventType === "conversion" ? conversionId : undefined,
        value: event.event_data.event_value,
        properties,
        occurred_at: event.timestamp,
      }];
    }

    return assignments.map(assignment => ({
      experiment_id: assignment.experiment_id,
      variant_id: assignment.variant_id,
      user_id: event.session_data.user_id,
      event_name: eventName,
      event_type: eventType,
      conversion_id: eventType === "conversion" ? conversionId : undefined,
      value: event.event_data.event_value,
      properties,
      occurred_at: event.timestamp,
    }));
  }

  private async getExperiment(experimentId: string): Promise<Experiment | null> {
    const result = await this.db
      .prepare("SELECT * FROM experiments WHERE id = ?")
      .bind(experimentId)
      .first<ExperimentRow>();

    if (!result) {
      return null;
    }

    const variants = await this.db
      .prepare("SELECT * FROM variants WHERE experiment_id = ? ORDER BY type, name")
      .bind(experimentId)
      .all<VariantRow>();

    return {
      id: result.id,
      name: result.name,
      description: result.description || undefined,
      type: result.type,
      status: result.status,
      site_id: result.site_id || undefined,
      targeting_rules: parseJsonRecord(result.targeting_rules),
      traffic_allocation: Number(result.traffic_allocation),
      start_time: result.start_time || undefined,
      end_time: result.end_time || undefined,
      created_at: result.created_at,
      updated_at: result.updated_at,
      started_at: result.started_at || undefined,
      ended_at: result.ended_at || undefined,
      stopped_reason: result.stopped_reason || undefined,
      variants: variants.results.map(variant => ({
        id: variant.id,
        experiment_id: variant.experiment_id,
        name: variant.name,
        type: variant.type,
        config: parseJsonRecord(variant.config),
        traffic_percentage: Number(variant.traffic_percentage),
      })),
    };
  }

  private async getVariantResults(experiment: Experiment): Promise<VariantResult[]> {
    return Promise.all(experiment.variants.map(async variant => {
      const assignmentRow = await this.db
        .prepare(`
          SELECT COUNT(DISTINCT user_id) as total_users
          FROM assignments
          WHERE experiment_id = ? AND variant_id = ?
        `)
        .bind(experiment.id, variant.id)
        .first<{ total_users: number }>();

      const exposureRow = await this.db
        .prepare(`
          SELECT COUNT(DISTINCT user_id) as exposed_users
          FROM experiment_events
          WHERE experiment_id = ? AND variant_id = ? AND event_type = 'exposure'
        `)
        .bind(experiment.id, variant.id)
        .first<{ exposed_users: number }>();

      const conversionRow = await this.db
        .prepare(`
          SELECT
            COUNT(*) as conversion_count,
            COUNT(DISTINCT user_id) as converted_users,
            COALESCE(SUM(value), 0) as conversion_value
          FROM (
            SELECT
              COALESCE(conversion_id, id) as conversion_key,
              MIN(user_id) as user_id,
              MAX(value) as value
            FROM experiment_events
            WHERE experiment_id = ? AND variant_id = ? AND event_type = 'conversion'
            GROUP BY COALESCE(conversion_id, id)
          )
        `)
        .bind(experiment.id, variant.id)
        .first<{
          conversion_count: number;
          converted_users: number;
          conversion_value: number;
        }>();

      const totalUsers = Number(assignmentRow?.total_users || 0);
      const conversionCount = Number(conversionRow?.conversion_count || 0);
      const convertedUsers = Number(conversionRow?.converted_users || 0);
      const conversionValue = Number(conversionRow?.conversion_value || 0);
      const conversionRate = totalUsers > 0 ? convertedUsers / totalUsers : 0;

      return {
        variant_id: variant.id,
        variant_name: variant.name,
        metrics: {
          total_users: totalUsers,
          exposed_users: Number(exposureRow?.exposed_users || 0),
          conversion_count: conversionCount,
          converted_users: convertedUsers,
          conversion_rate: conversionRate,
          conversion_value: conversionValue,
          average_order_value: conversionCount > 0 ? conversionValue / conversionCount : 0,
        },
        statistics: {
          statistical_significance: false,
          confidence_interval: getWilsonInterval(convertedUsers, totalUsers),
        },
      };
    }));
  }

  private async publishResults(experimentId: string, results: ExperimentResults): Promise<void> {
    const content = JSON.stringify(results, null, 2);
    const timestamp = timestampForPath();

    await Promise.all([
      this.bucket.put(`experiment-results/${experimentId}/${timestamp}.json`, content, {
        httpMetadata: {
          contentType: "application/json",
          cacheControl: "public, max-age=86400",
        },
      }),
      this.bucket.put(`experiment-results/${experimentId}/latest.json`, content, {
        httpMetadata: {
          contentType: "application/json",
          cacheControl: "public, max-age=1800",
        },
      }),
      this.kv.delete(`experiment_results:${experimentId}`),
    ]);
  }
}
