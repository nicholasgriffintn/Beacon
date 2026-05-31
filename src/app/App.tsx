import { useState } from "react";

import { Analytics } from "./components/Analytics";
import { ExperimentTester } from "./components/ExperimentTester";
import { ProcessingModeTester } from "./components/ProcessingModeTester";
import { TestingControls } from "./components/TestingControls";

const codeExamples = {
  browser: `await BeaconOpenFeature.init({
  endpoint: "https://beacon.example.com",
  cdnEndpoint: "https://beacon-cdn.example.com",
  siteId: "docs",
});

const theme = await BeaconOpenFeature.getObjectDetails(
  "homepage_theme",
  { palette: "classic" }
);`,
  server: `POST /api/openfeature/v1/evaluate
{
  "flagKey": "checkout_flow",
  "defaultValue": "control",
  "flagValueType": "string",
  "context": {
    "targetingKey": "user_123",
    "siteId": "storefront"
  }
}`,
  track: `BeaconOpenFeature.track("signup_click", {}, {
  flagKey: "homepage_theme",
  conversionId: "signup_click",
  value: 1
});`,
};

const workflowSteps = [
  {
    title: "Create a flag",
    detail: "Define the flag key, default value, variations, and site scope.",
  },
  {
    title: "Attach an experiment",
    detail: "Run a traffic allocation layer inside the flag without changing client code.",
  },
  {
    title: "Await CDN publishing",
    detail: "Your configuration should be published globally within a few seconds, automatically.",
  },
  {
    title: "Measure outcomes",
    detail: "Join exposure and conversion events by flag, experiment, variant, and user.",
  },
];

export default function App() {
  const [selectedExample, setSelectedExample] = useState<keyof typeof codeExamples>("browser");

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
          <span className="brand-mark__glyph">B</span>
          <span>
            <strong>Beacon</strong>
            <small>Analytics and feature experimentation</small>
          </span>
        </a>
        <nav className="site-nav__links" aria-label="Sections">
          <a href="#workflow">Workflow</a>
          <a href="#developers">Developers</a>
        </nav>
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">Feature flags, experiments, analytics</p>
            <h1>Decide with observable flags.</h1>
            <p className="hero-lede">
              Beacon is a platform for feature experimentation and analytics built on top
              of the OpenFeature standard and Cloudflare's global network.
            </p>
            <p className="hero-lede">
              Run experiments and flags with confidence using real-time data and a reliable
              CDN delivery mechanism.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#developers">View setup</a>
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
                  <strong>Beacon</strong>
                  <span className="preview-sidebar__item active">Flags</span>
                  <span className="preview-sidebar__item">Results</span>
                  <span className="preview-sidebar__item">CDN</span>
                </aside>
                <section className="preview-panel">
                  <div className="preview-panel__header">
                    <div>
                      <p className="eyebrow">Flag</p>
                      <h2>homepage_theme</h2>
                    </div>
                    <span className="status-pill">Running</span>
                  </div>
                  <div className="preview-band">
                    <span>Experiment traffic</span>
                    <strong>72%</strong>
                    <div className="preview-meter"><span style={{ width: "72%" }} /></div>
                  </div>
                  <div className="variant-list">
                    <div>
                      <span>Control</span>
                      <strong>48.8%</strong>
                    </div>
                    <div>
                      <span>Treatment</span>
                      <strong>51.2%</strong>
                    </div>
                  </div>
                  <pre>{`flagMetadata: {
  source: "feature_flag",
  experiment_id: "exp_theme",
  variant_name: "Treatment"
}`}</pre>
                </section>
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="workflow-section">
          <div className="section-heading">
            <p className="eyebrow">Operational flow</p>
            <h2>From flag definition to result summary.</h2>
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
              <h2>Configure Beacon across clients in a few steps.</h2>
            </div>
            <p>
              Browser clients fetch one standards-compatible config from the CDN and resolve locally.
              Server clients can use the evaluate endpoint with the same flag key and context.
            </p>
            <div className="principle-list">
              <span>Canonical flag keys</span>
              <span>Nested experiment metadata</span>
              <span>Exposure and conversion joins</span>
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
        <span>Beacon</span>
        <a href="https://bitwobbly.com/status/beacon">Track application status</a>
      </footer>

      <ProcessingModeTester />
      <ExperimentTester />
      <TestingControls />
    </div>
  );
}
