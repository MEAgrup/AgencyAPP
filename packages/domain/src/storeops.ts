/**
 * Store Operation (M18) — baris SKU (`SKU-`), unit kerja divisi.
 *
 * PRD `docs/prd/CDPS_Module18_Store_Ops.md`. Ketokan pemilik K-4/K-5/K-6
 * (2026-09-07) + pembagian peran (2026-09-08).
 *
 * ## SATU BARIS, DUA PENULIS — dan kenapa modul ini terasa "berlapis"
 *
 * Sebuah baris SKU ditulis AM saat lahir (cakupan + target) lalu Store Operation
 * saat eksekusi dan saat evaluasi. Dindingnya ADA DI DB
 * (`trg_store_ops_skus_dinding_penulis`), bukan di sini — dan itu disengaja:
 * gerbang TS hanya berlaku untuk jalur yang memanggilnya, dan jalur kedua selalu
 * muncul belakangan (pelajaran `STR-`/`STRG-`: satu flag `false` cuma
 * membuktikan SATU pintu tertutup).
 *
 * Karena itu setiap tulisan di sini WAJIB mendeklarasikan sisinya lebih dulu
 * lewat `deklarasiPenulis(tx, …)`. Melewatkannya bukan lubang keamanan — DB akan
 * menolak seluruh UPDATE-nya — tapi ia jadi galat yang tidak bisa dibaca
 * pengguna, jadi jangan.
 *
 * ## ANGKA TURUNAN
 *
 * Nol kolom `actual_done`/durasi/keterlambatan. `actual_done`, leadtime,
 * %Ontime, % SKU Gagal Upload, % Achievement — semuanya dihitung SAAT BACA dari
 * `audit_log` + kolom yang ada (aturan rumah #3/#4, PRD §5). Tanggal yang diketik
 * bisa dimundurkan setelah tenggat lewat; stempel transisi tidak.
 *
 * ## ROLLUP
 *
 * `recomputeSkuBriefRollup` tinggal di `task.ts` bersama saudara Creative/KOL-nya
 * (lihat komentarnya di sana untuk alasan siklus import). Yang penting di sini:
 * Brief menutup ke `[In Review]` saat semua barisnya `[Terupload]` — BUKAN
 * `[Dievaluasi]` (K-6).
 */

import { bi, ident, permission, statemachine, storeops as vocab, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { recomputeSkuBriefRollup } from './task';

export type Actor = permission.Actor;

const DIVISION = 'Store Operation';
const ACCOUNT_DIVISION = 'Account';
const MACHINE = 'store_ops_sku';
const ENTITY_TYPE = 'store_ops_sku';
const PREFIX = 'SKU';

export const {
  SKU_INITIAL_STATE,
  SKU_TERMINAL_STATE,
  REQUEST_TYPES,
  JENIS_GAMBAR,
} = vocab;

export const STATE_MENUNGGU = vocab.SKU_INITIAL_STATE;
export const STATE_DIKERJAKAN = '[Dikerjakan]';
export const STATE_TERUPLOAD = '[Terupload]';
export const STATE_GAGAL_UPLOAD = '[Gagal Upload]';
export const STATE_DIEVALUASI = vocab.SKU_TERMINAL_STATE;

// ---------------------------------------------------------------------------
// Pesan BI verbatim (aturan rumah #5).
// ---------------------------------------------------------------------------

export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_SKU_NOT_FOUND = '[baris SKU tidak ditemukan]';
export const MSG_BUKAN_BRIEF_STORE_OPS = '[brief ini bukan brief Store Operation]';
export const MSG_REQUEST_TYPE_INVALID = '[jenis permintaan tidak valid]';
export const MSG_JENIS_GAMBAR_INVALID = '[jenis gambar tidak valid]';
export const MSG_TOTAL_PICTURE_INVALID = '[jumlah gambar harus lebih dari 0]';
export const MSG_TANGGAL_INVALID = '[format tanggal tidak valid]';
export const MSG_ANGKA_NEGATIF = '[angka target tidak boleh negatif]';
export const MSG_RATING_RANGE = '[rating harus di antara 0 dan 5]';
export const MSG_LINK_OUTPUT_REQUIRED = '[link hasil wajib diisi sebelum SKU ditandai terupload]';
export const MSG_CATATAN_GAGAL_REQUIRED = '[alasan gagal upload wajib diisi]';
export const MSG_DAMPAK_REQUIRED = '[CTR, CVR, dan rating sebelum & sesudah wajib diisi sebelum evaluasi ditutup]';
export const MSG_TULIS_CAKUPAN_FORBIDDEN = '[hanya Account Manager pemilik klien yang dapat mengubah cakupan dan target SKU]';
export const MSG_TULIS_HASIL_FORBIDDEN = '[hanya Store Operation yang dapat mengisi hasil dan dampak SKU]';
export const MSG_INVALID_PIC = '[PIC harus staff Store Operation yang aktif]';
export const MSG_ASSIGN_FORBIDDEN = '[hanya leader Store Operation yang dapat menunjuk PIC baris SKU]';
export const MSG_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke baris SKU ini]';
export const MSG_TARGET_BEKU = '[cakupan dan target SKU tidak dapat diubah setelah Store Operation mulai mengerjakan]';

