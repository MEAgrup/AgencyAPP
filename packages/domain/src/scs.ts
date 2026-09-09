/**
 * SMO & Content Strategist (`SCS-`) — separuh kedua Modul 19.
 *
 * PRD `docs/prd/CDPS_Module19_Creative_Daily_Ops.md` §13. Menutup Gap B/G/I
 * dari gap analysis Leader Video, yang ditahan 2026-09-09 menunggu satu ketokan.
 *
 * ---------------------------------------------------------------------------
 * KENAPA MODUL SENDIRI, BUKAN M12 — ketokan `M19-SCS-ENGINE` opsi (b)
 * ---------------------------------------------------------------------------
 * PRD M12 §2 Rule 1 MEMBEKUKAN "Task" = Asset (M7) | Creator Booking (M9) |
 * Brief-as-task (M8), ketiganya WAJIB turunan rantai Klien → Service → Brief.
 * Baris `all client: Brief` di sheet SMO tidak punya klien sama sekali — dan
 * `PREFIXES.REQ` (`packages/core/src/ident.ts`) sudah mencatat kenapa
 * melonggarkan `client_id` ditolak sebelumnya: ia "akan membongkar gerbang
 * pembayaran M4/M5". Jadi entitas sendiri, tabel sendiri, mesin sendiri (#34),
 * dan `task.ts` (M12) TIDAK disentuh sama sekali. Pola `internaltask.ts`.
 *
 * ---------------------------------------------------------------------------
 * TAPI NOL DEFINISI KEDUA SPEED SCORE — DAN ITU BUKAN KEBETULAN
 * ---------------------------------------------------------------------------
 * Mesin #34 `scs_task` adalah SALINAN VERBATIM konfigurasi `brief_task`: nama
 * state yang SAMA, edge yang sama, gerbang `require_lead` yang sama. Itulah
 * yang membuat `task.computeMetrics()` (sudah `export`ed dan PURE) dipakai
 * ULANG di sini apa adanya — ia membaca `[In Progress]`/`[Approved]`/
 * `[Revision Requested]`/`[Blocked]`/`[Submitted]`/`[In Review]` dari
 * `audit_log`, jadi kosakata yang identik berarti rumus Speed Score, turnaround,
 * dan jumlah revisi hanya punya SATU implementasi di seluruh CDPS.
 *
 * ⚠️ Konsekuensinya, dan ini yang paling mudah dirusak: kalau seseorang
 * "merapikan" nama state di migrasi (mis. `[Selesai]` alih-alih `[Approved]`),
 * TIDAK ADA yang gagal secara mencolok — Speed Score seluruh baris SCS diam-diam
 * jadi `null` dan turnaround-nya jadi null bersamanya. Yang merah lebih dulu
 * adalah `packages/db/src/scs.registry.test.ts`, yang membandingkan HIMPUNAN
 * state dan edge kedua mesin.
 *
 * ---------------------------------------------------------------------------
 * `is_standing` ADALAH SIFAT KATEGORI, BUKAN SIFAT BARIS
 * ---------------------------------------------------------------------------
 * Kategori standing = pekerjaan yang berulang tiap hari (`Upload & Checklist`
 * qty 1 setiap hari), dihitung sebagai VOLUME dan bukan deliverable yang
 * diseri. Skema memaksa `is_standing ⇒ sla_jam IS NULL`, dan `computeMetrics`
 * mengembalikan Speed Score **"N/A"** untuk SLA null — jadi "baris standing
 * tidak di-SLA-kan" ditegakkan skema, bukan kesopanan pemakai layar admin.
 *
 * Kategori `Brief` SENGAJA `is_standing = false` (ketokan pemilik 2026-09-09:
 * *"brief SMO sebetulnya membantu team lain menyelesaikan task dari AM"*).
 * Yang membedakan Brief SMO dari Brief Strategist adalah `mendukungDivisi` pada
 * BARISNYA, bukan flag pada Kategorinya. Menandai Kategori itu standing akan
 * membuat deliverable Brief Strategist yang sungguhan HILANG SEPENUHNYA dari
 * seri deliverable — kesalahan yang lebih buruk daripada sebaliknya.
 *
 * ---------------------------------------------------------------------------
 * BARIS ber-`clientId` NULL TIDAK BOLEH IKUT KE ANGKA PER-KLIEN
 * ---------------------------------------------------------------------------
 * Baris "all client" berlaku lintas klien. Ia TIDAK punya tempat di health
 * score M13, rekap klien M6D, atau laporan Client Portal M15 — setiap query
 * per-klien di sini memfilter `client_id is not null`, dan tabelnya nol view
 * sehingga tidak ada jalan tersembunyi ke sana.
 *
 * ---------------------------------------------------------------------------
 * NOL BOBOT MODUL 14, SAMA SEPERTI `internal_tasks`
 * ---------------------------------------------------------------------------
 * KPI Profile M14 untuk peran gabungan DITUNDA dengan sengaja (PRD §5.5 +
 * ketokan 2026-09-09 "ditunda dengan sengaja"). Kalau peran itu mewarisi profil
 * "Creative" apa adanya, dua dari lima komponennya secara struktural nol
 * (Output Quantity = *Approved Assets*, dan GMV Impact melekat pada Asset —
 * penulis skrip tidak memiliki Asset): 47,5% bobot hilang, M14 Rule 6
 * meredistribusinya, dan Speed Score jadi ~54% seluruh skor seseorang. Skor
 * yang ABSEN itu jujur; skor yang SALAH dipakai di review kinerja.
 *
 * Tidak ada satu pun fungsi di berkas ini yang dipanggil `performance.ts`, dan
 * itu harus tetap begitu — dijaga tes yang memindai berkas itu.
 */

