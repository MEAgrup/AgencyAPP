'use client';

/**
 * LT-61 vendor Session detail. Deliberately does NOT fetch the parent Brief
 * (unlike (shell)/livestream/sessions/[id]/page.tsx): `GET /briefs/{id}` gates
 * on OD/Director/Account lead/owning AM/target-division staff — a vendor
 * Actor satisfies none of those and would get a 403. The server's own
 * voided-Brief freeze (`edge()` in packages/domain/src/livestream.ts) still
 * applies on every write attempt regardless; this page just does not
 * pre-check it, matching spec §2's "no bespoke vendor read model" scope
 * (docs/prd/CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md).
 */
import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import {
  confidenceBadgeTone,
  confirmSession,
  getSession,
  logResults,
  sessionBadgeTone,
  type Session,
} from '@/lib/livestream';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function VendorSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [actualDatetime, setActualDatetime] = useState('');
  const [actualDurationHours, setActualDurationHours] = useState('');
  const [viewersPeak, setViewersPeak] = useState('');
  const [viewersAvg, setViewersAvg] = useState('');
  const [ordersGenerated, setOrdersGenerated] = useState('');
  const [gmv, setGmv] = useState('');
  const [vendorReportLink, setVendorReportLink] = useState('');
  const [resultsSubmitting, setResultsSubmitting] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSession(await getSession(id));
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
    if (!window.confirm('Konfirmasi jadwal Session ini?')) return;
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

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !session) {
    return (
      <div className="stack">
        <Link href="/vendor" className="muted">&larr; Kembali</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Session tidak ditemukan.'}</div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <Link href="/vendor" className="muted">&larr; Kembali</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{session.id}</h1>
        <span className={`badge badge-${sessionBadgeTone(session.status)}`}>{session.status}</span>
      </div>

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
            <div className="muted" style={{ fontSize: 12 }}>Tanggal/Jam Jadwal</div>
            <div>{formatDateTime(session.requested_datetime)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target Durasi</div>
            <div>{session.target_duration_hours} jam</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Produk/Talent</div>
            <div>{session.products_talent || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Instruksi Khusus</div>
            <div>{session.special_instructions || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Data Confidence Tier</div>
            <div>
              <span className={`badge badge-${confidenceBadgeTone(session.data_confidence_tier)}`}>
                {session.data_confidence_tier}
              </span>
            </div>
          </div>
        </div>
      </section>

      {(session.status === '[Completed]' || session.status === '[Reconciled]' || session.status === '[Discrepancy Flagged]') && (
        <section className="card">
          <div className="cardHeader">
            <h2>Hasil</h2>
          </div>
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Tanggal/Jam Aktual</div>
              <div>{formatDateTime(session.actual_datetime)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Durasi Aktual</div>
              <div>{session.actual_duration_hours !== undefined ? `${session.actual_duration_hours} jam` : '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Viewers (Peak/Avg)</div>
              <div>{session.viewers_peak ?? '—'} / {session.viewers_avg ?? '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Orders</div>
              <div>{session.orders_generated ?? '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>GMV from Live</div>
              <div>{session.gmv_display || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Link Laporan Vendor</div>
              <div>
                {session.vendor_report_link ? (
                  <a href={session.vendor_report_link} target="_blank" rel="noreferrer">Lihat Laporan</a>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {session.status === '[Requested]' && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi</h2>
          </div>
          {confirmError && <div className="alert alertError" role="alert">{confirmError}</div>}
          <button type="button" className="btn btnPrimary" disabled={confirmSubmitting} onClick={handleConfirm}>
            {confirmSubmitting ? 'Memproses...' : 'Konfirmasi Jadwal'}
          </button>
        </section>
      )}

      {session.status === '[Confirmed by Vendor]' && (
        <section className="card">
          <div className="cardHeader">
            <h2>Catat Hasil</h2>
          </div>
          <form className="form" onSubmit={handleResults}>
            {resultsError && <div className="alert alertError" role="alert">{resultsError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="vendor-results-actual-datetime">Tanggal/Jam Aktual</label>
                <input
                  id="vendor-results-actual-datetime"
                  type="datetime-local"
                  required
                  value={actualDatetime}
                  onChange={(e) => setActualDatetime(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="vendor-results-actual-duration">Durasi Aktual (jam)</label>
                <input
                  id="vendor-results-actual-duration"
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
                <label htmlFor="vendor-results-viewers-peak">Viewers Peak (opsional)</label>
                <input
                  id="vendor-results-viewers-peak"
                  type="number"
                  min="0"
                  step="1"
                  value={viewersPeak}
                  onChange={(e) => setViewersPeak(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="vendor-results-viewers-avg">Viewers Avg (opsional)</label>
                <input
                  id="vendor-results-viewers-avg"
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
                <label htmlFor="vendor-results-orders">Orders Generated</label>
                <input
                  id="vendor-results-orders"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={ordersGenerated}
                  onChange={(e) => setOrdersGenerated(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="vendor-results-gmv">GMV from Live</label>
                <input
                  id="vendor-results-gmv"
                  required
                  placeholder="mis. 6400000"
                  value={gmv}
                  onChange={(e) => setGmv(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="vendor-results-link">Link Laporan Vendor</label>
              <input
                id="vendor-results-link"
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
        <p className="muted">Menunggu rekonsiliasi oleh Account Manager.</p>
      )}

      {session.status === '[Reconciled]' && (
        <p className="muted">Session sudah direkonsiliasi (final).</p>
      )}
    </div>
  );
}