export class ValidationError extends Error {
  constructor(message = bi.INCOMPLETE_DATA) {
    super(message);
    this.name = 'StoreOpsValidationError';
  }
}
export class ForbiddenError extends Error {
  constructor(message = MSG_VIEW_FORBIDDEN) {
    super(message);
    this.name = 'StoreOpsForbiddenError';
  }
}
export class NotFoundError extends Error {
  constructor(message = MSG_SKU_NOT_FOUND) {
    super(message);
    this.name = 'StoreOpsNotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message = bi.TRANSITION_NOT_ALLOWED) {
    super(message);
    this.name = 'StoreOpsConflictError';
  }
}

// ---------------------------------------------------------------------------
// Gerbang (PRD §9). Cermin `store_ops_skus_select`; RLS adalah kunci kedua.
// ---------------------------------------------------------------------------

/** canWriteScope: AM pemilik Brief-nya, lead Account, Director. Store Ops TIDAK. */
export function canWriteScope(actor: Actor, ownerAm: string): boolean {
  if (actor.role.director) return true;
  if (actor.role.od) return false; // OD read-only di mana pun (Fase 0 §4)
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) return true; // lead Account
  return actor.employeeId === ownerAm;
}

/** canWriteResult: staff/lead Store Operation, atau Director. AM TIDAK. */
export function canWriteResult(actor: Actor): boolean {
  if (actor.role.director) return true;
  if (actor.role.od) return false;
  return (
    actor.role.division === DIVISION &&
    (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead)
  );
}

/** canAssignPic: SIAPA yang mengerjakan tetap wewenang leader divisi (K-1). */
export function canAssignPic(actor: Actor): boolean {
  return permission.isLead(actor, DIVISION);
}

/**
 * canExecuteRow: menggerakkan satu baris. PIC-nya sendiri, atau lead divisinya;
 * baris yang belum dibagi boleh diambil staff mana pun di divisinya (model klaim,
 * sama dengan `task.canExecute`).
 */
export function canExecuteRow(actor: Actor, assignedPic: string): boolean {
  if (!canWriteResult(actor)) return false;
  if (actor.role.director) return true;
  if (assignedPic !== '') {
    return actor.employeeId === assignedPic || actor.role.level === permission.LevelLead;
  }
  return true;
}

/** canView: cermin persis `store_ops_skus_select` (PRD §9). */
export function canView(actor: Actor, r: { ownerAm: string; assignedPic: string; createdBy: string }): boolean {
  if (permission.canReadAll(actor)) return true; // OD / Director
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) return true; // lead Account
  if (actor.employeeId === r.ownerAm) return true;
  if (actor.employeeId === r.createdBy) return true;
  if (actor.role.division !== DIVISION) return false;
  if (actor.role.level === permission.LevelLead) return true;
  return actor.employeeId === r.assignedPic;
}

// ---------------------------------------------------------------------------
// Bentuk baca.
// ---------------------------------------------------------------------------

export interface SkuRow {
  id: string;
  briefId: string;
  // Kelompok 1 — cakupan + target (AM).
  namaProduk: string;
  linkSku: string | null;
  requestType: string;
  jenisGambar: string;
  totalReqPicture: number;
  expectedDone: string | null;
  targetCtr: number | null;
  targetCvr: number | null;
  targetRating: number | null;
  catatanAm: string | null;
  // Kelompok 2 — hasil + dampak (Store Operation).
  assignedPic: string | null;
  linkOutput: string | null;
  catatanOps: string | null;
  ctrSebelum: number | null;
  cvrSebelum: number | null;
  ratingSebelum: number | null;
  ctrSesudah: number | null;
  cvrSesudah: number | null;
  ratingSesudah: number | null;
  status: string;
  createdAt: Date;
  createdBy: string;
  // Turunan (aturan rumah #4) — tidak pernah disimpan.
  actualDone: string | null;
  leadtime: 'On Time' | 'Late' | null;
  pernahGagalUpload: boolean;
  achievementCtrPct: number | null;
  achievementCvrPct: number | null;
  verdict: 'achieve' | 'under target' | null;
}

