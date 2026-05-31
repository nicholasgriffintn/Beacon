import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

import type { Site, SiteCreate, SiteUpdate, SiteValidationResult } from "../types";
import { getHostnameFromUrl, isHostnameAllowed, isValidSiteDomain } from "../utils/domains";
import { InputValidationError } from "../utils/errors";

export class SiteService {
  private db: D1Database;
  private kv?: KVNamespace;
  private readonly CACHE_TTL = 5 * 60; // 5 minutes

  constructor(db: D1Database, kv?: KVNamespace) {
    this.db = db;
    this.kv = kv;
  }

  private generateId(): string {
    return `site_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  private getCacheKey(siteId: string): string {
    return `site:${siteId}`;
  }

  private async getFromCache(siteId: string): Promise<Site | null> {
    if (!this.kv) {
      return null;
    }

    try {
      const key = this.getCacheKey(siteId);
      const cached = await this.kv.get(key, "json");
      return cached as Site | null;
    } catch {
      return null;
    }
  }

  private async setCache(siteId: string, site: Site): Promise<void> {
    if (!this.kv) {
      return;
    }

    try {
      const key = this.getCacheKey(siteId);
      await this.kv.put(key, JSON.stringify(site), { expirationTtl: this.CACHE_TTL });
    } catch {
      // Ignore cache failures
    }
  }

  private async invalidateCache(siteId: string): Promise<void> {
    if (!this.kv) {
      return;
    }

    try {
      const key = this.getCacheKey(siteId);
      await this.kv.delete(key);
    } catch {
      // Ignore cache failures
    }
  }

  async getSite(siteId: string): Promise<Site | null> {
    const cached = await this.getFromCache(siteId);
    if (cached) {
      return cached;
    }

    const site = await this.getSiteRecord(siteId, true);
    if (!site) return null;

    await this.setCache(siteId, site);
    return site;
  }

  private async getSiteRecord(siteId: string, activeOnly: boolean): Promise<Site | null> {
    const query = activeOnly
      ? "SELECT * FROM sites WHERE site_id = ? AND status = 'active'"
      : "SELECT * FROM sites WHERE site_id = ?";

    const result = await this.db
      .prepare(query)
      .bind(siteId)
      .first();

    if (!result) {
      return null;
    }

    return {
      ...result,
      domains: JSON.parse(result.domains as string)
    } as Site;
  }

  async validateSiteAndDomain(siteId: string, refererUrl?: string): Promise<SiteValidationResult> {
    const site = await this.getSite(siteId);
    
    if (!site) {
      return {
        valid: false,
        error: 'Site not found or inactive'
      };
    }

    const refererDomain = getHostnameFromUrl(refererUrl);
    if (!refererDomain) {
      return {
        valid: false,
        error: 'Missing or invalid request origin'
      };
    }

    const isValidDomain = site.domains.some(domain => isHostnameAllowed(domain, refererDomain));

    if (!isValidDomain) {
      return {
        valid: false,
        error: `Domain ${refererDomain} not authorized for site ${siteId}`
      };
    }

    return {
      valid: true,
      site
    };
  }

  async listSites(): Promise<Site[]> {
    const results = await this.db
      .prepare("SELECT * FROM sites ORDER BY created_at DESC")
      .all();

    return results.results.map(row => ({
      ...row,
      domains: JSON.parse(row.domains as string)
    })) as Site[];
  }

  async createSite(data: SiteCreate): Promise<Site> {
    for (const domain of data.domains) {
      if (!isValidSiteDomain(domain)) {
        throw new InputValidationError(`Invalid domain: ${domain}`);
      }
    }

    const id = this.generateId();
    const now = new Date().toISOString();
    
    const site = {
      id,
      site_id: data.site_id,
      name: data.name,
      domains: data.domains,
      status: data.status || 'active',
      created_at: now,
      updated_at: now
    };

    await this.db
      .prepare(`
        INSERT INTO sites (id, site_id, name, domains, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        site.id,
        site.site_id,
        site.name,
        JSON.stringify(site.domains),
        site.status,
        site.created_at,
        site.updated_at
      )
      .run();

    return site;
  }

  async updateSite(siteId: string, data: SiteUpdate): Promise<Site | null> {
    const existing = await this.getSiteRecord(siteId, false);
    if (!existing) return null;

    if (data.domains) {
      for (const domain of data.domains) {
        if (!isValidSiteDomain(domain)) {
          throw new InputValidationError(`Invalid domain: ${domain}`);
        }
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    
    if (data.domains !== undefined) {
      updates.push('domains = ?');
      values.push(JSON.stringify(data.domains));
    }
    
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(siteId);

    await this.db
      .prepare(`UPDATE sites SET ${updates.join(', ')} WHERE site_id = ?`)
      .bind(...values)
      .run();

    await this.invalidateCache(siteId);

    return await this.getSiteRecord(siteId, false);
  }

  async deleteSite(siteId: string): Promise<boolean> {
    const result = await this.db
      .prepare("DELETE FROM sites WHERE site_id = ?")
      .bind(siteId)
      .run();

    if (result.meta.changes > 0) {
      await this.invalidateCache(siteId);
      return true;
    }

    return false;
  }
}
