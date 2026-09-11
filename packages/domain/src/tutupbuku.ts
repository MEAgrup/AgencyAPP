/**
 * D-3 — kunci tutup buku per bulan.
 *
 * Ketokan pemilik (docs/DECISIONS.md 2026-09-07 & 2026-09-08):
 *
 *   * Angka bulan yang sudah ditutup tidak boleh berubah diam-diam.
 *   * MENUTUP  : Finance level lead ATAU Director.
 *   * MEMBUKA  : Director SAJA — yang menutup tidak bisa membatalkan
 *                tutupannya sendiri.
 *   * Buka-ulang wajib beralasan tertulis; angka lama jadi VERSI, tidak
 *     dihapus; tutup-ulang membekukan angka BARU.
 *   * Koreksi ditulis sebagai JURNAL KOREKSI di bulan berjalan, BUKAN dengan
 *     menyunting bulan tertutup. Wewenangnya sama dengan yang menutup
 *     (ketokan pemilik 2026-09-08 atas pertanyaan terbuka §4.3 handoff).
 *
 * ## Di mana penegakannya berada
 *
 * Modul ini BUKAN penjaganya. Penjaganya ada di DB, dan itu disengaja:
 *
 *   * gerbang peran   → `sm_edges.require_director` / `require_division`,
 *                        dievaluasi di dalam `sm_transition` (20260925010000)
 *   * syarat transisi → trigger `trg_bp_jaga_transisi` (20260925020000)
 *   * pagar tulisan   → trigger `jaga_periode_tertutup` (20260925030000)
 *
 * Yang ada DI SINI adalah urutan tulis yang sah, pesan Bahasa Indonesia yang
 * bisa dibaca orang, dan penolakan lebih awal supaya pengguna tidak menunggu
 * sampai DB yang menolaknya. Cek peran di modul ini adalah kesopanan, bukan
 * pengaman — hapus semuanya dan DB tetap menolak.
 */

import { accrual, money, permission, statemachine, tz, type audit as auditCore } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

// ---------------------------------------------------------------------------
// Kosakata
// ---------------------------------------------------------------------------

export const STATUS_TERBUKA = '[Terbuka]';
export const STATUS_TERTUTUP = '[Tertutup]';

export type StatusPeriode = typeof STATUS_TERBUKA | typeof STATUS_TERTUTUP;

/**
 * Nama + versi mesin yang menghasilkan angka beku. Disimpan APA ADANYA di
 * `book_period_snapshots.penghitung`, dan WAJIB dinaikkan kalau rumusnya
 * berubah: tanpa itu, selisih antara angka beku dan hitung ulang tidak bisa
 * dijelaskan — "datanya yang berubah" dan "rumusnya yang berubah" akan
 * terlihat sama persis.
 */
export const PENGHITUNG = 'cdps.accrual.v1';

export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    // Nama BER-MODUL, bukan `ValidationError` telanjang: `apps/api/src/lib/http.ts`
    // memetakan error ke status HTTP lewat `Error.name` supaya tidak perlu
    // mengimpor barrel domain, jadi dua modul yang berbagi satu nama akan
    // berbagi satu status — diam-diam, dan baru terasa saat salah satunya
    // butuh status lain.
    this.name = 'TutupBukuValidationError';
  }
}
export class ForbiddenError extends Error {
  constructor(msg: string) {
    super(msg);
    // Nama BER-MODUL, bukan `ForbiddenError` telanjang: `apps/api/src/lib/http.ts`
    // memetakan error ke status HTTP lewat `Error.name` supaya tidak perlu
    // mengimpor barrel domain, jadi dua modul yang berbagi satu nama akan
    // berbagi satu status — diam-diam, dan baru terasa saat salah satunya
    // butuh status lain.
    this.name = 'TutupBukuForbiddenError';
  }
}
export class NotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    // Nama BER-MODUL, bukan `NotFoundError` telanjang: `apps/api/src/lib/http.ts`
    // memetakan error ke status HTTP lewat `Error.name` supaya tidak perlu
    // mengimpor barrel domain, jadi dua modul yang berbagi satu nama akan
    // berbagi satu status — diam-diam, dan baru terasa saat salah satunya
    // butuh status lain.
    this.name = 'TutupBukuNotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    // Nama BER-MODUL, bukan `ConflictError` telanjang: `apps/api/src/lib/http.ts`
    // memetakan error ke status HTTP lewat `Error.name` supaya tidak perlu
    // mengimpor barrel domain, jadi dua modul yang berbagi satu nama akan
    // berbagi satu status — diam-diam, dan baru terasa saat salah satunya
    // butuh status lain.
    this.name = 'TutupBukuConflictError';
  }
}

export const MSG_PERIODE_TIDAK_VALID = '[periode harus dalam bentuk YYYY-MM]';
export const MSG_TIDAK_BOLEH_TUTUP =
  '[hanya Finance level lead atau Director yang boleh menutup buku]';
