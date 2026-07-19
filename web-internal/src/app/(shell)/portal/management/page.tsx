'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getComponentLabel } from '@/lib/health';
import {
  MGMT_BANDS,
  getManagementDashboard,
  type ManagementDashboard,
} from '@/lib/portal';

function bandTone(band: string): string {
  if (band === 'Healthy') return 'green';
  if (band === 'Watch') return 'amber';
  if (band === 'At Risk') return 'red';
  return 'gray';
}

function trendArrow(dir: string): string {
  if (dir === 'up') return '▲';
  if (dir === 'down') return '▼';
  return '▶';
}

export default function ManagementDashboardPage() {
  const { role } = useAuth();

  // Cermin gate ManagementDashboardFor (portal.go:284): Director + OD SAJA
  // (Rule 11/§6.3) — role lain jangan menembak endpoint yang pasti 403.
  const canView = Boolean(role?.director || role?.od);

  const [band, setBand] = useState('');
  const [amInput, setAmInput] = useState('');
  const [appliedAM, setAppliedAM] = useState('');
  const [sort, setSort] = useState<'band' | 'am'>('band');

  const [dash, setDash] = useState<ManagementDashboard | null>(null);
  const [loading, setLoading] = useState(canView);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getManagementDashboard({ band: band || undefined, am: appliedAM || undefined, sort });
      setDash(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canView, band, appliedAM, sort]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return (
      <div className="stack">
        <div>
          <h1>Management Dashboard</h1>
          <p className="muted">
            Scan Client Health seluruh portfolio (M15-C1 Rule 11/&sect;6.3) &mdash; sumber:{' '}
            <code>GET /portal/management</code>.
          </p>
        </div>
        <div className="alert alertInfo" role="status">
          Halaman ini khusus Direktur dan OD (role manajemen lintas-portfolio pada Role Matrix).
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Management Dashboard</h1>
        <p className="muted">
          Semua klien &times; Client Health terbaru (M15-C1 Rule 11/&sect;6.3): band, arah trend,
          komponen penarik turun, AM &mdash; read-only murni. Klien tanpa snapshot tetap tampil
          (skor <code>—</code>).
        </p>
      </div>

      <section className="card">
        <div className="formRow">
          <div className="field">
            <label htmlFor="mgmt-band">Band</label>
            <select id="mgmt-band" value={band} onChange={(e) => setBand(e.target.value)}>
              <option value="">Semua band</option>
              {MGMT_BANDS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="mgmt-am">AM (Employee ID)</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="mgmt-am"
                placeholder="mis. 2412090425"
                value={amInput}
                onChange={(e) => setAmInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btnSecondary btnSm"
                onClick={() => setAppliedAM(amInput.trim())}
              >
                Terapkan
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="mgmt-sort">Urutkan</label>
            <select id="mgmt-sort" value={sort} onChange={(e) => setSort(e.target.value === 'am' ? 'am' : 'band')}>
              <option value="band">Band (At Risk dulu)</option>
              <option value="am">AM, lalu band</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {!loading && !error && dash && dash.rows.length === 0 && (
          <div className="emptyState">Tidak ada klien yang cocok dengan filter.</div>
        )}
        {!loading && !error && dash && dash.rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Klien</th>
                  <th>Nama</th>
                  <th>AM</th>
                  <th>Band</th>
                  <th>Skor</th>
                  <th>Trend</th>
                  <th>Komponen Penarik Turun</th>
                  <th>Periode</th>
                </tr>
              </thead>
              <tbody>
                {dash.rows.map((r) => (
                  <tr key={r.client_id}>
                    <td><Link href={`/health/${r.client_id}`}>{r.client_id}</Link></td>
                    <td>{r.client_name}</td>
                    <td>{r.assigned_am || '—'}</td>
                    <td>
                      {r.band ? (
                        <span className={`badge badge-${bandTone(r.band)}`}>{r.band}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{r.score_display}</td>
                    <td title={r.trend_direction}>{trendArrow(r.trend_direction)}</td>
                    <td>
                      {r.dragging_component
                        ? `${getComponentLabel(r.dragging_component)}${r.dragging_capped !== null ? ` (${r.dragging_capped.toFixed(2)})` : ''}`
                        : '—'}
                    </td>
                    <td>{r.period ? r.period.slice(0, 7) : '—'}</td>
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
