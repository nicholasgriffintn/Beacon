import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import { SiteService } from "./site";
import { ExperimentService } from "./experiment";
import { FeatureFlagService } from "./feature-flag";

export interface PublishedDefinition {
  version: string;
  etag: string;
  lastModified: string;
  url: string;
}

interface PublishedSitesConfig {
  version: string;
  updated_at: string;
  sites: Array<{
    site_id: string;
    name: string;
    domains: string[];
    status: string;
  }>;
}

interface PublishedFlagsConfig {
  version: string;
  updated_at: string;
  flags: Array<{
    flag_key: string;
    name: string;
    description?: string;
    site_id?: string;
    enabled: boolean;
    kill_switch: boolean;
    default_value: unknown;
    targeting_rules: unknown[];
    rollout_percentage: number;
    variations: unknown[];
  }>;
}

interface PublishedOpenFeatureConfig {
  version: string;
  updated_at: string;
  flags: Array<{
    flagKey: string;
    name: string;
    description?: string;
    site_id?: string;
    enabled: boolean;
    kill_switch: boolean;
    defaultValue: unknown;
    targetingRules: unknown[];
    rolloutPercentage: number;
    variations: unknown[];
    experiment?: {
      id: string;
      name: string;
      site_id?: string;
      trafficAllocation: number;
      variants: Array<{
        key: string;
        name: string;
        value: unknown;
        trafficPercentage: number;
      }>;
    };
  }>;
}

export type CdnConfigType = 'sites' | 'flags' | 'openfeature';
export type PublishedConfig = PublishedSitesConfig | PublishedFlagsConfig | PublishedOpenFeatureConfig;

export function isGlobalOrActiveSite(siteId: string | undefined, activeSiteIds: Set<string>): boolean {
  return !siteId || activeSiteIds.has(siteId);
}

export class CDNPublisher {
  private db: D1Database;
  private r2: R2Bucket;
  private baseUrl: string;

  constructor(db: D1Database, r2: R2Bucket, baseUrl?: string) {
    this.db = db;
    this.r2 = r2;
    this.baseUrl = baseUrl || "https://beacon-cdn.polychat.app";
  }

  private generateVersion(): string {
    return Date.now().toString();
  }

