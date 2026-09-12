/**
 * Product Exchange — PX-M2a (Shop ID Gate & Eligibility Policy), sisi MEA
 * Agency/CDPS. Sumber: docs/prd/CDPS_ProductExchange_M1_M2.md v1.0 §4, Surat
 * Tugas PX-M2a.
 *
 * Product Exchange mempertemukan klien seller MEA Agency dengan kreator MCN
 * MEA. PRD §4 aslinya menggerbangi "SKU boleh diproses" lewat modul consent
 * (`px_consents`). Modul itu DIHAPUS oleh ketokan pemilik 2026-09-12 — consent
 * klien untuk TAP/SAP sudah otomatis tercatat di TikTok/Shopee saat campaign
 * dibuat di sana, dan CDPS tidak punya jalur untuk melihatnya. Lihat
 * `docs/DECISIONS.md` 2026-09-12 untuk entri lengkap.
 *
 * Yang menggantikannya: `client_platforms.shop_id` TERISI = toko itu punya
 * agency plan TAP/SAP = SKU-nya boleh diproses Product Exchange M3. Modul ini
 * memegang DUA hal:
 *
 *  1. **Izin mengisi Shop ID** (`canIsiShopId`) — AM pemilik klien, atau lead/
 *     Director Account. TERPISAH dari `client.canEditProfile` (Account Lead/
 *     OD/Director saja): mengisi Shop ID BUKAN koreksi identitas toko, ia
 *     pernyataan operasional ("agency plan sudah ada") yang wajar datang dari
 *     AM yang memegang kliennya sehari-hari — pola yang sama dengan
 *     `report.setTahapFokus` (satu field, gerbang sendiri, bukan menumpang
 *     gerbang profil).
 *  2. **Kebijakan kelayakan berversi** (`px_eligibility_policy`) — ambang
 *     penjualan, basis pengukuran, window, commission floor, syarat stok,
 *     cakupan platform. Director-only (`canKelolaPolicy`), preseden
 *     `adsscanner_benchmark`. Append-only: kalibrasi baru = versi baru, `aktif`
 *     TIDAK PERNAH dibalik (kontradiksi PRD Rule 9/10 sudah diputus — lihat
 *     komentar migrasi `20261008010000` dan `docs/DECISIONS.md` 2026-09-12).
 *     Pembacanya (evaluasi kelayakan SKU, Flow D PRD) BELUM ADA — lahir di
 *     PX-M2b bersama M3 (`px_sku`), yang PRD-nya sendiri melarang versi
 *     sementara.
 *
 * ⚠️ **Predikat berdiri sendiri, jangan menumpang predikat lain** (alasan
 * eksplisit di `showcase.ts:71-77`): menumpang berarti pelebaran akses terjadi
 * diam-diam; gerbang terpisah membuat pelebaran jadi tindakan yang harus
 * DITULIS seseorang.
 *
 * `px_eligibility_policy` default-deny nol policy (migrasi 20261008010000) —
 * dibaca/ditulis lewat service-role dari sini, gerbangnya di TS (pola
 * `admin.listHariLibur`/`addHariLibur`).
 */
import { permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { ACCOUNT_DIVISION, type Actor } from './account';

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5)
// ---------------------------------------------------------------------------
export const MSG_FORBIDDEN = '[anda tidak memiliki akses untuk melakukan aksi ini]';
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
export const MSG_PLATFORM_NOT_FOUND = '[toko tidak ditemukan]';
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_POLICY_NOT_FOUND = '[kebijakan kelayakan tidak ditemukan]';

/** Entity type dipakai di `audit_log` untuk peristiwa modul ini. */
export const AUDIT_ENTITY_SHOP_ID = 'client_platform';
export const AUDIT_ENTITY_POLICY = 'px_eligibility_policy';

// ---------------------------------------------------------------------------
// Errors — 4 kelas, `this.name` unik, terdaftar di apps/api/src/lib/http.ts
// STATUS_BY_ERROR_NAME (dispatch by name, bukan instanceof — lihat http.ts).
// ---------------------------------------------------------------------------

