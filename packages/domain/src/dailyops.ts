/**
 * Creative Daily Ops (M19) — slot produksi harian (`SLOT-`), ketidaktersediaan
 * PIC, dan angka penyelesaian hari-sama.
 *
 * PRD `docs/prd/CDPS_Module19_Creative_Daily_Ops.md`. Ketokan pemilik
 * 2026-09-09 (D1/D3/D4/D5/D8) — realisasi `docs/DECISIONS.md` K-1 (2026-09-07),
 * yang menyisihkan "jadwal harian leader" sebagai wave sendiri.
 *
 * ## MODUL INI MEMPERINGATKAN, IA TIDAK MENGGERBANG
 *
 * Dua pemeriksaan intinya — studio bertumpang dan PIC tidak tersedia — **selalu
 * menyimpan** dan mengembalikan `peringatan` (D3/D4). Itu bukan kelalaian
 * validasi, itu keputusan pemilik: Leader menerima tumpang-tindih dengan sadar
 * ("dua shoot berbagi sudut ruangan yang sama"), dan sistem yang memblokirnya
 * akan dilewati dengan mencatat jadwal di luar sistem — persis keadaan yang
 * modul ini ada untuk mengakhiri.
 *
 * Konsekuensi untuk tes: sebuah tes yang meng-assert 4xx pada dua tempat itu
 * sedang menguji perilaku yang SALAH, dan ia akan hijau. Yang benar: baris
 * tersimpan, `peringatan` berisi pesannya.
 *
 * Yang tetap MENOLAK: field wajib kosong, `target_qty <= 0`, dan
 * `actual_qty > target_qty`. Ketiganya bukan penilaian manusia, ketiganya
 * omong kosong aritmetik.
 *
 * ## NOL MESIN STATUS, DAN ITU KEPUTUSAN
 *
 * `PROD-SLOT` adalah catatan RENCANA (Rule 1/D1). Ia tidak punya
 * `sm_machines`, tidak punya SLA, tidak punya Speed Score. Eksekusi dan review
 * tetap milik Asset/Task (M7/M12) lewat mesin `brief_task`. Kalau modul ini
 * mendapat mesin sendiri, CDPS punya dua engine lifecycle berdampingan — dan
 * yang kedua akan menjawab pertanyaan yang sama dengan cara yang berbeda.
 *
 * Karena itu juga: nol `statemachine.transition` di berkas ini.
 *
 * ## NOL ANGKA TURUNAN YANG DISIMPAN
 *
 * Sisa (`target − actual`), penyelesaian hari-sama, dan slot fill dihitung SAAT
 * BACA (aturan rumah #4, PRD §5.5). Pembagian nol dirender `null` ⇒ FE
 * menampilkan '—' (aturan rumah #7). Denominator "hari kerja" memakai
 * `working_days_between()` yang sudah ada di DB — bukan hitungan Sen–Jum kedua
 * di TS.
 *
 * ## ANGKA DI SINI TIDAK PERNAH SAMPAI KE MODUL 14
 *
 * D5: penyelesaian hari-sama adalah angka OPERASIONAL Leader, bukan KPI. Ia
 * mengukur hal yang berbeda dari Speed Score M12 (SLA multi-hari), dan
 * mencampurnya berarti satu angka yang mengukur dua hal — yaitu angka yang
 * tidak mengukur apa pun. Tidak ada satu pun fungsi di berkas ini yang dipanggil
 * `performance.ts`, dan itu harus tetap begitu.
 */

