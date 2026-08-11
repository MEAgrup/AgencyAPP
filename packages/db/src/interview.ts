/**
 * Interview module — the `packages/db` persistence executors (Modul Interview,
 * tab 1 of "Kelola Klien"). These are the thin, transaction-bound SQL wrappers
 * the domain/route layer calls to persist an Interview; they carry no permission
 * logic (RLS + the route shell own that) and no validation prose (BI messages
 * live in the domain layer). What they DO own is the one invariant the module
 * cannot express any other way: **the qualification score is written only by the
 * scoring path**, and that path is the single pure `hitungKualifikasi` in
 * `@cdps/core` — never a second re-implementation.
 *
 * Why here and not in a hand-rolled domain query: `@cdps/db` is exactly the layer
 * that wraps the migration's tables/functions in typed calls (see `executors.ts`
 * for ident_next / sm_transition / notify_emit / audit). The Interview writes are
 * the same shape — an `ident_next` mint in the entity's own transaction, an
 * upsert per answer, one 1:1 scoring row derived from the core engine — so they
 * belong beside the other executors, bound to a `Queryable` (a tx handle in the
 * normal case) so a rolled-back interview insert consumes no sequence number.
 *
 * ## Invariants enforced by the DB that these wrappers must respect
 *
 *  - **Deal-breaker precedence (I14).** `hitungKualifikasi` already returns
 *    `tidak_siap` whenever a deal-breaker fired, so `persistKualifikasi` never
 *    tries to write a hambatan + non-`tidak_siap` row; the DB CHECK
 *    (`ck_kualifikasi_dealbreaker`) is the backstop, and the integration test
 *    proves a raw insert that violates it is rejected. There is no override.
 *  - **Snapshotted config (I15).** The scorer runs on the config loaded from
 *    `kualifikasi_config` (or an explicit version), and the exact object used is
 *    stored back in `config_snapshot` so a later recalibration cannot rewrite a
 *    past verdict. `config_snapshot` is stored in the same plain-number jsonb
 *    shape as the config table (AOV bands as integers, not the `bigint` the core
 *    type carries) — `configToJsonb` / `configFromRow` are the boundary.
 *  - **Reproducible derived margin (I21).** When the basis is
 *    `diturunkan_dari_kotor`, the scorer produces `marginDerivasiInput`; the DB
 *    CHECK requires it (and `margin_kotor`) to be present.
 *  - **Append-only sanggahan.** `appendSanggahan` grows `catatan_sanggahan` and
 *    never touches skor/verdict — the DB trigger blocks a shrink, a rewrite of an
 *    earlier element, or a verdict change smuggled in with a new note. The only
 *    way to change a verdict is to correct the input and recompute.
 */

import { ident, interview as iv, type money } from '@cdps/core';
import type { Queryable } from './client';
import { identExecutor } from './executors';

// ===========================================================================
// interview — entity create (ITV mint) + re-interview version bump
// ===========================================================================

/** Arguments to mint a fresh Interview (versi 1) or a re-interview (versi n+1). */
export interface CreateInterviewArgs {
  clientId: string;
  contractId?: string | null;
  serviceId?: string | null;
  amPengisiId: string;
  actingForAmId?: string | null;
  salesClosingId?: string | null;
  interviewProfile?: string; // default 'full_management' (DB default)
  retroaktif?: boolean;
  createdBy: string;
  /** Instant the ID is minted at — WIB-bucketed by `ident_next`. */
  at: Date;
  /**
   * Present only for a re-interview (I9). `versiNo` > 1 requires BOTH `indukId`
   * and `sebelumnyaId` (mirrors `ck_interview_lineage`); omit the whole object
   * for a first interview.
   */
  lineage?: {
    versiNo: number;
    indukId: string;
    sebelumnyaId: string;
  };
}

/**
 * createInterview mints an `ITV` id in the caller's transaction and inserts the
 * `interview` row. Status is left at the machine's initial state
 * (`Belum Dijadwalkan`) — a status column is only ever moved by `sm_transition`,
 * never by this insert. Returns the minted id.
 */
