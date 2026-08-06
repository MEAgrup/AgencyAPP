/**
 * Module 6A — the `STRG-` Strategi entity (backlog A-03 + A-04).
 *
 * This is the skeleton the Section A→J form is built on: the record, its child
 * tables, and machine #15. The per-section FIELDS (A-05…A-09) attach to these
 * tables; they do not replace them.
 *
 * ===========================================================================
 * What this module refuses to do, and why
 * ===========================================================================
 *
 * **It does not unlock Brief dispatch yet.** M6A §5.7 says approval unlocks
 * Brief dispatch for the Service, and it will — but the gate that guards Briefs
 * today (`account.guardBriefCreation`) reads the OLD M6 §4 entity
 * (`strategy_plans`, `STR-`), which is what the Service page still writes. Making
 * `STRG` approval drive the Service status now would create two independent ways
 * to open the same gate while the old form is still the only UI, and "two doors,
 * one lock" is exactly the class of defect this codebase keeps paying for. The
 * swap happens with the form (A-05…A-09). Until then a `STRG` record is complete
 * and audited but inert with respect to the Brief gate — stated here rather than
 * discovered later.
 *
 * **It emits no notifications.** The four M6A events (`strategi_diajukan`,
 * `strategi_disetujui`, `strategi_dikembalikan`, `strategi_revisi_disarankan`)
 * belong to the v2 catalog amendment, which is a frozen invariant still waiting
 * on sign-off (M6A RA-1 / M6B PA-8 / M6C GA-8 — DECISIONS O55). Every transition
 * is still recorded in `audit_log` by `sm_transition`; only the ping is missing.
 *
 * **It never writes a status column.** Machine #15 lives in the migration and
 * runs inside `sm_transition` (CLAUDE.md #2).
 *
 * ===========================================================================
 * Two shapes worth knowing before reading the code
 * ===========================================================================
 *
 * 1. **A version is a row, not a counter** (Rule 13). Version n stays `Aktif`
 *    while n+1 sits in `Draft Revisi`; one row cannot hold two statuses. So
 *    `openRevision` INSERTs a new row, copies the children, and only
 *    `approveStrategi` archives the predecessor.
 *
 * 2. **Returning lands where it came from** (Rule 12, "keeps its version
 *    number"). `sm_edges` cannot see whether a `Diajukan` arrived from `Draft`
 *    or `Draft Revisi`, so both edges are registered and this module picks the
 *    target from `versi_no`.
 *
 * Reference: docs/prd/CDPS_Module6A_Strategi.md.
 */