import { bi, dailyops as vocab, ident, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { validateCreativeStaff } from './creative';

export type Actor = permission.Actor;

const DIVISION = 'Creative';
const ENTITY_TYPE = 'prod_slot';
const PREFIX = 'SLOT';

export const { TASK_TYPES, ALASAN_TIDAK_TERSEDIA, STUDIOS } = vocab;

// --- Pesan BI (aturan rumah #5 — string PERSIS dari PRD §5.7). ---

/** Default: field wajib kosong. */
export const MSG_DATA_TIDAK_LENGKAP = bi.INCOMPLETE_DATA;
export const MSG_TARGET_HARUS_POSITIF = '[jumlah target harus lebih dari 0]';
export const MSG_AKTUAL_MELEBIHI_TARGET = '[jumlah aktual tidak boleh melebihi target]';
export const MSG_SLOT_TIDAK_DITEMUKAN = '[slot tidak ditemukan]';
export const MSG_STUDIO_TIDAK_DIKENAL = '[studio tidak dikenal]';
export const MSG_JENIS_TASK_TIDAK_DIKENAL = '[jenis pekerjaan tidak dikenal]';
export const MSG_RENTANG_WAKTU_TIDAK_VALID = '[waktu selesai harus setelah waktu mulai]';
export const MSG_RENTANG_TANGGAL_TIDAK_VALID = '[tanggal selesai tidak boleh sebelum tanggal mulai]';
export const MSG_ALASAN_TIDAK_DIKENAL = '[alasan tidak tersedia tidak dikenal]';
export const MSG_CATATAN_TIDAK_DITEMUKAN = '[catatan ketidaktersediaan tidak ditemukan]';

export const MSG_KELOLA_SLOT_FORBIDDEN =
  '[anda tidak memiliki akses untuk mengatur jadwal produksi]';
export const MSG_ISI_AKTUAL_FORBIDDEN =
  '[hanya PIC slot ini atau lead divisi yang bisa mengisi jumlah aktual]';
export const MSG_TULIS_KETERSEDIAAN_FORBIDDEN =
  '[hanya lead divisi yang bisa mencatat ketidaktersediaan PIC]';
export const MSG_BACA_JADWAL_FORBIDDEN = '[anda tidak memiliki akses ke jadwal produksi ini]';

/**
 * PERINGATAN (bukan galat) — dikembalikan bersama baris yang TETAP tersimpan.
 * `studioTerpakai` menyisipkan nama studio sungguhan, sesuai PRD §5.7.
 */
export const WARN_PIC_TIDAK_TERSEDIA = '[PIC tidak tersedia pada tanggal ini]';
export function studioTerpakai(studioCode: string): string {
  return `[studio ${vocab.studioNama(studioCode)} sudah dipakai pada rentang waktu ini]`;
}

// --- Error (nama TER-KUALIFIKASI MODUL: `http.ts` mem-dispatch pada
//     `Error.name`, bukan `instanceof`, supaya lambda-nya tidak menarik seluruh
//     barrel `@cdps/domain`). ---

export class ValidationError extends Error {
  constructor(message = MSG_DATA_TIDAK_LENGKAP) {
    super(message);
    this.name = 'DailyOpsValidationError';
  }
}
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyOpsForbiddenError';
  }
}
export class NotFoundError extends Error {
  constructor(message = MSG_SLOT_TIDAK_DITEMUKAN) {
    super(message);
    this.name = 'DailyOpsNotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message = bi.TRANSITION_NOT_ALLOWED) {
    super(message);
    this.name = 'DailyOpsConflictError';
  }
}

// ---------------------------------------------------------------------------
// Izin (murni, tanpa DB) — cermin policy RLS di migrasi 20260927010000.
// ---------------------------------------------------------------------------

/**
 * Siapa yang menyusun jadwal. Lead Creative (Leader Video) dan Director.
 *
 * Gap H: yang secara nyata MEMBANGUN jadwal videografer besok adalah Content
 * Creator ("Bikin Jadwal VG buat Hari besok"), dan D7 mengetoknya sebagai satu
 * peran. Hari ini ia belum punya identitas terpisah di `role_mappings` (yang
 * hanya `staff`|`lead`) dan pemilik mengetok peran-peran itu duduk DI BAWAH
 * divisi Creative — jadi haknya menumpang `lead` Creative untuk sekarang.
 * Bukan penyederhanaan diam-diam: mengangkat Content Creator jadi identitas
 * yang bisa digerbangi adalah bagian dari `M19-SCS-ENGINE` (DECISIONS §Open).
 */
export function canManageSlot(actor: Actor): boolean {
  return permission.isLead(actor, DIVISION);
}

/** Yang menutup slot: PIC-nya sendiri, atau lead divisi (PRD §5.6). */
export function canEnterActual(actor: Actor, assignedPic: string): boolean {
  if (permission.isLead(actor, DIVISION)) return true;
  return assignedPic !== '' && actor.employeeId === assignedPic;
}

/** D4 — Leader yang mencatat ketidaktersediaan, BUKAN self-service PIC. */
export function canWriteUnavailability(actor: Actor): boolean {
  return permission.isLead(actor, DIVISION);
}

/**
 * Siapa yang boleh MEMBACA jadwal. OD/Director di mana pun (OD read-only lewat
 * `canWrite`), lead divisi se-divisi, staff Creative untuk barisnya sendiri.
 *
 * `ownPicOnly` true berarti pemanggil harus mempersempit hasil ke
 * `assigned_pic = actor.employeeId` — RLS sudah melakukannya, ini supaya
 * lapisan baca tidak mengirim query yang pasti kosong dan supaya FE tahu
 * apakah picker PIC boleh muncul.
 */
export function canReadSchedule(actor: Actor): boolean {
  return permission.canReadAll(actor)
    || permission.isLead(actor, DIVISION)
    || actor.role.division === DIVISION;
}

/** true ⇒ aktor hanya boleh melihat barisnya sendiri (staff Creative biasa). */
export function ownRowsOnly(actor: Actor): boolean {
  return !(permission.canReadAll(actor) || permission.isLead(actor, DIVISION));
}

