/**
 * Module 6A §7 / D19 — the `VND-` Vendor entity.
 *
 * CDPS had no vendor record at all before this. Module 6A needs one for exactly
 * two places, and both are consequences of D15 ("Live Stream is vendor mode,
 * same as MSDPS — no internal host assignment"):
 *
 *   - **E-8**, the live-stream pillar, which stores `vendor_id`, booked slots,
 *     rate and target GMV per hour;
 *   - **F-4**, the resource commitment, which books hours to that vendor and —
 *     per Rule 18 — must NOT draw them from internal division capacity (F-5).
 *
 * So this module is deliberately not a vendor-management system. There is no
 * rating, no invoice, no contract lifecycle. A vendor needs to be selectable,
 * bookable, and retirable without erasing the Strategi rows that already point
 * at it — which is why `status` moves rather than rows being deleted.
 *
 * **Status goes through `sm_transition`, like every other lifecycle in CDPS**
 * (CLAUDE.md #2). The `vendor` machine is registered in the migration, not here;
 * this module never writes the status column directly. `Blacklist` is
 * deliberately not terminal: a mistaken blacklist must be reversible through the
 * engine (`Blacklist → Nonaktif → Aktif`), because the alternative is a raw
 * UPDATE, which is the one thing the house rule forbids.
 *
 * **Who may write.** A vendor is a shared master record — the same class as the
 * Master Service List — so one AM must not be able to blacklist a vendor another
 * AM has booked. Writes are Account lead / Head of Account / Director. Reads are
 * open to every authenticated employee, because the E-8 picker is useless to an
 * AM who cannot see the list.
 *
 * Reference: docs/prd/CDPS_Module6A_Strategi.md §7 ("New prerequisite entity").
 */

