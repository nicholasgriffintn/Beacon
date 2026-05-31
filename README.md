# Beacon

This is a comprehensive analytics and experimentation platform built on Cloudflare's edge infrastructure, designed to provide enterprise-grade A/B testing, feature flagging, and analytics capabilities while remaining cost-effective and fully open source.

**Key Features:**

- **Edge-native collection**: Runs on Cloudflare Workers with D1, KV, R2, and Pipelines.
- **A/B testing**: Supports experiment lifecycle, sticky assignment, CDN-published configs, and exposure/conversion tracking.
- **Feature flags**: Supports targeting rules, rollout controls, kill switches, evaluation logging, and CDN-published flag definitions.
- **Site validation**: Enforces registered domains before accepting analytics events.
- **Abuse controls**: Applies per-site/client rate limits to event ingestion and public evaluation endpoints.
- **Management dashboard**: Provides site, experiment, feature flag, result, and CDN publishing controls through the FastAPI admin dashboard.
- **Analytics workspace**: Ships a notebook environment and Apache Superset service for analysis and reporting.
- **Operational readiness**: Exposes health checks, static validation scripts, minified client bundles, and deployable Cloudflare configuration.

## Quick Start

### Prerequisites
- Node.js 18+ with pnpm
- Cloudflare account with Workers, D1, KV, and R2 enabled
- Python 3.9+ (for dashboard backend)
- Docker (for analytics stack)

### 1. Deploy the Collector (Cloudflare Workers)

```bash
# Install dependencies
pnpm install

# Configure your Cloudflare services in wrangler.jsonc:
# - Update KV namespace ID
# - Update R2 bucket name
# - Update D1 database ID

# Configure the management API key as a Worker secret
pnpm wrangler secret put ADMIN_API_KEY

# Optional: tune public endpoint rate limits
# RATE_LIMIT_EVENTS_PER_MINUTE and RATE_LIMIT_EVALUATIONS_PER_MINUTE live in wrangler.jsonc

# Deploy database schema
pnpm run db:apply

# Deploy to Cloudflare Workers
pnpm run deploy

# For local development:
pnpm run dev
```

### 2. Configure Admin Dashboard

```bash
cd src/dashboard/backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create environment file
cp .env.example .env

# Edit .env with your values:
# WORKER_BASE_URL=https://your-worker.your-subdomain.workers.dev
# WORKER_API_KEY=the-same-value-as-ADMIN_API_KEY

# Run the backend
uvicorn main:app --reload --port 8000

# You should now be able to access the dashboard at http://localhost:8000
```

### 3. Run the Analytics Workspace

```bash
cd src/dashboard

# Required by Superset in production
export SUPERSET_SECRET_KEY="$(openssl rand -base64 42)"

podman compose up

# Dashboard: http://localhost:8081
# Jupyter: http://localhost:8888
# Superset: http://localhost:8088
```

## API Documentation

### Core Endpoints

#### Events Collection
- `POST /api/events/collect` - Single event collection
- `POST /api/events/batch` - Batch event collection

#### Health
- `GET /api/health` - Check D1, KV, and R2 connectivity

#### Site Management (`X-API-Key` required)
- `GET /api/sites` - List all sites
- `POST /api/sites` - Create new site
- `GET /api/sites/:siteId` - Get site details
- `PUT /api/sites/:siteId` - Update site
- `DELETE /api/sites/:siteId` - Delete site

#### CDN Configuration
- `GET /api/cdn/experiments/latest?site_id=:siteId` - Get the published experiment config for a browser client
- `GET /api/cdn/experiments/:version?site_id=:siteId` - Get a specific published experiment config version
- `GET /api/cdn/experiments/info` - Get latest experiment publish metadata
- `GET /api/cdn/experiments/versions` - List published experiment config versions
- `GET /api/cdn/flags/latest?site_id=:siteId` - Get the published feature flag config for a browser client
- `GET /api/cdn/flags/:version?site_id=:siteId` - Get a specific published feature flag config version
- `GET /api/cdn/flags/info` - Get latest feature flag publish metadata
- `GET /api/cdn/flags/versions` - List published feature flag config versions
- `GET /api/cdn/sites/latest` - Get the published site config
- `GET /api/cdn/sites/:version` - Get a specific published site config version
- `GET /api/cdn/sites/info` - Get latest site publish metadata
- `GET /api/cdn/sites/versions` - List published site config versions

