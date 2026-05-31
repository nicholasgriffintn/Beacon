import { Hono, type Context } from "hono";

import type { Env } from "../types";
import { CDNPublisher, type PublishedConfig } from "../services/cdn-publisher";

const cdnRouter = new Hono<{ Bindings: Env }>();

type CdnConfigType = 'experiments' | 'sites';

function getConfigType(c: Context): CdnConfigType | null {
  const type = c.req.param("type");
  return type === 'experiments' || type === 'sites' ? type : null;
}

function filterConfigForRequest(
  c: Context,
  type: CdnConfigType,
  content: PublishedConfig,
) {
  if (type !== 'experiments') {
    return { content };
  }

  const siteId = c.req.query("site_id");
  if (!siteId) {
    return { error: "site_id is required" };
  }

  return {
    content: {
      ...content,
      experiments: 'experiments' in content
        ? content.experiments.filter(experiment => !experiment.site_id || experiment.site_id === siteId)
        : [],
    },
  };
}

cdnRouter.get("/:type/latest", async (c: Context) => {
  try {
    const type = getConfigType(c);
    if (!type) {
      return c.json({ error: "Invalid type. Must be 'experiments' or 'sites'" }, 400);
    }

    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const published = await publisher.getPublishedConfig(type);

    if (!published) {
      return c.json({ error: `No published ${type} found` }, 404);
    }

    const filtered = filterConfigForRequest(c, type, published.content);
    if (filtered.error) {
      return c.json({ error: filtered.error }, 400);
    }

    return c.json(filtered.content, 200, {
      "Cache-Control": "public, max-age=60",
      "ETag": published.etag ? `"${published.etag}"` : "",
      "Last-Modified": published.uploaded?.toUTCString() || new Date().toUTCString(),
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error getting published config" }, 500);
  }
});

cdnRouter.get("/experiments/info", async (c: Context) => {
  try {
    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const info = await publisher.getPublishedInfo('experiments');
    
    if (!info) {
      return c.json({ error: "No published experiments found" }, 404);
    }
    
    return c.json(info, 200, {
      "Cache-Control": "public, max-age=60",
      "ETag": info.etag ? `"${info.etag}"` : "",
      "Last-Modified": info.lastModified,
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error getting experiment info" }, 500);
  }
});

cdnRouter.get("/sites/info", async (c: Context) => {
  try {
    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const info = await publisher.getPublishedInfo('sites');
    
    if (!info) {
      return c.json({ error: "No published sites found" }, 404);
    }
    
    return c.json(info, 200, {
      "Cache-Control": "public, max-age=60",
      "ETag": info.etag ? `"${info.etag}"` : "",
      "Last-Modified": info.lastModified,
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error getting sites info" }, 500);
  }
});

cdnRouter.get("/:type/versions", async (c: Context) => {
  try {
    const type = getConfigType(c);
    if (!type) {
      return c.json({ error: "Invalid type. Must be 'experiments' or 'sites'" }, 400);
    }

    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const versions = await publisher.listVersions(type);
    
    return c.json({ type, versions }, 200, {
      "Cache-Control": "public, max-age=300",
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error listing versions" }, 500);
  }
});

cdnRouter.get("/:type/:version", async (c: Context) => {
  try {
    const type = getConfigType(c);
    if (!type) {
      return c.json({ error: "Invalid type. Must be 'experiments' or 'sites'" }, 400);
    }

    const version = c.req.param("version").replace(/\.json$/, "");
    if (!/^\d+$/.test(version)) {
      return c.json({ error: "Invalid version" }, 400);
    }

    const publisher = new CDNPublisher(c.env.DB, c.env.CDN_BUCKET);
    const published = await publisher.getPublishedConfig(type, version);

    if (!published) {
      return c.json({ error: `No published ${type} found for version ${version}` }, 404);
    }

    const filtered = filterConfigForRequest(c, type, published.content);
    if (filtered.error) {
      return c.json({ error: filtered.error }, 400);
    }

    return c.json(filtered.content, 200, {
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag": published.etag ? `"${published.etag}"` : "",
      "Last-Modified": published.uploaded?.toUTCString() || new Date().toUTCString(),
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Error getting published config version" }, 500);
  }
});

export { cdnRouter };