interface DbRow {
  id: string;
  brief_id: string;
  nama_produk: string;
  link_sku: string | null;
  request_type: string;
  jenis_gambar: string;
  total_req_picture: number;
  expected_done: string | Date | null;
  target_ctr: string | null;
  target_cvr: string | null;
  target_rating: string | null;
  catatan_am: string | null;
  assigned_pic: string | null;
  link_output: string | null;
  catatan_ops: string | null;
  ctr_sebelum: string | null;
  cvr_sebelum: string | null;
  rating_sebelum: string | null;
  ctr_sesudah: string | null;
  cvr_sesudah: string | null;
  rating_sesudah: string | null;
  status: string;
  created_at: Date;
  created_by: string;
}

const COLS = `id, brief_id, nama_produk, link_sku, request_type, jenis_gambar,
              total_req_picture, expected_done, target_ctr, target_cvr, target_rating,
              catatan_am, assigned_pic, link_output, catatan_ops,
              ctr_sebelum, cvr_sebelum, rating_sebelum,
              ctr_sesudah, cvr_sesudah, rating_sesudah,
              status, created_at, created_by`;

function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}
function ymd(v: string | Date | null): string | null {
  if (v === null) return null;
  return typeof v === 'string' ? v.slice(0, 10) : tz.dateString(v);
}

/**
 * Satu jejak transisi baris SKU, dibaca dari `audit_log`. Ini SATU-SATUNYA
 * sumber `actual_done` dan `pernahGagalUpload` — sengaja tidak ada kolomnya.
 */
interface Jejak {
  entityId: string;
  to: string;
  at: Date;
}

async function jejakFor(sql: Queryable, ids: string[]): Promise<Jejak[]> {
  if (ids.length === 0) return [];
  const rows = await sql<{ entity_id: string; after_json: { status?: string } | null; created_at: Date }[]>`
    select entity_id, after_json, created_at
      from audit_log
     where entity_type = ${ENTITY_TYPE}
       and entity_id = any(${ids})
       and action like 'transition:%'
     order by created_at asc, id asc`;
  return rows
    .map((r) => ({ entityId: r.entity_id, to: r.after_json?.status ?? '', at: r.created_at }))
    .filter((j) => j.to !== '');
}

/**
 * toSkuRow menempelkan angka turunan pada satu baris (PRD §5).
 *
 * `actualDone` = tanggal WIB transisi PERTAMA ke `[Terupload]`. Pertama, bukan
 * terakhir: sebuah SKU yang di-upload, ditarik, lalu di-upload lagi tetap
 * pertama kali tayang pada tanggal itu — dan memakai yang terakhir akan membuat
 * setiap perbaikan terlihat seperti keterlambatan baru.
 */