#### Experiment Management (`X-API-Key` required except assignment)
- `GET /api/experiments` - List experiments
- `POST /api/experiments` - Create experiment
- `GET /api/experiments/:id` - Get experiment
- `PUT /api/experiments/:id` - Update experiment
- `POST /api/experiments/:id/assign` - Assign variant to user

#### Experiment Results (`X-API-Key` required)
- `GET /api/experiments/:id/results` - Get latest results
- `GET /api/experiments/:id/results/history` - Get results history
- `GET /api/experiments/:id/results/:timestamp` - Get specific result

#### Feature Flags (`X-API-Key` required except resolution)
- `GET /api/flags` - List feature flags
- `POST /api/flags` - Create feature flag
- `GET /api/flags/:flagKey` - Get flag details
- `PUT /api/flags/:flagKey` - Update flag
- `DELETE /api/flags/:flagKey` - Delete flag
- `POST /api/flags/:flagKey/resolve` - Resolve flag for user
- `POST /api/flags/resolve` - Bulk flag resolution. Public calls must include `flag_keys`; resolving every enabled flag requires `X-API-Key`.

#### CDN Publishing
- `POST /api/admin/publish/experiments` - Publish experiments to CDN
- `POST /api/admin/publish/flags` - Publish feature flags to CDN
- `POST /api/admin/publish/sites` - Publish sites to CDN
- `POST /api/admin/publish/all` - Publish all definitions

### Authentication

Management endpoints require an API key passed in the `X-API-Key` header. Configure the Worker secret with the same value:

```bash
pnpm wrangler secret put ADMIN_API_KEY
curl -H "X-API-Key: your-api-key" https://your-api.com/api/sites
```

### Rate Limiting

Public endpoints are rate-limited by client address and scope:

- `RATE_LIMIT_EVENTS_PER_MINUTE` controls `/api/events/*` per site.
- `RATE_LIMIT_EVALUATIONS_PER_MINUTE` controls experiment assignment and feature flag resolution per experiment or flag.

Defaults are configured in `wrangler.jsonc` and can be changed per deployment.

## Set up on Cloudflare

If you'd like to run this for yourself, you can do so by following the steps below.

First create the R2 bucket used for CDN-published definitions.

```bash
npx wrangler@latest r2 bucket create beacon-cdn
```

Then create the R2 bucket used by the analytics pipeline.

```bash
npx wrangler@latest r2 bucket create analytics-pipeline
```

Then you'll need to create the pipeline with this bucket as the source.

```bash
npx wrangler@latest pipelines create analytics-pipeline --r2-bucket analytics-pipeline
```

You'll also need to create a [D1 database](https://developers.cloudflare.com/d1/getting-started/create-a-database/) with the name `analytics-database`.

```bash
npx wrangler@latest d1 create analytics-database
```

Finally, you can click the button below to deploy the worker.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nicholasgriffintn/cloudflare-analytics-pipeline)

## Installation for a website

Include the script in your HTML:

```html
<script src="https://<your-worker-url>/beacon.js"></script>
```

## Configuration Options

- **endpoint**: API endpoint URL
- **siteId**: Your site's unique identifier (required)
- **debug**: Enable console logging (default: false)
- **trackPageViews**: Automatically track page views (default: true)
- **trackClicks**: Automatically track link clicks (default: false)
- **trackUserTimings**: Track page performance metrics (default: false)
- **batchSize**: Number of events to send in a batch (default: 10)
- **batchTimeout**: Time in ms before sending partial batch (default: 5000)
- **directPageViews**: Send page views immediately instead of batching (default: true)
- **directEvents**: Send custom events immediately instead of batching (default: false)
- **requireConsent**: Require user consent before tracking (default: false)
- **respectDoNotTrack**: Respect browser Do Not Track setting (default: true)
- **consentCookie**: Name of the cookie used to store consent (default: 'beacon_consent')
- **appName**: Name of your application (defaults to document.title)

## Basic Usage

```javascript
// Initialize Beacon with your site ID
Beacon.init({
  siteId: 'YOUR_SITE_ID',
  debug: true, // Set to false in production
  trackClicks: true, // Optional: automatically track link clicks
  trackUserTimings: true, // Optional: track page performance metrics
  directEvents: false // Optional: send events immediately (true) or batch them (false)
});

// Track custom events
Beacon.trackEvent({
  name: 'event_name',
  category: 'category_name',
  label: 'optional_label',
  value: 'optional_value'
});

// Manually track a page view (happens automatically with trackPageViews: true)
Beacon.trackPageView();
```

## Event Processing Modes

Beacon supports two processing modes for events:

