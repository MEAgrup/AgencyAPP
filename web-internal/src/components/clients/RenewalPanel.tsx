'use client';

/**
 * R-04 (Kinerja Sales) — "Perpanjangan / Cross Sell" panel on the Client
 * Record. Self-fetching (mirrors `MilestonesSection`/`ClientBoardSection` in
 * `clients/[id]/page.tsx`) so a renewal error never blanks the record.
 *
 * Mirrors the M0 §5/§6 negotiation+closing flow on `/sales/[id]` one-for-one,
 * just anchored to an existing client instead of a `PRSP-` attempt:
 * propose (no_nego ⇒ Auto Approved, else Pending Approval) → Sales Lead/
 * Director decide → execute (separate step, same as `close()` after
 * Negotiation-Approved). KS-2: executing REPLACES the client's whole sales
 * allocation, so the allocation form here always starts blank rather than
 * pre-filled from the client's CURRENT allocation — copying it forward would
 * read as "nothing changed" when the point of executing is deciding anew.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import CommissionRuleInput from '@/components/CommissionRuleInput';
import type { Role } from '@/lib/types';
import type { MasterService } from '@/lib/types';
import { formatIDR } from '@/lib/money';
import { punyaTenor, tenorDefault, tenorLabel, tenorOptions } from '@/lib/msl';
import { PAYMENT_SCHEMES, type ProposalLineInput } from '@/lib/sales';
import {
  canDecideRenewalUi,
  canWriteRenewalUi,
  decideRenewal,
  executeRenewal,
  getRenewalDetail,
  isSalesLead,
  isSalesStaff,
  JENIS_BAYAR_KOMISI,
  JENIS_CROSS_SELL,
  JENIS_PERPANJANGAN,
  labelJenis,
  listRenewals,
  proposeRenewal,
  resubmitRenewal,
  STATUS_APPROVED,
  STATUS_AUTO_APPROVED,
  STATUS_PENDING,
  STATUS_REJECTED,
  type ExecuteRenewalResult,
  type Renewal,
  type RenewalDetail,
} from '@/lib/renewal';
import { api } from '@/lib/api';

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID');
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface LineRow {
  master_service_id: string;
  name: string;
  proposed_price: string;
  commission_rule: string;
  quantity: string;
  amount: string;
  /** FS-6b — tenor pilihan sebagai string; '' = layanan tenor tunggal. */
  durasi_bulan: string;
}

const emptyLineRow = (): LineRow => ({
  master_service_id: '', name: '', proposed_price: '', commission_rule: '', quantity: '', amount: '',
  durasi_bulan: '',
});

/**
 * FS-4 — layanan yang sah untuk tagihan komisi.
 *
 * Disaring lewat PENANDA KATALOG `pengakuan = 'bulan_berikutnya'` (D-KOM),
 * bukan lewat nama "Komisi": nama layanan bisa disunting Sales Head lewat form
 * MSL kapan saja, dan mengunci ke nama berarti penagihan berhenti bekerja pada
 * hari seseorang merapikan katalog. Server menegakkan aturan yang sama — ini
 * cerminnya, supaya dropdown tidak menawarkan yang nanti ditolak.
 */
function layananKomisi(services: MasterService[]): MasterService[] {
  return services.filter((s) => s.pengakuan === 'bulan_berikutnya');
}

function toProposalLineInputs(rows: LineRow[]): ProposalLineInput[] {
  return rows
    .filter((r) => r.master_service_id.trim() !== '')
    .map((r) => ({
      master_service_id: r.master_service_id,
      proposed_price: r.proposed_price,
      commission_rule: r.commission_rule,
      quantity: r.quantity ? Number(r.quantity) : undefined,
      amount: r.amount || undefined,
      // FS-6b: `undefined` bila tidak ada tenor yang dipilih — kuncinya boleh
      // absen, tapi tidak boleh berisi 0. Perpanjangan yang menjual paket
      // setahun harus mencetak layanan 12 bulan, bukan layanan sepanjang opsi
      // terpendek katalog.
      durasi_bulan: r.durasi_bulan ? Number(r.durasi_bulan) : undefined,
    }));
}