function toSkuRow(r: DbRow, jejak: Jejak[]): SkuRow {
  const milik = jejak.filter((j) => j.entityId === r.id);
  const naik = milik.find((j) => j.to === STATE_TERUPLOAD);
  const actualDone = naik ? tz.dateString(naik.at) : null;
  const expectedDone = ymd(r.expected_done);
  const leadtime = actualDone === null || expectedDone === null
    ? null
    : actualDone <= expectedDone ? 'On Time' : 'Late';

  const targetCtr = num(r.target_ctr);
  const targetCvr = num(r.target_cvr);
  const ctrSesudah = num(r.ctr_sesudah);
  const cvrSesudah = num(r.cvr_sesudah);
  // Pembagian nol dirender '—' oleh pemanggil, bukan galat (aturan rumah #7):
  // di sini itu berarti `null`.
  const achievementCtrPct = targetCtr === null || targetCtr === 0 || ctrSesudah === null
    ? null : (ctrSesudah / targetCtr) * 100;
  const achievementCvrPct = targetCvr === null || targetCvr === 0 || cvrSesudah === null
    ? null : (cvrSesudah / targetCvr) * 100;
  // Verdict memakai CTR kalau ada, kalau tidak CVR — satu angka, bukan dua
  // verdict yang bisa saling membantah pada satu baris.
  const dasar = achievementCtrPct ?? achievementCvrPct;
  const verdict = dasar === null ? null : dasar >= 100 ? 'achieve' : 'under target';

  return {
    id: r.id,
    briefId: r.brief_id,
    namaProduk: r.nama_produk,
    linkSku: r.link_sku,
    requestType: r.request_type,
    jenisGambar: r.jenis_gambar,
    totalReqPicture: Number(r.total_req_picture),
    expectedDone,
    targetCtr,
    targetCvr,
    targetRating: num(r.target_rating),
    catatanAm: r.catatan_am,
    assignedPic: r.assigned_pic,
    linkOutput: r.link_output,
    catatanOps: r.catatan_ops,
    ctrSebelum: num(r.ctr_sebelum),
    cvrSebelum: num(r.cvr_sebelum),
    ratingSebelum: num(r.rating_sebelum),
    ctrSesudah,
    cvrSesudah,
    ratingSesudah: num(r.rating_sesudah),
    status: r.status,
    createdAt: r.created_at,
    createdBy: r.created_by,
    actualDone,
    leadtime,
    pernahGagalUpload: milik.some((j) => j.to === STATE_GAGAL_UPLOAD),
    achievementCtrPct,
    achievementCvrPct,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Induk Brief — dibaca lewat pintu `private.brief_owner_am` (O52).
// ---------------------------------------------------------------------------

interface BriefRef {
  id: string;
  division: string;
  ownerAm: string;
}

/**
 * briefRef membaca induk sebuah baris SKU.
 *
 * O52: AM pemiliknya datang dari `private.brief_owner_am`, BUKAN dari
 * `join services join clients`. Join itu tidak punya lengan RLS divisi eksekusi
 * dan akan mengembalikan NOL baris untuk divisi yang justru memicu pembacaan ini
 * — 404 pada halaman yang seharusnya jalan.
 */
async function briefRef(sql: Queryable, briefId: string): Promise<BriefRef> {
  const rows = await sql<{ id: string; assigned_division: string; assigned_am_id: string | null }[]>`
    select b.id, b.assigned_division, private.brief_owner_am(b.id) as assigned_am_id
      from briefs b where b.id = ${briefId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
  return { id: rows[0].id, division: rows[0].assigned_division, ownerAm: rows[0].assigned_am_id ?? '' };
}

async function lockSku(tx: Queryable, id: string): Promise<DbRow> {
  const rows = await tx.unsafe<DbRow[]>(`select ${COLS} from store_ops_skus where id = $1 for update`, [id]);
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

/**
 * deklarasiPenulis memasang penanda sisi penulis untuk transaksi ini (PRD §6).
 *
 * `is_local = true` — ia hilang saat COMMIT/ROLLBACK dan karena itu tidak pernah
 * bocor ke sesi berikutnya di pooler mode-transaksi, kekhawatiran yang sama yang
 * membuat `withClaims` memakai `SET LOCAL`. Tanpa panggilan ini, DB menolak
 * seluruh UPDATE-nya.
 */
async function deklarasiPenulis(tx: Queryable, sisi: 'am' | 'ops'): Promise<void> {
  await tx`select set_config(${vocab.SKU_WRITER_GUC}, ${sisi}, true)`;
}

// ---------------------------------------------------------------------------
// Tulis — sisi AM (cakupan + target).
// ---------------------------------------------------------------------------

export interface SkuScopeInput {
  namaProduk: string;
  linkSku?: string | null;
  requestType: string;
  jenisGambar: string;
  totalReqPicture: number;
  expectedDone?: string | null;
  targetCtr?: number | null;
  targetCvr?: number | null;
  targetRating?: number | null;
  catatanAm?: string | null;
}

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function bersihkanTanggal(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (s === '') return null;
  if (!RE_DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new ValidationError(MSG_TANGGAL_INVALID);
  }
  return s;
}

function bersihkanPersen(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v < 0) throw new ValidationError(MSG_ANGKA_NEGATIF);
  return v;
}

function bersihkanRating(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v < 0 || v > 5) throw new ValidationError(MSG_RATING_RANGE);
  return v;
}

/** Validasi seluruh cakupan. Dipanggil SEBELUM ID dicetak (aturan rumah #1). */
function validateScope(input: SkuScopeInput): Required<Omit<SkuScopeInput, 'linkSku' | 'catatanAm'>> & {
  linkSku: string | null; catatanAm: string | null;
} {
  const namaProduk = (input.namaProduk ?? '').trim();
  if (namaProduk === '') throw new ValidationError();
  if (!vocab.isRequestType((input.requestType ?? '').trim())) {
    throw new ValidationError(MSG_REQUEST_TYPE_INVALID);
  }
  if (!vocab.isJenisGambar((input.jenisGambar ?? '').trim())) {
    throw new ValidationError(MSG_JENIS_GAMBAR_INVALID);
  }
  const total = Number(input.totalReqPicture);
  if (!Number.isInteger(total) || total <= 0) throw new ValidationError(MSG_TOTAL_PICTURE_INVALID);
  const linkSku = (input.linkSku ?? '').trim();
  const catatanAm = (input.catatanAm ?? '').trim();
  return {
    namaProduk,
    linkSku: linkSku === '' ? null : linkSku,
    requestType: input.requestType.trim(),
    jenisGambar: input.jenisGambar.trim(),
    totalReqPicture: total,
    expectedDone: bersihkanTanggal(input.expectedDone),
    targetCtr: bersihkanPersen(input.targetCtr),
    targetCvr: bersihkanPersen(input.targetCvr),
    targetRating: bersihkanRating(input.targetRating),
    catatanAm: catatanAm === '' ? null : catatanAm,
  };
}

/**
 * createSku menambahkan satu baris SKU pada Brief Store Operation. Penulisnya
 * AM pemilik klien (ketokan 2026-09-08) — Store Operation tidak boleh, karena
 * SKU mana yang digarap dan sekeras apa targetnya adalah bagian dari kesepakatan
 * dengan klien.
 *
 * ID dicetak HANYA setelah validasi lolos (aturan rumah #1). Status lahir
 * `[Menunggu Eksekusi]` lewat INSERT, bukan `sm_transition` — baris baru tidak
 * punya from-state (pola `creator_bookings`).
 */
export async function createSku(sql: Sql, actor: Actor, briefId: string, input: SkuScopeInput): Promise<SkuRow> {
  const v = validateScope(input);
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const b = await briefRef(tx, briefId);
    if (b.division !== DIVISION) throw new ValidationError(MSG_BUKAN_BRIEF_STORE_OPS);
    if (!canWriteScope(actor, b.ownerAm)) throw new ForbiddenError(MSG_TULIS_CAKUPAN_FORBIDDEN);
    const ex = executors(tx);
    const id = await ident.nextId(ex.ident, PREFIX, now);
    await tx`
      insert into store_ops_skus (id, brief_id, nama_produk, link_sku, request_type, jenis_gambar,
                                  total_req_picture, expected_done, target_ctr, target_cvr,
                                  target_rating, catatan_am, status, created_by)
      values (${id}, ${briefId}, ${v.namaProduk}, ${v.linkSku}, ${v.requestType}, ${v.jenisGambar},
              ${v.totalReqPicture}, ${v.expectedDone}, ${v.targetCtr}, ${v.targetCvr},
              ${v.targetRating}, ${v.catatanAm}, ${SKU_INITIAL_STATE}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId, action: 'sku_created',
      beforeJson: null,
      afterJson: {
        brief_id: briefId, nama_produk: v.namaProduk, request_type: v.requestType,
        jenis_gambar: v.jenisGambar, total_req_picture: v.totalReqPicture,
        expected_done: v.expectedDone, target_ctr: v.targetCtr, target_cvr: v.targetCvr,
        target_rating: v.targetRating, status: SKU_INITIAL_STATE,
      },
      createdBy: actor.employeeId,
    });
    const r = await lockSku(tx, id);
    return toSkuRow(r, []);
  });
}

