import type { D1Database, Fetcher } from "@cloudflare/workers-types";

export interface Env {
  ASSETS: Fetcher;
  ANALYTICS_PIPELINE: {
    send(records: Record<string, unknown>[]): Promise<void>;
  };
  DB: D1Database;
}