export const MSG_TIDAK_BOLEH_BUKA = '[hanya Director yang boleh membuka kembali buku yang sudah ditutup]';
export const MSG_ALASAN_WAJIB = '[alasan buka-ulang wajib diisi]';
export const MSG_SUDAH_TERTUTUP = '[buku bulan ini sudah ditutup]';
export const MSG_BELUM_TERTUTUP = '[buku bulan ini belum ditutup, tidak ada yang perlu dibuka]';
export const MSG_BELUM_LEWAT = '[bulan yang belum selesai tidak bisa ditutup]';
export const MSG_VERSI_TIDAK_ADA = '[versi angka yang diminta tidak ada]';
export const MSG_KOREKSI_KOSONG = '[keterangan jurnal koreksi wajib diisi]';
export const MSG_KOREKSI_BULAN_TERTUTUP =
  '[jurnal koreksi hanya boleh ditulis di bulan yang masih terbuka]';
export const MSG_TIDAK_BOLEH_KOREKSI =
  '[hanya Finance level lead atau Director yang boleh menulis jurnal koreksi]';

const DIVISI_FINANCE = 'Finance';
const PERIODE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------------------------------------------------------------------------
// Gerbang peran — cermin dari sm_edges, bukan sumbernya
// ---------------------------------------------------------------------------

/**
 * Boleh menutup buku: Finance level lead ATAU Director.
 *
 * Ditulis dari `role` mentah alih-alih memakai `permission.isLead(actor, ...)`
 * supaya bacaannya sejajar dengan baris `sm_edges` yang menegakkannya —
 * `require_lead = true, require_division = 'Finance'`. Kalau dua tempat ini
 * berbeda pendapat, yang menang DB, dan pengguna akan melihat penolakan yang
 * tidak dijelaskan modul ini. Itu sebabnya keduanya harus terbaca mirip.
 */
export function bolehTutupBuku(actor: permission.Actor): boolean {
  if (actor.role.director) return true;
  return actor.role.level === permission.LevelLead && actor.role.division === DIVISI_FINANCE;
}

/** Boleh membuka kembali: Director SAJA (`sm_edges.require_director`). */
export function bolehBukaBuku(actor: permission.Actor): boolean {
  return actor.role.director;
}

/**
 * Boleh menulis jurnal koreksi: SAMA dengan yang boleh menutup.
 *
 * Ketokan pemilik 2026-09-08. Alasannya: memperlebarnya berarti orang yang
 * tidak boleh menutup buku tetap bisa mengubah angkanya lewat pintu samping,
 * dan pintu samping yang sah tetap pintu samping.
 */
export function bolehJurnalKoreksi(actor: permission.Actor): boolean {
  return bolehTutupBuku(actor);
}

// ---------------------------------------------------------------------------
// Periode
// ---------------------------------------------------------------------------

/** 'YYYY-MM' → 'YYYY-MM-01', memvalidasi bentuknya lebih dulu. */
export function periodeKeTanggal(periode: string): string {
  const p = (periode ?? '').trim();
  if (!PERIODE_RE.test(p)) throw new ValidationError(MSG_PERIODE_TIDAK_VALID);
  return `${p}-01`;
}

/** 'YYYY-MM-DD' (atau Date dari pg) → 'YYYY-MM'. */
function tanggalKePeriode(v: unknown): string {
  if (v instanceof Date) return tz.dateString(v).slice(0, 7);
  return String(v).slice(0, 7);
}

export interface Periode {
  periode: string;
  status: StatusPeriode;
  versiTerakhir: number;
  dibukaPada: string | null;
  dibukaOleh: string | null;
  alasanBuka: string | null;
}

function rowToPeriode(r: Record<string, unknown>): Periode {
  return {
    periode: tanggalKePeriode(r.periode),
    status: String(r.status) as StatusPeriode,
    versiTerakhir: Number(r.versi_terakhir),
    dibukaPada: r.dibuka_pada instanceof Date ? (r.dibuka_pada as Date).toISOString() : null,
    dibukaOleh: r.dibuka_oleh === null || r.dibuka_oleh === undefined ? null : String(r.dibuka_oleh),
    alasanBuka: r.alasan_buka === null || r.alasan_buka === undefined ? null : String(r.alasan_buka),
  };
}

// ---------------------------------------------------------------------------
// Penghitung angka beku — pemanggil PERTAMA mesin accrual
// ---------------------------------------------------------------------------

/** Satu baris pendapatan yang diakui di bulan yang sedang ditutup. */
export interface BarisAngka {
  serviceId: string;
  clientId: string;
  nama: string;
  /** Minor units, sebagai string — jsonb tidak punya bigint. */
  jumlah: string;
  jumlahIdr: string;
  hangus: string;
}