/**
 * updateSkuScope mengubah cakupan + target sebuah baris. Hanya selama baris itu
 * masih `[Menunggu Eksekusi]`: begitu Store Operation mulai, janji ke klien beku.
 *
 * Gerbang statusnya diperiksa DI SINI supaya pesannya bisa dibaca pengguna, dan
 * DIULANG oleh trigger DB — yang belakangan itulah dindingnya yang sebenarnya.
 */
export async function updateSkuScope(sql: Sql, actor: Actor, id: string, input: SkuScopeInput): Promise<SkuRow> {
  const v = validateScope(input);
  return withTransaction(sql, async (tx) => {
    const r = await lockSku(tx, id);
    const b = await briefRef(tx, r.brief_id);
    if (!canWriteScope(actor, b.ownerAm)) throw new ForbiddenError(MSG_TULIS_CAKUPAN_FORBIDDEN);
    if (r.status !== SKU_INITIAL_STATE) throw new ConflictError(MSG_TARGET_BEKU);
    await deklarasiPenulis(tx, 'am');
    await tx`
      update store_ops_skus
         set nama_produk = ${v.namaProduk}, link_sku = ${v.linkSku},
             request_type = ${v.requestType}, jenis_gambar = ${v.jenisGambar},
             total_req_picture = ${v.totalReqPicture}, expected_done = ${v.expectedDone},
             target_ctr = ${v.targetCtr}, target_cvr = ${v.targetCvr},
             target_rating = ${v.targetRating}, catatan_am = ${v.catatanAm}
       where id = ${id}`;
    await executors(tx).audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId, action: 'sku_scope_updated',
      beforeJson: {
        nama_produk: r.nama_produk, request_type: r.request_type, jenis_gambar: r.jenis_gambar,
        total_req_picture: r.total_req_picture, expected_done: ymd(r.expected_done),
        target_ctr: num(r.target_ctr), target_cvr: num(r.target_cvr), target_rating: num(r.target_rating),
      },
      afterJson: {
        nama_produk: v.namaProduk, request_type: v.requestType, jenis_gambar: v.jenisGambar,
        total_req_picture: v.totalReqPicture, expected_done: v.expectedDone,
        target_ctr: v.targetCtr, target_cvr: v.targetCvr, target_rating: v.targetRating,
      },
      createdBy: actor.employeeId,
    });
    return toSkuRow(await lockSku(tx, id), await jejakFor(tx, [id]));
  });
}

