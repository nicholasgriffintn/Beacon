import { useState, useCallback } from 'react';

import { useTrackEvent } from '../hooks/use-track-event';

export function ProcessingModeTester() {
  const [eventCount, setEventCount] = useState(0);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);
  const trackEvent = useTrackEvent();

  const sendTestEvent = useCallback(() => {
    const timestamp = new Date();
    setEventCount(count => count + 1);
    setLastEventTime(timestamp);
    
    trackEvent({
      name: 'test_event',
      category: 'mode_testing',
      label: 'test_event_single',
      value: eventCount + 1,
      properties: {
        timestamp: timestamp.toISOString(),
        event_number: (eventCount + 1).toString()
      }
    });
  }, [trackEvent, eventCount]);

  const sendBurstEvents = useCallback(() => {
    const burstSize = 5;
    for (let i = 0; i < burstSize; i++) {
      setTimeout(() => {
        const timestamp = new Date();
        setEventCount(count => count + 1);
        setLastEventTime(timestamp);
        
        trackEvent({
          name: 'test_event',
          category: 'mode_testing',
          label: `test_event_burst`,
          value: i + 1,
          properties: {
            timestamp: timestamp.toISOString(),
            burst_position: (i + 1).toString(),
            burst_size: burstSize.toString()
          }
        });
      }, i * 200); // 200ms apart
    }
  }, [trackEvent]);

  const resetCounter = useCallback(() => {
    setEventCount(0);
    setLastEventTime(null);
  }, []);

  return (
    <div className="processing-mode-tester">
      <div className="processing-mode-tester__header">
        <h3 className="processing-mode-tester__title">
          Event Tester
        </h3>
      </div>

      <div className="processing-mode-tester__controls">

        <div className="processing-mode-tester__actions">
          <button
            type="button"
            onClick={sendTestEvent}
            className="processing-mode-tester__action"
          >
            Send Single Event
          </button>
          <button
            type="button"
            onClick={sendBurstEvents}
            className="processing-mode-tester__action"
          >
            Send Burst (5 events)
          </button>
          <button
            type="button"
            onClick={resetCounter}
            className="processing-mode-tester__action processing-mode-tester__action--secondary"
          >
            Reset Counter
          </button>
        </div>
      </div>

      <div className="processing-mode-tester__stats">
        <div className="processing-mode-tester__stat">
          <strong>Events Sent:</strong> {eventCount}
        </div>
        {lastEventTime && (
          <div className="processing-mode-tester__stat">
            <strong>Last Event:</strong> {lastEventTime.toLocaleTimeString()}
          </div>
        )}
      </div>

    </div>
  );
}
