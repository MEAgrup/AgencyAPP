'use client';

/**
 * A-13 — the Strategi form (M6A §4 Section A→J).
 *
 * ⚠️ **This is `/account/strategi/{id}`, not `/account/strategies/{id}`.** The
 * latter is the OLD M6 §4 entity (`strategy_plan` / `STR-`) and is a different
 * record with a different lifecycle. They are one letter apart on purpose —
 * nothing links between them, and neither should.
 *
 * ## What this page is responsible for
 *
 * The shell: load the record, chapter it into the ten sections §4 defines, show
 * the live gap count §5 step 5 asks for, autosave every 20s (§7), and run the
 * status transitions. Each section's fields live in its own component.
 *
 * ## Three shapes that come from the PRD, not from taste
 *
 * 1. **The gap count is server-derived, always.** It comes from
 *    `GET /strategi/{id}/kekurangan` and is re-fetched after every save. The
 *    form never decides for itself whether a field is complete: the submit gate
 *    is `checkCompleteness` inside the submit transaction, and a second copy of
 *    those rules here would eventually disagree with it — the AM would see "siap
 *    diajukan" and get `[data tidak lengkap …]`.
 *
 * 2. **Sections save independently.** Each section has its own endpoint, and
 *    each endpoint REPLACES its slice. Saving Section G never touches Section H,
 *    so a half-finished section cannot take another one down with it.
 *
 * 3. **Leaving a section flushes it first.** Switching chapters with a pending
 *    autosave would drop the edit — the draft state is per-section and is
 *    rebuilt from the server response on load.
 *
 * ## A section's endpoints run in sequence, and sometimes the order is a rule
 *
 * Four sections span more than one endpoint (A, B, D, E). In three of them the
 * order is merely "each response is a full StrategiDetail, so racing them would
 * leave the page holding whichever reply landed last". In **B and D it is a
 * constraint**: Section B's baseline rows need the channel IDs that only exist
 * after `saveChannels` answers, and Section D's D-9 mapping is validated against
 * `strategi_target` rows that only exist after `saveTargets` answers. Reordering
 * either one produces a save that fails for a reason the AM cannot see on screen.
 *
 * ## NarasiDraft lives in SectionEDraft
 *
 * E-1 (growth_thesis) and E-13 (urutan_eksekusi_alasan) in Section E share the
 * `/narasi` endpoint with H-3 (skenario_mundur) and H-4 (kondisi_stop_scope) in
 * Section H. The canonical `NarasiDraft` interface is in SectionE — all four
 * fields together. The page holds one copy at `drafts.sectionE.narasi`; Section
 * H reads from it and patches it through the same `patch('sectionE', ...)` path.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAccountLead, isAccountStaff, isReadOnlyOD } from '@/lib/account';
import StatusBadge from '@/components/StatusBadge';
import SectionA, {
  konteksDraftOf,
  konteksDraftToBody,
  aksesDraftToBody,
  type KonteksDraft,
} from '@/components/strategi/SectionA';
import SectionB, {
  channelsDraftOf,
  channelDraftToBody,
  baselineDraftToBody,
  type ChannelDraft,
} from '@/components/strategi/SectionB';
import { mergeBaselinePrefill } from '@/lib/strategi-baseline-inherit';
import SectionC, {
  diagnosaDraftOf,
  diagnosaDraftToPayload,
  type DiagnosaDraftAll,
} from '@/components/strategi/SectionC';
import SectionD, {
  kpiDraftOf,
  targetDraftOf,
  type KpiDraft,
  type TargetDraft,
} from '@/components/strategi/SectionD';
import SectionE, {
  ketergantunganToBody,
  sectionEDraftOf,
  type KetergantunganDraft,
  type NarasiDraft,
  type SectionEDraft,
} from '@/components/strategi/SectionE';
import SectionF, {
  sectionFDraftOf,
  sectionFToResources,
  type SectionFDraft,
} from '@/components/strategi/SectionF';
import SectionG, { kalenderDraftOf, type KalenderDraft } from '@/components/strategi/SectionG';
import SectionH, {
  riskDraftOf,
  triggerDraftOf,
  type RiskDraft,
  type TriggerDraft,
} from '@/components/strategi/SectionH';
import SectionI, { handoffDraftOf, type HandoffDraft } from '@/components/strategi/SectionI';
import SectionJ from '@/components/strategi/SectionJ';
import VisibilitasPanel from '@/components/strategi/VisibilitasPanel';
import ShareLinkPanel from '@/components/strategi/ShareLinkPanel';
import {
  STRATEGI_SECTIONS,
  groupKekurangan,
  isEditable,
  sectionLabel,
  type Kekurangan,
  type SectionKey,
} from '@/lib/strategi-sections';
import { canEditVisibilitas } from '@/lib/strategi-visibilitas';
import {
  REVISI_KOSONG,
  canFlipAsumsi,
  canOpenRevisi,
  canRaiseSanggahan,
  declaredTriggers,
  revisiKekurangan,
  revisiToBody,
  toggleIn,
  type RevisiDraft,
  type SanggahanDraft,
} from '@/lib/strategi-revisi';
import { TRIGGER_REVISI_LABELS } from '@/lib/strategi';
import { AUTOSAVE_MS, useAutosave } from '@/lib/use-autosave';
import {
  approveStrategi,
  getBaselinePrefill,
  getStrategi,
  getStrategiPrefill,
  inheritedKonteksOf,
  INHERITED_KONTEKS_FIELDS,
  openStrategiRevision,
  raiseStrategiSanggahan,
  returnStrategi,
  setStrategiAssumptionStatus,
  saveStrategiAkses,
  saveStrategiAssumptions,
  saveStrategiBaseline,
  saveStrategiChannels,
  saveStrategiDiagnosa,
  saveStrategiHandoff,
  saveStrategiKalender,
  saveStrategiKetergantungan,
  saveStrategiKonteks,
  saveStrategiKpi,
  saveStrategiNarasi,
  saveStrategiPillars,
  saveStrategiResources,
  saveStrategiRisks,
  saveStrategiTargets,
  saveStrategiTriggerRevisi,
  strategiKekurangan,
  submitStrategi,
  updateStrategiHeader,
  type AssumptionState,
  type StrategiBaselinePrefill,
  type StrategiDetail,
  type StrategiPrefill,
} from '@/lib/strategi';
import InterviewPrefillPanel from '@/components/strategi/InterviewPrefillPanel';
import BaselinePrefillPanel from '@/components/strategi/BaselinePrefillPanel';
import PlanPeriodsPanel from '@/components/strategi/PlanPeriodsPanel';
import {
  assumptionsToBody,
  gmvCellsToBody,
  offerableTargetKeys,
  pruneTargetTerkait,
  supportRowsToBody,
} from '@/lib/strategi-target';

/** All sections are now wired (A-13 + A-13b complete). */
// Sections that have a UI. J is read-only (no form) but still "wired": it has a
// panel, so it must not fall through to "belum dibuat", and its J-1/J-4
// visibility toggles are reachable (VisibilitasPanel). `saveActive` has no J
// branch, so autosave is a no-op there.
const WIRED: SectionKey[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

interface Drafts {
  konteks: KonteksDraft;
  channels: ChannelDraft[];
  diagnosa: DiagnosaDraftAll;
  kpi: KpiDraft;
  /** A-13c — D-1/D-2 matrix, D-4 supporting metrics, D-8/D-9 assumptions. */
  targets: TargetDraft;
  /** Holds all four narasi fields (E-1, E-13, H-3, H-4), E-11 and E-12. */
  sectionE: SectionEDraft;
  sectionF: SectionFDraft;
  kalender: KalenderDraft;
  risks: RiskDraft[];
  triggers: TriggerDraft[];
  handoff: HandoffDraft;
}

function draftsOf(d: StrategiDetail): Drafts {
  return {
    konteks: konteksDraftOf(d),
    channels: channelsDraftOf(d),
    diagnosa: diagnosaDraftOf(d),
    kpi: kpiDraftOf(d),
    targets: targetDraftOf(d),
    sectionE: sectionEDraftOf(d),
    sectionF: sectionFDraftOf(d),
    kalender: kalenderDraftOf(d),
    risks: riskDraftOf(d),
    triggers: triggerDraftOf(d),
    handoff: handoffDraftOf(d),
  };
}


export default function StrategiFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);
  // Section writes belong to the owning AM or a Director. Ownership itself is
  // NOT checked here — the response carries no owner field, and the server is
  // the authority either way (CLAUDE.md #6). This only decides whether to render
  // controls that would otherwise 403 on every click.
  const canWrite = !readOnly && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);
  const canApprove = !readOnly && (isAccountLead(role) || !!role?.director);

  const [detail, setDetail] = useState<StrategiDetail | null>(null);
  const [kekurangan, setKekurangan] = useState<Kekurangan[]>([]);
  const [prefill, setPrefill] = useState<StrategiPrefill | null>(null);
  const [baselinePrefill, setBaselinePrefill] = useState<StrategiBaselinePrefill | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [active, setActive] = useState<SectionKey>('A');
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [dirty, setDirty] = useState(false);
  // Monotonic edit counter, bumped by `patch` on every keystroke. `saveActive`
  // snapshots it at the start of a save and, on success, only rebuilds the draft
  // from the server echo when the counter has not moved — i.e. when the AM did
  // NOT type anything while the request was in flight. Without this, a 20s
  // autosave that lands mid-typing overwrites the words entered during its own
  // round-trip (and `setDirty(false)` marks them clean), which is the "isi hilang
  // sendiri saat pindah tab" the owner reported.
  const editGen = useRef(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [returnNote, setReturnNote] = useState('');
  const [acting, setActing] = useState(false);
  /** A-12 — the Rule 13 dialog. `null` while closed, so opening it always starts empty. */
  const [revisi, setRevisi] = useState<RevisiDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [d, k] = await Promise.all([getStrategi(id), strategiKekurangan(id)]);
      setDetail(d);
      setDrafts(draftsOf(d));
      setKekurangan(k);
      setDirty(false);
      // Advisory Interview→Strategi handoff (RAB-09) — never blocks the form, so
      // a failure here must not fail the load. Null when there is no interview.
      getStrategiPrefill(id)
        .then(setPrefill)
        .catch(() => setPrefill(null));
      // RAB-11/RAB-12 — Section B baseline from riset awal. RAB-19 "warisi yang
      // bersumber saja": on top of the reference panel, the sourced fields are
      // seeded into the draft and rendered read-only by SectionB. Advisory: a
      // failure must not fail the load. Null when no analysis.
      getBaselinePrefill(id)
        .then((p) => {
          setBaselinePrefill(p);
          if (p) {
            setDrafts((cur) =>
              cur === null ? cur : { ...cur, channels: mergeBaselinePrefill(cur.channels, p) },
            );
          }
        })
        .catch(() => setBaselinePrefill(null));
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const editable = detail !== null && isEditable(detail.status) && canWrite;
  // ⚠️ NOT `editable`. Rule 16 is the one control on this page that is not
  // Draft-only — see `canEditVisibilitas` for why, and for the two statuses it
  // does refuse. Reusing `editable` here would quietly re-impose the Draft-only
  // rule the domain deliberately does not have.
  const visibilitasEditable = detail !== null && canEditVisibilitas(detail.status) && canWrite;

  /**
   * Saves the ACTIVE section only.
   *
   * Sending every section on every tick would make one invalid row anywhere
   * block the save of the section the AM is actually in — and, worse, would
   * rewrite sections the AM never opened with whatever this page last loaded.
   */
  const saveActive = useCallback(async () => {
    if (!drafts || !editable || !detail) return;
    // Snapshot the edit counter BEFORE the first await: anything the AM types
    // after this point must survive the server echo below.
    const genAtStart = editGen.current;
    setSaving(true);
    setError(null);
    try {
      let next: StrategiDetail;
      if (active === 'A') {
        // Section A spans two endpoints: konteks (header scalars) + akses (matrix).
        // They run in sequence — each is a full StrategiDetail; the second wins.
        await saveStrategiKonteks(id, konteksDraftToBody(drafts.konteks));
        next = await saveStrategiAkses(id, aksesDraftToBody(drafts.konteks.akses));
      } else if (active === 'B') {
        // Step 1: save channel metadata (+ E-2 priority). The response contains
        // the server-assigned channel IDs.
        const channelResult = await saveStrategiChannels(
          id,
          drafts.channels.map(channelDraftToBody),
        );
        // Step 2: for each Eksisting channel with a declared period, save its
        // baseline months. Runs sequentially — each response is a full detail.
        let current = channelResult;
        for (const ch of drafts.channels) {
          if (ch.status_channel === 'Belum Aktif') continue;
          const nMonths = ch.periode_baseline_bulan.trim()
            ? Math.max(1, Math.min(12, Math.round(Number(ch.periode_baseline_bulan))))
            : 0;
          if (nMonths === 0) continue;
          const saved = channelResult.channels.find((c) => c.channel === ch.channel);
          if (!saved) continue;
          // Ensure the baseline array covers exactly nMonths rows (same logic as
          // the component's ensuredBaseline — the component only manages display).
          const months = Array.from({ length: nMonths }, (_, i) => {
            return (
              ch.baseline.find((m) => m.month_index === i) ?? {
                month_index: i,
                gmv: '',
                jumlah_pesanan: '',
                persen_batal: '',
                ad_spend: '',
                roas: '',
                acos: '',
              }
            );
          });
          current = await saveStrategiBaseline(id, saved.id, baselineDraftToBody(months));
        }
        next = current;
      } else if (active === 'C') {
        next = await saveStrategiDiagnosa(id, diagnosaDraftToPayload(drafts.diagnosa));
      } else if (active === 'D') {
        // THREE endpoints. Two ordering rules apply:
        //
        // 1. KPI (D-5 definisi berhasil, D-6 leading indicator) is a header slice
        //    independent of targets and assumptions, and it is saved FIRST. It
        //    used to run last, so a validation error in the target→assumption
        //    chain below — easy to trigger while the GMV matrix is half-filled —
        //    aborted the whole save before KPI ran, and the AM's D-5/D-6 answers
        //    were silently never persisted ("kurang padahal sudah terisi").
        // 2. Within the remaining chain the ORDER is still load-bearing — the
        //    same trap Section B has with channels-then-baseline. `saveAssumptions`
        //    refuses any D-9 reference that does not name a real `strategi_target`
        //    row (`[asumsi menunjuk target yang tidak ada]`), and refuses the
        //    WHOLE call for one bad key. So targets must land first, and the
        //    assumptions that follow must reference only what actually landed:
        //    half-filled GMV cells are skipped by `gmvCellsToBody`, and a D-9 tick
        //    pointing at one of them would otherwise block the save with no
        //    visible cause.
        next = await saveStrategiKpi(id, drafts.kpi);
        const { rows: gmvRows } = gmvCellsToBody(drafts.targets.gmv);
        next = await saveStrategiTargets(id, [
          ...gmvRows,
          ...supportRowsToBody(drafts.targets.pendukung),
        ]);
        next = await saveStrategiAssumptions(
          id,
          pruneTargetTerkait(
            assumptionsToBody(drafts.targets.assumptions),
            offerableTargetKeys(drafts.targets.gmv),
          ),
        );
      } else if (active === 'E') {
        // E-1 / E-13 — same narasi endpoint as H-3 / H-4. The four fields are
        // always sent together so a Section E save never blanks H-3/H-4 and vice
        // versa.
        const n = drafts.sectionE.narasi;
        await saveStrategiNarasi(id, {
          growth_thesis: n.growth_thesis || null,
          urutan_eksekusi_alasan: n.urutan_eksekusi_alasan || null,
          skenario_mundur: n.skenario_mundur || null,
          kondisi_stop_scope: n.kondisi_stop_scope || null,
        });
        // E-11 (tidak_dikerjakan) is stored as pillars. Preserve the non-E-11
        // pillars (E-3…E-10) which have their own editor (not yet wired); replace
        // only the tidak_dikerjakan slice.
        const keepPillars = detail.pillars
          .filter((p) => p.jenis !== 'tidak_dikerjakan');
        const tdPillars = drafts.sectionE.tidak_dikerjakan
          .filter((t) => t.item.trim())
          .map((t, i) => ({
            jenis: 'tidak_dikerjakan',
            aksi: t.item,
            urutan: keepPillars.length + i + 1,
          }));
        next = await saveStrategiPillars(id, [...keepPillars, ...tdPillars]);
        // E-12 has its own endpoint and its own table. Deliberately NOT folded
        // into `saveKalender` even though §4 groups it near the calendar: the
        // gap kode is `E-12`, so the nav sends the AM here, and a Section G save
        // owning it would make "which section is incomplete" depend on which
        // route happened to run last.
        next = await saveStrategiKetergantungan(
          id,
          ketergantunganToBody(drafts.sectionE.ketergantungan),
        );
      } else if (active === 'F') {
        next = await saveStrategiResources(
          id,
          sectionFToResources(drafts.sectionF),
        );
        // F-7 is NOT a resource row — it is `strategi.toleransi_over_persen`,
        // reachable only through the header endpoint. That endpoint answers
        // with a Strategi (header), not a StrategiDetail, so the detail has to
        // be re-read; the write is skipped entirely when the value is unchanged
        // so a Section F save does not touch the contract window for nothing.
        const tol = drafts.sectionF.toleransi_over_persen.trim();
        if (tol !== '' && Number(tol) !== next.toleransi_over_persen) {
          await updateStrategiHeader(id, {
            durasi_kontrak_bulan: next.durasi_kontrak_bulan,
            tanggal_mulai_kontrak: next.tanggal_mulai_kontrak,
            tanggal_akhir_kontrak: next.tanggal_akhir_kontrak,
            tanggal_mulai_siklus: next.tanggal_mulai_siklus,
            toleransi_over_persen: Number(tol),
          });
          next = await getStrategi(id);
        }
      } else if (active === 'G') {
        next = await saveStrategiKalender(id, drafts.kalender);
      } else if (active === 'H') {
        // Section H spans three endpoints because its parts have three
        // different grains (risk rows, trigger rows, header paragraphs). They
        // run in sequence, not in parallel: each response is a full
        // StrategiDetail, and racing them would leave the page holding whichever
        // reply landed last as if it were the whole truth.
        await saveStrategiRisks(id, drafts.risks);
        await saveStrategiTriggerRevisi(
          id,
          drafts.triggers.map((t) => ({
            kode: t.kode,
            ambang: t.ambang.trim() === '' ? null : Number(t.ambang),
            catatan: t.catatan.trim() === '' ? null : t.catatan.trim(),
          })),
        );
        // H-3/H-4 share the narasi endpoint with E-1/E-13, so the two Section E
        // fields must be sent back unchanged — the endpoint replaces all four,
        // and omitting them would blank Section E from a Section H save.
        const n = drafts.sectionE.narasi;
        next = await saveStrategiNarasi(id, {
          growth_thesis: n.growth_thesis || null,
          urutan_eksekusi_alasan: n.urutan_eksekusi_alasan || null,
          skenario_mundur: n.skenario_mundur || null,
          kondisi_stop_scope: n.kondisi_stop_scope || null,
        });
      } else if (active === 'I') {
        next = await saveStrategiHandoff(id, {
          dispatch: drafts.handoff.dispatch.map((d, i) => ({
            divisi: d.divisi,
            urutan: i + 1,
            catatan: d.catatan.trim() === '' ? null : d.catatan.trim(),
          })),
          metrik_laporan_klien: drafts.handoff.metrik_laporan_klien,
        });
      } else {
        return;
      }
      setDetail(next);
      // Only adopt the server echo as the new draft when the AM did not edit
      // during the round-trip. If they did (`editGen` moved), keep their in-flight
      // draft and leave `dirty` set so the next autosave persists it — rebuilding
      // here would silently discard whatever they typed while this save ran.
      if (editGen.current === genAtStart) {
        setDrafts(draftsOf(next));
        setDirty(false);
      }
      setSavedAt(new Date().toLocaleTimeString('id-ID'));
      setKekurangan(await strategiKekurangan(id));
    } catch (err) {
      // `dirty` stays set: the edit is still unsaved, the banner says so, and
      // the next change re-arms autosave. Clearing it here would show a clean
      // form over an unsaved change.
      setError(errorMessage(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [active, drafts, editable, id, detail]);

  const { flush } = useAutosave({ dirty, enabled: editable, save: saveActive });

  const patch = useCallback(<K extends keyof Drafts>(key: K, value: Drafts[K]) => {
    editGen.current += 1;
    setDrafts((d) => (d === null ? d : { ...d, [key]: value }));
    setDirty(true);
  }, []);

  const goTo = useCallback(
    async (key: SectionKey) => {
      if (key === active) return;
      if (dirty && editable) {
        try {
          await flush();
        } catch {
          // Save failed; stay put so the AM sees the error next to the fields
          // that caused it rather than on a section they did not edit.
          return;
        }
      }
      setActive(key);
      setError(null);
    },
    [active, dirty, editable, flush],
  );

  const grouped = useMemo(() => groupKekurangan(kekurangan), [kekurangan]);

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

  if (loading) return <p className="pageLoading">Memuat…</p>;
  if (loadError) return <div className="alert alertError">{loadError}</div>;
  if (!detail || !drafts) return <div className="alert alertError">[Strategi tidak ditemukan]</div>;

  const total = kekurangan.length;

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>{detail.id}</h1>
          <StatusBadge status={detail.status} />
          <span className="muted">versi {detail.versi_no}</span>
          <span style={{ flex: 1 }} />
          <Link href={`/clients/${detail.client_id}`} className="btn btnGhost btnSm">
            Klien
          </Link>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          Kontrak {detail.contract_id} · {detail.tanggal_mulai_kontrak} →{' '}
          {detail.tanggal_akhir_kontrak} ({detail.durasi_kontrak_bulan} bulan)
        </p>
      </div>

      {error && <div className="alert alertError">{error}</div>}

      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <nav className="card" style={{ width: 260, flexShrink: 0 }}>
          <div className="cardHeader">Seksi</div>
          <div className="stack" style={{ gap: 2 }}>
            {STRATEGI_SECTIONS.map((s) => {
              const n = grouped.get(s.key)?.length ?? 0;
              const wired = WIRED.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  className={active === s.key ? 'btn btnSecondary btnSm' : 'btn btnGhost btnSm'}
                  style={{ justifyContent: 'space-between', display: 'flex', width: '100%' }}
                  onClick={() => goTo(s.key)}
                  disabled={!wired}
                  title={wired ? undefined : 'Form seksi ini belum dibuat'}
                >
                  <span style={{ opacity: wired ? 1 : 0.55 }}>
                    {s.key}. {s.label}
                  </span>
                  {n > 0 && <span className="badge badge-amber">{n}</span>}
                </button>
              );
            })}
            {/* Only rendered when something landed in it — an unclassified gap
                must never be invisible, because it is counted on the submit
                button and the AM has no other way to find it. */}
            {(grouped.get('lain')?.length ?? 0) > 0 && (
              <div className="alert alertError" style={{ fontSize: 12, marginTop: 8 }}>
                {grouped.get('lain')!.length} kekurangan tidak dikenali seksinya — laporkan ke tim
                sistem:
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {grouped.get('lain')!.map((k) => (
                    <li key={k.kode}>
                      <code>{k.kode}</code> {k.pesan}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </nav>

        <div className="stack" style={{ flex: 1 }}>
          <div className="card">
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <div className="cardHeader" style={{ flex: 1, marginBottom: 0 }}>
                {sectionLabel(active)}
              </div>
              {editable && (
                <>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {saving
                      ? 'Menyimpan…'
                      : dirty
                        ? `Belum tersimpan — otomatis dalam ${AUTOSAVE_MS / 1000} detik`
                        : savedAt
                          ? `Tersimpan ${savedAt}`
                          : ''}
                  </span>
                  <button
                    type="button"
                    className="btn btnSecondary btnSm"
                    disabled={!dirty || saving}
                    onClick={() => void flush().catch(() => undefined)}
                  >
                    Simpan
                  </button>
                </>
              )}
            </div>

            {!editable && (
              <div className="alert alertInfo" style={{ fontSize: 13 }}>
                {isEditable(detail.status)
                  ? 'Anda tidak punya hak ubah pada Strategi ini.'
                  : `Strategi berstatus ${detail.status} — Section A→I hanya bisa diubah saat Draft atau Draft Revisi.`}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              {active === 'A' && (
                <>
                  {/* The moved fields (A-1/A-5/A-8/A-10/A-12) render read-only in
                      Section A itself; drop them from the advisory panel so it
                      does not also tell the AM to "copy" what is now inherited. */}
                  {prefill && (
                    <InterviewPrefillPanel
                      prefill={{
                        ...prefill,
                        items: prefill.items.filter(
                          (it) => !INHERITED_KONTEKS_FIELDS.includes(it.strategi_field as never),
                        ),
                      }}
                    />
                  )}
                  <SectionA
                    detail={detail}
                    draft={drafts.konteks}
                    inherited={inheritedKonteksOf(prefill)}
                    onChange={(p) => patch('konteks', { ...drafts.konteks, ...p })}
                    disabled={!editable}
                  />
                </>
              )}
              {active === 'B' && (
                <>
                  {baselinePrefill && <BaselinePrefillPanel prefill={baselinePrefill} />}
                  <SectionB
                    draft={drafts.channels}
                    onChange={(channels) => patch('channels', channels)}
                    disabled={!editable}
                    baselinePrefill={baselinePrefill}
                  />
                </>
              )}
              {active === 'C' && (
                <SectionC
                  detail={detail}
                  draft={drafts.diagnosa}
                  onChange={(p) => patch('diagnosa', { ...drafts.diagnosa, ...p })}
                  disabled={!editable}
                />
              )}
              {active === 'D' && (
                <SectionD
                  detail={detail}
                  draft={drafts.kpi}
                  targets={drafts.targets}
                  onChange={(p) => patch('kpi', { ...drafts.kpi, ...p })}
                  onTargets={(p) => patch('targets', { ...drafts.targets, ...p })}
                  disabled={!editable}
                  onSanggahan={(body: SanggahanDraft) =>
                    act(() => raiseStrategiSanggahan(id, body))
                  }
                  onAsumsiStatus={(kode: string, status: AssumptionState) =>
                    act(() => setStrategiAssumptionStatus(id, kode, status))
                  }
                  // Draft-only, exactly like every other Section D write.
                  sanggahanEnabled={canWrite && canRaiseSanggahan(detail.status)}
                  // NOT the same gate: an assumption breaks during execution,
                  // which is precisely when `editable` is false.
                  asumsiFlipEnabled={canWrite && canFlipAsumsi(detail.status)}
                  busy={acting || dirty || saving}
                />
              )}
              {active === 'E' && (
                <SectionE
                  detail={detail}
                  draft={drafts.sectionE}
                  onNarasi={(p) =>
                    patch('sectionE', {
                      ...drafts.sectionE,
                      narasi: { ...drafts.sectionE.narasi, ...p },
                    })
                  }
                  onTidakDikerjakan={(rows) =>
                    patch('sectionE', { ...drafts.sectionE, tidak_dikerjakan: rows })
                  }
                  onKetergantungan={(rows: KetergantunganDraft[]) =>
                    patch('sectionE', { ...drafts.sectionE, ketergantungan: rows })
                  }
                  disabled={!editable}
                />
              )}
              {active === 'F' && (
                <SectionF
                  detail={detail}
                  draft={drafts.sectionF}
                  onChange={(p) => patch('sectionF', { ...drafts.sectionF, ...p })}
                  disabled={!editable}
                />
              )}
              {active === 'G' && (
                <SectionG
                  detail={detail}
                  draft={drafts.kalender}
                  onChange={(p) => patch('kalender', { ...drafts.kalender, ...p })}
                  disabled={!editable}
                />
              )}
              {active === 'H' && (
                <SectionH
                  risks={drafts.risks}
                  triggers={drafts.triggers}
                  narasi={drafts.sectionE.narasi}
                  onRisks={(rows) => patch('risks', rows)}
                  onTriggers={(rows) => patch('triggers', rows)}
                  onNarasi={(p) =>
                    patch('sectionE', {
                      ...drafts.sectionE,
                      narasi: { ...drafts.sectionE.narasi, ...p } as NarasiDraft,
                    })
                  }
                  disabled={!editable}
                />
              )}
              {active === 'I' && (
                <SectionI
                  draft={drafts.handoff}
                  onChange={(p) => patch('handoff', { ...drafts.handoff, ...p })}
                  disabled={!editable}
                />
              )}
              {active === 'J' && <SectionJ strategiId={id} detail={detail} />}
              {!WIRED.includes(active) && (
                <p className="muted">Form seksi ini belum dibuat.</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              Kekurangan{' '}
              {total === 0 ? (
                <span className="badge badge-green">lengkap</span>
              ) : (
                <span className="badge badge-amber">{total}</span>
              )}
            </div>
            {total === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                Semua pertanyaan wajib sudah terisi.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {(grouped.get(active) ?? []).map((k) => (
                  <li key={k.kode}>
                    <code>{k.kode}</code> {k.pesan}
                  </li>
                ))}
                {(grouped.get(active)?.length ?? 0) === 0 && (
                  <li className="muted">Tidak ada di seksi ini — lihat angka di navigasi kiri.</li>
                )}
              </ul>
            )}

            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {editable && (
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={acting || dirty || saving}
                  onClick={() => void act(() => submitStrategi(id))}
                  // Not disabled on `total > 0`: the count is a snapshot, and the
                  // submit transaction re-runs the gate anyway. Blocking here
                  // would hide the server's exact message — the one thing that
                  // tells the AM what to fix.
                  title={
                    total > 0
                      ? `${total} pertanyaan wajib masih kosong — pengajuan akan ditolak`
                      : undefined
                  }
                >
                  Ajukan{total > 0 ? ` (${total} kurang)` : ''}
                </button>
              )}
              {canApprove && detail.status === 'Diajukan' && (
                <>
                  <button
                    type="button"
                    className="btn btnPrimary"
                    disabled={acting}
                    onClick={() => void act(() => approveStrategi(id))}
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
                    onClick={() => void act(() => returnStrategi(id, returnNote.trim()))}
                  >
                    Kembalikan
                  </button>
                </>
              )}
              {/* A-12 / Rule 13. `Aktif` ONLY — not "anything not a draft":
                  `Diajukan` is awaiting approval and `Diarsipkan` is already
                  superseded, and revising either is a request the server refuses. */}
              {canWrite && canOpenRevisi(detail.status) && revisi === null && (
                <button
                  type="button"
                  className="btn btnSecondary"
                  disabled={acting}
                  onClick={() => setRevisi(REVISI_KOSONG)}
                >
                  Buka revisi
                </button>
              )}
            </div>

            {revisi !== null && (
              <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                <div className="alert alertInfo" style={{ fontSize: 13 }}>
                  Revisi membuat <strong>versi {detail.versi_no + 1}</strong> berstatus{' '}
                  <code>Draft Revisi</code>. Versi {detail.versi_no} tetap <code>Aktif</code> dan
                  baru diarsipkan saat versi baru disetujui — klien tidak pernah kehilangan
                  dokumen di tengah revisi.
                </div>

                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Trigger yang terpicu — hanya yang Strategi ini deklarasikan di H-2
                  </div>
                  {declaredTriggers(detail).length === 0 ? (
                    // Unreachable on an approved record (H-2 is a submit
                    // requirement), so if it ever shows, the record predates that
                    // gate — say so instead of rendering an empty box.
                    <p className="muted" style={{ fontSize: 13 }}>
                      Strategi ini tidak mendeklarasikan satu pun trigger di H-2 — revisi tidak
                      bisa dibuka. Laporkan ke tim sistem.
                    </p>
                  ) : (
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {declaredTriggers(detail).map((kode) => {
                        const label =
                          TRIGGER_REVISI_LABELS.find((t) => t.value === kode)?.label ?? kode;
                        const on = revisi.trigger_revisi.includes(kode);
                        return (
                          <button
                            key={kode}
                            type="button"
                            className={on ? 'btn btnSecondary btnSm' : 'btn btnGhost btnSm'}
                            onClick={() =>
                              setRevisi({
                                ...revisi,
                                trigger_revisi: toggleIn(revisi.trigger_revisi, kode),
                              })
                            }
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                    Asumsi D-8 yang gugur
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {detail.assumptions.map((a) => {
                      const on = revisi.asumsi_gugur.includes(a.kode);
                      return (
                        <button
                          key={a.kode}
                          type="button"
                          className={on ? 'btn btnSecondary btnSm' : 'btn btnGhost btnSm'}
                          title={a.asumsi}
                          onClick={() =>
                            setRevisi({
                              ...revisi,
                              asumsi_gugur: toggleIn(revisi.asumsi_gugur, a.kode),
                            })
                          }
                        >
                          {a.kode}
                          {a.status === 'Gugur' && ' ·  sudah gugur'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <textarea
                  rows={3}
                  placeholder="Alasan revisi (wajib)"
                  value={revisi.alasan_revisi}
                  onChange={(e) => setRevisi({ ...revisi, alasan_revisi: e.target.value })}
                />

                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btnPrimary"
                    disabled={acting || revisiKekurangan(revisi).length > 0}
                    onClick={() =>
                      void act(async () => {
                        await openStrategiRevision(id, revisiToBody(revisi));
                        setRevisi(null);
                      })
                    }
                  >
                    Buat versi {detail.versi_no + 1}
                  </button>
                  <button
                    type="button"
                    className="btn btnGhost"
                    disabled={acting}
                    onClick={() => setRevisi(null)}
                  >
                    Batal
                  </button>
                  {/* Names WHICH of Rule 13's three boxes is empty. The server
                      answers all three with one sentence, which is correct as a
                      gate and useless as a hint. */}
                  {revisiKekurangan(revisi).length > 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      Masih kurang: {revisiKekurangan(revisi).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* A-13d — Rule 16. Sits below the gap panel because it answers a
              different question about the same chapter: not "what is still
              missing" but "what of this will the client actually read". */}
          <VisibilitasPanel
            strategiId={id}
            rows={detail.visibilitas}
            active={active}
            reachable={WIRED}
            disabled={!visibilitasEditable || acting}
            onChanged={(rows) =>
              // Patch `detail` in place — do NOT call `draftsOf` here. A toggle is
              // its own request, unrelated to whatever the AM has half-typed into
              // this section; rebuilding the drafts from the response would throw
              // away every unsaved edit the moment someone flips a switch.
              setDetail((d) => (d === null ? d : { ...d, visibilitas: rows }))
            }
          />

          {/* A-11 (§7 D20) — the client link. Sits with the visibility panel
              because both answer "what does the client get"; this one is the
              delivery mechanism, that one is the filter. Minting needs an active
              version, so it is inert until approval. */}
          <ShareLinkPanel
            strategiId={id}
            active={detail.status === 'Aktif'}
            canManage={canWrite || canApprove}
          />

          {/* M6B bridge — the Plan periods this Strategi generated on approval.
              Read-only list; each links into its period page where the target
              becomes work rows (kuota) and Briefs. */}
          <PlanPeriodsPanel contractId={detail.contract_id} />
        </div>
      </div>
    </div>
  );
}
