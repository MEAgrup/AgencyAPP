'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/api';
import { getSnapshot, getTrend, getPreview, getROASToggle, setROASToggle, COMPONENT_LABELS, type Snapshot, type ROASToggle } from '@/lib/health';
import {
  listRecapsForClient, getRecapDetail, getPlanRekapRollup,
  WRR_DITUTUP, WRR_DITUTUP_OTOMATIS, getMetrikLabel,
  type Recap, type RecapDetail, type RecapMetrik, type PlanRekapRollup,
} from '@/lib/recap';
import { listComplaints, type Complaint } from '@/lib/account';
import { listInterviewsByClient, type InterviewListRow } from '@/lib/interview';
import { formatIDR } from '@/lib/money';

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

// --- H-1 metric formatting (each consolidated metric renders in its own unit;
//     division-by-zero already collapses to null server-side → "—", house #7). ---
function formatMetrikValue(key: string, v: number | null): string {
  if (v === null || v === undefined) return '—';
  if (key === 'gmv_interim' || key === 'ad_spend') return formatIDR(v);
  if (key === 'roas_ads') return `${v.toFixed(2)}×`;
  if (key === 'ctr' || key === 'cvr') return `${v.toFixed(2)}%`;
  if (key === 'total_view') return v.toLocaleString('id-ID');
  return String(v);
}