/**
 * validatePic mencerminkan `task.validatePicForDivision` PERSIS: aktif, divisi
 * CDPS-nya Store Operation, dan levelnya STAFF.
 *
 * Divisi dibaca lewat `role_mappings` (jabatan/divisi HRIS → divisi CDPS), bukan
 * dari `employees.divisi` langsung — kolom itu label HRIS, dan membandingkannya
 * dengan label CDPS akan menolak setiap PIC yang sah pada divisi yang namanya
 * berbeda di dua sistem. Level staff karena seorang lead menugaskan, bukan
 * ditugaskan (K-1).
 */
async function validatePic(tx: Queryable, picId: string): Promise<void> {
  const rows = await tx<{ status_aktif: number | boolean; division: string | null; level: string | null }[]>`
    select e.status_aktif, rm.division, rm.level
      from employees e
      left join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${picId}`;
  if (rows.length === 0) throw new ValidationError(MSG_INVALID_PIC);
  const r = rows[0];
  const aktif = r.status_aktif === true || r.status_aktif === 1;
  if (!aktif || r.division !== DIVISION || r.level !== permission.LevelStaff) {
    throw new ValidationError(MSG_INVALID_PIC);
  }
}

// ---------------------------------------------------------------------------
// Tulis — sisi Store Operation (hasil + dampak).
// ---------------------------------------------------------------------------

/**
 * assignPic menunjuk PIC satu baris SKU. **Leader divisi saja** (K-1: AM memilih
 * cakupan, leader memilih orang). PIC-nya wajib staff/lead Store Operation yang
 * aktif — mencerminkan `task.validatePicForDivision`.
 */
export async function assignPic(sql: Sql, actor: Actor, id: string, picId: string): Promise<void> {
  if (!canAssignPic(actor)) throw new ForbiddenError(MSG_ASSIGN_FORBIDDEN);
  const pic = (picId ?? '').trim();
  if (pic === '') throw new ValidationError();
  await withTransaction(sql, async (tx) => {
    const r = await lockSku(tx, id);
    await validatePic(tx, pic);
    await deklarasiPenulis(tx, 'ops');
    await tx`update store_ops_skus set assigned_pic = ${pic} where id = ${id}`;
    await executors(tx).audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId, action: 'sku_pic_assigned',
      beforeJson: { assigned_pic: r.assigned_pic }, afterJson: { assigned_pic: pic },
      createdBy: actor.employeeId,
    });
  });
}

/** Satu transisi baris SKU: kunci, gerbang, pin state asal, mutate, engine, rollup. */
async function edge(
  sql: Sql,
  actor: Actor,
  id: string,
  from: string,
  to: string,
  mutate?: (tx: Queryable, r: DbRow) => Promise<void>,
): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const r = await lockSku(tx, id);
    if (!canExecuteRow(actor, r.assigned_pic ?? '')) throw new ForbiddenError(MSG_TULIS_HASIL_FORBIDDEN);
    if (r.status !== from) throw new ConflictError();
    if (mutate) await mutate(tx, r);
    const res = await statemachine.transition(executors(tx).sm, {
      machine: MACHINE, entityType: ENTITY_TYPE, table: 'store_ops_skus', entityId: id, to, actor,
    });
    if (!res.ok) {
      // Pesan datang dari `sm_machines.block_message` untuk edge tak terdaftar,
      // dan dari engine untuk gerbang role — dua-duanya sudah BI dan sudah
      // dalam kurung siku, jadi diteruskan apa adanya.
      throw new ConflictError(res.message);
    }
    await recomputeSkuBriefRollup(tx, actor, r.brief_id);
    return res;
  });
}

