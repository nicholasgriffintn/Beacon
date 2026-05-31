import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

import type { 
  FeatureFlag, 
  FlagCreate, 
  FlagUpdate, 
  FlagEvaluationRequest,
  FlagEvaluationResponse,
  Experiment,
  TargetingRule,
  TargetingCondition,
  Variant,
} from "../types";
import { getDeterministicBucket, hashToUint32, isInPercentageBucket, stableStringify } from "../utils/bucketing.ts";
import { InputValidationError } from "../utils/errors.ts";
import { parseJsonRecord } from "../utils/json.ts";
import { selectVariantForTargetingKey } from "../utils/variant-allocation.ts";

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

export class FeatureFlagService {
  private db: D1Database;
  private kv?: KVNamespace;
  private readonly CACHE_TTL = 5 * 60; // 5 minutes
  private readonly EVALUATION_CACHE_TTL = 60; // 1 minute for evaluations

  constructor(db: D1Database, kv?: KVNamespace) {
    this.db = db;
    this.kv = kv;
  }

  private generateId(): string {
    return `flag_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  private getCacheKey(flagKey: string): string {
    return `flag:${flagKey}`;
  }

  private getEvaluationCacheKey(flagKey: string, userId: string, attributes: Record<string, any>, defaultValue: any): string {
    const contextHash = hashToUint32(stableStringify({ attributes, default_value: defaultValue })).toString(16);
    return `flag_eval:${flagKey}:${userId}:${contextHash}`;
  }

  private async getFromCache(flagKey: string): Promise<FeatureFlag | null> {
    if (!this.kv) {
      return null;
    }

    try {
      const cached = await this.kv.get(this.getCacheKey(flagKey), "json");
      return cached as FeatureFlag | null;
    } catch {
      return null;
    }
  }

  private async setCache(flagKey: string, flag: FeatureFlag): Promise<void> {
    if (!this.kv) {
      return;
    }

    try {
      await this.kv.put(this.getCacheKey(flagKey), JSON.stringify(flag), { 
        expirationTtl: this.CACHE_TTL 
      });
    } catch {
      // Ignore cache failures
    }
  }

  private async invalidateCache(flagKey: string): Promise<void> {
    if (!this.kv) {
      return;
    }

    try {
      await this.kv.delete(this.getCacheKey(flagKey));
    } catch {
      // Ignore cache failures
    }
  }

  private evaluateCondition(condition: TargetingCondition, attributes: Record<string, any>): boolean {
    const attributeValue = attributes[condition.attribute];
    
    if (attributeValue === undefined) {
      return false;
    }

    switch (condition.operator) {
      case 'equals':
        return condition.values.includes(attributeValue);
      
      case 'not_equals':
        return !condition.values.includes(attributeValue);
      
      case 'in':
        return condition.values.includes(attributeValue);
      
      case 'not_in':
        return !condition.values.includes(attributeValue);
      
      case 'contains':
        if (typeof attributeValue !== 'string') return false;
        return condition.values.some(value => 
          String(attributeValue).includes(String(value))
        );
      
      case 'not_contains':
        if (typeof attributeValue !== 'string') return true;
        return !condition.values.some(value => 
          String(attributeValue).includes(String(value))
        );
      
      case 'greater_than':
        return condition.values.some(value => Number(attributeValue) > Number(value));
      
      case 'less_than':
        return condition.values.some(value => Number(attributeValue) < Number(value));
      
      case 'matches':
        if (typeof attributeValue !== 'string') return false;
        return condition.values.some(value => {
          try {
            const regex = new RegExp(String(value));
            return regex.test(String(attributeValue));
          } catch {
            return false;
          }
        });
      
      case 'not_matches':
        if (typeof attributeValue !== 'string') return true;
        return !condition.values.some(value => {
          try {
            const regex = new RegExp(String(value));
            return regex.test(String(attributeValue));
          } catch {
            return false;
          }
        });
      
      default:
        return false;
    }
  }

  private evaluateTargetingRule(rule: TargetingRule, attributes: Record<string, any>): boolean {
    return rule.conditions.every(condition => 
      this.evaluateCondition(condition, attributes)
    );
  }

  private isInRollout(userId: string, flagKey: string, percentage: number): boolean {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;

    return isInPercentageBucket(`${flagKey}:${userId}`, percentage);
  }

  private getContextSiteId(attributes: Record<string, any>): string | null {
    const siteId = attributes.siteId || attributes.site_id;
    return typeof siteId === "string" && siteId ? siteId : null;
  }

  private async getActiveExperimentForFlag(flagKey: string, siteId: string | null): Promise<Experiment | null> {
    const experiments = await this.db
      .prepare(`
        SELECT *
        FROM experiments
        WHERE flag_key = ? AND status = 'running'
        ORDER BY updated_at DESC, created_at DESC
      `)
      .bind(flagKey)
      .all<ExperimentRow>();

    const row = experiments.results.find(experiment => {
      return (!experiment.site_id || experiment.site_id === siteId) && this.isExperimentAssignable(experiment);
    });

    if (!row) {
      return null;
    }

    const variants = await this.db
      .prepare(`
        SELECT id, experiment_id, name, type, config, traffic_percentage
        FROM variants
        WHERE experiment_id = ?
        ORDER BY type, name, id
      `)
      .bind(row.id)
      .all<VariantRow>();

    return {
      id: row.id,
      flag_key: row.flag_key || flagKey,
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

  private isExperimentAssignable(experiment: ExperimentRow): boolean {
    const now = Date.now();

    if (experiment.start_time && Date.parse(experiment.start_time) > now) {
      return false;
    }

    if (experiment.end_time && Date.parse(experiment.end_time) <= now) {
      return false;
    }

    return true;
  }

  private getExperimentVariantValue(variant: Variant): unknown {
    if (Object.prototype.hasOwnProperty.call(variant.config, "value")) {
      return variant.config.value;
    }

    return variant.config;
  }

  private async evaluateExperimentAllocation(
    flag: FeatureFlag,
    userId: string,
    attributes: Record<string, any>,
  ): Promise<FlagEvaluationResponse | null> {
    const experiment = await this.getActiveExperimentForFlag(flag.flag_key, this.getContextSiteId(attributes));
    if (!experiment) {
      return null;
    }

    const allocationBucket = getDeterministicBucket(`${experiment.id}:${userId}:allocation`);
    if (allocationBucket >= experiment.traffic_allocation) {
      return null;
    }

    const existingAssignment = await this.db
      .prepare("SELECT * FROM assignments WHERE experiment_id = ? AND user_id = ?")
      .bind(experiment.id, userId)
      .first<{ variant_id: string }>();
    const assignedVariant = existingAssignment
      ? experiment.variants.find(variant => variant.id === existingAssignment.variant_id)
      : null;
    const variant = assignedVariant || selectVariantForTargetingKey(experiment.id, experiment.variants, userId);

    if (!variant) {
      return null;
    }

    if (!existingAssignment) {
      await this.db
        .prepare("INSERT OR IGNORE INTO assignments (id, experiment_id, variant_id, user_id, context) VALUES (?, ?, ?, ?, ?)")
        .bind(
          crypto.randomUUID(),
          experiment.id,
          variant.id,
          userId,
          JSON.stringify(attributes),
        )
        .run();
    }

    return {
      flag_key: flag.flag_key,
      user_id: userId,
      variation_key: variant.id,
      variant_name: variant.name,
      value: this.getExperimentVariantValue(variant),
      reason: "rollout",
      enabled: true,
      experiment_id: experiment.id,
      experiment_name: experiment.name,
    };
  }

  private evaluateFlagRules(
    flag: FeatureFlag,
    userId: string,
    attributes: Record<string, any>,
  ): FlagEvaluationResponse {
    let matchedRule: TargetingRule | null = null;

    for (const rule of flag.targeting_rules) {
      if (!this.evaluateTargetingRule(rule, attributes)) {
        continue;
      }

      if (rule.rollout_percentage !== undefined && !this.isInRollout(userId, `${flag.flag_key}${rule.id}`, rule.rollout_percentage)) {
        continue;
      }

      matchedRule = rule;
      break;
    }

    if (matchedRule) {
      const variation = flag.variations.find(v => v.key === matchedRule.variation_key);
      return {
        flag_key: flag.flag_key,
        user_id: userId,
        variation_key: matchedRule.variation_key,
        value: variation?.value ?? flag.default_value,
        reason: 'targeting',
        enabled: true,
      };
    }

    if (this.isInRollout(userId, flag.flag_key, flag.rollout_percentage)) {
      const variation = flag.variations[0];
      return {
        flag_key: flag.flag_key,
        user_id: userId,
        variation_key: variation?.key,
        value: variation?.value ?? flag.default_value,
        reason: 'rollout',
        enabled: true,
      };
    }

    return {
      flag_key: flag.flag_key,
      user_id: userId,
      value: flag.default_value,
      reason: 'default',
      enabled: true,
    };
  }

  async getFlag(flagKey: string): Promise<FeatureFlag | null> {
    const cached = await this.getFromCache(flagKey);
    if (cached) {
      return cached;
    }

    const result = await this.db
      .prepare("SELECT * FROM feature_flags WHERE flag_key = ?")
      .bind(flagKey)
      .first();

    if (!result) {
      return null;
    }

    const flag: FeatureFlag = {
      ...result,
      targeting_rules: JSON.parse(result.targeting_rules as string),
      variations: JSON.parse(result.variations as string),
      default_value: JSON.parse(result.default_value as string)
    } as FeatureFlag;

    await this.setCache(flagKey, flag);
    return flag;
  }

  async listFlags(): Promise<FeatureFlag[]> {
    const results = await this.db
      .prepare("SELECT * FROM feature_flags ORDER BY created_at DESC")
      .all();

    return results.results.map(row => ({
      ...row,
      targeting_rules: JSON.parse(row.targeting_rules as string),
      variations: JSON.parse(row.variations as string),
      default_value: JSON.parse(row.default_value as string)
    })) as FeatureFlag[];
  }

  async createFlag(data: FlagCreate): Promise<FeatureFlag> {
    if (data.rollout_percentage !== undefined && (data.rollout_percentage < 0 || data.rollout_percentage > 100)) {
      throw new InputValidationError("rollout_percentage must be between 0 and 100");
    }

    const id = this.generateId();
    const now = new Date().toISOString();
    
    const flag: FeatureFlag = {
      id,
      flag_key: data.flag_key,
      name: data.name,
      description: data.description,
      site_id: data.site_id,
      enabled: data.enabled ?? true,
      kill_switch: false,
      default_value: data.default_value ?? false,
      targeting_rules: data.targeting_rules || [],
      rollout_percentage: data.rollout_percentage || 0,
      variations: data.variations || [],
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(`
        INSERT INTO feature_flags (id, flag_key, name, description, site_id, enabled, kill_switch, 
                                 default_value, targeting_rules, rollout_percentage, variations, 
                                 created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        flag.id,
        flag.flag_key,
        flag.name,
        flag.description || null,
        flag.site_id || null,
        flag.enabled,
        flag.kill_switch,
        JSON.stringify(flag.default_value),
        JSON.stringify(flag.targeting_rules),
        flag.rollout_percentage,
        JSON.stringify(flag.variations),
        flag.created_at,
        flag.updated_at
      )
      .run();

    return flag;
  }

