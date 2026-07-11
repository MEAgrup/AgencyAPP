'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import {
  SCHEME_OPTIONS,
  attachContract,
  changeScheme,
  createSchedule,
  flagBermasalah,
  getBermasalah,
  getTransaction,
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

interface ScheduleRow {
  amount: string;
  due_date: string;
}

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [trx, setTrx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [bermasalah, setBermasalah] = useState<BermasalahStatus | null>(null);
  const [bermasalahError, setBermasalahError] = useState<string | null>(null);

  // Verifikasi
  const [verifyInstallmentId, setVerifyInstallmentId] = useState('');
  const [verifyAmount, setVerifyAmount] = useState('');
  const [verifyDate, setVerifyDate] = useState('');
  const [verifyProof, setVerifyProof] = useState('');
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  // Jadwal Termin
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([{ amount: '', due_date: '' }]);
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Kontrak
  const [contractLink, setContractLink] = useState('');
  const [contractSubmitting, setContractSubmitting] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

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
      setTrx(res.transaction);
      setContractLink(res.transaction.contract_attachment || '');
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
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
  }, [load, loadBermasalah]);

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setVerifyError(null);
    setVerifyMessage(null);
    setVerifySubmitting(true);
    try {
      const res = await verify(id, {
        installment_id: verifyInstallmentId,
        amount: verifyAmount,
        received_date: verifyDate,
        proof_of_payment: verifyProof,
      });
      setTrx(res.transaction);
      setVerifyMessage('Verifikasi berhasil disimpan.');
      setVerifyAmount('');
      setVerifyProof('');
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

  async function handleContract(e: FormEvent) {
    e.preventDefault();
    setContractError(null);
    setContractSubmitting(true);
    try {
      await attachContract(id, contractLink);
      await load();
    } catch (err) {
      setContractError(errorMessage(err));
    } finally {
      setContractSubmitting(false);
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

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !trx) {
    return (
      <div className="stack">
        <Link href="/finance" className="muted">&larr; Kembali ke Finance</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Transaksi tidak ditemukan.'}</div>
      </div>
    );
  }

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
              <label htmlFor="verify-installment">Installment</label>
              <select
                id="verify-installment"
                value={verifyInstallmentId}
                onChange={(e) => setVerifyInstallmentId(e.target.value)}
              >
                <option value="">Langsung (tanpa jadwal)</option>
                {trx.installments.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    #{inst.installment_no} &mdash; {inst.amount} ({inst.status})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="verify-amount">Amount</label>
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
          <div>
            <button type="submit" className="btn btnPrimary" disabled={verifySubmitting}>
              {verifySubmitting ? 'Memproses...' : 'Verifikasi'}
            </button>
          </div>
        </form>
      </section>

      {trx.installments.length === 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>Jadwal Termin</h2>
          </div>
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

      <section className="card">
        <div className="cardHeader">
          <h2>Kontrak</h2>
        </div>
        <form className="form" onSubmit={handleContract}>
          {contractError && <div className="alert alertError" role="alert">{contractError}</div>}
          <div className="field">
            <label htmlFor="contract-link">Link Kontrak</label>
            <input
              id="contract-link"
              required
              value={contractLink}
              onChange={(e) => setContractLink(e.target.value)}
            />
          </div>
          <div>
            <button type="submit" className="btn btnPrimary" disabled={contractSubmitting}>
              {contractSubmitting ? 'Menyimpan...' : 'Simpan Kontrak'}
            </button>
          </div>
        </form>
      </section>

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
