'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  KANBAN_COLUMNS,
  KANBAN_DIVISIONS,
  listDivisionQueue,
  type Brief,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';

export default function BriefBoardPage() {
  const { role } = useAuth();

  // Cermin gate ListDivisionQueue (module6 brief.go: CanReadAll / Account lead /
  // anggota divisi ybs.) — UX only, server tetap otoritas akhir. AM staff murni
  // TIDAK boleh membuka queue divisi mana pun (keputusan interview 2026-07-12).
  const canReadAll = Boolean(role?.od || role?.director);
  const isAccountLead = role?.level === 'lead' && role?.division.toLowerCase() === 'account';
  const allowedDivisions = (KANBAN_DIVISIONS as readonly string[]).filter(
    (d) => canReadAll || isAccountLead || role?.division.toLowerCase() === d.toLowerCase(),
  );

  const [division, setDivision] = useState<string>('');
  const effectiveDivision = division || allowedDivisions[0] || '';

  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(allowedDivisions.length > 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveDivision) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listDivisionQueue(effectiveDivision)
      .then((res) => {
        if (!cancelled) setBriefs(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveDivision]);

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
          {allowedDivisions.map((d) => (
            <button
              key={d}
              type="button"
              className={`btn btnSm ${effectiveDivision === d ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => setDivision(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <section className="card">
        {allowedDivisions.length === 0 && (
          <div className="alert alertInfo" role="status">
            Papan Brief menampilkan antrean divisi eksekutor dan hanya dapat dibuka oleh
            anggota divisi tersebut, Account Lead/SPV, OD, atau Direktur. Role Anda tidak
            memiliki akses ke antrean divisi mana pun.
          </div>
        )}
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && briefs && briefs.length === 0 && (
          <div className="emptyState">Tidak ada Brief di antrean divisi {effectiveDivision}.</div>
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