  async updateFlag(flagKey: string, data: FlagUpdate): Promise<FeatureFlag | null> {
    const existing = await this.getFlag(flagKey);
    if (!existing) return null;

    if (data.rollout_percentage !== undefined && (data.rollout_percentage < 0 || data.rollout_percentage > 100)) {
      throw new InputValidationError("rollout_percentage must be between 0 and 100");
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    
    if (data.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(data.enabled);
    }
    
    if (data.kill_switch !== undefined) {
      updates.push('kill_switch = ?');
      values.push(data.kill_switch);
    }
    
    if (data.default_value !== undefined) {
      updates.push('default_value = ?');
      values.push(JSON.stringify(data.default_value));
    }
    
    if (data.targeting_rules !== undefined) {
      updates.push('targeting_rules = ?');
      values.push(JSON.stringify(data.targeting_rules));
    }
    
    if (data.rollout_percentage !== undefined) {
      updates.push('rollout_percentage = ?');
      values.push(data.rollout_percentage);
    }
    
    if (data.variations !== undefined) {
      updates.push('variations = ?');
      values.push(JSON.stringify(data.variations));
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(flagKey);

    await this.db
      .prepare(`UPDATE feature_flags SET ${updates.join(', ')} WHERE flag_key = ?`)
      .bind(...values)
      .run();

    await this.invalidateCache(flagKey);

    return await this.getFlag(flagKey);
  }

  async deleteFlag(flagKey: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM feature_flags WHERE flag_key = ?")
      .bind(flagKey)
      .run();

    if (result.meta.changes > 0) {
      await this.invalidateCache(flagKey);
      return true;
    }

    return false;
  }

  async evaluateFlag(request: FlagEvaluationRequest): Promise<FlagEvaluationResponse> {
    const { flag_key, user_id, attributes = {}, default_value } = request;

    const cacheKey = this.getEvaluationCacheKey(flag_key, user_id, attributes, default_value);
    if (this.kv) {
      try {
        const cached = await this.kv.get(cacheKey, "json");
        if (cached) {
          const cachedResponse = cached as FlagEvaluationResponse;
          return { ...cachedResponse, cached: true };
        }
      } catch {
        // Ignore cache errors
      }
    }

    const flag = await this.getFlag(flag_key);
    
    if (!flag) {
      const response: FlagEvaluationResponse = {
        flag_key,
        user_id,
        value: default_value ?? false,
        reason: 'default',
        enabled: false
      };
      return response;
    }

    let response: FlagEvaluationResponse | null = null;

    if (flag.kill_switch) {
      response = {
        flag_key,
        user_id,
        value: flag.default_value,
        reason: 'kill_switch',
        enabled: false
      };
    } else if (!flag.enabled) {
      response = {
        flag_key,
        user_id,
        value: flag.default_value,
        reason: 'disabled',
        enabled: false
      };
    } else {
      response = await this.evaluateExperimentAllocation(flag, user_id, attributes);
      response ??= this.evaluateFlagRules(flag, user_id, attributes);
    }

    if (this.kv) {
      try {
        await this.kv.put(cacheKey, JSON.stringify(response), { 
          expirationTtl: this.EVALUATION_CACHE_TTL 
        });
      } catch {
        // Ignore cache failures
      }
    }

    await this.logEvaluation(flag, response, attributes);

    return response;
  }

  private async logEvaluation(
    flag: FeatureFlag, 
    response: FlagEvaluationResponse, 
    attributes: Record<string, any>
  ): Promise<void> {
    try {
      const evaluationId = `eval_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      await this.db
        .prepare(`
          INSERT INTO flag_evaluations (id, flag_id, flag_key, user_id, variation_key, 
                                       variation_value, reason, context, evaluated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          evaluationId,
          flag.id,
          response.flag_key,
          response.user_id,
          response.variation_key || null,
          JSON.stringify(response.value),
          response.reason,
          JSON.stringify(attributes),
          new Date().toISOString()
        )
        .run();
    } catch (error) {
      console.error('Failed to log flag evaluation:', error);
    }
  }
}
