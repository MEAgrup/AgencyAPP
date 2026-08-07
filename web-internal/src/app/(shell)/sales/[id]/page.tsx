'use client';

import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatIDR } from '@/lib/money';
import { extractStatusLabel, summarizeJson } from '@/lib/audit';
import type { AuditEntry, MasterService } from '@/lib/types';
import {
  MAX_SERVICES,
  NQ_REASONS,
  PAYMENT_SCHEMES,
  acceptCounter,
  closeAttempt,
  decideNegotiation,
  getAttempt,
  markContacted,
  markLost,
  previewQuote,
  qualify,
  resubmitNegotiation,
  reviseServices,
  setNotQualified,
  submitNegotiation,
  listActivities,
  logActivity,
  type AttemptDetail,
  type ClosingInput,
  type NegotiationDecision,
  type ProposalLineInput,
  type Quote,
  type ServiceSelection,
} from '@/lib/sales';
import { ACTIVITY_TYPES, type ActivityRow, type EffortSummary } from '@/lib/leads';
import StatusBadge from '@/components/StatusBadge';

// Platform List checklist (M0 §4.3 — verbatim from the PRD, joined to a single
// stored string on submit because the backend persists one platform column).
const PLATFORMS = ['Shopee', 'TikTok Shop', 'Tokopedia', 'Lazada', 'Others'] as const;

// Status literals mirrored from ATTEMPT_STATUSES (module0_sales/sales.go).
const S_NEW = 'New Lead';
const S_CONTACTED = 'Contacted';
const S_QUALIFIED = 'Qualified';
const S_PENDING = 'Negotiation - Pending Approval';
const S_AUTO = 'Negotiation - Auto Approved';
const S_APPROVED = 'Negotiation - Approved';
const S_REVISION = 'Negotiation - Revision Required';
const S_REJECTED = 'Negotiation - Rejected';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID');
}

