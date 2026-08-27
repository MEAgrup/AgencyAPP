/**
 * Riset Awal Baseline — submit/confirm/read the per-platform baseline (RAB-04)
 * and the auto-filled interview fields it proposes (RAB-05).
 *
 * This is the ANALYSIS half of "Riset Awal". The timing half (when the step
 * started / was submitted) lives in `interview.ts` (`submitRisetAwal`). Here the
 * AM records, per active `client_platforms` row, a baseline produced by the
 * `@cdps/core` baseline engine (TikTok Shop) or a minimal manual entry (every
 * other platform) — decision 5, DECISIONS 2026-08-17.
 *
 * House rules honoured:
 *  - **One row per active platform** (RAB-04 DoD): `riset_awal_analisa` is keyed
 *    UNIQUE(interview_id, client_platform_id); a multi-platform client yields one
 *    row per active platform, each anchored to its own store.
 *  - **Immutable history** (#3): `riset_awal_analisa` is append-only (frozen
 *    trigger); the insert itself IS the audit record. Re-analysis = a new row,
 *    which the UNIQUE key blocks until the interview is re-opened — so a second
 *    submit is a `ConflictError`, never a silent overwrite.
 *  - **Derived fields read-only + recomputable** (#4): the score/verdict live in
 *    the engine payload and carry `benchmark_versi` + `parser_versi`. The server
 *    re-stamps `generated_at` with its own clock (never the browser's) and rejects
 *    a payload whose `kondisi_toko` disagrees with `kondisiTokoFromScore`.
 *  - **Vocabulary firewall** (§2.3): `kondisi_toko` (store health) is disjoint
 *    from the Blok C verdict (client fitness) — enforced in RAB-01/RAB-03.
 *  - **null explicit, not omitempty**: every optional column is written as an
 *    explicit `null`.
 */
import { baseline } from '@cdps/core';
import { withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import { canWriteInterview, MSG_FORBIDDEN, MSG_INCOMPLETE, MSG_NOT_FOUND } from './interview';

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5)
// ---------------------------------------------------------------------------
export const MSG_PLATFORM_NOT_FOUND = '[platform toko tidak ditemukan untuk klien ini]';
export const MSG_PLATFORM_INACTIVE = '[platform toko sudah tidak aktif, riset awal hanya untuk platform aktif]';
export const MSG_BASELINE_SUDAH_ADA = '[riset awal untuk platform ini sudah disubmit]';
export const MSG_MANUAL_INCOMPLETE = '[entri manual minimal wajib: GMV/bulan, order, AOV, jumlah SKU, belanja iklan, ROAS]';
export const MSG_ISIAN_NOT_FOUND = '[isian riset awal tidak ditemukan]';
export const MSG_NO_FILES = '[unggah minimal satu berkas export untuk analisa]';
export const MSG_AMBIGU = '[tipe berkas tidak jelas (toko atau afiliasi) — konfirmasi tipe untuk berkas berikut]';

/** The current baseline-engine version, recorded on every scored row (#4). */
export const PARSER_VERSI = 'cdps-baseline-v1';

/** The value type postgres.js `sql.json` accepts (jsonb serializer) — see plan.ts.
 *  Passing a JSON string with `::jsonb` double-encodes it; `tx.json()` is the
 *  serializer that stores a real jsonb object. */
type JsonParam = Parameters<TransactionSql['json']>[0];

// ---------------------------------------------------------------------------
// Platform → method registry (RAB-04). TikTok Shop has the 5-pillar engine;
// Tokopedia has a thin (4-metric) read; everything else is a minimal manual
// entry. Only `analisa_penuh` may carry a score (CHECK ck_analisa_skor_penuh).
// ---------------------------------------------------------------------------
export type MetodeBaseline = 'analisa_penuh' | 'analisa_tipis' | 'manual';

export function metodeForPlatform(platform: string): MetodeBaseline {
  const p = platform.trim().toLowerCase();
  if (p === 'tiktok shop') return 'analisa_penuh';
  if (p === 'tokopedia') return 'analisa_tipis';
  return 'manual';
}

