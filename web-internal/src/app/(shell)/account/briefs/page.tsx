'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import {
  KANBAN_COLUMNS,
  KANBAN_DIVISIONS,
  listDivisionQueue,
  type Brief,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';

export default function BriefBoardPage() {
  const [division, setDivision] = useState<string>(KANBAN_DIVISIONS[0]);
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDivisionQueue(division);
      setBriefs(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [division]);

  useEffect(() => {
    load();
  }, [load]);

  // Ordered columns: the known kanban statuses first, then any extra status that
  // actually appears in the queue (so nothing gets hidden).
  const extraStatuses = briefs
    ? Array.from(new Set(briefs.map((b) => b.status))).filter(
        (s) => !(KANBAN_COLUMNS as readonly string[]).includes(s),
      )
    : [];
  const columns = [...KANBAN_COLUMNS, ...extraStatuses];

  return (
    <div className="stack">
      <div>
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Papan Brief</h1>
          <p className="muted">Antrean Brief per divisi (M6 §7). Aksi review ada di detail Brief.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {KANBAN_DIVISIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={`btn btnSm ${division === d ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => setDivision(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && briefs && briefs.length === 0 && (
          <div className="emptyState">Tidak ada Brief di antrean divisi {division}.</div>
        )}
        {!loading && !error && briefs && briefs.length > 0 && (
          <div className="table-wrap" style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start' }}>
            {columns.map((col) => {
              const cards = briefs.filter((b) => b.status === col);
              return (
                <div key={col} style={{ flex: '0 0 240px', minWidth: 240 }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <StatusBadge status={col} />
                    <span className="muted" style={{ fontSize: 12 }}>{cards.length}</span>
                  </div>
                  <div className="stack" style={{ gap: 8 }}>
                    {cards.length === 0 ? (
                      <div className="muted" style={{ fontSize: 12 }}>&mdash;</div>
                    ) : (
                      cards.map((b) => (
                        <Link key={b.id} href={`/account/briefs/${b.id}`} className="card" style={{ padding: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{b.title}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{b.id}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {b.deliverable_type} &middot; {b.priority}
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>Due: {b.due_date || '—'}</div>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
