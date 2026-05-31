import type { D1Database } from '@cloudflare/workers-types';

import type { 
  Experiment,
  ExperimentCreate,
  ExperimentUpdate,
  UserContext,
  Variant,
  VariantAssignment
} from '../types';
import { getDeterministicBucket } from '../utils/bucketing';
import { InputValidationError } from '../utils/errors';

export class ExperimentService {
  constructor(private readonly db: D1Database) {}

  async getExperiment(id: string): Promise<Experiment | null> {
    const stmt = this.db.prepare(
      `SELECT e.*, json_group_array(
        json_object(
          'id', v.id,
          'experiment_id', v.experiment_id,
          'name', v.name,
          'type', v.type,
          'config', v.config,
          'traffic_percentage', v.traffic_percentage
        )
      ) as variants
      FROM experiments e
      LEFT JOIN variants v ON e.id = v.experiment_id
      WHERE e.id = ?
      GROUP BY e.id`
    );
    
    const result = await stmt.bind(id).first();
    if (!result) return null;

    let variants: Variant[] = [];
    try {
      const parsedVariants = JSON.parse(result.variants as string);
      variants = parsedVariants[0]?.id ? parsedVariants.map(this.normalizeVariant) : [];
    } catch (error) {
      console.error('Error parsing variants:', error);
    }

    return {
      ...result,
      variants,
      targeting_rules: typeof result.targeting_rules === 'string' 
        ? JSON.parse(result.targeting_rules) 
        : result.targeting_rules || {}
    } as Experiment;
  }

  async listExperiments(): Promise<Experiment[]> {
    const stmt = this.db.prepare(
      `SELECT e.*, json_group_array(
        json_object(
          'id', v.id,
          'experiment_id', v.experiment_id,
          'name', v.name,
          'type', v.type,
          'config', v.config,
          'traffic_percentage', v.traffic_percentage
        )
      ) as variants
      FROM experiments e
      LEFT JOIN variants v ON e.id = v.experiment_id
      GROUP BY e.id`
    );
    
    const results = await stmt.all();

    if (!results.results) return [];

    return results.results.map(result => {
      let variants: Variant[] = [];
      try {
        const parsedVariants = JSON.parse(result.variants as string);
        variants = parsedVariants[0]?.id ? parsedVariants.map(this.normalizeVariant) : [];
      } catch (error) {
        console.error('Error parsing variants:', error);
      }

      return {
        ...result,
        variants,
        targeting_rules: typeof result.targeting_rules === 'string' 
          ? JSON.parse(result.targeting_rules) 
          : result.targeting_rules || {}
      } as Experiment;
    });
  }

  async createExperiment(experimentData: ExperimentCreate): Promise<Experiment> {
    this.validateExperimentCreate(experimentData);

    const id = crypto.randomUUID();
    
    await this.db.prepare('BEGIN TRANSACTION').run();
    
    try {
      await this.db.prepare(
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
      ).run();

      for (const variant of experimentData.variants) {
        await this.db.prepare(
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
        ).run();
      }

      await this.db.prepare('COMMIT').run();
      
      const createdExperiment = await this.getExperiment(id);
      if (!createdExperiment) {
        throw new Error('Failed to retrieve created experiment');
      }
      return createdExperiment;
    } catch (error) {
      await this.db.prepare('ROLLBACK').run();
      throw error;
    }
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

    const variantBucket = getDeterministicBucket(`${experiment.id}:${userContext.user_id}:variant`);
    
    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += variant.traffic_percentage;
      if (variantBucket < cumulative) {
        return variant;
      }
    }
    
    return null;
  }

  private normalizeVariant(variant: Variant): Variant {
    return {
      ...variant,
      config: typeof variant.config === "string"
        ? JSON.parse(variant.config)
        : variant.config || {},
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