/**
 * Satu layanan yang TIDAK BISA dihitung, beserta sebabnya.
 *
 * Aturan rumah #4 dalam bentuknya yang paling mahal: sebuah layanan yang
 * dilewati diam-diam membuat angka bulan itu lebih kecil dari seharusnya,
 * dan tidak ada satu pun tanda di laporan bahwa ada yang hilang. Snapshot
 * membawa daftar ini supaya "Rp 0" dan "tidak terhitung" tidak pernah
 * berbagi satu bentuk.
 */
export interface LayananTidakTerhitung {
  serviceId: string;
  nama: string;
  sebab: string;
}

export interface AngkaPeriode {
  periode: string;
  penghitung: string;
  totalDiakui: string;
  totalDiakuiIdr: string;
  totalHangus: string;
  jumlahLayanan: number;
  baris: BarisAngka[];
  tidakTerhitung: LayananTidakTerhitung[];
}

const SVC_IN_EXECUTION = '[In Execution]';
const SVC_ON_HOLD = '[On Hold]';
const SVC_DONE = 'Done';
const SVC_VOID = '[Cancelled — Service Voided]';

interface BarisLayanan {
  id: string;
  client_id: string;
  name: string;
  standard_price: string;
  qty: string | null;
  pengakuan: string;
  durasi_bulan: number | null;
  qty_menambah: string;
  created_at: Date;
}

interface BarisTransisi {
  entity_id: string;
  ke: string;
  pada: Date;
}

/**
 * Riwayat hold satu layanan, diturunkan dari transisi.
 *
 * Jendelanya `[On Hold]` → `[In Execution]` BERIKUTNYA, bukan
 * `[Hold Requested]` → ... : permintaan hold yang DITOLAK juga meninggalkan
 * `[Hold Requested]` di riwayat, dan menganggapnya jeda akan memotong
 * pendapatan untuk hari-hari yang sebenarnya jalan terus. Ketokan D-2
 * menyebut `[On Hold]`, dan hanya itu.
 */
function turunkanHold(transisi: BarisTransisi[]): accrual.Hold[] {
  const holds: accrual.Hold[] = [];
  let mulai: string | null = null;
  for (const t of transisi) {
    if (t.ke === SVC_ON_HOLD && mulai === null) {
      mulai = tz.dateString(t.pada);
    } else if (t.ke === SVC_IN_EXECUTION && mulai !== null) {
      holds.push({ mulai, selesai: tz.dateString(t.pada) });
      mulai = null;
    }
  }
  // Masih ditahan sampai sekarang. Mesin accrual sengaja TIDAK menggeser
  // apa pun untuk hold yang belum selesai (lihat dok `Hold.selesai`), tapi
  // ia tetap dikirim supaya keputusan itu ada di satu tempat, bukan dua.
  if (mulai !== null) holds.push({ mulai, selesai: null });
  return holds;
}

/** Transisi PERTAMA menuju sebuah state, atau null kalau tidak pernah. */
function pertamaKe(transisi: BarisTransisi[], ke: string): string | null {
  for (const t of transisi) {
    if (t.ke === ke) return tz.dateString(t.pada);
  }
  return null;
}

/**
 * hitungAngkaPeriode menghitung pendapatan yang diakui di satu bulan, dari
 * data mentah, dengan mesin `@cdps/core` accrual.
 *
 * Deterministik dalam arti yang D-3 butuhkan: satu-satunya masukan yang
 * bergerak adalah isi DB. Tidak ada `new Date()` di jalur perhitungan, jadi
 * menutup bulan yang sama dua kali dengan data yang sama menghasilkan angka
 * yang sama — dan kalau BERBEDA, itu berarti datanya yang berubah, yang persis
 * merupakan pertanyaan yang ingin dijawab saat membandingkan versi.
 */
