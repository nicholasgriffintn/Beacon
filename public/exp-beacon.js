/**
 * BeaconExperiments - A/B testing extension for Beacon Analytics
 */

// biome-ignore lint/complexity/useArrowFunction: <explanation>
(function(window) {
  // Experiment configuration defaults
  const defaultConfig = {
    storageKey: 'beacon_experiments',
    storageDuration: 90, // days
    hashFunction: 'fnv', // 'fnv' or 'murmur'
    debug: false
  };

  // Cache for experiment assignments
  let experimentAssignments = {};
  const experiments = {};
  let isInitialized = false;

  // FNV-1a hash function (32-bit)
  const fnvHash = (str) => {
    let h = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return h >>> 0; // Convert to unsigned
  };

  // MurmurHash3 implementation (faster but more complex)
  const murmurHash = (str) => {
    const remainder = str.length & 3; // str.length % 4
    const bytes = str.length - remainder;
    let h1 = 0; // seed = 0
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    let i = 0;
    
    // Handle 4 bytes at a time
    while (i < bytes) {
      let k1 = ((str.charCodeAt(i) & 0xff)) |
        ((str.charCodeAt(i + 1) & 0xff) << 8) |
        ((str.charCodeAt(i + 2) & 0xff) << 16) |
        ((str.charCodeAt(i + 3) & 0xff) << 24);
      i += 4;
      
      k1 = ((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = ((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16);
      
      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      const h1b = ((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16);
      h1 = (h1b & 0xffff) + 0x6b64 + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16);
    }
    
    // Handle remaining bytes
    let k1 = 0;
    switch (remainder) {
      case 3: k1 ^= (str.charCodeAt(i + 2) & 0xff) << 16;
      case 2: k1 ^= (str.charCodeAt(i + 1) & 0xff) << 8;
      case 1: k1 ^= (str.charCodeAt(i) & 0xff);
          k1 = ((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16);
          k1 = (k1 << 15) | (k1 >>> 17);
          k1 = ((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16);
          h1 ^= k1;
    }
    
    // Finalization
    h1 ^= str.length;
    h1 ^= h1 >>> 16;
    h1 = ((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16);
    h1 ^= h1 >>> 13;
    h1 = ((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16);
    h1 ^= h1 >>> 16;
    
    return h1 >>> 0; // Convert to unsigned
  };

  // Choose hash function based on config
  const getHashFunction = () => {
    if (BeaconExperiments.config.hashFunction === 'murmur') {
      return murmurHash;
    }
    return fnvHash; // Default to FNV
  };

  // Compute hash and normalize to 0-1 range
  const computeHash = (str) => {
    const hashFn = getHashFunction();
    const hash = hashFn(str);
    return (hash % 10000) / 10000; // Normalize to 0-1
  };

  // Save experiment assignments to storage
  const saveAssignments = () => {
    try {
      const data = {
        assignments: experimentAssignments,
        expiry: Date.now() + (BeaconExperiments.config.storageDuration * 24 * 60 * 60 * 1000)
      };
      
      localStorage.setItem(BeaconExperiments.config.storageKey, JSON.stringify(data));
      
      if (BeaconExperiments.config.debug) {
        console.log('BeaconExperiments: Saved assignments', experimentAssignments);
      }
    } catch (e) {
      if (BeaconExperiments.config.debug) {
        console.error('BeaconExperiments: Error saving assignments', e);
      }
    }
  };

  // Load experiment assignments from storage
  const loadAssignments = () => {
    try {
      const data = localStorage.getItem(BeaconExperiments.config.storageKey);
      if (!data) return {};
      
      const parsed = JSON.parse(data);
      
      // Check if assignments have expired
      if (parsed.expiry && parsed.expiry < Date.now()) {
        if (BeaconExperiments.config.debug) {
          console.log('BeaconExperiments: Assignments expired, clearing');
        }
        localStorage.removeItem(BeaconExperiments.config.storageKey);
        return {};
      }
      
      if (BeaconExperiments.config.debug) {
        console.log('BeaconExperiments: Loaded assignments', parsed.assignments);
      }
      
      return parsed.assignments || {};
    } catch (e) {
      if (BeaconExperiments.config.debug) {
        console.error('BeaconExperiments: Error loading assignments', e);
      }
      return {};
    }
  };

  // Get or create a user ID for experiments
  const getExperimentUserId = () => {
    // Try to use Beacon's user ID if available
    if (window.Beacon && typeof window.Beacon.getUserId === 'function') {
      return window.Beacon.getUserId();
    }
    
    // Fall back to our own ID
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

  // Assign a user to experiment variant based on their ID and experiment config
  const assignToVariant = (experimentId, userId, experimentConfig) => {
    // Check if experiment is active
    if (!experimentConfig.active) {
      return null;
    }
    
    // Check if experiment has valid variants
    if (!experimentConfig.variants || !Array.isArray(experimentConfig.variants) || experimentConfig.variants.length === 0) {
      return null;
    }
    
    // Check experiment targeting
    if (experimentConfig.targeting && typeof experimentConfig.targeting === 'function') {
      if (!experimentConfig.targeting()) {
        return null;
      }
    }
    
    // Consistent bucketing - use the user ID and experiment ID to generate a hash
    const bucketValue = computeHash(`${userId}_${experimentId}`);
    
    // Find the right variant based on traffic allocation
    let cumulativeWeight = 0;
    const totalWeight = experimentConfig.variants.reduce((sum, variant) => sum + (variant.weight || 1), 0);
    
    for (const variant of experimentConfig.variants) {
      const variantWeight = variant.weight || 1;
      const normalizedWeight = variantWeight / totalWeight;
      cumulativeWeight += normalizedWeight;
      
      if (bucketValue <= cumulativeWeight) {
        return variant.id;
      }
    }
    
    // Fallback to first variant (shouldn't happen unless there's a math error)
    return experimentConfig.variants[0].id;
  };

  // Track experiment exposure
  const trackExposure = (experimentId, variantId) => {
    if (!window.Beacon) {
      if (BeaconExperiments.config.debug) {
        console.warn('BeaconExperiments: Beacon not available for tracking exposure');
      }
      return;
    }
    
    window.Beacon.trackEvent({
      name: 'experiment_exposure',
      category: 'experiment',
      label: experimentId,
      properties: {
        experiment_id: experimentId,
        variant_id: variantId
      }
    });
    
    if (BeaconExperiments.config.debug) {
      console.log(`BeaconExperiments: Tracked exposure - Experiment: ${experimentId}, Variant: ${variantId}`);
    }
  };

  // Get variant for an experiment, or assign if not already assigned
  const getVariant = (experimentId, options = {}) => {
    if (!isInitialized) {
      if (BeaconExperiments.config.debug) {
        console.warn('BeaconExperiments: Not initialized. Call init() first.');
      }
      return null;
    }
    
    // Check if experiment exists
    const experimentConfig = experiments[experimentId];
    if (!experimentConfig) {
      if (BeaconExperiments.config.debug) {
        console.warn(`BeaconExperiments: Experiment "${experimentId}" not found`);
      }
      return null;
    }
    
    // Check if already assigned
    if (experimentAssignments[experimentId] !== undefined) {
      const variantId = experimentAssignments[experimentId];
      
      // Track exposure if requested
      if (options.trackExposure !== false) {
        trackExposure(experimentId, variantId);
      }
      
      return variantId;
    }
    
    // Get the user ID for consistent assignment
    const userId = getExperimentUserId();
    
    // Assign to a variant
    const variantId = assignToVariant(experimentId, userId, experimentConfig);
    
    // Store the assignment
    if (variantId !== null) {
      experimentAssignments[experimentId] = variantId;
      saveAssignments();
      
      // Track exposure if requested
      if (options.trackExposure !== false) {
        trackExposure(experimentId, variantId);
      }
    }
    
    return variantId;
  };

  // Check if user is in a specific variant
  const isInVariant = (experimentId, variantId, options = {}) => {
    const assignedVariant = getVariant(experimentId, options);
    return assignedVariant === variantId;
  };

  // Activate an experiment and apply the variant changes
  const activate = (experimentId, options = {}) => {
    const variantId = getVariant(experimentId, options);
    if (!variantId) return false;
    
    const experimentConfig = experiments[experimentId];
    if (!experimentConfig) return false;
    
    // Find the variant
    const variant = experimentConfig.variants.find(v => v.id === variantId);
    if (!variant) return false;
    
    // Execute the activation function if available
    if (variant.activate && typeof variant.activate === 'function') {
      variant.activate();
      
      if (BeaconExperiments.config.debug) {
        console.log(`BeaconExperiments: Activated experiment "${experimentId}" with variant "${variantId}"`);
      }
      
      return true;
    }
    
    return false;
  };

  // Track experiment conversion
  const trackConversion = (experimentId, conversionId, value = 0, properties = {}) => {
    if (!window.Beacon) {
      if (BeaconExperiments.config.debug) {
        console.warn('BeaconExperiments: Beacon not available for tracking conversion');
      }
      return;
    }
    
    // Check if user is in the experiment
    const variantId = getVariant(experimentId, { trackExposure: false });
    if (!variantId) return;
    
    window.Beacon.trackEvent({
      name: 'experiment_conversion',
      category: 'experiment',
      label: conversionId,
      value: value,
      properties: {
        ...properties,
        experiment_id: experimentId,
        variant_id: variantId,
        conversion_id: conversionId
      }
    });
    
    if (BeaconExperiments.config.debug) {
      console.log(`BeaconExperiments: Tracked conversion - Experiment: ${experimentId}, Variant: ${variantId}, Conversion: ${conversionId}`);
    }
  };

  // Define experiments
  const defineExperiments = (experimentConfigs) => {
    if (!Array.isArray(experimentConfigs)) {
      if (BeaconExperiments.config.debug) {
        console.error('BeaconExperiments: defineExperiments requires an array');
      }
      return;
    }
    
    // Process each experiment config
    for (const config of experimentConfigs) {
      if (!config.id) {
        if (BeaconExperiments.config.debug) {
          console.error('BeaconExperiments: Experiment missing ID', config);
        }
        return;
      }
      
      experiments[config.id] = {
        ...config,
        active: config.active !== false // Default to active if not specified
      };
      
      if (BeaconExperiments.config.debug) {
        console.log(`BeaconExperiments: Defined experiment "${config.id}"`, config);
      }
    }
  };

  // Activate all auto-activate experiments
  const activateAll = () => {
    for (const experimentId in experiments) {
      const experimentConfig = experiments[experimentId];
      
      if (experimentConfig.autoActivate === true) {
        activate(experimentId);
      }
    }
  };

  // Reset all experiment assignments (for testing)
  const resetAssignments = () => {
    experimentAssignments = {};
    localStorage.removeItem(BeaconExperiments.config.storageKey);
    
    if (BeaconExperiments.config.debug) {
      console.log('BeaconExperiments: Reset all assignments');
    }
  };

  // Force assign a variant (for testing)
  const forceVariant = (experimentId, variantId) => {
    experimentAssignments[experimentId] = variantId;
    saveAssignments();
    
    if (BeaconExperiments.config.debug) {
      console.log(`BeaconExperiments: Forced variant "${variantId}" for experiment "${experimentId}"`);
    }
  };

  // The main BeaconExperiments object
  const BeaconExperiments = {
    version: '1.0.0',
    config: { ...defaultConfig },
    
    // Initialize the experiment system
    init: function(customConfig = {}) {
      // Merge configs
      this.config = { ...this.config, ...customConfig };
      
      // Load stored assignments
      experimentAssignments = loadAssignments();
      
      isInitialized = true;
      
      if (this.config.debug) {
        console.log('BeaconExperiments: Initialized with config', this.config);
      }
      
      return this;
    },
    
    // Public methods
    defineExperiments,
    activate,
    activateAll,
    getVariant,
    isInVariant,
    trackConversion,
    resetAssignments,
    forceVariant,
    getUserId: getExperimentUserId
  };
  
  // Expose the BeaconExperiments object globally
  window.BeaconExperiments = BeaconExperiments;
  
})(window);