/** Bad/missing input (→ 400): `nilai`/`catatan` kosong, bentuk `nilai` bukan objek. */
export class ValidationError extends Error {
  constructor(message: string = MSG_INCOMPLETE) {
    super(message);
    this.name = 'ProductExchangeValidationError';
  }
}

/** The actor's role may not perform the requested read/action (verbatim BI, → 403). */
export class ForbiddenError extends Error {
  constructor(message: string = MSG_FORBIDDEN) {
    super(message);
    this.name = 'ProductExchangeForbiddenError';
  }
}

/** Klien/toko/versi kebijakan yang dirujuk tidak ada (verbatim BI, → 404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductExchangeNotFoundError';
  }
}

/** State yang melarang aksi ini (→ 409). Dicadangkan untuk PX-M2b. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductExchangeConflictError';
  }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * canKelolaPolicy — siapa yang boleh membaca DAN menulis
 * `px_eligibility_policy`. **Director saja**, preseden `adsscanner_benchmark`
 * ("Director-only" — bukan OD-read seperti kebanyakan bidang admin lain):
 * kalibrasi ini menggerakkan gerbang uang Product Exchange M3, bukan sekadar
 * data konfigurasi yang aman dibaca siapa pun berhak lihat semua.
 */
export function canKelolaPolicy(actor: Actor): boolean {
  return actor.role.director;
}

/**
 * canIsiShopId — siapa yang boleh mengisi/mengubah/mengosongkan
 * `client_platforms.shop_id` untuk satu toko klien.
 *
 * Lingkupnya SALINAN `showcase.canKelolaIzinPitch` / `account.canManageComplaint`:
 * lead Account (Director terbawa lewat `permission.isLead`) ATAU AM pemilik
 * klien itu sendiri. Berdiri sendiri dari `client.canEditProfile` (Account
 * Lead/OD/Director saja) karena mengisi Shop ID BUKAN koreksi identitas toko —
 * ia pernyataan operasional yang wajar datang dari AM yang memegang kliennya
 * (konteks Anty, Head of Account: AM sudah punya akses ke semua klien MEA).
 */
export function canIsiShopId(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

// ---------------------------------------------------------------------------
// Shop ID — client_platforms.shop_id
// ---------------------------------------------------------------------------

async function ownerAmOfClient(sql: Queryable, clientId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  return rows[0].assigned_am_id;
}

/**
 * isiShopId sets (or clears) the Shop ID gate value on one client platform
 * row. `shopId` empty/whitespace clears it — a legitimate state ("this store
 * is not enrolled"), not a failure, same reasoning as `report.setTahapFokus`.
 *
 * Audited before→after: "who declared this store's agency plan exists, and
 * when" has to be answerable even though `client_platforms` itself carries
 * no history (docs/DECISIONS.md 2026-09-12, "nol riwayat").
 */
export async function isiShopId(
  sql: Sql,
  actor: Actor,
  clientId: string,
  platformId: number,
  shopId: string | null,
): Promise<string | null> {
  const bersih = (shopId ?? '').trim();
  const nilai = bersih === '' ? null : bersih;

  return withTransaction(sql, async (tx) => {
    // Throws MSG_CLIENT_NOT_FOUND itself when the client does not exist.
    const ownerAm = await ownerAmOfClient(tx, clientId);
    if (!canIsiShopId(actor, ownerAm)) throw new ForbiddenError();

    const rows = await tx<{ shop_id: string | null }[]>`
      select shop_id from client_platforms
       where id = ${platformId} and client_id = ${clientId} for update`;
    if (rows.length === 0) throw new NotFoundError(MSG_PLATFORM_NOT_FOUND);
    const sebelum = rows[0].shop_id;

    await tx`update client_platforms set shop_id = ${nilai} where id = ${platformId}`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: AUDIT_ENTITY_SHOP_ID, entityId: String(platformId), actorEmployeeId: actor.employeeId,
      action: 'shop_id_diisi',
      beforeJson: { platform_id: platformId, client_id: clientId, shop_id: sebelum },
      afterJson: { platform_id: platformId, client_id: clientId, shop_id: nilai },
      createdBy: actor.employeeId,
    });
    return nilai;
  });
}

