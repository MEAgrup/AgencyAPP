'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';
import {
  BRIEF_VOIDED_STATUS,
  canManageLiveStream,
  confidenceBadgeTone,
  confirmSession,
  flagDiscrepancy,
  getBrief,
  getSession,
  logResults,
  reconcileSession,
  sessionBadgeTone,
  type LiveStreamBrief,
  type Session,
} from '@/lib/livestream';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function LiveStreamSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();

  // canManageSession (m10 brief §1.1/gotcha #8): owning AM OR Director — see
  // canManageLiveStream in lib/livestream.ts. UX-only; backend re-checks the
  // exact clients.assigned_am_id match on every write.
  const canManage = canManageLiveStream(role);

  const [session, setSession] = useState<Session | null>(null);
  const [brief, setBrief] = useState<LiveStreamBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Konfirmasi Vendor
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Catat Hasil
  const [actualDatetime, setActualDatetime] = useState('');
  const [actualDurationHours, setActualDurationHours] = useState('');
  const [viewersPeak, setViewersPeak] = useState('');
  const [viewersAvg, setViewersAvg] = useState('');
  const [ordersGenerated, setOrdersGenerated] = useState('');
  const [gmv, setGmv] = useState('');
  const [vendorReportLink, setVendorReportLink] = useState('');
  const [resultsSubmitting, setResultsSubmitting] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  // Rekonsiliasi
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  // Tandai Selisih
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const sessionRes = await getSession(id);
      setSession(sessionRes);
      const briefRes = await getBrief(sessionRes.brief_id);
      setBrief(briefRes);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirm() {
    if (!window.confirm('Konfirmasi vendor untuk Session ini?')) return;
    setConfirmError(null);
    setConfirmSubmitting(true);
    try {
      await confirmSession(id);
      await load();
    } catch (err) {
      setConfirmError(errorMessage(err));
    } finally {
      setConfirmSubmitting(false);
    }
  }

  async function handleResults(e: FormEvent) {
    e.preventDefault();
    setResultsError(null);
    setResultsSubmitting(true);
    try {
      await logResults(id, {
        actual_datetime: actualDatetime,
        actual_duration_hours: actualDurationHours,
        viewers_peak: viewersPeak.trim() === '' ? null : Number(viewersPeak),
        viewers_avg: viewersAvg.trim() === '' ? null : Number(viewersAvg),
        orders_generated: ordersGenerated.trim() === '' ? null : Number(ordersGenerated),
        gmv,
        vendor_report_link: vendorReportLink,
      });
      await load();
    } catch (err) {
      setResultsError(errorMessage(err));
    } finally {
      setResultsSubmitting(false);
    }
  }

  async function handleReconcile() {
    if (!window.confirm('Yakin ingin merekonsiliasi (match) Session ini? Tindakan ini final.')) return;
    setReconcileError(null);
    setReconcileSubmitting(true);
    try {
      await reconcileSession(id);
      await load();
    } catch (err) {
      setReconcileError(errorMessage(err));
    } finally {
      setReconcileSubmitting(false);
    }
  }

  async function handleFlag() {
    const notes = window.prompt('Catatan rekonsiliasi (selisih request vs hasil):');
    if (!notes) return;
    setFlagError(null);
    setFlagSubmitting(true);
    try {
      await flagDiscrepancy(id, notes);
      await load();
    } catch (err) {
      setFlagError(errorMessage(err));
    } finally {
      setFlagSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !session) {
    return (
      <div className="stack">
        <Link href="/livestream" className="muted">&larr; Kembali ke Live Stream</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Session tidak ditemukan.'}</div>
      </div>
    );
  }

  const voided = brief?.status === BRIEF_VOIDED_STATUS;
  const writable = canManage && !voided;

  return (
    <div className="stack">
      <div>
        <Link href={`/livestream/briefs/${session.brief_id}`} className="muted">&larr; Kembali ke Brief</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{session.id}</h1>
          <p className="muted">
            Brief: <Link href={`/livestream/briefs/${session.brief_id}`}>{session.brief_id}</Link>
            {brief && (
              <>
                {' '}&middot; <StatusBadge status={brief.status} />
              </>
            )}
          </p>
        </div>
        <span className={`badge badge-${sessionBadgeTone(session.status)}`}>{session.status}</span>
      </div>

      {voided && (
        <div className="alert alertError" role="alert">
          Brief untuk Session ini sudah dibatalkan &mdash; semua aksi dibekukan.
        </div>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Request</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Platform</div>
            <div>{session.platform}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Requested Date/Time</div>
            <div>{formatDateTime(session.requested_datetime)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target Duration</div>
            <div>{session.target_duration_hours} jam</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Products/Talent to Feature</div>
            <div>{session.products_talent || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Special Instructions</div>
            <div>{session.special_instructions || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Data Confidence Tier &middot; <span title="Otomatis, read-only">🔒 read-only</span></div>
            <div>
              <span className={`badge badge-${confidenceBadgeTone(session.data_confidence_tier)}`}>
                {session.data_confidence_tier}
              </span>
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat Oleh</div>
            <div>{session.created_by || '—'}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Hasil</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Actual Date/Time Held</div>
            <div>{formatDateTime(session.actual_datetime)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Actual Duration</div>
            <div>{session.actual_duration_hours !== undefined ? `${session.actual_duration_hours} jam` : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Viewers (Peak/Avg)</div>
            <div>
              {session.viewers_peak ?? '—'} / {session.viewers_avg ?? '—'}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Orders Generated</div>
            <div>{session.orders_generated ?? '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>GMV from Live &middot; <span title="Auto-calculated, tidak dapat diubah">🔒 read-only</span></div>
            <div>{session.gmv_display || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Vendor Report Link</div>
            <div>
              {session.vendor_report_link ? (
                <a href={session.vendor_report_link} target="_blank" rel="noreferrer">Lihat Laporan</a>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Reconciliation Notes</div>
            <div>{session.reconciliation_notes || '—'}</div>
          </div>
        </div>
      </section>

      {session.status === '[Requested]' && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi</h2>
          </div>
          {confirmError && <div className="alert alertError" role="alert">{confirmError}</div>}
          {writable ? (
            <button type="button" className="btn btnPrimary" disabled={confirmSubmitting} onClick={handleConfirm}>
              {confirmSubmitting ? 'Memproses...' : 'Konfirmasi Vendor'}
            </button>
          ) : (
            <p className="muted">Anda tidak memiliki akses untuk mengelola Session ini.</p>
          )}
        </section>
      )}

      {session.status === '[Confirmed by Vendor]' && writable && (
        <section className="card">
          <div className="cardHeader">
            <h2>Catat Hasil</h2>
          </div>
          <form className="form" onSubmit={handleResults}>
            {resultsError && <div className="alert alertError" role="alert">{resultsError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="results-actual-datetime">Actual Date/Time Held</label>
                <input
                  id="results-actual-datetime"
                  type="datetime-local"
                  required
                  value={actualDatetime}
                  onChange={(e) => setActualDatetime(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="results-actual-duration">Actual Duration (jam)</label>
                <input
                  id="results-actual-duration"
                  type="number"
                  min="0.1"
                  step="0.1"
                  required
                  value={actualDurationHours}
                  onChange={(e) => setActualDurationHours(e.target.value)}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="results-viewers-peak">Viewers Peak (opsional)</label>
                <input
                  id="results-viewers-peak"
                  type="number"
                  min="0"
                  step="1"
                  value={viewersPeak}
                  onChange={(e) => setViewersPeak(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="results-viewers-avg">Viewers Avg (opsional)</label>
                <input
                  id="results-viewers-avg"
                  type="number"
                  min="0"
                  step="1"
                  value={viewersAvg}
                  onChange={(e) => setViewersAvg(e.target.value)}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="results-orders">Orders Generated</label>
                <input
                  id="results-orders"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={ordersGenerated}
                  onChange={(e) => setOrdersGenerated(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="results-gmv">GMV from Live</label>
                <input
                  id="results-gmv"
                  required
                  placeholder="mis. 6400000"
                  value={gmv}
                  onChange={(e) => setGmv(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="results-vendor-link">Vendor Report Link</label>
              <input
                id="results-vendor-link"
                required
                placeholder="https://..."
                value={vendorReportLink}
                onChange={(e) => setVendorReportLink(e.target.value)}
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={resultsSubmitting}>
                {resultsSubmitting ? 'Menyimpan...' : 'Catat Hasil'}
              </button>
            </div>
          </form>
        </section>
      )}

      {(session.status === '[Completed]' || session.status === '[Discrepancy Flagged]') && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi</h2>
          </div>
          {reconcileError && <div className="alert alertError" role="alert">{reconcileError}</div>}
          {flagError && <div className="alert alertError" role="alert">{flagError}</div>}
          {writable ? (
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn btnPrimary" disabled={reconcileSubmitting} onClick={handleReconcile}>
                {reconcileSubmitting ? 'Memproses...' : 'Rekonsiliasi'}
              </button>
              {session.status === '[Completed]' && (
                <button type="button" className="btn btnSecondary" disabled={flagSubmitting} onClick={handleFlag}>
                  {flagSubmitting ? 'Memproses...' : 'Tandai Selisih'}
                </button>
              )}
            </div>
          ) : (
            <p className="muted">Anda tidak memiliki akses untuk mengelola Session ini.</p>
          )}
        </section>
      )}

      {session.status === '[Reconciled]' && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi</h2>
          </div>
          <p className="muted">Session sudah rekonsiliasi (terminal) &mdash; tidak ada aksi lagi.</p>
        </section>
      )}
    </div>
  );
}