### Batch Processing (Default)
Events are queued and sent in batches to reduce network requests and improve performance.

```javascript
Beacon.init({
  siteId: 'YOUR_SITE_ID',
  directEvents: false, // Default: batch processing
  batchSize: 10, // Send batch when 10 events are queued
  batchTimeout: 5000 // Or send after 5 seconds
});
```

### Direct Processing
Events are sent immediately as they occur, useful for critical events that need real-time processing.

```javascript
Beacon.init({
  siteId: 'YOUR_SITE_ID',
  directEvents: true // Send events immediately
});
```

### Hybrid Approach
You can use different processing modes for different event types:

```javascript
Beacon.init({
  siteId: 'YOUR_SITE_ID',
  directPageViews: true, // Send page views immediately
  directEvents: false // Batch custom events
});
```

## Experiments

Beacon includes an experiments module for A/B testing and feature flagging.

### Initialization

```javascript
// Initialize Beacon first
Beacon.init({
  siteId: 'YOUR_SITE_ID',
  endpoint: 'https://<your-worker-url>',
  debug: true
});

// Initialize the experiments module
BeaconExperiments.init({
  endpoint: 'https://<your-worker-url>',
  siteId: 'YOUR_SITE_ID',
  debug: true
});
```

### Defining Experiments

Create experiment definitions in the management dashboard or through the experiment API, then publish them from the Admin page. The browser extension loads the published CDN config and applies the matching behaviour you define in code.

To extend them with custom logic, you can use the `defineExperimentBehaviors` function.

```javascript
BeaconExperiments.defineExperimentBehaviors([
  {
    id: 'experiment_id',
    name: 'Experiment Name',
    description: 'Description of what we're testing',
    autoActivate: true,
    variants: [
      {
        id: 'control',
        name: 'Control Variant',
        activate: function(config) {
          // Control variant implementation
          // config contains any server-provided configuration
        }
      },
      {
        id: 'variant_a',
        name: 'Variant A',
        activate: function(config) {
          // Variant A implementation using config
        }
      }
    ]
  }
]);
```

### Activating Experiments

```javascript
// Activate all experiments
await BeaconExperiments.activateAll();

// Or activate a specific experiment
await BeaconExperiments.activate('experiment_id');
```

### Tracking Conversions

```javascript
// Track a conversion for an experiment
BeaconExperiments.trackConversion('experiment_id', 'conversion_name', optionalValue, optionalProperties);
```

### Checking Variants

```javascript
// Get full variant information including config
const variant = await BeaconExperiments.getVariant('experiment_id');
if (variant) {
  console.log(variant.variant_id); // The assigned variant ID
  console.log(variant.config); // Any configuration for this variant
}

// Check if user is in a specific variant
if (await BeaconExperiments.isInVariant('experiment_id', 'variant_id')) {
  // Variant-specific code
}
```

### Debugging

The following helper functions are available when debug mode is enabled:

- `BeaconExperiments.resetAssignments()` - Reset all experiment assignments
- `BeaconExperiments.forceVariant(experimentId, variantId)` - Force a specific variant for testing
- `BeaconExperiments.getUserId()` - Get the current user ID used for experiments

### Complete Example

```javascript
// Initialize both modules
Beacon.init({
  siteId: 'YOUR_SITE_ID',
  endpoint: 'https://<your-worker-url>',
  debug: true
});

BeaconExperiments.init({
  endpoint: 'https://<your-worker-url>',
  siteId: 'YOUR_SITE_ID',
  debug: true
});

// Define a homepage hero test
BeaconExperiments.defineExperimentBehaviors([
  {
    id: 'home_hero_test',
    name: 'Homepage Hero Variant Test',
    description: 'Testing different hero section designs',
    autoActivate: true,
    variants: [
      {
        id: 'control',
        name: 'Current Design',
        activate: function(config) {
          // Apply the control design using config
          document.querySelector('.hero').style.layout = config.layout || 'default';
        }
      },
      {
        id: 'variant_a',
        name: 'New Design',
        activate: function(config) {
          // Apply the new design using config
          document.querySelector('.hero').style.layout = config.layout || 'new';
          if (config.showCta) {
            document.querySelector('.hero-cta').style.display = 'block';
          }
        }
      }
    ]
  }
]);

// Activate experiments
await BeaconExperiments.activateAll();

// Track conversions
document.querySelector('#signup-button').addEventListener('click', function() {
  BeaconExperiments.trackConversion('home_hero_test', 'signup_click');
});
```
