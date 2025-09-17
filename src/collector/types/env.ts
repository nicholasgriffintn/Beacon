import type { D1Database, Fetcher, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface Env {
  ASSETS: Fetcher;
  ANALYTICS_PIPELINE: {
    send(records: Record<string, unknown>[]): Promise<void>;
  };
  DB: D1Database;
  CACHE_KV: KVNamespace;
  CDN_BUCKET: R2Bucket;
}