export async function hitungAngkaPeriode(sql: Queryable, periode: string): Promise<AngkaPeriode> {
  const p = (periode ?? '').trim();
  if (!PERIODE_RE.test(p)) throw new ValidationError(MSG_PERIODE_TIDAK_VALID);

  const layanan = await sql<BarisLayanan[]>`
    select s.id, s.client_id, s.name, s.standard_price::text as standard_price,
           s.qty::text as qty, v.pengakuan,
           -- FS-6b: the tenor the deal actually sold, falling back to the pinned
           -- version's. Reading v.durasi_bulan alone spread a 12-month package
           -- across the SHORTEST option's months, because the FS-6 invariant
           -- (trg_msdo_terpendek) makes the version equal to that option — so
           -- Rp 36jt over 12 months was recognised as Rp 12jt x 3 and then
           -- nothing for nine months, with no error anywhere.
           coalesce(s.durasi_bulan, v.durasi_bulan) as durasi_bulan,
           v.qty_menambah, s.created_at
      from services s
      join master_service_versions v
        on v.service_id = s.master_service_id and v.version_no = s.master_version_no
     -- Bridge MSDPS→CDPS A7 anti-drift: pendapatan layanan sumber='meago'
     -- SUDAH diakui di buku MEAGO lewat transactions MSDPS (D4+D13 — bayar
     -- pertama sudah terverifikasi di SUMBER sebelum bridge boleh berjalan).
     -- Menghitungnya ulang di sini akan menutup buku CDPS dengan pendapatan
     -- grup yang sama dua kali. DIKECUALIKAN, bukan GAGAL DIHITUNG — dua arti
     -- berbeda yang sengaja TIDAK berbagi satu baris tidak_terhitung (lihat
     -- filter di bawah).
     where s.sumber <> 'meago'
     order by s.id`;

  const transisi = await sql<BarisTransisi[]>`
    select entity_id,
           split_part(action, '->', 2) as ke,
           created_at as pada
      from audit_log
     where entity_type = 'service' and action like 'transition:%'
     order by entity_id, created_at, id`;

  const perLayanan = new Map<string, BarisTransisi[]>();
  for (const t of transisi) {
    const arr = perLayanan.get(t.entity_id);
    if (arr) arr.push(t);
    else perLayanan.set(t.entity_id, [t]);
  }

  const baris: BarisAngka[] = [];
  const tidakTerhitung: LayananTidakTerhitung[] = [];
  let totalDiakui = 0n;
  let totalHangus = 0n;

  for (const l of layanan) {
    const qtyMenambah = l.qty_menambah as accrual.QtyMenambah;
    const qty = l.qty === null ? null : Number(l.qty);

    // Satu-satunya tebakan yang DITOLAK secara eksplisit. Untuk layanan yang
    // qty-nya MENGGANDAKAN durasi, menganggap qty = 1 memendekkan masa
    // layanan — pendapatan yang seharusnya tersebar 36 bulan akan dipadatkan
    // ke 6, dan setiap bulan di antaranya salah. Lihat 20260925040000.
    if (qtyMenambah === 'durasi' && (qty === null || !Number.isFinite(qty) || qty <= 0)) {
      tidakTerhitung.push({
        serviceId: l.id,
        nama: l.name,
        sebab: 'jumlah unit yang dibeli tidak tercatat, padahal layanan ini menggandakan durasi',
      });
      continue;
    }

    const t = perLayanan.get(l.id) ?? [];
    let skedul: accrual.AccrualSchedule;
    try {
      skedul = accrual.hitungSkedul({
        nilaiBruto: money.parse(l.standard_price),
        pengakuan: l.pengakuan as accrual.Pengakuan,
        durasiBulan: l.durasi_bulan,
        qty: qty ?? 1,
        qtyMenambah,
        tanggalMulai: pertamaKe(t, SVC_IN_EXECUTION),
        tanggalSelesai: pertamaKe(t, SVC_DONE),
        bulanPenjualan: tz.dateString(l.created_at).slice(0, 7),
        holds: turunkanHold(t),
        tanggalVoid: pertamaKe(t, SVC_VOID),
      });
    } catch (e) {
      // Masukan yang MUSTAHIL, bukan yang kosong — mesin membedakan keduanya.
      // Dicatat, tidak dilempar: satu layanan rusak tidak boleh membuat
      // seluruh bulan tidak bisa ditutup, tapi ia juga tidak boleh hilang.
      tidakTerhitung.push({
        serviceId: l.id,
        nama: l.name,
        sebab: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const bulanIni = skedul.perBulan.find((b) => b.bulan === p);
    const hangusIni = skedul.baris
      .filter((b) => b.bulan === p)
      .reduce((acc, b) => acc + b.hangus, 0n);
    if (bulanIni === undefined && hangusIni === 0n) continue;

    const jumlah = bulanIni?.jumlah ?? 0n;
    totalDiakui += jumlah;
    totalHangus += hangusIni;
    baris.push({
      serviceId: l.id,
      clientId: l.client_id,
      nama: l.name,
      jumlah: jumlah.toString(),
      jumlahIdr: money.format(jumlah),
      hangus: hangusIni.toString(),
    });
  }

  return {
    periode: p,
    penghitung: PENGHITUNG,
    totalDiakui: totalDiakui.toString(),
    totalDiakuiIdr: money.format(totalDiakui),
    totalHangus: totalHangus.toString(),
    jumlahLayanan: baris.length,
    baris,
    tidakTerhitung,
  };
}

// ---------------------------------------------------------------------------
// Menutup, membuka, membandingkan
// ---------------------------------------------------------------------------

const MACHINE_BOOK_PERIOD = 'book_period';

/** Baca satu periode; null kalau belum pernah disentuh sama sekali. */
export async function getPeriode(sql: Queryable, periode: string): Promise<Periode | null> {
  const tanggal = periodeKeTanggal(periode);
  const rows = await sql<Record<string, unknown>[]>`
    select periode, status, versi_terakhir, dibuka_pada, dibuka_oleh, alasan_buka
      from book_periods where periode = ${tanggal}::date`;
  return rows.length === 0 ? null : rowToPeriode(rows[0]);
}

/**
 * Daftar periode yang PERNAH disentuh, terbaru dulu.
 *
 * Bulan yang belum pernah ditutup memang tidak punya baris, dan itu bukan
 * lubang: "belum pernah ditutup" adalah keadaan baku setiap bulan, dan
 * membuat baris untuk semua bulan sejak awal waktu hanya akan menyimpan
 * ketiadaan dalam bentuk yang lebih mahal.
 */
export async function listPeriode(sql: Queryable, limit = 24): Promise<Periode[]> {
  const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 240) : 24;
  const rows = await sql<Record<string, unknown>[]>`
    select periode, status, versi_terakhir, dibuka_pada, dibuka_oleh, alasan_buka
      from book_periods order by periode desc limit ${n}`;
  return rows.map(rowToPeriode);
}

export interface HasilTutup {
  periode: Periode;
  versi: number;
  angka: AngkaPeriode;
}

/**
 * tutupBuku membekukan angka bulan `periode` lalu menguncinya.
 *
 * URUTANNYA WAJIB SEPERTI INI, dan bukan karena selera: `sm_transition` hanya
 * menulis kolom `status`, sementara `trg_bp_jaga_transisi` menuntut angka
 * versi itu SUDAH ADA saat status berpindah. Membekukan sesudah transisi
 * mustahil; DB menolaknya, dan itu sudah dibuktikan dengan menjalankannya.
 */
export async function tutupBuku(
  sql: Sql,
  actor: permission.Actor,
  periode: string,
  opts: { sekarang?: Date } = {},
): Promise<HasilTutup> {
  if (!bolehTutupBuku(actor)) throw new ForbiddenError(MSG_TIDAK_BOLEH_TUTUP);
  const tanggal = periodeKeTanggal(periode);
  const p = periode.trim();

  // Bulan yang belum selesai tidak bisa ditutup. Tanpa pagar ini, seseorang
  // bisa menutup bulan berjalan di tanggal 3 dan mengunci sisa bulan itu dari
  // setiap penerimaan yang belum masuk — pagar bulan tertutup akan menolak
  // semuanya, dan yang terlihat adalah sistem yang rusak.
  //
  // `tz.dateString(...).slice(0, 7)`, BUKAN `tz.period(...)`: yang terakhir
  // mengembalikan 'YYYYMM' tanpa tanda hubung (ember ID rumah), sehingga
  // '2026-09' >= '202609' membandingkan '-' dengan '0' dan selalu false —
  // pagarnya diam dan bulan berjalan bisa ditutup. Ditemukan oleh tesnya,
  // bukan oleh pembacaan.
  const sekarang = opts.sekarang ?? new Date();
  if (p >= tz.dateString(sekarang).slice(0, 7)) throw new ValidationError(MSG_BELUM_LEWAT);

  const angka = await hitungAngkaPeriode(sql, p);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);

    // Baris periode + row lock. `on conflict do nothing` lalu SELECT ... FOR
    // UPDATE, bukan upsert-returning: baris yang sudah ada tidak boleh
    // ditimpa created_by-nya oleh orang yang kebetulan menutupnya kedua kali.
    await tx`
      insert into book_periods (periode, created_by)
      values (${tanggal}::date, ${actor.employeeId})
      on conflict (periode) do nothing`;
    const kunci = await tx<Record<string, unknown>[]>`
      select periode, status, versi_terakhir, dibuka_pada, dibuka_oleh, alasan_buka
        from book_periods where periode = ${tanggal}::date for update`;
    const sebelum = rowToPeriode(kunci[0]);
    if (sebelum.status === STATUS_TERTUTUP) throw new ConflictError(MSG_SUDAH_TERTUTUP);

    const versi = sebelum.versiTerakhir + 1;
    await tx`
      insert into book_period_snapshots (periode, versi, ditutup_oleh, penghitung, angka)
      values (${tanggal}::date, ${versi}, ${actor.employeeId}, ${PENGHITUNG},
              ${angka as unknown as never}::jsonb)`;
    await tx`
      update book_periods set versi_terakhir = ${versi} where periode = ${tanggal}::date`;

    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BOOK_PERIOD,
      entityType: MACHINE_BOOK_PERIOD,
      table: 'book_periods',
      idColumn: 'periode',
      entityId: tanggal,
      to: STATUS_TERTUTUP,
      actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied'
        ? new ForbiddenError(res.message)
        : new ConflictError(res.message);
    }

    // Baris audit KEDUA, di samping baris transisi yang ditulis sm_transition.
    // Yang ini membawa RINGKASAN angkanya, supaya "berapa yang dikunci, dan
    // berapa layanan yang tidak terhitung" bisa dijawab dari riwayat tanpa
    // membuka snapshot-nya.
    await ex.audit.insertAudit({
      entityType: MACHINE_BOOK_PERIOD,
      entityId: tanggal,
      actorEmployeeId: actor.employeeId,
      action: 'tutup_buku',
      beforeJson: { versi: sebelum.versiTerakhir },
      afterJson: {
        versi,
        penghitung: PENGHITUNG,
        total_diakui: angka.totalDiakui,
        total_hangus: angka.totalHangus,
        jumlah_layanan: angka.jumlahLayanan,
        jumlah_tidak_terhitung: angka.tidakTerhitung.length,
      },
      createdBy: actor.employeeId,
    } satisfies auditCore.AuditRow);

    const sesudah = await tx<Record<string, unknown>[]>`
      select periode, status, versi_terakhir, dibuka_pada, dibuka_oleh, alasan_buka
        from book_periods where periode = ${tanggal}::date`;
    return { periode: rowToPeriode(sesudah[0]), versi, angka };
  });
}

