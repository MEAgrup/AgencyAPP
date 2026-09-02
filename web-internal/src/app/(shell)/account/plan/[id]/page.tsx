'use client';

/**
 * Module 6B — the Plan period page (`/account/plan/{id}`).
 *
 * This is the layer where a Strategi's arah becomes "kerjaan minggu ini": the
 * PLAN- period, its per-channel targets (P-B), and — the point of the screen —
 * **Penugasan task ke divisi** (P-C): one row per channel × pilar × aksi
 * carrying a **kuota + satuan** ("40 video", "36 jam live", "30 kreator", "5
 * promo"), a division PIC, and its weeks. That table is the "pembagian jumlah
 * pekerjaan dengan target baseline" the owner asked for.
 *
 * ## Where Strategi stops (owner decision 2026-09-02, docs/DECISIONS.md)
 *
 * **P-B is the only Strategi-derived section on this page.** P-C used to open
 * with a "Turunan pilar Strategi (PC-3)" dropdown reading the Strategi's Section
 * E, and every row that picked nothing was badged `Di Luar Strategi` in amber.
 * In practice Section E is empty on most Strategi, so the dropdown was empty,
 * every row got the badge, and the AM read a warning about a deviation they had
 * no way to avoid. The owner's call: a P-C row is a **task handed to a
 * division**, not a restatement of the strategy. So on a kontrak (Full
 * Management) Plan the picker and the badge are gone; the `di_luar_strategi`
 * column and the PG-1 governance metric are untouched, they just stopped
 * shouting per row. Briefing still works — `brief-inherit.ts` resolves a kontrak
 * `di_luar_strategi` row onto the contract's sole Service.
 *
 * **Plan klien (Satuan) keeps its picker**, deliberately: its origin is a real
 * choice (a purchased Service, or a pillar borrowed from any `Aktif` STRG the
 * client has) and `di_luar_service` is unbriefable scope creep under M6C Rule 9,
 * so removing it there would make every Satuan row undeliverable.
 *
 * ## Task detail follows the satuan
 *
 * PC-6's unit used to be free text, which meant one deliverable was recorded as
 * "video", "vidio" and "video seller" by three AMs and any report summing per
 * satuan split one number three ways. Picking a **Divisi PIC** now yields a
 * **Jenis task** dropdown of that division's registered deliverables, and the
 * satuan follows from the jenis (`@/lib/plantask`, mirroring
 * `packages/core/src/plantask.ts`). An Ads `money` jenis renders a Rupiah input
 * and fills PC-7 budget with the same figure. "Lainnya" keeps the free-text
 * escape hatch, and is the only path for Account/Ops, which have no catalog.
 *
 * ## Why rows are added by hand here
 *
 * `generatePlanPeriods` (run on Strategi approval) seeds the period + its
 * `plan_target` rows from Strategi D-2 — but it does **not** seed work rows. So
 * breaking the target/commitment into concrete quantities IS this page's
 * add-row step (`createPlanRow`), not a background job. Each row then descends
 * into one Brief with a single click (RAB-16, `inheritBriefsFromPlan`), where the
 * AM fills only due date + priority.
 *
 * ## Scope of this first cut
 *
 * Read + the "jumlah pekerjaan" write path: view period/targets/rows/weeks, add
 * rows, run the lifecycle (submit / approve / return / activate), and inherit
 * Briefs. Realisasi (P-E), the close review (P-F), and carry-over (PF-5) have
 * domain functions but no routes yet — they are a later cut, and the page says
 * so rather than pretending the period can be closed here.
 */

import { Fragment, use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAccountLead, isAccountStaff, isReadOnlyOD } from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';
import { formatIDR } from '@/lib/money';
import { getStrategi, listStrategiQueue, type StrategiPillar } from '@/lib/strategi';
import { getClient, type ServiceLine } from '@/lib/clients';
import { suggestRowFromPillar } from '@/lib/plan-row-suggest';
import { JENIS_LAINNYA, PIC_GROUPS, findJenis, jenisBySatuan, jenisFor } from '@/lib/plantask';
import {
  jenisDefaults,
  kuotaBudget,
  taskDefaultsFor,
} from '@/lib/plan-task-draft';
import {
  activatePlanPeriode,
  approvePlanPeriode,
  createPlanRow,
  deletePlanRow,
  getPlanDetail,
  inheritBriefsFromPlan,
  returnPlanPeriode,
  saveCatatanPembuka,
  submitPlanPeriode,
  updatePlanRowOrigin,
  type CreatePlanRowBody,
  type PlanDetail,
  type PlanRow,
} from '@/lib/plan';

// --- vocab (mirrors the DB CHECKs / brief-inherit allow-lists) --------------

const PILAR: { value: string; label: string }[] = [
  { value: 'sku', label: 'SKU / Listing' },
  { value: 'harga', label: 'Harga & Promo' },
  { value: 'iklan', label: 'Iklan' },
  { value: 'konten', label: 'Konten' },
  { value: 'affiliate', label: 'Affiliate / KOL' },
  { value: 'live', label: 'Live (vendor)' },
  { value: 'retensi', label: 'Retensi / CRM' },
  { value: 'operasional', label: 'Operasional' },
];
const PILAR_LABEL: Record<string, string> = Object.fromEntries(PILAR.map((p) => [p.value, p.label]));

// PC-8 divisions come from `@/lib/plantask` PIC_GROUPS now, NOT a literal here.
// The literal this replaced listed six — it predated the M16/M17 registry and so
// hid AI Optimizer and Store Operation, which `division_registry` and
// `createPlanRow` have accepted since 2026-08-28: the owner could not assign a
// Plan row to either division even though the server would have taken it
// (reported 2026-09-02). Account/Ops stay in the picker's second group — their
// Briefs are read via the generic /tasks division queue (owner decision,
// docs/DECISIONS.md 2026-08-27), which is not a reason to hide them.
const ROW_PRIORITAS = ['Wajib', 'Penting', 'Kalau Sempat'];
const BRIEF_PRIORITAS = ['Low', 'Medium', 'High'];

const METRIC_LABEL: Record<string, string> = {
  gmv: 'GMV',
  pengunjung: 'Pengunjung',
  cr: 'Conversion Rate',
  aov: 'AOV',
  roas_min: 'ROAS min',
  acos_maks: 'ACOS maks',
  sku_winner: 'SKU winner baru',
  affiliate_aktif: 'Affiliate aktif',
  jam_live: 'Jam live',
  jumlah_video: 'Jumlah video',
};
const MONEY_METRIC = new Set(['gmv', 'aov']);

