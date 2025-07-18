/**
 * BeaconExperiments - A/B testing extension for Beacon Analytics
 */

// biome-ignore lint/complexity/useArrowFunction: <explanation>
(function(window) {
  // Experiment configuration defaults
  const defaultConfig = {
    endpoint: 'https://beacon.nickgriffin.uk',
    storageKey: 'beacon_experiments',
    storageDuration: 90, // days
    debug: false
  };

  let experimentAssignments = {};
  const experimentBehaviors = {};
  let isInitialized = false;

  const saveToStorage = () => {
    try {
      const data = {
        assignments: experimentAssignments,
        behaviors: experimentBehaviors,
        expiry: Date.now() + (BeaconExperiments.config.storageDuration * 24 * 60 * 60 * 1000)
      };
      
      localStorage.setItem(BeaconExperiments.config.storageKey, JSON.stringify(data));
      
      if (BeaconExperiments.config.debug) {
        console.log('BeaconExperiments: Saved data to storage', data);
      }
    } catch (e) {
      if (BeaconExperiments.config.debug) {
        console.error('BeaconExperiments: Error saving to storage', e);
      }
    }
  };

  const loadFromStorage = () => {
    try {
      const data = localStorage.getItem(BeaconExperiments.config.storageKey);
      if (!data) return {};
      
      const parsed = JSON.parse(data);
      
      if (parsed.expiry && parsed.expiry < Date.now()) {
        if (BeaconExperiments.config.debug) {
          console.log('BeaconExperiments: Data expired, clearing');
        }
        localStorage.removeItem(BeaconExperiments.config.storageKey);
        return {};
      }
      
      if (BeaconExperiments.config.debug) {
        console.log('BeaconExperiments: Loaded data from storage', parsed);
      }
      
      return {
        assignments: parsed.assignments || {},
        behaviors: parsed.behaviors || {}
      };
    } catch (e) {
      if (BeaconExperiments.config.debug) {
        console.error('BeaconExperiments: Error loading from storage', e);
      }
      return {};
    }
  };

  const getExperimentUserId = () => {
    if (window.Beacon && typeof window.Beacon.getUserId === 'function') {
      return window.Beacon.getUserId();
    }
    
    let userId = localStorage.getItem('beacon_experiment_user_id');
    if (!userId) {
      userId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
      localStorage.setItem('beacon_experiment_user_id', userId);
    }
    return userId;
  };

  const fetchExperiments = async () => {
    try {
      const response = await fetch(`${BeaconExperiments.config.endpoint}/api/experiments`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (BeaconExperiments.config.debug) {
        console.error('BeaconExperiments: Error fetching experiments', error);
      }
      return [];
    }
  };

  const getVariant = async (experimentId, options = {}) => {
    if (!isInitialized) {
      if (BeaconExperiments.config.debug) {
        console.warn('BeaconExperiments: Not initialized. Call init() first.');
      }
      return null;
    }

    if (experimentAssignments[experimentId] !== undefined) {
      const assignment = experimentAssignments[experimentId];
      if (assignment.expiry > Date.now()) {
        return assignment.variant;
      }
    }

    const userId = getExperimentUserId();

    try {
      const response = await fetch(`${BeaconExperiments.config.endpoint}/api/experiments/${experimentId}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: userId,
          attributes: options.attributes || {}
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const assignment = await response.json();
      
      experimentAssignments[experimentId] = {
        variant: assignment,
        expiry: Date.now() + (BeaconExperiments.config.storageDuration * 24 * 60 * 60 * 1000)
      };
      saveToStorage();

      if (window.Beacon && options.trackExposure !== false) {
        window.Beacon.trackEvent({
          name: 'experiment_exposure',
          category: 'experiment',
          label: experimentId,
          properties: {
            experiment_id: experimentId,
            variant_id: assignment.variant_id,
            variant_name: assignment.variant_name
          }
        });
      }

      return assignment;
    } catch (error) {
      if (BeaconExperiments.config.debug) {
        console.error('BeaconExperiments: Error getting variant', error);
      }
      return null;
    }
  };

  const defineExperimentBehaviors = (experimentConfigs) => {
    if (!Array.isArray(experimentConfigs)) {
      if (BeaconExperiments.config.debug) {
        console.error('BeaconExperiments: defineExperimentBehaviors requires an array');
      }
      return;
    }
    
    for (const config of experimentConfigs) {
      if (!config.id) {
        if (BeaconExperiments.config.debug) {
          console.error('BeaconExperiments: Experiment missing ID', config);
        }
        continue;
      }
      
      experimentBehaviors[config.id] = {
        autoActivate: config.autoActivate,
        variants: config.variants
      };
    }
    
    saveToStorage();
    
    if (BeaconExperiments.config.debug) {
      console.log('BeaconExperiments: Defined behaviors', experimentBehaviors);
    }
  };

  const isInVariant = async (experimentId, variantId, options = {}) => {
    const assignment = await getVariant(experimentId, options);
    return assignment && assignment.variant_id === variantId;
  };

  const activate = async (experimentId, options = {}) => {
    const assignment = await getVariant(experimentId, options);
    if (!assignment) return false;

    const behavior = experimentBehaviors[experimentId];
    if (!behavior) {
      if (BeaconExperiments.config.debug) {
        console.warn(`BeaconExperiments: No behaviors defined for experiment "${experimentId}"`);
      }
      return false;
    }

    const variantBehavior = behavior.variants.find(v => v.id === assignment.variant_id);
    if (!variantBehavior || !variantBehavior.activate) return false;

    variantBehavior.activate(assignment.config);

    if (BeaconExperiments.config.debug) {
      console.log(`BeaconExperiments: Activated experiment "${experimentId}" with variant "${assignment.variant_id}"`);
    }

    return true;
  };

  const activateAll = async () => {
    const experiments = await fetchExperiments();
    
    const activationPromises = experiments
      .filter(exp => experimentBehaviors[exp.id]?.autoActivate)
      .map(exp => activate(exp.id));

    await Promise.all(activationPromises);
  };

  const trackConversion = (experimentId, conversionId, value = 0, properties = {}) => {
    if (!window.Beacon) {
      if (BeaconExperiments.config.debug) {
        console.warn('BeaconExperiments: Beacon not available for tracking conversion');
      }
      return;
    }

    const assignment = experimentAssignments[experimentId];
    if (!assignment) return;

    window.Beacon.trackEvent({
      name: 'experiment_conversion',
      category: 'experiment',
      label: conversionId,
      value: value,
      properties: {
        ...properties,
        experiment_id: experimentId,
        variant_id: assignment.variant.variant_id,
        variant_name: assignment.variant.variant_name,
        conversion_id: conversionId
      }
    });

    if (BeaconExperiments.config.debug) {
      console.log(`BeaconExperiments: Tracked conversion - Experiment: ${experimentId}, Conversion: ${conversionId}`);
    }
  };

  const resetAssignments = () => {
    experimentAssignments = {};
    localStorage.removeItem(BeaconExperiments.config.storageKey);
    
    if (BeaconExperiments.config.debug) {
      console.log('BeaconExperiments: Reset all assignments');
    }
  };

  const forceVariant = (experimentId, variantId) => {
    const assignment = {
      experiment_id: experimentId,
      variant_id: variantId,
      variant_name: variantId,
      config: {}
    };

    experimentAssignments[experimentId] = {
      variant: assignment,
      expiry: Date.now() + (BeaconExperiments.config.storageDuration * 24 * 60 * 60 * 1000)
    };
    saveToStorage();
    
    if (BeaconExperiments.config.debug) {
      console.log(`BeaconExperiments: Forced variant "${variantId}" for experiment "${experimentId}"`);
    }

    return assignment;
  };

  const BeaconExperiments = {
    version: '1.0.0',
    config: { ...defaultConfig },
    
    init: async function(customConfig = {}) {
      this.config = { ...this.config, ...customConfig };
      
      const stored = loadFromStorage();
      experimentAssignments = stored.assignments || {};
      Object.assign(experimentBehaviors, stored.behaviors || {});
      
      isInitialized = true;
      
      if (this.config.debug) {
        console.log('BeaconExperiments: Initialized with config', this.config);
      }
      
      return this;
    },
    
    defineExperimentBehaviors,
    activate,
    activateAll,
    getVariant,
    isInVariant,
    trackConversion,
    resetAssignments,
    forceVariant,
    getUserId: getExperimentUserId
  };
  
  window.BeaconExperiments = BeaconExperiments;
  
})(window);