// ---------------------------------------------------------------------------
// Eligibility policy — px_eligibility_policy (append-only, `aktif` tidak
// pernah dibalik — lihat komentar migrasi 20261008010000).
// ---------------------------------------------------------------------------

/** Bentuk `nilai` versi 1 — PRD §4.5 / D-01 (ambang) / D-02 (tanpa commission floor Phase 1). */
export interface EligibilityPolicyValue {
  salesThresholdIdr: number;
  thresholdBasis: string;
  thresholdWindowDays: number;
  commissionFloorPct: number | null;
  requireStockIn: boolean;
  platforms: string[];
}

export interface EligibilityPolicy {
  versi: number;
  nilai: EligibilityPolicyValue;
  aktif: boolean;
  catatan: string | null;
  dibuatPada: Date;
  dibuatOleh: string;
}

function rowToPolicy(r: {
  versi: number;
  nilai: Record<string, unknown>;
  aktif: boolean;
  catatan: string | null;
  dibuat_pada: Date;
  dibuat_oleh: string;
}): EligibilityPolicy {
  const n = r.nilai;
  return {
    versi: r.versi,
    nilai: {
      salesThresholdIdr: Number(n.sales_threshold_idr),
      thresholdBasis: String(n.threshold_basis),
      thresholdWindowDays: Number(n.threshold_window_days),
      commissionFloorPct: n.commission_floor_pct == null ? null : Number(n.commission_floor_pct),
      requireStockIn: Boolean(n.require_stock_in),
      platforms: Array.isArray(n.platforms) ? n.platforms.map(String) : [],
    },
    aktif: r.aktif,
    catatan: r.catatan,
    dibuatPada: r.dibuat_pada,
    dibuatOleh: r.dibuat_oleh,
  };
}

/** listEligibilityPolicy — seluruh versi, terbaru dulu. Director-only. */
export async function listEligibilityPolicy(sql: Queryable, actor: Actor): Promise<EligibilityPolicy[]> {
  if (!canKelolaPolicy(actor)) throw new ForbiddenError();
  const rows = await sql<
    { versi: number; nilai: Record<string, unknown>; aktif: boolean; catatan: string | null; dibuat_pada: Date; dibuat_oleh: string }[]
  >`
    select versi, nilai, aktif, catatan, dibuat_pada, dibuat_oleh
      from px_eligibility_policy order by versi desc`;
  return rows.map(rowToPolicy);
}

/**
 * activeEligibilityPolicy — the version PX-M2b's eligibility evaluator will
 * read: the HIGHEST `versi` with `aktif = true` (never a flipped flag — see
 * module header). Not gated: this is the read PX-M2b's Flow D needs, not an
 * admin read. Returns `null` only if no version is active at all, which
 * should not happen post-seed (version 1 always ships active).
 */
export async function activeEligibilityPolicy(sql: Queryable): Promise<EligibilityPolicy | null> {
  const rows = await sql<
    { versi: number; nilai: Record<string, unknown>; aktif: boolean; catatan: string | null; dibuat_pada: Date; dibuat_oleh: string }[]
  >`
    select versi, nilai, aktif, catatan, dibuat_pada, dibuat_oleh
      from px_eligibility_policy where aktif = true order by versi desc limit 1`;
  return rows.length === 0 ? null : rowToPolicy(rows[0]);
}

/** Input for a new calibration version. `catatan` is mandatory (FE form, Surat Tugas §7c). */
export interface EligibilityPolicyInput {
  nilai: unknown;
  catatan: string;
  /** Born non-active (draft/rollback) when explicitly false. Defaults to true. */
  aktif?: boolean;
}

