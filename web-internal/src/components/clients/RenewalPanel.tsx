'use client';

/**
 * R-03 (Kinerja Sales, M0 §7.1) — Renewal/Cross-Sell panel on the Client
 * Record. Deviasi PRD M0 §6 arah (a), disetujui pemilik: closing di sini
 * TIDAK melahirkan `CLI-` baru — hanya kontrak (`CTR-`)/service (`SVC-`)/
 * transaksi (`TRX-`) baru pada klien yang SUDAH ADA. Mesin status sendiri
 * `contract_renewal` (bukan `prospect_attempt`, lihat `packages/domain/src/
 * renewal.ts` header comment) — jadi label negosiasi tampil identik ke
 * `/sales/[id]`, tapi seluruh state panel ini berdiri sendiri.
 *
 * Editor set jasa (`LineEditor`) DIDUPLIKASI, bukan diimpor, dari pola yang
 * sama di `/sales/[id]/page.tsx` — versi asal tidak diekspor sebagai
 * komponen bersama, dan memecahnya keluar berarti me-refactor halaman
 * closing Sales yang sudah lama stabil & teruji hanya demi satu pemakai baru.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { MasterService } from '@/lib/types';
import { api } from '@/lib/api';
import { MAX_SERVICES, PAYMENT_SCHEMES, type ProposalLineInput } from '@/lib/sales';
import { listContracts, type Contract } from '@/lib/contract';
import {
  RENEWAL_STATUSES,
  acceptRenewalCounter,
  cancelRenewal,
  closeRenewal,
  createRenewal,
  decideRenewalNegotiation,
  getRenewal,
  listRenewals,
  resubmitRenewalNegotiation,
  submitRenewalNegotiation,
  type ClosingResult,
  type NegotiationDecision,
  type Renewal,
  type RenewalJenis,
} from '@/lib/renewal';
import StatusBadge from '@/components/StatusBadge';

const S_DRAFT = 'Draft';
const S_PENDING = 'Negotiation - Pending Approval';
const S_AUTO = 'Negotiation - Auto Approved';
const S_APPROVED = 'Negotiation - Approved';
const S_REVISION = 'Negotiation - Revision Required';
const S_REJECTED = 'Negotiation - Rejected';
const S_CLOSED = 'Closed';
const S_CANCELLED = 'Cancelled';

const todayISO = () => new Date().toISOString().slice(0, 10);

interface LineRow {
  master_service_id: string;
  name: string;
  proposed_price: string;
  commission_rule: string;
  payment_terms: string;
  quantity: string;
  amount: string;
}

const emptyLineRow = (): LineRow => ({
  master_service_id: '', name: '', proposed_price: '', commission_rule: '',
  payment_terms: '', quantity: '', amount: '',
});

/** Set jasa proposal negosiasi — cermin `ProposalLinesEditor` di `/sales/[id]`. */
function LineEditor({
  rows, mode, services, onChange, disabled,
}: {
  rows: LineRow[];
  mode: 'standard' | 'custom';
  services: MasterService[];
  onChange: (rows: LineRow[]) => void;
  disabled?: boolean;
}) {
  const custom = mode === 'custom';
  const byId = new Map(services.map((s) => [s.id, s]));

  function update(idx: number, field: keyof LineRow, value: string) {
    onChange(
      rows.map((r, i) => {
        if (i !== idx) return r;
        if (field === 'master_service_id') {
          return { ...r, master_service_id: value, name: byId.get(value)?.name ?? '', proposed_price: '', commission_rule: '' };
        }
        return { ...r, [field]: value };
      }),
    );
  }

  return (
    <div className="field">
      <label>Jasa (maks {MAX_SERVICES})</label>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Jasa</th>
              <th>Qty / Nominal</th>
              {custom && <th>Proposed Price</th>}
              {custom && <th>Commission Rule</th>}
              {custom && <th>Payment Terms</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, idx) => {
              const svc = l.master_service_id ? byId.get(l.master_service_id) : undefined;
              const isPassthrough = svc?.pricing_mode === 'passthrough';
              return (
                <tr key={`${l.master_service_id}-${idx}`}>
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
                      <input
                        aria-label={`Commission Rule baris ${idx + 1}`}
                        placeholder="kosong = rule standar"
                        value={l.commission_rule} disabled={disabled}
                        onChange={(e) => update(idx, 'commission_rule', e.target.value)}
                      />
                    </td>
                  )}
                  {custom && (
                    <td>
                      <input
                        aria-label={`Payment Terms baris ${idx + 1}`}
                        value={l.payment_terms} disabled={disabled}
                        onChange={(e) => update(idx, 'payment_terms', e.target.value)}
                      />
                    </td>
                  )}
                  <td>
                    {rows.length > 1 && (
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
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn btnSecondary btnSm"
          disabled={disabled || rows.length >= MAX_SERVICES}
          onClick={() => onChange([...rows, emptyLineRow()])}>
          Tambah Jasa
        </button>
      </div>
      {custom && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Biarkan Proposed Price kosong untuk memakai harga standar MSL (dihitung server).
        </p>
      )}
    </div>
  );
}

function propPayload(rows: LineRow[], services: MasterService[], strip: boolean): ProposalLineInput[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  return rows.map((l) => {
    const svc = l.master_service_id ? byId.get(l.master_service_id) : undefined;
    const isPassthrough = svc?.pricing_mode === 'passthrough';
    const qty = Number(l.quantity);
    const line: ProposalLineInput = {
      master_service_id: l.master_service_id,
      proposed_price: strip ? '' : l.proposed_price.trim(),
      commission_rule: strip ? '' : l.commission_rule.trim(),
      payment_terms: l.payment_terms || undefined,
    };
    if (isPassthrough) {
      if (l.amount.trim() !== '') line.amount = l.amount.trim();
    } else if (!Number.isNaN(qty) && qty > 0) {
      line.quantity = Math.trunc(qty);
    }
    return line;
  });
}

interface AllocRow {
  salesperson_id: string;
  persen: string;
}
interface InstallmentRow {
  amount: string;
  due_date: string;
}

function RenewalDetail({
  renewal, services, canAct, isSuperior, selfEmployeeId, onChanged,
}: {
  renewal: Renewal;
  services: MasterService[];
  canAct: boolean;
  isSuperior: boolean;
  selfEmployeeId: string;
  onChanged: () => void;
}) {
  const status = renewal.status;

  // --- Negosiasi ---
  const [showNego, setShowNego] = useState(false);
  const [negoMode, setNegoMode] = useState<'standard' | 'custom'>('standard');
  const [lines, setLines] = useState<LineRow[]>([emptyLineRow()]);
  const [negoSubmitting, setNegoSubmitting] = useState(false);
  const [negoError, setNegoError] = useState<string | null>(null);

  // --- Keputusan Superior ---
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // --- Batal / terima counter ---
  const [simpleError, setSimpleError] = useState<string | null>(null);
  const [simplePending, setSimplePending] = useState<string | null>(null);

  // --- Closing ---
  const [allocRows, setAllocRows] = useState<AllocRow[]>([{ salesperson_id: selfEmployeeId, persen: '100' }]);
  const [commissionPic, setCommissionPic] = useState('');
  const [paymentScheme, setPaymentScheme] = useState<string>(PAYMENT_SCHEMES[0]);
  const [managedSince, setManagedSince] = useState('');
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [durasiBulan, setDurasiBulan] = useState('12');
  const [tanggalMulai, setTanggalMulai] = useState(todayISO());
  const [tanggalAkhir, setTanggalAkhir] = useState('');
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<ClosingResult | null>(null);

  // Reset every per-renewal editor when switching which request is expanded.
  useEffect(() => {
    setShowNego(false);
    setLines([emptyLineRow()]);
    setNegoError(null);
    setDecisionNote('');
    setDecisionError(null);
    setSimpleError(null);
    setAllocRows([{ salesperson_id: selfEmployeeId, persen: '100' }]);
    setCommissionPic('');
    setPaymentScheme(PAYMENT_SCHEMES[0]);
    setManagedSince('');
    setInstallments([]);
    setDurasiBulan('12');
    setTanggalMulai(todayISO());
    setTanggalAkhir('');
    setCloseError(null);
    setCloseResult(null);
  }, [renewal.id, selfEmployeeId]);

  const sumPersen = Math.round(allocRows.reduce((s, r) => s + (Number(r.persen) || 0), 0) * 100) / 100;

  function addAllocRow() {
    setAllocRows((rows) => (rows.length >= 5 ? rows : [...rows, { salesperson_id: '', persen: '' }]));
  }
  function removeAllocRow(idx: number) {
    setAllocRows((rows) => rows.filter((_, i) => i !== idx));
  }
  function updateAllocRow(idx: number, field: keyof AllocRow, value: string) {
    setAllocRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function addInstallment() {
    setInstallments((rows) => [...rows, { amount: '', due_date: '' }]);
  }
  function removeInstallment(idx: number) {
    setInstallments((rows) => rows.filter((_, i) => i !== idx));
  }
  function updateInstallment(idx: number, field: keyof InstallmentRow, value: string) {
    setInstallments((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function onSchemeChange(v: string) {
    setPaymentScheme(v);
    if (v === '[Termin]' || v === '[Bayar di Belakang]') {
      setInstallments((prev) => (prev.length > 0 ? prev : [{ amount: '', due_date: '' }]));
    } else {
      setInstallments([]);
    }
  }

  async function handleSubmitNego(e: FormEvent, noNego: boolean) {
    e.preventDefault();
    setNegoError(null);
    setNegoSubmitting(true);
    try {
      await submitRenewalNegotiation(renewal.id, propPayload(lines, services, noNego), noNego);
      onChanged();
    } catch (err) {
      setNegoError(errorMessage(err));
    } finally {
      setNegoSubmitting(false);
    }
  }

  async function handleResubmit(e: FormEvent) {
    e.preventDefault();
    setNegoError(null);
    setNegoSubmitting(true);
    try {
      await resubmitRenewalNegotiation(renewal.id, propPayload(lines, services, false));
      onChanged();
    } catch (err) {
      setNegoError(errorMessage(err));
    } finally {
      setNegoSubmitting(false);
    }
  }

  async function handleDecision(decision: NegotiationDecision) {
    setDecisionError(null);
    setDecisionSubmitting(true);
    try {
      await decideRenewalNegotiation(renewal.id, decision, decisionNote);
      setDecisionNote('');
      onChanged();
    } catch (err) {
      setDecisionError(errorMessage(err));
    } finally {
      setDecisionSubmitting(false);
    }
  }

  async function handleAcceptCounter() {
    setSimpleError(null);
    setSimplePending('accept');
    try {
      await acceptRenewalCounter(renewal.id);
      onChanged();
    } catch (err) {
      setSimpleError(errorMessage(err));
    } finally {
      setSimplePending(null);
    }
  }

  async function handleCancel() {
    setSimpleError(null);
    setSimplePending('cancel');
    try {
      await cancelRenewal(renewal.id);
      onChanged();
    } catch (err) {
      setSimpleError(errorMessage(err));
    } finally {
      setSimplePending(null);
    }
  }

  async function handleClose(e: FormEvent) {
    e.preventDefault();
    setCloseError(null);
    setCloseSubmitting(true);
    try {
      const useInstallments = paymentScheme === '[Termin]' || paymentScheme === '[Bayar di Belakang]';
      const res = await closeRenewal(renewal.id, {
        parties: {
          primary_salesperson_id: allocRows[0]?.salesperson_id.trim() ?? '',
          allocations: allocRows.map((r) => ({
            salesperson_id: r.salesperson_id.trim(),
            basis_points: Math.round((Number(r.persen) || 0) * 100),
          })),
          ...(allocRows.length > 1 ? { commission_payment_pic_id: commissionPic } : {}),
        },
        payment_scheme: paymentScheme,
        ...(managedSince ? { managed_since: managedSince } : {}),
        ...(useInstallments
          ? { installments: installments.map((i) => ({ amount: i.amount, due_date: i.due_date })) }
          : {}),
        contract_durasi_bulan: Number(durasiBulan) || 0,
        contract_tanggal_mulai: tanggalMulai,
        contract_tanggal_akhir: tanggalAkhir,
      });
      setCloseResult(res);
      onChanged();
    } catch (err) {
      setCloseError(errorMessage(err));
    } finally {
      setCloseSubmitting(false);
    }
  }

  const canClose = status === S_APPROVED || status === S_AUTO;
  const canCancel = status !== S_CLOSED && status !== S_CANCELLED;

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      {simpleError && <div className="alert alertError" role="alert">{simpleError}</div>}

      {/* Draft → buka negosiasi */}
      {status === S_DRAFT && canAct && (
        <div className="form">
          {negoError && <div className="alert alertError" role="alert">{negoError}</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={`btn ${negoMode === 'standard' && showNego ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => { setNegoMode('standard'); setShowNego(true); }}>
              No Negotiation Required
            </button>
            <button type="button" className={`btn ${negoMode === 'custom' && showNego ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => { setNegoMode('custom'); setShowNego(true); }}>
              Negotiation Required
            </button>
          </div>
          {showNego && (
            <form className="form" onSubmit={(e) => handleSubmitNego(e, negoMode === 'standard')} style={{ marginTop: 12 }}>
              <LineEditor rows={lines} mode={negoMode} services={services} onChange={setLines} disabled={negoSubmitting} />
              <div>
                <button type="submit" className="btn btnPrimary" disabled={negoSubmitting}>
                  {negoSubmitting ? 'Memproses...' : negoMode === 'standard' ? 'Konfirmasi Jasa (Tanpa Negosiasi)' : 'Ajukan Negosiasi'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Pending Approval → keputusan Superior */}
      {status === S_PENDING && (
        <div className="form">
          {isSuperior ? (
            <>
              {decisionError && <div className="alert alertError" role="alert">{decisionError}</div>}
              <div className="field">
                <label htmlFor={`dec-note-${renewal.id}`}>Catatan (wajib untuk Revise / Reject)</label>
                <textarea id={`dec-note-${renewal.id}`} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btnPrimary" disabled={decisionSubmitting} onClick={() => handleDecision('approve')}>Approve</button>
                <button type="button" className="btn btnSecondary" disabled={decisionSubmitting || !decisionNote.trim()} onClick={() => handleDecision('revise')}>Revise / Counter</button>
                <button type="button" className="btn btnDanger" disabled={decisionSubmitting || !decisionNote.trim()} onClick={() => handleDecision('reject')}>Reject</button>
              </div>
            </>
          ) : (
            <p className="muted">Proposal menunggu persetujuan Superior (Sales Lead / Director).</p>
          )}
        </div>
      )}

      {/* Revision Required → terima counter ATAU kirim ulang */}
      {status === S_REVISION && canAct && (
        <div className="stack">
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btnPrimary" disabled={simplePending !== null} onClick={handleAcceptCounter}>
              {simplePending === 'accept' ? 'Memproses...' : 'Terima Counter Offer'}
            </button>
          </div>
          <form className="form" onSubmit={handleResubmit}>
            {negoError && <div className="alert alertError" role="alert">{negoError}</div>}
            <p className="muted" style={{ fontSize: 13 }}>Atau ajukan ulang set jasa/harga:</p>
            <LineEditor rows={lines} mode="custom" services={services} onChange={setLines} disabled={negoSubmitting} />
            <button type="submit" className="btn btnSecondary" disabled={negoSubmitting}>
              {negoSubmitting ? 'Memproses...' : 'Kirim Ulang'}
            </button>
          </form>
        </div>
      )}

      {/* Rejected → kirim ulang */}
      {status === S_REJECTED && canAct && (
        <form className="form" onSubmit={handleResubmit}>
          {negoError && <div className="alert alertError" role="alert">{negoError}</div>}
          <LineEditor rows={lines} mode="custom" services={services} onChange={setLines} disabled={negoSubmitting} />
          <button type="submit" className="btn btnSecondary" disabled={negoSubmitting}>
            {negoSubmitting ? 'Memproses...' : 'Kirim Ulang'}
          </button>
        </form>
      )}

      {/* Approved / Auto Approved → Closing Form */}
      {canClose && canAct && (
        <div className="card">
          <div className="cardHeader"><h3>Closing Form</h3></div>
          {closeResult ? (
            <div className="alert alertSuccess" role="status">
              Closing berhasil. Transaction ID: {closeResult.transaction_id}.
            </div>
          ) : (
            <form className="form" onSubmit={handleClose}>
              {closeError && <div className="alert alertError" role="alert">{closeError}</div>}

              <div className="field">
                <label>Alokasi Sales (Σ harus 100%, maks 5) — kredit ikut yang MEMPROSES perpanjangan ini</label>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Salesperson ID</th><th>Persen (%)</th><th></th></tr></thead>
                    <tbody>
                      {allocRows.map((r, idx) => (
                        <tr key={idx}>
                          <td><input value={r.salesperson_id} onChange={(e) => updateAllocRow(idx, 'salesperson_id', e.target.value)} /></td>
                          <td><input type="number" min="0" max="100" step="0.01" value={r.persen} onChange={(e) => updateAllocRow(idx, 'persen', e.target.value)} style={{ width: 100 }} /></td>
                          <td>{allocRows.length > 1 && (
                            <button type="button" className="btn btnGhost btnSm" onClick={() => removeAllocRow(idx)}>Hapus</button>
                          )}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row" style={{ gap: 12, marginTop: 8, alignItems: 'center' }}>
                  <button type="button" className="btn btnSecondary btnSm" onClick={addAllocRow} disabled={allocRows.length >= 5}>Tambah Salesperson</button>
                  <span style={{ color: sumPersen === 100 ? undefined : 'var(--danger, #c0392b)' }}>Σ alokasi: {sumPersen}%</span>
                </div>
              </div>

              {allocRows.length > 1 && (
                <div className="field">
                  <label htmlFor={`pic-${renewal.id}`}>Commission &amp; Payment PIC</label>
                  <select id={`pic-${renewal.id}`} value={commissionPic} onChange={(e) => setCommissionPic(e.target.value)}>
                    <option value="">Pilih PIC...</option>
                    {allocRows.filter((r) => r.salesperson_id.trim()).map((r, idx) => (
                      <option key={idx} value={r.salesperson_id.trim()}>{r.salesperson_id.trim()}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="formRow">
                <div className="field">
                  <label htmlFor={`durasi-${renewal.id}`}>Durasi Kontrak (bulan, 1–36)</label>
                  <input id={`durasi-${renewal.id}`} type="number" min="1" max="36" value={durasiBulan} onChange={(e) => setDurasiBulan(e.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor={`mulai-${renewal.id}`}>Tanggal Mulai</label>
                  <input id={`mulai-${renewal.id}`} type="date" value={tanggalMulai} onChange={(e) => setTanggalMulai(e.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor={`akhir-${renewal.id}`}>Tanggal Akhir</label>
                  <input id={`akhir-${renewal.id}`} type="date" value={tanggalAkhir} onChange={(e) => setTanggalAkhir(e.target.value)} required />
                </div>
              </div>

              <div className="formRow">
                <div className="field">
                  <label htmlFor={`scheme-${renewal.id}`}>Payment Scheme</label>
                  <select id={`scheme-${renewal.id}`} value={paymentScheme} onChange={(e) => onSchemeChange(e.target.value)}>
                    {PAYMENT_SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`managed-${renewal.id}`}>Managed Since (opsional)</label>
                  <input id={`managed-${renewal.id}`} type="date" value={managedSince} onChange={(e) => setManagedSince(e.target.value)} />
                </div>
              </div>

              {(paymentScheme === '[Termin]' || paymentScheme === '[Bayar di Belakang]') && (
                <div className="field">
                  <label>Jadwal Pembayaran</label>
                  {installments.map((inst, idx) => (
                    <div className="formRow" key={idx}>
                      <div className="field">
                        <label htmlFor={`inst-amt-${renewal.id}-${idx}`}>Amount</label>
                        <input id={`inst-amt-${renewal.id}-${idx}`} type="number" min="0" step="0.01" required
                          value={inst.amount} onChange={(e) => updateInstallment(idx, 'amount', e.target.value)} />
                      </div>
                      <div className="field">
                        <label htmlFor={`inst-due-${renewal.id}-${idx}`}>Jatuh Tempo</label>
                        <input id={`inst-due-${renewal.id}-${idx}`} type="date" required
                          value={inst.due_date} onChange={(e) => updateInstallment(idx, 'due_date', e.target.value)} />
                      </div>
                      {installments.length > 1 && (
                        <button type="button" className="btn btnGhost btnSm" onClick={() => removeInstallment(idx)}>Hapus</button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn btnSecondary btnSm" onClick={addInstallment}>Tambah Termin</button>
                </div>
              )}

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="submit" className="btn btnPrimary" disabled={closeSubmitting}>
                  {closeSubmitting ? 'Memproses...' : 'Submit Closing'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {canCancel && canAct && status !== S_DRAFT && (
        <div>
          <button type="button" className="btn btnDanger btnSm" disabled={simplePending !== null} onClick={handleCancel}>
            {simplePending === 'cancel' ? 'Memproses...' : 'Batalkan Permintaan'}
          </button>
        </div>
      )}
      {status === S_DRAFT && canAct && (
        <div>
          <button type="button" className="btn btnGhost btnSm" disabled={simplePending !== null} onClick={handleCancel}>
            {simplePending === 'cancel' ? 'Memproses...' : 'Batalkan Permintaan'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function RenewalPanel({ clientId, salesPicId }: { clientId: string; salesPicId: string }) {
  const { employee, role } = useAuth();
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [services, setServices] = useState<MasterService[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [jenis, setJenis] = useState<RenewalJenis>('perpanjangan');
  const [contractSebelumnyaId, setContractSebelumnyaId] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listRenewals(clientId);
      setRenewals(rows);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ data: MasterService[] }>(`/master-services?effective_at=${todayISO()}`);
        if (!cancelled) setServices(res.data.filter((s) => s.active));
      } catch {
        if (!cancelled) setServices([]);
      }
      try {
        const rows = await listContracts(clientId);
        if (!cancelled) setContracts(rows);
      } catch {
        if (!cancelled) setContracts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  // ---- Permission gating (UX only; server — renewal.canManageRenewal/
  // canReadRenewal — is the final authority) ----
  const odOnly = Boolean(role?.od) && !role?.director;
  const isSalesLead = role?.division === 'Sales' && role?.level === 'lead';
  const isOwner = Boolean(employee && role?.division === 'Sales' && employee.employee_id === salesPicId);
  const canAct = !odOnly && (isOwner || isSalesLead || Boolean(role?.director));
  const isSuperior = !odOnly && (isSalesLead || Boolean(role?.director));

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateSubmitting(true);
    try {
      await createRenewal(clientId, {
        jenis,
        ...(jenis === 'perpanjangan' ? { contract_sebelumnya_id: contractSebelumnyaId } : {}),
      });
      setShowCreate(false);
      setContractSebelumnyaId('');
      await load();
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function refreshOne(id: string) {
    try {
      const fresh = await getRenewal(id);
      setRenewals((rows) => rows.map((r) => (r.id === id ? fresh : r)));
    } catch {
      // Fall back to a full reload if the single-record read is gated out.
      await load();
    }
  }

  return (
    <section className="card">
      <div className="cardHeader" style={{ justifyContent: 'space-between' }}>
        <h2>Perpanjangan / Cross-Sell</h2>
        {canAct && (
          <button type="button" className="btn btnSecondary btnSm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Batal' : '+ Ajukan Baru'}
          </button>
        )}
      </div>

      {loadError && <div className="alert alertError" role="alert">{loadError}</div>}

      {showCreate && (
        <form className="form" onSubmit={handleCreate} style={{ marginBottom: 16 }}>
          {createError && <div className="alert alertError" role="alert">{createError}</div>}
          <div className="formRow">
            <div className="field">
              <label htmlFor="renewal-jenis">Jenis</label>
              <select id="renewal-jenis" value={jenis} onChange={(e) => setJenis(e.target.value as RenewalJenis)}>
                <option value="perpanjangan">Perpanjangan (renewal kontrak lama)</option>
                <option value="cross_sell">Cross-Sell (kontrak baru terpisah)</option>
              </select>
            </div>
            {jenis === 'perpanjangan' && (
              <div className="field">
                <label htmlFor="renewal-contract">Kontrak yang Diperpanjang</label>
                <select id="renewal-contract" value={contractSebelumnyaId} onChange={(e) => setContractSebelumnyaId(e.target.value)} required>
                  <option value="">Pilih kontrak...</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>{c.id} ({c.tanggal_mulai} – {c.tanggal_akhir})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button type="submit" className="btn btnPrimary" disabled={createSubmitting}>
            {createSubmitting ? 'Memproses...' : 'Buka Permintaan'}
          </button>
        </form>
      )}

      {renewals.length === 0 ? (
        <p className="muted">Belum ada permintaan perpanjangan/cross-sell.</p>
      ) : (
        <div className="stack">
          {renewals.map((r) => (
            <div key={r.id} className="card" style={{ background: 'var(--surface-2, #f7f7f8)' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}>
                <div>
                  <strong>{r.id}</strong>{' '}
                  <span className="muted">
                    {r.jenis === 'perpanjangan' ? 'Perpanjangan' : 'Cross-Sell'}
                    {r.contract_sebelumnya_id ? ` · dari ${r.contract_sebelumnya_id}` : ''}
                  </span>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {expandedId === r.id && (
                <RenewalDetail
                  renewal={r}
                  services={services}
                  canAct={canAct}
                  isSuperior={isSuperior}
                  selfEmployeeId={employee?.employee_id ?? ''}
                  onChanged={() => refreshOne(r.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Re-exported so a future status filter (if one is ever needed) reads the
// machine's own vocabulary instead of retyping it.
export { RENEWAL_STATUSES };
