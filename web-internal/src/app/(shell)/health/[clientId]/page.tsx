'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/api';
import { getSnapshot, getTrend, getPreview, getROASToggle, setROASToggle, COMPONENT_LABELS, type Snapshot, type ROASToggle } from '@/lib/health';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

function getBandColor(band: string): string {
  // Map band to badge tone: Healthy=green, Watch=amber, At Risk=red, empty=gray
  if (band === 'Healthy') return 'badge-green';
  if (band === 'Watch') return 'badge-amber';
  if (band === 'At Risk') return 'badge-red';
  return 'badge-gray';
}

export default function ClientHealthDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const { role } = useAuth();

  // Main snapshot (period-selected)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(''); // empty = latest
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Live preview (current month)
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Trend (all snapshots)
  const [trend, setTrend] = useState<Snapshot[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  // ROAS toggle
  const [roasToggle, setROASToggleState] = useState<ROASToggle | null>(null);
  const [roasToggleLoading, setROASToggleLoading] = useState(false);
  const [roasToggleSubmitting, setROASToggleSubmitting] = useState(false);
  const [roasToggleError, setROASToggleError] = useState<string | null>(null);

  // canToggleROAS backend: Director menang dulu, lalu Account staff/lead; OD layered
  // hanya memblokir jalur non-Director. Division dari /me berkapital 'Account'.
  const isAccount = role && role.division === 'Account' && (role.level === 'staff' || role.level === 'lead');
  const canToggleROAS = role?.director || (isAccount && !role?.od);

  // Load main snapshot
  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getSnapshot(clientId, selectedPeriod || undefined);
      setSnapshot(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [clientId, selectedPeriod]);

  // Load preview
  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await getPreview(clientId);
      setPreview(res);
    } catch {
      // Preview errors are silent, just don't show it
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [clientId]);

  // Load trend
  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    try {
      const res = await getTrend(clientId);
      setTrend(res.data);
    } catch {
      // Trend errors are silent
      setTrend([]);
    } finally {
      setTrendLoading(false);
    }
  }, [clientId]);

  // Load ROAS toggle
  const loadROASToggle = useCallback(async () => {
    setROASToggleLoading(true);
    try {
      const res = await getROASToggle(clientId);
      setROASToggleState(res);
    } catch {
      // Silent error
      setROASToggleState(null);
    } finally {
      setROASToggleLoading(false);
    }
  }, [clientId]);

  // Initial loads
  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    loadPreview();
    loadTrend();
    loadROASToggle();
  }, [loadPreview, loadTrend, loadROASToggle]);

  async function handleToggleROAS() {
    if (!roasToggle) return;
    setROASToggleError(null);
    setROASToggleSubmitting(true);
    try {
      // Toggle: if currently effective, set to false; otherwise set to true
      const newOverride = !roasToggle.effective;
      const res = await setROASToggle(clientId, newOverride);
      setROASToggleState(res);
    } catch (err) {
      setROASToggleError(errorMessage(err));
    } finally {
      setROASToggleSubmitting(false);
    }
  }

  async function handleClearROASToggle() {
    if (!roasToggle) return;
    setROASToggleError(null);
    setROASToggleSubmitting(true);
    try {
      // Clear to default (null)
      const res = await setROASToggle(clientId, null);
      setROASToggleState(res);
    } catch (err) {
      setROASToggleError(errorMessage(err));
    } finally {
      setROASToggleSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  // Determine active snapshot (preview or selected)
  const activeSnapshot = showPreview && preview ? preview : snapshot;

  return (
    <div className="stack">
      <div>
        <Link href="/health" className="muted">&larr; Kembali ke Health</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Kesehatan Klien</h1>
          <p className="muted">{clientId}</p>
        </div>
      </div>

      {/* Snapshot gagal dimuat (mis. klien belum punya snapshot) — error inline saja;
          section Preview/Trend/Toggle ROAS tetap dirender dari endpoint masing-masing. */}
      {(loadError || !snapshot) && (
        <section className="card">
          <div className="alert alertError" role="alert">{loadError ?? 'Data tidak ditemukan.'}</div>
          {trend.length > 0 && (
            <div className="field" style={{ marginTop: '12px', marginBottom: '0' }}>
              <label htmlFor="period-select-fallback">Pilih Periode Lain:</label>
              <select
                id="period-select-fallback"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                style={{ maxWidth: '200px' }}
              >
                <option value="">Terbaru</option>
                {trend.map((s) => (
                  <option key={s.id} value={`${s.period_start.replace(/-/g, '').slice(0, 6)}`}>
                    {formatDate(s.period_start)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>
      )}

      {/* Score & Band Header */}
      {activeSnapshot && (
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2>Skor Kesehatan</h2>
              <p className="muted">
                Periode: {formatDate(activeSnapshot.period_start)} — {formatDate(activeSnapshot.period_end)}
              </p>
            </div>
            {activeSnapshot.preview && <span className="badge badge-amber">Preview — Belum Final</span>}
          </div>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{activeSnapshot.score_display}</div>
              <p className="muted" style={{ fontSize: '12px', marginTop: '4px' }}>Skor Kesehatan</p>
            </div>
            {activeSnapshot.band && (
              <span className={`badge ${getBandColor(activeSnapshot.band)}`} style={{ fontSize: '14px', padding: '6px 12px' }}>
                {activeSnapshot.band}
              </span>
            )}
            {!activeSnapshot.band && (
              <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>—</span>
            )}
          </div>

          {/* Period Selector */}
          <div className="field" style={{ marginBottom: '0' }}>
            <label htmlFor="period-select">Pilih Periode:</label>
            <select
              id="period-select"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              style={{ maxWidth: '200px' }}
            >
              <option value="">Terbaru</option>
              {trend.map((s) => (
                <option key={s.id} value={`${s.period_start.replace(/-/g, '').slice(0, 6)}`}>
                  {formatDate(s.period_start)}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      {/* Live Preview Toggle */}
      {preview && preview.id === '' && (
        <section className="card">
          <div className="cardHeader">
            <h2>Preview Bulan Berjalan</h2>
            <button
              className={`btn ${showPreview ? 'btnPrimary' : 'btnSecondary'} btnSm`}
              onClick={() => setShowPreview(!showPreview)}
              type="button"
            >
              {showPreview ? 'Lihat Laporan Resmi' : 'Lihat Preview'}
            </button>
          </div>
          {previewLoading && <p className="muted">Memuat preview...</p>}
          {preview && !previewLoading && (
            <p className="muted">
              Skor preview bulan berjalan: <strong>{preview.score_display}</strong> ({preview.band || '—'}).
              Preview dihitung on-demand, tidak disimpan.
            </p>
          )}
        </section>
      )}

      {/* Component Breakdown */}
      {activeSnapshot && activeSnapshot.components && activeSnapshot.components.length > 0 && (
        <section className="card">
          <h2>Breakdown Komponen</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Komponen</th>
                  <th>Included</th>
                  <th>Raw</th>
                  <th>Capped</th>
                  <th>Base Weight</th>
                  <th>Effective Weight</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {activeSnapshot.components.map((comp) => (
                  <tr key={comp.name}>
                    <td><strong>{COMPONENT_LABELS[comp.name] || comp.name}</strong></td>
                    <td>{comp.included ? '✓' : '—'}</td>
                    <td>{comp.raw !== null ? comp.raw.toFixed(2) : '—'}</td>
                    <td>{comp.capped !== null ? comp.capped.toFixed(2) : '—'}</td>
                    <td>{comp.base_weight.toFixed(1)}%</td>
                    <td>{comp.effective_weight.toFixed(1)}%</td>
                    <td style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                      {comp.excluded_reason ? (
                        <span title={comp.excluded_reason}>Dikecualikan: {comp.excluded_reason.slice(0, 40)}...</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Trend Chart */}
      {trend.length > 0 && (
        <section className="card">
          <h2>Trend Skor (Riwayat)</h2>
          {trendLoading && <p className="muted">Memuat trend...</p>}
          {!trendLoading && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Periode</th>
                    <th>Skor</th>
                    <th>Band</th>
                    <th>Snapshot ID</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((s) => (
                    <tr key={s.id || s.period_start}>
                      <td>{formatDate(s.period_start)}</td>
                      <td>{s.score_display}</td>
                      <td>
                        {s.band ? (
                          <span className={`badge ${getBandColor(s.band)}`}>{s.band}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ fontSize: '11px', fontFamily: 'monospace' }}>{s.id || '(preview)'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ROAS Toggle */}
      {roasToggle && (
        <section className="card">
          <h2>Kontrol Toggle ROAS</h2>
          {roasToggleLoading && <p className="muted">Memuat...</p>}
          {!roasToggleLoading && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <p className="muted">
                  Status: <strong>{roasToggle.effective ? 'Aktif (ROAS Included)' : 'Tidak Aktif (ROAS Excluded)'}</strong>
                </p>
                <p className="muted" style={{ fontSize: '12px', marginTop: '8px' }}>
                  Klien punya layanan Ads: {roasToggle.has_ads ? 'Ya' : 'Tidak'} | Ads aktif: {roasToggle.has_active ? 'Ya' : 'Tidak'}
                </p>
              </div>
              {roasToggleError && <div className="alert alertError" role="alert">{roasToggleError}</div>}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="btn btnPrimary btnSm"
                  onClick={handleToggleROAS}
                  disabled={roasToggleSubmitting || !canToggleROAS}
                  type="button"
                  title={!canToggleROAS ? 'Anda tidak memiliki izin untuk mengubah toggle ini' : ''}
                >
                  {roasToggleSubmitting ? 'Memproses...' : (roasToggle.effective ? 'Nonaktifkan' : 'Aktifkan')}
                </button>
                <button
                  className="btn btnSecondary btnSm"
                  onClick={handleClearROASToggle}
                  disabled={roasToggleSubmitting || !canToggleROAS}
                  type="button"
                  title={!canToggleROAS ? 'Anda tidak memiliki izin untuk mengubah toggle ini' : ''}
                >
                  {roasToggleSubmitting ? 'Memproses...' : 'Kembalikan ke Default'}
                </button>
              </div>
              {!canToggleROAS && (
                <p className="muted" style={{ fontSize: '12px', marginTop: '12px' }}>
                  🔒 Hanya Account (Staff/Lead) dan Direktur yang dapat mengubah toggle ROAS.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
