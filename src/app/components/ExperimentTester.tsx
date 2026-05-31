import { useEffect, useState } from 'react';
import { useOpenFeature } from '../hooks/use-openfeature';
import { useTrackEvent } from '../hooks/use-track-event';
import {
  createDemoThemeTokens,
  DEMO_TARGETING_KEYS,
  type DemoThemeDetails,
  type DemoThemeVariant,
  getDemoThemeVariant,
} from '../lib/demo-theme';

const applyThemeDetails = (details: DemoThemeDetails | undefined) => {
  if (!details) return;

  const tokens = createDemoThemeTokens(details);
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
};

export function ExperimentTester() {
  const { getObjectDetails, track, isReady } = useOpenFeature();
  const trackEvent = useTrackEvent();
  const [resolvedVariant, setResolvedVariant] = useState<DemoThemeVariant | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only run once ready
  useEffect(() => {
    if (!isReady) return;

    const setupExperiment = async () => {
      const details = await getObjectDetails('color_scheme', {});
      applyThemeDetails(details);

      if (details?.errorCode) {
        return;
      }

      const variant = getDemoThemeVariant(details || {});
      setResolvedVariant(variant);
    };

    setupExperiment();
  }, [isReady]);

  const handleThemeChange = async (variant: DemoThemeVariant) => {
    if (!isReady) return;

    const context = {
      targetingKey: DEMO_TARGETING_KEYS[variant],
      demoVariant: variant,
    };
    const details = await getObjectDetails('color_scheme', {}, context);
    applyThemeDetails(details);

    if (details?.errorCode) {
      return;
    }

    const resolved = getDemoThemeVariant(details || {});
    setResolvedVariant(resolved);

    await track('theme_preview', context, {
      flagKey: 'color_scheme',
      flagSource: 'feature_flag',
      conversionId: 'theme_preview',
      value: 1,
      previewVariant: variant,
      variant: details?.variant,
      variantId: details?.flagMetadata?.variant_id,
      variantName: details?.flagMetadata?.variant_name,
    });
    trackEvent({
      name: 'openfeature_theme_preview',
      category: 'openfeature',
      label: 'color_scheme',
      value: resolved,
      properties: {
        requested_variant: variant,
        resolved_variant: resolved,
      },
    });
  };

  if (!isReady) return null;

  return (
    <div className="experiment-tester">
      <div className="experiment-tester__title">
        Experiment Controls
      </div>
      <div className="experiment-tester__controls">
        <button
          type="button"
          onClick={() => handleThemeChange('control')}
          className={`experiment-tester__control ${resolvedVariant === 'control' ? 'active' : ''}`}
        >
          Light Theme
        </button>
        <button
          type="button"
          onClick={() => handleThemeChange('dark')}
          className={`experiment-tester__variant ${resolvedVariant === 'dark' ? 'active' : ''}`}
        >
          Dark Theme
        </button>
      </div>
    </div>
  );
} 
