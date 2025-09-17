import { useEffect } from 'react';
import { useExperiments } from '../hooks/use-experiments';
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
  const { defineExperimentBehaviors, activate, getVariant, forceVariant, isReady } = useExperiments();
  const trackEvent = useTrackEvent();

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only run once ready
  useEffect(() => {
    if (!isReady) return;

    const setupExperiment = async () => {
      await defineExperimentBehaviors([
        {
          id: 'color_scheme',
          autoActivate: true,
          variants: [
            {
              id: 'control',
              activate: (config) => {
                setLightTheme(config);
              }
            },
            {
              id: 'dark',
              activate: (config) => {
                setDarkTheme(config);
              }
            }
          ]
        }
      ]);

      await activate('color_scheme');
      const variant = await getVariant('color_scheme');

      if (variant?.variant_id === 'dark') {
        setDarkTheme(variant.config);
      } else {
        setLightTheme(variant?.config || {});
      }
    };

    setupExperiment();
  }, [isReady]);

  const handleThemeChange = async (variant: 'control' | 'dark') => {
    if (!isReady) return;

    await forceVariant('color_scheme', variant);

    await activate('color_scheme');

    trackEvent({
      name: 'experiment_force',
      category: 'experiments',
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