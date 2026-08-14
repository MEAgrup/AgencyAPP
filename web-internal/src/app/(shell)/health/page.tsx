'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/api';
import { getTriggerScan, getHealthPortfolio, type ScanResult, type HealthPortfolioRow } from '@/lib/health';

function getBandColor(band: string): string {
  if (band === 'Healthy') return 'badge-green';
  if (band === 'Watch') return 'badge-amber';
  if (band === 'At Risk') return 'badge-red';
  return 'badge-gray';
}

export default function HealthPage() {
  const { role } = useAuth();
  const [scanSubmitting, setScanSubmitting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // Portfolio table (D-12) — one row per active client the actor may view.
  const [rows, setRows] = useState<HealthPortfolioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // canRunScan backend (health.ts canRunScan): Director menang dulu, lalu Account
  // staff/lead. OD layered hanya memblokir jalur non-Director; division 'Account'.
  const isAccount = role && role.division === 'Account' && (role.level === 'staff' || role.level === 'lead');
  const canScan = role?.director || (isAccount && !role?.od);

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getHealthPortfolio();
      setRows(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  async function handleScan() {
    if (!window.confirm('Jalankan pemindaian skor kesehatan klien untuk bulan tertutup terakhir?')) {
      return;
    }
    setScanError(null);
    setScanResult(null);
    setScanSubmitting(true);
    try {
      const res = await getTriggerScan();
      setScanResult(res);
      // A sweep may have written new snapshots / band drops — refresh the table.
      await loadPortfolio();
    } catch (err) {
      setScanError(errorMessage(err));
    } finally {
      setScanSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Client Health</h1>
        <p className="muted">
          Portofolio kesehatan klien aktif — band terbaru, penurunan band, komplain terbuka, dan
          kesegaran rekap mingguan (M13 + M6D §8).
        </p>
      </div>

      {canScan && (
        <section className="card">
          <div className="cardHeader">
            <h2>Pemindaian Skor</h2>
          </div>
          {scanError && <div className="alert alertError" role="alert">{scanError}</div>}
          {scanResult && (
            <div className="alert alertSuccess" role="status">
              Pemindaian bulan {scanResult.period} selesai: {scanResult.snapshots_made} klien, {scanResult.band_drops_flagged} band-drop ditandai.
            </div>
          )}
          <button
            className="btn btnPrimary"
            onClick={handleScan}
            disabled={scanSubmitting}
            type="button"
          >
            {scanSubmitting ? 'Memproses...' : 'Jalankan Pemindaian'}
          </button>
          <p className="muted" style={{ marginTop: '12px', fontSize: '12px' }}>
            Operasi batch: menghitung ulang skor kesehatan untuk semua klien pada bulan tertutup terakhir. Hanya untuk Account/Direktur.
          </p>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Portofolio Klien Aktif</h2>
          <Link href="/clients" className="btn btnSecondary btnSm">Daftar Klien →</Link>
        </div>

        {loading && <p className="muted">Memuat portofolio...</p>}
        {loadError && !loading && <div className="alert alertError" role="alert">{loadError}</div>}
        {!loading && !loadError && rows.length === 0 && (
          <p className="muted">Tidak ada klien aktif dalam cakupan Anda.</p>
        )}

        {!loading && !loadError && rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Klien</th>
                  <th>Skor</th>
                  <th>Band</th>
                  <th>Komplain Terbuka</th>
                  <th>Rekap Terakhir (Ditutup)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.client_id}>
                    <td>
                      <strong>{r.toko || r.client_id}</strong>
                      {r.on_hold && (
                        <span
                          className="badge badge-amber"
                          style={{ marginLeft: '6px' }}
                          title="Semua layanan klien ini sedang On Hold (RM-2) — tetap dipantau, rekap mingguan dijeda"
                        >
                          On Hold
                        </span>
                      )}
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                        {r.client_id}
                      </div>
                    </td>
                    <td>{r.score_display}</td>
                    <td>
                      {r.band ? (
                        <span className={`badge ${getBandColor(r.band)}`}>{r.band}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {r.band_drop && (
                        <span className="badge badge-red" style={{ marginLeft: '6px' }} title="Band turun dari snapshot sebelumnya (M13 Rule 12)">
                          ↓ Band Drop
                        </span>
                      )}
                    </td>
                    <td>
                      {r.open_complaints > 0 ? (
                        <span className="badge badge-amber">{r.open_complaints}</span>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                    <td>
                      {r.last_closed_recap_week ? (
                        <span title={r.last_closed_recap_end ?? undefined}>{r.last_closed_recap_week}</span>
                      ) : (
                        <span className="muted" title="Belum ada rekap mingguan yang ditutup">Belum ada</span>
                      )}
                    </td>
                    <td>
                      <Link href={`/health/${encodeURIComponent(r.client_id)}`} className="btn btnSecondary btnSm">
                        Detail →
                      </Link>
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