/**
 * bukaBuku membuka kembali bulan yang sudah ditutup. Director SAJA, dan wajib
 * beralasan tertulis.
 *
 * Angka beku TIDAK disentuh: ia tetap ada sebagai versi, dan tutup-ulang nanti
 * menambah versi baru di sebelahnya. Itu yang membuat "berapa angkanya waktu
 * ditutup pertama kali" tetap bisa dijawab selamanya.
 */
export async function bukaBuku(
  sql: Sql,
  actor: permission.Actor,
  periode: string,
  alasan: string,
): Promise<Periode> {
  if (!bolehBukaBuku(actor)) throw new ForbiddenError(MSG_TIDAK_BOLEH_BUKA);
  const tanggal = periodeKeTanggal(periode);
  const a = (alasan ?? '').trim();
  if (a === '') throw new ValidationError(MSG_ALASAN_WAJIB);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const kunci = await tx<Record<string, unknown>[]>`
      select periode, status, versi_terakhir, dibuka_pada, dibuka_oleh, alasan_buka
        from book_periods where periode = ${tanggal}::date for update`;
    if (kunci.length === 0) throw new NotFoundError(MSG_BELUM_TERTUTUP);
    const sebelum = rowToPeriode(kunci[0]);
    if (sebelum.status !== STATUS_TERTUTUP) throw new ConflictError(MSG_BELUM_TERTUTUP);

    // STAMP dulu, baru TRANSISI — satu-satunya urutan yang sah, karena
    // `sm_transition` hanya menulis `status` dan trigger menuntut alasannya
    // sudah ada saat status berpindah.
    await tx`
      update book_periods
         set dibuka_pada = now(), dibuka_oleh = ${actor.employeeId}, alasan_buka = ${a}
       where periode = ${tanggal}::date`;

    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BOOK_PERIOD,
      entityType: MACHINE_BOOK_PERIOD,
      table: 'book_periods',
      idColumn: 'periode',
      entityId: tanggal,
      to: STATUS_TERBUKA,
      actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied'
        ? new ForbiddenError(res.message)
        : new ConflictError(res.message);
    }

    await ex.audit.insertAudit({
      entityType: MACHINE_BOOK_PERIOD,
      entityId: tanggal,
      actorEmployeeId: actor.employeeId,
      action: 'buka_ulang_tutup_buku',
      beforeJson: { status: STATUS_TERTUTUP, versi: sebelum.versiTerakhir },
      afterJson: { status: STATUS_TERBUKA, versi: sebelum.versiTerakhir, alasan: a },
      createdBy: actor.employeeId,
    } satisfies auditCore.AuditRow);

    const sesudah = await tx<Record<string, unknown>[]>`
      select periode, status, versi_terakhir, dibuka_pada, dibuka_oleh, alasan_buka
        from book_periods where periode = ${tanggal}::date`;
    return rowToPeriode(sesudah[0]);
  });
}

