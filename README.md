# Beacon

This is a project to create an analytics and experimentation pipeline and platform using Cloudflare services.

The idea being to have a fully open source, yet easily managed service that doesn't cost you your entire budget.

> [!NOTE]
> Please note that this project is still in active development so there are a few features that are not yet fully working or fully imagined.

## TODO

- [ ] Create a sites database and validate site IDs against that and valid URLs
- [ ] Create a Python backend for managing sites, analytics, experiments and variants
- [ ] Should have the ability to link experiments to metrics being sent via analytics but also custom metrics
- [ ] Create a backend service for getting the iceberg data and displaying it (Apache Superset?)
- [ ] Create a scheduled service that gets the results of the experiments and stores them in R2 (Apache Spark?)
- [ ] Expand on the feature flagging capability
- [ ] Instead of loading sites and experiments over an API, we should programatically store them statically and then load them from clients via a CDN JSON file
- [ ] Rewrite this todo list with the next set of tasks

## Running the Collector

The collector is the main part of this service that runs on Cloudflare Workers. It is responsible for collecting events from the website and sending them to the Cloudflare Pipelines service.

```bash
# Install the dependencies
pnpm install

# Run the worker
pnpm run dev

# Access the worker:
# - Worker URL: http://localhost:5173/beacon.js
```

## Running the Dashboard

The Beacon Dashboard is composed of a Python FastAPI backend and a React frontend. You can run both services using podman-compose:

```bash
# Navigate to the dashboard directory
cd dashboard

# Build and start the services
podman-compose up --build

# Access the application:
# - Dashboard: http://localhost:8080
# - Dashboard API: http://localhost:8081/api/hello
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
  trackUserTimings: true // Optional: track page performance metrics
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