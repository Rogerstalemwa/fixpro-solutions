import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// Unread updates (and, for technicians, job offers waiting) for the navigation badge.
// Refreshes every 30 seconds, when the route changes, and when any page announces a change.
export function useNotificationSummary(enabled, routeKey) {
  const [summary, setSummary] = useState({ unread: 0, offers: 0 });
  const load = useCallback(() => { api('/notifications/summary').then(({ data }) => setSummary(data)).catch(() => {}); }, []);
  useEffect(() => {
    if (!enabled) { setSummary({ unread: 0, offers: 0 }); return undefined; }
    load();
    const id = setInterval(load, 30_000);
    window.addEventListener('fp:notifications', load);
    return () => { clearInterval(id); window.removeEventListener('fp:notifications', load); };
  }, [enabled, routeKey, load]);
  return summary;
}
