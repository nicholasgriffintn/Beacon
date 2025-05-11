import type { D1Database } from '@cloudflare/workers-types';
import type { 
  Experiment,
  ExperimentCreate,
  ExperimentUpdate,
  UserContext,
  Variant,
  VariantAssignment
} from '../types';

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
    if (!result?.variants) return null;

    let variants: Variant[] = [];
    try {
      variants = JSON.parse(result.variants);
    } catch (error) {
      console.error('Error parsing variants:', error);
    }

    return {
      ...result,
      variants: variants[0].id ? variants : [],
    };
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

    if (!results?.variants) return [];

    let variants: Variant[] = [];
    try {
      variants = JSON.parse(results.variants);
    } catch (error) {
      console.error('Error parsing variants:', error);
    }

    return results.results.map(result => ({
      ...result,
      variants: variants[0].id ? variants : [],
    }));
  }

  async createExperiment(experiment: ExperimentCreate): Promise<Experiment> {
    const id = crypto.randomUUID();
    
    await this.db.prepare('BEGIN TRANSACTION').run();
    
    try {
      await this.db.prepare(
        `INSERT INTO experiments (
          id, name, description, type, status,
          targeting_rules, traffic_allocation,
          start_time, end_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        experiment.name,
        experiment.description || null,
        experiment.type,
        'draft',
        JSON.stringify(experiment.targeting_rules || {}),
        experiment.traffic_allocation || 100,
        experiment.start_time || null,
        experiment.end_time || null
      ).run();

      for (const variant of experiment.variants) {
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
      
      return await this.getExperiment(id);
    } catch (error) {
      await this.db.prepare('ROLLBACK').run();
      throw error;
    }
  }

  async updateExperiment(id: string, update: ExperimentUpdate): Promise<Experiment | null> {
    const experiment = await this.getExperiment(id);
    if (!experiment) return null;

    const updates: string[] = [];
    const values: any[] = [];

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

  async assignVariant(experimentId: string, userContext: UserContext): Promise<VariantAssignment | null> {
    const experiment = await this.getExperiment(experimentId);
    if (!experiment || experiment.status !== 'running') {
      return null;
    }

    const existingAssignment = await this.db
      .prepare('SELECT * FROM assignments WHERE experiment_id = ? AND user_id = ?')
      .bind(experimentId, userContext.user_id)
      .first();

    if (existingAssignment) {
      const variant = experiment.variants.find(v => v.id === existingAssignment.variant_id);
      return variant ? {
        experiment_id: experimentId,
        variant_id: variant.id,
        variant_name: variant.name,
        config: variant.config
      } : null;
    }

    const variant = this.determineVariant(experiment, userContext);
    if (!variant) return null;

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
    const hash = this.hashString(`${userContext.user_id}:${experiment.id}`);
    const normalizedHash = Number.parseInt(hash.substring(0, 8), 16) / 0xffffffff;
    
    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += variant.traffic_percentage / 100;
      if (normalizedHash < cumulative) {
        return variant;
      }
    }
    
    return experiment.variants[0] || null;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
} 