export async function createInterview(sql: Queryable, args: CreateInterviewArgs): Promise<string> {
  const id = await ident.nextId(identExecutor(sql), 'ITV', args.at);
  const versiNo = args.lineage?.versiNo ?? 1;
  await sql`
    insert into interview
      (id, client_id, contract_id, service_id, am_pengisi_id, acting_for_am_id, sales_closing_id,
       versi_no, interview_induk_id, versi_sebelumnya_id, interview_profile, retroaktif, created_by)
    values
      (${id}, ${args.clientId}, ${args.contractId ?? null}, ${args.serviceId ?? null},
       ${args.amPengisiId}, ${args.actingForAmId ?? null}, ${args.salesClosingId ?? null},
       ${versiNo}, ${args.lineage?.indukId ?? null}, ${args.lineage?.sebelumnyaId ?? null},
       ${args.interviewProfile ?? 'full_management'}, ${args.retroaktif ?? false}, ${args.createdBy})`;
  return id;
}

// ===========================================================================
// interview_answer — one row per (interview, section, field), upserted
// ===========================================================================

/** A single Blok B answer. Exactly the typed columns of `interview_answer`. */
export interface AnswerUpsert {
  interviewId: string;
  section: string; // B0..B11
  fieldKey: string; // e.g. B2-7
  nilaiTeks?: string | null;
  nilaiAngka?: number | null;
  nilaiUang?: money.Money | null; // minor units (bigint)
  nilaiBool?: boolean | null;
  nilaiEnum?: string | null; // canonical code (core enums)
  nilaiJsonb?: unknown | null; // struct answers
  sumberAngka?: string | null; // klien_hitung | dari_margin_kotor | estimasi_am
  dasarEstimasi?: string | null; // required by DB CHECK when sumberAngka = estimasi_am
  wajibKosong?: boolean;
  updatedBy: string;
}

/**
 * upsertAnswer writes one answer row, replacing any prior value for the same
 * (interview, section, field). The scored-field-not-blank and estimasi-basis
 * CHECKs live in the migration and mirror `SCORED_FIELD_KEYS` in `@cdps/core`:
 * this wrapper does not re-validate them — it lets the DB reject a blank scored
 * field or a baseless estimate, which the integration test relies on.
 */
export async function upsertAnswer(sql: Queryable, a: AnswerUpsert): Promise<void> {
  await sql`
    insert into interview_answer
      (interview_id, section, field_key, nilai_teks, nilai_angka, nilai_uang, nilai_bool,
       nilai_enum, nilai_jsonb, sumber_angka, dasar_estimasi, wajib_kosong, updated_by, updated_at)
    values
      (${a.interviewId}, ${a.section}, ${a.fieldKey}, ${a.nilaiTeks ?? null}, ${a.nilaiAngka ?? null},
       ${a.nilaiUang != null ? a.nilaiUang.toString() : null}, ${a.nilaiBool ?? null}, ${a.nilaiEnum ?? null},
       ${(a.nilaiJsonb ?? null) as never}, ${a.sumberAngka ?? null}, ${a.dasarEstimasi ?? null},
       ${a.wajibKosong ?? false}, ${a.updatedBy}, now())
    on conflict (interview_id, section, field_key) do update set
      nilai_teks = excluded.nilai_teks,
      nilai_angka = excluded.nilai_angka,
      nilai_uang = excluded.nilai_uang,
      nilai_bool = excluded.nilai_bool,
      nilai_enum = excluded.nilai_enum,
      nilai_jsonb = excluded.nilai_jsonb,
      sumber_angka = excluded.sumber_angka,
      dasar_estimasi = excluded.dasar_estimasi,
      wajib_kosong = excluded.wajib_kosong,
      updated_by = excluded.updated_by,
      updated_at = now()`;
}

// ===========================================================================
// kualifikasi_config — load + jsonb boundary
// ===========================================================================

