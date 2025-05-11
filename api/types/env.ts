import type { Fetcher } from "@cloudflare/workers-types";

export interface Env {
  ASSETS: Fetcher;
  ANALYTICS_PIPELINE: {
    send(records: Record<string, unknown>[]): Promise<void>;
  };
}