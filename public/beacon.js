/**
 * Beacon - A lightweight analytics tracking library
 */

// biome-ignore lint/complexity/useArrowFunction: <explanation>
(function(window) {

  // Configuration defaults
  const defaultConfig = {
    endpoint: 'https://beacon.nickgriffin.uk',
    siteId: '',
    debug: false,
    trackPageViews: true,
    trackClicks: false,
    trackUserTimings: false,
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    batchSize: 10,
    batchTimeout: 5000, // 5 seconds
    directPageViews: true
  };

  // Stored events waiting to be sent
  const eventQueue = [];
  let batchSendTimeout = null;
  let sessionUserId = null; // Store user ID in memory for the session
  
  // Generate a UUID for identifying users
  const generateId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  // Get or create a session-based user ID
  const getUserId = () => {
    if (!sessionUserId) {
      sessionUserId = generateId();
    }
    return sessionUserId;
  };

  // Get screen dimensions including offsets
  const getScreenDimensions = () => {
    return `${screen.width}x${screen.height}x${window.screenX}x${window.screenY}`;
  };

  // Get viewport dimensions
  const getViewportDimensions = () => {
    return `${window.innerWidth}x${window.innerHeight}`;
  };

  // Format common parameters for all event types
  const getCommonParams = () => {
    return {
      s: Beacon.config.siteId,
      ts: Date.now().toString(),
      vtag: Beacon.version,
      r: getScreenDimensions(),
      re: getViewportDimensions(),
      lng: navigator.language || navigator.userLanguage || '',
      library_version: Beacon.version,
      app_name: Beacon.config.appName || document.title,
      app_type: 'web',
      user_id: getUserId(),
      p: window.location.pathname,
      ref: document.referrer
    };
  };

  // Send events to the server
  const sendEvents = async (events) => {
    if (!events || events.length === 0) return;
    
    try {
      const endpoint = `${Beacon.config.endpoint}/batch`;
      
      const payload = {
        siteId: Beacon.config.siteId,
        events: events
      };
      
      if (Beacon.config.debug) {
        console.log('Beacon: Sending events', payload);
      }
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        // Use keepalive to ensure the request completes even if the page is unloading
        keepalive: true
      });
      
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      
      if (Beacon.config.debug) {
        console.log('Beacon: Events sent successfully');
      }
    } catch (error) {
      if (Beacon.config.debug) {
        console.error('Beacon: Error sending events', error);
      }
    }
  };

  // Process the queue and send events in batches
  const processQueue = (force = false) => {
    if (eventQueue.length >= Beacon.config.batchSize || force) {
      const eventsToSend = eventQueue.splice(0, Beacon.config.batchSize);
      sendEvents(eventsToSend);
    }
    
    // Clear existing timeout
    if (batchSendTimeout) {
      clearTimeout(batchSendTimeout);
      batchSendTimeout = null;
    }
    
    // Set a new timeout if there are still events in the queue
    if (eventQueue.length > 0) {
      batchSendTimeout = setTimeout(() => processQueue(true), Beacon.config.batchTimeout);
    }
  };

  // Track a pageview
  const trackPageView = (params = {}) => {
    const {
      contentType = 'page',
      virtualPageview = false,
      properties = {}
    } = params;

    const eventParams = {
      ...getCommonParams(),
      type: 'pageview',
      path: window.location.pathname,
      title: document.title,
      contentType,
      virtualPageview,
      properties
    };
    
    // Send directly for pageviews
    if (Beacon.config.directPageViews) {
      sendEvents([eventParams]);
    } else {
      // Add to queue
      eventQueue.push(eventParams);
      processQueue();
    }
  };

  // Track a custom event
  const trackEvent = (params = {}) => {
    const {
      name,
      category,
      label = '',
      value = 0,
      nonInteraction = false,
      properties = {}
    } = params;

    const eventParams = {
      ...getCommonParams(),
      type: 'event',
      eventName: name,
      eventCategory: category,
      eventLabel: label,
      eventValue: value,
      nonInteraction: nonInteraction,
      properties: properties
    };
    
    eventQueue.push(eventParams);
    processQueue();
  };

  // Initialize click tracking
  const initClickTracking = () => {
    document.addEventListener('click', (e) => {
      // Only track links
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.href || '';
      const linkText = link.innerText || link.textContent || 'unknown';
      
      trackEvent({
        name: 'click',
        category: 'link',
        label: linkText,
        value: href
      });
    });
  };

  // Initialize performance tracking
  const initPerformanceTracking = () => {
    if (!window.performance || !window.performance.timing) return;
    
    window.addEventListener('load', () => {
      setTimeout(() => {
        const timing = window.performance.timing;
        
        // Calculate key metrics
        const pageLoadTime = timing.loadEventEnd - timing.navigationStart;
        const domLoadTime = timing.domComplete - timing.domLoading;
        const networkLatency = timing.responseEnd - timing.fetchStart;
        
        trackEvent({
          name: 'performance',
          category: 'page_load',
          label: 'total_time',
          value: pageLoadTime.toString()
        });
        trackEvent({
          name: 'performance',
          category: 'page_load',
          label: 'dom_load',
          value: domLoadTime.toString()
        });
        trackEvent({
          name: 'performance',
          category: 'page_load',
          label: 'network_latency',
          value: networkLatency.toString()
        });
      }, 0);
    });
  };
  
  // The main Beacon object
  const Beacon = {
    version: '1.0.0',
    config: { ...defaultConfig },
    
    // Initialize the tracker
    init: function(customConfig = {}) {
      // Merge configs
      this.config = { ...this.config, ...customConfig };
      
      if (!this.config.siteId) {
        console.error('Beacon: siteId is required');
        return;
      }
      
      // Set up event listeners
      if (this.config.trackPageViews) {
        trackPageView();
        
        // Track page changes for SPAs
        if (window.history?.pushState) {
          const originalPushState = window.history.pushState;
          window.history.pushState = function(...args) {
            originalPushState.apply(this, args);
            trackPageView();
          };
          
          window.addEventListener('popstate', trackPageView);
        }
      }
      
      if (this.config.trackClicks) {
        initClickTracking();
      }
      
      if (this.config.trackUserTimings) {
        initPerformanceTracking();
      }
      
      // Set up beforeunload handler to send any remaining events
      window.addEventListener('beforeunload', () => {
        processQueue(true);
      });
      
      if (this.config.debug) {
        console.log('Beacon: Initialized with config', this.config);
      }
      
      return this;
    },
    
    // Public methods
    trackEvent,
    trackPageView
  };
  
  // Expose the Beacon object globally
  window.Beacon = Beacon;
  
})(window); 