interface BandRow {
  min: number | string;
  poin: number | string;
}
interface BandsJson {
  marginBands: BandRow[];
  aovBands: BandRow[];
  skuBands: BandRow[];
  rasioTargetBands: BandRow[];
}
interface KualifikasiConfigRow {
  version: number;
  skor_growth_ready: number | string;
  skor_bersyarat_min: number | string;
  margin_hambatan_persen: number | string;
  margin_zona_abu_abu_toleransi: number | string;
  rasio_target_hambatan: number | string;
  daya_tahan_hambatan_bulan: number | string;
  target_roas_advertiser: number | string;
  bands: BandsJson;
}

/**
 * configFromRow maps a `kualifikasi_config` row to the core `KualifikasiConfig`.
 * Numeric columns arrive as strings from the driver, and AOV band cut points are
 * stored as plain integers but the core type carries them as `bigint` (minor
 * units) — this is the one place that re-widens them.
 */
function configFromRow(row: KualifikasiConfigRow): iv.KualifikasiConfig {
  const num = (b: BandRow) => ({ min: Number(b.min), poin: Number(b.poin) });
  return {
    skorGrowthReady: Number(row.skor_growth_ready),
    skorBersyaratMin: Number(row.skor_bersyarat_min),
    marginHambatanPersen: Number(row.margin_hambatan_persen),
    marginZonaAbuAbuToleransi: Number(row.margin_zona_abu_abu_toleransi),
    rasioTargetHambatan: Number(row.rasio_target_hambatan),
    dayaTahanHambatanBulan: Number(row.daya_tahan_hambatan_bulan),
    targetRoasAdvertiser: Number(row.target_roas_advertiser),
    marginBands: row.bands.marginBands.map(num),
    aovBands: row.bands.aovBands.map((b) => ({ min: BigInt(b.min), poin: Number(b.poin) })),
    skuBands: row.bands.skuBands.map(num),
    rasioTargetBands: row.bands.rasioTargetBands.map(num),
  };
}

/**
 * configToJsonb serialises a `KualifikasiConfig` to the plain-number shape stored
 * in `config_snapshot`. `JSON.stringify` cannot serialise a `bigint`, and the
 * config table stores AOV cut points as integers anyway, so the snapshot mirrors
 * that shape — `configFromRow` re-reads it identically. Storing the whole object
 * (scalars + bands) makes a past verdict fully reproducible (I15).
 */
export function configToJsonb(config: iv.KualifikasiConfig): Record<string, unknown> {
  return {
    skorGrowthReady: config.skorGrowthReady,
    skorBersyaratMin: config.skorBersyaratMin,
    marginHambatanPersen: config.marginHambatanPersen,
    marginZonaAbuAbuToleransi: config.marginZonaAbuAbuToleransi,
    rasioTargetHambatan: config.rasioTargetHambatan,
    dayaTahanHambatanBulan: config.dayaTahanHambatanBulan,
    targetRoasAdvertiser: config.targetRoasAdvertiser,
    marginBands: config.marginBands,
    aovBands: config.aovBands.map((b) => ({ min: Number(b.min), poin: b.poin })),
    skuBands: config.skuBands,
    rasioTargetBands: config.rasioTargetBands,
  };
}

/**
 * loadKualifikasiConfig fetches the config the scorer should run on. With no
 * `version` it returns the highest active version (the current calibration);
 * with an explicit `version` it returns that exact row (used to recompute a past
 * interview against the config it was scored on). Throws when none is found — a
 * scoring path with no config is a setup bug, not a runtime `—`.
 *
 * Note: `kualifikasi_config` is RLS default-deny, so this runs on the
 * service-role (write) path only — never inside a `withClaims` block.
 */
export async function loadKualifikasiConfig(sql: Queryable, version?: number): Promise<iv.KualifikasiConfig> {
  const rows = version
    ? await sql<KualifikasiConfigRow[]>`
        select * from kualifikasi_config where version = ${version}`
    : await sql<KualifikasiConfigRow[]>`
        select * from kualifikasi_config where aktif = true order by version desc limit 1`;
  if (rows.length === 0) {
    throw new Error(`interview: kualifikasi_config ${version ? `versi ${version}` : 'aktif'} tidak ditemukan`);
  }
  return configFromRow(rows[0]);
}

