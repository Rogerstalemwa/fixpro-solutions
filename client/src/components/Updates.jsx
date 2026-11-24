import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

// Recent notifications for the signed-in user.
export default function Updates() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let timer;
    api('/notifications').then(({ data: d }) => {
      setData(d);
      // Viewing the page counts as seeing the updates. New ones stay highlighted here until you leave.
      if (d.unread > 0) timer = setTimeout(() => api('/notifications/read-all', { method: 'POST', body: {} }).then(() => window.dispatchEvent(new Event('fp:notifications'))).catch(() => {}), 2500);
    }).catch(() => {});
    return () => clearTimeout(timer);
  }, []);
  if (!data?.items.length) return null;
  const markRead = async () => { await api('/notifications/read-all', { method: 'POST', body: {} }).catch(() => {}); window.dispatchEvent(new Event('fp:notifications')); setData({ ...data, unread: 0, items: data.items.map((i) => ({ ...i, readAt: i.readAt || new Date().toISOString() })) }); };
  return (
    <div className="glass rounded-3xl p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight">Updates{data.unread > 0 && <span className="ml-3 rounded-full bg-lime px-2.5 py-0.5 text-xs font-semibold text-ink">{data.unread} new</span>}</h2>
        {data.unread > 0 && <button className="text-sm text-mist hover:text-white" onClick={markRead}>Mark all as read</button>}
      </div>
      <ul className="mt-4 divide-y divide-white/10">
        {data.items.slice(0, 5).map((n) => (
          <li key={n.id} className="py-3">
            <p className={`text-sm font-semibold ${n.readAt ? 'text-mist' : ''}`}>{n.title}</p>
            <p className="text-sm text-mist">{n.message}</p>
            <p className="mt-1 text-xs text-mist/70">{formatDateTime(n.createdAt)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
