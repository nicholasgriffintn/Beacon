import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import type { CdnMutationResource, CdnPublishResult } from "../utils/cdn-publish";
import { CDNPublisher } from "./cdn-publisher";

export async function publishCdnForMutation(
  db: D1Database,
  bucket: R2Bucket,
  resource: CdnMutationResource,
): Promise<CdnPublishResult> {
  const publisher = new CDNPublisher(db, bucket);

  if (resource === "site") {
    return publisher.publishAll();
  }

  if (resource === "experiment") {
    return {
      openfeature: await publisher.publishOpenFeature(),
    };
  }

  return {
    flags: await publisher.publishFlags(),
    openfeature: await publisher.publishOpenFeature(),
  };
}
