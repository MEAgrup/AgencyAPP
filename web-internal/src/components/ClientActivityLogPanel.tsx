'use client';

// Log Aktivitas Klien (Improvement Req Account butir 5, pemilik 2026-09-30) —
// "cek log dari masing-masing aktivitasnya, dari mulai di-assign oleh Head
// sampai service-nya selesai, seperti riwayat log milik sales". Read-only:
// sumbernya audit_log immutable, dikumpulkan server per klien.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { extractStatusLabel, summarizeJson } from '@/lib/audit';
import { ENTITY_LABEL, LOG_FILTERS, getClientActivityLog, labelAksi, type ClientLogEntry } from '@/lib/client-log';

function entityHref(e: ClientLogEntry): string | null {
  switch (e.entity_type) {
    case 'service':
    case 'service_plan_gate':
      return `/account/services/${encodeURIComponent(e.entity_id)}`;
    case 'brief':
    case 'brief_stage':
      return `/account/briefs/${encodeURIComponent(e.entity_id)}`;
    case 'strategi':
      return `/account/strategi/${encodeURIComponent(e.entity_id)}`;
    case 'plan':
      return `/account/plan/${encodeURIComponent(e.entity_id)}`;
    case 'complaint':
      return `/account/complaints/${encodeURIComponent(e.entity_id)}`;
    case 'ad_campaign':
      return `/ads/${encodeURIComponent(e.entity_id)}`;
    default:
      return null;
  }
}

function ringkas(json: unknown): string {
  const s = extractStatusLabel(json) ?? summarizeJson(json);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export default function ClientActivityLogPanel({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<ClientLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('semua');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await getClientActivityLog(clientId);
      setEntries(res.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [clientId]);

  useEffect(() => {
    if (open && entries === null) {
      void load();
    }
  }, [open, entries, load]);

  const shown = useMemo(() => {
    if (!entries) return [];
    const f = LOG_FILTERS.find((x) => x.key === filter);
    if (!f || f.types.length === 0) return entries;
    return entries.filter((e) => f.types.includes(e.entity_type));
  }, [entries, filter]);

  return (
    <section className="card">
      <div className="cardHeader">
        <h2>Log Aktivitas Klien</h2>
        <button type="button" className="btn btnSecondary btnSm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Sembunyikan' : 'Tampilkan'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Seluruh riwayat klien ini — closing, assign AM oleh Head of Account, kontrak, service, strategi &amp; plan,
        brief &amp; eksekusi divisi, sampai service selesai. Terbaru di atas. 🔒 read-only (audit log).
      </p>
      {open && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {LOG_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`btn btnSm ${filter === f.key ? 'btnPrimary' : 'btnSecondary'}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            <button type="button" className="btn btnSm btnSecondary" onClick={() => void load()}>Muat ulang</button>
          </div>
          {error && <div className="alert alertError" role="alert">{error}</div>}
          {!error && entries === null && <p className="muted">Memuat...</p>}
          {entries !== null && shown.length === 0 && <div className="emptyState">Belum ada aktivitas tercatat.</div>}
          {shown.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Objek</th>
                    <th>Aktivitas</th>
                    <th>Oleh</th>
                    <th>Sebelum</th>
                    <th>Sesudah</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => {
                    const href = entityHref(e);
                    return (
                      <tr key={e.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString('id-ID')}</td>
                        <td>
                          {ENTITY_LABEL[e.entity_type] ?? e.entity_type}
                          <div className="muted" style={{ fontSize: 11 }}>
                            {href ? <Link href={href}>{e.entity_id}</Link> : e.entity_id}
                          </div>
                        </td>
                        <td>{labelAksi(e)}</td>
                        <td>
                          {e.actor_nama}
                          {e.actor_nama !== e.actor_employee_id && (
                            <div className="muted" style={{ fontSize: 11 }}>{e.actor_employee_id}</div>
                          )}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>{ringkas(e.before_json)}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{ringkas(e.after_json)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