// ---------------------------------------------------------------------------
// Selisih antar versi angka beku
// ---------------------------------------------------------------------------

export interface SnapshotVersi {
  periode: string;
  versi: number;
  ditutupOleh: string;
  ditutupPada: string;
  penghitung: string;
  angka: AngkaPeriode;
}

/** Satu layanan yang angkanya BERBEDA antara dua versi. */
export interface SelisihBaris {
  serviceId: string;
  nama: string;
  /** null = layanan ini tidak ada sama sekali di versi tersebut. */
  sebelum: string | null;
  sesudah: string | null;
  selisih: string;
  selisihIdr: string;
}

export interface SelisihVersi {
  periode: string;
  versiSebelum: number;
  versiSesudah: number;
  totalSebelum: string;
  totalSesudah: string;
  totalSelisih: string;
  totalSelisihIdr: string;
  /** Hanya yang BERUBAH. Baris yang sama di kedua versi tidak disebut. */
  baris: SelisihBaris[];
}

async function ambilSnapshot(sql: Queryable, tanggal: string, versi: number): Promise<SnapshotVersi> {
  const rows = await sql<Record<string, unknown>[]>`
    select periode, versi, ditutup_oleh, ditutup_pada, penghitung, angka
      from book_period_snapshots
     where periode = ${tanggal}::date and versi = ${versi}`;
  if (rows.length === 0) throw new NotFoundError(MSG_VERSI_TIDAK_ADA);
  const r = rows[0];
  return {
    periode: tanggalKePeriode(r.periode),
    versi: Number(r.versi),
    ditutupOleh: String(r.ditutup_oleh),
    ditutupPada: (r.ditutup_pada as Date).toISOString(),
    penghitung: String(r.penghitung),
    angka: r.angka as AngkaPeriode,
  };
}

