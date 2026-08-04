'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import {
  SCHEME_OPTIONS,
  changeScheme,
  createSchedule,
  flagBermasalah,
  getBermasalah,
  getTransaction,
  idrToInput,
  scheduleOutstanding,
  verify,
  voteBermasalah,
  type BermasalahStatus,
  type Transaction,
} from '@/lib/finance';
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

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

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

  // Ubah Skema
  const [schemeChoice, setSchemeChoice] = useState<string>(SCHEME_OPTIONS[0]);
  const [schemeReason, setSchemeReason] = useState('');
  const [schemeSubmitting, setSchemeSubmitting] = useState(false);
  const [schemeError, setSchemeError] = useState<string | null>(null);

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
  }, [load, loadBermasalah]);

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

  async function handleScheme(e: FormEvent) {
    e.preventDefault();
    setSchemeError(null);
    setSchemeSubmitting(true);
    try {
      await changeScheme(id, schemeChoice, schemeReason);
      setSchemeReason('');
      await load();
    } catch (err) {
      setSchemeError(errorMessage(err));
    } finally {
      setSchemeSubmitting(false);
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

      <section className="card">
        <div className="cardHeader">
          <h2>Ubah Skema</h2>
        </div>
        <form className="form" onSubmit={handleScheme}>
          {schemeError && <div className="alert alertError" role="alert">{schemeError}</div>}
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
          <div>
            <button type="submit" className="btn btnPrimary" disabled={schemeSubmitting}>
              {schemeSubmitting ? 'Menyimpan...' : 'Ubah Skema'}
            </button>
          </div>
        </form>
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
