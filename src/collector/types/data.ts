export interface ExperimentAssignment {
  experiment_id: string;
  variant_id: string;
}

export interface EventData {
  type: string;
  s: string;
  ts: string;
  vtag: string;
  r: string;
  re: string;
  lng: string;
  title: string;
  library_version: string;
  app_name: string;
  app_type: string;
  user_id: string;
  p: string;
  ref: string;
  content_type: string;
  event_name: string;
  event_category: string;
  event_label: string;
  event_value: number;
  virtual_pageview: boolean;
  non_interaction: boolean;
  properties: Record<string, string>;
  exp?: string; // "expId:variantId;expId2:variantId2"
}

export interface BatchEventData extends EventData {
  events: EventData[];
}

export interface ScreenDimensions {
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface AnalyticsEventData {
  timestamp: string;
  session_data: {
    site_id: string;
    client_timestamp: string;
    user_id: string;
    hits: number;
    new_visitor: number;
    bounce: number;
  },
  event_data: {
    event_id: number;
    version_tag: string;
    content_type: string;
    event_name: string;
    event_category: string;
    event_label: string;
    event_value: number;
  },
  app_data: {
    app_name: string;
    app_type: string;
    library_version: string;
    language: string;
  },
  device_info?: {
    browser?: string;
    os?: string;
    device?: string;
    user_agent?: string;
    screen?: ScreenDimensions;
    viewport?: ScreenDimensions;
  },
  referrer: string;
  page: {
    url: string;
    path: string;
  },
  ip: string;
  properties: Record<string, string>;
}

export interface AnalyticsFullEventData extends AnalyticsEventData {
  experiment_assignments?: string;
  data_type: string;
}