/** Semua versi angka beku sebuah bulan, tertua dulu. */
export async function listVersi(sql: Queryable, periode: string): Promise<SnapshotVersi[]> {
  const tanggal = periodeKeTanggal(periode);
  const rows = await sql<Record<string, unknown>[]>`
    select periode, versi, ditutup_oleh, ditutup_pada, penghitung, angka
      from book_period_snapshots where periode = ${tanggal}::date order by versi`;
  return rows.map((r) => ({
    periode: tanggalKePeriode(r.periode),
    versi: Number(r.versi),
    ditutupOleh: String(r.ditutup_oleh),
    ditutupPada: (r.ditutup_pada as Date).toISOString(),
    penghitung: String(r.penghitung),
    angka: r.angka as AngkaPeriode,
  }));
}

/**
 * bandingkanVersi menunjukkan APA yang berubah antara dua kali penutupan.
 *
 * Ini konsekuensi ketiga dari ketokan buka-ulang, dan alasannya keras: tanpa
 * tampilan selisih, buka-tutup adalah cara mengubah angka keuangan yang tidak
 * meninggalkan jejak yang bisa dibaca manusia. Baris yang TIDAK berubah
 * sengaja tidak disebut — yang dicari orang saat membuka layar ini adalah
 * "apa yang bergeser", bukan seluruh isi bulan itu untuk kedua kalinya.
 */
export async function bandingkanVersi(
  sql: Queryable,
  periode: string,
  versiSebelum: number,
  versiSesudah: number,
): Promise<SelisihVersi> {
  const tanggal = periodeKeTanggal(periode);
  const a = await ambilSnapshot(sql, tanggal, versiSebelum);
  const b = await ambilSnapshot(sql, tanggal, versiSesudah);

  const petaA = new Map(a.angka.baris.map((x) => [x.serviceId, x]));
  const petaB = new Map(b.angka.baris.map((x) => [x.serviceId, x]));
  const semua = [...new Set([...petaA.keys(), ...petaB.keys()])].sort();

  const baris: SelisihBaris[] = [];
  for (const id of semua) {
    const xa = petaA.get(id);
    const xb = petaB.get(id);
    const na = xa ? BigInt(xa.jumlah) : 0n;
    const nb = xb ? BigInt(xb.jumlah) : 0n;
    if (na === nb && xa !== undefined && xb !== undefined) continue;
    const d = nb - na;
    baris.push({
      serviceId: id,
      nama: xb?.nama ?? xa?.nama ?? id,
      sebelum: xa ? xa.jumlah : null,
      sesudah: xb ? xb.jumlah : null,
      selisih: d.toString(),
      selisihIdr: money.format(d),
    });
  }

  const totalA = BigInt(a.angka.totalDiakui);
  const totalB = BigInt(b.angka.totalDiakui);
  return {
    periode: a.periode,
    versiSebelum: a.versi,
    versiSesudah: b.versi,
    totalSebelum: a.angka.totalDiakui,
    totalSesudah: b.angka.totalDiakui,
    totalSelisih: (totalB - totalA).toString(),
    totalSelisihIdr: money.format(totalB - totalA),
    baris,
  };
}

// ---------------------------------------------------------------------------
// Jurnal koreksi — satu-satunya jalan sah memperbaiki bulan tertutup
// ---------------------------------------------------------------------------

export interface JurnalKoreksi {
  /** Bulan TERTUTUP yang sedang dikoreksi. */
  periodeDikoreksi: string;
  /** Bulan TERBUKA tempat koreksi ini dicatat. */
  periodeCatat: string;
  keterangan: string;
  /** Minor units; null = catatan tanpa nilai, bukan nol. */
  nilai: string | null;
  nilaiIdr: string | null;
  dicatatOleh: string;
  dicatatPada: string;
}