import { ident, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';

// ---------------------------------------------------------------------------
// Vocabulary (M6A §7 table). Exported so routes and tests name the same values
// the CHECK constraints do.
// ---------------------------------------------------------------------------

/** `jenis_layanan` — extensible per §7; `lainnya` is the deliberate escape. */
export const VENDOR_SERVICES = ['live_stream', 'produksi_video', 'talent', 'lainnya'] as const;
export type VendorService = (typeof VENDOR_SERVICES)[number];

/** `skema_biaya` — enum + rate (§7 "enum + struct"). */
export const VENDOR_FEE_SCHEMES = ['per_jam', 'per_sesi', 'bagi_hasil', 'retainer'] as const;
export type VendorFeeScheme = (typeof VENDOR_FEE_SCHEMES)[number];

export const VENDOR_STATUS_AKTIF = 'Aktif';
export const VENDOR_STATUS_NONAKTIF = 'Nonaktif';
export const VENDOR_STATUS_BLACKLIST = 'Blacklist';
export const VENDOR_STATUSES = [
  VENDOR_STATUS_AKTIF,
  VENDOR_STATUS_NONAKTIF,
  VENDOR_STATUS_BLACKLIST,
] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

const MACHINE_VENDOR = 'vendor';

// --- BI messages. M6A's body text is English and gives no error strings, so
// these follow the house convention (CLAUDE.md #5) and the M6C precedent. ---

/** The vendor id does not resolve. */
export const MSG_VENDOR_NOT_FOUND = '[vendor tidak ditemukan]';
/** Actor is not Account lead / Head of Account / Director. */
export const MSG_VENDOR_FORBIDDEN = '[anda tidak memiliki akses untuk mengelola data vendor]';
/** Mandatory fields missing — the house default (CLAUDE.md #5). */
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
/** `jenis_layanan` outside the enum. */
export const MSG_INVALID_SERVICE = '[jenis layanan vendor tidak valid]';
/** `skema_biaya` outside the enum. */
export const MSG_INVALID_SCHEME = '[skema biaya vendor tidak valid]';
/** A `bagi_hasil` vendor priced in rupiah, or the reverse. */
export const MSG_RATE_MISMATCH =
  '[skema bagi hasil diisi persentase, skema lain diisi tarif rupiah]';
/** Percentage outside 0 < p <= 100. */
export const MSG_INVALID_PERCENT = '[persentase bagi hasil harus di antara 0 dan 100]';
/** Negative money. */
export const MSG_NEGATIVE_RATE = '[tarif vendor tidak boleh negatif]';
/** Another vendor already carries this name (case-insensitive). */
export const MSG_VENDOR_EXISTS = '[vendor dengan nama ini sudah terdaftar]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One attached document (contract / agreement with the vendor, §7 `dokumen`). */
export interface VendorDocument {
  nama: string;
  url: string;
}

/** A vendor record. */
export interface Vendor {
  id: string;
  namaVendor: string;
  jenisLayanan: VendorService;
  status: VendorStatus;
  picNama: string;
  picKontak: string;
  skemaBiaya: VendorFeeScheme;
  /** Rupiah rate for per_jam / per_sesi / retainer; null for bagi_hasil. */
  tarif: string | null;
  /** Revenue-share percentage for bagi_hasil; null otherwise. */
  bagiHasilPersen: number | null;
  /** §7: internal only. Never leaves through the client view (Rule 16). */
  catatanKinerja: string;
  dokumen: VendorDocument[];
  createdBy: string;
  createdAt: string;
}

/** The write payload (create and update share it — §7 has eight fields). */
export interface VendorInput {
  namaVendor: string;
  jenisLayanan: VendorService;
  picNama: string;
  picKontak: string;
  skemaBiaya: VendorFeeScheme;
  tarif?: string | null;
  bagiHasilPersen?: number | null;
  catatanKinerja?: string;
  dokumen?: VendorDocument[];
}

interface VendorRow {
  id: string;
  nama_vendor: string;
  jenis_layanan: string;
  status: string;
  pic_nama: string;
  pic_kontak: string;
  skema_biaya: string;
  tarif: string | null;
  bagi_hasil_persen: string | null;
  catatan_kinerja: string;
  dokumen: unknown;
  created_by: string;
  created_at: string | Date;
}

function rowToVendor(r: VendorRow): Vendor {
  return {
    id: r.id,
    namaVendor: r.nama_vendor,
    jenisLayanan: r.jenis_layanan as VendorService,
    status: r.status as VendorStatus,
    picNama: r.pic_nama,
    picKontak: r.pic_kontak,
    skemaBiaya: r.skema_biaya as VendorFeeScheme,
    tarif: r.tarif,
    bagiHasilPersen: r.bagi_hasil_persen === null ? null : Number(r.bagi_hasil_persen),
    catatanKinerja: r.catatan_kinerja,
    dokumen: documentsFromDb(r.dokumen),
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/**
 * The jsonb column stores snake_case-free objects (`nama`/`url` are the same in
 * both cases), but it is still parsed rather than cast: a jsonb column is
 * whatever the last writer put there, and a malformed entry should degrade to an
 * empty list rather than crash the E-8 picker for every AM.
 */
function documentsFromDb(v: unknown): VendorDocument[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    .map((d) => ({ nama: String(d.nama ?? ''), url: String(d.url ?? '') }))
    .filter((d) => d.url !== '');
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

/**
 * canManageVendor: Account lead / Head of Account, or a Director.
 *
 * `permission.isLead(actor, 'Account')` already grants Directors lead authority
 * everywhere (the same helper `canApproveStrategy` uses), so the two arms are
 * not redundant — the explicit director check documents the intent for readers
 * who do not know that.
 */
export function canManageVendor(actor: Actor): boolean {
  return actor.role.director || permission.isLead(actor, ACCOUNT_DIVISION);
}

// ---------------------------------------------------------------------------
// Validation — the TS half of the DB CHECKs. Both exist on purpose: the CHECK
// is the wall, this is the BI message that names the field (CLAUDE.md #5).
// ---------------------------------------------------------------------------

/** normalizeVendorInput trims, validates, and returns the canonical payload. */
export function normalizeVendorInput(input: VendorInput): Required<
  Omit<VendorInput, 'tarif' | 'bagiHasilPersen'>
> & { tarif: string | null; bagiHasilPersen: number | null } {
  const nama = (input.namaVendor ?? '').trim();
  const picNama = (input.picNama ?? '').trim();
  const picKontak = (input.picKontak ?? '').trim();
  if (nama === '' || picNama === '' || picKontak === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!VENDOR_SERVICES.includes(input.jenisLayanan)) {
    throw new ValidationError(MSG_INVALID_SERVICE);
  }
  if (!VENDOR_FEE_SCHEMES.includes(input.skemaBiaya)) {
    throw new ValidationError(MSG_INVALID_SCHEME);
  }

  const tarif = input.tarif === undefined || input.tarif === null ? null : String(input.tarif).trim();
  const persen = input.bagiHasilPersen ?? null;

  // The pairing rule, restated once here so the message can name it: a
  // revenue-share vendor priced in rupiah is not a typo the DB should absorb —
  // it is a number that will be read as money on the F-4 screen.
  if (input.skemaBiaya === 'bagi_hasil') {
    if (persen === null || tarif !== null) {
      throw new ValidationError(MSG_RATE_MISMATCH);
    }
    if (!(persen > 0 && persen <= 100)) {
      throw new ValidationError(MSG_INVALID_PERCENT);
    }
  } else {
    if (tarif === null || tarif === '' || persen !== null) {
      throw new ValidationError(MSG_RATE_MISMATCH);
    }
    if (Number(tarif) < 0 || Number.isNaN(Number(tarif))) {
      throw new ValidationError(MSG_NEGATIVE_RATE);
    }
  }

  return {
    namaVendor: nama,
    jenisLayanan: input.jenisLayanan,
    picNama,
    picKontak,
    skemaBiaya: input.skemaBiaya,
    tarif,
    bagiHasilPersen: persen,
    catatanKinerja: (input.catatanKinerja ?? '').trim(),
    dokumen: (input.dokumen ?? []).filter((d) => (d?.url ?? '').trim() !== ''),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** getVendor reads one vendor. Readable by any authenticated employee (§7). */
export async function getVendor(sql: Queryable, id: string): Promise<Vendor> {
  const rows = await sql<VendorRow[]>`select * from vendors where id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_VENDOR_NOT_FOUND);
  }
  return rowToVendor(rows[0]);
}

/** Filters for the E-8 / F-4 picker. */
export interface VendorFilter {
  /** Restrict to one service type — the live-stream picker passes `live_stream`. */
  jenisLayanan?: VendorService | null;
  /**
   * Default false: the picker must not offer a blacklisted vendor. Set true for
   * the admin list, where seeing the retired ones is the point.
   */
  includeInactive?: boolean;
}

/**
 * listVendors returns vendors ordered by name.
 *
 * The default excludes `Nonaktif`/`Blacklist` because the primary caller is a
 * picker: offering a blacklisted vendor and then rejecting the choice later is a
 * worse experience than not offering it, and Strategi rows that already point at
 * a retired vendor still read fine (they resolve by id, not through this list).
 */
export async function listVendors(sql: Queryable, filter: VendorFilter = {}): Promise<Vendor[]> {
  const jenis = filter.jenisLayanan ?? null;
  const includeInactive = filter.includeInactive === true;
  const rows = await sql<VendorRow[]>`
    select * from vendors
     where (${jenis}::text is null or jenis_layanan = ${jenis})
       and (${includeInactive} or status = ${VENDOR_STATUS_AKTIF})
     order by nama_vendor asc`;
  return rows.map(rowToVendor);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * createVendor mints a `VND-` record. Account lead / Director only.
 *
 * The ID is allocated only after validation passes (CLAUDE.md #1) and inside the
 * same transaction as the insert, so a rejected insert consumes no sequence
 * number.
 */
export async function createVendor(sql: Sql, actor: Actor, input: VendorInput): Promise<Vendor> {
  if (!canManageVendor(actor)) {
    throw new ForbiddenError(MSG_VENDOR_FORBIDDEN);
  }
  const v = normalizeVendorInput(input);
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const dupe = await tx<{ id: string }[]>`
      select id from vendors where lower(btrim(nama_vendor)) = ${v.namaVendor.toLowerCase()}`;
    if (dupe.length > 0) {
      // The unique index is the real guarantee; this exists so the AM sees a BI
      // message instead of a Postgres constraint name.
      throw new ConflictError(MSG_VENDOR_EXISTS);
    }

    const id = await ident.nextId(ex.ident, 'VND', now);
    await tx`
      insert into vendors
        (id, nama_vendor, jenis_layanan, status, pic_nama, pic_kontak, skema_biaya,
         tarif, bagi_hasil_persen, catatan_kinerja, dokumen, created_by)
      values
        (${id}, ${v.namaVendor}, ${v.jenisLayanan}, ${VENDOR_STATUS_AKTIF}, ${v.picNama},
         ${v.picKontak}, ${v.skemaBiaya}, ${v.tarif}, ${v.bagiHasilPersen},
         ${v.catatanKinerja}, ${v.dokumen as never}, ${actor.employeeId})`;

    await ex.audit.insertAudit({
      entityType: 'vendor',
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: {
        nama_vendor: v.namaVendor,
        jenis_layanan: v.jenisLayanan,
        skema_biaya: v.skemaBiaya,
        status: VENDOR_STATUS_AKTIF,
      },
      createdBy: actor.employeeId,
    });

    return getVendor(tx, id);
  });
}

/**
 * updateVendor edits the eight §7 fields. Status is NOT among them — it moves
 * only through `setVendorStatus` (CLAUDE.md #2).
 */
export async function updateVendor(
  sql: Sql,
  actor: Actor,
  id: string,
  input: VendorInput,
): Promise<Vendor> {
  if (!canManageVendor(actor)) {
    throw new ForbiddenError(MSG_VENDOR_FORBIDDEN);
  }
  const v = normalizeVendorInput(input);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const before = await lockVendor(tx, id);
    const dupe = await tx<{ id: string }[]>`
      select id from vendors
       where lower(btrim(nama_vendor)) = ${v.namaVendor.toLowerCase()} and id <> ${id}`;
    if (dupe.length > 0) {
      throw new ConflictError(MSG_VENDOR_EXISTS);
    }

    await tx`
      update vendors
         set nama_vendor = ${v.namaVendor}, jenis_layanan = ${v.jenisLayanan},
             pic_nama = ${v.picNama}, pic_kontak = ${v.picKontak},
             skema_biaya = ${v.skemaBiaya}, tarif = ${v.tarif},
             bagi_hasil_persen = ${v.bagiHasilPersen},
             catatan_kinerja = ${v.catatanKinerja},
             dokumen = ${v.dokumen as never}
       where id = ${id}`;

    await ex.audit.insertAudit({
      entityType: 'vendor',
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'update',
      beforeJson: {
        nama_vendor: before.namaVendor,
        jenis_layanan: before.jenisLayanan,
        skema_biaya: before.skemaBiaya,
        tarif: before.tarif,
        bagi_hasil_persen: before.bagiHasilPersen,
      },
      afterJson: {
        nama_vendor: v.namaVendor,
        jenis_layanan: v.jenisLayanan,
        skema_biaya: v.skemaBiaya,
        tarif: v.tarif,
        bagi_hasil_persen: v.bagiHasilPersen,
      },
      createdBy: actor.employeeId,
    });

    return getVendor(tx, id);
  });
}

/**
 * setVendorStatus drives the `vendor` machine.
 *
 * Nothing here writes the status column — `sm_transition` does, inside the same
 * transaction, together with its own audit row. The role gate lives in the SQL
 * function too (`require_lead` on every edge), so a direct service-role call
 * cannot slip past it either; the check below only turns the engine's rejection
 * into the taxonomy the routes already map to HTTP codes.
 */
export async function setVendorStatus(
  sql: Sql,
  actor: Actor,
  id: string,
  to: VendorStatus,
): Promise<Vendor> {
  if (!canManageVendor(actor)) {
    throw new ForbiddenError(MSG_VENDOR_FORBIDDEN);
  }
  if (!VENDOR_STATUSES.includes(to)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await lockVendor(tx, id);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_VENDOR,
      entityType: 'vendor',
      table: 'vendors',
      entityId: id,
      to,
      actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied'
        ? new ForbiddenError(res.message)
        : new ConflictError(res.message);
    }
    return getVendor(tx, id);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** lockVendor selects FOR UPDATE so concurrent edits serialise on the row. */
async function lockVendor(sql: Queryable, id: string): Promise<Vendor> {
  const rows = await sql<VendorRow[]>`select * from vendors where id = ${id} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_VENDOR_NOT_FOUND);
  }
  return rowToVendor(rows[0]);
}