function validasiNilai(nilai: unknown): EligibilityPolicyValue {
  if (typeof nilai !== 'object' || nilai === null || Array.isArray(nilai)) {
    throw new ValidationError();
  }
  const n = nilai as Record<string, unknown>;
  const salesThresholdIdr = n.sales_threshold_idr;
  const thresholdBasis = n.threshold_basis;
  const thresholdWindowDays = n.threshold_window_days;
  const requireStockIn = n.require_stock_in;
  const platforms = n.platforms;
  if (typeof salesThresholdIdr !== 'number' || !Number.isFinite(salesThresholdIdr) || salesThresholdIdr < 0) {
    throw new ValidationError();
  }
  if (typeof thresholdBasis !== 'string' || thresholdBasis.trim() === '') {
    throw new ValidationError();
  }
  if (typeof thresholdWindowDays !== 'number' || !Number.isInteger(thresholdWindowDays) || thresholdWindowDays <= 0) {
    throw new ValidationError();
  }
  if (typeof requireStockIn !== 'boolean') {
    throw new ValidationError();
  }
  if (!Array.isArray(platforms) || platforms.length === 0 || !platforms.every((p) => typeof p === 'string' && p.trim() !== '')) {
    throw new ValidationError();
  }
  // commission_floor_pct: null = tanpa floor (D-02, Phase 1). Wajib ditangani
  // sebagai "tidak ada floor" oleh pembaca — BUKAN 0 — tugas pembaca (PX-M2b).
  const commissionFloorPctRaw = n.commission_floor_pct;
  if (commissionFloorPctRaw !== null && commissionFloorPctRaw !== undefined && typeof commissionFloorPctRaw !== 'number') {
    throw new ValidationError();
  }
  return {
    salesThresholdIdr,
    thresholdBasis: thresholdBasis.trim(),
    thresholdWindowDays,
    commissionFloorPct:
      commissionFloorPctRaw === null || commissionFloorPctRaw === undefined ? null : (commissionFloorPctRaw as number),
    requireStockIn,
    platforms: platforms.map((p) => String(p).trim()),
  };
}

/**
 * createEligibilityPolicy — mints the next calibration version. Director-only.
 * Append-only: never touches an existing row (no "flip old version's `aktif`
 * off" step — see module header for why the PRD's own Flow C step 3 cannot be
 * implemented as written). The new row is born `aktif` per `input.aktif`
 * (default true); `activeEligibilityPolicy` always resolves to the highest
 * `versi` that is `aktif = true`, so a version born active immediately
 * becomes "the" active one without any other row being touched.
 */
export async function createEligibilityPolicy(
  sql: Sql,
  actor: Actor,
  input: EligibilityPolicyInput,
): Promise<EligibilityPolicy> {
  if (!canKelolaPolicy(actor)) throw new ForbiddenError();
  const catatan = (input.catatan ?? '').trim();
  if (catatan === '') throw new ValidationError();
  const nilai = validasiNilai(input.nilai);
  const aktif = input.aktif ?? true;

  return withTransaction(sql, async (tx) => {
    const rows = await tx<{ versi: number }[]>`
      select coalesce(max(versi), 0) as versi from px_eligibility_policy`;
    const versiBaru = rows[0].versi + 1;
    const nilaiWire = {
      sales_threshold_idr: nilai.salesThresholdIdr,
      threshold_basis: nilai.thresholdBasis,
      threshold_window_days: nilai.thresholdWindowDays,
      commission_floor_pct: nilai.commissionFloorPct,
      require_stock_in: nilai.requireStockIn,
      platforms: nilai.platforms,
    };
    const inserted = await tx<
      { versi: number; nilai: Record<string, unknown>; aktif: boolean; catatan: string | null; dibuat_pada: Date; dibuat_oleh: string }[]
    >`
      insert into px_eligibility_policy (versi, nilai, aktif, catatan, dibuat_oleh)
      values (${versiBaru}, ${tx.json(nilaiWire)}, ${aktif}, ${catatan}, ${actor.employeeId})
      returning versi, nilai, aktif, catatan, dibuat_pada, dibuat_oleh`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: AUDIT_ENTITY_POLICY, entityId: String(versiBaru), actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { versi: versiBaru, nilai: nilaiWire, aktif, catatan },
      createdBy: actor.employeeId,
    });
    return rowToPolicy(inserted[0]);
  });
}