  private generateETag(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private async putToR2(
    key: string, 
    content: string, 
    contentType: string = 'application/json'
  ): Promise<{ etag: string; version: string }> {
    const version = this.generateVersion();
    const etag = this.generateETag(content);
    
    const versionedKey = `config/v1/${key}/${version}.json`;
    const latestKey = `config/v1/${key}/latest.json`;

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable', // 1 year for versioned files
      'ETag': `"${etag}"`,
    };

    await this.r2.put(versionedKey, content, {
      httpMetadata: {
        contentType,
        cacheControl: headers['Cache-Control'],
      },
      customMetadata: {
        etag,
        version,
      },
    });

    await this.r2.put(latestKey, content, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=300', // 5 minutes for latest
      },
      customMetadata: {
        etag,
        version,
      },
    });

    return { etag, version };
  }

  async publishSites(): Promise<PublishedDefinition> {
    const siteService = new SiteService(this.db);
    const sites = await siteService.listSites();
    
    const activeSites = sites.filter(site => site.status === 'active');
    
    const exportData = {
      version: this.generateVersion(),
      updated_at: new Date().toISOString(),
      sites: activeSites.map(site => ({
        site_id: site.site_id,
        name: site.name,
        domains: site.domains,
        status: site.status,
      })),
    };

    const content = JSON.stringify(exportData, null, 2);
    const { etag, version } = await this.putToR2('sites', content);

    return {
      version,
      etag,
      lastModified: new Date().toISOString(),
      url: `${this.baseUrl}/config/v1/sites/${version}.json`,
    };
  }

  async publishFlags(): Promise<PublishedDefinition> {
    const flagService = new FeatureFlagService(this.db);
    const siteService = new SiteService(this.db);
    const [flags, sites] = await Promise.all([
      flagService.listFlags(),
      siteService.listSites(),
    ]);
    const activeSiteIds = new Set(
      sites
        .filter(site => site.status === 'active')
        .map(site => site.site_id),
    );
    const activeFlags = flags.filter(flag => {
      return flag.enabled && !flag.kill_switch && isGlobalOrActiveSite(flag.site_id, activeSiteIds);
    });
    
    const exportData = {
      version: this.generateVersion(),
      updated_at: new Date().toISOString(),
      flags: activeFlags.map(flag => ({
        flag_key: flag.flag_key,
        name: flag.name,
        description: flag.description,
        site_id: flag.site_id,
        enabled: flag.enabled,
        kill_switch: flag.kill_switch,
        default_value: flag.default_value,
        targeting_rules: flag.targeting_rules,
        rollout_percentage: flag.rollout_percentage,
        variations: flag.variations,
      })),
    };

    const content = JSON.stringify(exportData, null, 2);
    const { etag, version } = await this.putToR2('flags', content);

    return {
      version,
      etag,
      lastModified: new Date().toISOString(),
      url: `${this.baseUrl}/config/v1/flags/${version}.json`,
    };
  }

  async publishOpenFeature(): Promise<PublishedDefinition> {
    const experimentService = new ExperimentService(this.db);
    const flagService = new FeatureFlagService(this.db);
    const siteService = new SiteService(this.db);
    const [experiments, flags, sites] = await Promise.all([
      experimentService.listExperiments(),
      flagService.listFlags(),
      siteService.listSites(),
    ]);
    const activeSiteIds = new Set(
      sites
        .filter(site => site.status === 'active')
        .map(site => site.site_id),
    );
    const activeExperiments = experiments.filter(exp => {
      return exp.status === 'running' && isGlobalOrActiveSite(exp.site_id, activeSiteIds);
    });
    const siteScopedFlags = flags.filter(flag => {
      return isGlobalOrActiveSite(flag.site_id, activeSiteIds);
    });
    const experimentsByFlagKey = new Map<string, typeof activeExperiments[number]>();
    for (const experiment of activeExperiments) {
      if (!experimentsByFlagKey.has(experiment.flag_key)) {
        experimentsByFlagKey.set(experiment.flag_key, experiment);
      }
    }

    const exportData: PublishedOpenFeatureConfig = {
      version: this.generateVersion(),
      updated_at: new Date().toISOString(),
      flags: siteScopedFlags.map(flag => {
        const experiment = experimentsByFlagKey.get(flag.flag_key);

        return {
          flagKey: flag.flag_key,
          name: flag.name,
          description: flag.description,
          site_id: flag.site_id,
          enabled: flag.enabled,
          kill_switch: flag.kill_switch,
          defaultValue: flag.default_value,
          targetingRules: flag.targeting_rules,
          rolloutPercentage: flag.rollout_percentage,
          variations: flag.variations,
          experiment: experiment ? {
            id: experiment.id,
            name: experiment.name,
            site_id: experiment.site_id,
            trafficAllocation: experiment.traffic_allocation,
            variants: experiment.variants.map(variant => ({
              key: variant.id,
              name: variant.name,
              value: this.getExperimentVariantValue(variant.config),
              trafficPercentage: variant.traffic_percentage,
            })),
          } : undefined,
        };
      }),
    };

    const content = JSON.stringify(exportData, null, 2);
    const { etag, version } = await this.putToR2('openfeature', content);

    return {
      version,
      etag,
      lastModified: new Date().toISOString(),
      url: `${this.baseUrl}/config/v1/openfeature/${version}.json`,
    };
  }

  async publishAll(): Promise<{
    sites: PublishedDefinition;
    flags: PublishedDefinition;
    openfeature: PublishedDefinition;
  }> {
    const [sites, flags, openfeature] = await Promise.all([
      this.publishSites(),
      this.publishFlags(),
      this.publishOpenFeature(),
    ]);

    return { sites, flags, openfeature };
  }

  async getPublishedInfo(type: CdnConfigType): Promise<PublishedDefinition | null> {
    try {
      const latestObject = await this.r2.get(`config/v1/${type}/latest.json`);
      if (!latestObject) return null;

      const metadata = latestObject.customMetadata;
      if (!metadata?.version || !metadata?.etag) return null;

      return {
        version: metadata.version,
        etag: metadata.etag,
        lastModified: latestObject.uploaded?.toISOString() || new Date().toISOString(),
        url: `${this.baseUrl}/config/v1/${type}/${metadata.version}.json`,
      };
    } catch {
      return null;
    }
  }

  async listVersions(type: CdnConfigType): Promise<string[]> {
    try {
      const list = await this.r2.list({ prefix: `config/v1/${type}/` });
      return list.objects
        .filter(obj => obj.key.endsWith('.json') && !obj.key.endsWith('latest.json'))
        .map(obj => obj.key.split('/').pop()?.replace('.json', '') || '')
        .filter(Boolean)
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  async getPublishedConfig(type: CdnConfigType, version = 'latest'): Promise<{
    content: PublishedConfig;
    etag?: string;
    version?: string;
    uploaded?: Date;
  } | null> {
    try {
      const key = version === 'latest'
        ? `config/v1/${type}/latest.json`
        : `config/v1/${type}/${version}.json`;
      const object = await this.r2.get(key);
      if (!object) return null;

      return {
        content: await object.json<PublishedConfig>(),
        etag: object.customMetadata?.etag,
        version: object.customMetadata?.version,
        uploaded: object.uploaded,
      };
    } catch {
      return null;
    }
  }

  private getExperimentVariantValue(config: Record<string, unknown>): unknown {
    if (Object.prototype.hasOwnProperty.call(config, 'value')) {
      return config.value;
    }

    return config;
  }
}