import { bi, ident, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { validateCreativeStaff } from './creative';
import {
  computeMetrics,
  STATUS_APPROVED,
  STATUS_BLOCKED,
  STATUS_IN_PROGRESS,
  STATUS_IN_REVIEW,
  STATUS_REVISION_REQ,
  STATUS_SUBMITTED,
  STATUS_TODO,
  type Transition,
} from './task';

export type Actor = permission.Actor;

const DIVISION = 'Creative';
const PREFIX = 'SCS';

/** Mesin #34, di-seed di `20260928010000_m19_scs_task_engine.sql`. */
export const MACHINE = 'scs_task';
const ENTITY_TYPE = 'scs_task';
const TABLE = 'scs_tasks';

/**
 * Kosakata state — DI-RE-EXPORT dari `task.ts`, bukan didefinisikan ulang.
 *
 * Kalau berkas ini menuliskan literalnya sendiri, dua tempat memegang string
 * yang sama dan `computeMetrics` (yang membaca versi `task.ts`) diam-diam
 * berhenti mengenali log baris SCS begitu salah satunya berubah.
 */
export const STATUSES = [
  STATUS_TODO,
  STATUS_IN_PROGRESS,
  STATUS_SUBMITTED,
  STATUS_IN_REVIEW,
  STATUS_APPROVED,
  STATUS_REVISION_REQ,
  STATUS_BLOCKED,
] as const;

export {
  STATUS_APPROVED, STATUS_BLOCKED, STATUS_IN_PROGRESS, STATUS_IN_REVIEW,
  STATUS_REVISION_REQ, STATUS_SUBMITTED, STATUS_TODO,
};

// --- Pesan BI (aturan rumah #5 — string PERSIS, di-assert ke konstanta). ---

export const MSG_DATA_TIDAK_LENGKAP = bi.INCOMPLETE_DATA;
export const MSG_TARGET_HARUS_POSITIF = '[jumlah target harus lebih dari 0]';
export const MSG_KATEGORI_TIDAK_DIKENAL = '[kategori pekerjaan tidak dikenal]';
export const MSG_KATEGORI_TIDAK_AKTIF = '[kategori pekerjaan sudah tidak aktif]';
export const MSG_KATEGORI_SUDAH_ADA = '[kode kategori sudah dipakai]';
export const MSG_STANDING_TANPA_SLA =
  '[kategori standing tidak boleh punya SLA — pekerjaan berulang tidak diukur kecepatannya]';
export const MSG_DIVISI_TIDAK_DIKENAL = '[divisi yang didukung tidak dikenal]';
export const MSG_BARIS_TIDAK_DITEMUKAN = '[baris pekerjaan tidak ditemukan]';
export const MSG_LINK_HASIL_WAJIB = '[link hasil kerja wajib diisi untuk submit]';
export const MSG_HANYA_TODO_BOLEH_DIUBAH =
  '[baris yang sudah dikerjakan tidak bisa disunting — ia membawa SLA yang dipakai menghitung Speed Score]';
export const MSG_HANYA_TODO_BOLEH_DIHAPUS =
  '[hanya baris yang belum dikerjakan bisa dihapus]';

export const MSG_KELOLA_FORBIDDEN =
  '[anda tidak memiliki akses untuk mengatur baris pekerjaan SMO & Content Strategist]';
export const MSG_KELOLA_KATEGORI_FORBIDDEN =
  '[anda tidak memiliki akses untuk mengatur kategori pekerjaan]';
export const MSG_BUKAN_PIC = '[hanya PIC baris ini yang bisa mengerjakannya]';
export const MSG_REVIEW_FORBIDDEN =
  '[hanya lead divisi yang bisa me-review baris pekerjaan ini]';
export const MSG_BACA_FORBIDDEN = '[anda tidak memiliki akses ke antrean pekerjaan ini]';

// --- Error (nama TER-KUALIFIKASI MODUL: `http.ts` mem-dispatch pada
//     `Error.name`, bukan `instanceof`). ---

export class ValidationError extends Error {
  constructor(message = MSG_DATA_TIDAK_LENGKAP) {
    super(message);
    this.name = 'ScsValidationError';
  }
}
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScsForbiddenError';
  }
}
export class NotFoundError extends Error {
  constructor(message = MSG_BARIS_TIDAK_DITEMUKAN) {
    super(message);
    this.name = 'ScsNotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message = bi.TRANSITION_NOT_ALLOWED) {
    super(message);
    this.name = 'ScsConflictError';
  }
}

// ---------------------------------------------------------------------------
// Izin (murni, tanpa DB) — cermin policy `scs_tasks_select` di migrasi
// 20260928010000. Peran `SMO & Content Strategist` duduk DI BAWAH divisi
// Creative (ketokan 2026-09-09), jadi gerbang yang sudah ada langsung berlaku:
// nol level klaim baru, nol baris `division_registry` baru.
// ---------------------------------------------------------------------------

/** Yang menyusun antrean: lead Creative (Leader Video) dan Director. */
export function canManageTask(actor: Actor): boolean {
  return permission.isLead(actor, DIVISION);
}

/** Yang mengelola taksonomi Kategori — sama, dan sengaja tidak lebih luas. */
export function canManageKategori(actor: Actor): boolean {
  return permission.isLead(actor, DIVISION);
}

/**
 * Yang MENGERJAKAN sebuah baris: PIC-nya sendiri saja.
 *
 * Sengaja BUKAN "PIC atau lead": lead yang menandai baris orang lain
 * `[In Progress]` memalsukan jangkar yang turnaround-nya diukur dari situ —
 * mode gagal yang sama dengan `internaltask.canWork`.
 */
export function canWorkTask(actor: Actor, assignedPic: string): boolean {
  return assignedPic !== '' && actor.employeeId === assignedPic;
}

/**
 * Yang me-REVIEW: lead Creative dan Director.
 *
 * Nol lengan AM di sini, berbeda dari Asset M7 (yang review-nya memang milik
 * AM). Baris SCS tidak punya induk Brief, jadi tidak ada AM yang "memiliki"
 * baris ini — dan memberi review ke AM klien mana pun akan mustahil untuk baris
 * "all client" yang justru tidak punya klien.
 */