// ---------------------------------------------------------------------------
// Read model (camelCase) + baris DB (snake_case).
// ---------------------------------------------------------------------------

export interface SlotRow {
  id: string;
  tanggal: string;                  // YYYY-MM-DD (WIB)
  clientId: string;
  clientName: string;
  studioCode: string;
  studioNama: string;
  waktuMulai: string;               // HH:MM
  waktuSelesai: string;             // HH:MM
  assignedPic: string;
  assignedPicNama: string;
  jenisPaket: string | null;
  taskType: string;
  targetQty: number;
  /** null = slot belum ditutup, BUKAN nol. */
  actualQty: number | null;
  /** target − actual; null selama slot belum ditutup. Turunan. */
  sisaQty: number | null;
  /** actual ÷ target × 100, 2 desimal. null ⇒ FE render '—' (aturan rumah #7). */
  penyelesaianPct: number | null;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
}

/** Hasil sebuah tulisan yang BISA memperingatkan tapi tetap tersimpan. */
export interface SlotSaveResult {
  slot: SlotRow;
  /**
   * Pesan BI yang harus ditampilkan, SELALU ada sebagai array (kosong kalau
   * bersih — kunci yang HILANG lebih berbahaya daripada kosong, kelas O43).
   */
  peringatan: string[];
}

export interface UnavailabilityRow {
  id: number;
  employeeId: string;
  employeeNama: string;
  tanggalMulai: string;             // YYYY-MM-DD
  tanggalSelesai: string;           // YYYY-MM-DD
  alasan: string;
  catatan: string | null;
  dicatatOleh: string;
  createdAt: Date;
}

/** Satu hari jadwal, ter-grup per studio — bentuk yang dirender grid. */
export interface DaySchedule {
  tanggal: string;
  /** SELALU seluruh studio aktif, termasuk yang nol slot (kolom grid kosong). */
  studios: StudioColumn[];
  /** PIC yang tidak tersedia hari itu — dilihat Leader SAAT merencanakan. */
  tidakTersedia: UnavailabilityRow[];
  /** Σ target seluruh slot hari itu. */
  totalTarget: number;
  /** Σ actual slot yang sudah ditutup. */
  totalActual: number;
}

export interface StudioColumn {
  code: string;
  nama: string;
  cekKonflik: boolean;
  slots: SlotRow[];
}

/** Satu baris dashboard Leader (D5) — per PIC, satu periode. */
export interface PicSameDayRow {
  employeeId: string;
  nama: string;
  jumlahSlot: number;
  slotDitutup: number;
  totalTarget: number;
  totalActual: number;
  /** Σactual ÷ Σtarget × 100. null kalau Σtarget nol ⇒ '—'. */
  penyelesaianPct: number | null;
  /** slotDitutup ÷ jumlahSlot × 100. null kalau nol slot ⇒ '—'. */
  slotFillPct: number | null;
}

interface SlotDbRow {
  id: string;
  tanggal: string | Date;
  client_id: string;
  client_name: string | null;
  studio_code: string;
  waktu_mulai: string;
  waktu_selesai: string;
  assigned_pic: string;
  pic_nama: string | null;
  jenis_paket: string | null;
  task_type: string;
  target_qty: number | string;
  actual_qty: number | string | null;
  notes: string | null;
  created_by: string;
  created_at: Date;
}

const SLOT_COLS = `
  s.id, s.tanggal, s.client_id, c.toko as client_name, s.studio_code,
  s.waktu_mulai, s.waktu_selesai, s.assigned_pic, e.nama as pic_nama,
  s.jenis_paket, s.task_type, s.target_qty, s.actual_qty, s.notes,
  s.created_by, s.created_at`;

const SLOT_FROM = `
  from prod_slots s
  left join clients c on c.id = s.client_id
  left join employees e on e.employee_id = s.assigned_pic`;

function ymd(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : tz.dateString(v);
}

/** `time` datang sebagai 'HH:MM:SS' dari driver; layar memakai 'HH:MM'. */
function hhmm(v: string): string {
  return v.slice(0, 5);
}

function intOrNull(v: number | string | null): number | null {
  return v === null ? null : Number(v);
}

/**
 * Persentase 2 desimal, atau `null` kalau penyebutnya nol.
 *
 * `null`, BUKAN 0 dan BUKAN throw: aturan rumah #7 ("pembagian nol dirender
 * '—', never an error"). Nol yang dikirim sebagai angka terbaca sebagai
 * "0% tercapai", yang adalah pernyataan tentang kinerja seseorang yang datanya
 * belum ada.
 */
function pct(pembilang: number, penyebut: number): number | null {
  if (penyebut === 0) return null;
  return Math.round((pembilang / penyebut) * 10000) / 100;
}

