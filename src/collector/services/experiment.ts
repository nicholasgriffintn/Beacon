import type { D1Database } from '@cloudflare/workers-types';

import type { 
  Experiment,
  ExperimentCreate,
  ExperimentUpdate,
  UserContext,
  Variant,
  VariantAssignment
} from '../types';
import { getDeterministicBucket } from '../utils/bucketing.ts';
import { InputValidationError } from '../utils/errors.ts';
import { parseJsonRecord } from '../utils/json.ts';
import { selectVariantForUser } from '../utils/variant-allocation.ts';

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

    const id = crypto.randomUUID();

    const statements = [
      this.db.prepare(
        `INSERT INTO experiments (
          id, name, description, type, status, site_id,
          targeting_rules, traffic_allocation,
          start_time, end_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
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
      updates.push('status = ?');
      values.push(update.status);
      
      if (update.status === 'running') {
        updates.push('started_at = CURRENT_TIMESTAMP');
      } else if (update.status === 'completed' || update.status === 'stopped') {
        updates.push('ended_at = CURRENT_TIMESTAMP');
        if (update.stopped_reason) {
          updates.push('stopped_reason = ?');
          values.push(update.stopped_reason);
        }
      }
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    if (updates.length > 0) {
      await this.db.prepare(
        `UPDATE experiments SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values, id).run();
    }

    return await this.getExperiment(id);
  }

  async assignVariant(experimentId: string, userContext: UserContext): Promise<VariantAssignment | { message: string }> {
    const experiment = await this.getExperiment(experimentId);
    if (!experiment || !this.isAssignable(experiment)) {
      return {
        message: 'Experiment not found or not running'
      };
    }

    const existingAssignment = await this.db
      .prepare('SELECT * FROM assignments WHERE experiment_id = ? AND user_id = ?')
      .bind(experimentId, userContext.user_id)
      .first();

    if (existingAssignment) {
      const variant = experiment.variants.find(v => v.id === existingAssignment.variant_id);

      if (!variant) {
        return {
          message: "No existing variant found",
        };
      }

      return {
        experiment_id: experimentId,
        variant_id: variant.id,
        variant_name: variant.name,
        config: variant.config
      };
    }

    const variant = this.determineVariant(experiment, userContext);
    if (!variant) {
      return {
        message: "No variant found",
      };
    }

    await this.db
      .prepare(
        'INSERT INTO assignments (id, experiment_id, variant_id, user_id, context) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(
        crypto.randomUUID(),
        experimentId,
        variant.id,
        userContext.user_id,
        JSON.stringify(userContext.attributes || {})
      )
      .run();

    return {
      experiment_id: experimentId,
      variant_id: variant.id,
      variant_name: variant.name,
      config: variant.config
    };
  }

  private determineVariant(experiment: Experiment, userContext: UserContext): Variant | null {
    const experimentBucket = getDeterministicBucket(`${experiment.id}:${userContext.user_id}:allocation`);
    if (experimentBucket >= experiment.traffic_allocation) {
      return null;
    }

    return selectVariantForUser(experiment.id, experiment.variants, userContext);
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

  private isAssignable(experiment: Experiment): boolean {
    if (experiment.status !== 'running') {
      return false;
    }

    const now = Date.now();

    if (experiment.start_time && Date.parse(experiment.start_time) > now) {
      return false;
    }

    if (experiment.end_time && Date.parse(experiment.end_time) <= now) {
      return false;
    }

    return true;
  }

  private validateExperimentCreate(experimentData: ExperimentCreate): void {
    if (!experimentData.name) {
      throw new InputValidationError("name is required");
    }

    this.validatePercentage(experimentData.traffic_allocation ?? 100, "traffic_allocation");

    if (!Array.isArray(experimentData.variants) || experimentData.variants.length < 2) {
      throw new InputValidationError("experiments require at least two variants");
    }

    let totalTraffic = 0;
    for (const variant of experimentData.variants) {
      if (!variant.name) {
        throw new InputValidationError("each variant requires a name");
      }

      this.validatePercentage(variant.traffic_percentage, "variant traffic_percentage");
      totalTraffic += variant.traffic_percentage;
    }

    if (Math.round(totalTraffic * 100) / 100 !== 100) {
      throw new InputValidationError("variant traffic_percentage values must sum to 100");
    }
  }

  private validatePercentage(value: number, field: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new InputValidationError(`${field} must be between 0 and 100`);
    }
  }
} 