// ===========================================================================
// interview_kualifikasi — the scoring write path (the ONLY writer of the score)
// ===========================================================================

/** Arguments to compute and persist the Blok C qualification for an interview. */
export interface PersistKualifikasiArgs {
  interviewId: string;
  input: iv.KualifikasiInput;
  dihitungOleh: string;
  /** Explicit config version to score on; omit to use the active calibration. */
  configVersion?: number;
  /** Prasyarat progress; defaults to 'belum' (the DB default). */
  prasyaratStatus?: iv.PrasyaratStatus;
}

/** What the scoring path persisted, alongside the pure result it computed. */
export interface PersistKualifikasiResult {
  hasil: iv.HasilKualifikasi;
  config: iv.KualifikasiConfig;
}

/**
 * persistKualifikasi is the single scoring write path. It loads the config,
 * runs the ONE core scorer, and upserts the 1:1 `interview_kualifikasi` row with
 * `config_snapshot` set to the exact config used. Recompute (a second call)
 * overwrites every derived column but leaves `catatan_sanggahan` untouched, so
 * the append-only trigger's "a note must not change the verdict" branch never
 * fires — a recompute is allowed to move the verdict precisely because it is not
 * adding a note.
 *
 * The `hitungKualifikasi` output already applies deal-breaker precedence (I14),
 * so the row it writes can never violate `ck_kualifikasi_dealbreaker`.
 */
export async function persistKualifikasi(
  sql: Queryable,
  args: PersistKualifikasiArgs,
): Promise<PersistKualifikasiResult> {
  const config = await loadKualifikasiConfig(sql, args.configVersion);
  const hasil = iv.hitungKualifikasi(args.input, config);

  // margin_dasar_estimasi is required by the DB CHECK when the basis is an AM
  // estimate; it comes from the input (the scorer records the basis, not the
  // prose). A derived basis carries marginDerivasiInput instead.
  const dasarEstimasi =
    hasil.marginBersihBasis === iv.MARGIN_BASIS.EstimasiAm ? (args.input.marginBersihDasarEstimasi ?? null) : null;

  await sql`
    insert into interview_kualifikasi
      (interview_id, skor_kualifikasi, skor_per_blok, verdict_kualifikasi, hambatan_mendasar,
       prasyarat_status, margin_bersih, margin_bersih_basis, margin_kotor, margin_dasar_estimasi,
       margin_derivasi_input, kualitas_data, sumber_angka_per_field, bep_roas, daya_tahan_budget_bulan,
       rasio_target, config_snapshot, dihitung_oleh)
    values
      (${args.interviewId}, ${hasil.skorTotal}, ${hasil.skorPerBlok as never}, ${hasil.verdict},
       ${hasil.hambatanMendasar as never}, ${args.prasyaratStatus ?? 'belum'}, ${hasil.marginBersih},
       ${hasil.marginBersihBasis}, ${hasil.marginKotor}, ${dasarEstimasi},
       ${(hasil.marginDerivasiInput ?? null) as never}, ${hasil.kualitasData},
       ${hasil.sumberAngkaPerField as never}, ${hasil.bepRoas}, ${args.input.dayaTahanBudget},
       ${hasil.rasioTarget}, ${configToJsonb(hasil.configSnapshot) as never}, ${args.dihitungOleh})
    on conflict (interview_id) do update set
      skor_kualifikasi = excluded.skor_kualifikasi,
      skor_per_blok = excluded.skor_per_blok,
      verdict_kualifikasi = excluded.verdict_kualifikasi,
      hambatan_mendasar = excluded.hambatan_mendasar,
      prasyarat_status = excluded.prasyarat_status,
      margin_bersih = excluded.margin_bersih,
      margin_bersih_basis = excluded.margin_bersih_basis,
      margin_kotor = excluded.margin_kotor,
      margin_dasar_estimasi = excluded.margin_dasar_estimasi,
      margin_derivasi_input = excluded.margin_derivasi_input,
      kualitas_data = excluded.kualitas_data,
      sumber_angka_per_field = excluded.sumber_angka_per_field,
      bep_roas = excluded.bep_roas,
      daya_tahan_budget_bulan = excluded.daya_tahan_budget_bulan,
      rasio_target = excluded.rasio_target,
      config_snapshot = excluded.config_snapshot,
      dihitung_oleh = excluded.dihitung_oleh,
      dihitung_pada = now()`;

  return { hasil, config };
}

