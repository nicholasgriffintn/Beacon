/**
 * Beacon - A lightweight analytics tracking library
 */

// biome-ignore lint/complexity/useArrowFunction: <explanation>
(function(window) {

  const defaultConfig = {
    endpoint: 'https://beacon.nickgriffin.uk',
    siteId: '',
    debug: false,
    trackPageViews: true,
    trackClicks: false,
    trackUserTimings: false,
    batchSize: 10,
    batchTimeout: 5000, // 5 seconds
    directPageViews: true,
    requireConsent: false,
    respectDoNotTrack: true,
    consentCookie: 'beacon_consent',
  };

  const hasConsent = () => {
    try {
      const cookieConsent = getCookie(Beacon.config.consentCookie);
      if (cookieConsent === 'true') {
        return true;
      }
      
      const storageConsent = localStorage.getItem(Beacon.config.consentCookie);
      return storageConsent === 'true';
    } catch (e) {
      return false;
    }
  };

  const setCookie = (name, value, days) => {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
  };

  const getCookie = (name) => {
    const nameEQ = `${name}=`;
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  };

  const setConsent = (consent) => {
    try {
      setCookie(Beacon.config.consentCookie, consent.toString(), 365);
      
      localStorage.setItem(Beacon.config.consentCookie, consent.toString());
      
      return true;
    } catch (e) {
      if (Beacon.config.debug) {
        console.error('Beacon: Error setting consent', e);
      }
      return false;
    }
  };

  const isTrackingAllowed = () => {
    if (
      Beacon.config.respectDoNotTrack &&
      (navigator.doNotTrack === "1" ||
        navigator.doNotTrack === "yes" ||
        window.doNotTrack === "1")
    ) {
      if (Beacon.config.debug) {
        console.log('Beacon: Tracking blocked by Do Not Track');
      }
      return false;
    }

    if (Beacon.config.requireConsent) {
      if (Beacon.config.debug) {
        console.log('Beacon: Tracking blocked by user consent');
      }
      return hasConsent();
    }

    return true;
  };

  const eventQueue = [];
  let batchSendTimeout = null;
  let sessionUserId = null;
  
  const generateId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const getUserId = () => {
    if (!sessionUserId) {
      sessionUserId = generateId();
    }
    return sessionUserId;
  };

  const getScreenDimensions = () => {
    return `${screen.width}x${screen.height}x${window.screenX}x${window.screenY}`;
  };

  const getViewportDimensions = () => {
    return `${window.innerWidth}x${window.innerHeight}`;
  };

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

  const sendEvents = async (events) => {
    if (!events || events.length === 0) return;
    
    try {
      const endpoint = `${Beacon.config.endpoint}/api/events/batch`;
      
      const payload = {
        ...getCommonParams(),
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

  const processQueue = (force = false) => {
    if (eventQueue.length >= Beacon.config.batchSize || force) {
      const eventsToSend = eventQueue.splice(0, Beacon.config.batchSize);
      sendEvents(eventsToSend);
    }
    
    if (batchSendTimeout) {
      clearTimeout(batchSendTimeout);
      batchSendTimeout = null;
    }
    
    if (eventQueue.length > 0) {
      batchSendTimeout = setTimeout(() => processQueue(true), Beacon.config.batchTimeout);
    }
  };

  const trackPageView = (params = {}) => {
    if (!isTrackingAllowed()) {
      if (Beacon.config.debug) {
        console.log('Beacon: Tracking blocked by privacy settings or user consent');
      }
      return;
    }
  
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
    
    if (Beacon.config.directPageViews) {
      sendEvents([eventParams]);
    } else {
      eventQueue.push(eventParams);
      processQueue();
    }
  };

  const trackEvent = (params = {}) => {
    if (!isTrackingAllowed()) {
      if (Beacon.config.debug) {
        console.log('Beacon: Tracking blocked by privacy settings or user consent');
      }
      return;
    }

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

  const initClickTracking = () => {
    document.addEventListener('click', (e) => {
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

  const initPerformanceTracking = () => {
    if (!window.performance || !window.performance.timing) return;
    
    window.addEventListener('load', () => {
      setTimeout(() => {
        const timing = window.performance.timing;
        
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
  
  const Beacon = {
    version: '1.0.0',
    config: { ...defaultConfig },
    
    init: function(customConfig = {}) {
      this.config = { ...this.config, ...customConfig };
      
      if (!this.config.siteId) {
        console.error('Beacon: siteId is required');
        return;
      }
      
      if (this.config.trackPageViews) {
        trackPageView();
        
        if (window.history?.pushState) {
          const originalPushState = window.history.pushState;
          window.history.pushState = function(...args) {
            originalPushState.apply(this, args);
            trackPageView(
              {
                virtualPageview: true
              }
            );
          };
          
          window.addEventListener('popstate', () => trackPageView({
            virtualPageview: true
          }));
        }
      }
      
      if (this.config.trackClicks) {
        initClickTracking();
      }
      
      if (this.config.trackUserTimings) {
        initPerformanceTracking();
      }
      
      window.addEventListener('beforeunload', () => {
        processQueue(true);
      });
      
      if (this.config.debug) {
        console.log('Beacon: Initialized with config', this.config);
      }
      
      return this;
    },
    
    trackEvent,
    trackPageView,
    setConsent,
    hasConsent
  };
  
  window.Beacon = Beacon;
  
})(window); 