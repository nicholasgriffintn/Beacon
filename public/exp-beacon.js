/**
 * Beacon OpenFeature provider client.
 */
(function (window) {
  const defaultConfig = {
    endpoint: 'https://beacon.nicholasgriffin.dev',
    cdnEndpoint: 'https://beacon-cdn.nicholasgriffin.dev',
    siteId: '',
    storageKey: 'beacon_openfeature',
    storageDuration: 90,
    configCacheDuration: 5 * 60 * 1000,
    bootstrap: null,
    debug: false
  };

  let evaluationContext = {};
  let cachedDetails = {};
  let latestDetailsByFlagKey = {};
  let bootstrappedDetailsByFlagKey = {};
  let openFeatureConfig = null;
  let configExpiry = 0;
  let configPromise = null;
  const pendingEvaluations = {};
  let isInitialized = false;

  const providerMetadata = Object.freeze({
    name: 'beacon'
  });

  const stableStringify = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  };

  const hashToUint32 = (input) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  };

  const getDeterministicBucket = (input) => (hashToUint32(input) / 0x100000000) * 100;

  const getValueType = (value) => {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    return 'object';
  };

  const matchesValueType = (value, expectedType) => {
    if (expectedType === 'object') {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    return typeof value === expectedType;
  };

  const getSiteId = () => {
    return BeaconOpenFeature.config.siteId || window.Beacon?.config?.siteId || '';
  };

  const generateUserId = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const getTargetingKey = () => {
    if (window.Beacon && typeof window.Beacon.getUserId === 'function') {
      return window.Beacon.getUserId();
    }

    try {
      let userId = localStorage.getItem('beacon_openfeature_targeting_key');
      if (!userId) {
        userId = generateUserId();
        localStorage.setItem('beacon_openfeature_targeting_key', userId);
      }
      return userId;
    } catch {
      return generateUserId();
    }
  };

  const createDetails = ({ flagKey, value, reason, variant, flagMetadata = {} }) => ({
    flagKey,
    value,
    reason,
    variant,
    flagMetadata
  });

  const createErrorDetails = (flagKey, defaultValue, errorCode, errorMessage) => ({
    flagKey,
    value: defaultValue,
    reason: 'ERROR',
    errorCode,
    errorMessage,
    flagMetadata: {}
  });

  const saveToStorage = () => {
    try {
      const data = {
        details: cachedDetails,
        latestDetailsByFlagKey,
        context: evaluationContext,
        config: openFeatureConfig,
        configExpiry,
        expiry: Date.now() + (BeaconOpenFeature.config.storageDuration * 24 * 60 * 60 * 1000)
      };
      localStorage.setItem(BeaconOpenFeature.config.storageKey, JSON.stringify(data));
    } catch {
      // Evaluation methods should not throw because storage is unavailable.
    }
  };

  const loadFromStorage = () => {
    try {
      const data = localStorage.getItem(BeaconOpenFeature.config.storageKey);
      if (!data) return;

      const parsed = JSON.parse(data);
      if (parsed.expiry && parsed.expiry < Date.now()) {
        localStorage.removeItem(BeaconOpenFeature.config.storageKey);
        return;
      }

      cachedDetails = parsed.details || {};
      latestDetailsByFlagKey = parsed.latestDetailsByFlagKey || {};
      evaluationContext = parsed.context || {};
      openFeatureConfig = parsed.config || null;
      configExpiry = parsed.configExpiry || 0;
    } catch {
      cachedDetails = {};
      latestDetailsByFlagKey = {};
      evaluationContext = {};
      openFeatureConfig = null;
      configExpiry = 0;
    }
  };

  const mergeContext = (invocationContext = {}) => {
    const siteId = getSiteId();
    const targetingKey = getTargetingKey();

    return {
      siteId,
      targetingKey,
      ...evaluationContext,
      ...invocationContext
    };
  };

  const getConfigUrl = () => {
    if (BeaconOpenFeature.config.configUrl) return BeaconOpenFeature.config.configUrl;
    return `${BeaconOpenFeature.config.cdnEndpoint}/config/v1/openfeature/latest.json`;
  };

  const loadOpenFeatureConfig = async () => {
    if (openFeatureConfig && configExpiry > Date.now()) {
      return openFeatureConfig;
    }

    if (configPromise) {
      return configPromise;
    }

    configPromise = (async () => {
      const response = await fetch(getConfigUrl(), {
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Config fetch failed: ${response.status}`);
      }

      const config = await response.json();
      if (!config || !Array.isArray(config.flags)) {
        throw new Error('Invalid OpenFeature config');
      }

      openFeatureConfig = config;
      configExpiry = Date.now() + BeaconOpenFeature.config.configCacheDuration;
      saveToStorage();
      return config;
    })();

    try {
      return await configPromise;
    } finally {
      configPromise = null;
    }
  };

  const siteMatches = (definition, context) => {
    return !definition.site_id || definition.site_id === context.siteId;
  };

  const findFlagDefinition = (config, flagKey, context) => {
    return config.flags.find((flag) => flag.flagKey === flagKey && siteMatches(flag, context));
  };

  const evaluateCondition = (condition, context) => {
    const attributeValue = context[condition.attribute];
    if (attributeValue === undefined) return false;

    switch (condition.operator) {
      case 'equals':
      case 'in':
        return condition.values.includes(attributeValue);
      case 'not_equals':
      case 'not_in':
        return !condition.values.includes(attributeValue);
      case 'contains':
        return typeof attributeValue === 'string' && condition.values.some((value) => String(attributeValue).includes(String(value)));
      case 'not_contains':
        return typeof attributeValue !== 'string' || !condition.values.some((value) => String(attributeValue).includes(String(value)));
      case 'greater_than':
        return condition.values.some((value) => Number(attributeValue) > Number(value));
      case 'less_than':
        return condition.values.some((value) => Number(attributeValue) < Number(value));
      case 'matches':
        return typeof attributeValue === 'string' && condition.values.some((value) => {
          try {
            return new RegExp(String(value)).test(String(attributeValue));
          } catch {
            return false;
          }
        });
      case 'not_matches':
        return typeof attributeValue !== 'string' || !condition.values.some((value) => {
          try {
            return new RegExp(String(value)).test(String(attributeValue));
          } catch {
            return false;
          }
        });
      default:
        return false;
    }
  };

  const isInRollout = (targetingKey, bucketKey, percentage) => {
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    return getDeterministicBucket(`${bucketKey}:${targetingKey}`) < percentage;
  };

  const evaluateFeatureFlag = (definition, flagKey, defaultValue, context) => {
    if (definition.kill_switch || !definition.enabled) {
      return createDetails({
        flagKey,
        value: definition.defaultValue ?? defaultValue,
        reason: 'DISABLED',
        flagMetadata: {
          provider_name: 'beacon',
          source: 'feature_flag',
          flag_name: definition.name,
          flag_enabled: Boolean(definition.enabled),
          kill_switch: Boolean(definition.kill_switch)
        }
      });
    }

    const targetingRules = Array.isArray(definition.targetingRules) ? definition.targetingRules : [];
    for (const rule of targetingRules) {
      const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
      if (!conditions.every((condition) => evaluateCondition(condition, context))) {
        continue;
      }

      if (rule.rollout_percentage !== undefined && !isInRollout(context.targetingKey, `${flagKey}${rule.id}`, rule.rollout_percentage)) {
        continue;
      }

      const variation = Array.isArray(definition.variations)
        ? definition.variations.find((candidate) => candidate.key === rule.variation_key)
        : null;
      return createDetails({
        flagKey,
        value: variation?.value ?? definition.defaultValue ?? defaultValue,
        reason: 'TARGETING_MATCH',
        variant: rule.variation_key,
        flagMetadata: {
          provider_name: 'beacon',
          source: 'feature_flag',
          flag_name: definition.name,
          flag_enabled: true
        }
      });
    }

    if (isInRollout(context.targetingKey, flagKey, definition.rolloutPercentage || 0)) {
      const variation = Array.isArray(definition.variations) ? definition.variations[0] : null;
      return createDetails({
        flagKey,
        value: variation?.value ?? definition.defaultValue ?? defaultValue,
        reason: 'SPLIT',
        variant: variation?.key,
        flagMetadata: {
          provider_name: 'beacon',
          source: 'feature_flag',
          flag_name: definition.name,
          flag_enabled: true
        }
      });
    }

    return createDetails({
      flagKey,
      value: definition.defaultValue ?? defaultValue,
      reason: 'DEFAULT',
      flagMetadata: {
        provider_name: 'beacon',
        source: 'feature_flag',
        flag_name: definition.name,
        flag_enabled: true
      }
    });
  };

  const getVariantRanges = (variants) => {
    const allocatableVariants = variants.filter((variant) => Number.isFinite(variant.trafficPercentage) && variant.trafficPercentage > 0);
    const totalTraffic = allocatableVariants.reduce((sum, variant) => sum + variant.trafficPercentage, 0);
    if (totalTraffic <= 0) return [];

    let lower = 0;
    return allocatableVariants.map((variant, index) => {
      const trafficPercentage = (variant.trafficPercentage / totalTraffic) * 100;
      const upper = index === allocatableVariants.length - 1 ? 100 : lower + trafficPercentage;
      const range = { variant, lower, upper };
      lower = upper;
      return range;
    });
  };

  const evaluateExperiment = (definition, experiment, flagKey, defaultValue, context) => {
    const allocationBucket = getDeterministicBucket(`${experiment.id}:${context.targetingKey}:allocation`);
    if (allocationBucket >= experiment.trafficAllocation) {
      return null;
    }

    const variantBucket = getDeterministicBucket(`${experiment.id}:${context.targetingKey}:variant`);
    const range = getVariantRanges(Array.isArray(experiment.variants) ? experiment.variants : [])
      .find((candidate) => variantBucket >= candidate.lower && variantBucket < candidate.upper);
    const variant = range?.variant;

    if (!variant) {
      return null;
    }

    return createDetails({
      flagKey,
      value: variant.value,
      reason: 'SPLIT',
      variant: variant.key,
      flagMetadata: {
        provider_name: 'beacon',
        source: 'feature_flag',
        flag_key: flagKey,
        flag_name: definition.name,
        experiment_id: experiment.id,
        experiment_name: experiment.name,
        variant_id: variant.key,
        variant_name: variant.name
      }
    });
  };

  const resolveFromConfig = async (flagKey, defaultValue, context, flagValueType) => {
    const config = await loadOpenFeatureConfig();
    const definition = findFlagDefinition(config, flagKey, context);

    if (!definition) {
      return createErrorDetails(flagKey, defaultValue, 'FLAG_NOT_FOUND', `Flag not found: ${flagKey}`);
    }

    const experiment = definition.experiment && siteMatches(definition.experiment, context)
      ? definition.experiment
      : null;
    const experimentDetails = experiment && definition.enabled && !definition.kill_switch
      ? evaluateExperiment(definition, experiment, flagKey, defaultValue, context)
      : null;
    const details = experimentDetails || evaluateFeatureFlag(definition, flagKey, defaultValue, context);

    if (!matchesValueType(details.value, flagValueType)) {
      return createErrorDetails(flagKey, defaultValue, 'TYPE_MISMATCH', `Resolved value for ${flagKey} did not match requested type ${flagValueType}`);
    }

    return details;
  };

  const sendAnalyticsEvent = (name, label, value, properties, context, nonInteraction) => {
    fetch(`${BeaconOpenFeature.config.endpoint}/api/events/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'event',
        s: context.siteId,
        ts: Date.now().toString(),
        vtag: 'openfeature-1',
        r: 'NA',
        re: 'NA',
        lng: 'NA',
        title: window.document?.title || 'NA',
        library_version: 'beacon-openfeature',
        app_name: 'beacon',
        app_type: 'openfeature',
        user_id: context.targetingKey,
        p: window.location?.pathname || '',
        ref: window.document?.referrer || '',
        content_type: 'openfeature',
        event_name: name,
        event_category: 'openfeature',
        event_label: label,
        event_value: value || 0,
        non_interaction: Boolean(nonInteraction),
        event_type: name,
        properties
      })
    }).catch(() => {
      // Analytics should never disrupt the page.
    });
  };

  const trackEvaluation = (details, context, options = {}) => {
    if (options.trackEvaluation === false || details.reason === 'ERROR') return;

    const properties = {
      flag_key: details.flagKey,
      flag_source: String(details.flagMetadata?.source || ''),
      experiment_id: String(details.flagMetadata?.experiment_id || ''),
      variant: details.variant || '',
      variant_id: String(details.flagMetadata?.variant_id || details.variant || ''),
      variant_name: String(details.flagMetadata?.variant_name || details.variant || ''),
      reason: details.reason || ''
    };

    if (window.Beacon) {
      window.Beacon.trackEvent({
        name: 'feature_flag_evaluation',
        category: 'openfeature',
        label: details.flagKey,
        non_interaction: true,
        properties
      });
      return;
    }

    sendAnalyticsEvent('feature_flag_evaluation', details.flagKey, 0, properties, context, true);
  };

  const rememberDetails = (details) => {
    latestDetailsByFlagKey[details.flagKey] = details;
    saveToStorage();
  };

  const normalizeBootstrapEvaluations = (evaluations) => {
    if (Array.isArray(evaluations)) return evaluations;
    if (evaluations && typeof evaluations === 'object') return Object.values(evaluations);
    return [];
  };

  const applyBootstrap = (bootstrap) => {
    if (!bootstrap || typeof bootstrap !== 'object') return;

    if (bootstrap.context && typeof bootstrap.context === 'object') {
      evaluationContext = {
        ...evaluationContext,
        ...bootstrap.context
      };
    }

    if (typeof bootstrap.targetingKey === 'string' && bootstrap.targetingKey.trim()) {
      evaluationContext.targetingKey = bootstrap.targetingKey.trim();
    }

    if (typeof bootstrap.siteId === 'string' && bootstrap.siteId.trim() && !BeaconOpenFeature.config.siteId) {
      BeaconOpenFeature.config.siteId = bootstrap.siteId.trim();
    }

    for (const details of normalizeBootstrapEvaluations(bootstrap.evaluations)) {
      if (!details || typeof details !== 'object' || typeof details.flagKey !== 'string') continue;

      bootstrappedDetailsByFlagKey[details.flagKey] = details;
      rememberDetails(details);
    }
  };

  const getDetails = async (flagKey, defaultValue, invocationContext = {}, options = {}) => {
    if (!isInitialized) {
      return createErrorDetails(flagKey, defaultValue, 'PROVIDER_NOT_READY', 'Beacon OpenFeature provider is not initialized');
    }

    const context = mergeContext(invocationContext);
    if (!context.siteId) {
      return createErrorDetails(flagKey, defaultValue, 'INVALID_CONTEXT', 'The evaluation context must include siteId');
    }

    if (!context.targetingKey) {
      return createErrorDetails(flagKey, defaultValue, 'TARGETING_KEY_MISSING', 'The evaluation context must include targetingKey');
    }

    const flagValueType = options.flagValueType || getValueType(defaultValue);
    const cacheKey = stableStringify({ flagKey, defaultValue, context, flagValueType });

    const bootstrappedDetails = bootstrappedDetailsByFlagKey[flagKey];
    if (bootstrappedDetails) {
      if (!matchesValueType(bootstrappedDetails.value, flagValueType)) {
        return createErrorDetails(flagKey, defaultValue, 'TYPE_MISMATCH', `Resolved value for ${flagKey} did not match requested type ${flagValueType}`);
      }

      cachedDetails[cacheKey] = {
        details: bootstrappedDetails,
        expiry: Date.now() + (BeaconOpenFeature.config.storageDuration * 24 * 60 * 60 * 1000)
      };
      rememberDetails(bootstrappedDetails);
      return bootstrappedDetails;
    }

    const cached = cachedDetails[cacheKey];
    if (cached?.expiry > Date.now()) {
      const details = { ...cached.details, reason: cached.details.reason === 'ERROR' ? 'ERROR' : 'CACHED' };
      rememberDetails(details);
      trackEvaluation(details, context, options);
      return details;
    }

    if (pendingEvaluations[cacheKey]) {
      return pendingEvaluations[cacheKey];
    }

    pendingEvaluations[cacheKey] = (async () => {
      try {
        const details = await resolveFromConfig(flagKey, defaultValue, context, flagValueType);
        cachedDetails[cacheKey] = {
          details,
          expiry: Date.now() + (BeaconOpenFeature.config.storageDuration * 24 * 60 * 60 * 1000)
        };
        rememberDetails(details);
        trackEvaluation(details, context, options);
        return details;
      } catch {
        return createErrorDetails(flagKey, defaultValue, 'GENERAL', 'Evaluation request failed');
      } finally {
        delete pendingEvaluations[cacheKey];
      }
    })();

    return pendingEvaluations[cacheKey];
  };

  const getValue = async (flagKey, defaultValue, invocationContext = {}, options = {}) => {
    const details = await getDetails(flagKey, defaultValue, invocationContext, options);
    return details.value;
  };

  const track = (trackingEventName, invocationContext = {}, details = {}) => {
    if (!trackingEventName) return;

    const context = mergeContext(invocationContext);
    const evaluationDetails = details.flagKey ? latestDetailsByFlagKey[details.flagKey] : null;
    const source = details.flagSource || details.flag_source || evaluationDetails?.flagMetadata?.source || '';
    const flagKey = details.flagKey || evaluationDetails?.flagKey || '';
    const variant = details.variant || evaluationDetails?.variant || '';
    const trackingDetails = {
      ...details,
      tracking_event_name: trackingEventName,
      flag_key: flagKey,
      flag_source: source,
      experiment_id: details.experimentId || details.experiment_id || evaluationDetails?.flagMetadata?.experiment_id || '',
      variant,
      variant_id: details.variantId || details.variant_id || evaluationDetails?.flagMetadata?.variant_id || variant,
      variant_name: details.variantName || details.variant_name || evaluationDetails?.flagMetadata?.variant_name || variant,
      conversion_id: details.conversionId || details.conversion_id || trackingEventName,
      targeting_key: context.targetingKey || ''
    };

    if (window.Beacon) {
      window.Beacon.trackEvent({
        name: 'feature_flag_tracking',
        category: 'openfeature',
        label: trackingEventName,
        value: details.value || 0,
        non_interaction: false,
        properties: trackingDetails
      });
      return;
    }

    sendAnalyticsEvent('feature_flag_tracking', trackingEventName, details.value || 0, trackingDetails, context, false);
  };

  const setContext = (context = {}) => {
    evaluationContext = { ...context };
    cachedDetails = {};
    latestDetailsByFlagKey = {};
    bootstrappedDetailsByFlagKey = {};
    saveToStorage();
  };

  const getContext = () => ({ ...evaluationContext });

  const shutdown = () => {
    cachedDetails = {};
    latestDetailsByFlagKey = {};
    bootstrappedDetailsByFlagKey = {};
    evaluationContext = {};
    openFeatureConfig = null;
    configExpiry = 0;
    configPromise = null;
    isInitialized = false;
    try {
      localStorage.removeItem(BeaconOpenFeature.config.storageKey);
    } catch {
      // Shutdown must be idempotent.
    }
  };

  const BeaconOpenFeature = {
    version: '3.0.0',
    config: { ...defaultConfig },

    init: async function(customConfig = {}) {
      this.config = { ...this.config, ...customConfig };
      loadFromStorage();
      applyBootstrap(this.config.bootstrap);
      isInitialized = true;
      try {
        await loadOpenFeatureConfig();
      } catch (error) {
        if (this.config.debug) {
          console.warn('BeaconOpenFeature: failed to load OpenFeature CDN config', error);
        }
      }
      return this;
    },

    setContext,
    getContext,
    refresh: async () => {
      openFeatureConfig = null;
      configExpiry = 0;
      return loadOpenFeatureConfig();
    },
    getProviderMetadata: () => providerMetadata,
    getProviderStatus: () => isInitialized && openFeatureConfig ? 'READY' : 'NOT_READY',
    getDetails,
    getValue,
    getBooleanDetails: (flagKey, defaultValue, context, options = {}) => getDetails(flagKey, defaultValue, context, { ...options, flagValueType: 'boolean' }),
    getBooleanValue: (flagKey, defaultValue, context, options = {}) => getValue(flagKey, defaultValue, context, { ...options, flagValueType: 'boolean' }),
    getStringDetails: (flagKey, defaultValue, context, options = {}) => getDetails(flagKey, defaultValue, context, { ...options, flagValueType: 'string' }),
    getStringValue: (flagKey, defaultValue, context, options = {}) => getValue(flagKey, defaultValue, context, { ...options, flagValueType: 'string' }),
    getNumberDetails: (flagKey, defaultValue, context, options = {}) => getDetails(flagKey, defaultValue, context, { ...options, flagValueType: 'number' }),
    getNumberValue: (flagKey, defaultValue, context, options = {}) => getValue(flagKey, defaultValue, context, { ...options, flagValueType: 'number' }),
    getObjectDetails: (flagKey, defaultValue, context, options = {}) => getDetails(flagKey, defaultValue, context, { ...options, flagValueType: 'object' }),
    getObjectValue: (flagKey, defaultValue, context, options = {}) => getValue(flagKey, defaultValue, context, { ...options, flagValueType: 'object' }),
    track,
    shutdown
  };

  window.BeaconOpenFeature = BeaconOpenFeature;
  window.OpenFeature = BeaconOpenFeature;
})(window);
