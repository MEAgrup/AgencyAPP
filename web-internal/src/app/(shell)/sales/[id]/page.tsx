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
  setNotQualified,
  submitNegotiation,
  type AttemptDetail,
  type ClosingInput,
  type NegotiationDecision,
  type ProposalLineInput,
  type Quote,
  type ServiceSelection,
} from '@/lib/sales';
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

interface LineRow {
  master_service_id: string;
  name: string;
  proposed_price: string;
  commission_rule: string;
  payment_terms: string;
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

  // --- Negotiation proposal editor (shared: submit @ Qualified, resubmit @ Revision/Rejected) ---
  const [showNegoEditor, setShowNegoEditor] = useState(false);
  const [propLines, setPropLines] = useState<LineRow[]>([]);
  const [negoSubmitting, setNegoSubmitting] = useState(false);
  const [negoError, setNegoError] = useState<string | null>(null);

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

  useEffect(() => {
    load();
    loadAudit();
  }, [load, loadAudit]);

  // Master services load once (only the picker at Contacted uses it; cheap + harmless elsewhere).
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
  // last proposal version (@ Revision / Rejected). Runs when the detail changes.
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
        })),
      );
    } else if ((s === S_REVISION || s === S_REJECTED) && detail.proposals.length > 0) {
      const last = detail.proposals[detail.proposals.length - 1];
      setPropLines(
        last.lines.map((l) => ({
          master_service_id: l.master_service_id,
          name: l.name,
          proposed_price: l.proposed_price,
          commission_rule: l.commission_rule,
          payment_terms: l.payment_terms ?? '',
        })),
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
    setQRows((rows) => (rows.length >= 5 ? rows : [...rows, { master_service_id: '', quantity: '', amount: '' }]));
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
  function updatePropLine(idx: number, field: keyof LineRow, value: string) {
    setPropLines((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function propPayload(): ProposalLineInput[] {
    return propLines.map((l) => ({
      master_service_id: l.master_service_id,
      proposed_price: l.proposed_price,
      commission_rule: l.commission_rule,
      payment_terms: l.payment_terms || undefined,
    }));
  }

  async function handleNoNego() {
    setNegoError(null);
    setNegoSubmitting(true);
    try {
      await submitNegotiation(id, [], true);
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
      await submitNegotiation(id, propPayload(), false);
      await load();
      await loadAudit();
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
      await resubmitNegotiation(id, propPayload());
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
                <label>Jasa Ditawarkan (maks 5)</label>
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
                    disabled={qRows.length >= 5}
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
            <button type="button" className="btn btnSecondary" disabled={negoSubmitting} onClick={handleNoNego}>
              {negoSubmitting && !showNegoEditor ? 'Memproses...' : 'No Negotiation Required'}
            </button>
            <button
              type="button"
              className={`btn ${showNegoEditor ? 'btnPrimary' : 'btnSecondary'}`}
              onClick={() => setShowNegoEditor((v) => !v)}
            >
              Negotiation Required
            </button>
          </div>
          {showNegoEditor && (
            <form className="form" onSubmit={handleSubmitNego} style={{ marginTop: 12 }}>
              <div className="table-wrap">
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
                    {propLines.map((l, idx) => (
                      <tr key={`${l.master_service_id}-${idx}`}>
                        <td>{l.name || l.master_service_id}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={l.proposed_price}
                            onChange={(e) => updatePropLine(idx, 'proposed_price', e.target.value)}
                            style={{ width: 150 }}
                          />
                        </td>
                        <td>
                          <input
                            value={l.commission_rule}
                            onChange={(e) => updatePropLine(idx, 'commission_rule', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            value={l.payment_terms}
                            onChange={(e) => updatePropLine(idx, 'payment_terms', e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
            <div className="table-wrap">
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
                  {propLines.map((l, idx) => (
                    <tr key={`${l.master_service_id}-${idx}`}>
                      <td>{l.name || l.master_service_id}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.proposed_price}
                          onChange={(e) => updatePropLine(idx, 'proposed_price', e.target.value)}
                          style={{ width: 150 }}
                        />
                      </td>
                      <td>
                        <input
                          value={l.commission_rule}
                          onChange={(e) => updatePropLine(idx, 'commission_rule', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={l.payment_terms}
                          onChange={(e) => updatePropLine(idx, 'payment_terms', e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="table-wrap">
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
                  {propLines.map((l, idx) => (
                    <tr key={`${l.master_service_id}-${idx}`}>
                      <td>{l.name || l.master_service_id}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.proposed_price}
                          onChange={(e) => updatePropLine(idx, 'proposed_price', e.target.value)}
                          style={{ width: 150 }}
                        />
                      </td>
                      <td>
                        <input
                          value={l.commission_rule}
                          onChange={(e) => updatePropLine(idx, 'commission_rule', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={l.payment_terms}
                          onChange={(e) => updatePropLine(idx, 'payment_terms', e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <button type="submit" className="btn btnSecondary" disabled={negoSubmitting}>
                {negoSubmitting ? 'Memproses...' : 'Resubmit Proposal'}
              </button>
            </div>
          </form>
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