import { ident, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import { effectiveGate, type PlanTier } from './plangate_rules';

// ---------------------------------------------------------------------------
// Vocabulary — mirrors the CHECK constraints in
// supabase/migrations/20260806064000_m6a_strategi.sql.
// ---------------------------------------------------------------------------

export const STRATEGI_DRAFT = 'Draft';
export const STRATEGI_DIAJUKAN = 'Diajukan';
export const STRATEGI_AKTIF = 'Aktif';
export const STRATEGI_DRAFT_REVISI = 'Draft Revisi';
export const STRATEGI_KEDALUWARSA = 'Kedaluwarsa';
export const STRATEGI_DIARSIPKAN = 'Diarsipkan';

/** D1 — the contracted channel scope. */
export const CHANNELS = [
  'Shopee',
  'TikTok Shop',
  'Tokopedia',
  'Lazada',
  'Website',
  'Lainnya',
] as const;
export type Channel = (typeof CHANNELS)[number];

/** B-0.2 — `Belum Aktif` skips the historical baseline (Rule 4). */
export const CHANNEL_STATES = ['Eksisting', 'Belum Aktif'] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

/** D-2 / D-4 metrics. `gmv` is the one the floor/stretch rule applies to. */
export const TARGET_METRICS = [
  'gmv',
  'pengunjung',
  'cr',
  'aov',
  'roas_min',
  'acos_maks',
  'sku_winner',
  'affiliate_aktif',
  'jam_live',
  'jumlah_video',
] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

/** Section E pillars; `tidak_dikerjakan` is E-11 (Rule 9). */
export const PILLAR_KINDS = [
  'sku',
  'harga',
  'iklan',
  'konten',
  'affiliate',
  'live',
  'retensi',
  'operasional',
  'tidak_dikerjakan',
] as const;
export type PillarKind = (typeof PILLAR_KINDS)[number];

/** Section F commitment rows. */
export const RESOURCE_KINDS = [
  'budget_iklan',
  'konten',
  'kol',
  'live_vendor',
  'divisi',
  'tools',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const ASSUMPTION_STATES = ['Berlaku', 'Gugur', 'Terverifikasi'] as const;
export type AssumptionState = (typeof ASSUMPTION_STATES)[number];

export const RISK_LEVELS = ['rendah', 'sedang', 'tinggi'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

const MACHINE_STRATEGI = 'strategi';
const ENTITY_STRATEGI = 'strategi';

// --- BI messages. M6A's body is English and specifies no error strings, so
// these follow CLAUDE.md #5 and the M6C precedent. ---

export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_STRATEGI_NOT_FOUND = '[Strategi tidak ditemukan]';
export const MSG_SERVICE_NOT_FOUND = '[layanan tidak ditemukan]';
/** Only the owning AM (or a Director) may author a Strategi (§7 permissions). */
export const MSG_NOT_OWNER_AM =
  '[hanya Account Manager pemilik klien yang dapat mengisi Strategi layanan ini]';
/** Read gate: owning AM, Account lead/SPV, OD/Direksi. */
export const MSG_STRATEGI_FORBIDDEN = '[anda tidak memiliki akses ke Strategi ini]';
/** Approve / return is SPV / Head of Account authority (Rule 12). */
export const MSG_APPROVE_FORBIDDEN =
  '[anda tidak memiliki akses untuk menyetujui atau mengembalikan Strategi]';
/** M6A Rule 1: only a plan-gated Service has a Strategi. */
export const MSG_NOT_PLAN_GATED = '[layanan ini tidak memerlukan Strategi]';
/** Rule 2 + the in-flight partial index. */
export const MSG_STRATEGI_EXISTS = '[Strategi untuk layanan ini sudah ada]';
/** Edits are Draft-only (§7 permissions: AM writes A–I on Draft / Draft Revisi). */
export const MSG_NOT_DRAFT = '[Strategi hanya dapat diubah saat berstatus Draft atau Draft Revisi]';
/** Rule 12 — returning requires a written note. */
export const MSG_REVIEW_NOTES_REQUIRED = '[catatan reviewer wajib diisi saat mengembalikan Strategi]';
/** Rule 13 (a)(b)(c) — a revision must declare trigger, reason and broken assumptions. */
export const MSG_REVISION_INCOMPLETE =
  '[revisi wajib menyebutkan trigger, alasan, dan asumsi yang gugur]';
/** Rule 13 — only an active version can be revised. */
export const MSG_REVISION_NOT_ACTIVE = '[hanya Strategi berstatus Aktif yang dapat direvisi]';
/** Rule 3 — no submit without at least one contracted channel block. */
export const MSG_NO_CHANNEL = '[minimal satu channel wajib diisi sebelum Strategi diajukan]';
/** Rule 5 — an `Eksisting` channel is missing baseline months. */
export const MSG_BASELINE_INCOMPLETE =
  '[baseline bulanan belum lengkap untuk seluruh periode yang dideklarasikan]';
/** D-2 — no GMV stretch target for a contracted channel. */
export const MSG_TARGET_MISSING = '[target GMV per bulan wajib diisi untuk setiap channel]';
/** D-8 — at least three assumptions. */
export const MSG_ASSUMPTION_MIN = '[minimal tiga asumsi target wajib diisi]';
/** Rule 8 — every monthly stretch figure carries an assumption. */
export const MSG_TARGET_WITHOUT_ASSUMPTION =
  '[setiap target GMV bulanan wajib terkait minimal satu asumsi]';
/** Rule 9 / E-11 — the out-of-scope record cannot be empty. */
export const MSG_OUT_OF_SCOPE_REQUIRED = '[minimal satu item Yang Tidak Dikerjakan wajib diisi]';
/** H-1 — at least three risks. */
export const MSG_RISK_MIN = '[minimal tiga risiko wajib diisi di risk register]';
/** G-0 / Rule 17 — the Plan cycle start date is required before submit. */
export const MSG_CYCLE_START_REQUIRED = '[tanggal mulai siklus Plan wajib diisi]';
/** Rule 17 — the start date is frozen once Plan period 1 closes. */
export const MSG_CYCLE_LOCKED =
  '[tanggal mulai siklus tidak dapat diubah setelah periode Plan pertama ditutup]';
/** Section B — the channel row does not belong to this Strategi. */
export const MSG_CHANNEL_NOT_FOUND = '[channel tidak ditemukan pada Strategi ini]';
/** D-9 — an assumption points at a target that does not exist. */
export const MSG_ASSUMPTION_TARGET_UNKNOWN =
  '[asumsi merujuk target yang tidak ada di Strategi ini]';

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The Strategi header (Section J-1 + the contract window). */
export interface Strategi {
  id: string;
  serviceId: string;
  clientId: string;
  versiNo: number;
  strategiIndukId: string | null;
  versiSebelumnyaId: string | null;
  status: string;
  durasiKontrakBulan: number;
  tanggalMulaiKontrak: string;
  tanggalAkhirKontrak: string;
  tanggalMulaiSiklus: string | null;
  siklusTerkunci: boolean;
  toleransiOverPersen: number;
  diajukanPada: string | null;
  disetujuiPada: string | null;
  disetujuiOleh: string | null;
  catatanReviewer: string | null;
  createdBy: string;
  createdAt: string;
}

/** Section B-0 — one block per contracted channel (D4). */
export interface StrategiChannel {
  id: number;
  channel: Channel;
  channelLain: string | null;
  statusChannel: ChannelState;
  namaToko: string;
  urlToko: string;
  umurTokoBulan: number | null;
  badge: string | null;
  targetTanggalLive: string | null;
  prasyaratPembukaan: string[];
  sumberData: string | null;
  tanggalAmbilData: string | null;
  lampiran: string | null;
  periodeBaselineBulan: number | null;
  periodeMulai: string | null;
  periodeAkhir: string | null;
  alasanPeriodePendek: string | null;
  catatanPeriodePendek: string | null;
}

/** B-1 / B-5 — one row per month of the declared window. */
export interface BaselineMonth {
  monthIndex: number;
  gmv: string;
  jumlahPesanan: number;
  persenBatal: number;
  adSpend: string;
  roas: number;
  acos: number;
  /** B-1.3, auto (GMV/order). Null when there were no orders — rendered `—`. */
  aov: string | null;
}

/** D-1 (floor) + D-2/D-4 (stretch). */
export interface StrategiTarget {
  channel: string;
  monthIndex: number;
  metric: TargetMetric;
  nilaiFloor: string | null;
  nilaiStretch: string;
  /** O57: `kontrak` once a Contract record exists; `input_am` until then. */
  sumberFloor: 'kontrak' | 'input_am' | null;
}

/** D-8 + D-9. */
export interface StrategiAssumption {
  kode: string;
  asumsi: string;
  pemilik: string;
  caraVerifikasi: string;
  status: AssumptionState;
  /** D-9 mapping, as target keys `metric:channel:monthIndex`. */
  targetTerkait: string[];
}

/** Section E. */
export interface StrategiPillar {
  id: number;
  jenis: PillarKind;
  channel: string | null;
  urutan: number;
  sku: string | null;
  peran: string | null;
  aksi: string;
  target: string;
  hargaNormal: string | null;
  hargaPromo: string | null;
  floorPrice: string | null;
  vendorId: string | null;
  slotJam: number | null;
  tarif: string | null;
  targetGmvPerJam: string | null;
  detail: Record<string, unknown>;
}

/** Section F (soft — Rule 10). */
export interface StrategiResource {
  id: number;
  jenis: ResourceKind;
  channel: string | null;
  divisi: string | null;
  nilai: string | null;
  jumlah: number | null;
  satuan: string | null;
  sumberDana: 'klien' | 'paket_mea' | null;
  vendorId: string | null;
  skemaBiaya: string | null;
  catatan: string;
}

/** H-1 risk register. */
export interface StrategiRisk {
  id: number;
  risiko: string;
  dampak: RiskLevel;
  kemungkinan: RiskLevel;
  mitigasi: string;
  pic: string;
  urutan: number;
}

/** Section J — one row per event, append-only. */
export interface StrategiEvent {
  versiNo: number;
  peristiwa: string;
  aktor: string;
  catatan: string | null;
  triggerRevisi: string[];
  alasanRevisi: string | null;
  asumsiGugur: string[];
  createdAt: string;
}

/** The whole record, as the form loads it. */
export interface StrategiDetail extends Strategi {
  channels: (StrategiChannel & { baseline: BaselineMonth[] })[];
  targets: StrategiTarget[];
  assumptions: StrategiAssumption[];
  pillars: StrategiPillar[];
  resources: StrategiResource[];
  risks: StrategiRisk[];
  riwayat: StrategiEvent[];
}

/** The header fields the AM sets (the contract window + G-0 + F-7). */
export interface StrategiHeaderInput {
  durasiKontrakBulan: number;
  tanggalMulaiKontrak: string;
  tanggalAkhirKontrak: string;
  tanggalMulaiSiklus?: string | null;
  toleransiOverPersen?: number | null;
}

// ---------------------------------------------------------------------------
// Permission (M6A §7)
// ---------------------------------------------------------------------------

/** canWriteStrategi: the owning AM, or a Director. Sections A–I, Draft only. */
export function canWriteStrategi(actor: Actor, ownerAm: string | null): boolean {
  if (actor.role.director) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/** canApproveStrategi: SPV / Head of Account (Rule 12). Never the author's own. */
export function canApproveStrategi(actor: Actor): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION);
}

/** canReadStrategi: the write set, plus Account lead and every read-all role. */
export function canReadStrategi(actor: Actor, ownerAm: string | null): boolean {
  return (
    canWriteStrategi(actor, ownerAm) ||
    permission.canReadAll(actor) ||
    permission.isLead(actor, ACCOUNT_DIVISION)
  );
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface StrategiRow {
  id: string;
  service_id: string;
  client_id: string;
  versi_no: number;
  strategi_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  status: string;
  durasi_kontrak_bulan: number;
  tanggal_mulai_kontrak: string | Date;
  tanggal_akhir_kontrak: string | Date;
  tanggal_mulai_siklus: string | Date | null;
  siklus_terkunci: boolean;
  toleransi_over_persen: string;
  diajukan_pada: string | Date | null;
  disetujui_pada: string | Date | null;
  disetujui_oleh: string | null;
  catatan_reviewer: string | null;
  created_by: string;
  created_at: string | Date;
}

function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function dateOrNull(v: string | Date | null): string | null {
  return v === null ? null : dateStr(v);
}

function tsOrNull(v: string | Date | null): string | null {
  return v === null ? null : new Date(v).toISOString();
}

function rowToStrategi(r: StrategiRow): Strategi {
  return {
    id: r.id,
    serviceId: r.service_id,
    clientId: r.client_id,
    versiNo: r.versi_no,
    strategiIndukId: r.strategi_induk_id,
    versiSebelumnyaId: r.versi_sebelumnya_id,
    status: r.status,
    durasiKontrakBulan: r.durasi_kontrak_bulan,
    tanggalMulaiKontrak: dateStr(r.tanggal_mulai_kontrak),
    tanggalAkhirKontrak: dateStr(r.tanggal_akhir_kontrak),
    tanggalMulaiSiklus: dateOrNull(r.tanggal_mulai_siklus),
    siklusTerkunci: r.siklus_terkunci,
    toleransiOverPersen: Number(r.toleransi_over_persen),
    diajukanPada: tsOrNull(r.diajukan_pada),
    disetujuiPada: tsOrNull(r.disetujui_pada),
    disetujuiOleh: r.disetujui_oleh,
    catatanReviewer: r.catatan_reviewer,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadServiceContext(
  sql: Queryable,
  serviceId: string,
): Promise<{ clientId: string; status: string; tier: PlanTier; override: boolean | null; ownerAm: string | null; gateDecision: string | null }> {
  const rows = await sql<
    {
      client_id: string;
      status: string;
      plan_tier: string;
      requires_strategy_plan_override: boolean | null;
      assigned_am_id: string | null;
      keputusan_am: string | null;
    }[]
  >`
    select sv.client_id, sv.status, sv.plan_tier, sv.requires_strategy_plan_override,
           c.assigned_am_id, g.keputusan_am
      from services sv
      join clients c on c.id = sv.client_id
      left join service_plan_gate g on g.service_id = sv.id
     where sv.id = ${serviceId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
  }
  const r = rows[0];
  return {
    clientId: r.client_id,
    status: r.status,
    tier: r.plan_tier as PlanTier,
    override: r.requires_strategy_plan_override,
    ownerAm: r.assigned_am_id,
    gateDecision: r.keputusan_am,
  };
}

async function loadStrategiRow(sql: Queryable, id: string, forUpdate = false): Promise<Strategi> {
  const rows = forUpdate
    ? await sql<StrategiRow[]>`select * from strategi where id = ${id} for update`
    : await sql<StrategiRow[]>`select * from strategi where id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_STRATEGI_NOT_FOUND);
  }
  return rowToStrategi(rows[0]);
}

/** ownerAmOf resolves the AM who owns the client behind a Strategi. */
async function ownerAmOf(sql: Queryable, serviceId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select c.assigned_am_id from services sv join clients c on c.id = sv.client_id
     where sv.id = ${serviceId}`;
  return rows.length === 0 ? null : rows[0].assigned_am_id;
}

/** getStrategi loads the whole record (header + every child). */
export async function getStrategi(sql: Queryable, actor: Actor, id: string): Promise<StrategiDetail> {
  const head = await loadStrategiRow(sql, id);
  const ownerAm = await ownerAmOf(sql, head.serviceId);
  if (!canReadStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_STRATEGI_FORBIDDEN);
  }
  return loadDetail(sql, head);
}

async function loadDetail(sql: Queryable, head: Strategi): Promise<StrategiDetail> {
  const id = head.id;

  const channelRows = await sql<
    {
      id: string;
      channel: string;
      channel_lain: string | null;
      status_channel: string;
      nama_toko: string;
      url_toko: string;
      umur_toko_bulan: number | null;
      badge: string | null;
      target_tanggal_live: string | Date | null;
      prasyarat_pembukaan: unknown;
      sumber_data: string | null;
      tanggal_ambil_data: string | Date | null;
      lampiran: string | null;
      periode_baseline_bulan: number | null;
      periode_mulai: string | Date | null;
      periode_akhir: string | Date | null;
      alasan_periode_pendek: string | null;
      catatan_periode_pendek: string | null;
    }[]
  >`select * from strategi_channel where strategi_id = ${id} order by id asc`;

  const baselineRows = await sql<
    {
      channel_id: string;
      month_index: number;
      gmv: string;
      jumlah_pesanan: number;
      persen_batal: string;
      ad_spend: string;
      roas: string;
      acos: string;
      aov: string | null;
    }[]
  >`
    select b.* from strategi_baseline_bulan b
      join strategi_channel c on c.id = b.channel_id
     where c.strategi_id = ${id}
     order by b.channel_id asc, b.month_index asc`;

  const channels = channelRows.map((c) => ({
    id: Number(c.id),
    channel: c.channel as Channel,
    channelLain: c.channel_lain,
    statusChannel: c.status_channel as ChannelState,
    namaToko: c.nama_toko,
    urlToko: c.url_toko,
    umurTokoBulan: c.umur_toko_bulan,
    badge: c.badge,
    targetTanggalLive: dateOrNull(c.target_tanggal_live),
    prasyaratPembukaan: strArray(c.prasyarat_pembukaan),
    sumberData: c.sumber_data,
    tanggalAmbilData: dateOrNull(c.tanggal_ambil_data),
    lampiran: c.lampiran,
    periodeBaselineBulan: c.periode_baseline_bulan,
    periodeMulai: dateOrNull(c.periode_mulai),
    periodeAkhir: dateOrNull(c.periode_akhir),
    alasanPeriodePendek: c.alasan_periode_pendek,
    catatanPeriodePendek: c.catatan_periode_pendek,
    baseline: baselineRows
      .filter((b) => Number(b.channel_id) === Number(c.id))
      .map((b) => ({
        monthIndex: b.month_index,
        gmv: b.gmv,
        jumlahPesanan: b.jumlah_pesanan,
        persenBatal: Number(b.persen_batal),
        adSpend: b.ad_spend,
        roas: Number(b.roas),
        acos: Number(b.acos),
        aov: b.aov,
      })),
  }));

  const targetRows = await sql<
    {
      channel: string;
      month_index: number;
      metric: string;
      nilai_floor: string | null;
      nilai_stretch: string;
      sumber_floor: string | null;
    }[]
  >`select * from strategi_target where strategi_id = ${id}
     order by metric asc, channel asc, month_index asc`;

  const assumptionRows = await sql<
    {
      kode: string;
      asumsi: string;
      pemilik: string;
      cara_verifikasi: string;
      status: string;
      target_terkait: unknown;
    }[]
  >`select * from strategi_assumption where strategi_id = ${id} order by kode asc`;

  const pillarRows = await sql<
    {
      id: string;
      jenis: string;
      channel: string | null;
      urutan: number;
      sku: string | null;
      peran: string | null;
      aksi: string;
      target: string;
      harga_normal: string | null;
      harga_promo: string | null;
      floor_price: string | null;
      vendor_id: string | null;
      slot_jam: string | null;
      tarif: string | null;
      target_gmv_per_jam: string | null;
      detail: unknown;
    }[]
  >`select * from strategi_pillar where strategi_id = ${id} order by urutan asc, id asc`;

  const resourceRows = await sql<
    {
      id: string;
      jenis: string;
      channel: string | null;
      divisi: string | null;
      nilai: string | null;
      jumlah: string | null;
      satuan: string | null;
      sumber_dana: string | null;
      vendor_id: string | null;
      skema_biaya: string | null;
      catatan: string;
    }[]
  >`select * from strategi_resource where strategi_id = ${id} order by jenis asc, id asc`;

  const riskRows = await sql<
    {
      id: string;
      risiko: string;
      dampak: string;
      kemungkinan: string;
      mitigasi: string;
      pic: string;
      urutan: number;
    }[]
  >`select * from strategi_risk where strategi_id = ${id} order by urutan asc, id asc`;

  const eventRows = await sql<
    {
      versi_no: number;
      peristiwa: string;
      aktor: string;
      catatan: string | null;
      trigger_revisi: unknown;
      alasan_revisi: string | null;
      asumsi_gugur: unknown;
      created_at: string | Date;
    }[]
  >`select * from strategi_version where strategi_id = ${id} order by id asc`;

  return {
    ...head,
    channels,
    targets: targetRows.map((t) => ({
      channel: t.channel,
      monthIndex: t.month_index,
      metric: t.metric as TargetMetric,
      nilaiFloor: t.nilai_floor,
      nilaiStretch: t.nilai_stretch,
      sumberFloor: t.sumber_floor as 'kontrak' | 'input_am' | null,
    })),
    assumptions: assumptionRows.map((a) => ({
      kode: a.kode,
      asumsi: a.asumsi,
      pemilik: a.pemilik,
      caraVerifikasi: a.cara_verifikasi,
      status: a.status as AssumptionState,
      targetTerkait: strArray(a.target_terkait),
    })),
    pillars: pillarRows.map((p) => ({
      id: Number(p.id),
      jenis: p.jenis as PillarKind,
      channel: p.channel,
      urutan: p.urutan,
      sku: p.sku,
      peran: p.peran,
      aksi: p.aksi,
      target: p.target,
      hargaNormal: p.harga_normal,
      hargaPromo: p.harga_promo,
      floorPrice: p.floor_price,
      vendorId: p.vendor_id,
      slotJam: p.slot_jam === null ? null : Number(p.slot_jam),
      tarif: p.tarif,
      targetGmvPerJam: p.target_gmv_per_jam,
      detail: (p.detail ?? {}) as Record<string, unknown>,
    })),
    resources: resourceRows.map((r) => ({
      id: Number(r.id),
      jenis: r.jenis as ResourceKind,
      channel: r.channel,
      divisi: r.divisi,
      nilai: r.nilai,
      jumlah: r.jumlah === null ? null : Number(r.jumlah),
      satuan: r.satuan,
      sumberDana: r.sumber_dana as 'klien' | 'paket_mea' | null,
      vendorId: r.vendor_id,
      skemaBiaya: r.skema_biaya,
      catatan: r.catatan,
    })),
    risks: riskRows.map((r) => ({
      id: Number(r.id),
      risiko: r.risiko,
      dampak: r.dampak as RiskLevel,
      kemungkinan: r.kemungkinan as RiskLevel,
      mitigasi: r.mitigasi,
      pic: r.pic,
      urutan: r.urutan,
    })),
    riwayat: eventRows.map((e) => ({
      versiNo: e.versi_no,
      peristiwa: e.peristiwa,
      aktor: e.aktor,
      catatan: e.catatan,
      triggerRevisi: strArray(e.trigger_revisi),
      alasanRevisi: e.alasan_revisi,
      asumsiGugur: strArray(e.asumsi_gugur),
      createdAt: new Date(e.created_at).toISOString(),
    })),
  };
}

/**
 * listStrategiForService returns every version, newest first.
 *
 * Versions are rows (Rule 13), so "the history" is a list here, not a diff of
 * one row — an archived version stays readable exactly as it was approved.
 */
export async function listStrategiForService(
  sql: Queryable,
  actor: Actor,
  serviceId: string,
): Promise<Strategi[]> {
  const ownerAm = await ownerAmOf(sql, serviceId);
  if (!canReadStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_STRATEGI_FORBIDDEN);
  }
  const rows = await sql<StrategiRow[]>`
    select * from strategi where service_id = ${serviceId} order by versi_no desc`;
  return rows.map(rowToStrategi);
}

/** activeStrategi returns the one `Aktif` version, or null. Rule 2 guarantees ≤1. */
export async function activeStrategi(sql: Queryable, serviceId: string): Promise<Strategi | null> {
  const rows = await sql<StrategiRow[]>`
    select * from strategi where service_id = ${serviceId} and status = ${STRATEGI_AKTIF}`;
  return rows.length === 0 ? null : rowToStrategi(rows[0]);
}

// ---------------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------------

function normalizeHeader(input: StrategiHeaderInput): Required<StrategiHeaderInput> {
  const mulai = (input.tanggalMulaiKontrak ?? '').trim();
  const akhir = (input.tanggalAkhirKontrak ?? '').trim();
  const siklus = (input.tanggalMulaiSiklus ?? '')?.toString().trim() ?? '';
  if (!RE_DATE.test(mulai) || !RE_DATE.test(akhir)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (akhir <= mulai) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const durasi = Number(input.durasiKontrakBulan);
  if (!Number.isInteger(durasi) || durasi < 1 || durasi > 36) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (siklus !== '' && !RE_DATE.test(siklus)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const toleransi = input.toleransiOverPersen ?? 20;
  if (!(toleransi >= 0 && toleransi <= 100)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  return {
    durasiKontrakBulan: durasi,
    tanggalMulaiKontrak: mulai,
    tanggalAkhirKontrak: akhir,
    // RA-5 default (`tanggal_mulai_siklus` = contract start) is NOT applied
    // silently: the assumption is still open (backlog X-05), and quietly picking
    // a date the AM never saw would put every Plan period boundary on a guess.
    tanggalMulaiSiklus: siklus === '' ? null : siklus,
    toleransiOverPersen: toleransi,
  };
}

// ---------------------------------------------------------------------------
// Writes — header
// ---------------------------------------------------------------------------

/**
 * createStrategi opens version 1 in `Draft` for a plan-gated Service (Rule 1).
 *
 * "Plan-gated" is resolved through the M6C precedence (`effectiveGate`), not by
 * reading a boolean: for the middle tier the effective answer is the AM's
 * recorded G-B decision, and duplicating that precedence here would create the
 * second copy M6C exists to prevent.
 */
export async function createStrategi(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  input: StrategiHeaderInput,
): Promise<Strategi> {
  const head = normalizeHeader(input);
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await loadServiceContext(tx, serviceId);
    if (!canWriteStrategi(actor, svc.ownerAm)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    const eff = effectiveGate({
      tier: svc.tier,
      override: svc.override,
      keputusanAm: (svc.gateDecision as 'butuh_plan' | 'tanpa_plan' | null) ?? null,
    });
    if (!eff.requiresPlan) {
      throw new ConflictError(MSG_NOT_PLAN_GATED);
    }
    const existing = await tx<{ id: string }[]>`
      select id from strategi
       where service_id = ${serviceId}
         and status in (${STRATEGI_DRAFT}, ${STRATEGI_DIAJUKAN}, ${STRATEGI_AKTIF}, ${STRATEGI_DRAFT_REVISI})`;
    if (existing.length > 0) {
      throw new ConflictError(MSG_STRATEGI_EXISTS);
    }

    const id = await ident.nextId(ex.ident, 'STRG', now);
    await tx`
      insert into strategi
        (id, service_id, client_id, versi_no, status, durasi_kontrak_bulan,
         tanggal_mulai_kontrak, tanggal_akhir_kontrak, tanggal_mulai_siklus,
         toleransi_over_persen, created_by)
      values
        (${id}, ${serviceId}, ${svc.clientId}, 1, ${STRATEGI_DRAFT}, ${head.durasiKontrakBulan},
         ${head.tanggalMulaiKontrak}, ${head.tanggalAkhirKontrak}, ${head.tanggalMulaiSiklus},
         ${head.toleransiOverPersen}, ${actor.employeeId})`;

    await appendEvent(tx, id, 1, 'dibuat', actor.employeeId, null);
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { service_id: serviceId, versi_no: 1, status: STRATEGI_DRAFT },
      createdBy: actor.employeeId,
    });

    return loadStrategiRow(tx, id);
  });
}

/**
 * updateHeader edits the contract window, G-0 and F-7 while the record is a
 * draft. Rule 17 is enforced twice on purpose: the DB trigger is the wall (it
 * also stops a service-role call), this is the BI message.
 */
export async function updateHeader(
  sql: Sql,
  actor: Actor,
  id: string,
  input: StrategiHeaderInput,
): Promise<Strategi> {
  const head = normalizeHeader(input);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const before = await requireDraftAndWriter(tx, actor, id);
    if (before.siklusTerkunci && head.tanggalMulaiSiklus !== before.tanggalMulaiSiklus) {
      throw new ConflictError(MSG_CYCLE_LOCKED);
    }
    await tx`
      update strategi
         set durasi_kontrak_bulan = ${head.durasiKontrakBulan},
             tanggal_mulai_kontrak = ${head.tanggalMulaiKontrak},
             tanggal_akhir_kontrak = ${head.tanggalAkhirKontrak},
             tanggal_mulai_siklus = ${head.tanggalMulaiSiklus},
             toleransi_over_persen = ${head.toleransiOverPersen}
       where id = ${id}`;
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'update_header',
      beforeJson: {
        durasi_kontrak_bulan: before.durasiKontrakBulan,
        tanggal_mulai_kontrak: before.tanggalMulaiKontrak,
        tanggal_akhir_kontrak: before.tanggalAkhirKontrak,
        tanggal_mulai_siklus: before.tanggalMulaiSiklus,
      },
      afterJson: {
        durasi_kontrak_bulan: head.durasiKontrakBulan,
        tanggal_mulai_kontrak: head.tanggalMulaiKontrak,
        tanggal_akhir_kontrak: head.tanggalAkhirKontrak,
        tanggal_mulai_siklus: head.tanggalMulaiSiklus,
      },
      createdBy: actor.employeeId,
    });
    return loadStrategiRow(tx, id);
  });
}

// ---------------------------------------------------------------------------
// Writes — child sets
// ---------------------------------------------------------------------------
//
// Every child write is a REPLACE-SET inside one transaction: the section is
// saved whole, not row by row. Two reasons. (a) The form saves a section at a
// time, and a partial write would leave, say, four of six baseline months —
// which is precisely the state Rule 5 exists to make impossible. (b) It keeps
// the audit row meaningful: one `save_<section>` entry per user action rather
// than a burst of per-row events nobody can reconstruct a form state from.

/** Section B-0 input. */
export interface ChannelInput {
  channel: Channel;
  channelLain?: string | null;
  statusChannel: ChannelState;
  namaToko: string;
  urlToko: string;
  umurTokoBulan?: number | null;
  badge?: string | null;
  targetTanggalLive?: string | null;
  prasyaratPembukaan?: string[];
  sumberData?: string | null;
  tanggalAmbilData?: string | null;
  lampiran?: string | null;
  periodeBaselineBulan?: number | null;
  periodeMulai?: string | null;
  periodeAkhir?: string | null;
  alasanPeriodePendek?: string | null;
  catatanPeriodePendek?: string | null;
}

/**
 * saveChannels replaces the Section B-0 blocks.
 *
 * Rule 4 and Rule 5/5a are validated here AND enforced by CHECK constraints. The
 * TS side exists to name the failing rule in Bahasa Indonesia; the CHECK exists
 * because a service-role caller never passes through here.
 */
export async function saveChannels(
  sql: Sql,
  actor: Actor,
  id: string,
  channels: ChannelInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const c of channels) {
      validateChannel(c);
    }
    // Deleting the channel cascades its baseline months — intentional: a channel
    // that is no longer in scope must not leave orphan numbers that Section C
    // could still cite (Rule 6).
    await tx`delete from strategi_channel where strategi_id = ${id}`;
    for (const c of channels) {
      await tx`
        insert into strategi_channel
          (strategi_id, channel, channel_lain, status_channel, nama_toko, url_toko,
           umur_toko_bulan, badge, target_tanggal_live, prasyarat_pembukaan,
           sumber_data, tanggal_ambil_data, lampiran, periode_baseline_bulan,
           periode_mulai, periode_akhir, alasan_periode_pendek, catatan_periode_pendek,
           created_by)
        values
          (${id}, ${c.channel}, ${nullIfBlank(c.channelLain)}, ${c.statusChannel},
           ${c.namaToko.trim()}, ${c.urlToko.trim()}, ${c.umurTokoBulan ?? null},
           ${nullIfBlank(c.badge)}, ${nullIfBlank(c.targetTanggalLive)},
           ${(c.prasyaratPembukaan ?? []) as never},
           ${nullIfBlank(c.sumberData)}, ${nullIfBlank(c.tanggalAmbilData)},
           ${nullIfBlank(c.lampiran)}, ${c.periodeBaselineBulan ?? null},
           ${nullIfBlank(c.periodeMulai)}, ${nullIfBlank(c.periodeAkhir)},
           ${nullIfBlank(c.alasanPeriodePendek)}, ${nullIfBlank(c.catatanPeriodePendek)},
           ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_channels',
      beforeJson: null,
      afterJson: { channels: channels.map((c) => c.channel) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

function validateChannel(c: ChannelInput): void {
  if (!CHANNELS.includes(c.channel) || !CHANNEL_STATES.includes(c.statusChannel)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if ((c.namaToko ?? '').trim() === '' || (c.urlToko ?? '').trim() === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if ((c.channel === 'Lainnya') !== ((c.channelLain ?? '').trim() !== '')) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (c.statusChannel === 'Belum Aktif') {
    // Rule 4: skipping the historical baseline does not skip the launch plan.
    if (!RE_DATE.test((c.targetTanggalLive ?? '').trim())) {
      throw new ValidationError(MSG_INCOMPLETE);
    }
    return;
  }
  // Rule 5: an existing channel arrives with numbers, a window, and a source.
  const bulan = c.periodeBaselineBulan ?? 0;
  if (!Number.isInteger(bulan) || bulan < 1 || bulan > 6) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!RE_DATE.test((c.periodeMulai ?? '').trim()) || !RE_DATE.test((c.periodeAkhir ?? '').trim())) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (
    (c.sumberData ?? '').trim() === '' ||
    !RE_DATE.test((c.tanggalAmbilData ?? '').trim()) ||
    (c.lampiran ?? '').trim() === ''
  ) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  // Rule 5a: a window below three months is allowed, but never silently.
  if (bulan < 3 && (c.alasanPeriodePendek ?? '').trim() === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
}

/**
 * B-1 / B-5 input for one channel.
 *
 * Every figure is nullable HERE and non-nullable in the row that reaches the
 * table, deliberately: Rule 5 draws the line between "blank" and "0", so the
 * wire must be able to say "blank" for the validator to reject it. A type that
 * cannot express blank would have the route coerce it to 0 — which is the exact
 * substitution Rule 5 exists to prevent.
 */
export interface BaselineInput {
  monthIndex: number;
  gmv: string | null;
  jumlahPesanan: number | null;
  persenBatal: number | null;
  adSpend: string | null;
  roas: number | null;
  acos: number | null;
}

/** A validated baseline row — blanks resolved, so the insert cannot smuggle one in. */
interface BaselineRow {
  monthIndex: number;
  gmv: string;
  jumlahPesanan: number;
  persenBatal: number;
  adSpend: string;
  roas: number;
  acos: number;
}

/**
 * saveBaseline replaces the monthly baseline of ONE channel.
 *
 * Rule 5 in one line: every figure is required, `0` is a valid answer, blank is
 * not. `undefined`/`null` therefore fails here rather than becoming a zero the
 * diagnosis in Section C would later cite as fact.
 */
export async function saveBaseline(
  sql: Sql,
  actor: Actor,
  id: string,
  channelId: number,
  months: BaselineInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    const owned = await tx<{ id: string; periode_baseline_bulan: number | null }[]>`
      select id, periode_baseline_bulan from strategi_channel
       where id = ${channelId} and strategi_id = ${id}`;
    if (owned.length === 0) {
      throw new NotFoundError(MSG_CHANNEL_NOT_FOUND);
    }
    const rows = months.map(normalizeBaseline);
    await tx`delete from strategi_baseline_bulan where channel_id = ${channelId}`;
    for (const m of rows) {
      await tx`
        insert into strategi_baseline_bulan
          (channel_id, month_index, gmv, jumlah_pesanan, persen_batal, ad_spend, roas, acos, created_by)
        values
          (${channelId}, ${m.monthIndex}, ${m.gmv}, ${m.jumlahPesanan}, ${m.persenBatal},
           ${m.adSpend}, ${m.roas}, ${m.acos}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_baseline',
      beforeJson: null,
      afterJson: { channel_id: channelId, months: months.map((m) => m.monthIndex) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

function normalizeBaseline(m: BaselineInput): BaselineRow {
  const required: unknown[] = [m.gmv, m.jumlahPesanan, m.persenBatal, m.adSpend, m.roas, m.acos];
  // Rule 5, in one condition: blank fails, `0` passes.
  if (required.some((v) => v === null || v === undefined || v === '')) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!Number.isInteger(m.monthIndex) || m.monthIndex < 1 || m.monthIndex > 6) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const row: BaselineRow = {
    monthIndex: m.monthIndex,
    gmv: String(m.gmv),
    jumlahPesanan: Number(m.jumlahPesanan),
    persenBatal: Number(m.persenBatal),
    adSpend: String(m.adSpend),
    roas: Number(m.roas),
    acos: Number(m.acos),
  };
  if (
    [row.jumlahPesanan, row.persenBatal, row.roas, row.acos, Number(row.gmv), Number(row.adSpend)].some(
      (n) => Number.isNaN(n),
    )
  ) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (Number(row.gmv) < 0 || row.jumlahPesanan < 0 || Number(row.adSpend) < 0 || row.roas < 0) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (row.persenBatal < 0 || row.persenBatal > 100 || row.acos < 0) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  return row;
}

/** D-1/D-2/D-4 input. */
export interface TargetInput {
  channel: string;
  monthIndex: number;
  metric: TargetMetric;
  nilaiFloor?: string | null;
  nilaiStretch: string;
  sumberFloor?: 'kontrak' | 'input_am' | null;
}

/**
 * saveTargets replaces the target matrix.
 *
 * Rule 7 lives in the CHECK (`stretch >= floor` for GMV), not here — a stretch
 * below the contract floor is not a message to soften, it is a row Postgres
 * refuses. What this function adds is the floor's PROVENANCE: with no Contract
 * entity in CDPS (DECISIONS O57) a floor is either pulled from a contract record
 * or typed by the AM, and a report that cannot tell the two apart would present
 * a self-set target as a contractual one.
 */
export async function saveTargets(
  sql: Sql,
  actor: Actor,
  id: string,
  targets: TargetInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const t of targets) {
      if (!TARGET_METRICS.includes(t.metric)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (!Number.isInteger(t.monthIndex) || t.monthIndex < 1 || t.monthIndex > 36) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if ((t.nilaiStretch ?? '') === '' || Number(t.nilaiStretch) < 0) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (t.metric === 'gmv') {
        if ((t.nilaiFloor ?? null) === null) {
          throw new ValidationError(MSG_INCOMPLETE);
        }
        if (Number(t.nilaiStretch) < Number(t.nilaiFloor)) {
          // Rule 7: the AM raises Sanggahan Target (D-7); they do not lower it.
          throw new ValidationError(MSG_INCOMPLETE);
        }
      }
    }
    await tx`delete from strategi_target where strategi_id = ${id}`;
    for (const t of targets) {
      const floor = t.metric === 'gmv' ? (t.nilaiFloor ?? null) : null;
      await tx`
        insert into strategi_target
          (strategi_id, channel, month_index, metric, nilai_floor, nilai_stretch, sumber_floor, created_by)
        values
          (${id}, ${t.channel}, ${t.monthIndex}, ${t.metric}, ${floor}, ${t.nilaiStretch},
           ${floor === null ? null : (t.sumberFloor ?? 'input_am')}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_targets',
      beforeJson: null,
      afterJson: { count: targets.length },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** D-8 / D-9 input. */
export interface AssumptionInput {
  kode: string;
  asumsi: string;
  pemilik: string;
  caraVerifikasi: string;
  status?: AssumptionState;
  targetTerkait?: string[];
}

/** The key shape used by D-9 mappings: `metric:channel:monthIndex`. */
export function targetKey(metric: string, channel: string, monthIndex: number): string {
  return `${metric}:${channel}:${monthIndex}`;
}

/** saveAssumptions replaces D-8, validating the D-9 mapping against real targets. */
export async function saveAssumptions(
  sql: Sql,
  actor: Actor,
  id: string,
  assumptions: AssumptionInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);

    const known = new Set(
      (
        await tx<{ metric: string; channel: string; month_index: number }[]>`
          select metric, channel, month_index from strategi_target where strategi_id = ${id}`
      ).map((t) => targetKey(t.metric, t.channel, t.month_index)),
    );

    for (const a of assumptions) {
      if (
        (a.kode ?? '').trim() === '' ||
        (a.asumsi ?? '').trim() === '' ||
        (a.pemilik ?? '').trim() === '' ||
        (a.caraVerifikasi ?? '').trim() === ''
      ) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (a.status !== undefined && !ASSUMPTION_STATES.includes(a.status)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      // D-9 is a mapping, and a mapping to nothing is decoration. A dangling
      // reference here would make the "which target do we review?" question
      // unanswerable at the exact moment the assumption breaks.
      for (const k of a.targetTerkait ?? []) {
        if (!known.has(k)) {
          throw new ValidationError(MSG_ASSUMPTION_TARGET_UNKNOWN);
        }
      }
    }

    await tx`delete from strategi_assumption where strategi_id = ${id}`;
    for (const a of assumptions) {
      await tx`
        insert into strategi_assumption
          (strategi_id, kode, asumsi, pemilik, cara_verifikasi, status, target_terkait, created_by)
        values
          (${id}, ${a.kode.trim()}, ${a.asumsi.trim()}, ${a.pemilik.trim()},
           ${a.caraVerifikasi.trim()}, ${a.status ?? 'Berlaku'},
           ${(a.targetTerkait ?? []) as never}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_assumptions',
      beforeJson: null,
      afterJson: { kode: assumptions.map((a) => a.kode) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** Section E input. */
export interface PillarInput {
  jenis: PillarKind;
  channel?: string | null;
  urutan?: number;
  sku?: string | null;
  peran?: string | null;
  aksi?: string;
  target?: string;
  hargaNormal?: string | null;
  hargaPromo?: string | null;
  floorPrice?: string | null;
  vendorId?: string | null;
  slotJam?: number | null;
  tarif?: string | null;
  targetGmvPerJam?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * savePillars replaces Section E.
 *
 * Two invariants are worth restating because they are easy to lose in a form:
 * a vendor may only hang off a `live` pillar (Rule 18 — live hours never draw
 * internal division capacity), and a floor price only means something attached
 * to a named SKU (E-4 — Brief validation compares against it per SKU).
 */
export async function savePillars(
  sql: Sql,
  actor: Actor,
  id: string,
  pillars: PillarInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const p of pillars) {
      if (!PILLAR_KINDS.includes(p.jenis)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if ((p.vendorId ?? null) !== null && p.jenis !== 'live') {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if ((p.floorPrice ?? null) !== null && (p.jenis !== 'harga' || (p.sku ?? '').trim() === '')) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (
        (p.hargaPromo ?? null) !== null &&
        (p.floorPrice ?? null) !== null &&
        Number(p.hargaPromo) < Number(p.floorPrice)
      ) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
    }
    await tx`delete from strategi_pillar where strategi_id = ${id}`;
    let i = 0;
    for (const p of pillars) {
      await tx`
        insert into strategi_pillar
          (strategi_id, jenis, channel, urutan, sku, peran, aksi, target, harga_normal,
           harga_promo, floor_price, vendor_id, slot_jam, tarif, target_gmv_per_jam,
           detail, created_by)
        values
          (${id}, ${p.jenis}, ${nullIfBlank(p.channel)}, ${p.urutan ?? i}, ${nullIfBlank(p.sku)},
           ${nullIfBlank(p.peran)}, ${(p.aksi ?? '').trim()}, ${(p.target ?? '').trim()},
           ${p.hargaNormal ?? null}, ${p.hargaPromo ?? null}, ${p.floorPrice ?? null},
           ${nullIfBlank(p.vendorId)}, ${p.slotJam ?? null}, ${p.tarif ?? null},
           ${p.targetGmvPerJam ?? null}, ${(p.detail ?? {}) as never},
           ${actor.employeeId})`;
      i += 1;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_pillars',
      beforeJson: null,
      afterJson: { jenis: pillars.map((p) => p.jenis) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** Section F input. */
export interface ResourceInput {
  jenis: ResourceKind;
  channel?: string | null;
  divisi?: string | null;
  nilai?: string | null;
  jumlah?: number | null;
  satuan?: string | null;
  sumberDana?: 'klien' | 'paket_mea' | null;
  vendorId?: string | null;
  skemaBiaya?: string | null;
  catatan?: string;
}

/** saveResources replaces Section F (the soft commitment Briefs compare against). */
export async function saveResources(
  sql: Sql,
  actor: Actor,
  id: string,
  resources: ResourceInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const r of resources) {
      if (!RESOURCE_KINDS.includes(r.jenis)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (r.jenis === 'budget_iklan' && ((r.nilai ?? null) === null || (r.sumberDana ?? null) === null)) {
        // F-1 without a funding source is unusable to Finance, who receive
        // `strategi_disetujui` precisely because of this number.
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (r.jenis === 'divisi' && (r.divisi ?? '').trim() === '') {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if ((r.vendorId ?? null) !== null && r.jenis !== 'live_vendor') {
        throw new ValidationError(MSG_INCOMPLETE);
      }
    }
    await tx`delete from strategi_resource where strategi_id = ${id}`;
    for (const r of resources) {
      await tx`
        insert into strategi_resource
          (strategi_id, jenis, channel, divisi, nilai, jumlah, satuan, sumber_dana,
           vendor_id, skema_biaya, catatan, created_by)
        values
          (${id}, ${r.jenis}, ${nullIfBlank(r.channel)}, ${nullIfBlank(r.divisi)},
           ${r.nilai ?? null}, ${r.jumlah ?? null}, ${nullIfBlank(r.satuan)},
           ${nullIfBlank(r.sumberDana)}, ${nullIfBlank(r.vendorId)},
           ${nullIfBlank(r.skemaBiaya)}, ${(r.catatan ?? '').trim()}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_resources',
      beforeJson: null,
      afterJson: { jenis: resources.map((r) => r.jenis) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** H-1 input. */
export interface RiskInput {
  risiko: string;
  dampak: RiskLevel;
  kemungkinan: RiskLevel;
  mitigasi: string;
  pic: string;
  urutan?: number;
}

/** saveRisks replaces the H-1 risk register. */
export async function saveRisks(
  sql: Sql,
  actor: Actor,
  id: string,
  risks: RiskInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const r of risks) {
      if (!RISK_LEVELS.includes(r.dampak) || !RISK_LEVELS.includes(r.kemungkinan)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (
        (r.risiko ?? '').trim() === '' ||
        (r.mitigasi ?? '').trim() === '' ||
        (r.pic ?? '').trim() === ''
      ) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
    }
    await tx`delete from strategi_risk where strategi_id = ${id}`;
    let i = 0;
    for (const r of risks) {
      await tx`
        insert into strategi_risk
          (strategi_id, risiko, dampak, kemungkinan, mitigasi, pic, urutan, created_by)
        values
          (${id}, ${r.risiko.trim()}, ${r.dampak}, ${r.kemungkinan}, ${r.mitigasi.trim()},
           ${r.pic.trim()}, ${r.urutan ?? i}, ${actor.employeeId})`;
      i += 1;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_risks',
      beforeJson: null,
      afterJson: { count: risks.length },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

// ---------------------------------------------------------------------------
// Submit gate (Rules 3, 5, 8, 9, 17 + D-8 / H-1 minimums)
// ---------------------------------------------------------------------------

/** One unmet requirement, as the form's live counter shows it (§5 step 5). */
export interface Kekurangan {
  kode: string;
  pesan: string;
}

/**
 * checkCompleteness returns everything blocking submit, rather than the first
 * failure.
 *
 * §5 step 5 asks for "a live count of unmet required fields": a gate that stops
 * at the first problem turns a hundred-field form into a hundred round-trips.
 * The rules checked here are the ones the A-03 tables can answer; the per-field
 * Section A/C requirements arrive with A-05…A-09 and extend this list.
 */
export async function checkCompleteness(sql: Queryable, id: string): Promise<Kekurangan[]> {
  const out: Kekurangan[] = [];
  const head = await loadStrategiRow(sql, id);

  // G-0 / Rule 17 — without it there are no Plan period boundaries to generate.
  if (head.tanggalMulaiSiklus === null) {
    out.push({ kode: 'G-0', pesan: MSG_CYCLE_START_REQUIRED });
  }

  const channels = await sql<
    { id: string; channel: string; status_channel: string; periode_baseline_bulan: number | null }[]
  >`select id, channel, status_channel, periode_baseline_bulan
      from strategi_channel where strategi_id = ${id}`;
  if (channels.length === 0) {
    out.push({ kode: 'B-0', pesan: MSG_NO_CHANNEL });
  }

  // Rule 5: an `Eksisting` channel must carry one baseline row per declared
  // month — a half-filled window is the shape Rule 5 exists to forbid.
  for (const c of channels) {
    if (c.status_channel !== 'Eksisting') continue;
    const want = c.periode_baseline_bulan ?? 0;
    const got = await sql<{ n: number }[]>`
      select count(*)::int as n from strategi_baseline_bulan where channel_id = ${c.id}`;
    if (got[0].n !== want || want === 0) {
      out.push({ kode: `B-1/${c.channel}`, pesan: MSG_BASELINE_INCOMPLETE });
    }
  }

  const targets = await sql<{ channel: string; month_index: number; metric: string }[]>`
    select channel, month_index, metric from strategi_target
     where strategi_id = ${id} and metric = 'gmv'`;
  for (const c of channels) {
    if (!targets.some((t) => t.channel === c.channel)) {
      out.push({ kode: `D-2/${c.channel}`, pesan: MSG_TARGET_MISSING });
    }
  }

  const assumptions = await sql<{ kode: string; target_terkait: unknown }[]>`
    select kode, target_terkait from strategi_assumption where strategi_id = ${id}`;
  if (assumptions.length < 3) {
    out.push({ kode: 'D-8', pesan: MSG_ASSUMPTION_MIN });
  }

  // Rule 8: "Every target carries an assumption." Checked against GMV targets,
  // which are the monthly stretch figures D-2 produces.
  const covered = new Set(assumptions.flatMap((a) => strArray(a.target_terkait)));
  const uncovered = targets.filter((t) => !covered.has(targetKey('gmv', t.channel, t.month_index)));
  if (uncovered.length > 0) {
    out.push({ kode: 'Rule 8', pesan: MSG_TARGET_WITHOUT_ASSUMPTION });
  }

  // Rule 9 / E-11: the anti-scope-creep record. Empty is a validation error, by
  // design — it is the answer the AM needs three months later.
  const outOfScope = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_pillar
     where strategi_id = ${id} and jenis = 'tidak_dikerjakan'`;
  if (outOfScope[0].n === 0) {
    out.push({ kode: 'E-11', pesan: MSG_OUT_OF_SCOPE_REQUIRED });
  }

  const risks = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_risk where strategi_id = ${id}`;
  if (risks[0].n < 3) {
    out.push({ kode: 'H-1', pesan: MSG_RISK_MIN });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Lifecycle (machine #15)
// ---------------------------------------------------------------------------

/**
 * submitStrategi drives `Draft`/`Draft Revisi` → `Diajukan` (§5 step 6).
 *
 * The completeness gate runs INSIDE the transaction, before the transition, so a
 * Strategi cannot reach a reviewer half-filled — and so a concurrent edit cannot
 * slip in between the check and the move.
 */
export async function submitStrategi(sql: Sql, actor: Actor, id: string): Promise<Strategi> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await requireDraftAndWriter(tx, actor, id);
    const missing = await checkCompleteness(tx, id);
    if (missing.length > 0) {
      throw new ValidationError(missing[0].pesan);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGI,
      entityType: ENTITY_STRATEGI,
      table: 'strategi',
      entityId: id,
      to: STRATEGI_DIAJUKAN,
      actor,
    });
    if (!res.ok) throw transitionError(res);
    await tx`update strategi set diajukan_pada = now() where id = ${id}`;
    await appendEvent(tx, id, head.versiNo, 'diajukan', actor.employeeId, null);
    return loadStrategiRow(tx, id);
  });
}

/**
 * approveStrategi drives `Diajukan` → `Aktif` (Rule 12) and archives the
 * predecessor version in the SAME transaction (Rule 13).
 *
 * The ordering matters: the predecessor is archived only after the new version
 * has actually moved, so a rejected transition never leaves a contract with no
 * active Strategi. `uq_strategi_aktif_per_service` would refuse the pair anyway
 * — the archive step is what makes the sequence legal, not an afterthought.
 *
 * NOTE: this does not touch the parent Service status. See the module header —
 * the Brief gate still reads the old M6 §4 entity until the form swap.
 */
export async function approveStrategi(sql: Sql, actor: Actor, id: string): Promise<Strategi> {
  if (!canApproveStrategi(actor)) {
    throw new ForbiddenError(MSG_APPROVE_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);

    // Rule 13: archive the predecessor FIRST when there is one, because the
    // partial unique index allows exactly one `Aktif` row per service and the
    // new version is about to claim it.
    if (head.versiSebelumnyaId !== null) {
      const prev = await loadStrategiRow(tx, head.versiSebelumnyaId, true);
      if (prev.status === STRATEGI_AKTIF) {
        const pres = await statemachine.transition(ex.sm, {
          machine: MACHINE_STRATEGI,
          entityType: ENTITY_STRATEGI,
          table: 'strategi',
          entityId: prev.id,
          to: STRATEGI_DIARSIPKAN,
          actor,
        });
        if (!pres.ok) throw transitionError(pres);
        await appendEvent(tx, prev.id, prev.versiNo, 'diarsipkan', actor.employeeId, null);
      }
    }

    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGI,
      entityType: ENTITY_STRATEGI,
      table: 'strategi',
      entityId: id,
      to: STRATEGI_AKTIF,
      actor,
    });
    if (!res.ok) throw transitionError(res);

    await tx`
      update strategi
         set disetujui_pada = now(), disetujui_oleh = ${actor.employeeId}, catatan_reviewer = null
       where id = ${id}`;
    await appendEvent(tx, id, head.versiNo, 'disetujui', actor.employeeId, null);
    return loadStrategiRow(tx, id);
  });
}

/**
 * returnStrategi sends a submitted Strategi back with notes (Rule 12).
 *
 * Version 1 returns to `Draft`; a revision returns to `Draft Revisi`, because
 * Rule 12 says a returned Strategi "keeps its version number" — and landing a
 * revision in `Draft` would make it look like a first draft in every list.
 */
export async function returnStrategi(
  sql: Sql,
  actor: Actor,
  id: string,
  catatan: string,
): Promise<Strategi> {
  const note = (catatan ?? '').trim();
  if (note === '') {
    throw new ValidationError(MSG_REVIEW_NOTES_REQUIRED);
  }
  if (!canApproveStrategi(actor)) {
    throw new ForbiddenError(MSG_APPROVE_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const to = head.versiNo === 1 ? STRATEGI_DRAFT : STRATEGI_DRAFT_REVISI;
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGI,
      entityType: ENTITY_STRATEGI,
      table: 'strategi',
      entityId: id,
      to,
      actor,
    });
    if (!res.ok) throw transitionError(res);
    await tx`update strategi set catatan_reviewer = ${note} where id = ${id}`;
    await appendEvent(tx, id, head.versiNo, 'dikembalikan', actor.employeeId, note);
    return loadStrategiRow(tx, id);
  });
}

/** Rule 13 (a)(b)(c) — what opening a revision must declare. */
export interface RevisionInput {
  /** (a) a trigger from the H-2 list the AM selected for this client. */
  triggerRevisi: string[];
  /** (b) free text. */
  alasanRevisi: string;
  /** (c) which D-8 assumption codes broke. */
  asumsiGugur: string[];
}

/**
 * openRevision creates version n+1 in `Draft Revisi`, copying the active
 * version's content (Rule 13).
 *
 * Version n is NOT touched here — it keeps running as `Aktif` until n+1 is
 * approved. That is the whole point of Rule 13: a contract is never left without
 * an authoritative strategy in the middle of a revision.
 */
export async function openRevision(
  sql: Sql,
  actor: Actor,
  id: string,
  input: RevisionInput,
): Promise<Strategi> {
  const alasan = (input.alasanRevisi ?? '').trim();
  const triggers = (input.triggerRevisi ?? []).map((t) => t.trim()).filter(Boolean);
  const gugur = (input.asumsiGugur ?? []).map((a) => a.trim()).filter(Boolean);
  if (triggers.length === 0 || alasan === '' || gugur.length === 0) {
    throw new ValidationError(MSG_REVISION_INCOMPLETE);
  }
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const ownerAm = await ownerAmOf(tx, head.serviceId);
    if (!canWriteStrategi(actor, ownerAm)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    if (head.status !== STRATEGI_AKTIF) {
      throw new ConflictError(MSG_REVISION_NOT_ACTIVE);
    }
    const inflight = await tx<{ id: string }[]>`
      select id from strategi
       where service_id = ${head.serviceId}
         and status in (${STRATEGI_DRAFT}, ${STRATEGI_DIAJUKAN}, ${STRATEGI_DRAFT_REVISI})`;
    if (inflight.length > 0) {
      throw new ConflictError(MSG_STRATEGI_EXISTS);
    }

    const newId = await ident.nextId(ex.ident, 'STRG', now);
    const induk = head.strategiIndukId ?? head.id;
    await tx`
      insert into strategi
        (id, service_id, client_id, versi_no, strategi_induk_id, versi_sebelumnya_id, status,
         durasi_kontrak_bulan, tanggal_mulai_kontrak, tanggal_akhir_kontrak,
         tanggal_mulai_siklus, siklus_terkunci, toleransi_over_persen, created_by)
      values
        (${newId}, ${head.serviceId}, ${head.clientId}, ${head.versiNo + 1}, ${induk}, ${head.id},
         ${STRATEGI_DRAFT_REVISI}, ${head.durasiKontrakBulan}, ${head.tanggalMulaiKontrak},
         ${head.tanggalAkhirKontrak}, ${head.tanggalMulaiSiklus}, ${head.siklusTerkunci},
         ${head.toleransiOverPersen}, ${actor.employeeId})`;

    await copyChildren(tx, head.id, newId, actor.employeeId);

    // The J-3 declaration belongs to the NEW version: it is the reason that
    // version exists, and the §9 metric counts revisions, not archives.
    await appendEvent(tx, newId, head.versiNo + 1, 'revisi_dibuka', actor.employeeId, null, {
      triggerRevisi: triggers,
      alasanRevisi: alasan,
      asumsiGugur: gugur,
    });
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: newId,
      actorEmployeeId: actor.employeeId,
      action: 'open_revision',
      beforeJson: { versi_sebelumnya: head.id, versi_no: head.versiNo },
      afterJson: {
        versi_no: head.versiNo + 1,
        trigger_revisi: triggers,
        alasan_revisi: alasan,
        asumsi_gugur: gugur,
      },
      createdBy: actor.employeeId,
    });

    return loadStrategiRow(tx, newId);
  });
}

/**
 * expireStrategi closes an active Strategi at contract end (Rule 14).
 *
 * Not scheduled here: the daily job that drives this belongs with M6B's
 * scheduled jobs (backlog B-09), which is where the WIB clock already lives.
 * This is the transition itself, callable by the job or by an AM/SPV.
 */
export async function expireStrategi(sql: Sql, actor: Actor, id: string): Promise<Strategi> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const ownerAm = await ownerAmOf(tx, head.serviceId);
    if (!canWriteStrategi(actor, ownerAm) && !canApproveStrategi(actor)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGI,
      entityType: ENTITY_STRATEGI,
      table: 'strategi',
      entityId: id,
      to: STRATEGI_KEDALUWARSA,
      actor,
    });
    if (!res.ok) throw transitionError(res);
    await appendEvent(tx, id, head.versiNo, 'kedaluwarsa', actor.employeeId, null);
    return loadStrategiRow(tx, id);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * requireDraftAndWriter is the single gate every content write passes through:
 * the row is locked, the actor must be the owning AM (or a Director), and the
 * status must be one of the two editable ones (§7 permissions).
 */
async function requireDraftAndWriter(
  tx: TransactionSql,
  actor: Actor,
  id: string,
): Promise<Strategi> {
  const head = await loadStrategiRow(tx, id, true);
  const ownerAm = await ownerAmOf(tx, head.serviceId);
  if (!canWriteStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_NOT_OWNER_AM);
  }
  if (head.status !== STRATEGI_DRAFT && head.status !== STRATEGI_DRAFT_REVISI) {
    throw new ConflictError(MSG_NOT_DRAFT);
  }
  return head;
}

/** appendEvent writes one immutable Section-J row. */
async function appendEvent(
  tx: TransactionSql,
  strategiId: string,
  versiNo: number,
  peristiwa: string,
  aktor: string,
  catatan: string | null,
  revisi?: RevisionInput,
): Promise<void> {
  await tx`
    insert into strategi_version
      (strategi_id, versi_no, peristiwa, aktor, catatan, trigger_revisi, alasan_revisi,
       asumsi_gugur, created_by)
    values
      (${strategiId}, ${versiNo}, ${peristiwa}, ${aktor}, ${catatan},
       ${(revisi?.triggerRevisi ?? []) as never},
       ${revisi?.alasanRevisi ?? null},
       ${(revisi?.asumsiGugur ?? []) as never},
       ${aktor})`;
}

/**
 * copyChildren clones an approved version's content into a fresh revision.
 *
 * Baseline months come along with their channel: a revision revisits the
 * strategy, not the history, and Rule 5a locks the baseline window at approval
 * precisely so later performance is compared against the same yardstick. (A
 * RENEWAL is the opposite case — Rule 14 clears the baseline and re-requires it
 * — and that path is not this function.)
 */
async function copyChildren(
  tx: TransactionSql,
  fromId: string,
  toId: string,
  actorId: string,
): Promise<void> {
  const channels = await tx<{ id: string }[]>`
    insert into strategi_channel
      (strategi_id, channel, channel_lain, status_channel, nama_toko, url_toko,
       umur_toko_bulan, badge, target_tanggal_live, prasyarat_pembukaan, sumber_data,
       tanggal_ambil_data, lampiran, periode_baseline_bulan, periode_mulai, periode_akhir,
       alasan_periode_pendek, catatan_periode_pendek, created_by)
    select ${toId}, channel, channel_lain, status_channel, nama_toko, url_toko,
           umur_toko_bulan, badge, target_tanggal_live, prasyarat_pembukaan, sumber_data,
           tanggal_ambil_data, lampiran, periode_baseline_bulan, periode_mulai, periode_akhir,
           alasan_periode_pendek, catatan_periode_pendek, ${actorId}
      from strategi_channel where strategi_id = ${fromId} order by id asc
    returning id`;

  const oldChannels = await tx<{ id: string }[]>`
    select id from strategi_channel where strategi_id = ${fromId} order by id asc`;
  // The two lists are ordered identically (both by id asc, and the insert above
  // preserves the SELECT order), so position i pairs old→new.
  for (let i = 0; i < oldChannels.length; i += 1) {
    await tx`
      insert into strategi_baseline_bulan
        (channel_id, month_index, gmv, jumlah_pesanan, persen_batal, ad_spend, roas, acos, created_by)
      select ${channels[i].id}, month_index, gmv, jumlah_pesanan, persen_batal, ad_spend, roas, acos, ${actorId}
        from strategi_baseline_bulan where channel_id = ${oldChannels[i].id}`;
  }

  await tx`
    insert into strategi_target
      (strategi_id, channel, month_index, metric, nilai_floor, nilai_stretch, sumber_floor, created_by)
    select ${toId}, channel, month_index, metric, nilai_floor, nilai_stretch, sumber_floor, ${actorId}
      from strategi_target where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_assumption
      (strategi_id, kode, asumsi, pemilik, cara_verifikasi, status, target_terkait, created_by)
    select ${toId}, kode, asumsi, pemilik, cara_verifikasi, status, target_terkait, ${actorId}
      from strategi_assumption where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_pillar
      (strategi_id, jenis, channel, urutan, sku, peran, aksi, target, harga_normal,
       harga_promo, floor_price, vendor_id, slot_jam, tarif, target_gmv_per_jam, detail, created_by)
    select ${toId}, jenis, channel, urutan, sku, peran, aksi, target, harga_normal,
           harga_promo, floor_price, vendor_id, slot_jam, tarif, target_gmv_per_jam, detail, ${actorId}
      from strategi_pillar where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_resource
      (strategi_id, jenis, channel, divisi, nilai, jumlah, satuan, sumber_dana, vendor_id,
       skema_biaya, catatan, created_by)
    select ${toId}, jenis, channel, divisi, nilai, jumlah, satuan, sumber_dana, vendor_id,
           skema_biaya, catatan, ${actorId}
      from strategi_resource where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_risk
      (strategi_id, risiko, dampak, kemungkinan, mitigasi, pic, urutan, created_by)
    select ${toId}, risiko, dampak, kemungkinan, mitigasi, pic, urutan, ${actorId}
      from strategi_risk where strategi_id = ${fromId}`;
}

/** transitionError maps an engine rejection to the shared error taxonomy. */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  return res.code === 'role_denied'
    ? new ForbiddenError(res.message)
    : new ConflictError(res.message);
}

function nullIfBlank(s: string | null | undefined): string | null {
  const t = (s ?? '').toString().trim();
  return t === '' ? null : t;
}
