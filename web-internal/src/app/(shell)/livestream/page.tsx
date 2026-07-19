'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { listLiveStreamBriefQueue, type LiveStreamBrief } from '@/lib/livestream';
import StatusBadge from '@/components/StatusBadge';

export default function LiveStreamWorkspacePage() {
  const router = useRouter();

  const [briefs, setBriefs] = useState<LiveStreamBrief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Buka Brief by id (no cross-brief Session list exists — m10 brief "TIDAK TERSEDIA").
  const [briefLookupId, setBriefLookupId] = useState('');
  // Buka Session by id
  const [sessionLookupId, setSessionLookupId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listLiveStreamBriefQueue();
      setBriefs(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleBriefLookup(e: FormEvent) {
    e.preventDefault();
    const id = briefLookupId.trim();
    if (!id) return;
    router.push(`/livestream/briefs/${id}`);
  }

  function handleSessionLookup(e: FormEvent) {
    e.preventDefault();
    const id = sessionLookupId.trim();
    if (!id) return;
    router.push(`/livestream/sessions/${id}`);
  }

  return (
    <div className="stack">
      <div>
        <h1>Live Stream</h1>
        <p className="muted">
          Workspace Live Stream (M10) &mdash; tracker request-vs-result vendor per Brief, rekonsiliasi,
          dan GMV confidence tier. Bukan Kanban internal &mdash; buka Brief untuk melihat/menambah Session,
          atau buka Session langsung dengan ID.
        </p>
      </div>

      <section className="card">
        <div className="cardHeader">
          <h2>Buka Brief</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Session hanya bisa dilihat per Brief (BRF-...) &mdash; belum ada daftar Session lintas-Brief
          di backend M10. Dapatkan ID Brief dari layar Account (M6).
        </p>
        <form className="form" onSubmit={handleBriefLookup}>
          <div className="formRow">
            <div className="field">
              <label htmlFor="brief-lookup-id">ID Brief</label>
              <input
                id="brief-lookup-id"
                placeholder="BRF-202607-0001"
                value={briefLookupId}
                onChange={(e) => setBriefLookupId(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btnSecondary">Buka</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Buka Session</h2>
        </div>
        <form className="form" onSubmit={handleSessionLookup}>
          <div className="formRow">
            <div className="field">
              <label htmlFor="session-lookup-id">ID Session</label>
              <input
                id="session-lookup-id"
                placeholder="LSS-202607-0001"
                value={sessionLookupId}
                onChange={(e) => setSessionLookupId(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btnSecondary">Buka</button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Brief Divisi Live Stream</h2>
        </div>
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && briefs && briefs.length === 0 && (
          <div className="emptyState">Belum ada brief divisi Live Stream yang terlihat untuk peran Anda.</div>
        )}
        {!loading && !error && briefs && briefs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Brief</th>
                  <th>Judul</th>
                  <th>PIC</th>
                  <th>Jatuh Tempo</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/livestream/briefs/${b.id}`}>{b.id}</Link></td>
                    <td>{b.title}</td>
                    <td>{b.assigned_pic || '—'}</td>
                    <td>{b.due_date || '—'}</td>
                    <td>{b.priority || '—'}</td>
                    <td><StatusBadge status={b.status} /></td>
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
