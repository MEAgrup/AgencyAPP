'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatIDR } from '@/lib/money';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  ASSET_IN_REVIEW,
  ASSET_SUBMITTED,
  approveAsset,
  approveAssetBlock,
  assignAssetPic,
  CREATIVE_DIVISION,
  findPendingBlockRequest,
  getAsset,
  getAssetAudit,
  getAssetMetrics,
  getBrief,
  isAccountRole,
  isCreativeDivision,
  isCreativeLead,
  isDirector,
  isODOnly,
  latestRevisionFeedback,
  logHours,
  rejectAssetBlock,
  requestAssetBlock,
  requestAssetRevision,
  resumeAsset,
  reviewAsset,
  reworkAsset,
  setAssetRevisionSLA,
  setAssetSLA,
  startAsset,
  submitAsset,
  type Asset,
  type Brief,
  type Metrics,
  type PendingAssetBlockRequest,
} from '@/lib/creative';
import StatusBadge from '@/components/StatusBadge';
import { transitionLabel, type TransitionResult } from '@/lib/transition';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

function formatSLA(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return 'Belum ditetapkan';
  return `${hours} jam`;
}

function formatHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return '—';
  return `${hours} jam`;
}

export default function CreativeAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role, employee } = useAuth();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const [revisionFeedback, setRevisionFeedback] = useState<{ feedback: string; actor: string; at: string } | null>(null);
  const [pendingBlock, setPendingBlock] = useState<PendingAssetBlockRequest | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Aksi eksekusi (start/submit/rework) — satu slot state bersama, satu tombol relevan per status.
  const [execSubmitting, setExecSubmitting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [execMessage, setExecMessage] = useState<string | null>(null);
  // Link output (C3, Revisi Sales/Creative/Performa) — field inline, bukan window.prompt.
  const [submitLinkInput, setSubmitLinkInput] = useState('');

  // Review AM (review/approve/request-revision)
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);

  // Hours Logged
  const [hoursInput, setHoursInput] = useState('');
  const [hoursSubmitting, setHoursSubmitting] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursMessage, setHoursMessage] = useState<string | null>(null);

  // Block: request + resume
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);

  // Block: decide (approve/reject) — SPV/Lead
  const [decideSubmitting, setDecideSubmitting] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [decideMessage, setDecideMessage] = useState<string | null>(null);

  // Assign PIC (SPV/Lead/Director)
  const [picInput, setPicInput] = useState('');
  const [picSubmitting, setPicSubmitting] = useState(false);
  const [picError, setPicError] = useState<string | null>(null);
  const [picMessage, setPicMessage] = useState<string | null>(null);

  // Set SLA / Revision SLA (SPV/Lead/Director)
  const [slaInput, setSlaInput] = useState('');
  const [slaSubmitting, setSlaSubmitting] = useState(false);
  const [slaError, setSlaError] = useState<string | null>(null);
  const [slaMessage, setSlaMessage] = useState<string | null>(null);

  const [revSlaInput, setRevSlaInput] = useState('');
  const [revSlaSubmitting, setRevSlaSubmitting] = useState(false);
  const [revSlaError, setRevSlaError] = useState<string | null>(null);
  const [revSlaMessage, setRevSlaMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const a = await getAsset(id);
      setAsset(a);
      try {
        const b = await getBrief(a.brief_id);
        setBrief(b);
      } catch {
        setBrief(null);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadMetrics = useCallback(async () => {
    setMetricsError(null);
    try {
      const m = await getAssetMetrics(id);
      setMetrics(m);
    } catch (err) {
      setMetricsError(errorMessage(err));
    }
  }, [id]);

  const loadAudit = useCallback(async () => {
    setAuditError(null);
    try {
      const res = await getAssetAudit(id);
      setRevisionFeedback(latestRevisionFeedback(res.data));
      setPendingBlock(findPendingBlockRequest(res.data));
    } catch (err) {
      setAuditError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadMetrics();
    loadAudit();
  }, [load, loadMetrics, loadAudit]);

  // ---- Role gating (UX only — server is final authority, see CONVENTIONS §6) ----
  const status = asset?.status ?? '';
  const assignedPic = asset?.assigned_pic ?? '';
  const taskDivision = brief?.assigned_division ?? '';
  const isCreativeBrief = !brief || taskDivision === 'Creative';

  const director = isDirector(role);
  const odOnly = isODOnly(role);
  const leadCreative = isCreativeLead(role);
  const inCreativeDivision = isCreativeDivision(role);
  const isAM = isAccountRole(role);
  const isSelfPic = !!employee && !!assignedPic && employee.employee_id === assignedPic;

  // Execution (start/submit/rework): staff/lead Creative, atau PIC yang sudah di-assign, atau Director.
  const canExecute =
    !odOnly && (director || (inCreativeDivision && (!assignedPic || isSelfPic || leadCreative)));
  // Resume dari Blocked: SPV/Lead Creative atau Director SAJA.
  const canDecideBlock = !odOnly && (director || leadCreative);
  // Ajukan block: staff/lead Creative, owning AM, atau Director.
  const canRequestBlock = !odOnly && (director || inCreativeDivision || isAM);
  // Review/Approve/Request-Revision: owning AM atau Director (server memutuskan owning-nya).
  const canReview = !odOnly && (director || isAM);
  // Hours Logged: PIC yang di-assign (diri sendiri), lead Creative, atau Director.
  const canLogHours = !odOnly && (director || leadCreative || isSelfPic);
  // Kelola PIC/SLA: SPV/Lead Creative atau Director.
  const canManage = !odOnly && (director || leadCreative);

  // PIC candidates = active Creative STAFF, i.e. exactly what
  // `creative.validateCreativeStaff` accepts (§2 Rule 1). Fetched only for the
  // role that may assign.
  const {
    employees: picCandidates,
    loading: picLoading,
    error: picLoadError,
  } = useAssignableEmployees(CREATIVE_DIVISION, LEVEL_STAFF, canManage);

  async function runExec(fn: () => Promise<TransitionResult>, okLabel: string) {
    setExecError(null);
    setExecMessage(null);
    setExecSubmitting(true);
    try {
      const res = await fn();
      setExecMessage(`${okLabel}: ${transitionLabel(res)}`);
      await load();
      await loadMetrics();
      await loadAudit();
    } catch (err) {
      setExecError(errorMessage(err));
    } finally {
      setExecSubmitting(false);
    }
  }

  function handleStart() {
    runExec(() => startAsset(id), 'Asset dimulai');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const link = submitLinkInput.trim();
    if (link === '') {
      setExecError('[link output wajib diisi sebelum submit]');
      return;
    }
    await runExec(() => submitAsset(id, link), 'Asset disubmit');
    setSubmitLinkInput('');
  }

  function handleRework() {
    runExec(() => reworkAsset(id), 'Asset dikerjakan ulang');
  }

  function handleResume() {
    if (!window.confirm('Lanjutkan Asset ini dari status [Blocked] ke [In Progress]?')) return;
    runExec(() => resumeAsset(id), 'Asset dilanjutkan');
  }

  async function runReview(fn: () => Promise<TransitionResult>, okLabel: string) {
    setReviewError(null);
    setReviewMessage(null);
    setReviewSubmitting(true);
    try {
      const res = await fn();
      setReviewMessage(`${okLabel}: ${transitionLabel(res)}`);
      await load();
      await loadMetrics();
      await loadAudit();
    } catch (err) {
      setReviewError(errorMessage(err));
    } finally {
      setReviewSubmitting(false);
    }
  }

  function handleReview() {
    runReview(() => reviewAsset(id), 'Mulai review');
  }

  function handleApprove() {
    if (!window.confirm('Setujui Asset ini?')) return;
    runReview(() => approveAsset(id), 'Asset disetujui');
  }

  function handleRequestRevision() {
    const feedback = window.prompt('Catatan revisi untuk PIC:');
    if (!feedback) return;
    runReview(() => requestAssetRevision(id, feedback), 'Revisi diminta');
  }

  async function handleLogHours(e: FormEvent) {
    e.preventDefault();
    setHoursError(null);
    setHoursMessage(null);
    setHoursSubmitting(true);
    try {
      const res = await logHours(id, Number(hoursInput));
      setHoursMessage(`Hours Logged tersimpan: ${res.hours_logged} jam.`);
      setHoursInput('');
      await load();
    } catch (err) {
      setHoursError(errorMessage(err));
    } finally {
      setHoursSubmitting(false);
    }
  }

  async function handleRequestBlock() {
    const reason = window.prompt('Alasan permintaan block Asset ini:');
    if (!reason) return;
    setBlockError(null);
    setBlockMessage(null);
    setBlockSubmitting(true);
    try {
      await requestAssetBlock(id, reason);
      setBlockMessage('Permintaan block dikirim. Menunggu keputusan SPV/Lead Creative.');
      await load();
      await loadAudit();
    } catch (err) {
      setBlockError(errorMessage(err));
    } finally {
      setBlockSubmitting(false);
    }
  }

  async function handleDecideBlock(decision: 'approve' | 'reject') {
    if (!pendingBlock) return;
    const label = decision === 'approve' ? 'Setujui' : 'Tolak';
    if (!window.confirm(`${label} permintaan block dari ${pendingBlock.requestedBy}?`)) return;
    setDecideError(null);
    setDecideMessage(null);
    setDecideSubmitting(true);
    try {
      const res =
        decision === 'approve'
          ? await approveAssetBlock(id, pendingBlock.id)
          : await rejectAssetBlock(id, pendingBlock.id);
      setDecideMessage(`Permintaan block ${res.status}.`);
      await load();
      await loadAudit();
    } catch (err) {
      setDecideError(errorMessage(err));
    } finally {
      setDecideSubmitting(false);
    }
  }

  async function handleAssignPic(e: FormEvent) {
    e.preventDefault();
    setPicError(null);
    setPicMessage(null);
    setPicSubmitting(true);
    try {
      const res = await assignAssetPic(id, picInput);
      const pic = picCandidates?.find((e) => e.employee_id === res.assigned_pic);
      setPicMessage(`PIC ditetapkan: ${pic ? `${pic.nama} (${res.assigned_pic})` : res.assigned_pic}`);
      setPicInput('');
      await load();
    } catch (err) {
      setPicError(errorMessage(err));
    } finally {
      setPicSubmitting(false);
    }
  }

  async function handleSetSla(e: FormEvent) {
    e.preventDefault();
    setSlaError(null);
    setSlaMessage(null);
    setSlaSubmitting(true);
    try {
      const res = await setAssetSLA(id, Number(slaInput));
      setSlaMessage(`SLA target ditetapkan: ${res.sla_target_hours} jam`);
      setSlaInput('');
      await load();
      await loadMetrics();
    } catch (err) {
      setSlaError(errorMessage(err));
    } finally {
      setSlaSubmitting(false);
    }
  }

  async function handleSetRevSla(e: FormEvent) {
    e.preventDefault();
    setRevSlaError(null);
    setRevSlaMessage(null);
    setRevSlaSubmitting(true);
    try {
      const res = await setAssetRevisionSLA(id, Number(revSlaInput));
      setRevSlaMessage(`SLA revisi ditetapkan: ${res.revision_sla_target_hours} jam`);
      setRevSlaInput('');
      await load();
      await loadMetrics();
    } catch (err) {
      setRevSlaError(errorMessage(err));
    } finally {
      setRevSlaSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !asset) {
    return (
      <div className="stack">
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Asset tidak ditemukan.'}</div>
      </div>
    );
  }

  const showStart = canExecute && status === '[To Do]';
  const showSubmit = canExecute && status === '[In Progress]';
  const showRework = canExecute && status === '[Revision Requested]';
  const showResume = canDecideBlock && status === '[Blocked]';
  // m7.md §2 shows "[In Progress]/dst -> [Blocked]" (ambiguous beyond In Progress);
  // mirrors the existing M12 precedent (lib/tasks.ts workspace) which only surfaces
  // this button from [In Progress] — server is final authority on any other status.
  const showRequestBlock = canRequestBlock && status === '[In Progress]';
  const hasExecAction = showStart || showSubmit || showRework || showResume || showRequestBlock;

  const showReview = canReview && status === ASSET_SUBMITTED;
  const showApproveOrRevision = canReview && status === ASSET_IN_REVIEW;

  return (
    <div className="stack">
      <div>
        <Link href="/creative" className="muted">&larr; Kembali ke Creative</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{asset.id}</h1>
          <p className="muted">
            Brief:{' '}
            {brief ? (
              <Link href={`/creative/briefs/${asset.brief_id}`}>{asset.brief_id}</Link>
            ) : (
              asset.brief_id
            )}
            {taskDivision && <> &middot; Divisi: {taskDivision}</>}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {asset.revision_flagged && <span className="badge badge-purple">Quality Flag</span>}
          <StatusBadge status={status} />
        </div>
      </div>

      {!isCreativeBrief && (
        <div className="alert alertInfo" role="status">
          Brief induk Asset ini bukan divisi Creative (&ldquo;{taskDivision}&rdquo;) &mdash; data mungkin tidak
          relevan untuk workspace ini.
        </div>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Detail Asset</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Tipe Asset</div>
            <div>{asset.asset_type || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Urutan</div>
            <div>{asset.sequence_no}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>PIC</div>
            <div>{assignedPic || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Output</div>
            <div>
              {asset.output_link ? (
                <a href={asset.output_link} target="_blank" rel="noreferrer">Lihat Output</a>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>SLA Target</div>
            <div>{formatSLA(asset.sla_target_hours)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>SLA Revisi</div>
            <div>{formatSLA(asset.revision_sla_target_hours)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Hours Logged &middot; <span title="Self-report, bukan bagian skor Speed/Quantity">non-punitive</span>
            </div>
            <div>{formatHours(asset.hours_logged)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Attributed GMV &middot; <span title="Diisi Ads/Reporting (M8+), read-only di sini">🔒 read-only</span>
            </div>
            <div>{formatIDR(asset.attributed_gmv ?? null)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat Oleh</div>
            <div>{asset.created_by || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat</div>
            <div>{formatDateTime(asset.created_at)}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Metrik (read-only)</h2>
        </div>
        {metricsError && <div className="alert alertError" role="alert">{metricsError}</div>}
        {metrics && (
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Turnaround</div>
              <div>{formatHours(metrics.turnaround_hours)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Speed Score</div>
              <div>{metrics.speed_score_display}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Turnaround Revisi</div>
              <div>{formatHours(metrics.revision_turnaround_hours)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Speed Score Revisi</div>
              <div>{metrics.revision_speed_score_display}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Jumlah Revisi</div>
              <div>
                {metrics.revision_count}
                {metrics.revision_flagged && (
                  <span className="badge badge-purple" style={{ marginLeft: 6 }}>Quality Flag</span>
                )}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Disetujui</div>
              <div>{formatDateTime(metrics.approved_at)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Periode Approve (WIB)</div>
              <div>{metrics.approved_period_wib || '—'}</div>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Feedback Revisi Terakhir</h2>
        </div>
        {auditError && <div className="alert alertError" role="alert">{auditError}</div>}
        {revisionFeedback ? (
          <div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{revisionFeedback.feedback}</p>
            <p className="muted" style={{ fontSize: 12 }}>
              oleh {revisionFeedback.actor} &middot; {formatDateTime(revisionFeedback.at)}
            </p>
          </div>
        ) : (
          <div className="emptyState">Belum ada feedback revisi tercatat.</div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Aksi Eksekusi (PIC)</h2>
        </div>
        {execError && <div className="alert alertError" role="alert">{execError}</div>}
        {execMessage && <div className="alert alertSuccess" role="status">{execMessage}</div>}
        {blockError && <div className="alert alertError" role="alert">{blockError}</div>}
        {blockMessage && <div className="alert alertSuccess" role="status">{blockMessage}</div>}

        {hasExecAction ? (
          <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {showStart && (
                <button type="button" className="btn btnPrimary" disabled={execSubmitting} onClick={handleStart}>
                  {execSubmitting ? 'Memproses...' : 'Mulai Kerjakan'}
                </button>
              )}
              {showRework && (
                <button type="button" className="btn btnPrimary" disabled={execSubmitting} onClick={handleRework}>
                  {execSubmitting ? 'Memproses...' : 'Kerjakan Ulang (Rework)'}
                </button>
              )}
              {showResume && (
                <button type="button" className="btn btnSecondary" disabled={execSubmitting} onClick={handleResume}>
                  {execSubmitting ? 'Memproses...' : 'Lanjutkan dari Blocked'}
                </button>
              )}
              {showRequestBlock && (
                <button type="button" className="btn btnDanger" disabled={blockSubmitting} onClick={handleRequestBlock}>
                  {blockSubmitting ? 'Memproses...' : 'Ajukan Block'}
                </button>
              )}
            </div>
            {showSubmit && (
              <form className="row" style={{ gap: 8, marginTop: 8, alignItems: 'flex-end' }} onSubmit={handleSubmit}>
                <div className="field" style={{ flex: 1 }}>
                  <label htmlFor="submit-link">Link output hasil kerja</label>
                  <input
                    id="submit-link"
                    type="text"
                    value={submitLinkInput}
                    onChange={(e) => setSubmitLinkInput(e.target.value)}
                    placeholder="https://drive.google.com/..."
                  />
                </div>
                <button type="submit" className="btn btnPrimary" disabled={execSubmitting}>
                  {execSubmitting ? 'Memproses...' : 'Submit'}
                </button>
              </form>
            )}
          </>
        ) : (
          <p className="muted">Tidak ada aksi eksekusi yang tersedia untuk Anda pada status ini.</p>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Review Asset (AM)</h2>
        </div>
        {reviewError && <div className="alert alertError" role="alert">{reviewError}</div>}
        {reviewMessage && <div className="alert alertSuccess" role="status">{reviewMessage}</div>}
        {showReview || showApproveOrRevision ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {showReview && (
              <button type="button" className="btn btnPrimary" disabled={reviewSubmitting} onClick={handleReview}>
                {reviewSubmitting ? 'Memproses...' : 'Mulai Review'}
              </button>
            )}
            {showApproveOrRevision && (
              <>
                <button type="button" className="btn btnPrimary" disabled={reviewSubmitting} onClick={handleApprove}>
                  {reviewSubmitting ? 'Memproses...' : 'Setujui'}
                </button>
                <button
                  type="button"
                  className="btn btnSecondary"
                  disabled={reviewSubmitting}
                  onClick={handleRequestRevision}
                >
                  {reviewSubmitting ? 'Memproses...' : 'Minta Revisi'}
                </button>
              </>
            )}
          </div>
        ) : (
          <p className="muted">
            Tidak ada aksi review yang tersedia untuk Anda pada status ini. Hanya Account Manager pemilik
            klien atau Director yang dapat mereview.
          </p>
        )}
      </section>

      {canLogHours && (
        <section className="card">
          <div className="cardHeader">
            <h2>Hours Logged</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Self-report jam kerja &mdash; non-punitive, tidak dipakai untuk skor Speed/Quantity.
          </p>
          <form className="form" onSubmit={handleLogHours}>
            {hoursError && <div className="alert alertError" role="alert">{hoursError}</div>}
            {hoursMessage && <div className="alert alertSuccess" role="status">{hoursMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="hours-input">Jam (harus &gt; 0)</label>
                <input
                  id="hours-input"
                  type="number"
                  min="0.25"
                  step="0.25"
                  required
                  value={hoursInput}
                  onChange={(e) => setHoursInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={hoursSubmitting}>
                {hoursSubmitting ? 'Menyimpan...' : 'Catat Jam'}
              </button>
            </div>
          </form>
        </section>
      )}

      {canDecideBlock && pendingBlock && (
        <section className="card">
          <div className="cardHeader">
            <h2>Keputusan Block-Request</h2>
          </div>
          {decideError && <div className="alert alertError" role="alert">{decideError}</div>}
          {decideMessage && <div className="alert alertSuccess" role="status">{decideMessage}</div>}
          <p style={{ whiteSpace: 'pre-wrap' }}>{pendingBlock.reason || '—'}</p>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            diajukan oleh {pendingBlock.requestedBy} &middot; {formatDateTime(pendingBlock.requestedAt)}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btnPrimary btnSm"
              disabled={decideSubmitting}
              onClick={() => handleDecideBlock('approve')}
            >
              {decideSubmitting ? 'Memproses...' : 'Setujui Block'}
            </button>
            <button
              type="button"
              className="btn btnDanger btnSm"
              disabled={decideSubmitting}
              onClick={() => handleDecideBlock('reject')}
            >
              {decideSubmitting ? 'Memproses...' : 'Tolak Block'}
            </button>
          </div>
        </section>
      )}

      {canManage && (
        <section className="card">
          <div className="cardHeader">
            <h2>Kelola Asset (SPV/Lead Creative)</h2>
          </div>

          <form className="form" onSubmit={handleAssignPic}>
            {picError && <div className="alert alertError" role="alert">{picError}</div>}
            {picMessage && <div className="alert alertSuccess" role="status">{picMessage}</div>}
            <div className="formRow">
              <EmployeePicker
                id="pic-input"
                label="Tetapkan PIC (staff Creative aktif)"
                required
                employees={picCandidates}
                loading={picLoading}
                error={picLoadError}
                value={picInput}
                onChange={setPicInput}
                emptyHint="Belum ada staff Creative aktif yang bisa ditetapkan sebagai PIC."
              />
              <button
                type="submit"
                className="btn btnPrimary btnSm"
                disabled={picSubmitting || picInput === ''}
              >
                {picSubmitting ? 'Menyimpan...' : 'Tetapkan PIC'}
              </button>
            </div>
          </form>

          <form className="form" onSubmit={handleSetSla} style={{ marginTop: 14 }}>
            {slaError && <div className="alert alertError" role="alert">{slaError}</div>}
            {slaMessage && <div className="alert alertSuccess" role="status">{slaMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="sla-input">Target SLA (jam, harus &gt; 0)</label>
                <input
                  id="sla-input"
                  type="number"
                  min="0.5"
                  step="0.5"
                  required
                  value={slaInput}
                  onChange={(e) => setSlaInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={slaSubmitting}>
                {slaSubmitting ? 'Menyimpan...' : 'Set SLA'}
              </button>
            </div>
          </form>

          <form className="form" onSubmit={handleSetRevSla} style={{ marginTop: 14 }}>
            {revSlaError && <div className="alert alertError" role="alert">{revSlaError}</div>}
            {revSlaMessage && <div className="alert alertSuccess" role="status">{revSlaMessage}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="rev-sla-input">Target SLA Revisi (jam, harus &gt; 0)</label>
                <input
                  id="rev-sla-input"
                  type="number"
                  min="0.5"
                  step="0.5"
                  required
                  value={revSlaInput}
                  onChange={(e) => setRevSlaInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={revSlaSubmitting}>
                {revSlaSubmitting ? 'Menyimpan...' : 'Set SLA Revisi'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