const SKIP_LABEL: Record<string, string> = {
  di_luar: 'baris di luar strategi/service',
  service_ambigu: 'service belum jelas',
  tanpa_jadwal: 'belum diberi jatuh tempo + prioritas',
  sudah_diwarisi: 'sudah punya Brief',
  service_tidak_ditemukan: 'service tak ditemukan',
  service_tidak_briefable: 'service tak bisa dibrief',
  divisi_pic_tidak_valid: 'divisi PIC tidak valid',
  kuota_nol: 'kuota 0',
};

// --- add-row draft ----------------------------------------------------------

const ROW_VISIBILITAS = ['Bagikan ke Klien', 'Internal Saja'];

interface RowDraft {
  channel: string;
  pilar: string;
  aksi: string;
  kuota: string;
  /**
   * PC-6 unit — now DERIVED from `jenis_task` rather than typed, except on the
   * `JENIS_LAINNYA` path. Kept as its own field because it is what actually
   * reaches `plan_row.satuan`; `jenis_task` is form state only (no DB column —
   * see `@/lib/plantask` on why (divisi_pic, satuan) recovers it).
   */
  satuan: string;
  /**
   * Which of the PIC division's registered deliverables this row is (owner
   * request 2026-09-02: "detail task sesuai satuannya"). `JENIS_LAINNYA` ⇒ the
   * free-text `satuan` input comes back, for work the catalog does not name
   * yet and for Account/Ops which have no catalog at all.
   */
  jenis_task: string;
  budget: string;
  divisi_pic: string;
  minggu_sasaran: number[];
  prioritas: string;
  hasil_diharapkan: string;
  /** PC-5 — comma-separated SKUs; parsed to an array at submit. */
  sku_sasaran: string;
  /** Owner-added 2026-09-02, not a PC-numbered PRD field: free text or a link
   *  (e.g. Google Drive) attached to this row — carried into the inherited
   *  Brief (RAB-16). */
  instruksi_brief: string;
  visibilitas: string;
  /** Origin (PC-3), Plan klien (Satuan) ONLY: a pillar id from any `Aktif` STRG
   *  belonging to the client, or empty ⇒ no pillar. Kontrak Plans no longer
   *  offer a pillar at all (owner 2026-09-02 — see the file header), so this
   *  field stays empty there and `rowDraftToBody` ignores it. */
  strategi_pillar_id: string;
  /** Origin (PC-3), Plan klien (Satuan) only: a purchased Service id, or empty
   *  ⇒ no service. Plan klien has no single Strategi to descend from (M6C
   *  §7/§9), so its origin is either one of the client's Services or one of the
   *  client's STRG pillars — the plain pillar dropdown alone would otherwise be
   *  permanently empty and every row would silently default to Di Luar Strategi
   *  (owner QA, SVC-202608-0008). */
  service_id: string;
  /** Which "di luar" flag to send when NEITHER origin above is picked on a Plan
   *  klien row. A kontrak row is always `di_luar_strategi` now — by design, not
   *  as a fallback — so this is never consulted there. */
  di_luar_kind: 'strategi' | 'service';
}

function blankRow(channel: string): RowDraft {
  return {
    channel,
    pilar: 'konten',
    aksi: '',
    kuota: '',
    ...taskDefaultsFor('Creative'),
    budget: '',
    divisi_pic: 'Creative',
    minggu_sasaran: [],
    prioritas: 'Wajib',
    hasil_diharapkan: '',
    sku_sasaran: '',
    instruksi_brief: '',
    visibilitas: 'Bagikan ke Klien',
    strategi_pillar_id: '',
    service_id: '',
    di_luar_kind: 'strategi',
  };
}

/**
 * Owner-added 2026-09-02 (docs/DECISIONS.md): re-pointing PC-3 on an existing
 * row — the fix for a row born "Di Luar Strategi/Service" while Section E was
 * empty, once it's later filled (or a Service appears to tie it to instead).
 * A separate, smaller draft than `RowDraft`: only the origin fields, since
 * `updatePlanRowOrigin` never touches anything else on the row.
 */
interface OriginEdit {
  rowId: number;
  strategiPillarId: string;
  serviceId: string;
  diLuarKind: 'strategi' | 'service';
}

function parseSkuSasaran(s: string): string[] {
  return s
    .split(',')
    .map((sku) => sku.trim())
    .filter((sku) => sku !== '');
}

// Owner decision 2026-09-02 (docs/DECISIONS.md): the AM no longer types a
// reason for "di luar" — and on a kontrak Plan there is no longer a question to
// answer at all, since P-B is the only Strategi-derived section and a P-C row is
// a task for a division. The DB (`ck_plan_row_di_luar_alasan`) still requires
// non-blank text whenever a row has no Service/pilar anchor, so these defaults
// satisfy that gate without a migration or a visible form field.
//
// The `strategi` string is worth reading carefully: it is what an auditor or a
// PG-1 report sees on every kontrak row from now on, so it must state the
// DESIGN, not a fault. The old wording ("belum ada pilar Strategi yang cocok")
// implied an unfinished Section E, which would be a standing false accusation.
const DEFAULT_DILUAR_ALASAN: Record<'strategi' | 'service', string> = {
  strategi:
    'Baris rencana kerja tidak diturunkan dari pilar Strategi — hanya Target periode (P-B) yang diturunkan dari Strategi (keputusan pemilik 2026-09-02).',
  service: 'Belum ada Service klien yang cocok untuk baris ini.',
};

