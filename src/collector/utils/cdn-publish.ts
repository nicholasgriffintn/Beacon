import type { CdnConfigType, PublishedDefinition } from "../services/cdn-publisher";

export type CdnMutationResource = "site" | "experiment" | "flag";

export type CdnPublishResult = Partial<Record<CdnConfigType, PublishedDefinition>>;

export function getCdnPublishScopesForMutation(resource: CdnMutationResource): CdnConfigType[] {
  if (resource === "site") {
    return ["sites", "flags", "openfeature"];
  }

  if (resource === "experiment") {
    return ["openfeature"];
  }

  return ["flags", "openfeature"];
}

export function getCdnPublishHeaders(result: CdnPublishResult): Record<string, string> {
  const scopes = Object.keys(result).sort();
  const headers: Record<string, string> = {
    "X-CDN-Published": scopes.join(","),
  };

  for (const scope of scopes) {
    const published = result[scope as CdnConfigType];
    if (published?.version) {
      headers[`X-CDN-${scope}-Version`] = published.version;
    }
  }

  return headers;
}
