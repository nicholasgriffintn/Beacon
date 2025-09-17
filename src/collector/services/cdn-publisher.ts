import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import { SiteService } from "./site";
import { ExperimentService } from "./experiment";

interface PublishedDefinition {
  version: string;
  etag: string;
  lastModified: string;
  url: string;
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

  async publishExperiments(): Promise<PublishedDefinition> {
    const experimentService = new ExperimentService(this.db);
    const experiments = await experimentService.listExperiments();
    
    const activeExperiments = experiments.filter(exp => exp.status === 'running');
    
    const exportData = {
      version: this.generateVersion(),
      updated_at: new Date().toISOString(),
      experiments: activeExperiments.map(exp => ({
        id: exp.id,
        name: exp.name,
        type: exp.type,
        status: exp.status,
        targeting_rules: exp.targeting_rules,
        traffic_allocation: exp.traffic_allocation,
        variants: exp.variants.map(variant => ({
          id: variant.id,
          name: variant.name,
          type: variant.type,
          config: variant.config,
          traffic_percentage: variant.traffic_percentage,
        })),
      })),
    };

    const content = JSON.stringify(exportData, null, 2);
    const { etag, version } = await this.putToR2('experiments', content);

    return {
      version,
      etag,
      lastModified: new Date().toISOString(),
      url: `${this.baseUrl}/config/v1/experiments/${version}.json`,
    };
  }

  async publishSites(): Promise<PublishedDefinition> {
    const siteService = new SiteService(this.db, {} as any); // We don't need KV for this operation
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

  async publishAll(): Promise<{
    experiments: PublishedDefinition;
    sites: PublishedDefinition;
  }> {
    const [experiments, sites] = await Promise.all([
      this.publishExperiments(),
      this.publishSites(),
    ]);

    return { experiments, sites };
  }

  async getPublishedInfo(type: 'experiments' | 'sites'): Promise<PublishedDefinition | null> {
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

  async listVersions(type: 'experiments' | 'sites'): Promise<string[]> {
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
}