/**
 * catatJurnalKoreksi menulis satu koreksi atas bulan TERTUTUP, ke dalam bulan
 * yang masih TERBUKA.
 *
 * Ini bentuk yang dipilih pemilik saat memilih D-3 opsi (a): "jalur koreksi
 * resmi (jurnal koreksi di bulan berjalan, BUKAN mengedit bulan tertutup)".
 * Wewenangnya sengaja SAMA dengan yang boleh menutup — melebarkannya berarti
 * orang yang tidak boleh menutup buku tetap bisa menggerakkan angkanya.
 *
 * Disimpan di `audit_log`, bukan tabel baru. Alasannya bukan hemat: audit_log
 * sudah menolak UPDATE dan DELETE lewat trigger, sudah punya aktor + waktu +
 * before/after, dan sudah menjadi tempat setiap orang mencari riwayat. Tabel
 * baru berarti menegakkan ulang keempatnya, dan menegakkan ulang berarti
 * sebagian akan terlewat.
 */
export async function catatJurnalKoreksi(
  sql: Sql,
  actor: permission.Actor,
  input: {
    periodeDikoreksi: string;
    periodeCatat: string;
    keterangan: string;
    nilai?: string | null;
  },
): Promise<JurnalKoreksi> {
  if (!bolehJurnalKoreksi(actor)) throw new ForbiddenError(MSG_TIDAK_BOLEH_KOREKSI);

  const tglDikoreksi = periodeKeTanggal(input.periodeDikoreksi);
  const tglCatat = periodeKeTanggal(input.periodeCatat);
  const keterangan = (input.keterangan ?? '').trim();
  if (keterangan === '') throw new ValidationError(MSG_KOREKSI_KOSONG);

  const nilai =
    input.nilai === undefined || input.nilai === null || String(input.nilai).trim() === ''
      ? null
      : money.parse(String(input.nilai));

  return withTransaction(sql, async (tx) => {
    const rows = await tx<{ dikoreksi_tertutup: boolean; catat_tertutup: boolean }[]>`
      select periode_tertutup(${tglDikoreksi}::date) as dikoreksi_tertutup,
             periode_tertutup(${tglCatat}::date)     as catat_tertutup`;
    const { dikoreksi_tertutup, catat_tertutup } = rows[0];

    // Bulan yang DICATATI harus terbuka. Kalau ia tertutup, koreksinya akan
    // mengubah angka bulan yang sudah dikunci — yaitu persis hal yang jurnal
    // koreksi ada untuk dihindari.
    if (catat_tertutup) throw new ConflictError(MSG_KOREKSI_BULAN_TERTUTUP);
    // Dan bulan yang DIKOREKSI harus tertutup: kalau masih terbuka, perbaikan
    // yang benar adalah memperbaiki datanya langsung, bukan menulis catatan.
    if (!dikoreksi_tertutup) throw new ConflictError(MSG_BELUM_TERTUTUP);

    await executors(tx).audit.insertAudit({
      entityType: 'jurnal_koreksi',
      entityId: tglCatat,
      actorEmployeeId: actor.employeeId,
      action: 'jurnal_koreksi',
      beforeJson: { periode_dikoreksi: tglDikoreksi.slice(0, 7) },
      afterJson: {
        periode_dikoreksi: tglDikoreksi.slice(0, 7),
        periode_catat: tglCatat.slice(0, 7),
        keterangan,
        nilai: nilai === null ? null : nilai.toString(),
      },
      createdBy: actor.employeeId,
    } satisfies auditCore.AuditRow);

    const now = await tx<{ t: Date }[]>`select now() as t`;
    return {
      periodeDikoreksi: tglDikoreksi.slice(0, 7),
      periodeCatat: tglCatat.slice(0, 7),
      keterangan,
      nilai: nilai === null ? null : nilai.toString(),
      nilaiIdr: nilai === null ? null : money.format(nilai),
      dicatatOleh: actor.employeeId,
      dicatatPada: now[0].t.toISOString(),
    };
  });
}

/** Semua jurnal koreksi atas sebuah bulan tertutup, terlama dulu. */
export async function listJurnalKoreksi(sql: Queryable, periodeDikoreksi: string): Promise<JurnalKoreksi[]> {
  const tanggal = periodeKeTanggal(periodeDikoreksi);
  const rows = await sql<Record<string, unknown>[]>`
    select entity_id, actor_employee_id, after_json, created_at
      from audit_log
     where entity_type = 'jurnal_koreksi'
       and action = 'jurnal_koreksi'
       and after_json ->> 'periode_dikoreksi' = ${tanggal.slice(0, 7)}
     order by created_at, id`;
  return rows.map((r) => {
    const a = (r.after_json ?? {}) as Record<string, unknown>;
    const nilai = a.nilai === null || a.nilai === undefined ? null : String(a.nilai);
    return {
      periodeDikoreksi: String(a.periode_dikoreksi ?? ''),
      periodeCatat: String(a.periode_catat ?? ''),
      keterangan: String(a.keterangan ?? ''),
      nilai,
      nilaiIdr: nilai === null ? null : money.format(BigInt(nilai)),
      dicatatOleh: String(r.actor_employee_id),
      dicatatPada: (r.created_at as Date).toISOString(),
    };
  });
}
