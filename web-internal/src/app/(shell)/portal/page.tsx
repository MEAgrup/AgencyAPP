'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { cardHref } from '@/lib/board';
import { getMyPortal, type StaffLanding } from '@/lib/portal';
import StatusBadge from '@/components/StatusBadge';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

export default function MyPortalPage() {
  const [landing, setLanding] = useState<StaffLanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMyPortal();
      setLanding(res);
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
      <div>
        <h1>Portal Saya</h1>
        <p className="muted">
          Landing pribadi (M15-C1 Rule 9): task terbuka Anda urut risiko SLA + skor performa
          bulan berjalan. Semua data scope diri sendiri &mdash; sumber: <code>GET /portal/me</code>.
        </p>
      </div>

      {loading && <p className="muted">Memuat...</p>}
      {error && <div className="alert alertError" role="alert">{error}</div>}

      {!loading && !error && landing && (
        <>
          <section className="card">
            <div className="cardHeader">
              <h2>Task Terbuka Saya</h2>
              <button type="button" className="btn btnSecondary btnSm" onClick={load}>
                Refresh
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Urutan dari server: Overdue dulu, lalu jatuh tempo terdekat; task tanpa jatuh
              tempo terakhir. Task Done tidak ditampilkan.
            </p>
            {landing.open_tasks.length === 0 ? (
              <div className="emptyState">Tidak ada task terbuka. 🎉</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Tipe</th>
                      <th>Divisi</th>
                      <th>Klien</th>
                      <th>Status</th>
                      <th>Jatuh Tempo</th>
                      <th>Kolom</th>
                    </tr>
                  </thead>
                  <tbody>
                    {landing.open_tasks.map((c) => (
                      <tr key={`${c.type}-${c.id}`}>
                        <td><Link href={cardHref(c)}>{c.id}</Link></td>
                        <td>{c.type}</td>
                        <td>{c.division}</td>
                        <td>{c.client_id || '—'}</td>
                        <td><StatusBadge status={c.native_status} /></td>
                        <td>
                          {c.due_date || '—'}
                          {c.overdue && (
                            <span className="badge badge-red" style={{ marginLeft: 6 }}>Overdue</span>
                          )}
                        </td>
                        <td>{c.universal_column}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="cardHeader">
              <h2>Skor Performa Bulan Berjalan <span className="muted" style={{ fontSize: 12 }} title="Auto-calculated (M14), tidak dapat diubah">🔒 read-only</span></h2>
            </div>
            {!landing.running_score ? (
              <div className="alert alertInfo" role="status">
                Role Anda tidak memiliki KPI Profile M14 (cakupan: Creative, Ads, KOL, AM) &mdash;
                tidak ada skor berjalan untuk ditampilkan.
              </div>
            ) : (
              <>
                <div className="alert alertInfo" role="status">
                  Preview: skor bulan berjalan yang belum final &mdash; menjadi history setelah
                  bulan tutup dan batch dijalankan.
                </div>
                <div className="grid2">
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>Skor</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{landing.running_score.score_display}</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>Role Type</div>
                    <div>{landing.running_score.role_type}</div>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <Link href={`/performance/${landing.employee_id}`} className="btn btnSecondary btnSm">
                    Lihat Breakdown Lengkap
                  </Link>
                </div>
              </>
            )}
          </section>

          <section className="card">
            <div className="cardHeader">
              <h2>Trend Skor (History)</h2>
            </div>
            {landing.trend.length === 0 ? (
              <div className="emptyState">Belum ada snapshot skor tersimpan.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Periode</th>
                      <th>Skor</th>
                      <th>Dihitung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {landing.trend.map((s) => (
                      <tr key={s.period_start}>
                        <td>{s.period_start.slice(0, 7)}</td>
                        <td>{s.score_display}</td>
                        <td>{formatDate(s.computed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
