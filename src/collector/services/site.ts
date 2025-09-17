import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

import type { Site, SiteCreate, SiteUpdate, SiteValidationResult } from "../types";

export class SiteService {
  private db: D1Database;
  private kv: KVNamespace;
  private readonly CACHE_TTL = 5 * 60; // 5 minutes

  constructor(db: D1Database, kv: KVNamespace) {
    this.db = db;
    this.kv = kv;
  }

  private generateId(): string {
    return `site_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  private isValidDomain(domain: string): boolean {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.([a-zA-Z]{2,}|localhost)$/;
    return domainRegex.test(domain) || domain === 'localhost' || domain.startsWith('localhost:');
  }

  private getDomainFromUrl(url: string): string | null {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname;
    } catch {
      return null;
    }
  }

  private getCacheKey(siteId: string): string {
    return `site:${siteId}`;
  }

  private async getFromCache(siteId: string): Promise<Site | null> {
    try {
      const key = this.getCacheKey(siteId);
      const cached = await this.kv.get(key, "json");
      return cached as Site | null;
    } catch {
      return null;
    }
  }

  private async setCache(siteId: string, site: Site): Promise<void> {
    try {
      const key = this.getCacheKey(siteId);
      await this.kv.put(key, JSON.stringify(site), { expirationTtl: this.CACHE_TTL });
    } catch {
      // Ignore cache failures
    }
  }

  private async invalidateCache(siteId: string): Promise<void> {
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

    const result = await this.db
      .prepare("SELECT * FROM sites WHERE site_id = ? AND status = 'active'")
      .bind(siteId)
      .first();

    if (!result) {
      return null;
    }

    const site: Site = {
      ...result,
      domains: JSON.parse(result.domains as string)
    } as Site;

    await this.setCache(siteId, site);
    return site;
  }

  async validateSiteAndDomain(siteId: string, refererUrl?: string): Promise<SiteValidationResult> {
    const site = await this.getSite(siteId);
    
    if (!site) {
      return {
        valid: false,
        error: 'Site not found or inactive'
      };
    }

    if (!refererUrl) {
      return {
        valid: true,
        site
      };
    }

    const refererDomain = this.getDomainFromUrl(refererUrl);
    if (!refererDomain) {
      return {
        valid: false,
        error: 'Invalid referer URL'
      };
    }

    const isValidDomain = site.domains.some(domain => {
      if (domain === refererDomain) return true;
      
      if (domain.startsWith('*.')) {
        const baseDomain = domain.slice(2);
        return refererDomain === baseDomain || refererDomain.endsWith('.' + baseDomain);
      }
      
      return false;
    });

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
      if (!this.isValidDomain(domain) && !domain.startsWith('*.')) {
        throw new Error(`Invalid domain: ${domain}`);
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
    const existing = await this.getSite(siteId);
    if (!existing) return null;

    if (data.domains) {
      for (const domain of data.domains) {
        if (!this.isValidDomain(domain) && !domain.startsWith('*.')) {
          throw new Error(`Invalid domain: ${domain}`);
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

    return await this.getSite(siteId);
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
