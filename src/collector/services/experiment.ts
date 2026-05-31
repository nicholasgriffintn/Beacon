import type { D1Database } from '@cloudflare/workers-types';

import type { 
  Experiment,
  ExperimentCreate,
  ExperimentUpdate,
  Variant,
} from '../types';
import { InputValidationError } from '../utils/errors.ts';
import { parseJsonRecord } from '../utils/json.ts';

interface ExperimentRow {
  id: string;
  flag_key?: string | null;
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

export class ExperimentService {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getExperiment(id: string): Promise<Experiment | null> {
    const result = await this.db
      .prepare("SELECT * FROM experiments WHERE id = ?")
      .bind(id)
      .first<ExperimentRow>();

    if (!result) return null;

    return this.normaliseExperiment(result, await this.listVariants(id));
  }

  async listExperiments(): Promise<Experiment[]> {
    const results = await this.db
      .prepare("SELECT * FROM experiments ORDER BY created_at DESC, name")
      .all<ExperimentRow>();

    return Promise.all(results.results.map(async (result) => {
      return this.normaliseExperiment(result, await this.listVariants(result.id));
    }));
  }

  private async listVariants(experimentId: string): Promise<Variant[]> {
    const variants = await this.db
      .prepare(`
        SELECT id, experiment_id, name, type, config, traffic_percentage
        FROM variants
        WHERE experiment_id = ?
        ORDER BY type, name, id
      `)
      .bind(experimentId)
      .all<VariantRow>();

    return variants.results.map(variant => this.normalizeVariant(variant));
  }

  private normaliseExperiment(row: ExperimentRow, variants: Variant[]): Experiment {
    return {
      id: row.id,
      flag_key: row.flag_key || row.id,
      name: row.name,
      description: row.description || undefined,
      type: row.type,
      status: row.status,
      site_id: row.site_id || undefined,
      targeting_rules: parseJsonRecord(row.targeting_rules),
      traffic_allocation: Number(row.traffic_allocation),
      start_time: row.start_time || undefined,
      end_time: row.end_time || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      started_at: row.started_at || undefined,
      ended_at: row.ended_at || undefined,
      stopped_reason: row.stopped_reason || undefined,
      variants,
    };
  }

  async createExperiment(experimentData: ExperimentCreate): Promise<Experiment> {
    this.validateExperimentCreate(experimentData);
    await this.validateExperimentFlag(experimentData.flag_key);

    const id = experimentData.id?.trim() || crypto.randomUUID();

    const statements = [
      this.db.prepare(
        `INSERT INTO experiments (
          id, flag_key, name, description, type, status, site_id,
          targeting_rules, traffic_allocation,
          start_time, end_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        experimentData.flag_key,
        experimentData.name,
        experimentData.description || null,
        experimentData.type,
        'draft',
        experimentData.site_id || null,
        JSON.stringify(experimentData.targeting_rules || {}),
        experimentData.traffic_allocation ?? 100,
        experimentData.start_time || null,
        experimentData.end_time || null
      ),
      ...experimentData.variants.map(variant => {
        return this.db.prepare(
          `INSERT INTO variants (
            id, experiment_id, name, type,
            config, traffic_percentage
          ) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          id,
          variant.name,
          variant.type,
          JSON.stringify(variant.config),
          variant.traffic_percentage
        );
      }),
    ];

    await this.db.batch(statements);