function rowDraftToBody(d: RowDraft, lingkup: string): CreatePlanRowBody {
  // PC-3 exactly-one origin (`ck_plan_row_asal_tunggal`).
  //
  // PLAN KONTRAK (Full Management): no origin picker at all any more. The owner
  // decided 2026-09-02 that Strategi derivation belongs to Section P-B (the
  // period targets) and to nothing else — a P-C row is a task handed to a
  // division, not a restatement of the strategy. So a kontrak row is always
  // born `di_luar_strategi` with the standing reason below, which is exactly
  // what it already was in practice: PC-3's dropdown reads Section E, Section E
  // is empty on most Strategi, and every row landed here anyway — just after
  // the AM read an amber warning implying they had done something wrong.
  // Briefing is unaffected: `brief-inherit.ts` resolves a kontrak
  // `di_luar_strategi` row onto the contract's sole Service (2026-09-02 fix).
  //
  // PLAN KLIEN (Satuan) KEEPS its picker, and that is not an oversight. Its two
  // anchors are a purchased Service or a pillar borrowed from any `Aktif` STRG
  // the client has (owner decision 2026-08-28) — and `di_luar_service` is
  // literal scope creep under M6C Rule 9, which `brief-inherit.ts` refuses to
  // brief. Dropping the picker there would make every Satuan row unbriefable.
  const isKlien = lingkup === 'klien';
  const pillarId = isKlien && d.strategi_pillar_id.trim() ? Number(d.strategi_pillar_id) : null;
  const serviceId = isKlien && d.service_id.trim() ? d.service_id.trim() : null;
  const hasOrigin = pillarId !== null || serviceId !== null;
  const diLuarStrategi = !hasOrigin && (!isKlien || d.di_luar_kind === 'strategi');
  const diLuarService = !hasOrigin && isKlien && d.di_luar_kind === 'service';
  const diLuarAlasan = diLuarStrategi
    ? DEFAULT_DILUAR_ALASAN.strategi
    : diLuarService
      ? DEFAULT_DILUAR_ALASAN.service
      : null;
  // PC-6 quota + PC-7 budget — see `kuotaBudget` on why a `money` jenis writes
  // the same Rupiah figure to both, and why the quota must not be left 0.
  const { kuota, budget } = kuotaBudget(d.divisi_pic, d.jenis_task, d.kuota, d.budget);
  return {
    channel: d.channel,
    pilar: d.pilar,
    strategi_pillar_id: pillarId,
    service_id: serviceId,
    di_luar_strategi: diLuarStrategi,
    di_luar_service: diLuarService,
    di_luar_alasan: diLuarAlasan,
    aksi: d.aksi.trim(),
    kuota,
    satuan: d.satuan.trim(),
    budget,
    divisi_pic: d.divisi_pic,
    minggu_sasaran: d.minggu_sasaran,
    prioritas: d.prioritas,
    hasil_diharapkan: d.hasil_diharapkan.trim(),
    sku_sasaran: parseSkuSasaran(d.sku_sasaran),
    prasyarat: null,
    instruksi_brief: d.instruksi_brief.trim() || null,
    visibilitas: d.visibilitas,
  };
}

