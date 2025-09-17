export type SiteStatus = 'active' | 'inactive' | 'suspended';

export interface Site {
  id: string;
  site_id: string;
  name: string;
  domains: string[];
  status: SiteStatus;
  created_at: string;
  updated_at: string;
}

export interface SiteCreate {
  site_id: string;
  name: string;
  domains: string[];
  status?: SiteStatus;
}

export interface SiteUpdate {
  name?: string;
  domains?: string[];
  status?: SiteStatus;
}

export interface SiteValidationResult {
  valid: boolean;
  site?: Site;
  error?: string;
}