export function canReviewTask(actor: Actor): boolean {
  return permission.isLead(actor, DIVISION);
}

/** Yang boleh MEMBACA antrean. Cermin policy RLS. */
export function canReadQueue(actor: Actor): boolean {
  return permission.canReadAll(actor)
    || permission.isLead(actor, DIVISION)
    || actor.role.division === DIVISION;
}

/** true ⇒ aktor hanya boleh melihat barisnya sendiri (staff Creative biasa). */
export function ownRowsOnly(actor: Actor): boolean {
  return !(permission.canReadAll(actor) || permission.isLead(actor, DIVISION));
}

// ---------------------------------------------------------------------------
// Read model.
// ---------------------------------------------------------------------------

export interface KategoriRow {
  kode: string;
  nama: string;
  subType: string | null;
  /** Pekerjaan berulang harian: dihitung sebagai volume, Speed Score N/A. */
  isStanding: boolean;
  /** SLA Target dalam JAM. null ⇒ Speed Score 'N/A' (bukan 0, bukan galat). */
  slaJam: number | null;
  aktif: boolean;
  urutan: number;
}

export interface ScsTaskRow {
  id: string;
  tanggal: string;                  // YYYY-MM-DD (WIB)
  kategoriKode: string;
  kategoriNama: string;
  /** Disalin dari Kategori saat baca — ia yang menentukan Speed Score N/A. */
  kategoriIsStanding: boolean;
  judul: string;
  /** null = baris "all client" (lintas klien). BUKAN data yang hilang. */
  clientId: string | null;
  clientName: string | null;
  /** Divisi yang baris ini BANTU selesaikan pekerjaannya. null = bukan dukungan. */
  mendukungDivisi: string | null;
  assignedPic: string;
  assignedPicNama: string;
  targetQty: number;
  status: string;
  linkHasil: string;
  catatan: string;
  createdBy: string;
  createdAt: Date;
}

/**
 * Angka turunan satu baris — SELURUHNYA dari `audit_log` lewat
 * `task.computeMetrics()`. Nol kolom jangkar di tabelnya (aturan rumah #3/#4).
 */
export interface ScsTaskMetrics {
  id: string;
  status: string;
  turnaroundHours: number | null;
  speedScorePct: number | null;
  /** 'N/A' untuk Kategori standing (SLA null) — bukan '0%'. */
  speedScoreDisplay: string;
  revisionCount: number;
}

/** Satu baris rekap per PIC per periode. */
export interface ScsPicSummaryRow {
  employeeId: string;
  nama: string;
  /** Baris Kategori NON-standing yang mencapai [Approved]. */
  deliverableSelesai: number;
  /** Σ target_qty baris deliverable yang [Approved]. */
  deliverableQty: number;
  /** Baris Kategori standing yang mencapai [Approved] — VOLUME, bukan deliverable. */
  standingSelesai: number;
  /** Baris yang belum terminal. */
  belumSelesai: number;
  totalBaris: number;
}

interface KategoriDbRow {
  kode: string;
  nama: string;
  sub_type: string | null;
  is_standing: boolean;
  sla_jam: number | string | null;
  aktif: boolean;
  urutan: number | string;
}

function toKategori(r: KategoriDbRow): KategoriRow {
  return {
    kode: r.kode,
    nama: r.nama,
    subType: r.sub_type,
    isStanding: r.is_standing,
    slaJam: r.sla_jam === null ? null : Number(r.sla_jam),
    aktif: r.aktif,
    urutan: Number(r.urutan),
  };
}

interface TaskDbRow {
  id: string;
  tanggal: string | Date;
  kategori_kode: string;
  kategori_nama: string | null;
  kategori_is_standing: boolean | null;
  kategori_sla_jam: number | string | null;
  judul: string;
  client_id: string | null;
  client_name: string | null;
  mendukung_divisi: string | null;
  assigned_pic: string;
  pic_nama: string | null;
  target_qty: number | string;
  status: string;
  link_hasil: string;
  catatan: string;
  created_by: string;
  created_at: Date;
}

const TASK_COLS = `
  t.id, t.tanggal, t.kategori_kode, k.nama as kategori_nama,
  k.is_standing as kategori_is_standing, k.sla_jam as kategori_sla_jam,
  t.judul, t.client_id, c.toko as client_name, t.mendukung_divisi,
  t.assigned_pic, e.nama as pic_nama, t.target_qty, t.status,
  t.link_hasil, t.catatan, t.created_by, t.created_at`;

const TASK_FROM = `
  from scs_tasks t
  join scs_kategori k on k.kode = t.kategori_kode
  left join clients c on c.id = t.client_id
  left join employees e on e.employee_id = t.assigned_pic`;

function ymd(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : tz.dateString(v);
}

