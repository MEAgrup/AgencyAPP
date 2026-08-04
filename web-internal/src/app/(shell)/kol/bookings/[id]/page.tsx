'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { formatIDR } from '@/lib/money';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  KOL_DIVISION,
  REVISION_CAP,
  assignCoordinator,
  bookBooking,
  bookingBadgeTone,
  canContinueEscalation,
  canDropBooking,
  canEscalateBooking,
  canExecuteBooking,
  canFinanceAction,
  canLogHoursBooking,
  canManageBooking,
  continueEscalation,
  createPaymentRequest,
  dropBooking,
  escalateBooking,
  failQC,
  getBooking,
  getBookingMetrics,
  isODOnly,
  logBookingHours,
  passQC,
  recordAttributedGMV,
  resubmitContent,
  sendQC,
  setBookingSLA,
  startContent,
  submitContent,
  type Booking,
  type BookingMetrics,
  type PaymentRequest,
} from '@/lib/kol';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

function formatHoursMetric(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return '—';
  return `${hours.toFixed(2)} jam`;
}

export default function KolBookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role, employee } = useAuth();
  const employeeId = employee?.employee_id;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<BookingMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // Aksi lifecycle tanpa body (book / start-content / send-qc / pass-qc) —
  // satu tombol relevan per status, jadi berbagi satu slot state.
  const [lifecyclePending, setLifecyclePending] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  // Submit Content ([Content In Progress] -> [Content Submitted])
  const [submitLink, setSubmitLink] = useState('');
  const [submitSubmitting, setSubmitSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fail QC ([QC Review] -> [QC Failed - Revision Requested])
  const [failNotes, setFailNotes] = useState('');
  const [failSubmitting, setFailSubmitting] = useState(false);
  const [failError, setFailError] = useState<string | null>(null);

  // Escalate ([QC Review] -> [Escalated - Creator Unresponsive])
  const [escalateNotes, setEscalateNotes] = useState('');
  const [escalateSubmitting, setEscalateSubmitting] = useState(false);
  const [escalateError, setEscalateError] = useState<string | null>(null);

  // Resubmit ([QC Failed - Revision Requested] -> [Content Submitted])
  const [resubmitLink, setResubmitLink] = useState('');
  const [resubmitSubmitting, setResubmitSubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  // Continue from escalation ([Escalated...] -> [Content Submitted])
  const [continueLink, setContinueLink] = useState('');
  const [continueSubmitting, setContinueSubmitting] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  // Drop (terminal, dari Sourcing/Booked/Escalated)
  const [dropSubmitting, setDropSubmitting] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  // Assign / reassign Coordinator
  const [coordinatorId, setCoordinatorId] = useState('');

  // Coordinator candidates = active KOL STAFF, i.e. what `kol.validateKolStaff`
  // accepts (§3: one accountable Coordinator). Called here — before the loading
  // early-return below — because hooks must run on every render; the gate is the
  // same `canManageBooking(role)` the section is rendered under.
  const {
    employees: coordCandidates,
    loading: coordLoading,
    error: coordLoadError,
  } = useAssignableEmployees(KOL_DIVISION, LEVEL_STAFF, canManageBooking(role) && !isODOnly(role));
  const [coordinatorReason, setCoordinatorReason] = useState('');
  const [coordSubmitting, setCoordSubmitting] = useState(false);
  const [coordError, setCoordError] = useState<string | null>(null);
  const [coordMessage, setCoordMessage] = useState<string | null>(null);

  // SLA target
  const [slaHours, setSlaHours] = useState('');
  const [slaSubmitting, setSlaSubmitting] = useState(false);
  const [slaError, setSlaError] = useState<string | null>(null);
  const [slaMessage, setSlaMessage] = useState<string | null>(null);

  // Hours Logged (self-report, non-punitive)
  const [hoursValue, setHoursValue] = useState('');
  const [hoursSubmitting, setHoursSubmitting] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursMessage, setHoursMessage] = useState<string | null>(null);

  // Attributed GMV (hanya saat [QC Passed])
  const [gmvValue, setGmvValue] = useState('');
  const [gmvSubmitting, setGmvSubmitting] = useState(false);
  const [gmvError, setGmvError] = useState<string | null>(null);
  const [gmvMessage, setGmvMessage] = useState<string | null>(null);

  // Creator Payment Request (create)
  const [paymentDetails, setPaymentDetails] = useState('');
  const [prSubmitting, setPrSubmitting] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [prResult, setPrResult] = useState<PaymentRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const b = await getBooking(id);
      setBooking(b);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadMetrics = useCallback(async () => {
    setMetricsError(null);
    try {
      const m = await getBookingMetrics(id);
      setMetrics(m);
    } catch (err) {
      setMetricsError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadMetrics();
  }, [load, loadMetrics]);

  async function runLifecycle(action: string, fn: () => Promise<unknown>) {
    setLifecycleError(null);
    setLifecyclePending(action);
    try {
      await fn();
      await load();
      await loadMetrics();
    } catch (err) {
      setLifecycleError(errorMessage(err));
    } finally {
      setLifecyclePending(null);
    }
  }

  async function handleSubmitContent(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSubmitting(true);
    try {
      await submitContent(id, submitLink.trim());
      setSubmitLink('');
      await load();
      await loadMetrics();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitSubmitting(false);
    }
  }

  async function handleFailQC(e: FormEvent) {
    e.preventDefault();
    setFailError(null);
    setFailSubmitting(true);
    try {
      await failQC(id, failNotes.trim());
      setFailNotes('');
      await load();
      await loadMetrics();
    } catch (err) {
      setFailError(errorMessage(err));
    } finally {
      setFailSubmitting(false);
    }
  }

  async function handleEscalate(e: FormEvent) {
    e.preventDefault();
    setEscalateError(null);
    setEscalateSubmitting(true);
    try {
      await escalateBooking(id, escalateNotes.trim());
      setEscalateNotes('');
      await load();
      await loadMetrics();
    } catch (err) {
      setEscalateError(errorMessage(err));
    } finally {
      setEscalateSubmitting(false);
    }
  }

  async function handleResubmit(e: FormEvent) {
    e.preventDefault();
    setResubmitError(null);
    setResubmitSubmitting(true);
    try {
      await resubmitContent(id, resubmitLink.trim());
      setResubmitLink('');
      await load();
      await loadMetrics();
    } catch (err) {
      setResubmitError(errorMessage(err));
    } finally {
      setResubmitSubmitting(false);
    }
  }

  async function handleContinue(e: FormEvent) {
    e.preventDefault();
    setContinueError(null);
    setContinueSubmitting(true);
    try {
      await continueEscalation(id, continueLink.trim());
      await load();
      await loadMetrics();
    } catch (err) {
      setContinueError(errorMessage(err));
    } finally {
      setContinueSubmitting(false);
    }
  }

  async function handleDrop() {
    const reason = window.prompt('Alasan drop booking ini:');
    if (!reason) return;
    setDropError(null);
    setDropSubmitting(true);
    try {
      await dropBooking(id, reason);
      await load();
      await loadMetrics();
    } catch (err) {
      setDropError(errorMessage(err));
    } finally {
      setDropSubmitting(false);
    }
  }

  async function handleAssignCoordinator(e: FormEvent) {
    e.preventDefault();
    setCoordError(null);
    setCoordMessage(null);
    setCoordSubmitting(true);
    try {
      const res = await assignCoordinator(id, coordinatorId, coordinatorReason.trim());
      const coord = coordCandidates?.find((e) => e.employee_id === res.assigned_coordinator);
      setCoordMessage(
        `Coordinator berhasil ditetapkan: ${coord ? `${coord.nama} (${res.assigned_coordinator})` : res.assigned_coordinator}.`,
      );
      setCoordinatorReason('');
      await load();
    } catch (err) {
      setCoordError(errorMessage(err));
    } finally {
      setCoordSubmitting(false);
    }
  }

  async function handleSetSLA(e: FormEvent) {
    e.preventDefault();
    setSlaError(null);
    setSlaMessage(null);
    setSlaSubmitting(true);
    try {
      const res = await setBookingSLA(id, Number(slaHours));
      setSlaMessage(`SLA target disimpan: ${res.sla_target_hours} jam.`);
      await load();
    } catch (err) {
      setSlaError(errorMessage(err));
    } finally {
      setSlaSubmitting(false);
    }
  }

  async function handleLogHours(e: FormEvent) {
    e.preventDefault();
    setHoursError(null);
    setHoursMessage(null);
    setHoursSubmitting(true);
    try {
      const res = await logBookingHours(id, Number(hoursValue));
      setHoursMessage(`Hours logged tersimpan: ${res.hours_logged} jam.`);
      setHoursValue('');
      await load();
    } catch (err) {
      setHoursError(errorMessage(err));
    } finally {
      setHoursSubmitting(false);
    }
  }

  async function handleRecordGMV(e: FormEvent) {
    e.preventDefault();
    setGmvError(null);
    setGmvMessage(null);
    setGmvSubmitting(true);
    try {
      const res = await recordAttributedGMV(id, gmvValue.trim());
      setGmvMessage(`Attributed GMV tersimpan: ${res.attributed_gmv_display}.`);
      setGmvValue('');
      await load();
    } catch (err) {
      setGmvError(errorMessage(err));
    } finally {
      setGmvSubmitting(false);
    }
  }

  async function handleCreatePaymentRequest(e: FormEvent) {
    e.preventDefault();
    setPrError(null);
    setPrSubmitting(true);
    try {
      const res = await createPaymentRequest(id, {
        amount: String(booking?.agreed_rate ?? ''),
        payment_details: paymentDetails.trim(),
      });
      setPrResult(res);
      setPaymentDetails('');
      await load();
    } catch (err) {
      setPrError(errorMessage(err));
    } finally {
      setPrSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !booking) {
    return (
      <div className="stack">
        <Link href="/kol" className="muted">&larr; Kembali ke KOL</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Booking tidak ditemukan.'}</div>
      </div>
    );
  }

  const status = booking.status;
  const isSourcing = status === '[Sourcing]';
  const isBooked = status === '[Booked]';
  const isContentInProgress = status === '[Content In Progress]';
  const isContentSubmitted = status === '[Content Submitted]';
  const isQCReview = status === '[QC Review]';
  const isQCPassed = status === '[QC Passed]';
  const isQCFailed = status === '[QC Failed - Revision Requested]';
  const isEscalated = status === '[Escalated - Creator Unresponsive]';
  const isDropped = status === '[Dropped]';

  const canExecute = canExecuteBooking(role, employeeId, booking);
  const canEscalate = canEscalateBooking(role);
  const canDrop = canDropBooking(role) && (isSourcing || isBooked || isEscalated);
  const canManage = canManageBooking(role);
  const canLogHoursSelf = canLogHoursBooking(role, employeeId, booking);
  const canContinue = canContinueEscalation(role, employeeId, booking);
  const canFinance = canFinanceAction(role);
  const revisionCapReached = booking.revision_count >= REVISION_CAP;
  const hasActivePaymentRequest = booking.payment_status !== '' && booking.payment_status !== '[Rejected]';

  const readOnlyNote = isODOnly(role) ? (
    <div className="alert alertInfo" role="status">
      Anda login sebagai OD &mdash; akses baca saja, semua tombol aksi disembunyikan.
    </div>
  ) : null;

  return (
    <div className="stack">
      <div>
        <Link href="/kol" className="muted">&larr; Kembali ke KOL</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{booking.id}</h1>
          <p className="muted">
            Brief: <Link href={`/kol/briefs/${booking.brief_id}`}>{booking.brief_id}</Link>
          </p>
        </div>
        <span className={`badge badge-${bookingBadgeTone(status)}`}>{status}</span>
      </div>

      {readOnlyNote}

      {/* Detail booking */}
      <section className="card">
        <div className="cardHeader">
          <h2>Detail Booking</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Creator</div>
            <div>{booking.creator_name}{booking.creator_handle ? ` (${booking.creator_handle})` : ''}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Platform</div>
            <div>{booking.platform}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Niche</div>
            <div>{booking.niche || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Source Pool</div>
            <div>{booking.source_pool}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Pool Reference</div>
            <div>{booking.pool_reference || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Agreed Rate</div>
            <div>{booking.agreed_rate_display}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Coordinator</div>
            <div>{booking.assigned_coordinator || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Content Link</div>
            <div>
              {booking.content_link ? (
                <a href={booking.content_link} target="_blank" rel="noreferrer">Lihat</a>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>QC Notes</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{booking.qc_notes || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Revision Count &middot; <span title="Computed, cap 1x sebelum wajib eskalasi">🔒 read-only</span>
            </div>
            <div>{booking.revision_count}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Payment Status &middot; <span title="Reflection dari Creator Payment Request terbaru">🔒 read-only</span>
            </div>
            <div>{booking.payment_status || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Attributed GMV &middot;{' '}
              <span title="Hanya diubah lewat aksi Record Attributed GMV, bukan form ini">🔒 read-only</span>
            </div>
            <div>{formatIDR(booking.attributed_gmv ?? null)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>SLA Target</div>
            <div>{booking.sla_target_hours !== undefined ? `${booking.sla_target_hours} jam` : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Hours Logged</div>
            <div>{booking.hours_logged !== undefined ? `${booking.hours_logged} jam` : '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat Oleh</div>
            <div>{booking.created_by}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat Pada</div>
            <div>{formatDateTime(booking.created_at)}</div>
          </div>
        </div>
      </section>

      {/* Metrik computed read-only */}
      <section className="card">
        <div className="cardHeader">
          <h2>
            Metrik{' '}
            <span className="muted" style={{ fontSize: 12 }} title="Auto-calculated, tidak dapat diubah">
              🔒 read-only
            </span>
          </h2>
        </div>
        {metricsError && <div className="alert alertError" role="alert">{metricsError}</div>}
        {metrics && (
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Sourcing Turnaround</div>
              <div>{formatHoursMetric(metrics.sourcing_turnaround_hours)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Delivery Turnaround</div>
              <div>{formatHoursMetric(metrics.delivery_turnaround_hours)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Overall Turnaround</div>
              <div>{formatHoursMetric(metrics.overall_turnaround_hours)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Speed Score</div>
              <div>
                {metrics.speed_score_display}
                {metrics.excluded_from_speed_score && (
                  <span className="badge badge-darkgray" style={{ marginLeft: 6 }}>Dikecualikan (Dropped)</span>
                )}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Approved Period (WIB)</div>
              <div>{metrics.approved_period_wib || '—'}</div>
            </div>
          </div>
        )}
      </section>

      {/* Aksi lifecycle */}
      {!isDropped && !isODOnly(role) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi Lifecycle</h2>
          </div>
          {lifecycleError && <div className="alert alertError" role="alert">{lifecycleError}</div>}

          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {isSourcing && canExecute && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={lifecyclePending !== null}
                onClick={() => runLifecycle('book', () => bookBooking(id))}
              >
                {lifecyclePending === 'book' ? 'Memproses...' : 'Book Creator'}
              </button>
            )}
            {isBooked && canExecute && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={lifecyclePending !== null}
                onClick={() => runLifecycle('start-content', () => startContent(id))}
              >
                {lifecyclePending === 'start-content' ? 'Memproses...' : 'Mulai Konten'}
              </button>
            )}
            {isContentSubmitted && canExecute && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={lifecyclePending !== null}
                onClick={() => runLifecycle('send-qc', () => sendQC(id))}
              >
                {lifecyclePending === 'send-qc' ? 'Memproses...' : 'Kirim ke QC'}
              </button>
            )}
            {isQCReview && canExecute && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={lifecyclePending !== null}
                onClick={() => runLifecycle('pass-qc', () => passQC(id))}
              >
                {lifecyclePending === 'pass-qc' ? 'Memproses...' : 'Pass QC'}
              </button>
            )}
            {canDrop && (
              <button
                type="button"
                className="btn btnDanger"
                disabled={dropSubmitting}
                onClick={handleDrop}
              >
                {dropSubmitting ? 'Memproses...' : 'Drop Booking'}
              </button>
            )}
          </div>
          {dropError && <div className="alert alertError" role="alert">{dropError}</div>}

          {/* Submit Content */}
          {isContentInProgress && canExecute && (
            <form className="form" onSubmit={handleSubmitContent} style={{ marginTop: 12 }}>
              {submitError && <div className="alert alertError" role="alert">{submitError}</div>}
              <div className="field">
                <label htmlFor="submit-link">Content Link</label>
                <input
                  id="submit-link"
                  required
                  placeholder="https://..."
                  value={submitLink}
                  onChange={(e) => setSubmitLink(e.target.value)}
                />
              </div>
              <div>
                <button type="submit" className="btn btnPrimary" disabled={submitSubmitting}>
                  {submitSubmitting ? 'Menyimpan...' : 'Submit Content'}
                </button>
              </div>
            </form>
          )}

          {/* QC Review: Fail QC / Escalate */}
          {isQCReview && (
            <div className="stack" style={{ marginTop: 12, gap: 16 }}>
              {canExecute && !revisionCapReached && (
                <form className="form" onSubmit={handleFailQC}>
                  <h3 style={{ fontSize: 14, margin: 0 }}>Fail QC (revisi ke kreator)</h3>
                  {failError && <div className="alert alertError" role="alert">{failError}</div>}
                  <p className="muted" style={{ fontSize: 12 }}>
                    QC checklist (visual, tidak dikirim per-item ke backend): brand/product mention,
                    hashtag/tag wajib, disclosure transparansi, kualitas konten, tone on-brand.
                  </p>
                  <div className="field">
                    <label htmlFor="fail-notes">QC Notes</label>
                    <textarea
                      id="fail-notes"
                      required
                      value={failNotes}
                      onChange={(e) => setFailNotes(e.target.value)}
                    />
                  </div>
                  <div>
                    <button type="submit" className="btn btnSecondary" disabled={failSubmitting}>
                      {failSubmitting ? 'Menyimpan...' : 'Fail QC (Minta Revisi)'}
                    </button>
                  </div>
                </form>
              )}
              {canExecute && revisionCapReached && (
                <div className="alert alertInfo" role="status">
                  Batas revisi kreator (1x) sudah tercapai &mdash; gunakan Escalate, bukan Fail QC lagi.
                </div>
              )}
              {canEscalate && (
                <form className="form" onSubmit={handleEscalate}>
                  <h3 style={{ fontSize: 14, margin: 0 }}>
                    Escalate <span className="muted" style={{ fontSize: 12 }}>(KOL Team Leader/Direktur)</span>
                  </h3>
                  {escalateError && <div className="alert alertError" role="alert">{escalateError}</div>}
                  <div className="field">
                    <label htmlFor="escalate-notes">QC Notes</label>
                    <textarea
                      id="escalate-notes"
                      required
                      value={escalateNotes}
                      onChange={(e) => setEscalateNotes(e.target.value)}
                    />
                  </div>
                  <div>
                    <button type="submit" className="btn btnDanger" disabled={escalateSubmitting}>
                      {escalateSubmitting ? 'Menyimpan...' : 'Eskalasi Booking'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* QC Failed: Resubmit */}
          {isQCFailed && canExecute && (
            <form className="form" onSubmit={handleResubmit} style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Resubmit Content (revisi #{booking.revision_count})</h3>
              {resubmitError && <div className="alert alertError" role="alert">{resubmitError}</div>}
              <div className="field">
                <label htmlFor="resubmit-link">Content Link Baru</label>
                <input
                  id="resubmit-link"
                  required
                  placeholder="https://..."
                  value={resubmitLink}
                  onChange={(e) => setResubmitLink(e.target.value)}
                />
              </div>
              <div>
                <button type="submit" className="btn btnPrimary" disabled={resubmitSubmitting}>
                  {resubmitSubmitting ? 'Menyimpan...' : 'Resubmit'}
                </button>
              </div>
            </form>
          )}

          {/* Escalated: Continue / Drop */}
          {isEscalated && (
            <div className="stack" style={{ marginTop: 12, gap: 16 }}>
              {canContinue && (
                <form className="form" onSubmit={handleContinue}>
                  <h3 style={{ fontSize: 14, margin: 0 }}>Continue (lanjut, terima konten apa adanya)</h3>
                  {continueError && <div className="alert alertError" role="alert">{continueError}</div>}
                  <p className="muted" style={{ fontSize: 12 }}>
                    Kosongkan untuk memakai Content Link lama &mdash; wajib diisi kalau belum pernah ada
                    link sama sekali.
                  </p>
                  <div className="field">
                    <label htmlFor="continue-link">Content Link (opsional)</label>
                    <input
                      id="continue-link"
                      placeholder={booking.content_link || 'https://...'}
                      value={continueLink}
                      onChange={(e) => setContinueLink(e.target.value)}
                    />
                  </div>
                  <div>
                    <button type="submit" className="btn btnPrimary" disabled={continueSubmitting}>
                      {continueSubmitting ? 'Menyimpan...' : 'Lanjutkan'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>
      )}

      {/* Coordinator / SLA (KOL Team Leader / Direktur saja) */}
      {canManage && !isODOnly(role) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Coordinator &amp; SLA</h2>
          </div>
          <form className="form" onSubmit={handleAssignCoordinator}>
            <h3 style={{ fontSize: 14, margin: 0 }}>
              {booking.assigned_coordinator ? 'Reassign Coordinator' : 'Assign Coordinator'}
            </h3>
            {coordError && <div className="alert alertError" role="alert">{coordError}</div>}
            {coordMessage && <div className="alert alertSuccess" role="status">{coordMessage}</div>}
            <div className="formRow">
              <EmployeePicker
                id="coordinator-id"
                label="Coordinator (staff KOL aktif)"
                required
                employees={coordCandidates}
                loading={coordLoading}
                error={coordLoadError}
                value={coordinatorId}
                onChange={setCoordinatorId}
                emptyHint="Belum ada staff KOL aktif yang bisa dijadikan Coordinator."
              />
              {booking.assigned_coordinator && (
                <div className="field">
                  <label htmlFor="coordinator-reason">Alasan Reassignment</label>
                  <input
                    id="coordinator-reason"
                    required
                    value={coordinatorReason}
                    onChange={(e) => setCoordinatorReason(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div>
              <button
                type="submit"
                className="btn btnPrimary"
                disabled={coordSubmitting || coordinatorId === ''}
              >
                {coordSubmitting ? 'Menyimpan...' : 'Simpan Coordinator'}
              </button>
            </div>
          </form>

          <form className="form" onSubmit={handleSetSLA} style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>SLA Target</h3>
            {slaError && <div className="alert alertError" role="alert">{slaError}</div>}
            {slaMessage && <div className="alert alertSuccess" role="status">{slaMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="sla-hours">Target SLA (jam)</label>
                <input
                  id="sla-hours"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={slaHours}
                  onChange={(e) => setSlaHours(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={slaSubmitting}>
                {slaSubmitting ? 'Menyimpan...' : 'Simpan SLA'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Hours Logged (self-report, non-punitive) */}
      {canLogHoursSelf && !isODOnly(role) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Hours Logged</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Self-report, non-punitive &mdash; tidak dipakai untuk tampilan KPI.
          </p>
          <form className="form" onSubmit={handleLogHours}>
            {hoursError && <div className="alert alertError" role="alert">{hoursError}</div>}
            {hoursMessage && <div className="alert alertSuccess" role="status">{hoursMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="hours-value">Jam</label>
                <input
                  id="hours-value"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={hoursValue}
                  onChange={(e) => setHoursValue(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={hoursSubmitting}>
                {hoursSubmitting ? 'Menyimpan...' : 'Catat Hours'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Attributed GMV — hanya saat [QC Passed] */}
      {isQCPassed && canLogHoursSelf && !isODOnly(role) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Record Attributed GMV</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            0 valid (link aktif tanpa sales). Kosong/belum dicatat tetap tampil &ldquo;&mdash;&rdquo;
            sampai dicatat pertama kali di sini.
          </p>
          <form className="form" onSubmit={handleRecordGMV}>
            {gmvError && <div className="alert alertError" role="alert">{gmvError}</div>}
            {gmvMessage && <div className="alert alertSuccess" role="status">{gmvMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="gmv-value">Attributed GMV (Rp)</label>
                <input
                  id="gmv-value"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={gmvValue}
                  onChange={(e) => setGmvValue(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={gmvSubmitting}>
                {gmvSubmitting ? 'Menyimpan...' : 'Catat Attributed GMV'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Creator Payment Request */}
      <section className="card">
        <div className="cardHeader">
          <h2>Creator Payment Request</h2>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Payment Status saat ini: {booking.payment_status || '—'}. Belum ada endpoint daftar CPR
          tersentral di backend M9 &mdash; setelah dibuat, buka detailnya dari tautan di bawah atau
          cari langsung by ID di halaman KOL.
        </p>

        {isQCPassed && canExecute && !hasActivePaymentRequest && (
          <form className="form" onSubmit={handleCreatePaymentRequest}>
            {prError && <div className="alert alertError" role="alert">{prError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="pr-amount">Amount (harus = Agreed Rate)</label>
                <input id="pr-amount" value={booking.agreed_rate_display} disabled />
              </div>
              <div className="field">
                <label htmlFor="pr-details">Detail Pembayaran (bank/e-wallet)</label>
                <input
                  id="pr-details"
                  required
                  value={paymentDetails}
                  onChange={(e) => setPaymentDetails(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={prSubmitting}>
                {prSubmitting ? 'Menyimpan...' : 'Buat Payment Request'}
              </button>
            </div>
          </form>
        )}

        {!isQCPassed && (
          <div className="alert alertInfo" role="status">
            Payment Request hanya dapat dibuat setelah booking berstatus [QC Passed].
          </div>
        )}
        {isQCPassed && hasActivePaymentRequest && (
          <div className="alert alertInfo" role="status">
            Sudah ada Payment Request aktif untuk booking ini (status: {booking.payment_status}).
          </div>
        )}

        {prResult && (
          <div className="alert alertSuccess" role="status">
            Payment Request {prResult.id} berhasil dibuat ({prResult.amount_display}). Buka{' '}
            <Link href={`/kol/payment-requests/${prResult.id}`}>detailnya di sini</Link>.
          </div>
        )}

        {canFinance && (
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Finance: proses Receive &rarr; Pay, atau Reject di halaman detail Payment Request
            (butuh ID CPR).
          </p>
        )}
      </section>
    </div>
  );
}
