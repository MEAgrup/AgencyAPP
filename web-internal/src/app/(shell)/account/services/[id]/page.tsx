'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api';
import { createInterview } from '@/lib/interview';
import { useAuth } from '@/lib/auth-context';
import { LEVEL_STAFF, useAssignableEmployees } from '@/lib/directory';
import EmployeePicker from '@/components/EmployeePicker';
import PlanGatePanel from '@/components/PlanGatePanel';
import {
  BRIEF_DIVISIONS,
  GMV_ADJ_APPROVED,
  GMV_ADJ_PENDING,
  GMV_TOLERANCE,
  PRIORITIES,
  SERVICE_AWAITING_ONBOARDING,
  STRATEGY_APPROVED,
  TASK_CATALOG,
  TIER_LABELS,
  approveGmvAdjustment,
  createBrief,
  createStrategy,
  getService,
  isAccountLead,
  isAccountStaff,
  isReadOnlyOD,
  listServiceBriefs,
  listStrategies,
  nextOnboardingStep,
  setStrategyRequirement,
  submitStrategy,
  type Brief,
  type DivisionTask,
  type ServiceQueueRow,
  type Strategy,
} from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';
import { formatIDR } from '@/lib/money';
import { createStrategi, listStrategi, type Strategi } from '@/lib/strategi';

/**
 * QA(SESI31): the DECIDED delivery path is `STRG-` (M6A Strategi) + M6B (Plan),
 * not the M6 §4 `STR-` "Strategy & Plan". The lookalike STR- controls are hidden
 * from the Service hub so a QA user follows the 5-step flow (Riset Awal →
 * Interview → Strategi STRG- → Plan → Brief) without picking the wrong-but-
 * similar form.
 *
 * STR- is NOT retired (SESI31 keputusan #6, jebakan #7: "jangan matikan jalur
 * STR- sebelum UI web-internal pindah"). Its code and Brief gate stay wired —
 * flip this to `true` to expose the legacy STR- create/card/override controls
 * again (e.g. to QA the manual Brief path on a service that already has an
 * approved STR-). Retiring STR- for real is a separate DECISIONS.md entry.
 */
const SHOW_LEGACY_STR_PATH = false;

/**
 * QA(SESI31): the Service hub carries TWO "Kelola Klien" cards — the primary one
 * ("Riset Awal, Interview & Kualifikasi") actually STARTS the decided flow
 * (langkah 2–3: opens the riset-awal/interview session tied to THIS service),
 * while this second card is only a deep-link to the client page's interview tab
 * (the older per-client model). Two same-named cards confuse QA, so the
 * redundant shortcut is hidden. The client page stays reachable from the header
 * client link and the nav — flip to `true` to restore the convenience shortcut.
 */
const SHOW_CLIENT_INTERVIEW_SHORTCUT = false;

/** The human label for a stored task-satuan (divisi, jenis), or the raw jenis. */
function taskLabel(divisi: string, jenis: string): string {
  return (TASK_CATALOG[divisi] ?? []).find((t) => t.jenis === jenis)?.label ?? jenis;
}

/** Whether a task-satuan quota is a Rupiah amount (Ads spend) rather than a count. */
function taskIsMoney(divisi: string, jenis: string): boolean {
  return (TASK_CATALOG[divisi] ?? []).find((t) => t.jenis === jenis)?.money ?? false;
}

