'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAccountLead, isAccountStaff } from '@/lib/account';
import {
  PRASYARAT_LABELS,
  VERDICT_LABELS,
  createInterview,
  formatDurasiMenit,
  interviewStatusTone,
  listInterviewsByClient,
  risetAwalStatusTone,
  verdictTone,
  type InterviewListRow,
} from '@/lib/interview';
import {
  EDITABLE_FIELDS,
  PAYMENT_INTENT_OPTIONS,
  editClient,
  getClient,
  requestHoldService,
  approveHoldService,
  rejectHoldService,
  resumeService,
  setPaymentIntent,
  voidService,
  type Client,
  type FieldChange,
} from '@/lib/clients';
import StatusBadge from '@/components/StatusBadge';
import {
  createMilestone,
  listMilestones,
  transitionMilestone,
  MILESTONE_UPCOMING,
  MILESTONE_DONE,
  MILESTONE_CANCELLED,
  type Milestone,
} from '@/lib/milestone';
import { getBoard, UNIVERSAL_COLUMNS, type Card } from '@/lib/board';
import BoardCard from '../../board/BoardCard';

const VOIDED_STATUS = '[Cancelled — Service Voided]';
const ON_HOLD_STATUS = '[On Hold]';
const HOLD_REQUESTED_STATUS = '[Hold Requested]';
const IN_EXECUTION_STATUS = '[In Execution]';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { role } = useAuth();
  // The Service hub (§4/§5) is an Account-division page — `account.getService`
  // admits the owning AM, Account lead, OD and Director. Sales/Finance read this
  // client record too, and a link that 403s for them is worse than no link.
  const canOpenServiceHub =
    isAccountStaff(role) || isAccountLead(role) || !!role?.od || !!role?.director;
  // "Kelola Klien" (Interview) is a write action: only the assigned AM, an
  // Account lead, or a Director may open an interview (mirrors canWriteInterview).
  const canManageInterview = isAccountStaff(role) || isAccountLead(role) || !!role?.director;

  const [creatingInterview, setCreatingInterview] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  // The client's interview log — so a saved interview can be reopened instead of
  // only ever created anew (which would duplicate it). Account-scope read.
  const [interviews, setInterviews] = useState<InterviewListRow[]>([]);
  const [interviewsError, setInterviewsError] = useState<string | null>(null);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Void Service
  const [voidPendingId, setVoidPendingId] = useState<string | null>(null);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidMessage, setVoidMessage] = useState<string | null>(null);

  // Hold Service two-step (T-2b / RM-2). AM (owner) / lead / Director may REQUEST;
  // Head of Account (lead) / Director APPROVE / REJECT / RESUME. Server is final
  // (owner check for a requesting staff AM happens there).
  const canRequestHold = isAccountStaff(role) || isAccountLead(role) || !!role?.director;
  const canApproveHold = isAccountLead(role) || !!role?.director;
  const [holdPendingId, setHoldPendingId] = useState<string | null>(null);

  // Payment Intent
  const [intentChoice, setIntentChoice] = useState<string>('');
  const [intentSubmitting, setIntentSubmitting] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [intentMessage, setIntentMessage] = useState<string | null>(null);

  // Koreksi field
  const [correctionField, setCorrectionField] = useState<string>(EDITABLE_FIELDS[0].field);
  const [correctionValue, setCorrectionValue] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionResult, setCorrectionResult] = useState<FieldChange[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getClient(id);
      setClient(res.client);
      if (res.client.payment_intent) {
        setIntentChoice(res.client.payment_intent);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  // The interview log is Account-scope; a Sales/Finance viewer of this record is
  // denied (403). Load it separately so that denial never blanks the whole page —
  // the log simply stays empty for roles that may not read it.
  const loadInterviews = useCallback(async () => {
    if (!canManageInterview) return;
    setInterviewsError(null);
    try {
      const res = await listInterviewsByClient(id);
      setInterviews(res.data);
    } catch (err) {
      setInterviewsError(errorMessage(err));
    }
  }, [id, canManageInterview]);

  useEffect(() => {
    load();
    loadInterviews();
  }, [load, loadInterviews]);

  async function handleVoid(serviceId: string, serviceName: string) {
    if (!window.confirm(`Yakin ingin void service "${serviceName}"? Brief non-Approved akan ikut dibatalkan.`)) {
      return;
    }
    setVoidError(null);
    setVoidMessage(null);
    setVoidPendingId(serviceId);
    try {
      const res = await voidService(serviceId);
      setVoidMessage(
        `Service berhasil di-void. Brief dibatalkan: ${res.voided_briefs.length}, brief Approved dipertahankan: ${res.skipped_approved_briefs.length}.`,
      );
      await load();
    } catch (err) {
      setVoidError(errorMessage(err));
    } finally {
      setVoidPendingId(null);
    }
  }

  async function runHold(serviceId: string, fn: () => Promise<unknown>, ok: string) {
    setVoidError(null);
    setVoidMessage(null);
    setHoldPendingId(serviceId);
    try {
      await fn();
      setVoidMessage(ok);
      await load();
    } catch (err) {
      setVoidError(errorMessage(err));
    } finally {
      setHoldPendingId(null);
    }
  }

  async function handleRequestHold(serviceId: string, serviceName: string) {
    const reason = window.prompt(`Alasan ajukan hold service "${serviceName}"? (wajib)`);
    if (reason === null) return; // cancelled
    if (reason.trim() === '') {
      setVoidError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    await runHold(serviceId, () => requestHoldService(serviceId, reason), `Pengajuan hold "${serviceName}" dikirim — menunggu ACC Head of Account.`);
  }

  async function handleApproveHold(serviceId: string, serviceName: string) {
    if (!window.confirm(`Setujui pengajuan hold service "${serviceName}"?`)) return;
    await runHold(serviceId, () => approveHoldService(serviceId), `Hold "${serviceName}" disetujui (On Hold).`);
  }

  async function handleRejectHold(serviceId: string, serviceName: string) {
    const reason = window.prompt(`Alasan tolak hold "${serviceName}"? (opsional)`);
    if (reason === null) return; // cancelled
    await runHold(serviceId, () => rejectHoldService(serviceId, reason), `Pengajuan hold "${serviceName}" ditolak (kembali In Execution).`);
  }

  async function handleResume(serviceId: string, serviceName: string) {
    if (!window.confirm(`Lanjutkan (resume) service "${serviceName}" dari On Hold?`)) return;
    await runHold(serviceId, () => resumeService(serviceId), `Service "${serviceName}" dilanjutkan (In Execution).`);
  }

  async function handleSetIntent(e: FormEvent) {
    e.preventDefault();
    setIntentError(null);
    setIntentMessage(null);
    if (!intentChoice) return;
    setIntentSubmitting(true);
    try {
      const res = await setPaymentIntent(id, intentChoice);
      setClient(res.client);
      setIntentMessage('Payment Intent berhasil disimpan.');
    } catch (err) {
      setIntentError(errorMessage(err));
    } finally {
      setIntentSubmitting(false);
    }
  }

  async function handleCorrection(e: FormEvent) {
    e.preventDefault();
    setCorrectionError(null);
    setCorrectionResult(null);
    setCorrectionSubmitting(true);
    try {
      const res = await editClient(id, { [correctionField]: correctionValue });
      setCorrectionResult(res.changes);
      setCorrectionValue('');
      await load();
    } catch (err) {
      setCorrectionError(errorMessage(err));
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  async function handleOpenInterview() {
    // Opening Kelola Klien STARTS riset awal (langkah 1) — the server stamps the
    // clock. The call resumes an already-open session rather than starting a
    // second one, so coming back here does not reset that clock.
    if (!window.confirm('Buka Kelola Klien untuk klien ini? Riset awal mulai terhitung sejak sekarang.')) {
      return;
    }
    setInterviewError(null);
    setCreatingInterview(true);
    try {
      const detail = await createInterview({ client_id: id });
      router.push(`/account/interview/${detail.interview.id}`);
    } catch (err) {
      setInterviewError(errorMessage(err));
      setCreatingInterview(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !client) {
    return (
      <div className="stack">
        <Link href="/clients" className="muted">&larr; Kembali ke Klien</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Klien tidak ditemukan.'}</div>
      </div>
    );
  }

  const allocationTotalPct = client.sales_allocation.reduce((sum, a) => sum + a.basis_points, 0) / 100;

  return (
    <div className="stack">
      <div>
        <Link href="/clients" className="muted">&larr; Kembali ke Klien</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{client.toko}</h1>
          <p className="muted">{client.id}</p>
        </div>
        {client.released_to_account_at ? (
          <span className="badge badge-green">Released</span>
        ) : (
          <span className="badge badge-amber">Menunggu Finance</span>
        )}
      </div>

      {/* M11 Unified Board, folded into the Client Record (DECISIONS 2026-08-14).
          Placed high so this page reads project-first: one client → its full
          cross-division board plus the M4 record below. Self-fetching so a board
          error never blanks the record. */}
      <ClientBoardSection clientId={id} />

      <section className="card">
        <div className="cardHeader">
          <h2>Identitas &amp; Baseline</h2>
        </div>
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Nama PIC</div>
            <div>{client.nama_pic || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Toko</div>
            <div>{client.toko || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Kota</div>
            <div>{client.kota || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Link Toko</div>
            <div>{client.link_toko || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Kategori</div>
            <div>{client.kategori || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>GMV Baseline &middot; <span title="Koreksi: OD atau Director">🔒 OD/Director</span></div>
            <div>{client.gmv_baseline}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Target GMV &middot; <span title="Koreksi: Account atau Director">🔒 Account</span></div>
            <div>{client.target_gmv}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Marketing Budget &middot; <span title="Koreksi: Account atau Director">🔒 Account</span></div>
            <div>{client.marketing_budget ?? '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Total Sales &middot; <span title="Auto-calculated, tidak dapat diubah">🔒 read-only</span></div>
            <div>{client.total_sales}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Sales PIC &middot; <span title="Koreksi: Sales Lead atau Director">🔒 Sales Lead</span></div>
            <div>{client.sales_pic_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Commission &amp; Payment PIC &middot; <span title="Koreksi: Sales Lead atau Director">🔒 Sales Lead</span></div>
            <div>{client.commission_payment_pic_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Transaction ID</div>
            <div>
              {client.transaction_id ? (
                <Link href={`/finance/transactions/${client.transaction_id}`}>{client.transaction_id}</Link>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Platform</h2>
        </div>
        {client.platforms.length === 0 ? (
          <div className="emptyState">Belum ada platform.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Link Toko</th>
                  <th>Dikelola Sejak</th>
                  <th>Aktif</th>
                </tr>
              </thead>
              <tbody>
                {client.platforms.map((p, idx) => (
                  <tr key={`${p.platform}-${idx}`}>
                    <td>{p.platform}</td>
                    <td>{p.store_link || '—'}</td>
                    <td>{formatDate(p.managed_since)}</td>
                    <td>{p.active ? 'Aktif' : 'Nonaktif'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Sales Allocation</h2>
        </div>
        {client.sales_allocation.length === 0 ? (
          <div className="emptyState">Belum ada alokasi sales.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Salesperson</th>
                  <th>Persen</th>
                </tr>
              </thead>
              <tbody>
                {client.sales_allocation.map((a) => (
                  <tr key={a.salesperson_id}>
                    <td>{a.salesperson_id}</td>
                    <td>{(a.basis_points / 100).toFixed(2)}%</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Total</strong></td>
                  <td><strong>{allocationTotalPct.toFixed(2)}%</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Services</h2>
        </div>
        {voidError && <div className="alert alertError" role="alert">{voidError}</div>}
        {voidMessage && <div className="alert alertSuccess" role="status">{voidMessage}</div>}
        {/* The Service ID is not decoration: every M6 §4/§5 door is keyed by it
            (Strategy & Plan, Brief breakdown, the plan-flag override). It was in
            the payload all along but never rendered, so the AM had a status to
            look at and no way to act on it. */}
        {client.services.length === 0 ? (
          <div className="emptyState">Belum ada service.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Service ID</th>
                  <th>Nama</th>
                  <th>Harga Standar</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {client.services.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {canOpenServiceHub ? (
                        <Link href={`/account/services/${encodeURIComponent(s.id)}`}>{s.id}</Link>
                      ) : (
                        s.id
                      )}
                    </td>
                    <td>{s.name}</td>
                    <td>{s.standard_price}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        {canOpenServiceHub && s.status !== VOIDED_STATUS && (
                          <Link
                            href={`/account/services/${encodeURIComponent(s.id)}`}
                            className="btn btnPrimary btnSm"
                          >
                            Onboarding &amp; Brief
                          </Link>
                        )}
                        {canRequestHold && s.status === IN_EXECUTION_STATUS && (
                          <button
                            type="button"
                            className="btn btnSecondary btnSm"
                            disabled={holdPendingId !== null}
                            onClick={() => handleRequestHold(s.id, s.name)}
                          >
                            {holdPendingId === s.id ? 'Memproses...' : 'Ajukan Hold'}
                          </button>
                        )}
                        {s.status === HOLD_REQUESTED_STATUS && (
                          <>
                            <span className="badge badge-amber" title="Menunggu ACC Head of Account">Menunggu ACC</span>
                            {canApproveHold && (
                              <>
                                <button
                                  type="button"
                                  className="btn btnPrimary btnSm"
                                  disabled={holdPendingId !== null}
                                  onClick={() => handleApproveHold(s.id, s.name)}
                                >
                                  {holdPendingId === s.id ? '...' : 'Setujui Hold'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btnGhost btnSm"
                                  disabled={holdPendingId !== null}
                                  onClick={() => handleRejectHold(s.id, s.name)}
                                >
                                  {holdPendingId === s.id ? '...' : 'Tolak'}
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {canApproveHold && s.status === ON_HOLD_STATUS && (
                          <button
                            type="button"
                            className="btn btnPrimary btnSm"
                            disabled={holdPendingId !== null}
                            onClick={() => handleResume(s.id, s.name)}
                          >
                            {holdPendingId === s.id ? 'Memproses...' : 'Resume Service'}
                          </button>
                        )}
                        {s.status !== VOIDED_STATUS && (
                          <button
                            type="button"
                            className="btn btnDanger btnSm"
                            disabled={voidPendingId !== null}
                            onClick={() => handleVoid(s.id, s.name)}
                          >
                            {voidPendingId === s.id ? 'Memproses...' : 'Void Service'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManageInterview && (
        <section className="card" id="interview">
          <div className="cardHeader">
            <h2>Kelola Klien · Interview &amp; Kualifikasi</h2>
          </div>
          {interviewError && <div className="alert alertError" role="alert">{interviewError}</div>}
          {interviewsError && <div className="alert alertError" role="alert">{interviewsError}</div>}

          {/* Riwayat Kelola Klien — sessions with saved work: a submitted riset
              awal, a schedule, a started/submitted interview, or a cancellation
              (blank never-touched attempts are filtered server-side). A running
              riset awal is reached through the button below, which resumes. */}
          {interviews.length > 0 ? (
            <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Interview ID</th>
                    <th>Status</th>
                    <th>Riset awal</th>
                    <th>Verdict</th>
                    <th>Prasyarat</th>
                    <th>Dibuat</th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.map((iv) => (
                    <tr key={iv.id}>
                      <td>
                        <Link href={`/account/interview/${iv.id}`}>{iv.id}</Link>
                        {iv.versi_no > 1 && (
                          <span className="muted" style={{ fontSize: 12 }}> · v{iv.versi_no}</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${interviewStatusTone(iv.status)}`}>{iv.status}</span>
                      </td>
                      {/* Langkah 1 — the measured research step. `—` while it is
                          still running: an unfinished step has no duration yet. */}
                      <td>
                        {iv.riset_awal_status ? (
                          <>
                            <span className={`badge badge-${risetAwalStatusTone(iv.riset_awal_status)}`}>
                              {iv.riset_awal_status}
                            </span>{' '}
                            <span className="muted" style={{ fontSize: 12 }}>
                              {formatDurasiMenit(iv.riset_awal_durasi_menit)}
                            </span>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {iv.verdict ? (
                          <span className={`badge badge-${verdictTone(iv.verdict)}`}>
                            {VERDICT_LABELS[iv.verdict] ?? iv.verdict}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {iv.prasyarat_status ? (PRASYARAT_LABELS[iv.prasyarat_status] ?? iv.prasyarat_status) : '—'}
                      </td>
                      <td>{formatDate(iv.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              Belum ada sesi Kelola Klien yang tercatat untuk klien ini. Gunakan tombol di bawah untuk
              membukanya — riset awal langsung mulai terhitung, dan sesi muncul di sini begitu riset awal
              disubmit, jadwal diisi, atau interview dimulai.
            </p>
          )}

          <button type="button" className="btn btnPrimary" disabled={creatingInterview} onClick={handleOpenInterview}>
            {creatingInterview ? 'Membuka…' : 'Kelola Klien (mulai riset awal)'}
          </button>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Payment Intent</h2>
        </div>
        <p className="muted">
          Nilai saat ini:{' '}
          {client.payment_intent ? <span className="badge badge-blue">{client.payment_intent}</span> : '—'}
        </p>
        <form className="form" onSubmit={handleSetIntent}>
          {intentError && <div className="alert alertError" role="alert">{intentError}</div>}
          {intentMessage && <div className="alert alertSuccess" role="status">{intentMessage}</div>}
          <div className="stack" style={{ gap: 6 }}>
            {PAYMENT_INTENT_OPTIONS.map((opt) => (
              <label key={opt} className="row" style={{ gap: 8, fontSize: 13 }}>
                <input
                  type="radio"
                  name="payment_intent"
                  value={opt}
                  checked={intentChoice === opt}
                  onChange={() => setIntentChoice(opt)}
                />
                {opt}
              </label>
            ))}
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={intentSubmitting || !intentChoice}>
              {intentSubmitting ? 'Menyimpan...' : 'Simpan Payment Intent'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Koreksi Field</h2>
        </div>
        <form className="form" onSubmit={handleCorrection}>
          {correctionError && <div className="alert alertError" role="alert">{correctionError}</div>}
          {correctionResult && correctionResult.length > 0 && (
            <div className="alert alertSuccess" role="status">
              {correctionResult.map((c) => (
                <div key={c.field}>
                  {c.field}: {c.before || '—'} &rarr; {c.after || '—'}
                </div>
              ))}
            </div>
          )}
          <div className="formRow">
            <div className="field">
              <label htmlFor="correction-field">Field</label>
              <select
                id="correction-field"
                value={correctionField}
                onChange={(e) => setCorrectionField(e.target.value)}
              >
                {EDITABLE_FIELDS.map((f) => (
                  <option key={f.field} value={f.field}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="correction-value">Nilai Baru</label>
              <input
                id="correction-value"
                required
                value={correctionValue}
                onChange={(e) => setCorrectionValue(e.target.value)}
              />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={correctionSubmitting}>
              {correctionSubmitting ? 'Menyimpan...' : 'Simpan Koreksi'}
            </button>
          </div>
        </form>
      </section>

      {/* T-4c (RM-11) — Upcoming Milestones terstruktur */}
      <MilestonesSection clientId={id} canManage={canRequestHold} />
    </div>
  );
}

/**
 * MilestonesSection — T-4c / RM-11 Upcoming Milestones. Self-contained (fetches
 * its own list) so it never complicates the client page's main load. canManage
 * mirrors the server gate (Account any level / Director); OD is read-only.
 */
function MilestonesSection({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const [rows, setRows] = useState<Milestone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listMilestones(clientId);
      setRows(res.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (title.trim() === '' || targetDate === '') {
      setError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createMilestone(clientId, title.trim(), targetDate);
      setTitle('');
      setTargetDate('');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, to: string) {
    setBusy(true);
    setError(null);
    try {
      await transitionMilestone(id, to);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Upcoming Milestones</h2>
      <p className="muted" style={{ marginBottom: '12px' }}>
        Tonggak yang akan datang untuk klien ini (judul + tanggal target). Ditandai selesai atau dibatalkan.
      </p>
      {error && <div className="alert alertError" role="alert">{error}</div>}

      {rows === null ? (
        <p className="muted">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="muted">Belum ada milestone.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tonggak</th>
                <th>Tanggal Target</th>
                <th>Status</th>
                {canManage && <th style={{ textAlign: 'center' }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.title}</td>
                  <td>{m.target_date}</td>
                  <td>
                    <span
                      className={`badge ${
                        m.status === MILESTONE_DONE ? 'badge-green' : m.status === MILESTONE_CANCELLED ? 'badge-red' : 'badge-amber'
                      }`}
                    >
                      {m.status}
                    </span>
                  </td>
                  {canManage && (
                    <td style={{ textAlign: 'center' }}>
                      {m.status === MILESTONE_UPCOMING ? (
                        <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
                          <button className="btn btnPrimary btnSm" disabled={busy} onClick={() => move(m.id, MILESTONE_DONE)}>
                            Selesai
                          </button>
                          <button className="btn btnGhost btnSm" disabled={busy} onClick={() => move(m.id, MILESTONE_CANCELLED)}>
                            Batalkan
                          </button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <form onSubmit={add} className="form" style={{ marginTop: '16px' }}>
          <div className="formRow">
            <div className="field">
              <label htmlFor="mls-title">Tonggak baru</label>
              <input id="mls-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Launch campaign Ramadhan" />
            </div>
            <div className="field">
              <label htmlFor="mls-date">Tanggal Target</label>
              <input id="mls-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={busy}>
              {busy ? 'Menyimpan...' : 'Tambah Milestone'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * ClientBoardSection — M11 Unified Board, folded into the Client Record
 * (DECISIONS 2026-08-14 "board merge"). The standalone /board picker page is
 * retired: its only job was resolving a Client id, which the roster already
 * does, so the board now renders here with the client already in context.
 *
 * Self-fetching (like MilestonesSection) so a board error never blanks the
 * record. Division/PIC/overdue filters are client-side — backend GET /board
 * accepts only `client=` (M11 brief §5 "TIDAK TERSEDIA"), so they narrow the
 * already-fetched set, mirroring the retired board page's behaviour exactly.
 */
function ClientBoardSection({ clientId }: { clientId: string }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterDivision, setFilterDivision] = useState('');
  const [filterPic, setFilterPic] = useState('');
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getBoard(clientId);
      setCards(res.data);
    } catch (err) {
      setError(errorMessage(err));
      setCards(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredCards = cards
    ? cards.filter((c) => {
        if (filterDivision && c.division !== filterDivision) return false;
        if (filterPic && !(c.pic ?? '').toLowerCase().includes(filterPic.trim().toLowerCase())) return false;
        if (filterOverdueOnly && !c.overdue) return false;
        return true;
      })
    : null;

  const knownColumns: readonly string[] = UNIVERSAL_COLUMNS;
  const extraColumns = filteredCards
    ? Array.from(new Set(filteredCards.map((c) => c.universal_column))).filter((c) => !knownColumns.includes(c))
    : [];
  const columns = [...UNIVERSAL_COLUMNS, ...extraColumns];
  const divisionOptions = cards ? Array.from(new Set(cards.map((c) => c.division))).sort() : [];

  return (
    <section className="card" id="board">
      <div className="cardHeader">
        <h2>Unified Board &middot; Proyek Lintas Divisi</h2>
        <button type="button" className="btn btnSecondary btnSm" disabled={loading} onClick={() => load()}>
          {loading ? 'Memuat...' : 'Refresh'}
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Semua Brief/Asset/Booking/Session klien ini (M11), dipetakan ke Universal Column dari status native
        tiap modul (Creative/Ads/KOL/Live Stream).
      </p>

      {cards && cards.length > 0 && (
        <div className="formRow">
          <div className="field">
            <label htmlFor="cb-filter-division">Divisi</label>
            <select id="cb-filter-division" value={filterDivision} onChange={(e) => setFilterDivision(e.target.value)}>
              <option value="">Semua Divisi</option>
              {divisionOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cb-filter-pic">PIC</label>
            <input
              id="cb-filter-pic"
              placeholder="Filter PIC..."
              value={filterPic}
              onChange={(e) => setFilterPic(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cb-filter-overdue">Overdue</label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>
              <input
                id="cb-filter-overdue"
                type="checkbox"
                checked={filterOverdueOnly}
                onChange={(e) => setFilterOverdueOnly(e.target.checked)}
              />
              Hanya yang overdue
            </label>
          </div>
        </div>
      )}

      {loading && <p className="muted">Memuat board...</p>}
      {error && <div className="alert alertError" role="alert">{error}</div>}
      {!loading && !error && filteredCards && filteredCards.length === 0 && (
        <div className="emptyState">
          {cards && cards.length > 0
            ? 'Tidak ada Brief yang cocok dengan filter ini.'
            : 'Belum ada Brief untuk klien ini.'}
        </div>
      )}
      {!loading && !error && filteredCards && filteredCards.length > 0 && (
        <div className="table-wrap" style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'flex-start' }}>
          {columns.map((col) => {
            const colCards = filteredCards.filter((c) => c.universal_column === col);
            return (
              <div key={col} style={{ flex: '0 0 260px', minWidth: 260 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>{col}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{colCards.length}</span>
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  {colCards.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12 }}>&mdash;</div>
                  ) : (
                    colCards.map((c) => <BoardCard key={`${c.type}-${c.id}`} card={c} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
