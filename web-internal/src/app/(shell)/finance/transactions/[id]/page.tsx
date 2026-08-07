'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import {
  SCHEME_OPTIONS,
  approveSchemeChange,
  cancelSchemeChange,
  createSchedule,
  flagBermasalah,
  getBermasalah,
  getTransaction,
  idrToInput,
  listSchemeChangeRequests,
  rejectSchemeChange,
  requestSchemeChange,
  scheduleOutstanding,
  verify,
  voteBermasalah,
  type BermasalahStatus,
  type SchemeChangeRequest,
  type Transaction,
} from '@/lib/finance';
import { useAuth } from '@/lib/auth-context';
import StatusBadge from '@/components/StatusBadge';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID');
}

/** Today in the local calendar as YYYY-MM-DD, for `<input type="date">`. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface ScheduleRow {
  amount: string;
  due_date: string;
}

/** Schemes that carry an installment schedule from the start (M5 §4). */
const SCHEDULED_SCHEMES = new Set(['[Termin]', '[Bayar di Belakang]']);
const INST_TERVERIFIKASI = '[Terverifikasi]';
const PAYMENT_LUNAS = '[Lunas]';

/** Label Bahasa Indonesia untuk status pengajuan perubahan (M5-OA-7). */
const CHANGE_STATUS_LABEL: Record<SchemeChangeRequest['status'], string> = {
  pending: 'Menunggu ACC Direktur',
  approved: 'Disetujui Direktur',
  rejected: 'Ditolak Direktur',
  cancelled: 'Dibatalkan Pengaju',
};

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { employee, role } = useAuth();

  const [trx, setTrx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [bermasalah, setBermasalah] = useState<BermasalahStatus | null>(null);
  const [bermasalahError, setBermasalahError] = useState<string | null>(null);

  // Verifikasi (the contract link lives in this form — see handleVerify)
  const [verifyInstallmentId, setVerifyInstallmentId] = useState('');
  const [verifyAmount, setVerifyAmount] = useState('');
  const [verifyDate, setVerifyDate] = useState(today());
  const [verifyProof, setVerifyProof] = useState('');
  const [contractLink, setContractLink] = useState(''); // submitted with the verification
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  // Jadwal Termin
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([{ amount: '', due_date: '' }]);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Jadwal penagihan kekurangan (M5 §6)
  const [outstandingRows, setOutstandingRows] = useState<ScheduleRow[]>([{ amount: '', due_date: '' }]);
  const [outstandingTouched, setOutstandingTouched] = useState(false);
  const [outstandingSubmitting, setOutstandingSubmitting] = useState(false);
  const [outstandingError, setOutstandingError] = useState<string | null>(null);
  const [outstandingMessage, setOutstandingMessage] = useState<string | null>(null);

  // Ubah Transaksi — diajukan Finance, di-ACC Direktur (M5-OA-7)
  const [schemeChoice, setSchemeChoice] = useState<string>(SCHEME_OPTIONS[0]);
  const [schemeReason, setSchemeReason] = useState('');
  const [schemeRows, setSchemeRows] = useState<ScheduleRow[]>([{ amount: '', due_date: '' }]);
  const [schemeSubmitting, setSchemeSubmitting] = useState(false);
  const [schemeError, setSchemeError] = useState<string | null>(null);
  const [schemeMessage, setSchemeMessage] = useState<string | null>(null);
  const [changeRequests, setChangeRequests] = useState<SchemeChangeRequest[]>([]);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // [Bermasalah]
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [voteDecision, setVoteDecision] = useState<'setuju' | 'tolak'>('setuju');
  const [voteNote, setVoteNote] = useState('');
  const [voteSubmitting, setVoteSubmitting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getTransaction(id);
      const t = res.transaction;
      setTrx(t);
      setContractLink(t.contract_attachment || '');
      // The installment being verified is never a free choice: it is whichever
      // rows are still open. Selecting a settled one could only ever be rejected.
      const open = t.installments.filter((i) => i.status !== INST_TERVERIFIKASI);
      setVerifyInstallmentId((current) =>
        open.some((i) => i.id === current) ? current : (open[0]?.id ?? ''),
      );
      // The shortfall schedule must sum EXACTLY to Amount Outstanding, so seed one
      // row with it — the common case is a single follow-up collection date. Only
      // while untouched: re-seeding after every reload would overwrite a split the
      // user is halfway through typing.
      setOutstandingRows((rows) =>
        outstandingTouched ? rows : [{ amount: idrToInput(t.amount_outstanding), due_date: rows[0]?.due_date ?? '' }],
      );
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, outstandingTouched]);

  const loadChangeRequests = useCallback(async () => {
    try {
      const res = await listSchemeChangeRequests(id);
      setChangeRequests(res.data);
    } catch (err) {
      // The filing panel is secondary to the money on this page: surface the
      // error inside its own card rather than blanking the transaction.
      setSchemeError(errorMessage(err));
    }
  }, [id]);

  const loadBermasalah = useCallback(async () => {
    setBermasalahError(null);
    try {
      const res = await getBermasalah(id);
      setBermasalah(res);
    } catch (err) {
      setBermasalahError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadBermasalah();
    loadChangeRequests();
  }, [load, loadBermasalah, loadChangeRequests]);

  /**
   * One submit carries the payment AND the contract link (M5 §7 Rule 1): the
   * contract is the hard gate before [Lunas] (§7 Rule 2), so keeping it behind its
   * own button meant the verification that trips the gate failed with nothing on
   * screen connecting the two. The API attaches it in the same DB transaction.
   */
  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setVerifyError(null);
    setVerifyMessage(null);
    setVerifySubmitting(true);
    try {
      await verify(id, {
        installment_id: verifyInstallmentId,
        amount: verifyAmount,
        received_date: verifyDate,
        proof_of_payment: verifyProof,
        contract_attachment: contractLink,
      });
      setVerifyMessage('Verifikasi berhasil disimpan.');
      setVerifyAmount('');
      setVerifyProof('');
      // Re-read instead of trusting the response body: a partial payment can
      // leave an installment open, change which row is next, and change what the
      // shortfall card should prefill.
      await load();
    } catch (err) {
      setVerifyError(errorMessage(err));
    } finally {
      setVerifySubmitting(false);
    }
  }

  function addScheduleRow() {
    setScheduleRows((rows) => [...rows, { amount: '', due_date: '' }]);
  }

  function removeScheduleRow(idx: number) {
    setScheduleRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function updateScheduleRow(idx: number, field: keyof ScheduleRow, value: string) {
    setScheduleRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  async function handleSchedule(e: FormEvent) {
    e.preventDefault();
    setScheduleError(null);
    setScheduleSubmitting(true);
    try {
      await createSchedule(id, scheduleRows);
      await load();
    } catch (err) {
      setScheduleError(errorMessage(err));
    } finally {
      setScheduleSubmitting(false);
    }
  }

  function addOutstandingRow() {
    setOutstandingTouched(true);
    setOutstandingRows((rows) => [...rows, { amount: '', due_date: '' }]);
  }

  function removeOutstandingRow(idx: number) {
    setOutstandingTouched(true);
    setOutstandingRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function updateOutstandingRow(idx: number, field: keyof ScheduleRow, value: string) {
    setOutstandingTouched(true);
    setOutstandingRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  async function handleOutstandingSchedule(e: FormEvent) {
    e.preventDefault();
    setOutstandingError(null);
    setOutstandingMessage(null);
    setOutstandingSubmitting(true);
    try {
      await scheduleOutstanding(id, outstandingRows);
      setOutstandingMessage('Jadwal penagihan kekurangan berhasil disimpan.');
      setOutstandingTouched(false);
      await load();
    } catch (err) {
      setOutstandingError(errorMessage(err));
    } finally {
      setOutstandingSubmitting(false);
    }
  }

  function addSchemeRow() {
    setSchemeRows((rows) => [...rows, { amount: '', due_date: '' }]);
  }

  function removeSchemeRow(idx: number) {
    setSchemeRows((rows) => rows.filter((_, i) => i !== idx));
  }

  function updateSchemeRow(idx: number, field: keyof ScheduleRow, value: string) {
    setSchemeRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  /**
   * Files the change (M5-OA-7). For SPV/Head Finance this only queues it — the
   * transaction does not move until a Director approves, which is why the
   * success message says so instead of "berhasil diubah". A Director filing is
   * applied on the spot, so the answer distinguishes the two.
   */
  async function handleScheme(e: FormEvent) {
    e.preventDefault();
    setSchemeError(null);
    setSchemeMessage(null);
    setSchemeSubmitting(true);
    try {
      const res = await requestSchemeChange(id, {
        payment_intent_scheme: schemeChoice,
        reason: schemeReason,
        // A scheme without instalments must carry an EMPTY schedule — sending
        // half-typed rows would be rejected as incomplete data.
        installments: SCHEDULED_SCHEMES.has(schemeChoice) ? schemeRows : [],
      });
      setSchemeMessage(
        res.request.status === 'approved'
          ? 'Perubahan diterapkan (ACC Direktur).'
          : `Pengajuan ${res.request.id} tersimpan dan menunggu persetujuan Direktur. Transaksi belum berubah.`,
      );
      setSchemeReason('');
      setSchemeRows([{ amount: '', due_date: '' }]);
      await Promise.all([load(), loadChangeRequests()]);
    } catch (err) {
      setSchemeError(errorMessage(err));
    } finally {
      setSchemeSubmitting(false);
    }
  }

  /** The Director's verdict, or the requester withdrawing their own filing. */
  async function handleDecision(reqId: string, action: 'approve' | 'reject' | 'cancel') {
    setDecisionError(null);
    setSchemeMessage(null);
    setDecisionSubmitting(true);
    try {
      if (action === 'approve') await approveSchemeChange(reqId, decisionNote);
      else if (action === 'reject') await rejectSchemeChange(reqId, decisionNote);
      else await cancelSchemeChange(reqId);
      setDecisionNote('');
      await Promise.all([load(), loadChangeRequests()]);
    } catch (err) {
      setDecisionError(errorMessage(err));
    } finally {
      setDecisionSubmitting(false);
    }
  }

  async function handleFlag() {
    const reason = window.prompt('Alasan menandai transaksi ini [Bermasalah]:');
    if (!reason) return;
    setFlagError(null);
    setFlagSubmitting(true);
    try {
      await flagBermasalah(id, reason);
      await loadBermasalah();
      await load();
    } catch (err) {
      setFlagError(errorMessage(err));
    } finally {
      setFlagSubmitting(false);
    }
  }

  async function handleVote(e: FormEvent) {
    e.preventDefault();
    setVoteError(null);
    setVoteSubmitting(true);
    try {
      const res = await voteBermasalah(id, voteDecision, voteNote);
      setBermasalah(res);
      setVoteNote('');
      await load();
    } catch (err) {
      setVoteError(errorMessage(err));
    } finally {
      setVoteSubmitting(false);
    }
  }

  if (loading && !trx) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !trx) {
    return (
      <div className="stack">
        <Link href="/finance" className="muted">&larr; Kembali ke Finance</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Transaksi tidak ditemukan.'}</div>
      </div>
    );
  }

  // Which schedule surface applies. `[Termin]`/`[Bayar di Belakang]` need their
  // ORIGINAL schedule (Σ = agreed total) while it is missing; everything else with
  // money still owed and no open row gets the shortfall schedule (Σ = outstanding).
  const openInstallments = trx.installments.filter((i) => i.status !== INST_TERVERIFIKASI);
  const needsOriginalSchedule =
    SCHEDULED_SCHEMES.has(trx.payment_intent_scheme) && trx.installments.length === 0;
  const canScheduleOutstanding =
    !needsOriginalSchedule && trx.payment_status !== PAYMENT_LUNAS && openInstallments.length === 0;

  // Transaction change (M5-OA-7). Role checks here only decide what is OFFERED —
  // the server owns the gate, and a hidden button is not a permission.
  const pendingChange = changeRequests.find((r) => r.status === 'pending') ?? null;
  const decidedChanges = changeRequests.filter((r) => r.status !== 'pending');
  const canRequestChange = !!role && (role.director || (role.division === 'Finance' && role.level === 'lead'));
  const canDecide = !!role?.director;
  const canCancelChange =
    !!pendingChange && !!employee && pendingChange.requested_by === employee.employee_id;

  return (
    <div className="stack">
      <div>
        <Link href="/finance" className="muted">&larr; Kembali ke Finance</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{trx.id}</h1>
          <p className="muted">
            Klien: <Link href={`/clients/${trx.client_id}`}>{trx.client_id}</Link>
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {trx.bermasalah && <span className="badge badge-red">[Bermasalah]</span>}
          <StatusBadge status={trx.payment_status} />
        </div>
      </div>

      <section className="card">
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Skema</div>
            <div>{trx.payment_intent_scheme || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Total</div>
            <div>{trx.total_agreed_value}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Amount Verified</div>
            <div>{trx.amount_verified}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Amount Outstanding</div>
            <div>{trx.amount_outstanding}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Kontrak</div>
            <div>
              {trx.contract_attachment ? (
                <a href={trx.contract_attachment} target="_blank" rel="noreferrer">Lihat Kontrak</a>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dirilis ke Account</div>
            <div>{formatDate(trx.released_to_account_at)}</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Installments</h2>
        </div>
        {trx.installments.length === 0 ? (
          <div className="emptyState">Belum ada jadwal termin (skema langsung / belum dibuat).</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Amount</th>
                  <th>Terverifikasi</th>
                  <th>Jatuh Tempo</th>
                  <th>Status</th>
                  <th>Tanda</th>
                  <th>Diverifikasi</th>
                </tr>
              </thead>
              <tbody>
                {trx.installments.map((inst) => (
                  <tr key={inst.id}>
                    <td>{inst.installment_no}</td>
                    <td>{inst.amount}</td>
                    <td>{inst.amount_verified}</td>
                    <td>{formatDate(inst.due_date)}</td>
                    <td><StatusBadge status={inst.status} /></td>
                    <td>{inst.jatuh_tempo ? <span className="badge badge-red">[Jatuh Tempo]</span> : '—'}</td>
                    <td>
                      {inst.verified_date ? (
                        <>
                          {formatDate(inst.verified_date)} oleh {inst.verified_by || '—'}
                          {inst.proof_of_payment && (
                            <>
                              {' '}
                              &middot; <a href={inst.proof_of_payment} target="_blank" rel="noreferrer">bukti</a>
                            </>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>Verifikasi</h2>
        </div>
        <form className="form" onSubmit={handleVerify}>
          {verifyError && <div className="alert alertError" role="alert">{verifyError}</div>}
          {verifyMessage && <div className="alert alertSuccess" role="status">{verifyMessage}</div>}
          <div className="formRow">
            <div className="field">
              <label htmlFor="verify-installment">Termin</label>
              {openInstallments.length > 0 ? (
                <select
                  id="verify-installment"
                  value={verifyInstallmentId}
                  onChange={(e) => setVerifyInstallmentId(e.target.value)}
                  required
                >
                  {openInstallments.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      #{inst.installment_no} &mdash; {inst.amount} (jatuh tempo {formatDate(inst.due_date)})
                    </option>
                  ))}
                </select>
              ) : (
                <input id="verify-installment" value="Langsung (tanpa jadwal termin)" readOnly disabled />
              )}
            </div>
            <div className="field">
              <label htmlFor="verify-amount">Jumlah Diterima</label>
              <input
                id="verify-amount"
                type="number"
                min="0"
                step="0.01"
                required
                value={verifyAmount}
                onChange={(e) => setVerifyAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="formRow">
            <div className="field">
              <label htmlFor="verify-date">Tanggal Diterima</label>
              <input
                id="verify-date"
                type="date"
                required
                value={verifyDate}
                onChange={(e) => setVerifyDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="verify-proof">Bukti Pembayaran (link, opsional)</label>
              <input
                id="verify-proof"
                value={verifyProof}
                onChange={(e) => setVerifyProof(e.target.value)}
              />
            </div>
          </div>
          {/* Contract link lives in this form, not behind its own button: it is the
              hard gate before [Lunas] (M5 §7 Rule 2), so it belongs to the submit
              that needs it. Saved in the same transaction as the verification. */}
          <div className="field">
            <label htmlFor="contract-link">Link Kontrak (wajib sebelum pelunasan)</label>
            <input
              id="contract-link"
              value={contractLink}
              onChange={(e) => setContractLink(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={verifySubmitting}>
              {verifySubmitting ? 'Memproses...' : 'Simpan Verifikasi'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Pembayaran sebagian tetap tercatat: sisa tagihan muncul sebagai Amount Outstanding dan
            transaksi tetap ada di antrean Finance sampai [Lunas].
          </p>
        </form>
      </section>

      {/* Only [Termin] / [Bayar di Belakang] carry an original schedule. It used to
          render for every scheme with no installments, so on a Lunas / Bayar
          Sebagian deal the only thing this form could do was 409 with
          `[skema pembayaran ini tidak memakai termin]`. */}
      {needsOriginalSchedule && (
        <section className="card">
          <div className="cardHeader">
            <h2>Jadwal Termin</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Total jadwal harus sama dengan nilai transaksi ({trx.total_agreed_value}).
          </p>
          <form className="form" onSubmit={handleSchedule}>
            {scheduleError && <div className="alert alertError" role="alert">{scheduleError}</div>}
            {scheduleRows.map((row, idx) => (
              <div className="formRow" key={idx}>
                <div className="field">
                  <label htmlFor={`sched-amount-${idx}`}>Amount</label>
                  <input
                    id={`sched-amount-${idx}`}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={row.amount}
                    onChange={(e) => updateScheduleRow(idx, 'amount', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`sched-due-${idx}`}>Jatuh Tempo</label>
                  <input
                    id={`sched-due-${idx}`}
                    type="date"
                    required
                    value={row.due_date}
                    onChange={(e) => updateScheduleRow(idx, 'due_date', e.target.value)}
                  />
                </div>
                {scheduleRows.length > 1 && (
                  <button type="button" className="btn btnGhost btnSm" onClick={() => removeScheduleRow(idx)}>
                    Hapus
                  </button>
                )}
              </div>
            ))}
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn btnSecondary btnSm" onClick={addScheduleRow}>
                Tambah Baris
              </button>
              <button type="submit" className="btn btnPrimary" disabled={scheduleSubmitting}>
                {scheduleSubmitting ? 'Menyimpan...' : 'Simpan Jadwal'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* The shortfall: Finance dates what is still owed so it starts surfacing on
          the Reminder Pembayaran dashboard (M5 §6) instead of relying on somebody
          remembering. Σ must equal Amount Outstanding — the server checks it. */}
      {canScheduleOutstanding && (
        <section className="card">
          <div className="cardHeader">
            <h2>Jadwal Penagihan Kekurangan</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Kekurangan pembayaran saat ini <strong>{trx.amount_outstanding}</strong>. Total jadwal di
            bawah harus sama dengan jumlah tersebut; setelah disimpan, tagihan ini masuk ke Reminder
            Pembayaran dan ditandai [Jatuh Tempo] bila lewat tanggal.
          </p>
          <form className="form" onSubmit={handleOutstandingSchedule}>
            {outstandingError && <div className="alert alertError" role="alert">{outstandingError}</div>}
            {outstandingMessage && (
              <div className="alert alertSuccess" role="status">{outstandingMessage}</div>
            )}
            {outstandingRows.map((row, idx) => (
              <div className="formRow" key={idx}>
                <div className="field">
                  <label htmlFor={`out-amount-${idx}`}>Nilai Kekurangan</label>
                  <input
                    id={`out-amount-${idx}`}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={row.amount}
                    onChange={(e) => updateOutstandingRow(idx, 'amount', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`out-due-${idx}`}>Jadwal Penagihan</label>
                  <input
                    id={`out-due-${idx}`}
                    type="date"
                    required
                    value={row.due_date}
                    onChange={(e) => updateOutstandingRow(idx, 'due_date', e.target.value)}
                  />
                </div>
                {outstandingRows.length > 1 && (
                  <button
                    type="button"
                    className="btn btnGhost btnSm"
                    onClick={() => removeOutstandingRow(idx)}
                  >
                    Hapus
                  </button>
                )}
              </div>
            ))}
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn btnSecondary btnSm" onClick={addOutstandingRow}>
                Tambah Baris
              </button>
              <button type="submit" className="btn btnPrimary" disabled={outstandingSubmitting}>
                {outstandingSubmitting ? 'Menyimpan...' : 'Simpan Jadwal Penagihan'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Ubah Transaksi (M5-OA-7): SPV/Head Finance mengajukan, Direktur meng-ACC.
          Termin yang sudah terverifikasi tidak pernah disentuh — jadwal pengganti
          hanya menggambarkan kekurangan pembayaran, jadi Σ-nya harus sama dengan
          Amount Outstanding, bukan dengan nilai transaksi. */}
      <section className="card">
        <div className="cardHeader">
          <h2>Ubah Transaksi (perlu ACC Direktur)</h2>
        </div>

        {decisionError && <div className="alert alertError" role="alert">{decisionError}</div>}

        {pendingChange && (
          <div className="alert alertInfo" role="status">
            <strong>{pendingChange.id}</strong> — {CHANGE_STATUS_LABEL[pendingChange.status]}
            <div style={{ marginTop: 6 }}>
              Skema: {pendingChange.from_scheme || '—'} &rarr; <strong>{pendingChange.to_scheme}</strong>
              {' '}&middot; Kekurangan saat diajukan: {pendingChange.amount_outstanding}
            </div>
            <div>Alasan: {pendingChange.reason}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Diajukan oleh {pendingChange.requested_by_nama || pendingChange.requested_by} pada{' '}
              {new Date(pendingChange.created_at).toLocaleString('id-ID')}
            </div>
            {pendingChange.schedule.length > 0 && (
              <ul style={{ margin: '6px 0 0 18px' }}>
                {pendingChange.schedule.map((s, idx) => (
                  <li key={idx}>{s.amount} &middot; jatuh tempo {formatDate(s.due_date)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pendingChange && canDecide && (
          <div className="form" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="decision-note">Catatan Keputusan (opsional)</label>
              <input id="decision-note" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                className="btn btnPrimary"
                disabled={decisionSubmitting}
                onClick={() => handleDecision(pendingChange.id, 'approve')}
              >
                {decisionSubmitting ? 'Memproses...' : 'Setujui & Terapkan'}
              </button>
              <button
                type="button"
                className="btn btnDanger"
                disabled={decisionSubmitting}
                onClick={() => handleDecision(pendingChange.id, 'reject')}
              >
                Tolak
              </button>
            </div>
          </div>
        )}

        {pendingChange && canCancelChange && (
          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button
              type="button"
              className="btn btnSecondary btnSm"
              disabled={decisionSubmitting}
              onClick={() => handleDecision(pendingChange.id, 'cancel')}
            >
              Batalkan Pengajuan
            </button>
          </div>
        )}

        {/* One pending filing per transaction — the server enforces it, so the
            form is hidden rather than offering a submit that can only 409. */}
        {!pendingChange && (
          <form className="form" onSubmit={handleScheme} style={{ marginTop: 12 }}>
            {schemeError && <div className="alert alertError" role="alert">{schemeError}</div>}
            {schemeMessage && <div className="alert alertSuccess" role="status">{schemeMessage}</div>}
            <p className="muted" style={{ fontSize: 13 }}>
              Ajukan perubahan metode/skema pembayaran klien. Pengajuan dicatat dengan alasan dan{' '}
              <strong>baru berlaku setelah disetujui Direktur</strong> — pembayaran yang sudah
              diverifikasi tidak pernah diubah. Untuk skema bertermin, total jadwal baru harus sama
              dengan kekurangan pembayaran saat ini ({trx.amount_outstanding}).
            </p>
            <div className="formRow">
              <div className="field">
                <label htmlFor="scheme-choice">Skema Baru</label>
                <select id="scheme-choice" value={schemeChoice} onChange={(e) => setSchemeChoice(e.target.value)}>
                  {SCHEME_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="scheme-reason">Alasan</label>
                <input
                  id="scheme-reason"
                  required
                  value={schemeReason}
                  onChange={(e) => setSchemeReason(e.target.value)}
                />
              </div>
            </div>

            {SCHEDULED_SCHEMES.has(schemeChoice) && (
              <>
                {schemeRows.map((row, idx) => (
                  <div className="formRow" key={idx}>
                    <div className="field">
                      <label htmlFor={`change-amount-${idx}`}>Nilai Termin Baru</label>
                      <input
                        id={`change-amount-${idx}`}
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={row.amount}
                        onChange={(e) => updateSchemeRow(idx, 'amount', e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`change-due-${idx}`}>Jatuh Tempo</label>
                      <input
                        id={`change-due-${idx}`}
                        type="date"
                        required
                        value={row.due_date}
                        onChange={(e) => updateSchemeRow(idx, 'due_date', e.target.value)}
                      />
                    </div>
                    {schemeRows.length > 1 && (
                      <button type="button" className="btn btnGhost btnSm" onClick={() => removeSchemeRow(idx)}>
                        Hapus
                      </button>
                    )}
                  </div>
                ))}
                <div>
                  <button type="button" className="btn btnSecondary btnSm" onClick={addSchemeRow}>
                    Tambah Baris
                  </button>
                </div>
              </>
            )}

            <div>
              <button type="submit" className="btn btnPrimary" disabled={schemeSubmitting || !canRequestChange}>
                {schemeSubmitting ? 'Menyimpan...' : 'Ajukan Perubahan'}
              </button>
            </div>
            {!canRequestChange && (
              <p className="muted" style={{ fontSize: 13 }}>
                Hanya SPV/Head Finance atau Direktur yang bisa mengajukan perubahan transaksi.
              </p>
            )}
          </form>
        )}

        {decidedChanges.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Pengajuan</th>
                  <th>Perubahan</th>
                  <th>Alasan</th>
                  <th>Status</th>
                  <th>Diputuskan</th>
                </tr>
              </thead>
              <tbody>
                {decidedChanges.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.from_scheme || '—'} &rarr; {r.to_scheme}</td>
                    <td>{r.reason}</td>
                    <td>{CHANGE_STATUS_LABEL[r.status]}</td>
                    <td>
                      {r.resolved_at
                        ? `${new Date(r.resolved_at).toLocaleString('id-ID')} oleh ${r.resolved_by_nama || r.resolved_by}`
                        : '—'}
                      {r.decision_note && <> &middot; {r.decision_note}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="cardHeader">
          <h2>[Bermasalah]</h2>
        </div>
        {bermasalahError && <div className="alert alertError" role="alert">{bermasalahError}</div>}
        {flagError && <div className="alert alertError" role="alert">{flagError}</div>}
        {voteError && <div className="alert alertError" role="alert">{voteError}</div>}

        {bermasalah && (
          <>
            <p>
              Status:{' '}
              {bermasalah.flagged ? (
                <span className="badge badge-red">Bermasalah</span>
              ) : (
                <span className="badge badge-green">Tidak Bermasalah</span>
              )}
              {bermasalah.escalated && (
                <span className="badge badge-purple" style={{ marginLeft: 6 }}>Eskalasi ke Director</span>
              )}
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Suara Finance: {bermasalah.finance_vote || '—'} &middot; Suara Account: {bermasalah.account_vote || '—'}
              {bermasalah.director_vote && <> &middot; Keputusan Director: {bermasalah.director_vote}</>}
            </p>

            {!bermasalah.flagged && (
              <button type="button" className="btn btnDanger btnSm" disabled={flagSubmitting} onClick={handleFlag}>
                {flagSubmitting ? 'Memproses...' : 'Tandai Bermasalah'}
              </button>
            )}

            {bermasalah.flagged && (
              <form className="form" onSubmit={handleVote} style={{ marginTop: 12 }}>
                <div className="formRow">
                  <div className="field">
                    <label htmlFor="vote-decision">Keputusan</label>
                    <select
                      id="vote-decision"
                      value={voteDecision}
                      onChange={(e) => setVoteDecision(e.target.value as 'setuju' | 'tolak')}
                    >
                      <option value="setuju">Setuju</option>
                      <option value="tolak">Tolak</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="vote-note">Catatan (opsional)</label>
                    <input id="vote-note" value={voteNote} onChange={(e) => setVoteNote(e.target.value)} />
                  </div>
                </div>
                <div>
                  <button type="submit" className="btn btnPrimary" disabled={voteSubmitting}>
                    {voteSubmitting ? 'Memproses...' : 'Kirim Suara'}
                  </button>
                </div>
              </form>
            )}

            {bermasalah.votes.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Divisi</th>
                      <th>Keputusan</th>
                      <th>Catatan</th>
                      <th>Aktor</th>
                      <th>Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bermasalah.votes.map((v, idx) => (
                      <tr key={idx}>
                        <td>{v.division}</td>
                        <td>{v.decision}</td>
                        <td>{v.note || '—'}</td>
                        <td>{v.actor}</td>
                        <td>{new Date(v.created_at).toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