export default function PlanPeriodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);
  const canWrite = !readOnly && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);
  const canApprove = !readOnly && (isAccountLead(role) || !!role?.director);

  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [clientServices, setClientServices] = useState<ServiceLine[]>([]);
  // Plan klien (Satuan) origin, part 2 (owner decision 2026-08-28, DECISIONS.md):
  // besides the client's Services, the AM may also tie a row to a pillar of ANY
  // STRG- approved for that client (e.g. a past/parallel Full-Management
  // contract) — flattened across every `Aktif` Strategi so the dropdown can
  // show one merged list.
  const [clientPillars, setClientPillars] = useState<{ strategiId: string; pillar: StrategiPillar }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const [returnNote, setReturnNote] = useState('');
  const [rowDraft, setRowDraft] = useState<RowDraft | null>(null);
  const [originEdit, setOriginEdit] = useState<OriginEdit | null>(null);
  const [pembuka, setPembuka] = useState('');

  // Brief one-click: per-row { due_date, priority } the AM fills before inheriting.
  const [fills, setFills] = useState<Record<number, { due_date: string; priority: string }>>({});
  const [inheritMsg, setInheritMsg] = useState<string | null>(null);
  // true when the last run skipped at least one row as `di_luar` — that reason means
  // the row itself carries no Service/pilar anchor (PC-3 was left "Di Luar Strategi/Service"
  // at creation), which the AM cannot fix by re-clicking; the hint below points at the
  // one real remedy (Section E on the Strategi, then a newly-anchored row).
  const [inheritDiLuarHint, setInheritDiLuarHint] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await getPlanDetail(id);
      setDetail(d);
      setPembuka(d.plan.catatan_pembuka ?? '');
      // Origin dropdown for new rows — PLAN KLIEN (Satuan) ONLY. The kontrak
      // Plan's own `getStrategi(strategi_id)` fetch that used to sit here is
      // gone with the PC-3 pillar dropdown it fed (owner 2026-09-02: Strategi
      // derivation lives in Section P-B alone). Satuan has no Strategi of its
      // own (M6C §7/§9), so its origin is the client's purchased Services, plus
      // pillars borrowed from any `Aktif` STRG the client has — without both,
      // every Satuan row would default to an unbriefable "di luar" (owner QA,
      // SVC-202608-0008). These fetches are advisory: a failure must not fail
      // the page, since rows can still be added "di luar".
      if (d.plan.lingkup === 'klien') {
        getClient(d.plan.client_id)
          .then((c) => setClientServices(c.client.services))
          .catch(() => setClientServices([]));
        listStrategiQueue()
          .then(async ({ data }) => {
            const approved = data.filter(
              (s) => s.client_id === d.plan.client_id && s.status === 'Aktif',
            );
            const perStrategi = await Promise.all(
              approved.map((s) =>
                getStrategi(s.id)
                  .then((det) => det.pillars.map((pillar) => ({ strategiId: s.id, pillar })))
                  .catch(() => []),
              ),
            );
            setClientPillars(perStrategi.flat());
          })
          .catch(() => setClientPillars([]));
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setActing(true);
      setError(null);
      try {
        await fn();
        await load();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setActing(false);
      }
    },
    [load],
  );

  const weeksByRow = useMemo(() => {
    const m = new Map<number, { minggu_no: number; kuota: number }[]>();
    for (const w of detail?.weeks ?? []) {
      const arr = m.get(w.plan_row_id) ?? [];
      arr.push({ minggu_no: w.minggu_no, kuota: w.kuota });
      m.set(w.plan_row_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.minggu_no - b.minggu_no);
    return m;
  }, [detail]);

  // Channel options: the plan's own channels (from targets/rows), falling back
  // to a plain text entry when neither exists yet.
  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of detail?.targets ?? []) set.add(t.channel);
    for (const r of detail?.rows ?? []) set.add(r.channel);
    return [...set];
  }, [detail]);

  if (loading) return <p className="pageLoading">Memuat…</p>;
  if (loadError) return <div className="alert alertError">{loadError}</div>;
  if (!detail) return <div className="alert alertError">[Plan tidak ditemukan]</div>;

  const { plan, targets, rows, briefs } = detail;
  // plan_row_id -> the Brief it already produced (RAB-16). A row absent here
  // has no Brief yet — the "Berikan Brief" table's Brief column falls back to
  // "—" for it, never a dead link.
  const briefByRow = new Map(briefs.map((b) => [b.plan_row_id, b]));
  const status = plan.status;
  /**
   * Plan klien (Satuan, M6C §7) vs Plan kontrak (Full Management). The split
   * decides whether Section P-C shows a PC-3 origin picker at all: only Satuan
   * still has a real choice to make there (Service vs borrowed STRG pillar),
   * and only Satuan has an origin — `di_luar_service` — that makes a row
   * unbriefable. See `rowDraftToBody` for the full reasoning.
   */
  const isKlien = plan.lingkup === 'klien';
  const canAddRow = canWrite && (status === 'Draft' || status === 'Aktif');
  const canSubmit = canWrite && status === 'Draft';
  const canDecide = canApprove && status === 'Diajukan';
  const canActivate = canWrite && (status === 'Terjadwal' || status === 'Menunggu Persetujuan');
  const canInherit = canWrite && status === 'Aktif';

  const savePembuka = () => act(() => saveCatatanPembuka(id, pembuka));

  const submitRow = async () => {
    if (!rowDraft) return;
    await act(async () => {
      await createPlanRow(id, rowDraftToBody(rowDraft, plan.lingkup));
      setRowDraft(null);
    });
  };

  function startOriginEdit(r: PlanRow) {
    setOriginEdit({
      rowId: r.id,
      strategiPillarId: r.strategi_pillar_id !== null ? String(r.strategi_pillar_id) : '',
      serviceId: r.service_id ?? '',
      diLuarKind: r.di_luar_service ? 'service' : 'strategi',
    });
  }

  const saveOriginEdit = async () => {
    if (!originEdit) return;
    const isKlien = plan.lingkup === 'klien';
    const pillarId = originEdit.strategiPillarId.trim() ? Number(originEdit.strategiPillarId) : null;
    const serviceId = isKlien && originEdit.serviceId.trim() ? originEdit.serviceId.trim() : null;
    const hasOrigin = pillarId !== null || serviceId !== null;
    const diLuarStrategi = !hasOrigin && (!isKlien || originEdit.diLuarKind === 'strategi');
    const diLuarService = !hasOrigin && isKlien && originEdit.diLuarKind === 'service';
    const diLuarAlasan = diLuarStrategi
      ? DEFAULT_DILUAR_ALASAN.strategi
      : diLuarService
        ? DEFAULT_DILUAR_ALASAN.service
        : null;
    await act(async () => {
      await updatePlanRowOrigin(originEdit.rowId, {
        strategi_pillar_id: pillarId,
        service_id: serviceId,
        di_luar_strategi: diLuarStrategi,
        di_luar_service: diLuarService,
        di_luar_alasan: diLuarAlasan,
      });
      setOriginEdit(null);
    });
  };

  const handleDeleteRow = async (r: PlanRow) => {
    const label = `${PILAR_LABEL[r.pilar] ?? r.pilar} · ${r.divisi_pic}`;
    if (!window.confirm(`Hapus baris "${label}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    await act(() => deletePlanRow(r.id));
  };

  const runInherit = async () => {
    const list = rows
      .filter((r) => r.kuota > 0)
      .map((r) => ({
        plan_row_id: r.id,
        due_date: fills[r.id]?.due_date ?? '',
        priority: fills[r.id]?.priority ?? '',
      }))
      .filter((f) => f.due_date && f.priority);
    if (list.length === 0) {
      setInheritMsg('Isi jatuh tempo + prioritas minimal satu baris dulu.');
      return;
    }
    setActing(true);
    setError(null);
    setInheritMsg(null);
    setInheritDiLuarHint(false);
    try {
      const res = await inheritBriefsFromPlan(id, list);
      const skipTxt = res.skipped
        .map((s) => `baris ${s.plan_row_id}: ${SKIP_LABEL[s.reason] ?? s.reason}`)
        .join('; ');
      setInheritMsg(
        `${res.created.length} Brief dibuat` + (skipTxt ? ` · dilewati — ${skipTxt}` : ''),
      );
      setInheritDiLuarHint(res.skipped.some((s) => s.reason === 'di_luar'));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActing(false);
    }
  };

  const metricValue = (metric: string, nilai: number) =>
    MONEY_METRIC.has(metric) ? formatIDR(nilai) : String(nilai);

  return (
    <div className="stack">
      {/* -------- P-A header -------- */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>{plan.id}</h1>
          <StatusBadge status={status} />
          <span className="muted">periode {plan.periode_no}</span>
          <span style={{ flex: 1 }} />
          {plan.strategi_id && (
            <Link href={`/account/strategi/${plan.strategi_id}`} className="btn btnGhost btnSm">
              Strategi induk
            </Link>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          {plan.tanggal_mulai} → {plan.tanggal_akhir} · {plan.jumlah_minggu} minggu ·{' '}
          Defisit terbawa: {formatIDR(detail.defisit_terbawa)}
        </p>
        {canSubmit ? (
          <div style={{ marginTop: 8 }}>
            <textarea
              rows={2}
              placeholder="Catatan pembuka (opsional)"
              value={pembuka}
              onChange={(e) => setPembuka(e.target.value)}
              disabled={acting}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btnSm"
                disabled={acting || pembuka.trim() === (plan.catatan_pembuka ?? '').trim()}
                onClick={() => void savePembuka()}
              >
                Simpan catatan pembuka
              </button>
            </div>
          </div>
        ) : (
          plan.catatan_pembuka && (
            <p style={{ fontSize: 13, marginTop: 8 }}>{plan.catatan_pembuka}</p>
          )
        )}
      </div>

      {error && <div className="alert alertError">{error}</div>}

      {/* -------- lifecycle -------- */}
      {(canSubmit || canDecide || canActivate) && (
        <div className="card">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canSubmit && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={acting}
                onClick={() => void act(() => submitPlanPeriode(id))}
              >
                Aktifkan periode 1
              </button>
            )}
            {canActivate && (
              <button
                type="button"
                className="btn btnPrimary"
                disabled={acting}
                onClick={() => void act(() => activatePlanPeriode(id))}
              >
                Aktifkan periode
              </button>
            )}
            {canDecide && (
              <>
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={acting}
                  onClick={() => void act(() => approvePlanPeriode(id))}
                >
                  Setujui
                </button>
                <input
                  placeholder="Catatan pengembalian (wajib)"
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button
                  type="button"
                  className="btn btnDanger"
                  disabled={acting || returnNote.trim() === ''}
                  onClick={() => void act(() => returnPlanPeriode(id, returnNote.trim()))}
                >
                  Kembalikan
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* -------- P-B targets -------- */}
      <div className="card">
        <div className="cardHeader">Target periode (P-B) — diturunkan dari Strategi</div>
        <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
          Ini satu-satunya bagian Plan yang diturunkan dari Strategi (D-2/D-4). Baris rencana kerja
          di bawah adalah penugasan ke divisi, bukan turunan Strategi.
        </p>
        {targets.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Belum ada target — target diturunkan dari Strategi D-2 saat periode dibuat.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Channel</th>
                  <th style={{ textAlign: 'left' }}>Metrik</th>
                  <th style={{ textAlign: 'left' }}>Dari Strategi</th>
                  <th style={{ textAlign: 'left' }}>Dipakai</th>
                  <th style={{ textAlign: 'left' }}>Arah</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={`${t.channel}-${t.metric}`}>
                    <td style={{ paddingRight: 8 }}>{t.channel}</td>
                    <td style={{ paddingRight: 8 }}>{METRIC_LABEL[t.metric] ?? t.metric}</td>
                    <td style={{ paddingRight: 8 }}>{metricValue(t.metric, t.nilai_strategi)}</td>
                    <td style={{ paddingRight: 8 }}>{metricValue(t.metric, t.nilai_dipakai)}</td>
                    <td style={{ paddingRight: 8 }}>
                      {t.arah === 'tetap'
                        ? 'Tetap'
                        : `${t.arah === 'naik' ? 'Naik' : 'Turun'} ${t.persen_perubahan}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* -------- P-C work rows — the task-assignment section -------- */}
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <div className="cardHeader" style={{ flex: 1, marginBottom: 0 }}>
            Penugasan task ke divisi (P-C) — {rows.length}
          </div>
          {canAddRow && rowDraft === null && (
            <button
              type="button"
              className="btn btnSecondary btnSm"
              onClick={() => setRowDraft(blankRow(channelOptions[0] ?? ''))}
            >
              Tambah baris
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Belum ada task. Pecah target P-B di atas jadi pekerjaan konkret per divisi operasional —
            Creative, Ads, KOL, Live Stream, AI Optimizer, Store Operation — lengkap dengan jumlah
            dan satuannya (mis. 40 video, 30 kreator, 36 jam live, 5 promo). Tiap baris nanti jadi
            satu Brief ke divisi itu.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ fontSize: 13, minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Channel</th>
                  <th style={{ textAlign: 'left' }}>Pilar</th>
                  <th style={{ textAlign: 'left' }}>Aksi</th>
                  <th style={{ textAlign: 'left' }}>Kuota</th>
                  <th style={{ textAlign: 'left' }}>PIC</th>
                  <th style={{ textAlign: 'left' }}>Minggu</th>
                  <th style={{ textAlign: 'left' }}>Prioritas</th>
                  <th style={{ textAlign: 'left' }}>Status</th>
                  <th style={{ textAlign: 'left' }}>Kelola</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: PlanRow) => {
                  const wk = weeksByRow.get(r.id);
                  const briefed = briefByRow.get(r.id) !== undefined;
                  // Re-pointing PC-3 only means something where PC-3 is still a
                  // choice — Plan klien (Satuan), whose rows anchor to a Service
                  // or a borrowed STRG pillar. On a kontrak Plan every row is
                  // `di_luar_strategi` by design now (owner 2026-09-02), so
                  // "Ubah asal" would open a picker with one option.
                  const canManageOrigin =
                    isKlien && canWrite && !briefed && (status === 'Draft' || status === 'Aktif');
                  const jenis = jenisBySatuan(r.divisi_pic, r.satuan);
                  return (
                    <Fragment key={r.id}>
                    <tr>
                      <td style={{ paddingRight: 8 }}>{r.channel}</td>
                      <td style={{ paddingRight: 8 }}>{PILAR_LABEL[r.pilar] ?? r.pilar}</td>
                      <td style={{ paddingRight: 8 }}>
                        {r.aksi}
                        {/* `Di Luar Strategi` is no longer surfaced on a kontrak
                            Plan: since P-B is the only Strategi-derived section
                            (owner 2026-09-02), every P-C row carries the flag and
                            a badge on all of them flags nothing. The column and
                            PG-1 are untouched — the governance metric still
                            counts, it just stopped shouting at the AM per row.
                            `Di Luar Service` is a different animal (M6C Rule 9:
                            real scope creep, unbriefable) and stays. */}
                        {r.di_luar_service && (
                          <span className="badge badge-amber" style={{ marginLeft: 6 }}>
                            Di Luar Service
                          </span>
                        )}
                      </td>
                      <td style={{ paddingRight: 8, whiteSpace: 'nowrap' }}>
                        {jenis?.money ? (
                          <strong>{formatIDR(r.kuota)}</strong>
                        ) : (
                          <>
                            <strong>{r.kuota}</strong> {r.satuan}
                          </>
                        )}
                        {/* Which registered deliverable this is. Recovered from
                            (divisi_pic, satuan) — there is no `jenis_task`
                            column, on purpose (see `@/lib/plantask`). A row whose
                            satuan was typed free-hand simply shows no label. */}
                        {jenis && (
                          <div className="muted" style={{ fontSize: 11 }}>{jenis.label}</div>
                        )}
                        {wk && wk.length > 0 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {wk.map((w) => `M${w.minggu_no}:${w.kuota}`).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td style={{ paddingRight: 8 }}>{r.divisi_pic}</td>
                      <td style={{ paddingRight: 8 }}>
                        {r.minggu_sasaran.length ? r.minggu_sasaran.join(', ') : '—'}
                      </td>
                      <td style={{ paddingRight: 8 }}>{r.prioritas}</td>
                      <td style={{ paddingRight: 8 }}>{r.status_baris}</td>
                      <td style={{ paddingRight: 8, whiteSpace: 'nowrap' }}>
                        {briefed ? (
                          <span className="muted" style={{ fontSize: 11 }}>Sudah punya Brief</span>
                        ) : canManageOrigin ? (
                          <span className="row" style={{ gap: 6 }}>
                            <button
                              type="button"
                              className="btn btnGhost btnSm"
                              disabled={acting}
                              onClick={() => startOriginEdit(r)}
                            >
                              Ubah asal
                            </button>
                            <button
                              type="button"
                              className="btn btnGhost btnSm"
                              disabled={acting}
                              onClick={() => void handleDeleteRow(r)}
                            >
                              Hapus
                            </button>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                    {originEdit && originEdit.rowId === r.id && (
                      <tr>
                        <td colSpan={9} style={{ background: 'var(--bg-subtle, #f7f7f7)', padding: 8 }}>
                          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            {/* Satuan-only — the kontrak branch that used to sit
                                here was unreachable once `canManageOrigin`
                                required `isKlien`, and a dead second copy of the
                                pillar dropdown is exactly the drift this page
                                keeps being bitten by. */}
                            <label className="field">
                              <span className="muted" style={{ fontSize: 12 }}>
                                Turunan (PC-3) — Service atau Strategi klien, kosongkan ⇒ di luar
                              </span>
                              <select
                                value={
                                  originEdit.serviceId
                                    ? `service:${originEdit.serviceId}`
                                    : originEdit.strategiPillarId
                                      ? `pillar:${originEdit.strategiPillarId}`
                                      : ''
                                }
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val.startsWith('service:')) {
                                    setOriginEdit({ ...originEdit, serviceId: val.slice('service:'.length), strategiPillarId: '' });
                                  } else if (val.startsWith('pillar:')) {
                                    setOriginEdit({ ...originEdit, strategiPillarId: val.slice('pillar:'.length), serviceId: '' });
                                  } else {
                                    setOriginEdit({ ...originEdit, serviceId: '', strategiPillarId: '' });
                                  }
                                }}
                              >
                                <option value="">— Di luar (pilih jenis di bawah) —</option>
                                {clientServices.length > 0 && (
                                  <optgroup label="Service">
                                    {clientServices.map((s) => (
                                      <option key={s.id} value={`service:${s.id}`}>
                                        {s.id} · {s.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                {clientPillars.length > 0 && (
                                  <optgroup label="Strategi (STRG milik klien)">
                                    {clientPillars.map(({ strategiId, pillar: p }) => (
                                      <option key={p.id} value={`pillar:${p.id}`}>
                                        {strategiId} · #{p.id} {PILAR_LABEL[p.jenis] ?? p.jenis}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            </label>
                            {!originEdit.serviceId.trim() &&
                              !originEdit.strategiPillarId.trim() && (
                                <label className="field">
                                  <span className="muted" style={{ fontSize: 12 }}>Jenis di luar</span>
                                  <select
                                    value={originEdit.diLuarKind}
                                    onChange={(e) =>
                                      setOriginEdit({ ...originEdit, diLuarKind: e.target.value as 'strategi' | 'service' })
                                    }
                                  >
                                    <option value="strategi">Di Luar Strategi</option>
                                    <option value="service">Di Luar Service</option>
                                  </select>
                                </label>
                              )}
                            <button
                              type="button"
                              className="btn btnPrimary btnSm"
                              disabled={acting}
                              onClick={() => void saveOriginEdit()}
                            >
                              Simpan asal
                            </button>
                            <button
                              type="button"
                              className="btn btnGhost btnSm"
                              disabled={acting}
                              onClick={() => setOriginEdit(null)}
                            >
                              Batal
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* add-row form */}
        {rowDraft !== null && (
          <div className="stack" style={{ gap: 8, marginTop: 12, borderTop: '1px solid var(--border,#ddd)', paddingTop: 12 }}>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Channel</span>
                {channelOptions.length > 0 ? (
                  <select
                    value={rowDraft.channel}
                    onChange={(e) => setRowDraft({ ...rowDraft, channel: e.target.value })}
                  >
                    {channelOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={rowDraft.channel}
                    onChange={(e) => setRowDraft({ ...rowDraft, channel: e.target.value })}
                  />
                )}
              </label>
              {/* PC-3 origin — PLAN KLIEN (Satuan) ONLY.
                  The kontrak (Full Management) pillar dropdown that used to sit
                  in the `else` here is GONE: the owner decided 2026-09-02 that
                  Strategi derivation belongs to Section P-B alone, so a P-C row
                  is a task for a division rather than a restatement of Section
                  E. It also never worked as advertised — Section E is empty on
                  most Strategi, so the dropdown was empty, every row became
                  "Di Luar Strategi" anyway, and the AM read an amber warning
                  about it each time.
                  Satuan keeps its picker because its origin is a real choice
                  (a purchased Service, or a pillar borrowed from any `Aktif`
                  STRG the client has — owner decision 2026-08-28) and because
                  `di_luar_service` is unbriefable scope creep under M6C Rule 9
                  (owner QA, SVC-202608-0008). See `rowDraftToBody`. */}
              {isKlien && (
                <label className="field">
                  <span className="muted" style={{ fontSize: 12 }}>
                    Turunan (PC-3) — Service atau Strategi klien, kosongkan ⇒ di luar
                  </span>
                  <select
                    value={
                      rowDraft.service_id.trim()
                        ? `service:${rowDraft.service_id}`
                        : rowDraft.strategi_pillar_id.trim()
                          ? `pillar:${rowDraft.strategi_pillar_id}`
                          : ''
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val.startsWith('service:')) {
                        const serviceId = val.slice('service:'.length);
                        setRowDraft((d) => (d ? { ...d, service_id: serviceId, strategi_pillar_id: '' } : d));
                        return;
                      }
                      if (val.startsWith('pillar:')) {
                        const pillarId = val.slice('pillar:'.length);
                        const found = clientPillars.find((cp) => String(cp.pillar.id) === pillarId);
                        setRowDraft((d) => {
                          if (!d) return d;
                          if (!found) return { ...d, strategi_pillar_id: pillarId, service_id: '' };
                          const s = suggestRowFromPillar(found.pillar);
                          return {
                            ...d,
                            strategi_pillar_id: pillarId,
                            service_id: '',
                            aksi: d.aksi.trim() ? d.aksi : s.aksi,
                            kuota: d.kuota.trim() ? d.kuota : s.kuota,
                            satuan: d.satuan.trim() ? d.satuan : s.satuan,
                            divisi_pic: s.divisiPic ?? d.divisi_pic,
                            sku_sasaran: d.sku_sasaran.trim() ? d.sku_sasaran : s.skuSasaran.join(', '),
                          };
                        });
                        return;
                      }
                      setRowDraft((d) => (d ? { ...d, service_id: '', strategi_pillar_id: '' } : d));
                    }}
                  >
                    <option value="">— Di luar (pilih jenis di bawah) —</option>
                    {clientServices.length > 0 && (
                      <optgroup label="Service">
                        {clientServices.map((s) => (
                          <option key={s.id} value={`service:${s.id}`}>
                            {s.id} · {s.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {clientPillars.length > 0 && (
                      <optgroup label="Strategi (STRG milik klien)">
                        {clientPillars.map(({ strategiId, pillar: p }) => (
                          <option key={p.id} value={`pillar:${p.id}`}>
                            {strategiId} · #{p.id} {PILAR_LABEL[p.jenis] ?? p.jenis}
                            {p.channel ? ` · ${p.channel}` : ''}
                            {p.aksi ? ` · ${p.aksi.slice(0, 40)}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <span className="muted" style={{ fontSize: 11 }}>
                    Pilih service yang klien beli, atau pilar dari STRG klien ini — baris ini
                    masuk lingkup itu, bukan penyimpangan. Memilih pilar Strategi juga mengisi
                    Aksi, Kuota/Satuan &amp; Divisi PIC di bawah (bisa diubah).
                  </span>
                </label>
              )}
              {isKlien &&
                rowDraft.service_id.trim() === '' &&
                rowDraft.strategi_pillar_id.trim() === '' && (
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Jenis di luar</span>
                    <select
                      value={rowDraft.di_luar_kind}
                      onChange={(e) =>
                        setRowDraft({ ...rowDraft, di_luar_kind: e.target.value as 'strategi' | 'service' })
                      }
                    >
                      <option value="strategi">Di Luar Strategi</option>
                      <option value="service">Di Luar Service</option>
                    </select>
                  </label>
                )}
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Pilar (PC-2)</span>
                <select
                  value={rowDraft.pilar}
                  onChange={(e) => setRowDraft({ ...rowDraft, pilar: e.target.value })}
                >
                  {PILAR.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              {/* PC-8 — the division this task is handed to. Grouped so the six
                  delivery divisions the owner named (Creative, Ads, KOL, Live
                  Stream, AI Optimizer, Store Operation) read as one set, with
                  Account/Ops kept below rather than dropped: PC-8 allows them
                  and existing rows use them. Picking a division RESETS the jenis
                  task + satuan below — a Creative deliverable on an Ads row is
                  never what the AM meant, and silently keeping it would write a
                  satuan that `jenisBySatuan` can no longer resolve. */}
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Divisi PIC (PC-8)</span>
                <select
                  value={rowDraft.divisi_pic}
                  onChange={(e) => {
                    const divisi = e.target.value;
                    setRowDraft((d) =>
                      d ? { ...d, divisi_pic: divisi, ...taskDefaultsFor(divisi) } : d,
                    );
                  }}
                >
                  {PIC_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.divisi.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {/* PC-6, first half — WHICH deliverable, which decides the unit.
                  This is the owner's "detail task sesuai satuannya" (2026-09-02):
                  satuan used to be free text, so one deliverable was recorded as
                  "video", "vidio" and "video seller" by three AMs and any report
                  summing per satuan split one number three ways. The catalog is
                  `@/lib/plantask`, mirroring `packages/core/src/plantask.ts`. */}
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Jenis task (PC-6)</span>
                <select
                  value={rowDraft.jenis_task}
                  onChange={(e) => {
                    // "Lainnya" clears the derived satuan so the AM types their
                    // own; a catalog pick overwrites whatever was there, since
                    // the unit follows from the deliverable (`jenisDefaults`).
                    const next = jenisDefaults(rowDraft.divisi_pic, e.target.value);
                    setRowDraft((d) => (d ? { ...d, ...next } : d));
                  }}
                >
                  {jenisFor(rowDraft.divisi_pic).map((j) => (
                    <option key={j.jenis} value={j.jenis}>
                      {j.label} — per {j.satuan}
                    </option>
                  ))}
                  <option value={JENIS_LAINNYA}>Lainnya (satuan diisi sendiri)</option>
                </select>
                <span className="muted" style={{ fontSize: 11 }}>
                  {jenisFor(rowDraft.divisi_pic).length === 0
                    ? `${rowDraft.divisi_pic} mengerjakan pekerjaan internalnya sendiri — belum ada daftar deliverable bersatuan, jadi isi satuannya sendiri di bawah.`
                    : 'Satuan di bawah ikut jenis yang dipilih. Pakai "Lainnya" untuk kerja yang belum ada di daftar.'}
                </span>
              </label>
            </div>

            {/* No `style={{ display: 'block' }}` on these full-width fields:
                `.field` is already a flex column and `.stack` above stretches it,
                so forcing `block` only turned the inline <span> label into a
                sibling of a shrink-wrapped input — the broken layout the owner
                screenshotted 2026-09-02. */}
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Aksi (PC-4) — kerja konkret</span>
              <input
                placeholder='mis. "rewrite listing 7 SKU Pareto"'
                value={rowDraft.aksi}
                onChange={(e) => setRowDraft({ ...rowDraft, aksi: e.target.value })}
              />
            </label>

            {/* PC-6, second half — HOW MUCH, in the unit the jenis above fixed.
                For a `money` jenis (Ads spent) the single figure the AM types is
                both the quota and PC-7 budget: PC-7 is "Rp yang dialokasikan ke
                baris ini", which for an ads-spend row IS that number. So the
                separate Budget input is hidden and the helper text says the
                field is being filled — rather than asking for the same Rupiah
                twice and letting the two copies drift. */}
            {(() => {
              const jenis = findJenis(rowDraft.divisi_pic, rowDraft.jenis_task);
              const isMoney = jenis?.money === true;
              const kuotaNum = rowDraft.kuota.trim() ? Number(rowDraft.kuota) : null;
              return (
                <div className="formRow">
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>
                      {isMoney ? `${jenis.label} (Rp) — PC-6` : 'Kuota (PC-6)'}
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={isMoney ? 1000 : 1}
                      placeholder={isMoney ? '15000000' : undefined}
                      value={rowDraft.kuota}
                      onChange={(e) => setRowDraft({ ...rowDraft, kuota: e.target.value })}
                    />
                    {isMoney && kuotaNum !== null && Number.isFinite(kuotaNum) && (
                      <span className="muted" style={{ fontSize: 11 }}>
                        {formatIDR(kuotaNum)} — Budget (PC-7) otomatis diisi angka ini.
                      </span>
                    )}
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Satuan</span>
                    <input
                      placeholder="mis. listing / akun / laporan"
                      value={rowDraft.satuan}
                      readOnly={jenis !== undefined}
                      aria-readonly={jenis !== undefined}
                      title={
                        jenis !== undefined
                          ? `Satuan mengikuti jenis task "${jenis.label}". Pilih "Lainnya" untuk mengisi sendiri.`
                          : undefined
                      }
                      style={jenis !== undefined ? { background: 'var(--bg-subtle, #f2f2f2)' } : undefined}
                      onChange={(e) => setRowDraft({ ...rowDraft, satuan: e.target.value })}
                    />
                  </label>
                  {!isMoney && (
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>Budget (PC-7, opsional)</span>
                      <input
                        type="number"
                        min={0}
                        value={rowDraft.budget}
                        onChange={(e) => setRowDraft({ ...rowDraft, budget: e.target.value })}
                      />
                    </label>
                  )}
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Prioritas (PC-10)</span>
                    <select
                      value={rowDraft.prioritas}
                      onChange={(e) => setRowDraft({ ...rowDraft, prioritas: e.target.value })}
                    >
                      {ROW_PRIORITAS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                </div>
              );
            })()}

            {/* minggu sasaran */}
            <div>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Minggu sasaran (PC-9)
              </span>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {Array.from({ length: plan.jumlah_minggu }, (_, i) => i + 1).map((wnum) => (
                  <label key={wnum} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={rowDraft.minggu_sasaran.includes(wnum)}
                      onChange={(e) =>
                        setRowDraft({
                          ...rowDraft,
                          minggu_sasaran: e.target.checked
                            ? [...rowDraft.minggu_sasaran, wnum].sort((a, b) => a - b)
                            : rowDraft.minggu_sasaran.filter((x) => x !== wnum),
                        })
                      }
                    />
                    <span>M{wnum}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Hasil yang diharapkan (PC-11)</span>
              <input
                value={rowDraft.hasil_diharapkan}
                onChange={(e) => setRowDraft({ ...rowDraft, hasil_diharapkan: e.target.value })}
              />
            </label>

            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>SKU Sasaran (PC-5, opsional)</span>
                <input
                  placeholder="RAK-A, RAK-B — pisahkan dengan koma"
                  value={rowDraft.sku_sasaran}
                  onChange={(e) => setRowDraft({ ...rowDraft, sku_sasaran: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Visibilitas (PC-17)</span>
                <select
                  value={rowDraft.visibilitas}
                  onChange={(e) => setRowDraft({ ...rowDraft, visibilitas: e.target.value })}
                >
                  {ROW_VISIBILITAS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Instruksi Brief (opsional)</span>
              <textarea
                placeholder="Teks instruksi lengkap untuk Brief, atau tempel link Google Drive"
                rows={3}
                value={rowDraft.instruksi_brief}
                onChange={(e) => setRowDraft({ ...rowDraft, instruksi_brief: e.target.value })}
              />
              <span className="muted" style={{ fontSize: 11 }}>
                Ikut diwariskan ke Brief saat &quot;Berikan Brief&quot; diklik — link (mis. Google
                Drive) otomatis muncul sebagai Referensi/Lampiran yang bisa diklik divisi.
              </span>
            </label>

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btnPrimary"
                disabled={acting}
                onClick={() => void submitRow()}
              >
                Simpan baris
              </button>
              <button
                type="button"
                className="btn btnGhost"
                disabled={acting}
                onClick={() => setRowDraft(null)}
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* -------- Brief one-click (RAB-16) -------- */}
      {canInherit && rows.some((r) => r.kuota > 0) && (
        <div className="card">
          <div className="cardHeader">Berikan Brief (satu klik)</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Isi jatuh tempo + prioritas per baris; sisanya (divisi, kuota, satuan, hasil, SKU
            sasaran, budget, Instruksi Brief) diwarisi otomatis ke instruksi Brief — kolom
            &quot;Instruksi Brief&quot; di bawah menunjukkan persis isi yang akan diwariskan (arahkan
            kursor untuk teks penuh). Baris tanpa isian jatuh tempo/prioritas dilewati. Baris yang
            sudah punya Brief menampilkan link ke detailnya di kolom &quot;Brief&quot; (jatuh
            tempo/prioritas terkunci — Brief-nya sudah dibuat, bukan lagi diedit dari sini).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Baris</th>
                  <th style={{ textAlign: 'left' }}>Kuota</th>
                  <th style={{ textAlign: 'left' }}>Hasil diharapkan</th>
                  <th style={{ textAlign: 'left' }}>Budget</th>
                  <th style={{ textAlign: 'left' }}>Instruksi Brief</th>
                  <th style={{ textAlign: 'left' }}>Jatuh tempo</th>
                  <th style={{ textAlign: 'left' }}>Prioritas Brief</th>
                  <th style={{ textAlign: 'left' }}>Brief</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.kuota > 0)
                  .map((r) => {
                    const brief = briefByRow.get(r.id);
                    return (
                    <tr key={r.id}>
                      <td style={{ paddingRight: 8 }}>
                        {PILAR_LABEL[r.pilar] ?? r.pilar} · {r.divisi_pic}
                      </td>
                      <td style={{ paddingRight: 8 }}>
                        {r.kuota} {r.satuan}
                      </td>
                      <td style={{ paddingRight: 8 }}>{r.hasil_diharapkan || '—'}</td>
                      <td style={{ paddingRight: 8 }}>{formatIDR(r.budget)}</td>
                      <td style={{ paddingRight: 8, maxWidth: 220 }}>
                        {r.instruksi_brief ? (
                          <span
                            title={r.instruksi_brief}
                            style={{
                              display: 'block',
                              maxWidth: 220,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.instruksi_brief}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td style={{ paddingRight: 8 }}>
                        <input
                          type="date"
                          value={fills[r.id]?.due_date ?? ''}
                          disabled={brief !== undefined}
                          onChange={(e) =>
                            setFills({
                              ...fills,
                              [r.id]: {
                                due_date: e.target.value,
                                priority: fills[r.id]?.priority ?? '',
                              },
                            })
                          }
                        />
                      </td>
                      <td style={{ paddingRight: 8 }}>
                        <select
                          value={fills[r.id]?.priority ?? ''}
                          disabled={brief !== undefined}
                          onChange={(e) =>
                            setFills({
                              ...fills,
                              [r.id]: {
                                due_date: fills[r.id]?.due_date ?? '',
                                priority: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="">—</option>
                          {BRIEF_PRIORITAS.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ paddingRight: 8 }}>
                        {brief ? (
                          <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                            <Link href={`/account/briefs/${brief.brief_id}`}>{brief.brief_id}</Link>
                            <StatusBadge status={brief.status} />
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btnPrimary"
              disabled={acting}
              onClick={() => void runInherit()}
            >
              Berikan Brief
            </button>
            {inheritMsg && <span className="muted" style={{ fontSize: 12 }}>{inheritMsg}</span>}
          </div>
          {inheritDiLuarHint && (
            <p className="muted" style={{ fontSize: 11, color: '#b45309', marginTop: 8 }}>
              {isKlien ? (
                <>
                  Baris ini dilewati karena belum menunjuk Service manapun (&ldquo;Di Luar
                  Service&rdquo; = penambahan lingkup di luar yang klien beli, M6C Rule 9). Pakai
                  &ldquo;Ubah asal&rdquo; di tabel Baris rencana kerja untuk menunjuk baris ke Service
                  atau pilar Strategi yang benar, lalu klik &ldquo;Berikan Brief&rdquo; lagi.
                </>
              ) : (
                <>
                  Baris dilewati sebagai &ldquo;di luar&rdquo; padahal ini Plan kontrak — baris kontrak
                  seharusnya otomatis diwariskan ke Service tunggal kontrak. Kalau ini muncul,
                  kontraknya kemungkinan punya lebih dari satu Service (&ldquo;service belum
                  jelas&rdquo;) — laporkan supaya bisa ditelusuri.
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* -------- honest note on what this cut does not close -------- */}
      <div className="alert alertInfo" style={{ fontSize: 12 }}>
        Realisasi/variance (P-E), review penutup (P-F), dan carry-over (PF-5) belum tersedia di layar
        ini — rutenya menyusul di iterasi berikutnya.
      </div>
    </div>
  );
}