/** mulaiKerja: `[Menunggu Eksekusi]` → `[Dikerjakan]`. */
export function mulaiKerja(sql: Sql, actor: Actor, id: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, SKU_INITIAL_STATE, STATE_DIKERJAKAN);
}

/**
 * tandaiTerupload: `[Dikerjakan]` → `[Terupload]` — **selesainya produksi** (K-6).
 * `link_output` wajib. Angka dampak TIDAK diminta di sini, dan itu bukan
 * kelalaian: memintanya berarti menahan status selesai selama ~30 hari tunggu
 * pasar dan mencemari lead time produksi divisi ini.
 */
export function tandaiTerupload(sql: Sql, actor: Actor, id: string, linkOutput: string): Promise<statemachine.TransitionResult> {
  const link = (linkOutput ?? '').trim();
  return edge(sql, actor, id, STATE_DIKERJAKAN, STATE_TERUPLOAD, async (tx, r) => {
    const dipakai = link !== '' ? link : (r.link_output ?? '').trim();
    if (dipakai === '') throw new ValidationError(MSG_LINK_OUTPUT_REQUIRED);
    await deklarasiPenulis(tx, 'ops');
    await tx`update store_ops_skus set link_output = ${dipakai} where id = ${r.id}`;
  });
}

/** tandaiGagalUpload: `[Dikerjakan]` → `[Gagal Upload]`. Alasan wajib. */
export function tandaiGagalUpload(sql: Sql, actor: Actor, id: string, catatan: string): Promise<statemachine.TransitionResult> {
  const c = (catatan ?? '').trim();
  return edge(sql, actor, id, STATE_DIKERJAKAN, STATE_GAGAL_UPLOAD, async (tx, r) => {
    if (c === '') throw new ValidationError(MSG_CATATAN_GAGAL_REQUIRED);
    await deklarasiPenulis(tx, 'ops');
    await tx`update store_ops_skus set catatan_ops = ${c} where id = ${r.id}`;
  });
}

/** ulangiKerja: `[Gagal Upload]` → `[Dikerjakan]`, pada baris yang SAMA. */
export function ulangiKerja(sql: Sql, actor: Actor, id: string): Promise<statemachine.TransitionResult> {
  return edge(sql, actor, id, STATE_GAGAL_UPLOAD, STATE_DIKERJAKAN);
}

export interface DampakInput {
  ctrSebelum: number;
  cvrSebelum: number;
  ratingSebelum: number;
  ctrSesudah: number;
  cvrSesudah: number;
  ratingSesudah: number;
}

/**
 * catatDampak: `[Terupload]` → `[Dievaluasi]` — langkah review ±30 hari kemudian.
 * Keenam angkanya WAJIB di sini (K-6: "Store Ops yang isi, WAJIB") — yang
 * dipisahkan K-6 adalah WAKTU-nya, bukan kewajibannya.
 */
export function catatDampak(sql: Sql, actor: Actor, id: string, d: DampakInput): Promise<statemachine.TransitionResult> {
  const angka = [d.ctrSebelum, d.cvrSebelum, d.ratingSebelum, d.ctrSesudah, d.cvrSesudah, d.ratingSesudah];
  return edge(sql, actor, id, STATE_TERUPLOAD, STATE_DIEVALUASI, async (tx, r) => {
    if (angka.some((v) => v === null || v === undefined || !Number.isFinite(v))) {
      throw new ValidationError(MSG_DAMPAK_REQUIRED);
    }
    const ctrSb = bersihkanPersen(d.ctrSebelum);
    const cvrSb = bersihkanPersen(d.cvrSebelum);
    const ctrSd = bersihkanPersen(d.ctrSesudah);
    const cvrSd = bersihkanPersen(d.cvrSesudah);
    const rtSb = bersihkanRating(d.ratingSebelum);
    const rtSd = bersihkanRating(d.ratingSesudah);
    await deklarasiPenulis(tx, 'ops');
    await tx`
      update store_ops_skus
         set ctr_sebelum = ${ctrSb}, cvr_sebelum = ${cvrSb}, rating_sebelum = ${rtSb},
             ctr_sesudah = ${ctrSd}, cvr_sesudah = ${cvrSd}, rating_sesudah = ${rtSd}
       where id = ${r.id}`;
  });
}