export default function ServiceHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);
  // Write forms (create Strategy/Brief, requirement override) belong to the
  // Account division (owner AM/lead) or Director — strategy.go:220-223,
  // brief.go:219-222. Execution-division staff/leads see this hub read-only;
  // owner-AM check stays server-side (final authority, CLAUDE.md #6).
  const canWrite =
    !readOnly && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);
  // Interview ("Kelola Klien" tab 1) is managed per-CLIENT, not per-service — the
  // create/open entry point lives on the client page (mirrors its canManageInterview
  // gate: assigned AM / Account lead / Director). This page only offers a shortcut
  // there, so a reader who lands on the Service hub can reach the interview without
  // navigating back to the client. No new API path — route-parity KNOWN_GAPS stays empty.
  const canManageInterview = isAccountStaff(role) || isAccountLead(role) || !!role?.director;
  // Clearing an out-of-tolerance GMV adjustment is the SPV/Head Account/Director
  // "ACC" gate (QA revisi) — the same authority level as Strategy approval.
  const canApproveGmv = !readOnly && (isAccountLead(role) || !!role?.director);

  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The Service row itself. Before it was fetched, this page inferred the
  // execution path from "does a Strategy row exist" — which reads a plan-gated
  // Service nobody has drafted yet as Direct, so it offered a Brief form the
  // server always rejected with [layanan ini wajib memiliki Strategy & Plan …].
  const [service, setService] = useState<ServiceQueueRow | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  // M6A Strategi (STRG-) — a different entity from `strategy` above; see the
  // card comment. Listed rather than singled out because Rule 13 makes versions
  // ROWS, so a Service legitimately has several.
  const [strategiList, setStrategiList] = useState<Strategi[]>([]);
  const [strategiError, setStrategiError] = useState<string | null>(null);

  // Create Strategi (STRG-) form — the canonical create door, promoted onto the
  // Service hub from the QA compare page (SESI31 keputusan #6). Header fields
  // only; Section A→J is filled on /account/strategi/{id} after creation.
  const [stgDurasi, setStgDurasi] = useState('');
  const [stgMulai, setStgMulai] = useState('');
  const [stgAkhir, setStgAkhir] = useState('');
  const [stgSiklus, setStgSiklus] = useState('');
  const [stgToleransi, setStgToleransi] = useState('20');
  const [stgSubmitting, setStgSubmitting] = useState(false);
  const [stgError, setStgError] = useState<string | null>(null);

  // Create Strategy form
  const [sObjective, setSObjective] = useState('');
  // Structured Target KPI (QA revisi): GMV (auto from client), ROAS, CTR, CVR.
  const [sGmv, setSGmv] = useState('');
  const [sRoas, setSRoas] = useState('');
  const [sCtr, setSCtr] = useState('');
  const [sCvr, setSCvr] = useState('');
  const [sGmvReason, setSGmvReason] = useState('');
  const [sKpiNote, setSKpiNote] = useState('');
  // Task-satuan quotas keyed `${divisi}::${jenis}` (QA revisi).
  const [sTasks, setSTasks] = useState<Record<string, string>>({});
  const [sDivisions, setSDivisions] = useState<string[]>([]);
  const [sOutline, setSOutline] = useState('');
  const [sStart, setSStart] = useState('');
  const [sEnd, setSEnd] = useState('');
  const [sSubmitting, setSSubmitting] = useState(false);
  const [sError, setSError] = useState<string | null>(null);
  const [sMessage, setSMessage] = useState<string | null>(null);

  // GMV approval (SPV/Head Account/Director clears an out-of-tolerance adjustment).
  const [gmvApproving, setGmvApproving] = useState(false);
  const [gmvApproveError, setGmvApproveError] = useState<string | null>(null);

  // Strategy requirement override
  const [reqValue, setReqValue] = useState(false);
  const [reqReason, setReqReason] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqMessage, setReqMessage] = useState<string | null>(null);

  // Interview ("Kelola Klien") launch — a write action for the same Account
  // door as the Brief/Strategy forms (mirrors canWriteInterview server-side).
  const [creatingInterview, setCreatingInterview] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);

  // Create Brief form
  const [bTitle, setBTitle] = useState('');
  const [bDivision, setBDivision] = useState<string>(BRIEF_DIVISIONS[0]);
  const [bPic, setBPic] = useState('');
  const [bDeliverable, setBDeliverable] = useState('');
  const [bQty, setBQty] = useState('');
  const [bDue, setBDue] = useState('');
  const [bPriority, setBPriority] = useState<string>(PRIORITIES[1]);
  const [bRecurring, setBRecurring] = useState(false);
  const [bFreq, setBFreq] = useState('');
  const [bCount, setBCount] = useState('');
  const [bEnd, setBEnd] = useState('');
  const [bInstructions, setBInstructions] = useState('');
  const [bRefs, setBRefs] = useState('');
  const [bAddendum, setBAddendum] = useState(false);
  const [bSubmitting, setBSubmitting] = useState(false);
  const [bError, setBError] = useState<string | null>(null);
  const [bMessage, setBMessage] = useState<string | null>(null);

  // PIC candidates follow the Brief's TARGET DIVISION (§5 Rule 1: the PIC must be
  // active staff of that division — `task.validatePicForDivision`). This is the
  // AM's cross-division door: Creative, Ads, KOL, Live Stream.
  const {
    employees: picCandidates,
    loading: picLoading,
    error: picError,
  } = useAssignableEmployees(bDivision, LEVEL_STAFF, canWrite);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listServiceBriefs(id);
      setBriefs(res.data);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadService = useCallback(async () => {
    setServiceError(null);
    try {
      const svc = await getService(id);
      setService(svc);
      // The override control shows the CURRENT effective requirement, so the AM
      // sees what they are changing instead of a checkbox that always reads "no".
      setReqValue(svc.requires_strategy_plan);
      // Target GMV flows down from the client's expectation (QA revisi). Prefill
      // it only while untouched, so a value the AM already typed is never clobbered.
      if (svc.client_target_gmv) {
        setSGmv((prev) => (prev === '' ? svc.client_target_gmv ?? '' : prev));
      }
    } catch (err) {
      setServiceError(errorMessage(err));
    }
  }, [id]);

  const loadStrategy = useCallback(async () => {
    setStrategyError(null);
    try {
      const res = await listStrategies();
      setStrategy(res.data.find((s) => s.service_id === id) ?? null);
    } catch (err) {
      setStrategyError(errorMessage(err));
    }
  }, [id]);

  const loadStrategi = useCallback(async () => {
    setStrategiError(null);
    try {
      setStrategiList(await listStrategi(id));
    } catch (err) {
      setStrategiError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    load();
    loadService();
    loadStrategy();
    loadStrategi();
  }, [load, loadService, loadStrategy, loadStrategi]);

  function toggleSDivision(div: string) {
    setSDivisions((prev) => (prev.includes(div) ? prev.filter((d) => d !== div) : [...prev, div]));
  }

  // The client's expectation and the AM's deviation from it, for the ±20% gate UI.
  const clientGmv = service?.client_target_gmv ? Number(service.client_target_gmv) : 0;
  const gmvNum = sGmv.trim() === '' ? clientGmv : Number(sGmv);
  const gmvDeviation = clientGmv > 0 && !Number.isNaN(gmvNum) ? (gmvNum - clientGmv) / clientGmv : 0;
  const gmvOutOfTolerance = clientGmv > 0 && Math.abs(gmvDeviation) > GMV_TOLERANCE + 1e-9;

  /** Build division_tasks from the selected divisions' non-empty quota inputs. */
  function collectTasks(): DivisionTask[] {
    const tasks: DivisionTask[] = [];
    for (const divisi of sDivisions) {
      for (const t of TASK_CATALOG[divisi] ?? []) {
        const jumlah = (sTasks[`${divisi}::${t.jenis}`] ?? '').trim();
        if (jumlah !== '') tasks.push({ divisi, jenis: t.jenis, jumlah });
      }
    }
    return tasks;
  }

  async function handleCreateStrategy(e: FormEvent) {
    e.preventDefault();
    setSError(null);
    setSMessage(null);
    setSSubmitting(true);
    try {
      const res = await createStrategy(id, {
        objective: sObjective,
        target_kpi: sKpiNote,
        target_gmv: sGmv.trim() === '' ? null : sGmv.trim(),
        target_roas: sRoas.trim() === '' ? null : sRoas.trim(),
        target_ctr: sCtr.trim() === '' ? null : sCtr.trim(),
        target_cvr: sCvr.trim() === '' ? null : sCvr.trim(),
        gmv_adjustment_reason: sGmvReason.trim() === '' ? null : sGmvReason.trim(),
        division_tasks: collectTasks(),
        divisions_involved: sDivisions,
        planned_brief_outline: sOutline,
        timeline_start: sStart,
        timeline_end: sEnd,
      });
      setStrategy(res);
      // Saving IS submitting (QA revisi): the AM no longer clicks a separate
      // "Ajukan" button. The one exception is an out-of-tolerance GMV adjustment,
      // which the submit gate blocks until Head/SPV ACCs it — there the Plan stays
      // a draft and the AM is told why, rather than firing a submit the server
      // would reject with [penyesuaian target GMV … menunggu persetujuan Head/SPV].
      if (res.gmv_adjustment_status === GMV_ADJ_PENDING) {
        setSMessage(
          `Strategy & Plan ${res.id} disimpan sebagai draft. Penyesuaian target GMV di luar ±20% ` +
            'menunggu ACC Head/SPV — setelah di-ACC, ajukan dari halaman Strategy & Plan.',
        );
      } else {
        await submitStrategy(res.id);
        setSMessage(`Strategy & Plan ${res.id} disimpan dan diajukan untuk persetujuan.`);
      }
      await loadStrategy();
    } catch (err) {
      setSError(errorMessage(err));
    } finally {
      setSSubmitting(false);
    }
  }

  async function handleCreateStrategi(e: FormEvent) {
    e.preventDefault();
    setStgError(null);
    setStgSubmitting(true);
    try {
      // Prints STRG- (and, if the Service has no contract yet, a CTR- via
      // ensureContractForService). Both are audit-logged, no delete path.
      const res = await createStrategi(id, {
        durasi_kontrak_bulan: Number(stgDurasi),
        tanggal_mulai_kontrak: stgMulai,
        tanggal_akhir_kontrak: stgAkhir,
        tanggal_mulai_siklus: stgSiklus.trim() === '' ? null : stgSiklus,
        toleransi_over_persen: stgToleransi.trim() === '' ? null : Number(stgToleransi),
      });
      await loadStrategi();
      // Continue into Section A→J — the header alone is not a usable Strategi.
      router.push(`/account/strategi/${res.id}`);
    } catch (err) {
      setStgError(errorMessage(err));
      setStgSubmitting(false);
    }
  }

  async function handleApproveGmv() {
    if (!strategy) return;
    setGmvApproveError(null);
    setGmvApproving(true);
    try {
      await approveGmvAdjustment(strategy.id);
      await loadStrategy();
    } catch (err) {
      setGmvApproveError(errorMessage(err));
    } finally {
      setGmvApproving(false);
    }
  }

  async function handleOverride(e: FormEvent) {
    e.preventDefault();
    setReqError(null);
    setReqMessage(null);
    setReqSubmitting(true);
    try {
      const res = await setStrategyRequirement(id, reqValue, reqReason);
      setReqMessage(
        `Kebutuhan Strategy & Plan diset ke ${res.requires_strategy_plan ? 'wajib' : 'tidak wajib'} (pin MSL: ${res.pinned_requires_strategy_plan ? 'wajib' : 'tidak wajib'}).`,
      );
      setReqReason('');
      // The execution path just changed — refetch so the header, the next-step
      // hint and the Brief form stop describing the old path.
      await loadService();
    } catch (err) {
      setReqError(errorMessage(err));
    } finally {
      setReqSubmitting(false);
    }
  }

  // The EFFECTIVE gate from the Service row (override ∨ MSL pin, M6-OA-1) — the
  // same value `guardBriefCreation` enforces server-side. The old "a Strategy row
  // exists" guess is kept only as a fallback for the window where the Service read
  // failed (e.g. an execution-division actor who may read Briefs but not the
  // Service), so the page degrades instead of mislabelling everything Direct.
  const planGated = service ? service.requires_strategy_plan : strategy !== null;
  const approvedStrategy = strategy?.status === STRATEGY_APPROVED ? strategy : null;
  // The two §4 write doors are only open at [Awaiting Onboarding] (createStrategy /
  // setStrategyRequirement both reject otherwise, MSG_SERVICE_NOT_AWAITING). When
  // the Service read is unavailable, fall back to permissive and let the server
  // answer — hiding a control that would have worked is the worse failure.
  const awaitingOnboarding = service ? service.status === SERVICE_AWAITING_ONBOARDING : true;
  const step = service ? nextOnboardingStep(service) : null;

  async function handleOpenInterview() {
    if (!service) return;
    // Opening Kelola Klien STARTS riset awal (langkah 1); the call resumes this
    // service's open session if there is one, so the clock is never reset.
    if (!window.confirm('Buka Kelola Klien untuk layanan ini? Riset awal mulai terhitung sejak sekarang.')) {
      return;
    }
    setInterviewError(null);
    setCreatingInterview(true);
    try {
      // Link the interview to this Service (and its client). Only client_id +
      // service_id are set; the contract is not required to open one.
      const detail = await createInterview({ client_id: service.client_id, service_id: id });
      router.push(`/account/interview/${detail.interview.id}`);
    } catch (err) {
      setInterviewError(errorMessage(err));
      setCreatingInterview(false);
    }
  }

  /**
   * Prefill the Brief form from one approved-Plan task-satuan (QA revisi). The AM
   * should not re-type quotas the Plan already committed to — clicking a task loads
   * its division, a sensible title, the deliverable, and the target quantity, and
   * the AM only completes what the Plan does not carry (due date, PIC, priority,
   * instructions). Changing the division clears the PIC (a Creative staffer is not
   * a valid PIC for an Ads Brief, §5 Rule 1), same as the division <select> does.
   */
  function prefillBriefFromTask(t: DivisionTask) {
    const label = taskLabel(t.divisi, t.jenis);
    setBDivision(t.divisi);
    setBPic('');
    setBTitle(`${t.divisi} — ${label}`);
    setBDeliverable(label);
    setBQty(t.jumlah);
    setBError(null);
    setBMessage(
      `Form terisi dari Strategy & Plan (${t.divisi} · ${label}). Lengkapi due date, PIC, dan detail lain, lalu buat Brief.`,
    );
  }

  async function handleCreateBrief(e: FormEvent) {
    e.preventDefault();
    setBError(null);
    setBMessage(null);
    setBSubmitting(true);
    try {
      const res = await createBrief(id, {
        title: bTitle,
        // Plan-gated: locked to the APPROVED Strategy only (brief gotcha #6,
        // ErrBriefStrategyMismatch) — never fall back to a non-approved draft.
        strategy_id: planGated ? (approvedStrategy?.id ?? '') : '',
        assigned_division: bDivision,
        assigned_pic: bPic || undefined,
        deliverable_type: bDeliverable,
        quantity_target: Number(bQty),
        due_date: bDue,
        priority: bPriority,
        recurring: bRecurring,
        recurring_frequency: bRecurring ? bFreq : undefined,
        recurring_count: bRecurring ? Number(bCount) : undefined,
        recurring_end_date: bRecurring ? bEnd : undefined,
        instructions: bInstructions || undefined,
        reference_attachments: bRefs || undefined,
        is_addendum: planGated ? bAddendum : undefined,
      });
      setBMessage(`Brief ${res.id} berhasil dibuat.`);
      setBTitle('');
      setBDeliverable('');
      setBQty('');
      setBDue('');
      setBPic('');
      setBInstructions('');
      setBRefs('');
      setBAddendum(false);
      await load();
    } catch (err) {
      setBError(errorMessage(err));
    } finally {
      setBSubmitting(false);
    }
  }

  if (loading) return <div className="pageLoading">Memuat...</div>;

  if (loadError || briefs === null) {
    return (
      <div className="stack">
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
        <div className="alert alertError" role="alert">{loadError ?? 'Layanan tidak ditemukan.'}</div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <Link href="/account" className="muted">&larr; Kembali ke Account</Link>
      </div>

      <div>
        <h1>{service ? service.name : `Layanan ${id}`}</h1>
        <p className="muted">
          {service ? (
            <>
              {id} &middot;{' '}
              <Link href={`/clients/${encodeURIComponent(service.client_id)}`}>
                {service.toko || service.client_id}
              </Link>
            </>
          ) : (
            id
          )}
          {' '}&mdash; Riset Awal, Strategi &amp; Brief untuk layanan ini.
        </p>
        {/* The QA compare page (STR- vs STRG-) stays reachable only while the
            legacy STR- path is exposed — for everyone else it is noise that
            invites picking the retired-in-practice entity. */}
        {SHOW_LEGACY_STR_PATH && (
          <p className="muted" style={{ fontSize: 12 }}>
            <Link href={`/account/services/${encodeURIComponent(id)}/qa-jalur-plan`}>
              QA · bandingkan jalur Strategy &amp; Plan (STR-) vs Strategi M6A (STRG-)
            </Link>
          </p>
        )}
      </div>

      {/* Orientation: the decided delivery path (SESI31). Keeps a QA user on the
          5-step flow instead of hunting for the right form. */}
      <div className="alert alertInfo" role="status">
        <strong>Alur layanan (5 langkah):</strong> Riset Awal → Interview → Strategi
        (STRG-, perlu ACC Head/SPV) → Plan → Brief satu-klik. Mulai dari{' '}
        <strong>&ldquo;Kelola Klien (mulai riset awal)&rdquo;</strong> di bawah.
      </div>

      {serviceError && <div className="alert alertError" role="alert">{serviceError}</div>}

      {/* The onboarding state of THIS service, in the order the gates run. It
          names the next door explicitly: the AM's complaint was never that the
          forms were missing, it was that nothing said which one applies. */}
      {service && (
        <section className="card">
          <div className="cardHeader">
            <h2>Status Onboarding</h2>
            <StatusBadge status={service.status} />
          </div>
          <div className="grid2">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Jalur Eksekusi</div>
              <div>
                {service.plan_determination_pending
                  ? 'Belum ditentukan — isi form Penentuan Kebutuhan Plan'
                  : service.requires_strategy_plan
                    ? 'Plan-gated (wajib Strategy & Plan)'
                    : 'Direct (tanpa Plan)'}
                {service.overridden && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {' '}&middot; override dari pin MSL (
                    {service.pinned_requires_strategy_plan ? 'wajib' : 'tidak wajib'})
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Tier katalog: {TIER_LABELS[service.plan_tier]}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Langkah Berikutnya</div>
              <div>{step?.label ?? '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Jumlah Brief</div>
              <div>{service.brief_count}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>AM Pemilik</div>
              <div>{service.assigned_am_id || 'Belum ditugaskan'}</div>
            </div>
          </div>
          {step?.kind === 'await_approval' && (
            <p className="muted" style={{ fontSize: 13 }}>
              Plan sudah diajukan. Persetujuan ada di SPV/Head Account (M6 §4 Rule 4) &mdash; Brief baru bisa
              dibuat setelah Plan disetujui.
            </p>
          )}
        </section>
      )}

      {/* Interview / Kelola Klien launch. The interview qualifies the client and
          feeds the Strategy that follows, so its entry point belongs on the
          Service hub too — not only on the Client Record. Without a door here the
          page reads as "view only" for a step the AM actually starts from here. */}
      {service && canWrite && (
        <section className="card">
          <div className="cardHeader">
            <h2>Kelola Klien · Riset Awal, Interview &amp; Kualifikasi</h2>
          </div>
          {interviewError && <div className="alert alertError" role="alert">{interviewError}</div>}
          <p className="muted" style={{ fontSize: 13 }}>
            Tiga langkah: <strong>riset awal</strong> (login toko klien &amp; catat data baseline),
            <strong>interview</strong> (Blok A–B, kualifikasi — skor &amp; verdict advisory), lalu
            <strong>strategi</strong>. Waktu riset awal mulai terhitung begitu halaman dibuka. Sesi
            ditautkan ke layanan ini.
          </p>
          <button
            type="button"
            className="btn btnPrimary"
            disabled={creatingInterview}
            onClick={handleOpenInterview}
          >
            {creatingInterview ? 'Membuka…' : 'Kelola Klien (mulai riset awal)'}
          </button>
        </section>
      )}

      {/* M6C — the plan-gate determination. Mounted ABOVE Strategy & Plan because
          it is the gate that decides whether a Strategy is needed at all. Shown
          for every tier (read-only on the two locked ones) so the AM can see why
          there is or is not a form. */}
      {service && (
        <PlanGatePanel
          serviceId={id}
          canWrite={canWrite}
          canDeescalate={!readOnly && (isAccountLead(role) || !!role?.director)}
          onDecided={async () => {
            // The execution path just changed — refetch so the header, the next
            // step and the Brief form stop describing the old path.
            await loadService();
            await loadStrategy();
          }}
        />
      )}

      {SHOW_LEGACY_STR_PATH && (
      <section className="card">
        <div className="cardHeader">
          <h2>Strategy &amp; Plan</h2>
        </div>
        {strategyError && <div className="alert alertError" role="alert">{strategyError}</div>}
        {strategy ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <Link href={`/account/strategies/${strategy.id}`}>{strategy.id}</Link>
                <div className="muted" style={{ fontSize: 12 }}>{strategy.objective || '—'}</div>
              </div>
              <StatusBadge status={strategy.status} />
            </div>

            {/* Structured Target KPI (QA revisi) — the four fixed points. */}
            <div className="grid2">
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Target GMV</div>
                <div>{formatIDR(strategy.target_gmv)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Target ROAS</div>
                <div>{strategy.target_roas ?? '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Target CTR (%)</div>
                <div>{strategy.target_ctr ?? '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Target CVR (%)</div>
                <div>{strategy.target_cvr ?? '—'}</div>
              </div>
            </div>

            {/* GMV adjustment gate (±20% vs the client's expectation). */}
            {strategy.gmv_adjustment_status !== 'dalam_toleransi' && (
              <div
                className={`alert ${strategy.gmv_adjustment_status === GMV_ADJ_APPROVED ? 'alertSuccess' : 'alertInfo'}`}
                role="status"
              >
                <div>
                  Penyesuaian target GMV di luar toleransi 20% (klien: {formatIDR(strategy.client_target_gmv)}) &mdash;{' '}
                  {strategy.gmv_adjustment_status === GMV_ADJ_APPROVED
                    ? `disetujui oleh ${strategy.gmv_adjustment_approved_by || 'Head/SPV'}.`
                    : 'menunggu ACC Head/SPV. Plan belum bisa diajukan.'}
                </div>
                {strategy.gmv_adjustment_reason && (
                  <div className="muted" style={{ fontSize: 12 }}>Alasan: {strategy.gmv_adjustment_reason}</div>
                )}
                {gmvApproveError && <div className="alert alertError" role="alert">{gmvApproveError}</div>}
                {canApproveGmv && strategy.gmv_adjustment_status === GMV_ADJ_PENDING && (
                  <button
                    type="button"
                    className="btn btnSecondary"
                    disabled={gmvApproving}
                    onClick={handleApproveGmv}
                    style={{ marginTop: 6 }}
                  >
                    {gmvApproving ? 'Menyetujui…' : 'ACC penyesuaian GMV (Head/SPV)'}
                  </button>
                )}
              </div>
            )}

            {/* Task-satuan per division — what the AM turns into Briefs (M6B P3). */}
            {strategy.division_tasks.length > 0 && (
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Strategi &mdash; task satuan per divisi</div>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {strategy.division_tasks.map((t) => (
                    <li key={`${t.divisi}::${t.jenis}`}>
                      {t.divisi} &middot; {taskLabel(t.divisi, t.jenis)}:{' '}
                      <strong>{taskIsMoney(t.divisi, t.jenis) ? formatIDR(t.jumlah) : t.jumlah}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="muted">Belum ada Strategy &amp; Plan untuk layanan ini.</p>
        )}
      </section>
      )}

      {/* M6A Strategi (STRG-) — the DECIDED strategy entity (SESI31 keputusan #6).
          This is the canonical card; the M6 §4 STR- "Strategy & Plan" card above
          is hidden by default so the two lookalikes no longer compete. The create
          door (below) was promoted here from the QA page — `/account/strategi/{id}`
          has no other entry point. */}
      <section className="card">
        <div className="cardHeader">
          <h2>Strategi (STRG-)</h2>
        </div>
        {strategiError && <div className="alert alertError" role="alert">{strategiError}</div>}
        {strategiList.length === 0 ? (
          <p className="muted">Belum ada Strategi untuk layanan ini.</p>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {strategiList.map((st) => (
              <div key={st.id} className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <Link href={`/account/strategi/${st.id}`}>{st.id}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>versi {st.versi_no}</div>
                </div>
                <StatusBadge status={st.status} />
              </div>
            ))}
          </div>
        )}

        {/* Canonical create door (promoted from the QA page). Header fields only;
            Section A→J is completed on the Strategi page after creation. Same
            gates as STR- once did: plan-gated, no Strategi yet, still
            [Awaiting Onboarding]. Direct services never get a Strategi. */}
        {canWrite &&
          planGated &&
          awaitingOnboarding &&
          strategiList.length === 0 &&
          !service?.plan_determination_pending && (
            <form className="form" onSubmit={handleCreateStrategi} style={{ marginTop: 12 }}>
              <div className="alert alertInfo" role="status">
                Membuat header Strategi (<code>STRG-</code>) untuk layanan ini
                {' '}&mdash; kalau belum ada kontrak, satu <code>CTR-</code> ikut dibuat. Lanjutkan
                Section A→J di halaman Strategi setelah ini. Perlu ACC Head/SPV sebelum aktif.
              </div>
              {stgError && <div className="alert alertError" role="alert">{stgError}</div>}
              <div className="formRow">
                <div className="field">
                  <label htmlFor="stg-durasi">Durasi kontrak (bulan)</label>
                  <input
                    id="stg-durasi"
                    type="number"
                    min="1"
                    required
                    value={stgDurasi}
                    onChange={(e) => setStgDurasi(e.target.value)}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Menentukan berapa periode Plan lahir saat Strategi disetujui (M6B Rule 1).
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="stg-toleransi">Toleransi over-komitmen (%)</label>
                  <input
                    id="stg-toleransi"
                    type="number"
                    min="0"
                    step="1"
                    value={stgToleransi}
                    onChange={(e) => setStgToleransi(e.target.value)}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>M6A D16 &mdash; default 20.</span>
                </div>
              </div>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="stg-mulai">Tanggal mulai kontrak</label>
                  <input
                    id="stg-mulai"
                    type="date"
                    required
                    value={stgMulai}
                    onChange={(e) => setStgMulai(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="stg-akhir">Tanggal akhir kontrak</label>
                  <input
                    id="stg-akhir"
                    type="date"
                    required
                    value={stgAkhir}
                    onChange={(e) => setStgAkhir(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="stg-siklus">Tanggal mulai siklus (G-0, opsional)</label>
                <input
                  id="stg-siklus"
                  type="date"
                  value={stgSiklus}
                  onChange={(e) => setStgSiklus(e.target.value)}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  Kosongkan untuk memakai tanggal mulai kontrak. Beku setelah periode 1 tutup (Rule 17).
                </span>
              </div>
              <div>
                <button type="submit" className="btn btnPrimary" disabled={stgSubmitting}>
                  {stgSubmitting ? 'Membuat…' : 'Buat Strategi (STRG-)'}
                </button>
              </div>
            </form>
          )}
      </section>

      {/* Interview ("Kelola Klien") shortcut. Interview is a per-CLIENT record
          (M6 Interview §I1), so the create/open door stays on the client page;
          this is only a deep-link there so the Service hub is not a dead end for
          someone who needs the client's qualification. Hidden by default (SESI31)
          as a duplicate of the primary "Kelola Klien" card above. */}
      {SHOW_CLIENT_INTERVIEW_SHORTCUT && service && canManageInterview && (
        <section className="card">
          <div className="cardHeader">
            <h2>Kelola Klien &middot; Interview &amp; Kualifikasi</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Interview &amp; kualifikasi dikelola di tingkat klien (bukan per layanan). Buka halaman
            klien untuk membuat / melanjutkan interview, menghitung skor &amp; verdict advisory, dan
            menandai prasyarat.
          </p>
          <Link
            href={`/clients/${encodeURIComponent(service.client_id)}#interview`}
            className="btn btnPrimary btnSm"
          >
            Buka Kelola Klien
          </Link>
        </section>
      )}

      {/* §4 Rule 1/6 + createStrategy's own gates: plan-gated only, no Plan yet,
          Service still [Awaiting Onboarding]. A Direct service has no Plan, ever.
          Hidden by default (SESI31): the decided create door is Strategi (STRG-)
          above; this legacy STR- form only shows with SHOW_LEGACY_STR_PATH on. */}
      {SHOW_LEGACY_STR_PATH && !strategy && canWrite && planGated && awaitingOnboarding && !service?.plan_determination_pending && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Strategy &amp; Plan</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Layanan ini plan-gated: Plan wajib dibuat, diajukan, dan disetujui SPV sebelum Brief bisa dibuat
            (M6 §4 Rule 5). Menyimpan Plan otomatis mengajukannya untuk persetujuan &mdash; tidak perlu langkah
            &ldquo;ajukan&rdquo; terpisah.
          </p>
          <form className="form" onSubmit={handleCreateStrategy}>
            {sError && <div className="alert alertError" role="alert">{sError}</div>}
            {sMessage && <div className="alert alertSuccess" role="status">{sMessage}</div>}
            <div className="field">
              <label htmlFor="cs-objective">Objective</label>
              <textarea id="cs-objective" required value={sObjective} onChange={(e) => setSObjective(e.target.value)} />
            </div>

            {/* Target KPI — the four fixed points (QA revisi). GMV anchors on the
                client's expectation and may move within ±20% freely. */}
            <fieldset style={{ border: '1px solid var(--border, #ddd)', padding: 12 }}>
              <legend style={{ fontSize: 13 }}>Target KPI</legend>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="cs-gmv">Target GMV (Rp)</label>
                  <input
                    id="cs-gmv"
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={sGmv}
                    onChange={(e) => setSGmv(e.target.value)}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {clientGmv > 0
                      ? `Target klien (dari Sales): ${formatIDR(service?.client_target_gmv ?? null)}`
                      : 'Klien belum menetapkan target GMV — tidak ada batas toleransi.'}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="cs-roas">Target ROAS</label>
                  <input id="cs-roas" type="number" min="0" step="0.01" value={sRoas} onChange={(e) => setSRoas(e.target.value)} />
                </div>
              </div>
              <div className="formRow">
                <div className="field">
                  <label htmlFor="cs-ctr">Target CTR (%)</label>
                  <input id="cs-ctr" type="number" min="0" step="0.001" value={sCtr} onChange={(e) => setSCtr(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="cs-cvr">Target CVR (%)</label>
                  <input id="cs-cvr" type="number" min="0" step="0.001" value={sCvr} onChange={(e) => setSCvr(e.target.value)} />
                </div>
              </div>
              {clientGmv > 0 && sGmv.trim() !== '' && (
                <p className="muted" style={{ fontSize: 12 }}>
                  Penyesuaian GMV: {gmvDeviation >= 0 ? '+' : ''}
                  {(gmvDeviation * 100).toFixed(1)}% dari target klien.
                </p>
              )}
              {gmvOutOfTolerance && (
                <div className="field">
                  <label htmlFor="cs-gmv-reason">
                    Alasan penyesuaian GMV di luar ±20% (wajib — perlu ACC Head/SPV)
                  </label>
                  <textarea
                    id="cs-gmv-reason"
                    required
                    value={sGmvReason}
                    onChange={(e) => setSGmvReason(e.target.value)}
                  />
                  <span className="muted" style={{ fontSize: 12 }}>
                    Di luar toleransi 20%: Plan tidak bisa diajukan sampai Head/SPV meng-ACC. Semua tercatat di log.
                  </span>
                </div>
              )}
              <div className="field">
                <label htmlFor="cs-kpi-note">Catatan KPI (opsional)</label>
                <textarea id="cs-kpi-note" value={sKpiNote} onChange={(e) => setSKpiNote(e.target.value)} />
              </div>
            </fieldset>

            <div className="field">
              <label>Divisi Terlibat (min. 1)</label>
              <div className="stack" style={{ gap: 6 }}>
                {BRIEF_DIVISIONS.map((div) => (
                  <label key={div} className="row" style={{ gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={sDivisions.includes(div)} onChange={() => toggleSDivision(div)} />
                    {div}
                  </label>
                ))}
              </div>
            </div>

            {/* Strategi — task satuan per involved division (QA revisi). These
                become Briefs to the execution side (M6B P3). */}
            {sDivisions.some((d) => (TASK_CATALOG[d] ?? []).length > 0) && (
              <fieldset style={{ border: '1px solid var(--border, #ddd)', padding: 12 }}>
                <legend style={{ fontSize: 13 }}>Strategi &mdash; Task Satuan per Divisi</legend>
                {sDivisions.map((divisi) =>
                  (TASK_CATALOG[divisi] ?? []).length === 0 ? null : (
                    <div key={divisi} className="stack" style={{ gap: 6, marginBottom: 8 }}>
                      <div className="muted" style={{ fontSize: 12 }}>{divisi}</div>
                      <div className="formRow">
                        {(TASK_CATALOG[divisi] ?? []).map((t) => {
                          const key = `${divisi}::${t.jenis}`;
                          return (
                            <div key={key} className="field">
                              <label htmlFor={`cs-task-${key}`}>{t.label}</label>
                              <input
                                id={`cs-task-${key}`}
                                type="number"
                                min="0"
                                step={t.money ? '1' : '1'}
                                value={sTasks[key] ?? ''}
                                onChange={(e) => setSTasks((prev) => ({ ...prev, [key]: e.target.value }))}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ),
                )}
              </fieldset>
            )}

            <div className="field">
              <label htmlFor="cs-outline">Outline Brief Terencana</label>
              <textarea id="cs-outline" required value={sOutline} onChange={(e) => setSOutline(e.target.value)} />
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="cs-start">Timeline Mulai</label>
                <input id="cs-start" type="date" required value={sStart} onChange={(e) => setSStart(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="cs-end">Timeline Selesai</label>
                <input id="cs-end" type="date" required value={sEnd} onChange={(e) => setSEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <button type="submit" className="btn btnPrimary" disabled={sSubmitting}>
                {sSubmitting ? 'Menyimpan & mengajukan...' : 'Simpan & Ajukan Strategy & Plan'}
              </button>
            </div>
          </form>
        </section>
      )}

      {SHOW_LEGACY_STR_PATH && !strategy && canWrite && awaitingOnboarding && !service?.plan_determination_pending && (
        <section className="card">
          <div className="cardHeader">
            <h2>Override Kebutuhan Strategy &amp; Plan</h2>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            Hanya bisa saat belum ada Strategy &amp; Plan dan layanan masih [Awaiting Onboarding]. Alasan wajib.
            Pin Master Service List tidak berubah &mdash; override ini berlaku untuk engagement ini saja
            (M6-OA-1).
          </p>
          <form className="form" onSubmit={handleOverride}>
            {reqError && <div className="alert alertError" role="alert">{reqError}</div>}
            {reqMessage && <div className="alert alertSuccess" role="status">{reqMessage}</div>}
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={reqValue} onChange={(e) => setReqValue(e.target.checked)} />
              Wajib memiliki Strategy &amp; Plan
            </label>
            <div className="field">
              <label htmlFor="req-reason">Alasan</label>
              <input id="req-reason" required value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
            </div>
            <div>
              <button type="submit" className="btn btnSecondary" disabled={reqSubmitting}>
                {reqSubmitting ? 'Menyimpan...' : 'Simpan Override'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* A voided Service (M4-OA-5) has no live path left — createBrief rejects it
          with [brief tidak dapat dibuat untuk layanan pada status ini]. */}
      {canWrite && step?.kind !== 'none' && step?.kind !== 'determine_plan' && (
        <section className="card">
          <div className="cardHeader">
            <h2>Buat Brief</h2>
          </div>
          {planGated && !approvedStrategy && (
            <div className="alert alertInfo" role="status">
              Layanan plan-gated: pada alur yang diputuskan, Brief <strong>diwarisi satu-klik dari
              Plan</strong> setelah Strategi (STRG-) disetujui &amp; Plan diaktifkan (M6B). Mulai dari{' '}
              <strong>Strategi (STRG-)</strong> di atas.
              {SHOW_LEGACY_STR_PATH &&
                ' (Jalur lama STR-: Brief manual baru bisa dibuat setelah Strategy & Plan disetujui SPV/Head Account, M6 §4 Rule 5.)'}
            </div>
          )}

          {/* Isi cepat dari Plan yang disetujui (QA revisi): setiap task satuan di
              Strategy & Plan bisa dipakai untuk mengisi form Brief, agar AM tidak
              mengetik ulang kuota yang sudah ditetapkan. */}
          {approvedStrategy && approvedStrategy.division_tasks.length > 0 && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Isi cepat dari Strategy &amp; Plan &middot;{' '}
                <Link href={`/account/strategies/${approvedStrategy.id}`}>{approvedStrategy.id}</Link>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Task satuan per divisi dari Plan yang disetujui. Klik <strong>Gunakan</strong> untuk mengisi
                Divisi, Judul, Deliverable, dan Target &mdash; Anda tinggal melengkapi due date, PIC, prioritas,
                dan detail lainnya.
              </p>
              <div className="stack" style={{ gap: 6 }}>
                {approvedStrategy.division_tasks.map((t) => {
                  const label = taskLabel(t.divisi, t.jenis);
                  const money = taskIsMoney(t.divisi, t.jenis);
                  return (
                    <div
                      key={`${t.divisi}::${t.jenis}`}
                      className="row"
                      style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
                    >
                      <div style={{ fontSize: 13 }}>
                        {t.divisi} &middot; {label}:{' '}
                        <strong>{money ? formatIDR(t.jumlah) : t.jumlah}</strong>
                      </div>
                      <button
                        type="button"
                        className="btn btnSecondary btnSm"
                        onClick={() => prefillBriefFromTask(t)}
                      >
                        Gunakan
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <form className="form" onSubmit={handleCreateBrief}>
            {bError && <div className="alert alertError" role="alert">{bError}</div>}
            {bMessage && <div className="alert alertSuccess" role="status">{bMessage}</div>}
            <div className="field">
              <label htmlFor="b-title">Judul</label>
              <input id="b-title" required value={bTitle} onChange={(e) => setBTitle(e.target.value)} />
            </div>
            {planGated ? (
              <div className="field">
                <label htmlFor="b-strategy">Strategy ID (plan-gated, terkunci)</label>
                <input
                  id="b-strategy"
                  readOnly
                  value={approvedStrategy?.id ?? ''}
                />
                {!approvedStrategy && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Strategy &amp; Plan belum disetujui &mdash; Brief hanya dapat dibuat setelah disetujui.
                  </span>
                )}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12 }}>Layanan Direct-path &mdash; tanpa Strategy ID.</p>
            )}
            <div className="formRow">
              <div className="field">
                <label htmlFor="b-division">Divisi Tujuan</label>
                {/* Changing the target division INVALIDATES the chosen PIC: a
                    Creative staffer is not a valid PIC for an Ads Brief (§5 Rule
                    1), so it is cleared here rather than sent and rejected. */}
                <select
                  id="b-division"
                  value={bDivision}
                  onChange={(e) => {
                    setBDivision(e.target.value);
                    setBPic('');
                  }}
                >
                  {BRIEF_DIVISIONS.map((div) => (
                    <option key={div} value={div}>{div}</option>
                  ))}
                </select>
              </div>
              <EmployeePicker
                id="b-pic"
                label={`PIC divisi ${bDivision}`}
                employees={picCandidates}
                loading={picLoading}
                error={picError}
                value={bPic}
                onChange={setBPic}
                emptyHint={`Belum ada staff aktif di divisi ${bDivision}. Brief tetap bisa dibuat tanpa PIC — SPV/Lead divisi tujuan yang menetapkannya nanti di papan Brief.`}
              />
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="b-deliverable">Deliverable Type</label>
                <input id="b-deliverable" required value={bDeliverable} onChange={(e) => setBDeliverable(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="b-qty">Quantity / Target</label>
                <input id="b-qty" type="number" min="1" required value={bQty} onChange={(e) => setBQty(e.target.value)} />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="b-due">Due Date</label>
                <input id="b-due" type="date" required value={bDue} onChange={(e) => setBDue(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="b-priority">Prioritas</label>
                <select id="b-priority" value={bPriority} onChange={(e) => setBPriority(e.target.value)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={bRecurring} onChange={(e) => setBRecurring(e.target.checked)} />
              Brief berulang (recurring)
            </label>
            {bRecurring && (
              <div className="formRow">
                <div className="field">
                  <label htmlFor="b-freq">Frekuensi</label>
                  <input id="b-freq" required value={bFreq} onChange={(e) => setBFreq(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="b-count">Jumlah</label>
                  <input id="b-count" type="number" min="1" required value={bCount} onChange={(e) => setBCount(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="b-recur-end">Tanggal Berakhir</label>
                  <input id="b-recur-end" type="date" required value={bEnd} onChange={(e) => setBEnd(e.target.value)} />
                </div>
              </div>
            )}
            <div className="field">
              <label htmlFor="b-instructions">Instruksi (opsional)</label>
              <textarea id="b-instructions" value={bInstructions} onChange={(e) => setBInstructions(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="b-refs">Referensi / Lampiran (link, opsional)</label>
              <input id="b-refs" value={bRefs} onChange={(e) => setBRefs(e.target.value)} />
            </div>
            {planGated && (
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={bAddendum} onChange={(e) => setBAddendum(e.target.checked)} />
                Ini penambahan di luar outline Plan (addendum)
              </label>
            )}
            <div>
              <button
                type="submit"
                className="btn btnPrimary"
                disabled={bSubmitting || (planGated && !approvedStrategy)}
              >
                {bSubmitting ? 'Membuat...' : 'Buat Brief'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="cardHeader">
          <h2>Daftar Brief</h2>
        </div>
        {briefs.length === 0 ? (
          <div className="emptyState">Belum ada Brief untuk layanan ini.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Brief ID</th>
                  <th>Judul</th>
                  <th>Divisi</th>
                  <th>Deliverable</th>
                  <th>Due</th>
                  <th>Prioritas</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/account/briefs/${b.id}`}>{b.id}</Link>
                    </td>
                    <td>{b.title}</td>
                    <td>{b.assigned_division}</td>
                    <td>{b.deliverable_type}</td>
                    <td>{b.due_date || '—'}</td>
                    <td>{b.priority}</td>
                    <td><StatusBadge status={b.status} /></td>
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
