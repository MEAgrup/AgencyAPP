'use client';

/**
 * Modul Interview — the "Kelola Klien" page (langkah 7).
 *
 * ## Three steps, not two (owner QA 2026-08-12)
 *
 * "Kelola Klien" is **Riset Awal → Interview → Strategi**. Step 1 — the AM logs
 * into the client's store and records the baseline — was missing from CDPS
 * entirely, and every step is measured so a timeline cannot slip unnoticed. Tab 1
 * is now Riset Awal and it is where the page lands while that step is still
 * running; once it is submitted the page opens on the Interview tab, which is
 * where the work continues.
 *
 * ## What this page is responsible for
 *
 * The shell for one interview: measure Riset Awal (start stamped server-side when
 * this page's interview was opened, submit recorded here), load the record, run
 * the Blok A schedule, chapter Blok B into its sections with progressive
 * disclosure, autosave the draft every 20s (§7, `PUT /answers`), run the lifecycle
 * transitions, and drive a PINNED live-scoring sidebar. Two print views hang off
 * it — internal (everything) and client (prasyarat only, score/verdict stripped).
 *
 * ## The scoring invariant (preview = submit)
 *
 * The sidebar computes with the SAME `hitungKualifikasi` the server persists —
 * ported into `interview-scoring.ts` because running the persisting
 * `POST /score` on every keystroke would spam SPV notifications. "Hitung & simpan
 * skor" is the explicit persist; the sidebar preview is advisory. The verdict is
 * advisory end-to-end: nothing here blocks on it (I14).
 *
 * ## Desktop-first
 *
 * §7 asks for 1440px, min 1280px. Below 1280 the page still renders (deep links
 * must work) but shows a notice — a two-pane form + pinned sidebar is not usable
 * on a narrow viewport, and hiding it would be worse than warning about it.
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  canEditClientProfile,
  getService,
  isAccountLead,
  isAccountStaff,
  isReadOnlyOD,
  nextOnboardingStep,
  type ServiceQueueRow,
} from '@/lib/account';
import { formatIDR } from '@/lib/money';
import { AUTOSAVE_MS, useAutosave } from '@/lib/use-autosave';
import {
  HAMBATAN_LABELS,
  INTERVIEW_STATUS,
  VERDICT_LABELS,
  availableTransitions,
  formatDurasiMenit,
  getInterview,
  getKelolaKlienTimeline,
  interviewStatusTone,
  isAnswerEditable,
  resolveInterviewPrasyarat,
  RISET_AWAL_STATUS,
  saveInterviewAnswers,
  scheduleInterview,
  scoreInterview,
  submitRisetAwal,
  transitionInterview,
  type InterviewDetail,
  type KelolaKlienTimeline,
} from '@/lib/interview';
import {
  INTERVIEW_SECTIONS,
  PRASYARAT_FIELD_KEY,
  buildAnswersPayload,
  buildScoreInput,
  draftFromDetail,
  estimasiTanpaDasar,
  fieldsOfSection,
  minorToRupiah,
  previewKualifikasi,
  toScoreWire,
  type InterviewDraft,
} from '@/lib/interview-fields';
import { getRisetAwalBaseline, type RisetAwalBaseline } from '@/lib/riset-awal';
import { getClient, type Client } from '@/lib/clients';
import { computeDedup, DEDUP_FIELD_KEYS, type DedupResult } from '@/lib/interview-dedup';
import FieldInput from '@/components/interview/FieldInput';
import ScoringSidebar from '@/components/interview/ScoringSidebar';
import PrasyaratPanel from '@/components/interview/PrasyaratPanel';
import RisetAwalPanel from '@/components/interview/RisetAwalPanel';
import DedupField from '@/components/interview/DedupField';
import SalesContextCard from '@/components/interview/SalesContextCard';
import TimelinePanel from '@/components/interview/TimelinePanel';

const MIN_WIDTH = 1280;

/** The two tabs this page owns. Step 3 (Strategi, or Brief for a Direct-path
 *  Service) lives on the Service hub. */