/**
 * appendSanggahan appends one entry to `catatan_sanggahan` — the append-only
 * pressure-release valve (I). It grows the array and touches nothing else; the
 * DB trigger blocks a shrink, a rewrite of an earlier element, or a verdict
 * change smuggled in with the note. Correcting a verdict is a re-input +
 * `persistKualifikasi`, never a note.
 */
export async function appendSanggahan(sql: Queryable, interviewId: string, entry: unknown): Promise<void> {
  await sql`
    update interview_kualifikasi
       set catatan_sanggahan = coalesce(catatan_sanggahan, '[]'::jsonb) || jsonb_build_array(${entry as never}::jsonb)
     where interview_id = ${interviewId}`;
}

// ===========================================================================
// interview_flag — append-only advisory flags (red flag, SLA breach, grey zone)
// ===========================================================================

export interface FlagInsert {
  interviewId: string;
  kode: string;
  detail?: unknown;
  createdBy?: string; // defaults to 'SYSTEM' (DB default) when omitted
}

/** insertFlag appends one advisory flag row. The table is UPDATE/DELETE-frozen. */
export async function insertFlag(sql: Queryable, f: FlagInsert): Promise<void> {
  if (f.createdBy != null) {
    await sql`
      insert into interview_flag (interview_id, kode, detail, created_by)
      values (${f.interviewId}, ${f.kode}, ${(f.detail ?? {}) as never}, ${f.createdBy})`;
  } else {
    await sql`
      insert into interview_flag (interview_id, kode, detail)
      values (${f.interviewId}, ${f.kode}, ${(f.detail ?? {}) as never})`;
  }
}

// ===========================================================================
// interview_outcome — verdict-accuracy record (I18), written at contract close
// ===========================================================================

export interface OutcomeInsert {
  interviewId: string;
  kontrakId?: string | null;
  hasil: 'perpanjang' | 'selesai_tidak_perpanjang' | 'berhenti_di_tengah';
  bulanBertahan?: number | null;
  dicatatOleh: string;
}

/** recordOutcome writes the 1:1 outcome row (the accuracy signal for I18). */
export async function recordOutcome(sql: Queryable, o: OutcomeInsert): Promise<void> {
  await sql`
    insert into interview_outcome (interview_id, kontrak_id, hasil, bulan_bertahan, dicatat_oleh)
    values (${o.interviewId}, ${o.kontrakId ?? null}, ${o.hasil}, ${o.bulanBertahan ?? null}, ${o.dicatatOleh})`;
}

// ===========================================================================
// interview_version — immutable per-version snapshot (I9)
// ===========================================================================

export interface VersionSnapshot {
  interviewId: string;
  versiNo: number;
  snapshot: unknown;
  dibuatOleh: string;
}

/**
 * snapshotVersion appends an immutable per-version snapshot. The table is
 * UPDATE/DELETE-frozen, so a re-interview (createInterview with `lineage`) plus a
 * snapshot of the superseded version is the whole of the version-bump path.
 */
export async function snapshotVersion(sql: Queryable, v: VersionSnapshot): Promise<void> {
  await sql`
    insert into interview_version (interview_id, versi_no, snapshot, dibuat_oleh)
    values (${v.interviewId}, ${v.versiNo}, ${v.snapshot as never}, ${v.dibuatOleh})`;
}