    const createdExperiment = await this.getExperiment(id);
    if (!createdExperiment) {
      throw new Error('Failed to retrieve created experiment');
    }
    return createdExperiment;
  }

  async updateExperiment(id: string, update: ExperimentUpdate): Promise<Experiment | null> {
    const experiment = await this.getExperiment(id);
    if (!experiment) return null;

    if (update.traffic_allocation !== undefined) {
      this.validatePercentage(update.traffic_allocation, "traffic_allocation");
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (update.name !== undefined) {
      updates.push('name = ?');
      values.push(update.name);
    }
    if (update.description !== undefined) {
      updates.push('description = ?');
      values.push(update.description);
    }
    if (update.type !== undefined) {
      this.validateExperimentType(update.type);
      updates.push('type = ?');
      values.push(update.type);
    }
    if (update.site_id !== undefined) {
      updates.push('site_id = ?');
      values.push(update.site_id || null);
    }
    if (update.targeting_rules !== undefined) {
      updates.push('targeting_rules = ?');
      values.push(JSON.stringify(update.targeting_rules));
    }
    if (update.traffic_allocation !== undefined) {
      updates.push('traffic_allocation = ?');
      values.push(update.traffic_allocation);
    }
    if (update.start_time !== undefined) {
      updates.push('start_time = ?');
      values.push(update.start_time);
    }
    if (update.end_time !== undefined) {
      updates.push('end_time = ?');
      values.push(update.end_time);
    }
    if (update.status !== undefined) {
      this.validateExperimentStatus(update.status);
      updates.push('status = ?');
      values.push(update.status);
      
      if (update.status !== experiment.status && update.status === 'running') {
        updates.push('started_at = CURRENT_TIMESTAMP');
      } else if (update.status !== experiment.status && (update.status === 'completed' || update.status === 'stopped')) {
        updates.push('ended_at = CURRENT_TIMESTAMP');
        if (update.stopped_reason) {
          updates.push('stopped_reason = ?');
          values.push(update.stopped_reason);
        }
      }
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const statements = [
      this.db.prepare(
        `UPDATE experiments SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values, id),
    ];

    if (update.variants !== undefined) {
      this.validateVariants(update.variants);
      const existingVariantIds = new Set(experiment.variants.map(variant => variant.id));
      const retainedVariantIds = new Set<string>();

      for (const variant of update.variants) {
        if (variant.id && existingVariantIds.has(variant.id)) {
          retainedVariantIds.add(variant.id);
          statements.push(
            this.db.prepare(`
              UPDATE variants
              SET name = ?, type = ?, config = ?, traffic_percentage = ?
              WHERE id = ? AND experiment_id = ?
            `).bind(
              variant.name,
              variant.type,
              JSON.stringify(variant.config),
              variant.traffic_percentage,
              variant.id,
              id,
            ),
          );
        } else {
          const variantId = crypto.randomUUID();
          retainedVariantIds.add(variantId);
          statements.push(
            this.db.prepare(`
              INSERT INTO variants (
                id, experiment_id, name, type,
                config, traffic_percentage
              ) VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
              variantId,
              id,
              variant.name,
              variant.type,
              JSON.stringify(variant.config),
              variant.traffic_percentage,
            ),
          );
        }
      }

      for (const variant of experiment.variants) {
        if (!retainedVariantIds.has(variant.id)) {
          statements.push(
            this.db.prepare("DELETE FROM variants WHERE id = ? AND experiment_id = ?")
              .bind(variant.id, id),
          );
        }
      }
    }

    await this.db.batch(statements);

    return await this.getExperiment(id);
  }

  async deleteExperiment(id: string): Promise<boolean> {
    const experiment = await this.getExperiment(id);
    if (!experiment) return false;

    await this.db.batch([
      this.db.prepare("DELETE FROM assignments WHERE experiment_id = ?").bind(id),
      this.db.prepare("DELETE FROM variants WHERE experiment_id = ?").bind(id),
      this.db.prepare("DELETE FROM experiment_metrics WHERE experiment_id = ?").bind(id),
      this.db.prepare("DELETE FROM experiments WHERE id = ?").bind(id),
    ]);

    return true;
  }

  private normalizeVariant(variant: VariantRow): Variant {
    return {
      id: variant.id,
      experiment_id: variant.experiment_id,
      name: variant.name,
      type: variant.type,
      config: parseJsonRecord(variant.config),
      traffic_percentage: Number(variant.traffic_percentage),
    };
  }

  private validateExperimentCreate(experimentData: ExperimentCreate): void {
    if (experimentData.id !== undefined && !/^[A-Za-z0-9_.:-]+$/.test(experimentData.id)) {
      throw new InputValidationError("id must be URL-safe");
    }

    if (!experimentData.flag_key) {
      throw new InputValidationError("flag_key is required");
    }

    if (!/^[A-Za-z0-9_.:-]+$/.test(experimentData.flag_key)) {
      throw new InputValidationError("flag_key must be a URL-safe OpenFeature flag key");
    }

    if (!experimentData.name) {
      throw new InputValidationError("name is required");
    }

    this.validateExperimentType(experimentData.type);
    this.validatePercentage(experimentData.traffic_allocation ?? 100, "traffic_allocation");
    this.validateVariants(experimentData.variants);
  }

  private validateVariants(variants: Array<{ name: string; type: Variant["type"]; traffic_percentage: number }>): void {
    if (!Array.isArray(variants) || variants.length < 2) {
      throw new InputValidationError("experiments require at least two variants");
    }

    let totalTraffic = 0;
    for (const variant of variants) {
      if (!variant.name) {
        throw new InputValidationError("each variant requires a name");
      }

      this.validateVariantType(variant.type);
      this.validatePercentage(variant.traffic_percentage, "variant traffic_percentage");
      totalTraffic += variant.traffic_percentage;
    }

    if (Math.round(totalTraffic * 100) / 100 !== 100) {
      throw new InputValidationError("variant traffic_percentage values must sum to 100");
    }
  }

  private validateExperimentType(type: Experiment["type"]): void {
    if (!["ab_test", "feature_flag", "holdout"].includes(type)) {
      throw new InputValidationError("type must be ab_test, feature_flag, or holdout");
    }
  }

  private validateExperimentStatus(status: Experiment["status"]): void {
    if (!["draft", "running", "paused", "completed", "stopped"].includes(status)) {
      throw new InputValidationError("status must be draft, running, paused, completed, or stopped");
    }
  }

  private validateVariantType(type: Variant["type"]): void {
    if (!["control", "treatment", "feature_flag"].includes(type)) {
      throw new InputValidationError("variant type must be control, treatment, or feature_flag");
    }
  }

  private async validateExperimentFlag(flagKey: string): Promise<void> {
    const flag = await this.db
      .prepare("SELECT flag_key FROM feature_flags WHERE flag_key = ?")
      .bind(flagKey)
      .first<{ flag_key: string }>();

    if (!flag) {
      throw new InputValidationError("experiments must be attached to an existing feature flag");
    }
  }

  private validatePercentage(value: number, field: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new InputValidationError(`${field} must be between 0 and 100`);
    }
  }
} 
