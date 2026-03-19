import { useState, useEffect } from 'react';
import { formatRelativeTime } from '@/lib/time-utils';

/**
 * Hook to get auto-updating relative time
 * Updates every second for recent messages, then slows down for older ones
 */
export function useTimeAgo(timestamp: number | undefined): string {
  const [timeAgo, setTimeAgo] = useState(() => formatRelativeTime(timestamp));

  useEffect(() => {
    if (!timestamp) {
      setTimeAgo('just now');
      return;
    }

    // Initial set
    setTimeAgo(formatRelativeTime(timestamp));

    // Calculate update interval based on age
    const now = Date.now();
    const age = now - timestamp;

    let intervalMs: number;
    if (age < 60000) {
      // Less than 1 min: update every second
      intervalMs = 1000;
    } else if (age < 3600000) {
      // Less than 1 hour: update every 10 seconds
      intervalMs = 10000;
    } else if (age < 86400000) {
      // Less than 24 hours: update every minute
      intervalMs = 60000;
    } else {
      // More than 24 hours: no need to update
      return;
    }

    const interval = setInterval(() => {
      setTimeAgo(formatRelativeTime(timestamp));
    }, intervalMs);

    return () => clearInterval(interval);
  }, [timestamp]);

  return timeAgo;
}