// Raw decimal money string → house IDR display; empty/0 handled by formatIDR ('—').
function money(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  return formatIDR(value);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

interface QualifyRow {
  master_service_id: string;
  quantity: string;
  amount: string;
}

// Satu baris jasa di editor proposal. `proposed_price` KOSONG berarti "harga
// standar" — server yang menghitungnya dari MSL (lihat lib/sales.ts
// ProposalLineInput), jadi jasa yang baru ditambahkan tidak butuh rupiah dari
// klien; `quantity` / `amount` yang jadi masukan kalkulatornya.
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

/**
 * Editor set jasa untuk proposal negosiasi & Edit Service (M0 §5 / §5.1).
 *
 * `mode='standard'` menyembunyikan kolom uang seluruhnya: yang bisa diubah hanya
 * JASA dan kuantitasnya, harga selalu datang dari MSL. Itu bentuk yang dipakai
 * jalur No Negotiation dan Edit Service tanpa negosiasi — keduanya boleh melewati
 * Superior justru KARENA tidak ada harga yang diketik.
 *
 * `mode='custom'` menambah Proposed Price / Commission Rule / Payment Terms.
 * Baris yang harganya dibiarkan kosong tetap dihargai standar oleh server, jadi
 * "tambah satu jasa dengan harga normal sambil menego yang lain" bisa dikirim
 * dalam satu proposal.
 */
function ProposalLinesEditor({
  rows,
  mode,
  services,
  onChange,
  disabled,
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
        // Ganti jasa ⇒ nama ikut ganti, dan harga custom yang sudah diketik untuk
        // jasa LAMA dibuang: membiarkannya akan mengirim harga jasa A sebagai
        // harga jasa B.
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
                      {/* Jasa dari snapshot Qualified bisa saja sudah non-aktif di
                          MSL; tetap ditampilkan agar barisnya tidak kosong. */}
                      {l.master_service_id && !byId.has(l.master_service_id) && (
                        <option value={l.master_service_id}>{l.name || l.master_service_id}</option>
                      )}
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {isPassthrough ? (
                      <input
                        aria-label={`Nominal baris ${idx + 1}`}
                        type="number"
                        min="0"
                        placeholder="Nominal (Rp)"
                        value={l.amount}
                        disabled={disabled}
                        onChange={(e) => update(idx, 'amount', e.target.value)}
                        style={{ width: 150 }}
                      />
                    ) : (
                      <input
                        aria-label={`Quantity baris ${idx + 1}`}
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Quantity"
                        value={l.quantity}
                        disabled={disabled}
                        onChange={(e) => update(idx, 'quantity', e.target.value)}
                        style={{ width: 110 }}
                      />
                    )}
                  </td>
                  {custom && (
                    <td>
                      <input
                        aria-label={`Proposed Price baris ${idx + 1}`}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="kosong = harga standar"
                        value={l.proposed_price}
                        disabled={disabled}
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
                        value={l.commission_rule}
                        disabled={disabled}
                        onChange={(e) => update(idx, 'commission_rule', e.target.value)}
                      />
                    </td>
                  )}
                  {custom && (
                    <td>
                      <input
                        aria-label={`Payment Terms baris ${idx + 1}`}
                        value={l.payment_terms}
                        disabled={disabled}
                        onChange={(e) => update(idx, 'payment_terms', e.target.value)}
                      />
                    </td>
                  )}
                  <td>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="btn btnGhost btnSm"
                        disabled={disabled}
                        onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                      >
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
        <button
          type="button"
          className="btn btnSecondary btnSm"
          disabled={disabled || rows.length >= MAX_SERVICES}
          onClick={() => onChange([...rows, emptyLineRow()])}
        >
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

interface AllocRow {
  salesperson_id: string;
  persen: string;
}

interface InstallmentRow {
  amount: string;
  due_date: string;
}

export default function AttemptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { employee, role } = useAuth();

  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // Shared feedback for the simple single-shot edges (contacted / accept / lost).
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // Master Service List (for the Qualified Lead Form service picker).
  const [msvcs, setMsvcs] = useState<MasterService[]>([]);

  // --- Qualified Lead Form (§4.3) ---
  const [qNamaPic, setQNamaPic] = useState('');
  const [qToko, setQToko] = useState('');
  const [qKota, setQKota] = useState('');
  const [qLinkToko, setQLinkToko] = useState('');
  const [qKategori, setQKategori] = useState('');
  const [qPlatforms, setQPlatforms] = useState<string[]>([]);
  const [qStoreLink, setQStoreLink] = useState('');
  const [qGmv, setQGmv] = useState('');
  const [qTargetGmv, setQTargetGmv] = useState('');
  const [qBudget, setQBudget] = useState('');
  const [qRows, setQRows] = useState<QualifyRow[]>([{ master_service_id: '', quantity: '', amount: '' }]);
  const [qQuote, setQQuote] = useState<Quote | null>(null);
  const [qQuoteError, setQQuoteError] = useState<string | null>(null);
  const [qSubmitting, setQSubmitting] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  // --- Not Qualified ---
  const [nqReasons, setNqReasons] = useState<string[]>([]);
  const [nqLainnya, setNqLainnya] = useState('');
  const [nqSubmitting, setNqSubmitting] = useState(false);
  const [nqError, setNqError] = useState<string | null>(null);

  // --- Negotiation proposal editor (shared: konfirmasi jasa @ No Negotiation,
  //     submit @ Qualified, resubmit @ Revision/Rejected, Edit Service @ Approved) ---
  const [showNegoEditor, setShowNegoEditor] = useState(false);
  const [showNoNegoEditor, setShowNoNegoEditor] = useState(false);
  const [propLines, setPropLines] = useState<LineRow[]>([]);
  const [negoSubmitting, setNegoSubmitting] = useState(false);
  const [negoError, setNegoError] = useState<string | null>(null);

  // --- Edit Service sebelum closing (M0 §5.1) ---
  // `reviseCustom` memilih apakah revisi memakai harga standar MSL (status tetap
  // Approved) atau harga negosiasi (kembali menunggu Superior). Server yang
  // menegakkan konsekuensinya; ini hanya menentukan kolom mana yang muncul.
  const [showReviseEditor, setShowReviseEditor] = useState(false);
  const [reviseCustom, setReviseCustom] = useState(false);
  const [reviseSubmitting, setReviseSubmitting] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [reviseMessage, setReviseMessage] = useState<string | null>(null);

  // --- Superior decision (@ Pending Approval) ---
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // --- Closing Form (§6) ---
  const [allocRows, setAllocRows] = useState<AllocRow[]>([]);
  const [commissionPic, setCommissionPic] = useState('');
  const [paymentScheme, setPaymentScheme] = useState<string>(PAYMENT_SCHEMES[0]);
  const [managedSince, setManagedSince] = useState('');
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<{ client_id: string; transaction_id: string } | null>(null);
  const closingInitRef = useRef(false);

  // --- Log aktivitas (ACT-, keputusan pemilik 2026-08-06) ---
  // Dicatat mulai status Qualified sampai sebelum terminal; server yang
  // berwenang menolak (`[aktivitas hanya bisa dicatat setelah lead qualified]`).
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [effort, setEffort] = useState<EffortSummary | null>(null);
  const [actType, setActType] = useState<string>(ACTIVITY_TYPES[0]);
  const [actWhen, setActWhen] = useState('');
  const [actSummary, setActSummary] = useState('');
  const [actSubmitting, setActSubmitting] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  const quoteSeq = useRef(0);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getAttempt(id);
      setDetail(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadAudit = useCallback(async () => {
    try {
      const res = await api.get<{ data: AuditEntry[] }>(
        `/audit?entity_type=prospect_attempt&entity_id=${encodeURIComponent(id)}`,
      );
      setAudit(res.data ?? []);
    } catch {
      setAudit([]);
    }
  }, [id]);

  const loadActivities = useCallback(async () => {
    try {
      const res = await listActivities(id);
      setActivities(res.data ?? []);
      setEffort(res.effort ?? null);
    } catch {
      // Panel effort tidak boleh menjatuhkan halaman prospek: kalau baca gagal
      // (mis. RLS memang tidak memberi barisnya), panelnya kosong, bukan error.
      setActivities([]);
      setEffort(null);
    }
  }, [id]);

  useEffect(() => {
    load();
    loadAudit();
    loadActivities();
  }, [load, loadAudit, loadActivities]);

  // Master services load once — the Qualified picker AND every proposal-line editor
  // (negotiation, resubmit, Edit Service) pick services from it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ data: MasterService[] }>(`/master-services?effective_at=${todayISO()}`);
        if (!cancelled) setMsvcs(res.data.filter((s) => s.active));
      } catch {
        if (!cancelled) setMsvcs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, MasterService>();
    msvcs.forEach((s) => m.set(s.id, s));
    return m;
  }, [msvcs]);

  // Prefill the proposal line editor from the qualified form (@ Qualified) or the
  // last proposal version (@ Revision / Rejected / before closing). Runs when the
  // detail changes.
  useEffect(() => {
    if (!detail) return;
    const s = detail.attempt.status;
    if (s === S_QUALIFIED && detail.qualified_form) {
      setPropLines(
        detail.qualified_form.services.map((sv) => ({
          master_service_id: sv.master_service_id,
          name: sv.name,
          proposed_price: sv.subtotal,
          commission_rule: sv.commission_rule,
          payment_terms: '',
          // Kuantitas yang sudah dipin di snapshot Qualified, supaya baris yang
          // harganya dikosongkan (jadi "standar") dihitung ulang server dengan
          // qty yang SAMA, bukan diam-diam jadi 1.
          quantity: sv.quantity ? String(Math.trunc(Number(sv.quantity))) : '',
          amount: sv.input_amount ?? '',
        })),
      );
    } else if (
      (s === S_REVISION || s === S_REJECTED || s === S_APPROVED || s === S_AUTO) &&
      detail.proposals.length > 0
    ) {
      const last = detail.proposals[detail.proposals.length - 1];
      // Baris proposal tidak menyimpan kuantitas (hanya harga yang disepakati),
      // jadi qty diambil dari snapshot Qualified untuk jasa yang memang
      // ditawarkan. Tanpa ini, mengubah satu baris ke harga standar akan
      // diam-diam menghitung ulang SEMUA baris dengan qty 1 — nilai dealnya
      // berubah tanpa ada yang mengetiknya.
      const offered = new Map(
        (detail.qualified_form?.services ?? []).map((sv) => [sv.master_service_id, sv]),
      );
      setPropLines(
        last.lines.map((l) => {
          const sv = offered.get(l.master_service_id);
          return {
            master_service_id: l.master_service_id,
            name: l.name,
            proposed_price: l.proposed_price,
            commission_rule: l.commission_rule,
            payment_terms: l.payment_terms ?? '',
            quantity: sv?.quantity ? String(Math.trunc(Number(sv.quantity))) : '',
            amount: sv?.input_amount ?? '',
          };
        }),
      );
    }
  }, [detail]);

  // Prefill the closing allocation once (primary = owner @ 100%) when entering closing.
  useEffect(() => {
    if (!detail || closingInitRef.current) return;
    const s = detail.attempt.status;
    if (s === S_APPROVED || s === S_AUTO) {
      setAllocRows([{ salesperson_id: detail.attempt.owner_employee_id, persen: '100' }]);
      setCommissionPic(detail.attempt.owner_employee_id);
      closingInitRef.current = true;
    }
  }, [detail]);

  // Live quote preview for the Qualified Lead Form service rows (server IDR strings, read-only).
  const qSelections = useMemo<ServiceSelection[]>(() => {
    const out: ServiceSelection[] = [];
    qRows.forEach((r) => {
      if (!r.master_service_id) return;
      const svc = byId.get(r.master_service_id);
      if (svc && svc.pricing_mode === 'passthrough') {
        const n = Number(r.amount);
        if (!Number.isNaN(n) && n > 0) out.push({ master_service_id: r.master_service_id, amount: r.amount.trim() });
      } else {
        const n = Number(r.quantity);
        if (!Number.isNaN(n) && n > 0) out.push({ master_service_id: r.master_service_id, quantity: Math.trunc(n) });
      }
    });
    return out;
  }, [qRows, byId]);

  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    if (qSelections.length === 0) {
      setQQuote(null);
      setQQuoteError(null);
      return;
    }
    quoteTimer.current = setTimeout(async () => {
      const seq = ++quoteSeq.current;
      try {
        const q = await previewQuote(qSelections);
        if (quoteSeq.current === seq) {
          setQQuote(q);
          setQQuoteError(null);
        }
      } catch (err) {
        if (quoteSeq.current === seq) {
          setQQuote(null);
          setQQuoteError(errorMessage(err));
        }
      }
    }, 400);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(qSelections)]);

  // ---- Permission gating (UX only; server is the final authority) ----
  const odOnly = Boolean(role?.od) && !role?.director;
  const isSalesLead = role?.division === 'Sales' && role?.level === 'lead';
  const isOwner = Boolean(
    detail && employee && employee.employee_id === detail.attempt.owner_employee_id && role?.division === 'Sales',
  );
  const canAct = !odOnly && (isOwner || isSalesLead || Boolean(role?.director));
  const isSuperior = !odOnly && (isSalesLead || Boolean(role?.director));

  // ---- Simple single-shot edges ----
  async function runEdge(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setActionError(null);
    setActionMessage(null);
    setPending(key);
    try {
      await fn();
      setActionMessage(okMsg);
      await load();
      await loadAudit();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  function handleContacted() {
    runEdge('contacted', () => markContacted(id), 'Attempt ditandai Contacted.');
  }

  function handleAccept() {
    runEdge('accept', () => acceptCounter(id), 'Counter offer diterima.');
  }

  function handleLost() {
    if (!window.confirm('Tandai attempt ini sebagai Closed-Lost? Tindakan ini tidak bisa dibatalkan.')) return;
    runEdge('lost', () => markLost(id), 'Attempt ditandai Closed-Lost.');
  }

  // ---- Qualified Lead Form ----
  function addQRow() {
    setQRows((rows) =>
      rows.length >= MAX_SERVICES ? rows : [...rows, { master_service_id: '', quantity: '', amount: '' }],
    );
  }
  function removeQRow(idx: number) {
    setQRows((rows) => rows.filter((_, i) => i !== idx));
  }
  function updateQRow(idx: number, field: keyof QualifyRow, value: string) {
    setQRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function togglePlatform(p: string) {
    setQPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function handleQualify(e: FormEvent) {
    e.preventDefault();
    setQError(null);
    setQSubmitting(true);
    try {
      await qualify(id, {
        nama_pic: qNamaPic,
        toko: qToko,
        kota: qKota,
        link_toko: qLinkToko,
        kategori: qKategori,
        platform: qPlatforms.join(', '),
        store_link: qStoreLink || undefined,
        gmv_baseline: qGmv,
        target_gmv: qTargetGmv,
        marketing_budget: qBudget || undefined,
        services: qSelections,
      });
      await load();
      await loadAudit();
    } catch (err) {
      setQError(errorMessage(err));
    } finally {
      setQSubmitting(false);
    }
  }

  // ---- Not Qualified ----
  function toggleNqReason(reason: string) {
    setNqReasons((prev) => (prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]));
  }

  async function handleNotQualified(e: FormEvent) {
    e.preventDefault();
    setNqError(null);
    setNqSubmitting(true);
    try {
      await setNotQualified(id, nqReasons, nqLainnya || undefined);
      await load();
      await loadAudit();
    } catch (err) {
      setNqError(errorMessage(err));
    } finally {
      setNqSubmitting(false);
    }
  }

  // ---- Negotiation proposal editor ----

  /**
   * Rakit body `lines[]`. `strip=true` (jalur standar: No Negotiation / Edit
   * Service tanpa negosiasi) MEMBUANG harga & rule, jadi server yang menghargai
   * semuanya dari MSL — itulah yang membuat submit-nya boleh melewati Superior.
   * `strip=false` mengirim harga apa adanya; baris yang harganya kosong tetap
   * dihargai standar oleh server.
   */
  function propPayload(rows: LineRow[], strip: boolean): ProposalLineInput[] {
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

  async function handleNoNego(e: FormEvent) {
    e.preventDefault();
    setNegoError(null);
    setNegoSubmitting(true);
    try {
      // Set jasa yang dikonfirmasi (bisa sudah ditambah/dikurangi dari penawaran
      // Qualified), semuanya dengan syarat standar — M0 §5 Flow Non-Negosiasi
      // langkah 1. Harga tidak pernah dikirim dari sini.
      await submitNegotiation(id, propPayload(propLines, true), true);
      await load();
      await loadAudit();
    } catch (err) {
      setNegoError(errorMessage(err));
    } finally {
      setNegoSubmitting(false);
    }
  }

  async function handleSubmitNego(e: FormEvent) {
    e.preventDefault();
    setNegoError(null);
    setNegoSubmitting(true);
    try {
      await submitNegotiation(id, propPayload(propLines, false), false);
      await load();
      await loadAudit();
    } catch (err) {
      setNegoError(errorMessage(err));
    } finally {
      setNegoSubmitting(false);
    }
  }

  // ---- Edit Service sebelum closing (M0 §5.1) ----
  async function handleReviseServices(e: FormEvent) {
    e.preventDefault();
    setReviseError(null);
    setReviseMessage(null);
    setReviseSubmitting(true);
    try {
      const lines = propPayload(propLines, !reviseCustom);
      await reviseServices(id, lines);
      setReviseMessage(
        reviseCustom
          ? 'Revisi jasa terkirim — proposal kembali menunggu persetujuan Superior.'
          : 'Set jasa diperbarui. Attempt tetap siap closing.',
      );
      setShowReviseEditor(false);
      // Alokasi closing dipasang ulang: nilai transaksinya berubah, jadi form
      // closing harus membaca versi proposal yang baru.
      closingInitRef.current = false;
      await load();
      await loadAudit();
    } catch (err) {
      setReviseError(errorMessage(err));
    } finally {
      setReviseSubmitting(false);
    }
  }

  async function handleResubmit(e: FormEvent) {
    e.preventDefault();
    setNegoError(null);
    setNegoSubmitting(true);
    try {
      await resubmitNegotiation(id, propPayload(propLines, false));
      await load();
      await loadAudit();
    } catch (err) {
      setNegoError(errorMessage(err));
    } finally {
      setNegoSubmitting(false);
    }
  }

  // ---- Superior decision ----
  async function handleDecision(decision: NegotiationDecision) {
    setDecisionError(null);
    setDecisionSubmitting(true);
    try {
      await decideNegotiation(id, decision, decisionNote);
      setDecisionNote('');
      await load();
      await loadAudit();
    } catch (err) {
      setDecisionError(errorMessage(err));
    } finally {
      setDecisionSubmitting(false);
    }
  }

  // ---- Closing ----
  const closingLines = useMemo(() => {
    if (!detail) return [] as { name: string; price: string }[];
    if (detail.proposals.length > 0) {
      const last = detail.proposals[detail.proposals.length - 1];
      return last.lines.map((l) => ({ name: l.name, price: l.proposed_price }));
    }
    if (detail.qualified_form) {
      return detail.qualified_form.services.map((s) => ({ name: s.name, price: s.subtotal }));
    }
    return [];
  }, [detail]);

  const closingTotal = useMemo(
    () => closingLines.reduce((sum, l) => sum + (Number(l.price) || 0), 0),
    [closingLines],
  );
  // Dibulatkan 2 desimal agar tampilan Σ bebas artefak float (33.33+33.33+33.34).
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
    if (v === '[Bayar di Belakang]') {
      setInstallments([{ amount: closingTotal ? String(closingTotal) : '', due_date: '' }]);
    } else if (v === '[Termin]') {
      setInstallments((prev) => (prev.length > 0 ? prev : [{ amount: '', due_date: '' }]));
    } else {
      setInstallments([]);
    }
  }

  async function handleClose(e: FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setCloseError(null);
    setCloseSubmitting(true);
    try {
      const useInstallments = paymentScheme === '[Termin]' || paymentScheme === '[Bayar di Belakang]';
      const input: ClosingInput = {
        parties: {
          primary_salesperson_id: detail.attempt.owner_employee_id,
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
      };
      const res = await closeAttempt(id, input);
      setCloseResult(res);
      await load();
      await loadAudit();
    } catch (err) {
      setCloseError(errorMessage(err));
    } finally {
      setCloseSubmitting(false);
    }
  }

  async function handleLogActivity(e: FormEvent) {
    e.preventDefault();
    setActError(null);
    setActSubmitting(true);
    try {
      await logActivity(id, {
        activity_type: actType,
        // Kosong = "sekarang" (server yang menentukan), jadi field tanggal
        // opsional dan tidak perlu ditebak di klien.
        occurred_at: actWhen ? new Date(actWhen).toISOString() : undefined,
        summary: actSummary,
      });
      setActSummary('');
      setActWhen('');
      await loadActivities();
    } catch (err) {
      setActError(errorMessage(err));
    } finally {
      setActSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || !detail) {
    return (
      <div className="stack">
        <Link href="/sales" className="muted">&larr; Kembali ke Sales Workspace</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Attempt tidak ditemukan.'}</div>
      </div>
    );
  }

  const { attempt, lead, qualified_form, proposals, nq_reasons, allowed_transitions } = detail;
  const status = attempt.status;
  const showLostAtClosing = status === S_APPROVED || status === S_AUTO;
  // Cermin ACTIVITY_ALLOWED_STATUSES di packages/domain/src/activity.ts: dari
  // Qualified sampai state negosiasi terakhir, TIDAK termasuk status terminal.
  // Server tetap otoritasnya — ini hanya memutuskan formulirnya ditampilkan.
  const ACTIVITY_STAGES = [S_QUALIFIED, S_PENDING, S_REVISION, S_APPROVED, S_AUTO, S_REJECTED];
  const canLogActivity = canAct && ACTIVITY_STAGES.includes(status);

  return (
    <div className="stack">
      <div>
        <Link href="/sales" className="muted">&larr; Kembali ke Sales Workspace</Link>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{attempt.id}</h1>
          <p className="muted">
            Lead:{' '}
            <Link href={`/leads/${lead.id}`}>{lead.id}</Link> &middot; Owner: {attempt.owner_nama || attempt.owner_employee_id}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Info attempt + lead */}
      <section className="card">
        <div className="grid2">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Nama Lead</div>
            <div>{lead.lead_name}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Telepon</div>
            <div>{lead.phone_number}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Email</div>
            <div>{lead.email || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Source</div>
            <div>{lead.source}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Record Status</div>
            <div>{lead.record_status}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Origin Campaign</div>
            <div>{lead.origin_campaign_id || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Diklaim</div>
            <div>{formatDateTime(attempt.claimed_at)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Dibuat</div>
            <div>{formatDateTime(attempt.created_at)}</div>
          </div>
        </div>
      </section>

      {/* Snapshot Qualified Lead Form (bila sudah ada) */}
      {qualified_form && (
        <section className="card">
          <div className="cardHeader">
            <h2>Qualified Lead Form</h2>
          </div>
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Nama PIC</div>
              <div>{qualified_form.nama_pic || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Nama Toko</div>
              <div>{qualified_form.toko || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Kota</div>
              <div>{qualified_form.kota || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Kategori</div>
              <div>{qualified_form.kategori || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Platform</div>
              <div>{qualified_form.platform || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Link Toko</div>
              <div>
                {qualified_form.link_toko ? (
                  <a href={qualified_form.link_toko} target="_blank" rel="noreferrer">Lihat</a>
                ) : (
                  '—'
                )}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>GMV Baseline</div>
              <div>{money(qualified_form.gmv_baseline)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Target GMV</div>
              <div>{money(qualified_form.target_gmv)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Marketing Budget</div>
              <div>{money(qualified_form.marketing_budget)}</div>
            </div>
          </div>
          {qualified_form.services.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Jasa</th>
                    <th>Qty</th>
                    <th>Satuan</th>
                    <th>Subtotal</th>
                    <th>Aturan Komisi</th>
                  </tr>
                </thead>
                <tbody>
                  {qualified_form.services.map((s, idx) => (
                    <tr key={`${s.master_service_id}-${idx}`}>
                      <td>{s.name || s.master_service_id}</td>
                      <td>{s.quantity}</td>
                      <td>{s.unit || '—'}</td>
                      <td>{money(s.subtotal)}</td>
                      <td>{s.commission_rule || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ---- Log Aktivitas (effort sampai closing) ----
           Keputusan pemilik 2026-08-06 (docs/DECISIONS.md): sebelum ini satu-satunya
           jejak effort adalah transisi `Contacted`, jadi deal yang butuh enam kali
           follow-up terlihat sama dengan deal sekali telepon. Panel ini BUKAN
           lifecycle — mencatat aktivitas tidak memindahkan status prospek — dan
           barisnya append-only (tidak ada tombol edit/hapus; DB pun menolaknya). */}
      <section className="card">
        <div className="cardHeader">
          <h2>Log Aktivitas</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            Total effort: <strong>{effort?.total ?? 0}</strong> aktivitas
            {effort?.last_activity_at ? ` · terakhir ${formatDateTime(effort.last_activity_at)}` : ''}
          </span>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Follow up, jadwal meeting, online meeting, dan visit dicatat di sini &mdash; satu klien boleh
          berkali-kali, setiap aktivitas wajib membawa ringkasan hasil, sampai closing. Angka effort
          dihitung ulang dari log ini (tidak pernah disimpan).
        </p>

        {effort && effort.total > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {ACTIVITY_TYPES.filter((t) => (effort.by_type?.[t] ?? 0) > 0).map((t) => (
              <span key={t} className="badge">
                {t}: {effort.by_type[t]}
              </span>
            ))}
          </div>
        )}

        {canLogActivity && (
          <form className="form" onSubmit={handleLogActivity}>
            {actError && <div className="alert alertError" role="alert">{actError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="act-type">Jenis Aktivitas</label>
                <select id="act-type" value={actType} onChange={(e) => setActType(e.target.value)}>
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="act-when">Waktu (kosong = sekarang)</label>
                <input
                  id="act-when"
                  type="datetime-local"
                  value={actWhen}
                  onChange={(e) => setActWhen(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="act-summary">Ringkasan Hasil (wajib)</label>
              <textarea
                id="act-summary"
                rows={3}
                required
                value={actSummary}
                onChange={(e) => setActSummary(e.target.value)}
                placeholder="mis. Visit ke gudang, minta penawaran ulang untuk paket live streaming"
              />
            </div>
            <div>
              <button type="submit" className="btn btnPrimary btnSm" disabled={actSubmitting}>
                {actSubmitting ? 'Menyimpan...' : 'Catat Aktivitas'}
              </button>
            </div>
          </form>
        )}

        {!canLogActivity && canAct && (
          <p className="muted" style={{ fontSize: 13 }}>
            Aktivitas bisa dicatat setelah prospek berstatus <code>Qualified</code> dan sebelum prospek
            ditutup.
          </p>
        )}

        {activities.length === 0 ? (
          <div className="emptyState">Belum ada aktivitas tercatat.</div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Jenis</th>
                  <th>Ringkasan Hasil</th>
                  <th>Dicatat oleh</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.occurred_at)}</td>
                    <td>{a.activity_type}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{a.summary}</td>
                    <td>{a.created_by_nama || a.created_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {actionError && <div className="alert alertError" role="alert">{actionError}</div>}
      {actionMessage && <div className="alert alertSuccess" role="status">{actionMessage}</div>}

      {/* ---- Aksi per status ---- */}

      {/* New Lead → Tandai Contacted */}
      {status === S_NEW && canAct && allowed_transitions.includes(S_CONTACTED) && (
        <section className="card">
          <div className="cardHeader">
            <h2>Aksi</h2>
          </div>
          <button type="button" className="btn btnPrimary" disabled={pending !== null} onClick={handleContacted}>
            {pending === 'contacted' ? 'Memproses...' : 'Tandai Contacted'}
          </button>
        </section>
      )}

      {/* Contacted → Qualified Lead Form + Not Qualified */}
      {status === S_CONTACTED && canAct && (
        <>
          <section className="card">
            <div className="cardHeader">
              <h2>Qualified Lead Form</h2>
            </div>
            <form className="form" onSubmit={handleQualify}>
              {qError && <div className="alert alertError" role="alert">{qError}</div>}
              <div className="formRow">
                <div className="field">
                  <label htmlFor="q-namapic">Nama (PIC klien)</label>
                  <input id="q-namapic" required value={qNamaPic} onChange={(e) => setQNamaPic(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="q-toko">Nama Toko</label>
                  <input id="q-toko" required value={qToko} onChange={(e) => setQToko(e.target.value)} />
                </div>
              </div>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="q-kota">Kota</label>
                  <input id="q-kota" required value={qKota} onChange={(e) => setQKota(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="q-kategori">Kategori Bisnis</label>
                  <input id="q-kategori" required value={qKategori} onChange={(e) => setQKategori(e.target.value)} />
                </div>
              </div>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="q-linktoko">Link Toko</label>
                  <input id="q-linktoko" required value={qLinkToko} onChange={(e) => setQLinkToko(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="q-storelink">Store Link (opsional)</label>
                  <input id="q-storelink" value={qStoreLink} onChange={(e) => setQStoreLink(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Platform List</label>
                <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                  {PLATFORMS.map((p) => (
                    <label key={p} className="row" style={{ gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={qPlatforms.includes(p)} onChange={() => togglePlatform(p)} />
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="q-gmv">GMV saat ini (per bulan)</label>
                  <input
                    id="q-gmv"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={qGmv}
                    onChange={(e) => setQGmv(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="q-targetgmv">Target GMV (per bulan)</label>
                  <input
                    id="q-targetgmv"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={qTargetGmv}
                    onChange={(e) => setQTargetGmv(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="q-budget">Marketing Budget (opsional)</label>
                <input
                  id="q-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={qBudget}
                  onChange={(e) => setQBudget(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Jasa Ditawarkan (maks {MAX_SERVICES})</label>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Jasa</th>
                        <th>Qty / Nominal</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {qRows.map((row, idx) => {
                        const svc = row.master_service_id ? byId.get(row.master_service_id) : undefined;
                        const isPassthrough = svc?.pricing_mode === 'passthrough';
                        return (
                          <tr key={idx}>
                            <td>
                              <select
                                value={row.master_service_id}
                                onChange={(e) => updateQRow(idx, 'master_service_id', e.target.value)}
                              >
                                <option value="">Pilih jasa...</option>
                                {msvcs.map((s) => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              {isPassthrough ? (
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="Nominal (Rp)"
                                  value={row.amount}
                                  onChange={(e) => updateQRow(idx, 'amount', e.target.value)}
                                  style={{ width: 160 }}
                                />
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  placeholder="Quantity"
                                  value={row.quantity}
                                  onChange={(e) => updateQRow(idx, 'quantity', e.target.value)}
                                  style={{ width: 120 }}
                                />
                              )}
                            </td>
                            <td>
                              {qRows.length > 1 && (
                                <button type="button" className="btn btnGhost btnSm" onClick={() => removeQRow(idx)}>
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
                  <button
                    type="button"
                    className="btn btnSecondary btnSm"
                    onClick={addQRow}
                    disabled={qRows.length >= MAX_SERVICES}
                  >
                    Tambah Jasa
                  </button>
                </div>
              </div>

              {/* Estimasi & komisi (read-only, dari server) */}
              <div className="card" style={{ padding: 12 }}>
                {qQuoteError && <div className="alert alertError" role="alert">{qQuoteError}</div>}
                <div className="row" style={{ gap: 24 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>Estimasi Nilai Transaksi</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{qQuote?.estimasi_nilai_idr ?? '—'}</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>Perhitungan Komisi</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{qQuote?.total_komisi_idr ?? '—'}</div>
                  </div>
                </div>
              </div>

              <div>
                <button type="submit" className="btn btnPrimary" disabled={qSubmitting}>
                  {qSubmitting ? 'Memproses...' : 'Submit Qualified Form'}
                </button>
              </div>
            </form>
          </section>

          <section className="card">
            <div className="cardHeader">
              <h2>Not Qualified</h2>
            </div>
            <form className="form" onSubmit={handleNotQualified}>
              {nqError && <div className="alert alertError" role="alert">{nqError}</div>}
              <div className="field">
                <label>Alasan</label>
                <div className="stack" style={{ gap: 6 }}>
                  {NQ_REASONS.map((r) => (
                    <label key={r} className="row" style={{ gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={nqReasons.includes(r)} onChange={() => toggleNqReason(r)} />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
              {nqReasons.includes('[Lainnya ...]') && (
                <div className="field">
                  <label htmlFor="nq-lainnya">Keterangan Lainnya</label>
                  <input id="nq-lainnya" required value={nqLainnya} onChange={(e) => setNqLainnya(e.target.value)} />
                </div>
              )}
              <div>
                <button type="submit" className="btn btnDanger" disabled={nqSubmitting}>
                  {nqSubmitting ? 'Memproses...' : 'Tandai Not Qualified'}
                </button>
              </div>
            </form>
          </section>
        </>
      )}

      {/* Qualified → Negosiasi */}
      {status === S_QUALIFIED && canAct && (
        <section className="card">
          <div className="cardHeader">
            <h2>Negosiasi</h2>
          </div>
          {negoError && <div className="alert alertError" role="alert">{negoError}</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn ${showNoNegoEditor ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => {
                setShowNoNegoEditor((v) => !v);
                setShowNegoEditor(false);
              }}
            >
              No Negotiation Required
            </button>
            <button
              type="button"
              className={`btn ${showNegoEditor ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => {
                setShowNegoEditor((v) => !v);
                setShowNoNegoEditor(false);
              }}
            >
              Negotiation Required
            </button>
          </div>

          {/* M0 §5 Flow Non-Negosiasi langkah 1 — Service Selection & Confirmation:
              jasa boleh dibatalkan/ditambah, tapi SEMUA memakai syarat standar. */}
          {showNoNegoEditor && (
            <form className="form" onSubmit={handleNoNego} style={{ marginTop: 12 }}>
              <p className="muted" style={{ fontSize: 13 }}>
                Konfirmasi set jasa yang diambil klien. Semua memakai harga &amp; komisi standar
                Master Service List, jadi tidak butuh persetujuan Superior. Butuh ubah harga?
                Pakai <strong>Negotiation Required</strong>.
              </p>
              <ProposalLinesEditor
                rows={propLines}
                mode="standard"
                services={msvcs}
                onChange={setPropLines}
                disabled={negoSubmitting}
              />
              <div>
                <button type="submit" className="btn btnPrimary" disabled={negoSubmitting}>
                  {negoSubmitting ? 'Memproses...' : 'Konfirmasi Jasa (Tanpa Negosiasi)'}
                </button>
              </div>
            </form>
          )}

          {showNegoEditor && (
            <form className="form" onSubmit={handleSubmitNego} style={{ marginTop: 12 }}>
              <ProposalLinesEditor
                rows={propLines}
                mode="custom"
                services={msvcs}
                onChange={setPropLines}
                disabled={negoSubmitting}
              />
              <div>
                <button type="submit" className="btn btnPrimary" disabled={negoSubmitting}>
                  {negoSubmitting ? 'Memproses...' : 'Ajukan Negosiasi'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Negotiation - Pending Approval → keputusan Superior / info owner */}
      {status === S_PENDING && (
        <section className="card">
          <div className="cardHeader">
            <h2>Keputusan Negosiasi</h2>
          </div>
          {isSuperior ? (
            <div className="form">
              {decisionError && <div className="alert alertError" role="alert">{decisionError}</div>}
              <div className="field">
                <label htmlFor="decision-note">Catatan (wajib untuk Revise / Reject)</label>
                <textarea
                  id="decision-note"
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                />
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={decisionSubmitting}
                  onClick={() => handleDecision('approve')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btnSecondary"
                  disabled={decisionSubmitting || !decisionNote.trim()}
                  onClick={() => handleDecision('revise')}
                >
                  Revise / Counter
                </button>
                <button
                  type="button"
                  className="btn btnDanger"
                  disabled={decisionSubmitting || !decisionNote.trim()}
                  onClick={() => handleDecision('reject')}
                >
                  Reject
                </button>
              </div>
            </div>
          ) : (
            <p className="muted">Proposal menunggu persetujuan Superior (Sales Lead / Director).</p>
          )}
        </section>
      )}

      {/* Negotiation - Revision Required → owner: terima counter atau resubmit */}
      {status === S_REVISION && canAct && (
        <section className="card">
          <div className="cardHeader">
            <h2>Revisi Diminta</h2>
          </div>
          {negoError && <div className="alert alertError" role="alert">{negoError}</div>}
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <button type="button" className="btn btnPrimary" disabled={pending !== null} onClick={handleAccept}>
              {pending === 'accept' ? 'Memproses...' : 'Terima Counter'}
            </button>
          </div>
          <form className="form" onSubmit={handleResubmit}>
            <ProposalLinesEditor
              rows={propLines}
              mode="custom"
              services={msvcs}
              onChange={setPropLines}
              disabled={negoSubmitting}
            />
            <div>
              <button type="submit" className="btn btnSecondary" disabled={negoSubmitting}>
                {negoSubmitting ? 'Memproses...' : 'Resubmit Proposal'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Negotiation - Rejected → owner: resubmit atau Closed-Lost */}
      {status === S_REJECTED && canAct && (
        <section className="card">
          <div className="cardHeader">
            <h2>Negosiasi Ditolak</h2>
          </div>
          {negoError && <div className="alert alertError" role="alert">{negoError}</div>}
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <button type="button" className="btn btnDanger" disabled={pending !== null} onClick={handleLost}>
              {pending === 'lost' ? 'Memproses...' : 'Tandai Closed-Lost'}
            </button>
          </div>
          <form className="form" onSubmit={handleResubmit}>
            <ProposalLinesEditor
              rows={propLines}
              mode="custom"
              services={msvcs}
              onChange={setPropLines}
              disabled={negoSubmitting}
            />
            <div>
              <button type="submit" className="btn btnSecondary" disabled={negoSubmitting}>
                {negoSubmitting ? 'Memproses...' : 'Resubmit Proposal'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Edit Service sebelum closing (M0 §5.1, keputusan pemilik 2026-08-07).
          Jasa yang benar-benar diambil klien sering berbeda dari yang ditawarkan
          di Qualified; di sini set finalnya direvisi SEBELUM closing membekukannya
          menjadi Service + Transaction. */}
      {showLostAtClosing && canAct && !closeResult && (
        <section className="card">
          <div className="cardHeader">
            <h2>Edit Service (sebelum closing)</h2>
          </div>
          {reviseError && <div className="alert alertError" role="alert">{reviseError}</div>}
          {reviseMessage && <div className="alert alertSuccess" role="status">{reviseMessage}</div>}
          <p className="muted" style={{ fontSize: 13 }}>
            Closing membaca versi proposal TERAKHIR. Revisi dengan harga standar Master
            Service List tidak mengubah status (tetap siap closing); begitu ada harga
            negosiasi, proposal kembali menunggu persetujuan Superior.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn ${showReviseEditor ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => {
                setShowReviseEditor((v) => !v);
                setReviseError(null);
                setReviseMessage(null);
              }}
            >
              {showReviseEditor ? 'Tutup Editor Jasa' : 'Ubah Jasa'}
            </button>
          </div>
          {showReviseEditor && (
            <form className="form" onSubmit={handleReviseServices} style={{ marginTop: 12 }}>
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={reviseCustom}
                  disabled={reviseSubmitting}
                  onChange={(e) => setReviseCustom(e.target.checked)}
                />
                Pakai harga negosiasi (butuh persetujuan Superior lagi)
              </label>
              <ProposalLinesEditor
                rows={propLines}
                mode={reviseCustom ? 'custom' : 'standard'}
                services={msvcs}
                onChange={setPropLines}
                disabled={reviseSubmitting}
              />
              <div>
                <button type="submit" className="btn btnPrimary" disabled={reviseSubmitting}>
                  {reviseSubmitting ? 'Memproses...' : 'Simpan Revisi Jasa'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Negotiation - Approved / Auto Approved → Closing Form */}
      {showLostAtClosing && canAct && (
        <section className="card">
          <div className="cardHeader">
            <h2>Closing Form</h2>
          </div>

          {closeResult ? (
            <div className="alert alertSuccess" role="status">
              Closing berhasil. Client ID: {closeResult.client_id} · Transaction ID: {closeResult.transaction_id}.{' '}
              <Link href={`/clients/${closeResult.client_id}`}>Buka Client Record</Link>
            </div>
          ) : (
            <form className="form" onSubmit={handleClose}>
              {closeError && <div className="alert alertError" role="alert">{closeError}</div>}

              {/* Proposal versi terakhir + total (tampilan; nilai resmi tetap server) */}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Jasa</th>
                      <th>Proposed Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closingLines.map((l, idx) => (
                      <tr key={idx}>
                        <td>{l.name || '—'}</td>
                        <td>{money(l.price)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 600 }}>Total</td>
                      <td style={{ fontWeight: 600 }}>{formatIDR(closingTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="field">
                <label>Primary Salesperson (terkunci)</label>
                <input value={attempt.owner_employee_id} readOnly disabled />
              </div>

              <div className="field">
                <label>Alokasi Sales (Σ harus 100%, maks 5)</label>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Salesperson ID</th>
                        <th>Persen (%)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocRows.map((r, idx) => (
                        <tr key={idx}>
                          <td>
                            <input
                              value={r.salesperson_id}
                              onChange={(e) => updateAllocRow(idx, 'salesperson_id', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={r.persen}
                              onChange={(e) => updateAllocRow(idx, 'persen', e.target.value)}
                              style={{ width: 100 }}
                            />
                          </td>
                          <td>
                            {allocRows.length > 1 && (
                              <button type="button" className="btn btnGhost btnSm" onClick={() => removeAllocRow(idx)}>
                                Hapus
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row" style={{ gap: 12, marginTop: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btnSecondary btnSm"
                    onClick={addAllocRow}
                    disabled={allocRows.length >= 5}
                  >
                    Tambah Salesperson
                  </button>
                  <span style={{ color: sumPersen === 100 ? undefined : 'var(--danger, #c0392b)' }}>
                    Σ alokasi: {sumPersen}%
                  </span>
                </div>
              </div>

              {allocRows.length > 1 && (
                <div className="field">
                  <label htmlFor="close-pic">Commission &amp; Payment PIC</label>
                  <select id="close-pic" value={commissionPic} onChange={(e) => setCommissionPic(e.target.value)}>
                    <option value="">Pilih PIC...</option>
                    {allocRows
                      .filter((r) => r.salesperson_id.trim())
                      .map((r, idx) => (
                        <option key={idx} value={r.salesperson_id.trim()}>{r.salesperson_id.trim()}</option>
                      ))}
                  </select>
                </div>
              )}

              <div className="formRow">
                <div className="field">
                  <label htmlFor="close-scheme">Payment Scheme</label>
                  <select id="close-scheme" value={paymentScheme} onChange={(e) => onSchemeChange(e.target.value)}>
                    {PAYMENT_SCHEMES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="close-managed">Managed Since (opsional)</label>
                  <input
                    id="close-managed"
                    type="date"
                    value={managedSince}
                    onChange={(e) => setManagedSince(e.target.value)}
                  />
                </div>
              </div>

              {(paymentScheme === '[Termin]' || paymentScheme === '[Bayar di Belakang]') && (
                <div className="field">
                  <label>Jadwal Pembayaran</label>
                  {installments.map((inst, idx) => (
                    <div className="formRow" key={idx}>
                      <div className="field">
                        <label htmlFor={`inst-amount-${idx}`}>Amount</label>
                        <input
                          id={`inst-amount-${idx}`}
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={inst.amount}
                          onChange={(e) => updateInstallment(idx, 'amount', e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`inst-due-${idx}`}>Jatuh Tempo</label>
                        <input
                          id={`inst-due-${idx}`}
                          type="date"
                          required
                          value={inst.due_date}
                          onChange={(e) => updateInstallment(idx, 'due_date', e.target.value)}
                        />
                      </div>
                      {paymentScheme === '[Termin]' && installments.length > 1 && (
                        <button type="button" className="btn btnGhost btnSm" onClick={() => removeInstallment(idx)}>
                          Hapus
                        </button>
                      )}
                    </div>
                  ))}
                  {paymentScheme === '[Termin]' && (
                    <button type="button" className="btn btnSecondary btnSm" onClick={addInstallment}>
                      Tambah Termin
                    </button>
                  )}
                </div>
              )}

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button type="submit" className="btn btnPrimary" disabled={closeSubmitting}>
                  {closeSubmitting ? 'Memproses...' : 'Submit Closing'}
                </button>
                <button type="button" className="btn btnDanger" disabled={pending !== null} onClick={handleLost}>
                  {pending === 'lost' ? 'Memproses...' : 'Tandai Closed-Lost'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Alasan Not Qualified (terminal) */}
      {nq_reasons.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>Alasan Not Qualified</h2>
          </div>
          <ul>
            {nq_reasons.map((r, idx) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Riwayat versi proposal */}
      {proposals.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <h2>Riwayat Proposal Negosiasi</h2>
          </div>
          <div className="stack" style={{ gap: 14 }}>
            {proposals.map((p) => (
              <div key={p.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 600 }}>Versi {p.version_no}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(p.created_at)}</div>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Diajukan oleh: {p.proposed_by_nama || p.proposed_by}
                </div>
                {p.decision_note && (
                  <div style={{ marginTop: 6 }}>Catatan keputusan: {p.decision_note}</div>
                )}
                {p.lines.length > 0 && (
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Jasa</th>
                          <th>Proposed Price</th>
                          <th>Commission Rule</th>
                          <th>Payment Terms</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.lines.map((l, idx) => (
                          <tr key={`${l.master_service_id}-${idx}`}>
                            <td>{l.name || l.master_service_id}</td>
                            <td>{money(l.proposed_price)}</td>
                            <td>{l.commission_rule || '—'}</td>
                            <td>{l.payment_terms || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Riwayat audit (immutable) */}
      <section className="card">
        <div className="cardHeader">
          <h2>Riwayat Audit</h2>
        </div>
        {audit.length === 0 ? (
          <div className="emptyState">Belum ada riwayat.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Aktor</th>
                  <th>Aksi</th>
                  <th>Sebelum</th>
                  <th>Sesudah</th>
                  <th>Waktu</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry, idx) => (
                  <tr key={`${entry.created_at}-${idx}`}>
                    <td>{entry.actor_employee_id}</td>
                    <td>{entry.action}</td>
                    <td>{extractStatusLabel(entry.before_json) ?? summarizeJson(entry.before_json)}</td>
                    <td>{extractStatusLabel(entry.after_json) ?? summarizeJson(entry.after_json)}</td>
                    <td>{formatDateTime(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
