import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

import type { 
  FeatureFlag, 
  FlagCreate, 
  FlagUpdate, 
  FlagEvaluationRequest,
  FlagEvaluationResponse,
  BulkFlagEvaluationRequest,
  BulkFlagEvaluationResponse,
  TargetingRule,
  TargetingCondition,
} from "../types";

export class FeatureFlagService {
  private db: D1Database;
  private kv: KVNamespace;
  private readonly CACHE_TTL = 5 * 60; // 5 minutes
  private readonly EVALUATION_CACHE_TTL = 60; // 1 minute for evaluations

  constructor(db: D1Database, kv: KVNamespace) {
    this.db = db;
    this.kv = kv;
  }

  private generateId(): string {
    return `flag_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  private getCacheKey(flagKey: string): string {
    return `flag:${flagKey}`;
  }

  private getEvaluationCacheKey(flagKey: string, userId: string): string {
    return `flag_eval:${flagKey}:${userId}`;
  }

  private async getFromCache(flagKey: string): Promise<FeatureFlag | null> {
    try {
      const cached = await this.kv.get(this.getCacheKey(flagKey), "json");
      return cached as FeatureFlag | null;
    } catch {
      return null;
    }
  }

  private async setCache(flagKey: string, flag: FeatureFlag): Promise<void> {
    try {
      await this.kv.put(this.getCacheKey(flagKey), JSON.stringify(flag), { 
        expirationTtl: this.CACHE_TTL 
      });
    } catch {
      // Ignore cache failures
    }
  }

  private async invalidateCache(flagKey: string): Promise<void> {
    try {
      await this.kv.delete(this.getCacheKey(flagKey));
    } catch {
      // Ignore cache failures
    }
  }

  private hash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
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

    const hashInput = `${flagKey}:${userId}`;
    const hashValue = this.hash(hashInput);
    const bucket = hashValue % 100;
    
    return bucket < percentage;
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

    const cacheKey = this.getEvaluationCacheKey(flag_key, user_id);
    try {
      const cached = await this.kv.get(cacheKey, "json");
      if (cached) {
        const cachedResponse = cached as FlagEvaluationResponse;
        return { ...cachedResponse, cached: true };
      }
    } catch {
      // Ignore cache errors
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

    let response: FlagEvaluationResponse;

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
      let matchedRule: TargetingRule | null = null;
      
      for (const rule of flag.targeting_rules) {
        if (this.evaluateTargetingRule(rule, attributes)) {
          if (rule.rollout_percentage !== undefined && rule.rollout_percentage < 100) {
            if (!this.isInRollout(user_id, flag_key + rule.id, rule.rollout_percentage)) {
              continue; // Skip this rule due to rollout
            }
          }
          matchedRule = rule;
          break;
        }
      }

      if (matchedRule) {
        const variation = flag.variations.find(v => v.key === matchedRule!.variation_key);
        response = {
          flag_key,
          user_id,
          variation_key: matchedRule.variation_key,
          value: variation?.value ?? flag.default_value,
          reason: 'targeting',
          enabled: true
        };
      } else if (this.isInRollout(user_id, flag_key, flag.rollout_percentage)) {
        // Use first variation or default
        const variation = flag.variations[0];
        response = {
          flag_key,
          user_id,
          variation_key: variation?.key,
          value: variation?.value ?? flag.default_value,
          reason: 'rollout',
          enabled: true
        };
      } else {
        response = {
          flag_key,
          user_id,
          value: flag.default_value,
          reason: 'default',
          enabled: true
        };
      }
    }

    try {
      await this.kv.put(cacheKey, JSON.stringify(response), { 
        expirationTtl: this.EVALUATION_CACHE_TTL 
      });
    } catch {
      // Ignore cache failures
    }

    await this.logEvaluation(flag, response, attributes);

    return response;
  }

  async evaluateFlags(request: BulkFlagEvaluationRequest): Promise<BulkFlagEvaluationResponse> {
    const { user_id, attributes = {}, flag_keys } = request;
    
    let flagsToEvaluate: FeatureFlag[];
    
    if (flag_keys && flag_keys.length > 0) {
      const flagPromises = flag_keys.map(key => this.getFlag(key));
      const flags = await Promise.all(flagPromises);
      flagsToEvaluate = flags.filter(Boolean) as FeatureFlag[];
    } else {
      flagsToEvaluate = (await this.listFlags()).filter(flag => flag.enabled && !flag.kill_switch);
    }

    const evaluationPromises = flagsToEvaluate.map(flag => 
      this.evaluateFlag({
        flag_key: flag.flag_key,
        user_id,
        attributes,
        default_value: flag.default_value
      })
    );

    const evaluations = await Promise.all(evaluationPromises);
    
    const flags: Record<string, FlagEvaluationResponse> = {};
    evaluations.forEach(evaluation => {
      flags[evaluation.flag_key] = evaluation;
    });

    return {
      user_id,
      flags,
      evaluated_at: new Date().toISOString()
    };
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