type Tab = 'riset' | 'interview';

export default function KelolaKlienPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { role } = useAuth();
  const readOnly = isReadOnlyOD(role);
  const canWrite = !readOnly && (isAccountStaff(role) || isAccountLead(role) || !!role?.director);
  const canLead = !readOnly && (isAccountLead(role) || !!role?.director);
  const canFixPlatformList = !readOnly && canEditClientProfile(role);

  const [detail, setDetail] = useState<InterviewDetail | null>(null);
  const [timeline, setTimeline] = useState<KelolaKlienTimeline | null>(null);
  const [draft, setDraft] = useState<InterviewDraft | null>(null);
  // Riset awal baseline + the client's sales record — the two upstream sources
  // the Interview door reads so it never re-asks what is already known (RAB-08).
  const [baseline, setBaseline] = useState<RisetAwalBaseline | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  // The Service's own onboarding step (M6C gate order) — the forward links below
  // must not promise "Strategi & Plan" when the Service is Direct-path (no
  // Strategi ever exists for it, §4 Rule 6): they show whatever `nextOnboardingStep`
  // actually names, mirroring the Service hub so the AM is never sent to a page
  // that has nothing for them to click (QA 2026-08-27, ITV-202608-0024).
  const [serviceQueue, setServiceQueue] = useState<ServiceQueueRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const [open, setOpen] = useState<Set<string>>(new Set(['B1', 'B2']));
  const [narrow, setNarrow] = useState(false);
  // Which step the page opens on. `null` until the record loads, then resolved
  // once from the riset awal status — an unsubmitted step 1 is what the AM came
  // back for. After that it follows the AM's clicks, never snapping back.
  const [tab, setTab] = useState<Tab | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [printMode, setPrintMode] = useState<'internal' | 'klien' | null>(null);

  // Format is intentionally NOT collected: the location/link already conveys the
  // channel (QA 2026-08-12), so every schedule is written with format = null.
  const [jadwal, setJadwal] = useState({
    tanggal_waktu: '',
    durasi_menit: '',
    lokasi_link: '',
    catatan_persiapan: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const d = await getInterview(id);
      setDetail(d);
      setDraft(draftFromDetail(d));
      // The timeline is a second call on purpose (holiday-aware working days +
      // a strategy lookup). A failure there must not blank the page the AM came
      // to work in, so it degrades to "no timeline shown".
      getKelolaKlienTimeline(id)
        .then(setTimeline)
        .catch(() => setTimeline(null));
      // Riset awal baseline (RAB-04 panel + RAB-08 dedup) and the client's sales
      // record (RAB-08 context). Both degrade to null on failure — neither is
      // allowed to blank the interview page.
      getRisetAwalBaseline(id)
        .then(setBaseline)
        .catch(() => setBaseline(null));
      getClient(d.interview.client_id)
        .then((r) => setClient(r.client))
        .catch(() => setClient(null));
      // Same degrade-to-null rule as baseline/client above — a failed lookup must
      // not blank the page, it just falls back to the generic "Lanjut ke layanan"
      // label instead of the specific next-step label.
      if (d.interview.service_id) {
        getService(d.interview.service_id)
          .then(setServiceQueue)
          .catch(() => setServiceQueue(null));
      } else {
        setServiceQueue(null);
      }
      setTab((t) => t ?? (d.riset_awal?.status === RISET_AWAL_STATUS.Berjalan ? 'riset' : 'interview'));
      setDirty(false);
      setJadwal({
        tanggal_waktu: d.jadwal?.tanggal_waktu ? toLocalInput(d.jadwal.tanggal_waktu) : '',
        durasi_menit: d.jadwal?.durasi_menit != null ? String(d.jadwal.durasi_menit) : '',
        lokasi_link: d.jadwal?.lokasi_link ?? '',
        catatan_persiapan: d.jadwal?.catatan_persiapan ?? '',
      });
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Refetch ONLY the baseline after a per-platform submit / confirm write, so the
  // panel updates without the full-page loading spinner blanking the AM's work.
  const reloadBaseline = useCallback(async () => {
    try {
      setBaseline(await getRisetAwalBaseline(id));
    } catch {
      /* leave the last-good baseline in place */
    }
  }, [id]);

  // RAB-08 (widened QA 2026-08-20): seed the riset-awal-answered scored fields
  // (B2-9 AOV, B2-3 SKU, B1-5 omzet 3 bln, B6-3 target 3 bln) into the draft so the
  // local score preview stays complete even though their Blok B inputs are hidden
  // (DedupField). Never clobbers a value the AM typed — only fills an empty field,
  // and the seeded value matches what the scorer uses server-side (RAB-06), so
  // preview = submit still holds. Money fields (all but B2-3) read from nilai_uang.
  useEffect(() => {
    if (!baseline) return;
    const moneyKeys = new Set(['B2-9', 'B1-5', 'B6-3']);
    const seedable = new Set<string>(DEDUP_FIELD_KEYS);
    setDraft((d) => {
      if (!d) return d;
      let changed = false;
      const next = { ...d };
      for (const f of baseline.isian) {
        if (!seedable.has(f.field_key)) continue;
        const cur = next[f.field_key];
        if (!cur || cur.raw.trim() !== '') continue;
        const raw = moneyKeys.has(f.field_key) ? minorToRupiah(f.nilai_uang) : f.nilai_angka == null ? '' : String(f.nilai_angka);
        if (raw === '') continue;
        next[f.field_key] = { ...cur, raw };
        changed = true;
      }
      return changed ? next : d;
    });
  }, [baseline]);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < MIN_WIDTH);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Print: mark the chosen section active, print after paint, then clear.
  useEffect(() => {
    if (!printMode) return;
    const raf = requestAnimationFrame(() => {
      window.print();
      setPrintMode(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [printMode]);

  const editable = detail !== null && isAnswerEditable(detail.interview.status) && canWrite;
  const preview = useMemo(() => (draft ? previewKualifikasi(draft) : null), [draft]);

  const saveAnswers = useCallback(async () => {
    if (!draft || !editable) return;
    setSaving(true);
    setError(null);
    try {
      const d = await saveInterviewAnswers(id, buildAnswersPayload(draft));
      setDetail(d);
      // Keep the AM's in-progress edits; only refresh what the server normalised
      // is unnecessary here (answers echo back what we sent), so we do NOT rebuild
      // the draft — rebuilding would drop a keystroke that landed mid-save.
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString('id-ID'));
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [draft, editable, id]);

  const { flush } = useAutosave({ dirty, enabled: editable, save: saveAnswers });

  const patchField = useCallback((fieldKey: string, value: InterviewDraft[string]) => {
    setDraft((d) => (d === null ? d : { ...d, [fieldKey]: value }));
    setDirty(true);
  }, []);

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

  const toggleSection = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const saveSchedule = () =>
    act(() =>
      scheduleInterview(id, {
        tanggal_waktu: jadwal.tanggal_waktu ? jadwal.tanggal_waktu : null,
        durasi_menit: jadwal.durasi_menit.trim() === '' ? null : Number(jadwal.durasi_menit),
        format: null, // no longer collected — location/link is enough (QA 2026-08-12)
        lokasi_link: jadwal.lokasi_link.trim() === '' ? null : jadwal.lokasi_link.trim(),
        catatan_persiapan: jadwal.catatan_persiapan.trim() === '' ? null : jadwal.catatan_persiapan.trim(),
      }),
    );

  // "Mulai interview" — jump straight to Sedang Berlangsung without a fixed
  // schedule (SM edges added 20260812000000). Client schedules shift
  // unpredictably, so starting must not depend on the jadwal being locked first.
  const startInterview = () => act(() => transitionInterview(id, INTERVIEW_STATUS.SedangBerlangsung));

  // Step 1 submit. On success the page moves the AM on to step 2 — that is the
  // next thing to do, and leaving them on a finished step reads as a dead end.
  const submitRiset = () =>
    act(async () => {
      await submitRisetAwal(id);
      setTab('interview');
    });

  const hitungSimpan = () => {
    if (!draft) return;
    const { input } = buildScoreInput(draft);
    if (!input) return;
    // Flush any pending answer edits first so the persisted score matches what
    // the AM sees on screen, then persist the score.
    act(async () => {
      if (dirty) await flush();
      await scoreInterview(id, toScoreWire(input), {
        prasyarat_status: detail?.kualifikasi?.prasyarat_status,
      });
    });
  };

  if (loading) return <p className="pageLoading">Memuat…</p>;
  if (loadError) return <div className="alert alertError">{loadError}</div>;
  if (!detail || !draft || !preview) return <div className="alert alertError">[Interview tidak ditemukan]</div>;

  const iv = detail.interview;
  const risetAwal = detail.riset_awal;
  const kualifikasi = detail.kualifikasi;
  // Before the first load resolves the step, show the interview tab rather than
  // an empty page — `tab` is only null for that one render.
  const activeTab: Tab = tab ?? 'interview';
  const transitions = availableTransitions(iv.status, canLead);
  const scheduleEditable =
    canWrite && ['Belum Dijadwalkan', 'Terjadwal', 'Dijadwalkan Ulang'].includes(iv.status);
  const estimasiIssues = estimasiTanpaDasar(draft);
  const scoreReady = preview.ready;

  // RAB-08 — what the Interview door already knows from upstream (riset awal
  // isian + the client's sales record), so Blok B does not re-ask it. Plain call
  // (not a hook): this runs after the early returns above. Cheap — two fields.
  const dedup: DedupResult = computeDedup(baseline);
  // RAB-07 gate, mirrored client-side: the interview cannot START until riset
  // awal is submitted. The per-platform/confirm checks are enforced inside the
  // panel (it will not let the AM submit the timing early), so once the step is
  // Selesai those are already satisfied — gating on the status keeps this simple.
  const risetAwalSelesai = risetAwal?.status === RISET_AWAL_STATUS.Selesai;
  // What the Service hub will actually offer next — "Strategi & Plan" only when
  // the Service is plan-gated; a Direct-path Service (plan_tier `tanpa_plan`)
  // never gets a Strategi, so the label must say "Buat Brief" instead, or the
  // forward link reads like a dead end once the AM lands on the hub.
  const nextServiceStep = serviceQueue ? nextOnboardingStep(serviceQueue) : null;
  const nextStepLabel = nextServiceStep?.label ?? 'Strategi & Plan';

  return (
    <>
      <div className={printMode ? 'printHideOnPrint stack' : 'stack'}>
        <div className="row" style={{ alignItems: 'center' }}>
          <Link href={`/clients/${iv.client_id}`} className="muted">
            &larr; Klien {iv.client_id}
          </Link>
          <span style={{ flex: 1 }} />
          {/* Forward nav: after the interview the next task lives on the Service
              hub — Strategi & Plan for a plan-gated Service, straight to Brief for
              a Direct-path one (§4 Rule 6: Direct never gets a Strategi). The
              label mirrors the hub's own `nextOnboardingStep` so the AM is never
              sent somewhere with nothing to click. Link straight there when the
              interview is tied to a service; otherwise send the AM to the client
              record where the services (and their hubs) are listed. */}
          {iv.service_id ? (
            <Link href={`/account/services/${encodeURIComponent(iv.service_id)}`} className="btn btnSecondary btnSm">
              Lanjut ke {nextStepLabel} (layanan {iv.service_id}) &rarr;
            </Link>
          ) : (
            <Link href={`/clients/${iv.client_id}`} className="btn btnSecondary btnSm">
              Lanjut ke layanan klien &rarr;
            </Link>
          )}
        </div>

        {/* Header + tabs */}
        <div className="card">
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>{iv.id}</h1>
            <span className={`badge badge-${interviewStatusTone(iv.status)}`}>{iv.status}</span>
            <span className="muted">versi {iv.versi_no}</span>
            {iv.retroaktif && <span className="badge badge-gray">Retroaktif</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btnGhost btnSm" onClick={() => setPrintMode('internal')}>
              Cetak (internal)
            </button>
            <button type="button" className="btn btnGhost btnSm" onClick={() => setPrintMode('klien')}>
              Cetak (klien)
            </button>
          </div>
          {/* The three steps of Kelola Klien. Step 3 is not a panel here — its
              form (Strategi & Plan, or Buat Brief for a Direct-path Service)
              lives on the Service hub — so it renders as the same forward link
              the header carries, not a dead chip. */}
          <div className="row" style={{ gap: 6, marginTop: 12 }}>
            <button
              type="button"
              className={`btn btnSm ${activeTab === 'riset' ? 'btnSecondary' : 'btnGhost'}`}
              aria-current={activeTab === 'riset' ? 'page' : undefined}
              onClick={() => setTab('riset')}
            >
              1 · Riset Awal
              {risetAwal && risetAwal.status !== RISET_AWAL_STATUS.Selesai && (
                <span className="badge badge-blue" style={{ marginLeft: 6 }}>
                  berjalan
                </span>
              )}
            </button>
            <button
              type="button"
              className={`btn btnSm ${activeTab === 'interview' ? 'btnSecondary' : 'btnGhost'}`}
              aria-current={activeTab === 'interview' ? 'page' : undefined}
              onClick={() => setTab('interview')}
            >
              2 · Interview / Kualifikasi
            </button>
            {iv.service_id ? (
              <Link
                href={`/account/services/${encodeURIComponent(iv.service_id)}`}
                className="btn btnGhost btnSm"
              >
                3 &middot; {nextStepLabel} &rarr;
              </Link>
            ) : (
              <Link href={`/clients/${iv.client_id}`} className="btn btnGhost btnSm">
                3 · Strategi &amp; Plan &rarr;
              </Link>
            )}
          </div>
        </div>

        <TimelinePanel timeline={timeline} />

        {narrow && activeTab === 'interview' && (
          <div className="alert alertInfo">
            Halaman ini dioptimalkan untuk layar ≥ {MIN_WIDTH}px (desktop). Tata letak dua kolom + sidebar
            skoring mungkin sempit di layar ini.
          </div>
        )}
        {error && <div className="alert alertError">{error}</div>}
        {estimasiIssues.length > 0 && editable && activeTab === 'interview' && (
          <div className="alert alertInfo" style={{ fontSize: 13 }}>
            Estimasi AM belum diberi dasar tertulis (belum tersimpan): {estimasiIssues.join(', ')}.
          </div>
        )}

        {/* STEP 1 — Riset Awal. Single column: it is a measurement card, not a
            form (the isian arrives in part 2), so the scoring sidebar would only
            be noise beside it. */}
        {activeTab === 'riset' && (
          <RisetAwalPanel
            risetAwal={risetAwal}
            baseline={baseline}
            canWrite={canWrite}
            canEditClientProfile={canFixPlatformList}
            busy={acting}
            clientId={iv.client_id}
            onSubmit={submitRiset}
            onReload={reloadBaseline}
          />
        )}

        {activeTab === 'interview' && !risetAwalSelesai && risetAwal && (
          <div className="alert alertInfo" style={{ fontSize: 13 }}>
            Riset Awal (langkah 1) belum disubmit — jadwal & mulai interview terkunci sampai selesai (gerbang
            RAB-07).{' '}
            <button type="button" className="btn btnGhost btnSm" onClick={() => setTab('riset')}>
              Buka Riset Awal
            </button>
          </div>
        )}

        {activeTab === 'interview' && (
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          {/* LEFT: form */}
          <div className="stack" style={{ flex: 1, minWidth: 0 }}>
            {/* RAB-08 — what sales already told us. The interview never re-asks the
                store identity/baseline; it shows it, with a link to correct it at
                the source (the client record) rather than a duplicate input here. */}
            <SalesContextCard client={client} />
            {/* Blok A — schedule */}
            <section className="card">
              <div className="cardHeader">Blok A · Jadwal</div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="jw-tanggal">Tanggal &amp; waktu</label>
                  <input
                    id="jw-tanggal"
                    type="datetime-local"
                    value={jadwal.tanggal_waktu}
                    disabled={!scheduleEditable}
                    onChange={(e) => setJadwal({ ...jadwal, tanggal_waktu: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="jw-durasi">Durasi (menit)</label>
                  <input
                    id="jw-durasi"
                    type="number"
                    min={1}
                    value={jadwal.durasi_menit}
                    disabled={!scheduleEditable}
                    onChange={(e) => setJadwal({ ...jadwal, durasi_menit: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="jw-lokasi">Lokasi / link</label>
                  <input
                    id="jw-lokasi"
                    placeholder="Alamat atau link (mis. gmeet.com/…)"
                    value={jadwal.lokasi_link}
                    disabled={!scheduleEditable}
                    onChange={(e) => setJadwal({ ...jadwal, lokasi_link: e.target.value })}
                  />
                </div>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="jw-catatan">Catatan persiapan</label>
                <textarea
                  id="jw-catatan"
                  rows={2}
                  value={jadwal.catatan_persiapan}
                  disabled={!scheduleEditable}
                  onChange={(e) => setJadwal({ ...jadwal, catatan_persiapan: e.target.value })}
                />
              </div>
              {scheduleEditable && (
                <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* RAB-07 gate: neither scheduling nor starting is allowed until
                      Riset Awal is submitted. The server blocks it regardless
                      (MSG_RISET_AWAL_BELUM_LENGKAP); disabling here points the AM
                      back to langkah 1 instead of letting them hit the wall. */}
                  <button
                    type="button"
                    className="btn btnPrimary btnSm"
                    disabled={acting || jadwal.tanggal_waktu.trim() === '' || !risetAwalSelesai}
                    title={risetAwalSelesai ? undefined : 'Selesaikan & submit Riset Awal (langkah 1) dulu'}
                    onClick={saveSchedule}
                  >
                    Simpan jadwal (→ Terjadwal)
                  </button>
                  {/* Start now, no fixed schedule needed — schedules shift a lot
                      and the interview should not be blocked on locking one. */}
                  <button
                    type="button"
                    className="btn btnSecondary btnSm"
                    disabled={acting || !risetAwalSelesai}
                    title={risetAwalSelesai ? 'Mulai interview sekarang tanpa menunggu jadwal terpaku' : 'Selesaikan & submit Riset Awal (langkah 1) dulu'}
                    onClick={startInterview}
                  >
                    Mulai interview (→ Sedang Berlangsung)
                  </button>
                  {/* Owner confirmation 2026-08-13: the two buttons are EQUAL for
                      the timeline. Saying so here stops an AM from filling a
                      schedule they do not need just to look punctual. */}
                  <span className="muted" style={{ fontSize: 12 }}>
                    Keduanya sama-sama menutup langkah 2 (Interview Meeting) — yang dinilai adalah hasil
                    pengisian jawaban interview, bukan tombol mana yang dipakai.
                  </span>
                </div>
              )}
            </section>

            {/* Blok B — answers */}
            <section className="card">
              <div className="cardHeader" style={{ marginBottom: 4 }}>
                <span>Blok B · Isian</span>
                {editable && (
                  <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                    {saving
                      ? 'Menyimpan…'
                      : dirty
                        ? `Belum tersimpan — otomatis dalam ${AUTOSAVE_MS / 1000} detik`
                        : savedAt
                          ? `Tersimpan ${savedAt}`
                          : 'Tersimpan'}
                  </span>
                )}
              </div>

              {!editable && (
                <div className="alert alertInfo" style={{ fontSize: 13 }}>
                  {isAnswerEditable(iv.status)
                    ? 'Anda tidak punya hak ubah pada interview ini.'
                    : `Status ${iv.status} — isian Blok B hanya bisa diubah saat Sedang Berlangsung, Draft Isian, Butuh Data Klien, atau Dikembalikan.`}
                </div>
              )}

              <div className="stack" style={{ gap: 8 }}>
                {INTERVIEW_SECTIONS.map((s) => {
                  const fields = fieldsOfSection(s.key);
                  const isOpen = open.has(s.key);
                  return (
                    <div key={s.key} style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                      <button
                        type="button"
                        className="btn btnGhost"
                        style={{ width: '100%', justifyContent: 'space-between' }}
                        onClick={() => s.wired && toggleSection(s.key)}
                        disabled={!s.wired}
                        title={s.wired ? undefined : s.catatan}
                      >
                        <span style={{ opacity: s.wired ? 1 : 0.5 }}>
                          {s.key} · {s.label}
                          {fields.length > 0 && (
                            <span className="muted" style={{ fontWeight: 400 }}>
                              {' '}
                              ({fields.length})
                            </span>
                          )}
                          {!s.wired && (
                            <span className="muted" style={{ fontWeight: 400 }}>
                              {' '}
                              — {s.status === 'config_driven' ? 'config-driven' : 'menunggu PRD Interview (RAB-18)'}
                            </span>
                          )}
                        </span>
                        {s.wired && <span className="muted">{isOpen ? '▾' : '▸'}</span>}
                      </button>
                      {s.wired && isOpen && (
                        <div className="grid2" style={{ padding: 14, borderTop: '1px solid var(--color-border)' }}>
                          {fields.map((f) => {
                            // RAB-08: a field Riset Awal already answered is shown
                            // as a locked chip, not a re-entry box.
                            const info = dedup.byField.get(f.fieldKey);
                            return info ? (
                              <DedupField key={f.fieldKey} info={info} onCorrect={() => setTab('riset')} />
                            ) : (
                              <FieldInput
                                key={f.fieldKey}
                                spec={f}
                                value={draft[f.fieldKey]}
                                onChange={(v) => patchField(f.fieldKey, v)}
                                disabled={!editable}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Lifecycle transitions */}
            <section className="card">
              <div className="cardHeader" style={{ marginBottom: 8 }}>
                Alur status
              </div>
              {transitions.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>
                  Tidak ada transisi tersedia dari status ini untuk peran Anda.
                </p>
              ) : (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {transitions.map((t) =>
                    t.requireReason ? (
                      <div key={t.to} className="row" style={{ gap: 6 }}>
                        <input
                          placeholder="Alasan pembatalan (wajib)"
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          style={{ minWidth: 200 }}
                        />
                        <button
                          type="button"
                          className="btn btnDanger btnSm"
                          disabled={acting || cancelReason.trim() === ''}
                          onClick={() => act(() => transitionInterview(id, t.to, cancelReason.trim()))}
                        >
                          {t.to}
                        </button>
                      </div>
                    ) : (
                      <button
                        key={t.to}
                        type="button"
                        className="btn btnSecondary btnSm"
                        disabled={acting || (dirty && editable)}
                        title={dirty && editable ? 'Simpan isian dulu' : undefined}
                        onClick={() => act(() => transitionInterview(id, t.to))}
                      >
                        {t.to}
                      </button>
                    ),
                  )}
                </div>
              )}
            </section>
          </div>

          {/* RIGHT: pinned sidebar */}
          <div className="stack" style={{ width: 320, flexShrink: 0 }}>
            <ScoringSidebar preview={preview} persisted={kualifikasi} />

            {editable && (
              <div className="card">
                <button
                  type="button"
                  className="btn btnPrimary"
                  style={{ width: '100%' }}
                  disabled={acting || !scoreReady}
                  title={scoreReady ? undefined : 'Lengkapi field skor (★) dulu'}
                  onClick={hitungSimpan}
                >
                  Hitung &amp; simpan skor
                </button>
                <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
                  Menyimpan Blok C. Verdict advisory — tidak memblok pembuatan Strategi.
                </p>
              </div>
            )}

            <PrasyaratPanel
              kualifikasi={kualifikasi}
              canWrite={canWrite}
              busy={acting}
              onResolve={() => act(() => resolveInterviewPrasyarat(id))}
            />
          </div>
        </div>
        )}
      </div>

      {/* Print views (hidden on screen; one is rendered while printing) */}
      {printMode === 'internal' && <PrintInternal detail={detail} />}
      {printMode === 'klien' && <PrintKlien detail={detail} />}
    </>
  );
}

// ===========================================================================
// Print views
// ===========================================================================

function PrintInternal({ detail }: { detail: InterviewDetail }) {
  const iv = detail.interview;
  const k = detail.kualifikasi;
  return (
    <div className="printSection">
      <h1>Kualifikasi Interview — {iv.id}</h1>
      <p>
        Klien {iv.client_id} · Status {iv.status} · Versi {iv.versi_no}
      </p>
      {detail.riset_awal && (
        <p>
          Riset awal: {detail.riset_awal.status} · lama pengerjaan{' '}
          {formatDurasiMenit(detail.riset_awal.durasi_menit)}
        </p>
      )}
      {k ? (
        <>
          <h2>Blok C — Kualifikasi (INTERNAL)</h2>
          <p>
            Skor: <strong>{k.skor_kualifikasi}/100</strong> · Verdict:{' '}
            <strong>{VERDICT_LABELS[k.verdict_kualifikasi] ?? k.verdict_kualifikasi}</strong>
          </p>
          <p>
            BEP ROAS: {k.bep_roas ?? '—'} · Rasio target: {k.rasio_target ?? '—'} · Kualitas data:{' '}
            {k.kualitas_data}
          </p>
          {Array.isArray(k.hambatan_mendasar) && (k.hambatan_mendasar as unknown[]).length > 0 && (
            <div>
              <strong>Deal-breaker:</strong>
              <ul>
                {(k.hambatan_mendasar as Array<{ kode: string; nilai: string }>).map((d, i) => (
                  <li key={i}>
                    {HAMBATAN_LABELS[d.kode] ?? d.kode} ({d.nilai})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p>Belum ada kualifikasi.</p>
      )}
      <h2>Blok B — Isian</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Nilai</th>
            <th>Sumber</th>
          </tr>
        </thead>
        <tbody>
          {detail.answers.map((a) => (
            <tr key={`${a.section}-${a.field_key}`}>
              <td>{a.field_key}</td>
              <td>{answerDisplay(a)}</td>
              <td>{a.sumber_angka ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The CLIENT print view — prasyarat ONLY. Blok C (score, verdict, breakdown) is
 * hard-internal (I13) and must never reach the client; this view deliberately
 * carries only the prerequisite text (B7-9) and the schedule.
 */
function PrintKlien({ detail }: { detail: InterviewDetail }) {
  const iv = detail.interview;
  const prasyarat = detail.answers.find((a) => a.field_key === PRASYARAT_FIELD_KEY);
  return (
    <div className="printSection">
      <h1>Prasyarat Kerja Sama — {iv.client_id}</h1>
      {detail.jadwal?.tanggal_waktu && (
        <p>Jadwal: {new Date(detail.jadwal.tanggal_waktu).toLocaleString('id-ID')}</p>
      )}
      <h2>Prasyarat dari klien</h2>
      {prasyarat?.nilai_teks ? (
        <p>{prasyarat.nilai_teks}</p>
      ) : (
        <p>Belum ada prasyarat yang dicatat.</p>
      )}
      <p style={{ marginTop: 24, fontSize: 12, color: '#666' }}>
        Dokumen ini hanya memuat prasyarat kerja sama. Skoring & penilaian internal tidak disertakan.
      </p>
    </div>
  );
}

// ===========================================================================
// helpers
// ===========================================================================

/** ISO timestamp → `datetime-local` input value (local time, minute precision). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function answerDisplay(a: InterviewDetail['answers'][number]): string {
  if (a.nilai_enum) return a.nilai_enum;
  if (a.nilai_uang != null) return formatIDR(Number(a.nilai_uang) / 100);
  if (a.nilai_angka != null) return String(a.nilai_angka);
  if (a.nilai_teks) return a.nilai_teks;
  if (a.nilai_bool != null) return a.nilai_bool ? 'ya' : 'tidak';
  return '—';
}
