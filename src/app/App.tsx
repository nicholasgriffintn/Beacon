import { useState } from "react";

import { Analytics } from "./components/Analytics";
import { ExperimentTester } from "./components/ExperimentTester";
import { ProcessingModeTester } from "./components/ProcessingModeTester";
import { TestingControls } from "./components/TestingControls";

const codeExamples = {
  analytics: `Beacon.init({
  endpoint: "https://beacon.nicholasgriffin.dev",
  siteId: "storefront",
  trackPageViews: true,
  trackClicks: true,
  trackUserTimings: true,
  directEvents: false,
});

Beacon.trackEvent({
  name: "signup_click",
  category: "conversion",
  label: "pricing_hero",
  value: 1,
});`,
  delivery: `Beacon.init({
  endpoint: "https://beacon.nicholasgriffin.dev",
  siteId: "checkout",
  directPageViews: true,
  directEvents: false,
  batchSize: 10,
  batchTimeout: 5000,
});

Beacon.trackPageView({
  content_type: "checkout",
  properties: { plan: "pro" },
});`,
  flags: `await BeaconOpenFeature.init({
  endpoint: "https://beacon.nicholasgriffin.dev",
  cdnEndpoint: "https://beacon-cdn.nicholasgriffin.dev",
  siteId: "storefront",
});

const details = await BeaconOpenFeature.getObjectDetails(
  "checkout_flow",
  { layout: "control" }
);`,
};

const workflowSteps = [
  {
    title: "Capture events",
    detail: "Collect page views, clicks, timings, and custom product events from every registered service.",
  },
  {
    title: "Control delivery",
    detail: "Choose batched or direct ingestion for each workload and keep noisy clients behind rate limits.",
  },
  {
    title: "Read behaviour",
    detail: "Use the same event stream for traffic, conversion, interaction, and performance views.",
  },
  {
    title: "Ship decisions",
    detail: "Attach flags and experiments when you need controlled rollout and outcome measurement.",
  },
];

const analyticsCards = [
  {
    label: "Event analytics",
    value: "Page views, clicks, custom events",
    detail: "Track behaviour across your services without making experimentation mandatory.",
  },
  {
    label: "Processing modes",
    value: "Batch or direct",
    detail: "Queue routine telemetry and send critical conversion events immediately.",
  },
  {
    label: "Decision layer",
    value: "Flags and experiments",
    detail: "Use analytics data to evaluate product changes when you need controlled rollout.",
  },
];

export default function App() {
  const [selectedExample, setSelectedExample] = useState<keyof typeof codeExamples>("analytics");

  return (
    <div className="beacon-app-shell">
      <Analytics
        isEnabled={true}
        beaconSiteId="beacon-docs"
        beaconDebug={true}
        directEvents={false}
        directPageViews={false}
        batchSize={10}
        batchTimeout={1000}
      />

      <header className="site-nav" aria-label="Primary">
        <a className="brand-mark" href="/">
          <img className="brand-mark__glyph" src="/favicon.svg" alt="" aria-hidden="true" />
          <span>
            <strong>Beacon</strong>
            <small>Analytics and feature experimentation</small>
          </span>
        </a>
        <nav className="site-nav__links" aria-label="Sections">
          <a href="#analytics">Analytics</a>
          <a href="#workflow">Workflow</a>
          <a href="#developers">Developers</a>
        </nav>
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">Analytics, events, product decisions</p>
            <h1>Understand your services. Ship better decisions.</h1>
            <p className="hero-lede">
              Beacon collects page views, clicks, user timings, custom events, and
              conversion signals across your services.
            </p>
            <p className="hero-lede">
              The same event stream powers analytics dashboards, feature rollouts,
              experiments, and result summaries without splitting product data across tools.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#developers">View analytics setup</a>
              <a className="btn btn-secondary" href="#workflow">See workflow</a>
            </div>
          </div>

          <div className="product-preview" aria-label="Beacon interface preview">
            <div className="preview-window">
              <div className="preview-window__chrome">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div className="preview-grid">
                <aside className="preview-sidebar">
                  <span className="preview-sidebar__item active">Analytics</span>
                  <span className="preview-sidebar__item">Events</span>
                  <span className="preview-sidebar__item">Results</span>
                  <span className="preview-sidebar__item">Flags</span>
                </aside>
                <section className="preview-panel">
                  <div className="preview-panel__header">
                    <div>
                      <p className="eyebrow">Analytics</p>
                      <h2>service_overview</h2>
                    </div>
                    <span className="status-pill">Live</span>
                  </div>
                  <div className="preview-band">
                    <span>Events today</span>
                    <strong>184,092</strong>
                    <div className="preview-meter"><span style={{ width: "68%" }} /></div>
                  </div>
                  <div className="variant-list">
                    <div>
                      <span>Page views</span>
                      <strong>126k</strong>
                    </div>
                    <div>
                      <span>Conversions</span>
                      <strong>4.8%</strong>
                    </div>
                  </div>
                  <pre>{`event: {
  name: "signup_click",
  category: "conversion",
  source: "pricing",
  value: 1
}`}</pre>
                </section>
              </div>
            </div>
          </div>
        </section>

        <section id="analytics" className="metric-strip" aria-label="Analytics capabilities">
          {analyticsCards.map((card) => (
            <article key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <p>{card.detail}</p>
            </article>
          ))}
        </section>

        <section id="workflow" className="workflow-section">
          <div className="section-heading">
            <p className="eyebrow">Operational flow</p>
            <h2>From event collection to product decision.</h2>
          </div>
          <div className="workflow-grid">
            {workflowSteps.map((step, index) => (
              <article key={step.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="developers" className="split-section">
          <div>
            <div className="section-heading">
              <p className="eyebrow">Developer setup</p>
              <h2>Install analytics first. Add flags when decisions need rollout control.</h2>
            </div>
            <p>
              The analytics client records page views and custom events immediately. Flag
              clients can then reuse the same site identity and conversion stream for experiment results.
            </p>
            <div className="principle-list">
              <span>Automatic page views</span>
              <span>Custom event tracking</span>
              <span>Conversion joins</span>
            </div>
          </div>

          <div className="code-console">
            <div className="code-console__tabs" role="tablist" aria-label="Code examples">
              {Object.keys(codeExamples).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={selectedExample === key ? "active" : ""}
                  onClick={() => setSelectedExample(key as keyof typeof codeExamples)}
                >
                  {key}
                </button>
              ))}
            </div>
            <pre>{codeExamples[selectedExample]}</pre>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>Beacon</span>
          <a href="https://bitwobbly.com/status/beacon">Track application status</a>
        </div>
      </footer>

      <ProcessingModeTester />
      <ExperimentTester />
      <TestingControls />
    </div>
  );
}