/** Compact line editor — same standard/custom split as `/sales/[id]`'s ProposalLinesEditor, without the Payment Terms column (renewal execution takes its own installment schedule, not per-line terms). */
function LinesEditor({
  rows, custom, services, onChange, disabled, satuBaris,
}: {
  rows: LineRow[];
  custom: boolean;
  services: MasterService[];
  onChange: (rows: LineRow[]) => void;
  disabled?: boolean;
  /** FS-4: "Pilihan jasa hanya 1 yaitu komisi" — tanpa tombol tambah baris. */
  satuBaris?: boolean;
}) {
  const byId = new Map(services.map((s) => [s.id, s]));

  function update(idx: number, field: keyof LineRow, value: string) {
    onChange(rows.map((r, i) => {
      if (i !== idx) return r;
      if (field === 'master_service_id') {
        const next = byId.get(value);
        return {
          ...r, master_service_id: value, name: next?.name ?? '', proposed_price: '', commission_rule: '',
          // Tenor jasa lama tidak boleh menempel di jasa baru — sama alasannya
          // dengan editor proposal di `/sales/[id]`.
          durasi_bulan: String(tenorDefault(next) ?? ''),
        };
      }
      return { ...r, [field]: value };
    }));
  }

  return (
    <div className="field">
      <label>Jasa</label>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Jasa</th>
              <th>Durasi</th>
              <th>Qty / Nominal</th>
              {custom && <th>Proposed Price</th>}
              {custom && <th>Commission Rule</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, idx) => {
              const svc = l.master_service_id ? byId.get(l.master_service_id) : undefined;
              const isPassthrough = svc?.pricing_mode === 'passthrough';
              return (
                <tr key={idx}>
                  <td>
                    <select
                      aria-label={`Jasa baris ${idx + 1}`}
                      value={l.master_service_id}
                      disabled={disabled}
                      onChange={(e) => update(idx, 'master_service_id', e.target.value)}
                    >
                      <option value="">Pilih jasa...</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {punyaTenor(svc) ? (
                      <select
                        aria-label={`Durasi baris ${idx + 1}`}
                        value={l.durasi_bulan || String(tenorDefault(svc) ?? '')}
                        disabled={disabled}
                        onChange={(e) => update(idx, 'durasi_bulan', e.target.value)}
                      >
                        {tenorOptions(svc).map((o) => (
                          <option key={o.durasi_bulan} value={o.durasi_bulan}>
                            {tenorLabel(o, formatIDR)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted">{svc?.durasi_bulan ? `${svc.durasi_bulan} bulan` : '—'}</span>
                    )}
                  </td>
                  <td>
                    {isPassthrough ? (
                      <input
                        aria-label={`Nominal baris ${idx + 1}`}
                        type="number" min="0" placeholder="Nominal (Rp)"
                        value={l.amount} disabled={disabled}
                        onChange={(e) => update(idx, 'amount', e.target.value)}
                        style={{ width: 150 }}
                      />
                    ) : (
                      <input
                        aria-label={`Quantity baris ${idx + 1}`}
                        type="number" min="0" step="1" placeholder="Quantity"
                        value={l.quantity} disabled={disabled}
                        onChange={(e) => update(idx, 'quantity', e.target.value)}
                        style={{ width: 110 }}
                      />
                    )}
                  </td>
                  {custom && (
                    <td>
                      <input
                        aria-label={`Proposed Price baris ${idx + 1}`}
                        type="number" min="0" step="0.01" placeholder="kosong = harga standar"
                        value={l.proposed_price} disabled={disabled}
                        onChange={(e) => update(idx, 'proposed_price', e.target.value)}
                        style={{ width: 170 }}
                      />
                    </td>
                  )}
                  {custom && (
                    <td>
                      <CommissionRuleInput
                        idPrefix={`rnw-line-${idx}`}
                        value={l.commission_rule}
                        disabled={disabled}
                        onChange={(v) => update(idx, 'commission_rule', v)}
                      />
                    </td>
                  )}
                  <td>
                    {rows.length > 1 && !satuBaris && (
                      <button type="button" className="btn btnGhost btnSm" disabled={disabled}
                        onClick={() => onChange(rows.filter((_, i) => i !== idx))}>
                        Hapus
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!satuBaris && (
        <button type="button" className="btn btnSecondary btnSm" disabled={disabled} onClick={() => onChange([...rows, emptyLineRow()])}>
          + Tambah Jasa
        </button>
      )}
    </div>
  );
}

interface AllocRow {
  salesperson_id: string;
  persen: string;
}

function ExecuteForm({
  clientId, id, onDone, tagihanSaja,
}: {
  clientId: string;
  id: string;
  onDone: () => void;
  /**
   * FS-4 `bayar_komisi`: tidak ada kontrak yang lahir, jadi tidak ada jendela
   * untuk diisi — dan alokasi sales SENGAJA tidak diminta, karena KS-2
   * mengganti seluruh alokasi klien setiap eksekusi dan komisi ditagih tiap
   * bulan. Server menegakkan hal yang sama; ini cerminnya, bukan gerbangnya.
   */
  tagihanSaja?: boolean;
}) {
  const [durasi, setDurasi] = useState('12');
  const [mulai, setMulai] = useState(todayISO());
  const [akhir, setAkhir] = useState('');
  const [scheme, setScheme] = useState<string>(PAYMENT_SCHEMES[0]);
  const [allocRows, setAllocRows] = useState<AllocRow[]>([{ salesperson_id: '', persen: '100' }]);
  const [pic, setPic] = useState('');
  const [installments, setInstallments] = useState<{ amount: string; due_date: string }[]>([{ amount: '', due_date: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteRenewalResult | null>(null);

  const sumPersen = allocRows.reduce((sum, r) => sum + (Number(r.persen) || 0), 0);
  const needsSchedule = scheme === '[Termin]' || scheme === '[Bayar di Belakang]';

  function updateAlloc(idx: number, field: keyof AllocRow, value: string) {
    setAllocRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const primary = allocRows[0]?.salesperson_id.trim() ?? '';
      const res = await executeRenewal(clientId, id, {
        durasi_bulan: tagihanSaja ? 0 : Number(durasi),
        tanggal_mulai: tagihanSaja ? '' : mulai,
        tanggal_akhir: tagihanSaja ? '' : akhir,
        parties: tagihanSaja
          ? { primary_salesperson_id: '', allocations: [] }
          : {
              primary_salesperson_id: primary,
              allocations: allocRows
                .filter((r) => r.salesperson_id.trim() !== '')
                .map((r) => ({ salesperson_id: r.salesperson_id.trim(), basis_points: Math.round((Number(r.persen) || 0) * 100) })),
              commission_payment_pic_id: allocRows.length > 1 ? (pic || undefined) : undefined,
            },
        payment_scheme: scheme,
        installments: needsSchedule ? installments.filter((i) => i.amount && i.due_date) : undefined,
      });
      setResult(res);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="alert alertSuccess" role="status">
        Eksekusi berhasil.{' '}
        {result.contract_id
          ? <>Contract: {result.contract_id} &middot; </>
          : <>Tagihan komisi (tanpa kontrak baru) &middot; </>}
        Transaction:{' '}
        <Link href={`/finance/transactions/${result.transaction_id}`}>{result.transaction_id}</Link>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit} style={{ marginTop: 12 }}>
      {error && <div className="alert alertError" role="alert">{error}</div>}
      {tagihanSaja && (
        <p className="muted" style={{ fontSize: 13 }}>
          Bayar Komisi tidak membuat kontrak baru dan tidak mengubah alokasi
          komisi klien — yang lahir hanya baris jasa dan transaksi untuk ditagih
          Finance.
        </p>
      )}

      {!tagihanSaja && (
      <div className="formRow">
        <div className="field">
          <label htmlFor={`durasi-${id}`}>Durasi (bulan)</label>
          <input id={`durasi-${id}`} type="number" min="1" max="36" required value={durasi} onChange={(e) => setDurasi(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`mulai-${id}`}>Tanggal Mulai</label>
          <input id={`mulai-${id}`} type="date" required value={mulai} onChange={(e) => setMulai(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`akhir-${id}`}>Tanggal Akhir</label>
          <input id={`akhir-${id}`} type="date" required value={akhir} onChange={(e) => setAkhir(e.target.value)} />
        </div>
      </div>
      )}

      {!tagihanSaja && (
      <div className="field">
        <label>Alokasi Sales (Σ harus 100%, maks 5) &middot; KS-2: kredit ini MENGGANTI seluruh alokasi lama klien</label>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Salesperson ID</th><th>Persen (%)</th><th></th></tr></thead>
            <tbody>
              {allocRows.map((r, idx) => (
                <tr key={idx}>
                  <td><input value={r.salesperson_id} onChange={(e) => updateAlloc(idx, 'salesperson_id', e.target.value)} /></td>
                  <td><input type="number" min="0" max="100" step="0.01" value={r.persen} onChange={(e) => updateAlloc(idx, 'persen', e.target.value)} style={{ width: 100 }} /></td>
                  <td>
                    {allocRows.length > 1 && (
                      <button type="button" className="btn btnGhost btnSm" onClick={() => setAllocRows((rows) => rows.filter((_, i) => i !== idx))}>Hapus</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ gap: 12, marginTop: 8, alignItems: 'center' }}>
          <button type="button" className="btn btnSecondary btnSm" disabled={allocRows.length >= 5}
            onClick={() => setAllocRows((rows) => [...rows, { salesperson_id: '', persen: '' }])}>
            Tambah Salesperson
          </button>
          <span style={{ color: sumPersen === 100 ? undefined : 'var(--danger, #c0392b)' }}>Σ alokasi: {sumPersen}%</span>
        </div>
      </div>
      )}

      {!tagihanSaja && allocRows.length > 1 && (
        <div className="field">
          <label htmlFor={`pic-${id}`}>Commission &amp; Payment PIC</label>
          <select id={`pic-${id}`} value={pic} onChange={(e) => setPic(e.target.value)}>
            <option value="">Pilih PIC...</option>
            {allocRows.filter((r) => r.salesperson_id.trim()).map((r, idx) => (
              <option key={idx} value={r.salesperson_id.trim()}>{r.salesperson_id.trim()}</option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor={`scheme-${id}`}>Payment Scheme</label>
        <select id={`scheme-${id}`} value={scheme} onChange={(e) => setScheme(e.target.value)}>
          {PAYMENT_SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {needsSchedule && (
        <div className="field">
          <label>Jadwal Pembayaran</label>
          {installments.map((inst, idx) => (
            <div className="formRow" key={idx}>
              <div className="field">
                <label htmlFor={`inst-amt-${id}-${idx}`}>Amount</label>
                <input id={`inst-amt-${id}-${idx}`} type="number" min="0" step="0.01" required
                  value={inst.amount} onChange={(e) => setInstallments((rows) => rows.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r)))} />
              </div>
              <div className="field">
                <label htmlFor={`inst-due-${id}-${idx}`}>Jatuh Tempo</label>
                <input id={`inst-due-${id}-${idx}`} type="date" required
                  value={inst.due_date} onChange={(e) => setInstallments((rows) => rows.map((r, i) => (i === idx ? { ...r, due_date: e.target.value } : r)))} />
              </div>
              {scheme === '[Termin]' && installments.length > 1 && (
                <button type="button" className="btn btnGhost btnSm" onClick={() => setInstallments((rows) => rows.filter((_, i) => i !== idx))}>Hapus</button>
              )}
            </div>
          ))}
          {scheme === '[Termin]' && (
            <button type="button" className="btn btnSecondary btnSm" onClick={() => setInstallments((rows) => [...rows, { amount: '', due_date: '' }])}>
              Tambah Termin
            </button>
          )}
        </div>
      )}

      <div>
        <button type="submit" className="btn btnPrimary" disabled={submitting}>
          {submitting ? 'Memproses...' : 'Eksekusi Renewal'}
        </button>
      </div>
    </form>
  );
}

function RenewalRow({
  row, clientId, msvcs, canWrite, canDecide, onChanged,
}: {
  row: Renewal;
  clientId: string;
  msvcs: MasterService[];
  canWrite: boolean;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<RenewalDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [decisionNote, setDecisionNote] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const [resubmitLines, setResubmitLines] = useState<LineRow[]>([emptyLineRow()]);
  const [resubmitBusy, setResubmitBusy] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);

  const [showExecute, setShowExecute] = useState(false);

  const loadDetail = useCallback(async () => {
    setDetailError(null);
    try {
      const d = await getRenewalDetail(clientId, row.id);
      setDetail(d);
      setResubmitLines(
        d.lines.length > 0
          ? d.lines.map((l) => ({
              master_service_id: l.master_service_id, name: '', proposed_price: l.proposed_price,
              commission_rule: l.commission_rule, quantity: '', amount: '',
              durasi_bulan: l.durasi_bulan === null ? '' : String(l.durasi_bulan),
            }))
          : [emptyLineRow()],
      );
    } catch (err) {
      setDetailError(errorMessage(err));
    }
  }, [clientId, row.id]);

  useEffect(() => {
    if (expanded && !detail) loadDetail();
  }, [expanded, detail, loadDetail]);

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && decisionNote.trim() === '') {
      setDecisionError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setDecisionBusy(true);
    setDecisionError(null);
    try {
      await decideRenewal(clientId, row.id, decision, decisionNote);
      onChanged();
    } catch (err) {
      setDecisionError(errorMessage(err));
    } finally {
      setDecisionBusy(false);
    }
  }

  async function resubmit(e: FormEvent) {
    e.preventDefault();
    setResubmitBusy(true);
    setResubmitError(null);
    try {
      await resubmitRenewal(clientId, row.id, toProposalLineInputs(resubmitLines));
      onChanged();
    } catch (err) {
      setResubmitError(errorMessage(err));
    } finally {
      setResubmitBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setExpanded((v) => !v)}>
        <div>
          <strong>{row.id}</strong>{' '}
          <span className="muted" style={{ fontSize: 12 }}>
            {labelJenis(row.jenis)} &middot; {formatDateTime(row.created_at)}
          </span>
        </div>
        <span className={`badge ${row.status === STATUS_REJECTED ? 'badge-red' : row.status.startsWith('Auto') || row.status === STATUS_APPROVED ? 'badge-green' : 'badge-amber'}`}>
          {row.status}
        </span>
      </div>

      {expanded && (
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          {detailError && <div className="alert alertError" role="alert">{detailError}</div>}
          {detail && detail.lines.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Jasa</th><th>Durasi</th><th>Proposed Price</th><th>Commission Rule</th></tr></thead>
                <tbody>
                  {detail.lines.map((l, idx) => (
                    <tr key={idx}>
                      <td>{msvcs.find((s) => s.id === l.master_service_id)?.name ?? l.master_service_id}</td>
                      <td>{l.durasi_bulan === null ? '—' : `${l.durasi_bulan} bulan`}</td>
                      <td>{formatIDR(l.proposed_price)}</td>
                      <td>{l.commission_rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {row.decision_note && <p className="muted" style={{ fontSize: 13 }}>Catatan keputusan: {row.decision_note}</p>}

          {row.status === STATUS_PENDING && canDecide && (
            <div className="stack" style={{ gap: 8 }}>
              {decisionError && <div className="alert alertError" role="alert">{decisionError}</div>}
              <div className="field">
                <label htmlFor={`note-${row.id}`}>Catatan (wajib untuk Reject)</label>
                <input id={`note-${row.id}`} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} disabled={decisionBusy} />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btnPrimary" disabled={decisionBusy} onClick={() => decide('approve')}>
                  {decisionBusy ? 'Memproses...' : 'Approve'}
                </button>
                <button type="button" className="btn btnDanger" disabled={decisionBusy || !decisionNote.trim()} onClick={() => decide('reject')}>
                  Reject
                </button>
              </div>
            </div>
          )}
          {row.status === STATUS_PENDING && !canDecide && (
            <p className="muted" style={{ fontSize: 13 }}>Menunggu persetujuan Sales Lead / Director.</p>
          )}

          {row.status === STATUS_REJECTED && canWrite && (
            <form className="form" onSubmit={resubmit}>
              {resubmitError && <div className="alert alertError" role="alert">{resubmitError}</div>}
              <LinesEditor
                rows={resubmitLines}
                custom
                services={row.jenis === JENIS_BAYAR_KOMISI ? layananKomisi(msvcs) : msvcs}
                onChange={setResubmitLines}
                disabled={resubmitBusy}
                satuBaris={row.jenis === JENIS_BAYAR_KOMISI}
              />
              <div>
                <button type="submit" className="btn btnSecondary" disabled={resubmitBusy}>
                  {resubmitBusy ? 'Memproses...' : 'Resubmit Proposal'}
                </button>
              </div>
            </form>
          )}

          {(row.status === STATUS_APPROVED || row.status === STATUS_AUTO_APPROVED) && canWrite && (
            <div>
              <button type="button" className={`btn ${showExecute ? 'btnPrimary' : 'btnSecondary'} btnSm`} onClick={() => setShowExecute((v) => !v)}>
                {showExecute ? 'Tutup' : 'Eksekusi Renewal'}
              </button>
              {showExecute && (
                <ExecuteForm
                  clientId={clientId}
                  id={row.id}
                  onDone={onChanged}
                  tagihanSaja={row.jenis === JENIS_BAYAR_KOMISI}
                />
              )}
            </div>
          )}

          {row.contract_id && (
            <p className="muted" style={{ fontSize: 13 }}>
              Contract: {row.contract_id} · Transaction:{' '}
              {row.transaction_id ? <Link href={`/finance/transactions/${row.transaction_id}`}>{row.transaction_id}</Link> : '—'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function RenewalPanel({
  clientId, salesPicId, role, employeeId,
}: {
  clientId: string;
  salesPicId: string;
  role: Role | null;
  employeeId: string | null;
}) {
  const [rows, setRows] = useState<Renewal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msvcs, setMsvcs] = useState<MasterService[]>([]);

  const [showPropose, setShowPropose] = useState(false);
  const [jenis, setJenis] = useState<string>(JENIS_PERPANJANGAN);
  const [noNego, setNoNego] = useState(true);
  const [lines, setLines] = useState<LineRow[]>([emptyLineRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const bayarKomisi = jenis === JENIS_BAYAR_KOMISI;

  const canWrite = canWriteRenewalUi(role, employeeId, salesPicId || null);
  const canDecide = canDecideRenewalUi(role);
  const canSeePanel = canWrite || canDecide || isSalesLead(role) || isSalesStaff(role) || !!role?.director || !!role?.od;

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listRenewals(clientId);
      setRows(data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [clientId]);

  useEffect(() => {
    if (!canSeePanel) return;
    load();
    api.get<{ data: MasterService[] }>(`/master-services?effective_at=${todayISO()}`)
      .then((res) => setMsvcs(res.data))
      .catch(() => setMsvcs([]));
  }, [load, canSeePanel]);

  async function submitPropose(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await proposeRenewal(clientId, jenis, toProposalLineInputs(lines), noNego);
      setShowPropose(false);
      setLines([emptyLineRow()]);
      await load();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!canSeePanel) return null;

  return (
    <section className="card" id="renewal">
      <div className="cardHeader">
        <h2>Perpanjangan / Cross Sell / Bayar Komisi</h2>
        {canWrite && (
          <button type="button" className={`btn ${showPropose ? 'btnPrimary' : 'btnSecondary'} btnSm`} onClick={() => setShowPropose((v) => !v)}>
            {showPropose ? 'Tutup' : '+ Penawaran / Tagihan'}
          </button>
        )}
      </div>

      {error && <div className="alert alertError" role="alert">{error}</div>}

      {showPropose && (
        <form className="form" onSubmit={submitPropose} style={{ marginBottom: 16 }}>
          {submitError && <div className="alert alertError" role="alert">{submitError}</div>}
          <div className="formRow">
            <div className="field">
              <label htmlFor="rnw-jenis">Jenis</label>
              <select
                id="rnw-jenis"
                value={jenis}
                onChange={(e) => {
                  // Baris di-reset saat jenis berubah: layanan yang sah untuk
                  // satu jenis belum tentu sah untuk yang lain, dan baris sisa
                  // dari pilihan sebelumnya akan ditolak server tanpa petunjuk
                  // dari mana asalnya.
                  setJenis(e.target.value);
                  setLines([emptyLineRow()]);
                }}
              >
                <option value={JENIS_PERPANJANGAN}>Perpanjangan</option>
                <option value={JENIS_CROSS_SELL}>Cross Sell</option>
                <option value={JENIS_BAYAR_KOMISI}>Bayar Komisi</option>
              </select>
            </div>
            <div className="field">
              <label className="row" style={{ gap: 8, fontSize: 13, alignItems: 'center', marginTop: 22 }}>
                <input type="checkbox" checked={noNego} onChange={(e) => setNoNego(e.target.checked)} />
                No Negotiation (harga standar MSL)
              </label>
            </div>
          </div>
          <LinesEditor
            rows={lines}
            custom={!noNego}
            services={bayarKomisi ? layananKomisi(msvcs) : msvcs}
            onChange={setLines}
            disabled={submitting}
            satuBaris={bayarKomisi}
          />
          {bayarKomisi && layananKomisi(msvcs).length === 0 && (
            <p className="muted" style={{ fontSize: 13 }}>
              Belum ada layanan berpengakuan &ldquo;bulan berikutnya&rdquo; di
              Master Service List — tagihan komisi tidak bisa diajukan sampai
              layanan itu ada.
            </p>
          )}
          <div>
            <button type="submit" className="btn btnPrimary" disabled={submitting}>
              {submitting ? 'Mengirim...' : 'Ajukan'}
            </button>
          </div>
        </form>
      )}

      {rows === null ? (
        <p className="muted">Memuat...</p>
      ) : rows.length === 0 ? (
        <div className="emptyState">Belum ada perpanjangan, cross-sell, atau tagihan komisi untuk klien ini.</div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {rows.map((r) => (
            <RenewalRow key={r.id} row={r} clientId={clientId} msvcs={msvcs} canWrite={canWrite} canDecide={canDecide} onChanged={load} />
          ))}
        </div>
      )}
    </section>
  );
}
