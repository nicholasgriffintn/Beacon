# Beacon

This is a comprehensive analytics and experimentation platform built on Cloudflare's edge infrastructure, designed to provide enterprise-grade A/B testing, feature flagging, and analytics capabilities while remaining cost-effective and fully open source.

**Key Features:**
- 🚀 **Edge-Native**: Runs entirely on Cloudflare Workers with global edge deployment
- 🧪 **Full A/B Testing**: Complete experiment lifecycle with statistical analysis
- 🏁 **Feature Flags**: Advanced targeting rules, rollout controls, and kill switches
- 📊 **Real-time Analytics**: Event tracking with Iceberg data lake integration
- 🛡️ **Site Validation**: Domain-based security with request validation
- 📈 **Visual Analytics**: Apache Superset integration for dashboards and reporting
- 💰 **Cost Efficient**: Serverless architecture with intelligent caching

> [!NOTE]
> Please note that this project is still in active development so there are a few features that are not yet fully working or fully imagined.

## 📝 Still in development
- [ ] **A management dashboard**: A dashboard to manage experiments, feature flags, and sites.
- [ ] **Complete integration with Superset**: Superset is a tool i want to investigate for visualisations alongside 

## 🚀 Potential Future Milestones
- [ ] **Real-time Analytics Dashboard**: Live event streaming and real-time metrics
- [ ] **Advanced Targeting**: Geo-location, device, and behavioral targeting rules
- [ ] **Multi-Armed Bandits**: Dynamic traffic allocation based on performance
- [ ] **Segment Analysis**: Cohort analysis and user segmentation capabilities
- [ ] **API Rate Limiting**: Per-site rate limiting and abuse prevention
- [ ] **Webhook Integration**: Event streaming to external systems
- [ ] **Data Export**: Bulk data export and ETL pipeline integration

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

# Deploy database schema
pnpm wrangler d1 execute analytics-database --file=src/database/schema.sql

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

# Run the backend
uvicorn main:app --reload --port 8000

# You should now be able to access the dashboard at http://localhost:8000
```

## API Documentation

### Core Endpoints

#### Events Collection
- `POST /api/events/collect` - Single event collection
- `POST /api/events/batch` - Batch event collection

#### Site Management
- `GET /api/sites` - List all sites
- `POST /api/sites` - Create new site
- `GET /api/sites/:siteId` - Get site details
- `PUT /api/sites/:siteId` - Update site
- `DELETE /api/sites/:siteId` - Delete site

#### Experiment Management
- `GET /api/experiments` - List experiments
- `POST /api/experiments` - Create experiment
- `GET /api/experiments/:id` - Get experiment
- `PUT /api/experiments/:id` - Update experiment
- `POST /api/experiments/:id/assign` - Assign variant to user

#### Experiment Results
- `GET /api/experiments/:id/results` - Get latest results
- `GET /api/experiments/:id/results/history` - Get results history
- `GET /api/experiments/:id/results/:timestamp` - Get specific result

#### Feature Flags
- `GET /api/flags` - List feature flags
- `POST /api/flags` - Create feature flag
- `GET /api/flags/:flagKey` - Get flag details
- `PUT /api/flags/:flagKey` - Update flag
- `DELETE /api/flags/:flagKey` - Delete flag
- `POST /api/flags/:flagKey/resolve` - Resolve flag for user
- `POST /api/flags/resolve` - Bulk flag resolution

#### CDN Publishing
- `POST /api/admin/publish/experiments` - Publish experiments to CDN
- `POST /api/admin/publish/sites` - Publish sites to CDN
- `POST /api/admin/publish/all` - Publish all definitions

### Authentication

Admin endpoints require an API key passed in the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" https://your-api.com/api/sites
```

## Set up on Cloudflare

If you'd like to run this for yourself, you can do so by following the steps below.

First you'll need to create a R2 bucket with the name `analytics-pipeline`.

```bash
npx wrangler@latest r2 bucket create analytics-pipeline
```

Then you'll need to create the pipeline with this bucket as the source.

```bash
npx wrangler@latest pipelines create analytics-pipeline --r2-bucket analytics-pipeline
```

You'll also need to create a [D1 database](https://developers.cloudflare.com/d1/getting-started/create-a-database/) with the name `analytics-pipeline`.

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
  debug: true
});
```

### Defining Experiments

Experiments are to be created and defined in the dashboard (coming soon). These definitions will be loaded by the script.

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