// Delta vs the week before (RM-C stores nilai_minggu_lalu on each metric row).
function formatDelta(m: RecapMetrik): { text: string; tone: string } {
  if (m.nilai === null || m.nilai_minggu_lalu === null) return { text: '—', tone: 'muted' };
  const d = m.nilai - m.nilai_minggu_lalu;
  if (d === 0) return { text: '±0', tone: 'muted' };
  const sign = d > 0 ? '▲' : '▼';
  const tone = d > 0 ? 'badge-green' : 'badge-red';
  return { text: `${sign} ${formatMetrikValue(m.metrik, Math.abs(d))}`, tone };
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

  // --- M6D §8 summary blocks H-1…H-4 (D-11). Each block loads from its own
  //     source and degrades to absent (never an error that blanks the page) when
  //     the actor lacks that source's scope (O52 / §8.3 Rule 5 / D-13). ---
  const [recaps, setRecaps] = useState<Recap[]>([]);
  const [currentDetail, setCurrentDetail] = useState<RecapDetail | null>(null); // latest recap (current week)
  const [closedDetail, setClosedDetail] = useState<RecapDetail | null>(null); // latest CLOSED week (H-1)
  const [rollup, setRollup] = useState<PlanRekapRollup | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [interviews, setInterviews] = useState<InterviewListRow[]>([]);

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

  // H-1 / H-2 — weekly recap results & report status. Loads the recap list, the
  // current week's detail (open Sengketa), and the latest CLOSED week's detail
  // (finalised results). Silent on failure → the blocks simply don't render.
  const loadRecaps = useCallback(async () => {
    try {
      const list = (await listRecapsForClient(clientId)).data;
      setRecaps(list);
      if (list.length === 0) return;
      // list is ordered newest week first (iso_year/iso_week desc).
      const current = list[0];
      const latestClosed = list.find((r) => r.status === WRR_DITUTUP || r.status === WRR_DITUTUP_OTOMATIS) ?? null;
      const [cur, closed] = await Promise.all([
        getRecapDetail(current.id).catch(() => null),
        latestClosed ? getRecapDetail(latestClosed.id).catch(() => null) : Promise.resolve(null),
      ]);
      setCurrentDetail(cur);
      setClosedDetail(closed && closed.recap.id === cur?.recap.id ? cur : closed);
      // Cumulative plan rollup (RM-E) when the finalised week is plan-linked.
      const planId = (closed ?? cur)?.recap.plan_id;
      if (planId) {
        setRollup(await getPlanRekapRollup(planId).catch(() => null));
      }
    } catch {
      setRecaps([]);
    }
  }, [clientId]);

  // H-3 — active complaints for this client (§8 CPL-).
  const loadComplaints = useCallback(async () => {
    try {
      setComplaints((await listComplaints(clientId)).data);
    } catch {
      setComplaints([]);
    }
  }, [clientId]);

  // H-4 — latest interview verdict (advisory; narrower canReadVerdict scope).
  const loadInterviews = useCallback(async () => {
    try {
      setInterviews((await listInterviewsByClient(clientId)).data);
    } catch {
      setInterviews([]);
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
    loadRecaps();
    loadComplaints();
    loadInterviews();
  }, [loadPreview, loadTrend, loadROASToggle, loadRecaps, loadComplaints, loadInterviews]);

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

  // --- Derived values for the H-1…H-4 summary blocks. ---
  const currentRecap = recaps[0] ?? null;
  const last4 = recaps.slice(0, 4);
  const amClosedCount = last4.filter((r) => r.status === WRR_DITUTUP).length;
  const autoClosedCount = last4.filter((r) => r.status === WRR_DITUTUP_OTOMATIS).length;
  // Open Sengketa Angka on the current (live) week — metric + division disputes.
  const sengketaCount = currentDetail
    ? currentDetail.metrik.filter((m) => m.sengketa).length + currentDetail.divisi.filter((d) => d.sengketa).length
    : 0;
  const activeComplaints = complaints.filter((c) => c.status === '[Open]' || c.status === '[In Progress]');
  const latestInterview = interviews[0] ?? null;
  // Fixed display order for the consolidated metrics (H-1).
  const METRIK_ORDER = ['gmv_interim', 'roas_ads', 'ad_spend', 'total_view', 'ctr', 'cvr'];
  const closedMetrik = closedDetail
    ? [...closedDetail.metrik].sort((a, b) => METRIK_ORDER.indexOf(a.metrik) - METRIK_ORDER.indexOf(b.metrik))
    : [];
  const closedNarasi = closedDetail?.catatan ?? null;

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

      {/* ============================================================== */}
      {/* M6D §8 summary blocks (D-11) — read-only, below the score header. */}
      {/* Each renders only when its source returned data; a block the actor  */}
      {/* may not read is simply absent (§8.3 Rule 5 / O52).                  */}
      {/* ============================================================== */}

      {/* H-1 — Hasil & Progress Mingguan (latest CLOSED week) */}
      {closedDetail && (
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2>Hasil &amp; Progress Mingguan</h2>
              <p className="muted">
                Minggu {closedDetail.recap.iso_year}-W{String(closedDetail.recap.iso_week).padStart(2, '0')} (
                {formatDate(closedDetail.recap.minggu_mulai)} — {formatDate(closedDetail.recap.minggu_akhir)}) ·{' '}
                {closedDetail.recap.status}
              </p>
            </div>
            <Link href={`/account/rekap/${encodeURIComponent(closedDetail.recap.id)}`} className="btn btnSecondary btnSm">
              Buka Rekap →
            </Link>
          </div>

          {/* Production per division */}
          {closedDetail.divisi.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: '16px' }}>
              <table className="table">
                <thead>
                  <tr><th>Divisi</th><th>Produksi</th><th>Sengketa</th></tr>
                </thead>
                <tbody>
                  {closedDetail.divisi.map((d) => (
                    <tr key={d.divisi}>
                      <td><strong>{d.divisi}</strong></td>
                      <td>{d.jumlah_produksi}</td>
                      <td>{d.sengketa ? <span className="badge badge-amber" title={d.sengketa}>Sengketa</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Consolidated metrics + delta vs the week before */}
          {closedMetrik.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: '16px' }}>
              <table className="table">
                <thead>
                  <tr><th>Metrik</th><th>Nilai</th><th>Δ vs Minggu Lalu</th><th>Sumber</th></tr>
                </thead>
                <tbody>
                  {closedMetrik.map((m) => {
                    const delta = formatDelta(m);
                    return (
                      <tr key={m.metrik}>
                        <td>
                          <strong>{getMetrikLabel(m.metrik)}</strong>
                          {m.sengketa && <span className="badge badge-amber" style={{ marginLeft: '6px' }} title={m.sengketa}>Sengketa</span>}
                        </td>
                        <td>{formatMetrikValue(m.metrik, m.nilai)}</td>
                        <td>
                          {delta.tone === 'muted'
                            ? <span className="muted">{delta.text}</span>
                            : <span className={`badge ${delta.tone}`}>{delta.text}</span>}
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{m.sumber}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: '11px', marginTop: '8px' }}>
                <strong>GMV Eksekusi (interim)</strong> = eksekusi mingguan (Ads + Live + afiliasi), berbeda dari
                <strong> GMV Growth</strong> (M4) pada skor di atas — keduanya tidak dijumlahkan. <strong>ROAS (Ads)</strong>
                {' '}= kanal Ads, berbeda dari <strong>ROAS Attainment</strong> pada skor.
              </p>
            </div>
          )}

          {/* Narrative headline (RM-D1 / RM-D2) */}
          {closedNarasi && (closedNarasi.yang_bergerak || closedNarasi.yang_tertahan) && (
            <div className="stack" style={{ gap: '8px' }}>
              {closedNarasi.yang_bergerak && (
                <p style={{ margin: 0 }}><strong>Yang Bergerak:</strong> {closedNarasi.yang_bergerak}</p>
              )}
              {closedNarasi.yang_tertahan && (
                <p style={{ margin: 0 }}><strong>Yang Tertahan:</strong> {closedNarasi.yang_tertahan}</p>
              )}
            </div>
          )}

          {/* Cumulative plan rollup (RM-E, read-only) when plan-linked */}
          {rollup && (
            <p className="muted" style={{ fontSize: '12px', marginTop: '12px' }}>
              Kumulatif Plan ({rollup.rekap_count} rekap ditutup): {rollup.kumulatif.video} video ·{' '}
              {rollup.kumulatif.creator} creator · {rollup.kumulatif.live} live · GMV interim{' '}
              {formatIDR(rollup.kumulatif.gmv_interim)} · spend {formatIDR(rollup.kumulatif.ad_spend)}
              {rollup.roas_terakhir !== null && <> · ROAS terakhir {rollup.roas_terakhir.toFixed(2)}×</>}
            </p>
          )}
        </section>
      )}

      {/* H-2 — Status Laporan (freshness & discipline; displayed, not scored) */}
      {currentRecap && (
        <section className="card">
          <div className="cardHeader">
            <h2>Status Laporan Mingguan</h2>
            <Link href={`/account/rekap/${encodeURIComponent(currentRecap.id)}`} className="btn btnSecondary btnSm">
              Rekap Minggu Ini →
            </Link>
          </div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <div>
              <p className="muted" style={{ fontSize: '12px', margin: 0 }}>Minggu Berjalan</p>
              <span className={`badge ${currentRecap.status === WRR_DITUTUP ? 'badge-green' : currentRecap.status === WRR_DITUTUP_OTOMATIS ? 'badge-red' : 'badge-amber'}`}>
                {currentRecap.status}
              </span>
              {currentRecap.pernah_ditutup_otomatis && (
                <span className="badge badge-red" style={{ marginLeft: '6px' }} title="Pernah ditutup otomatis oleh sistem">
                  Pernah Auto-Close
                </span>
              )}
            </div>
            <div>
              <p className="muted" style={{ fontSize: '12px', margin: 0 }}>4 Minggu Terakhir</p>
              <span className="badge badge-green" title="Ditutup oleh AM tepat waktu">{amClosedCount} AM-Closed</span>{' '}
              <span className="badge badge-red" title="Ditutup otomatis (force-close)">{autoClosedCount} Auto-Closed</span>
            </div>
            <div>
              <p className="muted" style={{ fontSize: '12px', margin: 0 }}>Sengketa Angka Terbuka</p>
              {sengketaCount > 0
                ? <span className="badge badge-amber">{sengketaCount}</span>
                : <span className="muted">0</span>}
            </div>
          </div>
        </section>
      )}

      {/* H-3 — Komplain aktif (ada komplain atau tidak) */}
      {complaints.length > 0 && (
        <section className="card">
          <h2>Komplain Aktif</h2>
          {activeComplaints.length === 0 ? (
            <p className="muted">Tidak ada komplain terbuka atau sedang diproses.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>ID</th><th>Severity</th><th>Status</th><th>Deskripsi</th></tr>
                </thead>
                <tbody>
                  {activeComplaints.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>{c.id}</td>
                      <td>
                        <span className={`badge ${c.severity === 'High' ? 'badge-red' : c.severity === 'Medium' ? 'badge-amber' : 'badge-gray'}`}>
                          {c.severity}
                        </span>
                      </td>
                      <td>{c.status}</td>
                      <td style={{ fontSize: '12px' }}>{c.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* H-4 — Kesiapan Klien (Interview verdict, advisory only) */}
      {latestInterview && (
        <section className="card">
          <div className="cardHeader">
            <div>
              <h2>Kesiapan Klien (Interview)</h2>
              <p className="muted">Konteks onboarding — advisory, tidak memengaruhi skor.</p>
            </div>
            <Link href={`/clients/${encodeURIComponent(clientId)}`} className="btn btnSecondary btnSm">
              Detail Klien →
            </Link>
          </div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <div>
              <p className="muted" style={{ fontSize: '12px', margin: 0 }}>Verdict</p>
              <strong>{latestInterview.verdict ?? '—'}</strong>
            </div>
            <div>
              <p className="muted" style={{ fontSize: '12px', margin: 0 }}>Status Prasyarat</p>
              <strong>{latestInterview.prasyarat_status ?? '—'}</strong>
            </div>
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