// ---------------------------------------------------------------------------
// RAB-05 — auto-filled interview fields
// ---------------------------------------------------------------------------
/**
 * One proposed interview field, derived from the baseline (or, for B6-3, from the
 * client's sales record). `nilaiUsulan` is the frozen original proposal (keputusan
 * 1: a parser bug cannot shift a verdict until a human confirms); the AM may
 * correct `nilai*` before confirming.
 *
 * ⚠️ Only the fields that map to a real INTERVIEW question are emitted here, each
 * with its unit resolved so the Blok C ratio stays dimensionless:
 *  - `toko.aov`             → **B2-9** (money, minor units)
 *  - `produk.sku_total`     → **B2-3** (count)
 *  - `gmv_baseline.runrate_3m` → **B1-5** "Omzet 3 bulan terakhir" (money): the
 *    baseline figures are MONTHLY (Rp/bulan, resolusi §5.2), and B1-5 is a 3-month
 *    TOTAL, so it is `runrate_3m × 3` — the exact recipe §5.2 pre-authorised for
 *    "kalau kelak di-prefill". `median_6m` is NEVER used for B1-5 (it is a 6-month
 *    median, the Strategi baseline anchor, RAB-11).
 *  - `clients.target_gmv`   → **B6-3** "Target omzet 3 bulan" (money, sumber=sales):
 *    Target GMV is MONTHLY (PRD M0 §107 / M4 §65,§171 "IDR/month"), so B6-3 is
 *    `target_gmv × 3`. Emitted by `deriveIsianFromClient` in `submitBaseline`.
 * `roas` (baseline ROAS) stays in the payload for the Strategi baseline (RAB-11).
 * `B3-3` (ruang harga) and `B7-3` (kesiapan akses) are human judgement and stay
 * interview questions.
 *
 * Both B1-5 and B6-3 carry the SAME ×3 so the C-E1 ratio (target ÷ omzet) is
 * unchanged in scale — putting a monthly figure on either side alone would inflate
 * or deflate the ratio ~3× and could trip a false `rasio_target_terlalu_tinggi`
 * deal-breaker (the exact risk §5.2 flagged). QA pemilik 2026-08-20.
 */
export interface IsianUsulan {
  section: string;
  fieldKey: string;
  sumber: 'analisa' | 'manual' | 'sales';
  nilaiTeks: string | null;
  nilaiAngka: number | null;
  nilaiUang: bigint | null;
  nilaiUsulan: unknown;
}