function toTaskRow(r: TaskDbRow): ScsTaskRow {
  return {
    id: r.id,
    tanggal: ymd(r.tanggal),
    kategoriKode: r.kategori_kode,
    kategoriNama: r.kategori_nama ?? '',
    kategoriIsStanding: r.kategori_is_standing === true,
    judul: r.judul,
    clientId: r.client_id,
    clientName: r.client_name ?? null,
    mendukungDivisi: r.mendukung_divisi,
    assignedPic: r.assigned_pic,
    assignedPicNama: r.pic_nama ?? '',
    targetQty: Number(r.target_qty),
    status: r.status,
    linkHasil: r.link_hasil,
    catatan: r.catatan,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Input + validasi.
// ---------------------------------------------------------------------------

export interface ScsTaskInput {
  tanggal: string;
  kategoriKode: string;
  judul: string;
  /** null / '' ⇒ baris "all client". Sengaja diterima kosong. */
  clientId: string | null;
  mendukungDivisi: string | null;
  assignedPic: string;
  targetQty: number;
  catatan: string | null;
}

export interface KategoriInput {
  kode: string;
  nama: string;
  subType: string | null;
  isStanding: boolean;
  slaJam: number | null;
  aktif: boolean;
  urutan: number;
}

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

function bersih(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function validateTask(input: ScsTaskInput): ScsTaskInput {
  const tanggal = bersih(input.tanggal);
  const kategoriKode = bersih(input.kategoriKode);
  const judul = bersih(input.judul);
  const clientId = bersih(input.clientId);
  const mendukung = bersih(input.mendukungDivisi);
  const pic = bersih(input.assignedPic);
  const catatan = bersih(input.catatan);

  if (!RE_YMD.test(tanggal) || kategoriKode === '' || judul === '' || pic === '') {
    throw new ValidationError();
  }
  if (!Number.isInteger(input.targetQty) || input.targetQty <= 0) {
    throw new ValidationError(MSG_TARGET_HARUS_POSITIF);
  }
  return {
    tanggal,
    kategoriKode,
    judul,
    // '' dinormalkan ke null: baris "all client" harus punya SATU bentuk di DB,
    // bukan dua ('' dan null) yang lolos filter `is not null` secara berbeda.
    clientId: clientId === '' ? null : clientId,
    mendukungDivisi: mendukung === '' ? null : mendukung,
    assignedPic: pic,
    targetQty: input.targetQty,
    catatan: catatan === '' ? null : catatan,
  };
}

function validateKategori(input: KategoriInput): KategoriInput {
  const kode = bersih(input.kode).toUpperCase();
  const nama = bersih(input.nama);
  const subType = bersih(input.subType);
  if (kode === '' || nama === '') throw new ValidationError();
  if (!Number.isInteger(input.urutan) || input.urutan <= 0) throw new ValidationError();
  if (input.slaJam !== null && (!Number.isInteger(input.slaJam) || input.slaJam <= 0)) {
    throw new ValidationError();
  }
  // Cermin `ck_kategori_standing_tanpa_sla`, dengan pesan yang bisa dibaca:
  // sebuah Kategori standing yang di-SLA-kan akan memberi Speed Score kepada
  // pekerjaan berulang yang tidak pernah dimaksudkan untuk diukur begitu.
  if (input.isStanding && input.slaJam !== null) {
    throw new ValidationError(MSG_STANDING_TANPA_SLA);
  }
  return {
    kode, nama,
    subType: subType === '' ? null : subType,
    isStanding: input.isStanding,
    slaJam: input.slaJam,
    aktif: input.aktif,
    urutan: input.urutan,
  };
}

/**
 * Kategori harus ADA dan AKTIF saat baris dibuat. Kategori nonaktif tetap bisa
 * dibaca oleh baris historis yang menunjuknya (FK-nya nol CASCADE) — yang
 * dilarang hanya MEMBUAT baris baru di bawahnya.
 */
async function ambilKategoriAktif(tx: Queryable, kode: string): Promise<KategoriRow> {
  const rows = await tx<KategoriDbRow[]>`
    select kode, nama, sub_type, is_standing, sla_jam, aktif, urutan
      from scs_kategori where kode = ${kode}`;
  if (rows.length === 0) throw new ValidationError(MSG_KATEGORI_TIDAK_DIKENAL);
  const k = toKategori(rows[0]);
  if (!k.aktif) throw new ValidationError(MSG_KATEGORI_TIDAK_AKTIF);
  return k;
}

async function pastikanDivisiDikenal(tx: Queryable, code: string | null): Promise<void> {
  if (code === null) return;
  const rows = await tx<{ code: string }[]>`
    select code from division_registry where code = ${code} and aktif = true`;
  if (rows.length === 0) throw new ValidationError(MSG_DIVISI_TIDAK_DIKENAL);
}

// ---------------------------------------------------------------------------
// Kategori — taksonomi sebagai DATA.
//
// Sengaja BUKAN enum di migrasi: 24 Kategori di worksheet Leader adalah
// taksonomi operasional yang masih bergerak, dan mengunci namanya di CHECK
// constraint berarti satu migrasi untuk setiap koreksi. Yang di-seed hanya
// empat Kategori yang TERBUKTI di sumber; sisanya diisi lead Creative di sini.
// ---------------------------------------------------------------------------

export async function listKategori(
  sql: Queryable, actor: Actor, termasukNonaktif = false,
): Promise<KategoriRow[]> {
  if (!canReadQueue(actor)) throw new ForbiddenError(MSG_BACA_FORBIDDEN);
  const rows = termasukNonaktif
    ? await sql<KategoriDbRow[]>`
        select kode, nama, sub_type, is_standing, sla_jam, aktif, urutan
          from scs_kategori order by urutan, kode`
    : await sql<KategoriDbRow[]>`
        select kode, nama, sub_type, is_standing, sla_jam, aktif, urutan
          from scs_kategori where aktif = true order by urutan, kode`;
  return rows.map(toKategori);
}

export async function createKategori(
  sql: Sql, actor: Actor, input: KategoriInput,
): Promise<KategoriRow> {
  const v = validateKategori(input);
  if (!canManageKategori(actor)) throw new ForbiddenError(MSG_KELOLA_KATEGORI_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    const ada = await tx<{ kode: string }[]>`select kode from scs_kategori where kode = ${v.kode}`;
    if (ada.length > 0) throw new ValidationError(MSG_KATEGORI_SUDAH_ADA);
    await tx`
      insert into scs_kategori (kode, nama, sub_type, is_standing, sla_jam, aktif, urutan, created_by)
      values (${v.kode}, ${v.nama}, ${v.subType}, ${v.isStanding}, ${v.slaJam},
              ${v.aktif}, ${v.urutan}, ${actor.employeeId})`;
    await executors(tx).audit.insertAudit({
      entityType: 'scs_kategori', entityId: v.kode, actorEmployeeId: actor.employeeId,
      action: 'kategori_created', beforeJson: null,
      afterJson: {
        nama: v.nama, sub_type: v.subType, is_standing: v.isStanding,
        sla_jam: v.slaJam, aktif: v.aktif, urutan: v.urutan,
      },
      createdBy: actor.employeeId,
    });
    return v;
  });
}

/**
 * updateKategori menyunting satu baris taksonomi — termasuk menonaktifkannya
 * (`aktif = false`). SENGAJA nol jalur DELETE: baris pekerjaan historis
 * menunjuk Kategori-nya lewat FK, dan menghapusnya akan membuat riwayat tidak
 * bisa dirender (atau, dengan CASCADE, hilang).
 *
 * `isStanding` BOLEH diubah, dan itu keputusan: PRD §13 mencatat bahwa
 * penetapan awalnya perlu ditinjau ulang sesudah 2–3 bulan data nyata. Yang
 * TIDAK berubah karenanya adalah angka baris yang sudah `[Approved]` — Speed
 * Score-nya dihitung ulang dari log dengan SLA Kategori saat ini, jadi
 * memindahkan sebuah Kategori ke standing memindahkan seri-nya secara
 * konsisten alih-alih meninggalkan dua definisi.
 */
export async function updateKategori(
  sql: Sql, actor: Actor, kode: string, input: KategoriInput,
): Promise<KategoriRow> {
  const v = validateKategori({ ...input, kode });
  if (!canManageKategori(actor)) throw new ForbiddenError(MSG_KELOLA_KATEGORI_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    const rows = await tx<KategoriDbRow[]>`
      select kode, nama, sub_type, is_standing, sla_jam, aktif, urutan
        from scs_kategori where kode = ${v.kode} for update`;
    if (rows.length === 0) throw new ValidationError(MSG_KATEGORI_TIDAK_DIKENAL);
    const before = toKategori(rows[0]);
    await tx`
      update scs_kategori
         set nama = ${v.nama}, sub_type = ${v.subType}, is_standing = ${v.isStanding},
             sla_jam = ${v.slaJam}, aktif = ${v.aktif}, urutan = ${v.urutan}
       where kode = ${v.kode}`;
    await executors(tx).audit.insertAudit({
      entityType: 'scs_kategori', entityId: v.kode, actorEmployeeId: actor.employeeId,
      action: 'kategori_updated',
      beforeJson: {
        nama: before.nama, sub_type: before.subType, is_standing: before.isStanding,
        sla_jam: before.slaJam, aktif: before.aktif, urutan: before.urutan,
      },
      afterJson: {
        nama: v.nama, sub_type: v.subType, is_standing: v.isStanding,
        sla_jam: v.slaJam, aktif: v.aktif, urutan: v.urutan,
      },
      createdBy: actor.employeeId,
    });
    return v;
  });
}

// ---------------------------------------------------------------------------
// Baris pekerjaan — jalur tulis.
// ---------------------------------------------------------------------------

async function readTask(tx: Queryable, id: string): Promise<TaskDbRow> {
  const rows = await tx.unsafe<TaskDbRow[]>(
    `select ${TASK_COLS} ${TASK_FROM} where t.id = $1`, [id],
  );
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

async function lockTask(tx: Queryable, id: string): Promise<TaskDbRow> {
  const rows = await tx.unsafe<TaskDbRow[]>(
    `select ${TASK_COLS} ${TASK_FROM} where t.id = $1 for update of t`, [id],
  );
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

/** Memetakan penolakan engine ke kelas galat yang benar (403 vs 409). */
function fromEngine(res: statemachine.TransitionResult): never {
  if (res.ok) throw new ConflictError();
  throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
}

/**
 * createScsTask mencatat satu baris pekerjaan. ID di-mint HANYA sesudah
 * validasi field wajib lolos (aturan rumah #1).
 *
 * `clientId` null diterima apa adanya — itu SELURUH alasan modul ini ada.
 */
export async function createScsTask(
  sql: Sql, actor: Actor, input: ScsTaskInput, now = new Date(),
): Promise<ScsTaskRow> {
  const v = validateTask(input);
  if (!canManageTask(actor)) throw new ForbiddenError(MSG_KELOLA_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    await ambilKategoriAktif(tx, v.kategoriKode);
    await pastikanDivisiDikenal(tx, v.mendukungDivisi);
    // Gerbang PIC dipakai ULANG dari M7 (`validateCreativeStaff`), tidak
    // ditulis kedua kali: aktif + divisi Creative + level staff. Ia juga yang
    // menutup rantai HRIS — karyawan yang dinonaktifkan di HRIS berhenti bisa
    // ditugasi pada sync berikutnya.
    await validateCreativeStaff(tx, v.assignedPic);
    const ex = executors(tx);
    const id = await ident.nextId(ex.ident, PREFIX, now);
    await tx`
      insert into scs_tasks (id, tanggal, kategori_kode, judul, client_id, mendukung_divisi,
                             assigned_pic, target_qty, catatan, created_by)
      values (${id}, ${v.tanggal}::date, ${v.kategoriKode}, ${v.judul}, ${v.clientId},
              ${v.mendukungDivisi}, ${v.assignedPic}, ${v.targetQty},
              ${v.catatan ?? ''}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'scs_created', beforeJson: null,
      afterJson: {
        tanggal: v.tanggal, kategori_kode: v.kategoriKode, judul: v.judul,
        client_id: v.clientId, mendukung_divisi: v.mendukungDivisi,
        assigned_pic: v.assignedPic, target_qty: v.targetQty,
      },
      createdBy: actor.employeeId,
    });
    return toTaskRow(await readTask(tx, id));
  });
}

/**
 * updateScsTask menyunting sebuah baris — HANYA selama ia masih `[To Do]`.
 *
 * Garisnya `[To Do]`, bukan "beku sejak lahir": baris SCS diketik cepat di awal
 * hari dan salah ketik nyata (Kategori keliru, PIC keliru) harus bisa
 * diperbaiki sebelum ada satu pun jejak pengerjaan. Sesudah `[In Progress]`,
 * log-nya sudah punya jangkarnya — dan memindahkan Kategori sesudah itu
 * memindahkan SLA yang dipakai menghitung Speed Score baris yang sedang
 * dinilai. Ditegakkan DUA kali: pesan BI di sini, trigger `scs_tasks_beku()` di
 * DB untuk jalur tulis mana pun yang melewatinya.
 */
export async function updateScsTask(
  sql: Sql, actor: Actor, id: string, input: ScsTaskInput,
): Promise<ScsTaskRow> {
  const v = validateTask(input);
  if (!canManageTask(actor)) throw new ForbiddenError(MSG_KELOLA_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    const before = await lockTask(tx, id);
    if (before.status !== STATUS_TODO) {
      throw new ConflictError(MSG_HANYA_TODO_BOLEH_DIUBAH);
    }
    await ambilKategoriAktif(tx, v.kategoriKode);
    await pastikanDivisiDikenal(tx, v.mendukungDivisi);
    await validateCreativeStaff(tx, v.assignedPic);
    await tx`
      update scs_tasks
         set tanggal = ${v.tanggal}::date, kategori_kode = ${v.kategoriKode},
             judul = ${v.judul}, client_id = ${v.clientId},
             mendukung_divisi = ${v.mendukungDivisi}, assigned_pic = ${v.assignedPic},
             target_qty = ${v.targetQty}, catatan = ${v.catatan ?? ''}
       where id = ${id}`;
    await executors(tx).audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'scs_updated',
      beforeJson: {
        tanggal: ymd(before.tanggal), kategori_kode: before.kategori_kode,
        judul: before.judul, client_id: before.client_id,
        mendukung_divisi: before.mendukung_divisi, assigned_pic: before.assigned_pic,
        target_qty: Number(before.target_qty),
      },
      afterJson: {
        tanggal: v.tanggal, kategori_kode: v.kategoriKode, judul: v.judul,
        client_id: v.clientId, mendukung_divisi: v.mendukungDivisi,
        assigned_pic: v.assignedPic, target_qty: v.targetQty,
      },
      createdBy: actor.employeeId,
    });
    return toTaskRow(await readTask(tx, id));
  });
}

/**
 * deleteScsTask mencabut baris yang salah catat — HANYA `[To Do]`.
 *
 * Ini pengganti edge pembatalan yang mesin #34 SENGAJA tidak punya:
 * `brief_task` membatalkan lewat `[Cancelled — Service Voided]`, dan baris SCS
 * tidak punya Service sehingga sebab itu tak pernah terjadi. Nama state
 * pembatalan baru tidak dikarang di sini — ia butuh ketokan pemilik lebih dulu
 * (sikap yang sama diambil mesin #21 terhadap edge "buka kembali").
 *
 * Batas `[To Do]` ditegakkan DUA kali: di sini, dan oleh trigger
 * `scs_tasks_hapus_hanya_todo()`. Tanpa batas itu, "hapus lalu catat ulang"
 * adalah cara termudah menghapus revisi dan keterlambatan dari catatan performa.
 */
export async function deleteScsTask(sql: Sql, actor: Actor, id: string): Promise<void> {
  if (!canManageTask(actor)) throw new ForbiddenError(MSG_KELOLA_FORBIDDEN);
  await withTransaction(sql, async (tx) => {
    const before = await lockTask(tx, id);
    if (before.status !== STATUS_TODO) {
      throw new ConflictError(MSG_HANYA_TODO_BOLEH_DIHAPUS);
    }
    // Audit LEBIH DULU: baris audit menunjuk `entity_id` yang sebentar lagi
    // tidak ada di `scs_tasks`, dan itu memang bentuk yang benar — riwayat
    // append-only tidak boleh ikut hilang bersama barisnya (aturan rumah #3).
    await executors(tx).audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'scs_deleted',
      beforeJson: {
        tanggal: ymd(before.tanggal), kategori_kode: before.kategori_kode,
        judul: before.judul, assigned_pic: before.assigned_pic,
        target_qty: Number(before.target_qty), status: before.status,
      },
      afterJson: null,
      createdBy: actor.employeeId,
    });
    await tx`delete from scs_tasks where id = ${id}`;
  });
}

// ---------------------------------------------------------------------------
// Transisi — SEMUANYA lewat `sm_transition` (nol `update ... set status`).
// ---------------------------------------------------------------------------

async function drive(
  sql: Sql, actor: Actor, id: string, to: string,
  gate: (t: TaskDbRow) => void,
  siapkan?: (tx: Queryable, t: TaskDbRow) => Promise<void>,
): Promise<ScsTaskRow> {
  return withTransaction(sql, async (tx) => {
    const t = await lockTask(tx, id);
    gate(t);
    if (siapkan) await siapkan(tx, t);
    const res = await statemachine.transition(executors(tx).sm, {
      machine: MACHINE, entityType: ENTITY_TYPE, table: TABLE, entityId: id, to, actor,
    });
    if (!res.ok) fromEngine(res);
    // Baca ULANG: statusnya harus datang dari yang DB benar-benar pegang,
    // bukan dari nilai yang kita harap sudah tertulis.
    return toTaskRow(await readTask(tx, id));
  });
}

/** `[To Do]` → `[In Progress]`. PIC-nya sendiri saja — jangkar turnaround. */
export function startScsTask(sql: Sql, actor: Actor, id: string): Promise<ScsTaskRow> {
  return drive(sql, actor, id, STATUS_IN_PROGRESS, (t) => {
    if (!canWorkTask(actor, t.assigned_pic)) throw new ForbiddenError(MSG_BUKAN_PIC);
  });
}

/**
 * `[In Progress]` → `[Submitted]`, dengan link hasil WAJIB.
 *
 * Wajib untuk alasan yang sama M7 mewajibkan `output_link` pada Asset submit:
 * "selesai" tanpa apa pun yang terlampir adalah klaim, bukan deliverable.
 * Ditegakkan dua kali (`ck_scs_submit_butuh_link` di DB).
 */
// `async`, dan itu bukan kosmetik: sebuah `function` biasa yang melempar
// SEBELUM `return drive(...)` melempar SECARA SINKRON, sehingga pemanggil yang
// menulis `await expect(submit(...)).rejects` tidak pernah menerima promise dan
// galatnya lolos ke luar. Route handler-nya akan sama pecahnya.
export async function submitScsTask(
  sql: Sql, actor: Actor, id: string, linkHasil: string,
): Promise<ScsTaskRow> {
  const link = bersih(linkHasil);
  if (link === '') throw new ValidationError(MSG_LINK_HASIL_WAJIB);
  return drive(
    sql, actor, id, STATUS_SUBMITTED,
    (t) => {
      if (!canWorkTask(actor, t.assigned_pic)) throw new ForbiddenError(MSG_BUKAN_PIC);
    },
    async (tx) => {
      // Link ditulis SEBELUM transisi, transaksi yang sama, supaya CHECK
      // non-deferrable melihat keduanya (pola `internal_tasks` / interview).
      await tx`update scs_tasks set link_hasil = ${link} where id = ${id}`;
    },
  );
}

/** `[Submitted]` → `[In Review]`. Lead membuka review. */
export function openReviewScsTask(sql: Sql, actor: Actor, id: string): Promise<ScsTaskRow> {
  return drive(sql, actor, id, STATUS_IN_REVIEW, () => {
    if (!canReviewTask(actor)) throw new ForbiddenError(MSG_REVIEW_FORBIDDEN);
  });
}

/** `[In Review]` → `[Approved]` (terminal). */
export function approveScsTask(sql: Sql, actor: Actor, id: string): Promise<ScsTaskRow> {
  return drive(sql, actor, id, STATUS_APPROVED, () => {
    if (!canReviewTask(actor)) throw new ForbiddenError(MSG_REVIEW_FORBIDDEN);
  });
}

/**
 * `[Submitted]` | `[In Review]` → `[Revision Requested]`.
 *
 * Dua sumber dengan sengaja, cermin `brief_task` sesudah B4: lead bisa
 * memantulkan sebelum review dibuka (QC), dan bisa memantulkan sesudahnya.
 * `computeMetrics` menghitung SETIAP kedatangan di state ini sebagai satu
 * revisi, jadi kedua jalur terhitung sama.
 */
export function requestRevisionScsTask(sql: Sql, actor: Actor, id: string): Promise<ScsTaskRow> {
  return drive(sql, actor, id, STATUS_REVISION_REQ, () => {
    if (!canReviewTask(actor)) throw new ForbiddenError(MSG_REVIEW_FORBIDDEN);
  });
}

/** `[Revision Requested]` → `[In Progress]`. PIC mengerjakan ulang. */
export function resumeScsTask(sql: Sql, actor: Actor, id: string): Promise<ScsTaskRow> {
  return drive(sql, actor, id, STATUS_IN_PROGRESS, (t) => {
    if (!canWorkTask(actor, t.assigned_pic)) throw new ForbiddenError(MSG_BUKAN_PIC);
  });
}

/**
 * `[In Progress]` ↔ `[Blocked]`, lead saja (`require_lead` di kedua edge).
 *
 * Kenapa lead: waktu di `[Blocked]` DIKURANGKAN dari turnaround oleh
 * `computeMetrics`. Kalau PIC bisa memblokir barisnya sendiri, ia bisa
 * memotong sendiri angka yang menilainya — gerbang yang sama dengan M12 §5.3a.
 */
export function blockScsTask(sql: Sql, actor: Actor, id: string): Promise<ScsTaskRow> {
  return drive(sql, actor, id, STATUS_BLOCKED, () => {
    if (!canReviewTask(actor)) throw new ForbiddenError(MSG_REVIEW_FORBIDDEN);
  });
}

/** `[Blocked]` → `[In Progress]`, lead saja. */
export function unblockScsTask(sql: Sql, actor: Actor, id: string): Promise<ScsTaskRow> {
  return drive(sql, actor, id, STATUS_IN_PROGRESS, () => {
    if (!canReviewTask(actor)) throw new ForbiddenError(MSG_REVIEW_FORBIDDEN);
  });
}

// ---------------------------------------------------------------------------
// Jalur baca.
// ---------------------------------------------------------------------------

function pastikanBolehLihat(actor: Actor, r: TaskDbRow): void {
  if (!canReadQueue(actor)) throw new ForbiddenError(MSG_BACA_FORBIDDEN);
  if (ownRowsOnly(actor) && r.assigned_pic !== actor.employeeId && r.created_by !== actor.employeeId) {
    throw new ForbiddenError(MSG_BACA_FORBIDDEN);
  }
}

export async function getScsTask(sql: Queryable, actor: Actor, id: string): Promise<ScsTaskRow> {
  const r = await readTask(sql, id);
  pastikanBolehLihat(actor, r);
  return toTaskRow(r);
}

export interface QueueFilter {
  /** Jendela tanggal, inklusif dua ujung (pola rentang M19). */
  dariTanggal: string;
  sampaiTanggal: string;
  /** null ⇒ seluruh PIC yang boleh dilihat aktor. */
  pic: string | null;
  /** null ⇒ seluruh Kategori. */
  kategoriKode: string | null;
  /** null ⇒ seluruh status. */
  status: string | null;
}

/**
 * queueScsTasks — antrean peran gabungan (Gap B).
 *
 * Staff Creative biasa dipersempit ke barisnya sendiri di SQL, bukan hanya
 * mengandalkan RLS: koneksi domain adalah service-role (BYPASSRLS), jadi tanpa
 * penyempitan ini tes domain akan hijau untuk query yang lewat API justru
 * kosong. Dua kunci, bukan satu.
 */
export async function queueScsTasks(
  sql: Queryable, actor: Actor, filter: QueueFilter,
): Promise<ScsTaskRow[]> {
  if (!canReadQueue(actor)) throw new ForbiddenError(MSG_BACA_FORBIDDEN);
  const dari = bersih(filter.dariTanggal);
  const sampai = bersih(filter.sampaiTanggal);
  if (!RE_YMD.test(dari) || !RE_YMD.test(sampai)) throw new ValidationError();
  const picFilter = ownRowsOnly(actor) ? actor.employeeId : bersih(filter.pic) || null;
  const rows = await sql.unsafe<TaskDbRow[]>(
    `select ${TASK_COLS} ${TASK_FROM}
      where t.tanggal between $1::date and $2::date
        and ($3::text is null or t.assigned_pic = $3::text)
        and ($4::text is null or t.kategori_kode = $4::text)
        and ($5::text is null or t.status = $5::text)
      order by t.tanggal desc, k.urutan, t.id`,
    [dari, sampai, picFilter, bersih(filter.kategoriKode) || null, bersih(filter.status) || null],
  );
  return rows.map(toTaskRow);
}

/**
 * scsTaskMetrics — angka turunan satu baris, dihitung ULANG dari `audit_log`.
 *
 * Ia MEMANGGIL `task.computeMetrics()`; nol rumus di berkas ini. SLA-nya datang
 * dari Kategori baris itu, jadi Kategori standing (`sla_jam` NULL) memberi
 * `speedScoreDisplay = 'N/A'` — bukan 0%, yang akan terbaca sebagai pernyataan
 * tentang kecepatan seseorang atas pekerjaan yang tidak pernah di-SLA-kan.
 */
export async function scsTaskMetrics(
  sql: Queryable, actor: Actor, id: string,
): Promise<ScsTaskMetrics> {
  const r = await readTask(sql, id);
  pastikanBolehLihat(actor, r);
  const sla = r.kategori_sla_jam === null ? null : Number(r.kategori_sla_jam);
  const entries = await sql<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log
     where entity_type = ${ENTITY_TYPE} and entity_id = ${id} order by id asc`;
  const evs: Transition[] = [];
  for (const e of entries) {
    const to = targetTransisi(e.action);
    if (to !== null) evs.push({ to, at: e.created_at });
  }
  const m = computeMetrics(evs, sla);
  return {
    id,
    status: r.status,
    turnaroundHours: m.turnaroundHours,
    speedScorePct: m.speedScorePct,
    speedScoreDisplay: m.speedScoreDisplay,
    revisionCount: m.revisionCount,
  };
}

/**
 * Baris audit transisi berbunyi `transition:<from>-><to>`; kita hanya butuh
 * tujuannya. Bentuk yang sama dibaca `task.ts` — sengaja tidak di-export dari
 * sana, karena satu helper tiga baris yang di-export akan membuat `task.ts`
 * seolah punya API untuk modul lain.
 */
function targetTransisi(action: string): string | null {
  const awalan = 'transition:';
  if (!action.startsWith(awalan)) return null;
  const i = action.indexOf('->', awalan.length);
  return i < 0 ? null : action.slice(i + 2);
}

/**
 * scsPicSummary — rekap per PIC untuk satu periode.
 *
 * Kategori standing dan non-standing dipisah DI SINI, dan itu inti Gap G:
 * menjumlahkan keduanya memberi satu angka "produktivitas" yang naik hanya
 * karena seseorang mencatat pekerjaan harian yang selalu ada. Yang standing
 * dihitung sebagai VOLUME, yang non-standing sebagai DELIVERABLE.
 *
 * ⚠️ Angka ini TIDAK masuk Modul 14 dan tidak punya bobot KPI — sama seperti
 * penyelesaian hari-sama (D5) dan `internal_tasks`. Layar yang menampilkannya
 * wajib menyatakannya.
 */
export async function scsPicSummary(
  sql: Queryable, actor: Actor, dariTanggal: string, sampaiTanggal: string,
): Promise<ScsPicSummaryRow[]> {
  if (!canReadQueue(actor)) throw new ForbiddenError(MSG_BACA_FORBIDDEN);
  const dari = bersih(dariTanggal);
  const sampai = bersih(sampaiTanggal);
  if (!RE_YMD.test(dari) || !RE_YMD.test(sampai)) throw new ValidationError();
  const picFilter = ownRowsOnly(actor) ? actor.employeeId : null;
  const rows = await sql.unsafe<{
    employee_id: string; nama: string | null;
    deliverable_selesai: string; deliverable_qty: string | null;
    standing_selesai: string; belum_selesai: string; total_baris: string;
  }[]>(
    `select t.assigned_pic as employee_id, e.nama,
            count(*) filter (where t.status = $3 and not k.is_standing)::text as deliverable_selesai,
            coalesce(sum(t.target_qty) filter (where t.status = $3 and not k.is_standing), 0)::text as deliverable_qty,
            count(*) filter (where t.status = $3 and k.is_standing)::text as standing_selesai,
            count(*) filter (where t.status <> $3)::text as belum_selesai,
            count(*)::text as total_baris
       from scs_tasks t
       join scs_kategori k on k.kode = t.kategori_kode
       left join employees e on e.employee_id = t.assigned_pic
      where t.tanggal between $1::date and $2::date
        and ($4::text is null or t.assigned_pic = $4::text)
      group by t.assigned_pic, e.nama
      order by e.nama nulls last, t.assigned_pic`,
    [dari, sampai, STATUS_APPROVED, picFilter],
  );
  return rows.map((r) => ({
    employeeId: r.employee_id,
    nama: r.nama ?? '',
    deliverableSelesai: Number(r.deliverable_selesai),
    deliverableQty: Number(r.deliverable_qty ?? 0),
    standingSelesai: Number(r.standing_selesai),
    belumSelesai: Number(r.belum_selesai),
    totalBaris: Number(r.total_baris),
  }));
}
