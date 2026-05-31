import { useEffect } from 'react';
import { useOpenFeature } from '../hooks/use-openfeature';
import { useTrackEvent } from '../hooks/use-track-event';

const setLightTheme = (config: Record<string, string> = {}) => {
  document.documentElement.style.setProperty('--bg-color', config.bgColor || '#ffffff');
  document.documentElement.style.setProperty('--text-color', config.textColor || '#333333');
  document.documentElement.style.setProperty('--heading-color', config.headingColor || '#2563eb');
  document.documentElement.style.setProperty('--border-color', config.borderColor || '#e5e7eb');
};

const setDarkTheme = (config: Record<string, string> = {}) => {
  document.documentElement.style.setProperty('--bg-color', config.bgColor || '#1a1a1a');
  document.documentElement.style.setProperty('--text-color', config.textColor || '#e5e7eb');
  document.documentElement.style.setProperty('--heading-color', config.headingColor || '#60a5fa');
  document.documentElement.style.setProperty('--border-color', config.borderColor || '#374151');
  document.documentElement.style.setProperty('--code-bg', config.codeBg || '#2d3748');
  document.documentElement.style.setProperty('--code-text', config.codeText || '#e2e8f0');
};

export function ExperimentTester() {
  const { getObjectDetails, track, isReady } = useOpenFeature();
  const trackEvent = useTrackEvent();

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only run once ready
  useEffect(() => {
    if (!isReady) return;

    const setupExperiment = async () => {
      const details = await getObjectDetails('color_scheme', {});

      if (details?.variant === 'color_scheme_dark' || details?.flagMetadata.variant_name === 'dark') {
        setDarkTheme(details.value);
      } else {
        setLightTheme(details?.value || {});
      }
    };

    setupExperiment();
  }, [isReady]);

  const handleThemeChange = async (variant: 'control' | 'dark') => {
    if (!isReady) return;

    if (variant === 'dark') {
      setDarkTheme();
    } else {
      setLightTheme();
    }

    track('theme_preview', {}, {
      flagKey: 'color_scheme',
      flagSource: 'feature_flag',
      conversionId: 'theme_preview',
      value: 1,
      previewVariant: variant,
    });
    trackEvent({
      name: 'openfeature_theme_preview',
      category: 'openfeature',
      label: 'color_scheme',
      value: variant
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
          className="experiment-tester__control"
        >
          Light Theme
        </button>
        <button
          type="button"
          onClick={() => handleThemeChange('dark')}
          className="experiment-tester__variant"
        >
          Dark Theme
        </button>
      </div>
    </div>
  );
} 