// ---------------------------------------------------------------------------
// Baca.
// ---------------------------------------------------------------------------

/** getSku membaca satu baris + angka turunannya. */
export async function getSku(sql: Queryable, actor: Actor, id: string): Promise<SkuRow> {
  const rows = await sql.unsafe<DbRow[]>(`select ${COLS} from store_ops_skus where id = $1`, [id]);
  if (rows.length === 0) throw new NotFoundError();
  const b = await briefRef(sql, rows[0].brief_id);
  if (!canView(actor, { ownerAm: b.ownerAm, assignedPic: rows[0].assigned_pic ?? '', createdBy: rows[0].created_by })) {
    throw new ForbiddenError();
  }
  return toSkuRow(rows[0], await jejakFor(sql, [id]));
}

/**
 * listByBrief mengembalikan seluruh baris SKU sebuah Brief, terurut lahir.
 *
 * Jejak audit-nya diambil SEKALI untuk semua baris, bukan per baris: Brief "7
 * SKU" akan jadi 8 query kalau tidak, dan halaman antrean memanggil ini per
 * Brief (jebakan N+1 yang sama yang membuat A-req-3 memilih satu fungsi SQL
 * ketimbang `GET /briefs/{id}/rollup` per baris).
 */
export async function listByBrief(sql: Queryable, actor: Actor, briefId: string): Promise<SkuRow[]> {
  const b = await briefRef(sql, briefId);
  const rows = await sql.unsafe<DbRow[]>(
    `select ${COLS} from store_ops_skus where brief_id = $1 order by created_at asc, id asc`, [briefId]);
  const terlihat = rows.filter((r) => canView(actor, {
    ownerAm: b.ownerAm, assignedPic: r.assigned_pic ?? '', createdBy: r.created_by,
  }));
  const jejak = await jejakFor(sql, terlihat.map((r) => r.id));
  return terlihat.map((r) => toSkuRow(r, jejak));
}

/** Ringkasan satu Brief Store Operation (PRD §5) — semuanya turunan. */
export interface BriefSkuSummary {
  briefId: string;
  total: number;
  /** Baris yang produksinya sudah selesai (`[Terupload]` atau `[Dievaluasi]`). */
  selesai: number;
  /** Baris yang sudah dievaluasi — jumlahnya sengaja DIPISAH dari `selesai`. */
  dievaluasi: number;
  /** Penyebut %Ontime: baris ber-`expected_done` yang sudah terupload. */
  dinilaiOntime: number;
  ontime: number;
  /** `null` kalau penyebutnya 0 — dirender '—', tidak pernah galat (aturan rumah #7). */
  ontimePct: number | null;
  /** Baris yang PERNAH menyentuh `[Gagal Upload]`, bukan yang sedang di sana. */
  pernahGagalUpload: number;
  gagalUploadPct: number | null;
}

/**
 * summaryByBrief menghitung angka worksheet divisi untuk satu Brief.
 *
 * `pernahGagalUpload` dibaca dari jejak, BUKAN dari status terkini: sebuah SKU
 * yang gagal lalu berhasil pada percobaan kedua tetap pernah gagal, dan membaca
 * status terkini akan melaporkan 0% untuk divisi yang gagal setiap kali dan
 * mengulang setiap kali.
 */
export async function summaryByBrief(sql: Queryable, actor: Actor, briefId: string): Promise<BriefSkuSummary> {
  const rows = await listByBrief(sql, actor, briefId);
  const total = rows.length;
  const selesai = rows.filter((r) => vocab.produksiSelesai(r.status)).length;
  const dievaluasi = rows.filter((r) => r.status === STATE_DIEVALUASI).length;
  const dinilai = rows.filter((r) => r.leadtime !== null);
  const ontime = dinilai.filter((r) => r.leadtime === 'On Time').length;
  const gagal = rows.filter((r) => r.pernahGagalUpload).length;
  return {
    briefId,
    total,
    selesai,
    dievaluasi,
    dinilaiOntime: dinilai.length,
    ontime,
    ontimePct: dinilai.length === 0 ? null : (ontime / dinilai.length) * 100,
    pernahGagalUpload: gagal,
    gagalUploadPct: total === 0 ? null : (gagal / total) * 100,
  };
}