function toSlotRow(r: SlotDbRow): SlotRow {
  const target = Number(r.target_qty);
  const actual = intOrNull(r.actual_qty);
  return {
    id: r.id,
    tanggal: ymd(r.tanggal),
    clientId: r.client_id,
    clientName: r.client_name ?? '',
    studioCode: r.studio_code,
    studioNama: vocab.studioNama(r.studio_code),
    waktuMulai: hhmm(r.waktu_mulai),
    waktuSelesai: hhmm(r.waktu_selesai),
    assignedPic: r.assigned_pic,
    assignedPicNama: r.pic_nama ?? '',
    jenisPaket: r.jenis_paket,
    taskType: r.task_type,
    targetQty: target,
    actualQty: actual,
    sisaQty: actual === null ? null : target - actual,
    penyelesaianPct: actual === null ? null : pct(actual, target),
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

interface UnavDbRow {
  id: number | string;
  employee_id: string;
  nama: string | null;
  tanggal_mulai: string | Date;
  tanggal_selesai: string | Date;
  alasan: string;
  catatan: string | null;
  dicatat_oleh: string;
  created_at: Date;
}

function toUnavRow(r: UnavDbRow): UnavailabilityRow {
  return {
    id: Number(r.id),
    employeeId: r.employee_id,
    employeeNama: r.nama ?? '',
    tanggalMulai: ymd(r.tanggal_mulai),
    tanggalSelesai: ymd(r.tanggal_selesai),
    alasan: r.alasan,
    catatan: r.catatan,
    dicatatOleh: r.dicatat_oleh,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Input + validasi.
// ---------------------------------------------------------------------------

export interface SlotInput {
  tanggal: string;
  clientId: string;
  studioCode: string;
  waktuMulai: string;
  waktuSelesai: string;
  assignedPic: string;
  jenisPaket: string | null;
  taskType: string;
  targetQty: number;
  notes: string | null;
}

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const RE_HHMM = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function bersih(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * validateSlot menolak yang memang omong kosong, dan HANYA itu. Konflik studio
 * dan PIC tidak tersedia TIDAK diperiksa di sini — keduanya peringatan, bukan
 * penolakan (D3/D4), dan mencampurnya ke dalam validator adalah cara paling
 * mudah seseorang "merapikannya" menjadi throw suatu hari.
 */
function validateSlot(input: SlotInput): SlotInput {
  const tanggal = bersih(input.tanggal);
  const clientId = bersih(input.clientId);
  const studioCode = bersih(input.studioCode);
  const mulai = bersih(input.waktuMulai);
  const selesai = bersih(input.waktuSelesai);
  const pic = bersih(input.assignedPic);
  const taskType = bersih(input.taskType);
  const jenisPaket = bersih(input.jenisPaket);
  const notes = bersih(input.notes);

  if (!RE_YMD.test(tanggal) || clientId === '' || studioCode === '' || pic === ''
      || !RE_HHMM.test(mulai) || !RE_HHMM.test(selesai) || taskType === '') {
    throw new ValidationError();
  }
  if (!vocab.studioByCode(studioCode)) throw new ValidationError(MSG_STUDIO_TIDAK_DIKENAL);
  if (!vocab.isTaskType(taskType)) throw new ValidationError(MSG_JENIS_TASK_TIDAK_DIKENAL);
  if (!(selesai > mulai)) throw new ValidationError(MSG_RENTANG_WAKTU_TIDAK_VALID);
  if (!Number.isInteger(input.targetQty) || input.targetQty <= 0) {
    throw new ValidationError(MSG_TARGET_HARUS_POSITIF);
  }
  return {
    tanggal, clientId, studioCode,
    waktuMulai: hhmm(mulai), waktuSelesai: hhmm(selesai),
    assignedPic: pic, taskType,
    jenisPaket: jenisPaket === '' ? null : jenisPaket,
    targetQty: input.targetQty,
    notes: notes === '' ? null : notes,
  };
}

export interface UnavailabilityInput {
  employeeId: string;
  tanggalMulai: string;
  tanggalSelesai: string;
  alasan: string;
  catatan: string | null;
}

function validateUnav(input: UnavailabilityInput): UnavailabilityInput {
  const employeeId = bersih(input.employeeId);
  const mulai = bersih(input.tanggalMulai);
  const selesai = bersih(input.tanggalSelesai);
  const alasan = bersih(input.alasan);
  const catatan = bersih(input.catatan);
  if (employeeId === '' || !RE_YMD.test(mulai) || !RE_YMD.test(selesai) || alasan === '') {
    throw new ValidationError();
  }
  if (!vocab.isAlasanTidakTersedia(alasan)) throw new ValidationError(MSG_ALASAN_TIDAK_DIKENAL);
  if (selesai < mulai) throw new ValidationError(MSG_RENTANG_TANGGAL_TIDAK_VALID);
  return {
    employeeId, tanggalMulai: mulai, tanggalSelesai: selesai, alasan,
    catatan: catatan === '' ? null : catatan,
  };
}

// ---------------------------------------------------------------------------
// Peringatan — dihitung, dikembalikan, TIDAK dilempar.
// ---------------------------------------------------------------------------

/**
 * hitungPeringatan mengumpulkan kedua peringatan D3/D4 untuk satu slot yang
 * AKAN atau SUDAH tersimpan. `abaikanSlotId` dipakai saat menyunting, supaya
 * sebuah slot tidak dilaporkan bertumpang dengan dirinya sendiri.
 *
 * Studio ber-`cekKonflik = false` (`Luar Kantor`) dilewati: ia catch-all lokasi
 * luar, bukan satu ruangan, dan memperingatkannya setiap hari melatih orang
 * mengabaikan peringatan.
 */
async function hitungPeringatan(
  tx: Queryable, v: SlotInput, abaikanSlotId: string | null,
): Promise<string[]> {
  const out: string[] = [];

  const studio = vocab.studioByCode(v.studioCode);
  if (studio?.cekKonflik) {
    // Tumpang-tindih SETENGAH TERBUKA: 09.00–12.00 dan 12.00–14.00 bersambung,
    // bukan konflik. Dibandingkan di SQL supaya bukan N+1, dengan predikat yang
    // sama dengan `vocab.waktuBertumpang` (yang diuji terpisah di core).
    const bentrok = await tx<{ n: string }[]>`
      select count(*)::text as n
        from prod_slots
       where tanggal = ${v.tanggal}::date
         and studio_code = ${v.studioCode}
         and waktu_mulai < ${v.waktuSelesai}::time
         and ${v.waktuMulai}::time < waktu_selesai
         and (${abaikanSlotId}::text is null or id <> ${abaikanSlotId}::text)`;
    if (Number(bentrok[0].n) > 0) out.push(studioTerpakai(v.studioCode));
  }

  // INKLUSIF di kedua ujung: cuti "10–12" berarti tanggal 12 orangnya tidak ada.
  const unav = await tx<{ n: string }[]>`
    select count(*)::text as n
      from pic_unavailability
     where employee_id = ${v.assignedPic}
       and ${v.tanggal}::date between tanggal_mulai and tanggal_selesai`;
  if (Number(unav[0].n) > 0) out.push(WARN_PIC_TIDAK_TERSEDIA);

  return out;
}

// ---------------------------------------------------------------------------
// Jalur tulis.
// ---------------------------------------------------------------------------

async function lockSlot(tx: Queryable, id: string): Promise<SlotDbRow> {
  const rows = await tx.unsafe<SlotDbRow[]>(
    `select ${SLOT_COLS} ${SLOT_FROM} where s.id = $1 for update of s`, [id],
  );
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

async function readSlot(tx: Queryable, id: string): Promise<SlotDbRow> {
  const rows = await tx.unsafe<SlotDbRow[]>(
    `select ${SLOT_COLS} ${SLOT_FROM} where s.id = $1`, [id],
  );
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

/**
 * createSlot mencatat satu RENCANA sesi produksi. ID di-mint HANYA sesudah
 * validasi lolos (aturan rumah #1).
 *
 * Ia menyimpan LEBIH DULU lalu melaporkan peringatan — bukan sebaliknya. Kalau
 * peringatan dihitung lalu dipakai untuk membatalkan, ia bukan peringatan lagi.
 */
export async function createSlot(
  sql: Sql, actor: Actor, input: SlotInput, now = new Date(),
): Promise<SlotSaveResult> {
  const v = validateSlot(input);
  if (!canManageSlot(actor)) throw new ForbiddenError(MSG_KELOLA_SLOT_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    // Gerbang PIC dipakai ULANG dari M7, tidak ditulis kedua kali: aktif +
    // divisi Creative + level staff. Ia juga yang menutup rantai HRIS.
    await validateCreativeStaff(tx, v.assignedPic);
    const ex = executors(tx);
    const peringatan = await hitungPeringatan(tx, v, null);
    const id = await ident.nextId(ex.ident, PREFIX, now);
    await tx`
      insert into prod_slots (id, tanggal, client_id, studio_code, waktu_mulai, waktu_selesai,
                              assigned_pic, jenis_paket, task_type, target_qty, notes, created_by)
      values (${id}, ${v.tanggal}::date, ${v.clientId}, ${v.studioCode},
              ${v.waktuMulai}::time, ${v.waktuSelesai}::time, ${v.assignedPic},
              ${v.jenisPaket}, ${v.taskType}, ${v.targetQty}, ${v.notes}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'slot_created', beforeJson: null,
      afterJson: {
        tanggal: v.tanggal, client_id: v.clientId, studio_code: v.studioCode,
        waktu_mulai: v.waktuMulai, waktu_selesai: v.waktuSelesai,
        assigned_pic: v.assignedPic, jenis_paket: v.jenisPaket, task_type: v.taskType,
        target_qty: v.targetQty,
        // Peringatan masuk audit: "Leader tahu dan menerimanya" adalah fakta
        // yang perlu bisa dibaca ulang nanti, bukan sekadar toast yang hilang.
        peringatan,
      },
      createdBy: actor.employeeId,
    });
    return { slot: toSlotRow(await readSlot(tx, id)), peringatan };
  });
}

/**
 * updateSlot menyunting rencana. Boleh kapan pun — termasuk sesudah slot
 * ditutup, karena rencana yang salah catat harus bisa diperbaiki; `actual_qty`
 * TIDAK disentuh di sini (jalurnya `enterActual`), jadi angka hasil tidak bisa
 * diubah lewat pintu rencana.
 */
export async function updateSlot(
  sql: Sql, actor: Actor, id: string, input: SlotInput,
): Promise<SlotSaveResult> {
  const v = validateSlot(input);
  if (!canManageSlot(actor)) throw new ForbiddenError(MSG_KELOLA_SLOT_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    const before = await lockSlot(tx, id);
    await validateCreativeStaff(tx, v.assignedPic);
    // Menurunkan target di bawah aktual yang sudah tercatat akan membuat
    // penyelesaian > 100% dan melanggar ck_slot_actual_lte_target. Pesannya
    // dibuat bisa dibaca di sini, bukan dibiarkan jadi galat constraint mentah.
    const aktual = intOrNull(before.actual_qty);
    if (aktual !== null && v.targetQty < aktual) {
      throw new ValidationError(MSG_AKTUAL_MELEBIHI_TARGET);
    }
    const peringatan = await hitungPeringatan(tx, v, id);
    await tx`
      update prod_slots
         set tanggal = ${v.tanggal}::date, client_id = ${v.clientId},
             studio_code = ${v.studioCode}, waktu_mulai = ${v.waktuMulai}::time,
             waktu_selesai = ${v.waktuSelesai}::time, assigned_pic = ${v.assignedPic},
             jenis_paket = ${v.jenisPaket}, task_type = ${v.taskType},
             target_qty = ${v.targetQty}, notes = ${v.notes}
       where id = ${id}`;
    await executors(tx).audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'slot_updated',
      beforeJson: {
        tanggal: ymd(before.tanggal), client_id: before.client_id,
        studio_code: before.studio_code, waktu_mulai: hhmm(before.waktu_mulai),
        waktu_selesai: hhmm(before.waktu_selesai), assigned_pic: before.assigned_pic,
        jenis_paket: before.jenis_paket, task_type: before.task_type,
        target_qty: Number(before.target_qty),
      },
      afterJson: {
        tanggal: v.tanggal, client_id: v.clientId, studio_code: v.studioCode,
        waktu_mulai: v.waktuMulai, waktu_selesai: v.waktuSelesai,
        assigned_pic: v.assignedPic, jenis_paket: v.jenisPaket, task_type: v.taskType,
        target_qty: v.targetQty, peringatan,
      },
      createdBy: actor.employeeId,
    });
    return { slot: toSlotRow(await readSlot(tx, id)), peringatan };
  });
}

/**
 * enterActual menutup slot dengan jumlah yang BENAR-BENAR selesai.
 *
 * Sisa TIDAK di-rollover otomatis (Flow 7): Leader membuat slot baru besok, dan
 * slot ini mempertahankan angka 9/15-nya yang jujur. Auto-rollover berarti
 * angka slot pertama bisa berubah sesudah faktanya.
 */
export async function enterActual(
  sql: Sql, actor: Actor, id: string, actualQty: number,
): Promise<SlotRow> {
  return withTransaction(sql, async (tx) => {
    const r = await lockSlot(tx, id);
    if (!canEnterActual(actor, r.assigned_pic)) {
      throw new ForbiddenError(MSG_ISI_AKTUAL_FORBIDDEN);
    }
    if (!Number.isInteger(actualQty) || actualQty < 0) throw new ValidationError();
    if (actualQty > Number(r.target_qty)) {
      throw new ValidationError(MSG_AKTUAL_MELEBIHI_TARGET);
    }
    await tx`update prod_slots set actual_qty = ${actualQty} where id = ${id}`;
    await executors(tx).audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'slot_actual_entered',
      beforeJson: { actual_qty: intOrNull(r.actual_qty) },
      afterJson: { actual_qty: actualQty, target_qty: Number(r.target_qty) },
      createdBy: actor.employeeId,
    });
    return toSlotRow(await readSlot(tx, id));
  });
}

/** markUnavailable — D4: Leader yang mencatat, bukan PIC. */
export async function markUnavailable(
  sql: Sql, actor: Actor, input: UnavailabilityInput,
): Promise<UnavailabilityRow> {
  const v = validateUnav(input);
  if (!canWriteUnavailability(actor)) {
    throw new ForbiddenError(MSG_TULIS_KETERSEDIAAN_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    await validateCreativeStaff(tx, v.employeeId);
    const ins = await tx<{ id: number | string }[]>`
      insert into pic_unavailability (employee_id, tanggal_mulai, tanggal_selesai, alasan,
                                      catatan, dicatat_oleh)
      values (${v.employeeId}, ${v.tanggalMulai}::date, ${v.tanggalSelesai}::date,
              ${v.alasan}, ${v.catatan}, ${actor.employeeId})
      returning id`;
    const id = Number(ins[0].id);
    await executors(tx).audit.insertAudit({
      entityType: 'pic_unavailability', entityId: String(id),
      actorEmployeeId: actor.employeeId, action: 'pic_unavailability_created',
      beforeJson: null,
      afterJson: {
        employee_id: v.employeeId, tanggal_mulai: v.tanggalMulai,
        tanggal_selesai: v.tanggalSelesai, alasan: v.alasan,
      },
      createdBy: actor.employeeId,
    });
    const rows = await tx<UnavDbRow[]>`
      select u.id, u.employee_id, e.nama, u.tanggal_mulai, u.tanggal_selesai, u.alasan,
             u.catatan, u.dicatat_oleh, u.created_at
        from pic_unavailability u
        left join employees e on e.employee_id = u.employee_id
       where u.id = ${id}`;
    return toUnavRow(rows[0]);
  });
}

/**
 * removeUnavailability mencabut satu catatan. Ada DELETE tapi tidak ada UPDATE
 * (trigger DB menolaknya): salah catat harus bisa dicabut, tapi menyunting
 * rentang sesudah jadwal disusun di atasnya mengubah arti peringatan yang sudah
 * ditampilkan. Cabut lalu catat ulang.
 */
export async function removeUnavailability(sql: Sql, actor: Actor, id: number): Promise<void> {
  if (!canWriteUnavailability(actor)) {
    throw new ForbiddenError(MSG_TULIS_KETERSEDIAAN_FORBIDDEN);
  }
  await withTransaction(sql, async (tx) => {
    const rows = await tx<UnavDbRow[]>`
      select u.id, u.employee_id, null::text as nama, u.tanggal_mulai, u.tanggal_selesai,
             u.alasan, u.catatan, u.dicatat_oleh, u.created_at
        from pic_unavailability u where u.id = ${id} for update`;
    if (rows.length === 0) throw new NotFoundError(MSG_CATATAN_TIDAK_DITEMUKAN);
    const r = rows[0];
    await tx`delete from pic_unavailability where id = ${id}`;
    await executors(tx).audit.insertAudit({
      entityType: 'pic_unavailability', entityId: String(id),
      actorEmployeeId: actor.employeeId, action: 'pic_unavailability_removed',
      beforeJson: {
        employee_id: r.employee_id, tanggal_mulai: ymd(r.tanggal_mulai),
        tanggal_selesai: ymd(r.tanggal_selesai), alasan: r.alasan,
      },
      afterJson: null,
      createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Jalur baca.
// ---------------------------------------------------------------------------

/** Registry studio aktif — dipakai picker dan kolom grid. */
export function listStudios(): readonly vocab.Studio[] {
  return vocab.studiosAktif();
}

export async function getSlot(sql: Queryable, actor: Actor, id: string): Promise<SlotRow> {
  if (!canReadSchedule(actor)) throw new ForbiddenError(MSG_BACA_JADWAL_FORBIDDEN);
  return toSlotRow(await readSlot(sql, id));
}

/**
 * daySchedule adalah bentuk yang dirender grid: SELURUH studio aktif sebagai
 * kolom — termasuk yang nol slot hari itu.
 *
 * Kolom kosong itu bukan hiasan: hari dengan nol slot di Rajawali adalah
 * informasi ("ruangan itu bebas"), dan grid yang hanya menampilkan studio
 * ber-slot membuat kapasitas kosong tidak terlihat justru saat Leader sedang
 * mencari tempat.
 */
export async function daySchedule(
  sql: Queryable, actor: Actor, tanggal: string,
): Promise<DaySchedule> {
  if (!RE_YMD.test(tanggal)) throw new ValidationError();
  if (!canReadSchedule(actor)) throw new ForbiddenError(MSG_BACA_JADWAL_FORBIDDEN);
  const hanyaSendiri = ownRowsOnly(actor);
  const rows = await sql.unsafe<SlotDbRow[]>(
    `select ${SLOT_COLS} ${SLOT_FROM}
      where s.tanggal = $1::date
        and ($2::text is null or s.assigned_pic = $2::text)
      order by s.waktu_mulai asc, s.id asc`,
    [tanggal, hanyaSendiri ? actor.employeeId : null],
  );
  const slots = rows.map(toSlotRow);

  const unavRows = await sql<UnavDbRow[]>`
    select u.id, u.employee_id, e.nama, u.tanggal_mulai, u.tanggal_selesai, u.alasan,
           u.catatan, u.dicatat_oleh, u.created_at
      from pic_unavailability u
      left join employees e on e.employee_id = u.employee_id
     where ${tanggal}::date between u.tanggal_mulai and u.tanggal_selesai
     order by e.nama asc, u.id asc`;

  return {
    tanggal,
    studios: vocab.studiosAktif().map((st) => ({
      code: st.code,
      nama: st.nama,
      cekKonflik: st.cekKonflik,
      slots: slots.filter((s) => s.studioCode === st.code),
    })),
    tidakTersedia: unavRows.map(toUnavRow),
    totalTarget: slots.reduce((a, s) => a + s.targetQty, 0),
    totalActual: slots.reduce((a, s) => a + (s.actualQty ?? 0), 0),
  };
}

export async function listUnavailability(
  sql: Queryable, actor: Actor, dariTanggal: string, sampaiTanggal: string,
): Promise<UnavailabilityRow[]> {
  if (!RE_YMD.test(dariTanggal) || !RE_YMD.test(sampaiTanggal)) throw new ValidationError();
  if (!canReadSchedule(actor)) throw new ForbiddenError(MSG_BACA_JADWAL_FORBIDDEN);
  const rows = await sql<UnavDbRow[]>`
    select u.id, u.employee_id, e.nama, u.tanggal_mulai, u.tanggal_selesai, u.alasan,
           u.catatan, u.dicatat_oleh, u.created_at
      from pic_unavailability u
      left join employees e on e.employee_id = u.employee_id
     where u.tanggal_mulai <= ${sampaiTanggal}::date
       and u.tanggal_selesai >= ${dariTanggal}::date
     order by u.tanggal_mulai asc, u.id asc`;
  return rows.map(toUnavRow);
}

/**
 * sameDaySummary — dashboard Leader (D5). Per PIC, satu periode.
 *
 * ⚠️ Angka ini TIDAK PERNAH sampai ke Modul 14 dan tidak punya bobot KPI.
 * Ia mengukur "apakah yang dijadwalkan hari itu selesai hari itu"; Speed Score
 * M12 mengukur SLA turnaround multi-hari per Asset. Dua pertanyaan berbeda,
 * dua tempat berbeda. Kalau suatu saat berkas `performance.ts` mengimpor fungsi
 * ini, D5 sedang dibatalkan tanpa entri DECISIONS.md.
 */
export async function sameDaySummary(
  sql: Queryable, actor: Actor, dariTanggal: string, sampaiTanggal: string,
): Promise<PicSameDayRow[]> {
  if (!RE_YMD.test(dariTanggal) || !RE_YMD.test(sampaiTanggal)) throw new ValidationError();
  if (!canReadSchedule(actor)) throw new ForbiddenError(MSG_BACA_JADWAL_FORBIDDEN);
  const hanyaSendiri = ownRowsOnly(actor);
  const rows = await sql.unsafe<{
    employee_id: string; nama: string | null; jumlah_slot: string; slot_ditutup: string;
    total_target: string; total_actual: string;
  }[]>(
    `select s.assigned_pic as employee_id, e.nama,
            count(*)::text as jumlah_slot,
            count(s.actual_qty)::text as slot_ditutup,
            coalesce(sum(s.target_qty), 0)::text as total_target,
            coalesce(sum(s.actual_qty), 0)::text as total_actual
       from prod_slots s
       left join employees e on e.employee_id = s.assigned_pic
      where s.tanggal between $1::date and $2::date
        and ($3::text is null or s.assigned_pic = $3::text)
      group by s.assigned_pic, e.nama
      order by e.nama asc, s.assigned_pic asc`,
    [dariTanggal, sampaiTanggal, hanyaSendiri ? actor.employeeId : null],
  );
  return rows.map((r) => {
    const jumlahSlot = Number(r.jumlah_slot);
    const slotDitutup = Number(r.slot_ditutup);
    const totalTarget = Number(r.total_target);
    const totalActual = Number(r.total_actual);
    return {
      employeeId: r.employee_id,
      nama: r.nama ?? '',
      jumlahSlot,
      slotDitutup,
      totalTarget,
      totalActual,
      penyelesaianPct: pct(totalActual, totalTarget),
      slotFillPct: pct(slotDitutup, jumlahSlot),
    };
  });
}
