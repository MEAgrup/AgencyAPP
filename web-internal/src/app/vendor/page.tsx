'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { listVendorSessions, sessionBadgeTone, type Session } from '@/lib/livestream';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function VendorSessionsPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listVendorSessions();
      setSessions(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Session Live Stream</h1>
          <p className="muted">Jadwal &amp; hasil live stream yang ditugaskan kepada Anda.</p>
        </div>
        <Link href="/vendor/sessions/new" className="btn btnPrimary">
          Buat Jadwal Baru
        </Link>
      </div>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && sessions && sessions.length === 0 && (
          <div className="emptyState">Belum ada Session yang ditugaskan kepada Anda.</div>
        )}
        {!loading && !error && sessions && sessions.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Platform</th>
                  <th>Jadwal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/vendor/sessions/${s.id}`}>{s.id}</Link></td>
                    <td>{s.platform}</td>
                    <td>{formatDateTime(s.requested_datetime)}</td>
                    <td>
                      <span className={`badge badge-${sessionBadgeTone(s.status)}`}>{s.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