/** Rupiah (major) → minor units (×100), the money.ts convention. */
function rupiahToMinor(rupiah: number): bigint {
  return BigInt(Math.round(rupiah)) * 100n;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Derive the interview-field proposals from an `analisa_penuh` engine payload.
 * Missing metrics (a column the export did not carry) are simply not proposed —
 * absent ≠ zero (baseline fix #2).
 */
export function deriveIsianFromPayload(payload: BaselinePayloadLike): IsianUsulan[] {
  const out: IsianUsulan[] = [];
  const aov = payload.toko?.aov;
  if (isFiniteNumber(aov)) {
    const minor = rupiahToMinor(aov);
    out.push({
      section: 'B2', fieldKey: 'B2-9', sumber: 'analisa',
      nilaiTeks: null, nilaiAngka: null, nilaiUang: minor,
      nilaiUsulan: { nilai_uang: minor.toString(), aov_rupiah: Math.round(aov) },
    });
  }
  const sku = payload.produk?.sku_total;
  if (isFiniteNumber(sku)) {
    out.push({
      section: 'B2', fieldKey: 'B2-3', sumber: 'analisa',
      nilaiTeks: null, nilaiAngka: sku, nilaiUang: null,
      nilaiUsulan: { nilai_angka: sku },
    });
  }
  // B1-5 "Omzet 3 bulan terakhir" = the 3-month TOTAL. runrate_3m is the MONTHLY
  // average of the last 3 filled months (Rp/bulan, resolusi §5.2), so the total is
  // runrate_3m × 3. Absent/zero history ⇒ not proposed (absent ≠ zero, fix #2).
  const rr3 = payload.gmv_baseline?.runrate_3m;
  if (isFiniteNumber(rr3) && rr3 > 0) {
    const total3m = rr3 * 3;
    const minor = rupiahToMinor(total3m);
    out.push({
      section: 'B1', fieldKey: 'B1-5', sumber: 'analisa',
      nilaiTeks: null, nilaiAngka: null, nilaiUang: minor,
      nilaiUsulan: { nilai_uang: minor.toString(), runrate_3m_rupiah: Math.round(rr3), rumus: 'omzet_3bln = runrate_3m × 3' },
    });
  }
  return out;
}

/**
 * Derive B6-3 "Target omzet 3 bulan" from the client's Target GMV (sumber=sales).
 * Target GMV is captured MONTHLY at intake (PRD "IDR/month"), so the 3-month target
 * is `targetGmvBulan × 3` — the same ×3 B1-5 carries, keeping the C-E1 ratio scale-
 * free. Returns [] when there is no positive target (AM then types B6-3 by hand).
 */
export function deriveIsianFromClient(targetGmvBulan: number | null): IsianUsulan[] {
  if (!isFiniteNumber(targetGmvBulan) || targetGmvBulan <= 0) return [];
  const minor = rupiahToMinor(targetGmvBulan * 3);
  return [{
    section: 'B6', fieldKey: 'B6-3', sumber: 'sales',
    nilaiTeks: null, nilaiAngka: null, nilaiUang: minor,
    nilaiUsulan: { nilai_uang: minor.toString(), target_gmv_bulan_rupiah: Math.round(targetGmvBulan), rumus: 'target_3bln = target_gmv × 3' },
  }];
}

/** Derive the interview-field proposals from a minimal manual entry. */
export function deriveIsianFromManual(m: ManualBaselineInput): IsianUsulan[] {
  const out: IsianUsulan[] = [];
  if (isFiniteNumber(m.aov)) {
    const minor = rupiahToMinor(m.aov);
    out.push({
      section: 'B2', fieldKey: 'B2-9', sumber: 'manual',
      nilaiTeks: null, nilaiAngka: null, nilaiUang: minor,
      nilaiUsulan: { nilai_uang: minor.toString(), aov_rupiah: Math.round(m.aov) },
    });
  }
  if (isFiniteNumber(m.skuTotal)) {
    out.push({
      section: 'B2', fieldKey: 'B2-3', sumber: 'manual',
      nilaiTeks: null, nilaiAngka: m.skuTotal, nilaiUang: null,
      nilaiUsulan: { nilai_angka: m.skuTotal },
    });
  }
  // B1-5 "Omzet 3 bulan terakhir" (3-month TOTAL). The manual entry captures GMV
  // PER BULAN (`gmvBulan`), so the total is gmvBulan × 3 — the same conversion the
  // analisa path applies to runrate_3m. Absent/zero ⇒ not proposed.
  if (isFiniteNumber(m.gmvBulan) && m.gmvBulan > 0) {
    const minor = rupiahToMinor(m.gmvBulan * 3);
    out.push({
      section: 'B1', fieldKey: 'B1-5', sumber: 'manual',
      nilaiTeks: null, nilaiAngka: null, nilaiUang: minor,
      nilaiUsulan: { nilai_uang: minor.toString(), gmv_bulan_rupiah: Math.round(m.gmvBulan), rumus: 'omzet_3bln = gmv_bulan × 3' },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Input / read-model shapes
// ---------------------------------------------------------------------------
export interface ManualBaselineInput {
  gmvBulan: number | null; // rupiah / bulan
  order: number | null;
  aov: number | null; // rupiah
  skuTotal: number | null;
  belanjaIklan: number | null; // rupiah
  roas: number | null;
  periodeMulai?: string | null;
  periodeAkhir?: string | null;
  tanggalAmbil?: string | null;
}

export interface SumberBerkasInput {
  namaBerkas: string;
  sha256: string;
  ukuranBytes: number;
  tipeTerdeteksi?: string | null;
  tipeOverride?: string | null;
  jumlahBaris?: number | null;
  periode?: { mulai?: string | null; akhir?: string | null } | null;
  tanggalAmbil?: string | null;
}

/** Only the payload fields the server reads back out of the engine result — the
 *  engine (`@cdps/core`) owns the full shape. */
export interface BaselinePayloadLike {
  schema?: unknown;
  generated_at?: unknown;
  klien?: { periode_referensi?: string | null } | null;
  gmv_baseline?: { cakupan_riwayat?: string | null; runrate_3m?: number | null } | null;
  toko?: { aov?: number | null } | null;
  produk?: { sku_total?: number | null } | null;
  benchmark_versi?: number | null;
  kelengkapan_file?: Record<string, boolean> | null;
  skor?: { total?: number | null; kondisi_toko?: string | null } | null;
}

/**
 * One export file, parsed to array-of-arrays IN THE BROWSER (the only step that
 * needs the xlsx binary parser). The scoring engine runs SERVER-SIDE — web-internal
 * is a standalone Next app with no `@cdps/core`, and keeping a second copy of the
 * score rules in the browser is exactly the drift keputusan 4 forbids. So the
 * browser ships rows + sha256; the server detects, runs `runBaseline`, and owns
 * the score, its `benchmark_versi`/`parser_versi`, and `generated_at`.
 */
export interface SheetFileInput {
  filename: string;
  /** `XLSX.utils.sheet_to_json(ws, { header: 1 })` output. */
  aoa: unknown[][];
  sha256: string;
  ukuranBytes: number;
  /** AM's explicit file type when detection is ambiguous (toko vs afiliasi). */
  tipeOverride?: string | null;
  tanggalAmbil?: string | null;
}

export interface AnalisaPenuhInput {
  files: SheetFileInput[];
  /** The AM-entered 6-month GMV history (the flags campaign/belum/masalah are theirs). */
  hist?: baseline.HistRow[];
  /** 'net' GMV (MEA standard) vs 'gross'. */
  net?: boolean;
  /** CDPS linked TikTok account handles — disambiguates own vs affiliate (fix #3). */
  linkedAccounts?: string[];
}

export interface SubmitBaselineInput {
  clientPlatformId: number;
  /** analisa_penuh (TikTok Shop): parsed export sheets — the engine runs on the server. */
  analisa?: AnalisaPenuhInput;
  /** manual / analisa_tipis: minimal entry (keputusan 5). */
  manual?: ManualBaselineInput;
  /** Provenance for a manual entry (an export that backs the typed numbers). */
  sumberBerkas?: SumberBerkasInput[];
  /** AM's deliberate opt-out of the engine on an analisa_penuh platform (owner QA
   *  2026-08-27: "jalur pintas tanpa upload/skor") — submits `manual` instead of
   *  `analisa` even though the platform has an engine. Ignored for a platform that
   *  is already manual/analisa_tipis (nothing to opt out of). Ties `metode_baseline`
   *  to 'manual' for this row: `kondisi_toko` becomes `belum_dapat_diukur`, no skor
   *  — same DB contract as any other manual row (ck_analisa_skor_penuh), just
   *  chosen instead of derived from the platform name. */
  manualOverride?: boolean;
}

export interface AnalisaRow {
  id: number;
  clientPlatformId: number;
  platform: string;
  metodeBaseline: MetodeBaseline;
  kondisiToko: string;
  skor: number | null;
  benchmarkVersi: number | null;
  parserVersi: string | null;
  cakupanRiwayat: string | null;
  createdAt: string;
}

export interface IsianRow {
  section: string;
  fieldKey: string;
  sumber: string;
  nilaiTeks: string | null;
  nilaiAngka: number | null;
  nilaiUang: string | null;
  nilaiUsulan: unknown;
  dikonfirmasi: boolean;
}

/**
 * One active `client_platforms` row the AM must produce a baseline for (RAB-04:
 * "sub-bagian diturunkan dari client_platforms aktif"). Emitted for EVERY active
 * platform — even before it has a `riset_awal_analisa` row — so the panel can
 * render one sub-section per platform and know which method (engine vs manual)
 * each one takes, without a second round-trip or a platform-picker. `metode` is
 * derived server-side from the platform name (single source: `metodeForPlatform`).
 */
export interface PlatformSlot {
  clientPlatformId: number;
  platform: string;
  metode: MetodeBaseline;
  storeLink: string | null;
}

export interface BaselineView {
  interviewId: string;
  /** Every active store of the client — the sub-sections the panel renders. */
  platforms: PlatformSlot[];
  analisa: AnalisaRow[];
  isian: IsianRow[];
  /** Every scored field confirmed? (submit gate, keputusan 1.) */
  semuaTerkonfirmasi: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Server clock (WIB display is governed by the `tz` module; storage is ISO/UTC).
 *  Never the browser clock — the payload's `generated_at` is re-stamped here. */
function serverGeneratedAt(): string {
  return new Date().toISOString();
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadInterviewScope(
  sql: Queryable,
  id: string,
): Promise<{ ownerAm: string | null; clientId: string; targetGmv: number | null }> {
  // target_gmv (numeric IDR/month) rides along so submitBaseline can propose B6-3
  // from the client's captured Target GMV without a second round-trip.
  const rows = await sql<{ assigned_am_id: string | null; client_id: string; target_gmv: string | number | null }[]>`
    select c.assigned_am_id, i.client_id, c.target_gmv
      from interview i
      join clients c on c.id = i.client_id
     where i.id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_NOT_FOUND);
  return { ownerAm: rows[0].assigned_am_id, clientId: rows[0].client_id, targetGmv: numOrNull(rows[0].target_gmv) };
}

// ---------------------------------------------------------------------------
// submitBaseline — record one platform's baseline (RAB-04) + auto-fill (RAB-05)
// ---------------------------------------------------------------------------
export async function submitBaseline(sql: Sql, actor: Actor, id: string, input: SubmitBaselineInput): Promise<BaselineView> {
  return withTransaction(sql, async (tx) => {
    const { ownerAm, clientId, targetGmv } = await loadInterviewScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
    if (!input.clientPlatformId) throw new ValidationError(MSG_INCOMPLETE);

    // The platform must be an ACTIVE store of THIS client (RAB-04: sub-sections
    // are derived from client_platforms, so a stale/foreign id is rejected).
    const plat = await tx<{ platform: string; active: boolean; client_id: string }[]>`
      select platform, active, client_id from client_platforms
       where id = ${input.clientPlatformId} for update`;
    if (plat.length === 0 || plat[0].client_id !== clientId) throw new NotFoundError(MSG_PLATFORM_NOT_FOUND);
    if (!plat[0].active) throw new ValidationError(MSG_PLATFORM_INACTIVE);
    const platform = plat[0].platform;
    const naturalMetode = metodeForPlatform(platform);
    // manualOverride only ever demotes analisa_penuh → manual (an AM opting out
    // of the engine); it can never promote a platform that has no engine.
    const metode: MetodeBaseline = naturalMetode === 'analisa_penuh' && input.manualOverride === true ? 'manual' : naturalMetode;

    // One row per (interview × platform); re-analysis needs a re-open, so a
    // second submit is a conflict, never a silent overwrite (frozen trigger).
    const existing = await tx<{ id: number }[]>`
      select id from riset_awal_analisa
       where interview_id = ${id} and client_platform_id = ${input.clientPlatformId}`;
    if (existing.length > 0) throw new ConflictError(MSG_BASELINE_SUDAH_ADA);

    const generatedAt = serverGeneratedAt();
    let payload: Record<string, unknown>;
    let kondisiToko: string;
    let skor: number | null;
    let benchmarkVersi: number | null;
    let parserVersi: string | null;
    let cakupan: string | null;
    let kelengkapan: unknown;
    let periodeReferensi: unknown;
    let isian: IsianUsulan[];
    let berkasRows: SumberBerkasInput[];

    if (metode === 'analisa_penuh') {
      const a = input.analisa;
      if (!a || !a.files || a.files.length === 0) throw new ValidationError(MSG_NO_FILES);

      // Detect each parsed sheet SERVER-SIDE (readSheet/detect/runBaseline live in
      // @cdps/core, never in the browser). An ambiguous own-vs-affiliate file needs
      // the AM's explicit type (tipeOverride) — the engine never guesses silently.
      const slots: baseline.RunSlots = {};
      const ambigu: string[] = [];
      const berkasMeta: { file: SheetFileInput; type: string | null; rows: number; periode: string }[] = [];
      for (const f of a.files) {
        const sheet = baseline.readSheet(f.aoa as baseline.Aoa, f.filename);
        if (!sheet) {
          berkasMeta.push({ file: f, type: null, rows: 0, periode: '' });
          continue;
        }
        sheet.periode = baseline.periodeOf(sheet.meta);
        let type: string | null;
        if (f.tipeOverride) {
          type = f.tipeOverride;
        } else {
          const d = baseline.detect(sheet, { linkedAccounts: a.linkedAccounts });
          if (d.type && d.ambiguous) ambigu.push(f.filename);
          type = d.type;
        }
        if (type) {
          sheet.type = type as baseline.FileType;
          slots[type as baseline.FileType] = sheet;
        }
        berkasMeta.push({ file: f, type, rows: sheet.rows.length, periode: sheet.periode ?? '' });
      }
      if (ambigu.length > 0) throw new ValidationError(`${MSG_AMBIGU} ${ambigu.join(', ')}`);

      // Client identity for the payload is server-owned (from CDPS), never supplied
      // by the browser — handoff §2.2 #5.
      const cli = await tx<{ nama_pic: string | null; toko: string | null; kategori: string | null; assigned_am_id: string | null }[]>`
        select nama_pic, toko, kategori, assigned_am_id from clients where id = ${clientId}`;
      const c = cli[0] ?? { nama_pic: null, toko: null, kategori: null, assigned_am_id: null };

      const result = baseline.runBaseline(slots, a.hist ?? [], {
        bench: baseline.BENCH_V1,
        benchmarkVersi: 1,
        net: a.net ?? true,
        klien: {
          nama: c.nama_pic, toko: c.toko, akun_tiktok: null, kategori: c.kategori,
          umur_toko_bulan: null, account_manager: c.assigned_am_id,
        },
        generatedAt, // server clock, never the browser's
      });
      const rp = result.payload;
      payload = rp as unknown as Record<string, unknown>;
      skor = rp.skor.total;
      kondisiToko = rp.skor.kondisi_toko;
      benchmarkVersi = 1;
      parserVersi = PARSER_VERSI;
      cakupan = rp.gmv_baseline.cakupan_riwayat ?? null;
      kelengkapan = rp.kelengkapan_file ?? null;
      periodeReferensi = rp.klien.periode_referensi ? { bulan: rp.klien.periode_referensi } : null;
      isian = deriveIsianFromPayload(rp as unknown as BaselinePayloadLike);
      // Provenance rows come from the uploaded files themselves (sha256 + detected type).
      berkasRows = berkasMeta.map(({ file, type, rows, periode }) => ({
        namaBerkas: file.filename,
        sha256: file.sha256,
        ukuranBytes: file.ukuranBytes,
        tipeTerdeteksi: type,
        tipeOverride: file.tipeOverride ?? null,
        jumlahBaris: rows,
        periode: periode ? { mulai: periode, akhir: periode } : null,
        tanggalAmbil: file.tanggalAmbil ?? null,
      }));
    } else {
      // analisa_tipis (Tokopedia) + manual (everyone else): no engine, so the store
      // is belum_dapat_diukur with no score (CHECK ck_analisa_manual_null / _skor).
      const m = input.manual;
      if (!m || !isFiniteNumber(m.gmvBulan) || !isFiniteNumber(m.order) || !isFiniteNumber(m.aov)
        || !isFiniteNumber(m.skuTotal) || !isFiniteNumber(m.belanjaIklan) || !isFiniteNumber(m.roas)) {
        throw new ValidationError(MSG_MANUAL_INCOMPLETE);
      }
      skor = null;
      kondisiToko = 'belum_dapat_diukur';
      benchmarkVersi = null;
      parserVersi = null;
      cakupan = null;
      kelengkapan = null;
      periodeReferensi = m.periodeMulai || m.periodeAkhir ? { mulai: m.periodeMulai ?? null, akhir: m.periodeAkhir ?? null } : null;
      payload = {
        schema: 'cdps.baseline.manual.v1',
        generated_at: generatedAt,
        metode,
        manual: {
          gmv_bulan: m.gmvBulan, order: m.order, aov: m.aov,
          sku_total: m.skuTotal, belanja_iklan: m.belanjaIklan, roas: m.roas,
        },
      };
      isian = deriveIsianFromManual(m);
      // A manual entry may still attach an export as provenance (Rule 5).
      berkasRows = input.sumberBerkas ?? [];
    }

    // B6-3 "Target omzet 3 bulan" is CLIENT data (sumber=sales), not per-platform,
    // so it is proposed once from the captured Target GMV regardless of method. The
    // per-key UNIQUE + `on conflict do nothing` below means the first platform
    // submit writes it and later submits leave it be — same as B2-9/B2-3.
    isian = [...isian, ...deriveIsianFromClient(targetGmv)];

    // House invariant (DECISIONS 2026-08-20 — "buang raw, simpan hasil"): the raw
    // upload rows (`analisa.files[].aoa`) are TRANSIENT — read once to run the
    // engine above, then dropped. We persist ONLY the derived engine `payload`
    // plus per-file provenance metadata (name/sha256/size/rows, never the bytes),
    // so no analysis upload ever accumulates storage. Applies to every
    // analysis-upload flow (this + Laporan Klien C1).
    const inserted = await tx<{ id: number }[]>`
      insert into riset_awal_analisa
        (interview_id, client_platform_id, platform, metode_baseline, periode_referensi,
         payload, kondisi_toko, skor, benchmark_versi, parser_versi, cakupan_riwayat,
         kelengkapan_file, created_by)
      values
        (${id}, ${input.clientPlatformId}, ${platform}, ${metode},
         ${periodeReferensi == null ? null : tx.json(periodeReferensi as JsonParam)},
         ${tx.json(payload as JsonParam)}, ${kondisiToko},
         ${skor}, ${benchmarkVersi}, ${parserVersi}, ${cakupan},
         ${kelengkapan == null ? null : tx.json(kelengkapan as JsonParam)}, ${actor.employeeId})
      returning id`;

    for (const b of berkasRows) {
      await tx`
        insert into riset_awal_sumber_berkas
          (interview_id, platform, nama_berkas, sha256, ukuran_bytes, tipe_terdeteksi,
           tipe_override, jumlah_baris, periode, tanggal_ambil, created_by)
        values
          (${id}, ${platform}, ${b.namaBerkas}, ${b.sha256}, ${b.ukuranBytes},
           ${b.tipeTerdeteksi ?? null}, ${b.tipeOverride ?? null}, ${b.jumlahBaris ?? null},
           ${b.periode == null ? null : tx.json(b.periode as JsonParam)}, ${b.tanggalAmbil ?? null}, ${actor.employeeId})`;
    }

    // Auto-fill (RAB-05). Proposals arrive unconfirmed; the AM confirms per number
    // (keputusan 1). A field already carried by the interview keeps its existing
    // proposal (frozen nilai_usulan) — do nothing on conflict.
    for (const f of isian) {
      await tx`
        insert into interview_riset_awal_isian
          (interview_id, section, field_key, nilai_teks, nilai_angka, nilai_uang,
           sumber, nilai_usulan, dikonfirmasi, updated_by)
        values
          (${id}, ${f.section}, ${f.fieldKey}, ${f.nilaiTeks}, ${f.nilaiAngka},
           ${f.nilaiUang == null ? null : f.nilaiUang.toString()}, ${f.sumber}, ${tx.json(f.nilaiUsulan as JsonParam)}, false, ${actor.employeeId})
        on conflict (interview_id, section, field_key) do nothing`;
    }

    void inserted;
    return readBaseline(tx, id);
  });
}

// ---------------------------------------------------------------------------
// confirmIsian — AM corrects + confirms a proposed number (keputusan 1)
// ---------------------------------------------------------------------------
export interface ConfirmIsianItem {
  section: string;
  fieldKey: string;
  nilaiTeks?: string | null;
  nilaiAngka?: number | null;
  nilaiUang?: string | number | bigint | null;
  dikonfirmasi: boolean;
}

export async function confirmIsian(sql: Sql, actor: Actor, id: string, items: ConfirmIsianItem[]): Promise<BaselineView> {
  return withTransaction(sql, async (tx) => {
    const { ownerAm } = await loadInterviewScope(tx, id);
    if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
    for (const it of items) {
      const uang = it.nilaiUang === null || it.nilaiUang === undefined ? null : BigInt(it.nilaiUang).toString();
      const res = await tx<{ interview_id: string }[]>`
        update interview_riset_awal_isian set
          nilai_teks  = ${it.nilaiTeks ?? null},
          nilai_angka = ${it.nilaiAngka ?? null},
          nilai_uang  = ${uang},
          dikonfirmasi = ${it.dikonfirmasi},
          updated_by  = ${actor.employeeId}
        where interview_id = ${id} and section = ${it.section} and field_key = ${it.fieldKey}
        returning interview_id`;
      if (res.length === 0) throw new NotFoundError(MSG_ISIAN_NOT_FOUND);
    }
    return readBaseline(tx, id);
  });
}

// ---------------------------------------------------------------------------
// getBaseline / readBaseline — the per-interview baseline read-model
// ---------------------------------------------------------------------------
export async function getBaseline(sql: Queryable, actor: Actor, id: string): Promise<BaselineView> {
  const { ownerAm } = await loadInterviewScope(sql, id);
  if (!canWriteInterview(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
  return readBaseline(sql, id);
}

async function readBaseline(sql: Queryable, id: string): Promise<BaselineView> {
  // The sub-sections the panel renders come from the client's ACTIVE platforms,
  // not from what has already been submitted — an unsubmitted platform still needs
  // a slot (RAB-04). Joined through the interview so the read stays keyed by id.
  const platRows = await sql<Record<string, unknown>[]>`
    select cp.id, cp.platform, cp.store_link
      from client_platforms cp
      join interview i on i.client_id = cp.client_id
     where i.id = ${id} and cp.active = true
     order by cp.id`;
  const platforms: PlatformSlot[] = platRows.map((r) => ({
    clientPlatformId: Number(r.id),
    platform: r.platform as string,
    metode: metodeForPlatform(r.platform as string),
    storeLink: (r.store_link as string | null) ?? null,
  }));

  const analisa = await sql<Record<string, unknown>[]>`
    select id, client_platform_id, platform, metode_baseline, kondisi_toko, skor,
           benchmark_versi, parser_versi, cakupan_riwayat, created_at
      from riset_awal_analisa where interview_id = ${id} order by id`;
  const isianRows = await sql<Record<string, unknown>[]>`
    select section, field_key, sumber, nilai_teks, nilai_angka, nilai_uang,
           nilai_usulan, dikonfirmasi
      from interview_riset_awal_isian where interview_id = ${id}
      order by section, field_key`;

  const isian: IsianRow[] = isianRows.map((r) => ({
    section: r.section as string,
    fieldKey: r.field_key as string,
    sumber: r.sumber as string,
    nilaiTeks: (r.nilai_teks as string | null) ?? null,
    nilaiAngka: numOrNull(r.nilai_angka),
    nilaiUang: r.nilai_uang == null ? null : String(r.nilai_uang),
    nilaiUsulan: r.nilai_usulan ?? null,
    dikonfirmasi: Boolean(r.dikonfirmasi),
  }));

  return {
    interviewId: id,
    platforms,
    analisa: analisa.map((r) => ({
      id: Number(r.id),
      clientPlatformId: Number(r.client_platform_id),
      platform: r.platform as string,
      metodeBaseline: r.metode_baseline as MetodeBaseline,
      kondisiToko: r.kondisi_toko as string,
      skor: numOrNull(r.skor),
      benchmarkVersi: numOrNull(r.benchmark_versi),
      parserVersi: (r.parser_versi as string | null) ?? null,
      cakupanRiwayat: (r.cakupan_riwayat as string | null) ?? null,
      createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
    })),
    isian,
    // Submit gate (keputusan 1): every auto-filled field must be confirmed.
    semuaTerkonfirmasi: isian.length > 0 && isian.every((f) => f.dikonfirmasi),
  };
}
