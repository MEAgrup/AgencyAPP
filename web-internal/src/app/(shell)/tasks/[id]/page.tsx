'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import {
  assignPIC,
  getAsset,
  getBrief,
  getMetrics,
  listBriefAssets,
  requestBlock,
  resumeTask,
  reworkTask,
  setRevisionSLA,
  setSLA,
  sourceOf,
  startTask,
  submitTask,
  type Asset,
  type Brief,
  type Metrics,
  type TaskSource,
} from '@/lib/tasks';
import StatusBadge from '@/components/StatusBadge';

// Live Stream briefs skip the M12 engine (dispatched to vendor) — their native
// status; no execution edge ever succeeds for them.
const DISPATCHED_STATUS = '[Dispatched to Vendor]';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

// SLA target: null = belum ditetapkan; otherwise a number of hours.
function formatSLA(hours: number | null) {
  if (hours === null || hours === undefined) return 'Belum ditetapkan';
  return `${hours} jam`;
}

// Turnaround / revision turnaround: null renders as em dash (house convention #7),
// never 0 and never an error.
function formatHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return '—';
  return `${hours} jam`;
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const source: TaskSource = sourceOf(id);
  const { role } = useAuth();

  const [brief, setBrief] = useState<Brief | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [parentBrief, setParentBrief] = useState<Brief | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  // Aksi transisi (start/submit/rework/resume) — satu slot state bersama karena
  // hanya satu tombol transisi yang relevan per status.
  const [transitionSubmitting, setTransitionSubmitting] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);

  // Ajukan Block (request)
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);

  // Assign PIC (SPV/Lead/Director)
  const [picInput, setPicInput] = useState('');
  const [picSubmitting, setPicSubmitting] = useState(false);
  const [picError, setPicError] = useState<string | null>(null);
  const [picMessage, setPicMessage] = useState<string | null>(null);

  // Set SLA (SPV/Lead/Director)
  const [slaInput, setSlaInput] = useState('');
  const [slaSubmitting, setSlaSubmitting] = useState(false);
  const [slaError, setSlaError] = useState<string | null>(null);
  const [slaMessage, setSlaMessage] = useState<string | null>(null);

  // Set Revision SLA (Asset only)
  const [revSlaInput, setRevSlaInput] = useState('');
  const [revSlaSubmitting, setRevSlaSubmitting] = useState(false);
  const [revSlaError, setRevSlaError] = useState<string | null>(null);
  const [revSlaMessage, setRevSlaMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (source === 'asset') {
        const a = await getAsset(id);
        setAsset(a);
        // Parent Brief supplies the division used for role gating; tolerate failure.
        try {
          const pb = await getBrief(a.brief_id);
          setParentBrief(pb);
        } catch {
          setParentBrief(null);
        }
      } else {
        // Both reads are keyed on the same id, so fire them together instead of
        // one-after-the-other (P-1). Creative briefs break down into Assets;
        // Ads/single-unit briefs return [].
        const [b, res] = await Promise.all([
          getBrief(id),
          listBriefAssets(id).catch(() => null),
        ]);
        setBrief(b);
        setAssets(res === null ? [] : res.data);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, source]);

  const loadMetrics = useCallback(async () => {
    setMetricsError(null);
    try {
      const m = await getMetrics(source, id);
      setMetrics(m);
    } catch (err) {
      setMetricsError(errorMessage(err));
    }
  }, [id, source]);

  useEffect(() => {
    load();
    loadMetrics();
  }, [load, loadMetrics]);

  // ---- Derived view fields (whichever source is active) ----
  const entity = source === 'asset' ? asset : brief;
  const status = entity?.status ?? '';
  const assignedPic = entity?.assigned_pic ?? '';
  const revisionFlagged = entity?.revision_flagged ?? false;
  const taskDivision =
    source === 'asset' ? parentBrief?.assigned_division ?? '' : brief?.assigned_division ?? '';
  // 'Live Stream' verbatim from backend (module10_livestream/livestream.go LiveStreamDivision).
  const isDispatched = status === DISPATCHED_STATUS || taskDivision === 'Live Stream';

  // ---- Role gating (UX only — backend is final authority) ----
  const isDirector = Boolean(role?.director);
  const isODonly = Boolean(role?.od) && !isDirector;
  const isLeadOfDivision = role?.level === 'lead' && role?.division === taskDivision;
  const inDivision = role?.division === taskDivision;
  // 'Account' verbatim from backend (module12_task/task.go AccountDivision). Server-side
  // canRequestBlock (block.go) narrows further to the OWNING AM — any over-show here 403s.
  const isAM = role?.division === 'Account';

  // Execution edges (start/submit/rework): pra-PIC staff/lead divisi; pasca-PIC
  // PIC/lead/Director. Server re-checks PIC ownership — UI only hides obvious no-ops.
  const canExecute = !isODonly && !isDispatched && (isDirector || inDivision);
  // Decide/resume block: SPV/Lead divisi atau Director SAJA.
  const canDecideBlock = !isODonly && !isDispatched && (isDirector || isLeadOfDivision);
  // Request block: staff/lead divisi, owning AM, atau Director (AM boleh — beda dari execute).
  const canRequestBlock =
    !isODonly && !isDispatched && (isDirector || inDivision || isAM);

  // PIC candidates = active STAFF of the task's own division, i.e. exactly what
  // `task.validatePicForDivision` accepts (§2 Rule 1). Only fetched once the
  // division is known and only for the role that may assign, so the request is
  // never fired for a control that is not rendered.
  const {
    employees: picCandidates,
    loading: picLoading,
    error: picLoadError,
  } = useAssignableEmployees(taskDivision, LEVEL_STAFF, canDecideBlock && taskDivision !== '');

  async function runTransition(
    fn: () => Promise<{ From: string; To: string }>,
    okLabel: string,
  ) {
    setTransitionError(null);
    setTransitionMessage(null);
    setTransitionSubmitting(true);
    try {
      const res = await fn();
      setTransitionMessage(`${okLabel}: ${res.From} → ${res.To}`);
      await load();
      await loadMetrics();
    } catch (err) {
      setTransitionError(errorMessage(err));
    } finally {
      setTransitionSubmitting(false);
    }
  }

  function handleStart() {
    runTransition(() => startTask(source, id), 'Task dimulai');
  }

  function handleSubmit() {
    if (source === 'asset') {
      const link = window.prompt('Link output hasil kerja (wajib untuk submit Asset):');
      if (!link) return; // batal / kosong
      runTransition(() => submitTask(source, id, link), 'Task disubmit');
      return;
    }
    runTransition(() => submitTask(source, id), 'Task disubmit');
  }

  function handleRework() {
    runTransition(() => reworkTask(source, id), 'Task dikerjakan ulang');
  }

  function handleResume() {
    if (!window.confirm('Lanjutkan task ini dari status [Blocked] ke [In Progress]?')) return;
    runTransition(() => resumeTask(source, id), 'Task dilanjutkan');
  }

  async function handleRequestBlock() {
    const reason = window.prompt('Alasan permintaan block task ini:');
    if (!reason) return;
    setBlockError(null);
    setBlockMessage(null);
    setBlockSubmitting(true);
    try {
      await requestBlock(source, id, reason);
      setBlockMessage(
        'Permintaan block dikirim. Menunggu keputusan SPV/Lead di antrian block-request.',
      );
      await load();
    } catch (err) {
      setBlockError(errorMessage(err));
    } finally {
      setBlockSubmitting(false);
    }
  }

  async function handleAssignPic(e: FormEvent) {
    e.preventDefault();
    setPicError(null);
    setPicMessage(null);
    setPicSubmitting(true);
    try {
      const res = await assignPIC(source, id, picInput);
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
      const res = await setSLA(source, id, Number(slaInput));
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
      const res = await setRevisionSLA(id, Number(revSlaInput));
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

  if (loadError || !entity) {
    return (
      <div className="stack">
        <Link href="/tasks" className="muted">&larr; Kembali ke Task Execution</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Task tidak ditemukan.'}</div>
      </div>
    );
  }

  const showStart = canExecute && status === '[To Do]';
  const showSubmit = canExecute && status === '[In Progress]';
  const showRework = canExecute && status === '[Revision Requested]';
  const showResume = canDecideBlock && status === '[Blocked]';
  const showRequestBlock = canRequestBlock && status === '[In Progress]';
  const hasAnyExecutionAction = showStart || showSubmit || showRework || showResume || showRequestBlock;

  return (
    <div className="stack">
      <div>
        <Link href="/tasks" className="muted">&larr; Kembali ke Task Execution</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{entity.id}</h1>
          <p className="muted">
            {source === 'asset' ? 'Creative Asset' : 'Brief-as-task'}
            {source === 'asset' && asset && (
              <>
                {' '}&middot; Brief:{' '}
                <Link href={`/tasks/${asset.brief_id}`}>{asset.brief_id}</Link>
              </>
            )}
            {taskDivision && <> &middot; Divisi: {taskDivision}</>}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {revisionFlagged && <span className="badge badge-purple">Quality Flag</span>}
          <StatusBadge status={status} />
        </div>
      </div>

      {isDispatched && (
        <div className="alert alertInfo" role="status">
          Brief ini di-dispatch ke vendor (Live Stream) &mdash; bukan task yang dieksekusi lewat mesin M12.
        </div>
      )}

      {/* Ringkasan entity */}
      <section className="card">
        <div className="grid2">
          {source === 'asset' && asset ? (
            <>
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
                <div className="muted" style={{ fontSize: 12 }}>Jam Tercatat</div>
                <div>{formatHours(asset.hours_logged)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Dibuat</div>
                <div>{formatDateTime(asset.created_at)}</div>
              </div>
            </>
          ) : brief ? (
            <>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Judul</div>
                <div>{brief.title}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Deliverable</div>
                <div>{brief.deliverable_type || '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>PIC</div>
                <div>{assignedPic || '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Prioritas</div>
                <div>{brief.priority || '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Jatuh Tempo</div>
                <div>{brief.due_date || '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Target Kuantitas</div>
                <div>{brief.quantity_target}</div>
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* Metrik computed (read-only) */}
      <section className="card">
        <div className="cardHeader">
          <h2>Metrik (read-only)</h2>
        </div>
        {metricsError && <div className="alert alertError" role="alert">{metricsError}</div>}
        {metrics && (
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>SLA Target</div>
              <div>{formatSLA(metrics.sla_target_hours)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Turnaround</div>
              <div>{formatHours(metrics.turnaround_hours)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Speed Score</div>
              <div>{metrics.speed_score_display}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Revision Count</div>
              <div>
                {metrics.revision_count}
                {metrics.revision_flagged && (
                  <span className="badge badge-purple" style={{ marginLeft: 6 }}>Quality Flag</span>
                )}
              </div>
            </div>
            {source === 'asset' && (
              <>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>SLA Revisi</div>
                  <div>{formatSLA(metrics.revision_sla_target_hours)}</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Turnaround Revisi</div>
                  <div>{formatHours(metrics.revision_turnaround_hours)}</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Speed Score Revisi</div>
                  <div>{metrics.revision_speed_score_display}</div>
                </div>
              </>
            )}
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

      {/* Aksi eksekusi */}
      <section className="card">
        <div className="cardHeader">
          <h2>Aksi Eksekusi</h2>
        </div>
        {transitionError && <div className="alert alertError" role="alert">{transitionError}</div>}
        {transitionMessage && <div className="alert alertSuccess" role="status">{transitionMessage}</div>}
        {blockError && <div className="alert alertError" role="alert">{blockError}</div>}
        {blockMessage && <div className="alert alertSuccess" role="status">{blockMessage}</div>}

        {hasAnyExecutionAction ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {showStart && (
              <button type="button" className="btn btnPrimary" disabled={transitionSubmitting} onClick={handleStart}>
                {transitionSubmitting ? 'Memproses...' : 'Mulai Kerjakan'}
              </button>
            )}
            {showSubmit && (
              <button type="button" className="btn btnPrimary" disabled={transitionSubmitting} onClick={handleSubmit}>
                {transitionSubmitting ? 'Memproses...' : 'Submit'}
              </button>
            )}
            {showRework && (
              <button type="button" className="btn btnPrimary" disabled={transitionSubmitting} onClick={handleRework}>
                {transitionSubmitting ? 'Memproses...' : 'Kerjakan Ulang (Rework)'}
              </button>
            )}
            {showResume && (
              <button type="button" className="btn btnSecondary" disabled={transitionSubmitting} onClick={handleResume}>
                {transitionSubmitting ? 'Memproses...' : 'Lanjutkan dari Blocked'}
              </button>
            )}
            {showRequestBlock && (
              <button type="button" className="btn btnDanger" disabled={blockSubmitting} onClick={handleRequestBlock}>
                {blockSubmitting ? 'Memproses...' : 'Ajukan Block'}
              </button>
            )}
          </div>
        ) : (
          <p className="muted">
            Tidak ada aksi eksekusi yang tersedia untuk Anda pada status ini.
            {status === '[Submitted]' || status === '[In Review]'
              ? ' Menunggu review oleh Account Manager.'
              : ''}
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Status hanya berubah lewat aksi bernama di atas &mdash; keputusan akhir tetap ditegakkan server.
          Untuk menyetujui/menolak permintaan block, lihat{' '}
          <Link href="/tasks/block-requests">Antrian Block-Request</Link> (SPV/Lead).
        </p>
      </section>

      {/* Kelola SPV/Lead */}
      {canDecideBlock && (
        <section className="card">
          <div className="cardHeader">
            <h2>Kelola Task (SPV/Lead)</h2>
          </div>

          <form className="form" onSubmit={handleAssignPic}>
            {picError && <div className="alert alertError" role="alert">{picError}</div>}
            {picMessage && <div className="alert alertSuccess" role="status">{picMessage}</div>}
            <div className="formRow">
              <EmployeePicker
                id="pic-input"
                label={`Tetapkan PIC${taskDivision ? ` (staff divisi ${taskDivision})` : ''}`}
                required
                employees={picCandidates}
                loading={picLoading}
                error={picLoadError}
                value={picInput}
                onChange={setPicInput}
                emptyHint={`Belum ada staff aktif di divisi ${taskDivision || 'tujuan'} yang bisa ditetapkan sebagai PIC.`}
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
                  min="0"
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

          {source === 'asset' && (
            <form className="form" onSubmit={handleSetRevSla} style={{ marginTop: 14 }}>
              {revSlaError && <div className="alert alertError" role="alert">{revSlaError}</div>}
              {revSlaMessage && <div className="alert alertSuccess" role="status">{revSlaMessage}</div>}
              <div className="formRow">
                <div className="field">
                  <label htmlFor="rev-sla-input">Target SLA Revisi (jam, khusus Asset)</label>
                  <input
                    id="rev-sla-input"
                    type="number"
                    min="0"
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
          )}
        </section>
      )}

      {/* Breakdown Asset (Creative Brief) */}
      {source === 'brief' && assets.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>Asset (Creative)</h2>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Rework/eksekusi Creative dilakukan per-Asset, bukan di level Brief.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tipe</th>
                  <th>Urutan</th>
                  <th>PIC</th>
                  <th>Status</th>
                  <th>Revisi</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td><Link href={`/tasks/${a.id}`}>{a.id}</Link></td>
                    <td>{a.asset_type || '—'}</td>
                    <td>{a.sequence_no}</td>
                    <td>{a.assigned_pic || '—'}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td>{a.revision_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
