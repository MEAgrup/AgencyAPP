'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import type { NotificationsResponse } from '@/lib/types';

export default function NotificationsPage() {
  const router = useRouter();
  const [res, setRes] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<NotificationsResponse>(`/notifications${onlyUnread ? '?unread=1' : ''}`);
      setRes(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [onlyUnread]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMarkRead(id: string) {
    setMarkingId(id);
    try {
      await api.post(`/notifications/${id}/read`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMarkingId(null);
    }
  }

  function handleOpen(deepLink: string) {
    if (deepLink) router.push(deepLink);
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Notifikasi</h1>
          <p className="muted">
            {res ? `${res.unread_count} belum dibaca` : ''}
          </p>
        </div>
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
          Hanya yang belum dibaca
        </label>
      </div>

      {loading && <p className="muted">Memuat...</p>}
      {error && <div className="alert alertError">{error}</div>}

      {!loading && !error && res && res.data.length === 0 && (
        <div className="card emptyState">Tidak ada notifikasi.</div>
      )}

      {!loading && !error && res && res.data.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {res.data.map((n) => {
            const unread = !n.read_at;
            return (
              <div key={n.id} className="card" style={{ padding: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <button
                    type="button"
                    onClick={() => handleOpen(n.deep_link)}
                    style={{
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      cursor: n.deep_link ? 'pointer' : 'default',
                      padding: 0,
                      flex: 1,
                    }}
                  >
                    <div style={{ fontWeight: unread ? 700 : 500, fontSize: 13 }}>{n.event_type}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {n.entity_type} {n.entity_id} &middot; oleh {n.actor} &middot;{' '}
                      {new Date(n.created_at).toLocaleString('id-ID')}
                    </div>
                  </button>
                  {unread && (
                    <button
                      type="button"
                      className="btn btnSecondary btnSm"
                      disabled={markingId === n.id}
                      onClick={() => handleMarkRead(n.id)}
                    >
                      {markingId === n.id ? 'Memproses...' : 'Tandai Dibaca'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
