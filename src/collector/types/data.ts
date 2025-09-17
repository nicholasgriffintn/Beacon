export interface EventData {
  siteId: string;
  events?: Record<string, string>[];
  commonParams?: Record<string, string>;
  queryParams?: Record<string, string>;
  [key: string]: any;
}

