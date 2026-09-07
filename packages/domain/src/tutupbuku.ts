/**
 * Tutup buku bulanan + jurnal koreksi (Gelombang D, gerbang D-3).
 *
 * APA MODUL INI ADALAH. Tiga pintu: **membaca** laporan pengakuan satu bulan,
 * **menutup** bulan itu (sekali, tanpa jalan kembali), dan **mencatat koreksi**
 * atas bulan yang sudah tertutup. Ia berdiri di samping `accrual.ts` dan bukan
 * di dalamnya karena keduanya menjawab pertanyaan berbeda: `accrual` menjawab
 * *"berapa yang diakui layanan ini, dan kapan"*, modul ini menjawab *"angka
 * bulan ini masih bergerak atau sudah beku, dan siapa yang membekukannya"*.
 *
 * TIGA TUNTUTAN KETOKAN D-3 (pemilik 2026-09-07), dan di mana masing-masing
 * ditegakkan:
 *
 *   1. **Satu peran berwenang menutup.** `canTutupBuku` — Head of Finance
 *      (Finance level lead) atau Director. Di DB, `sm_edges.require_lead`
 *      menolak staff bahkan kalau gerbang TS-nya dilewati.
 *   2. **Bulan tertutup tidak bisa diedit sama sekali.** Mesinnya tidak punya
 *      edge keluar dari `Ditutup`, dan trigger `guard_periode_buku_tertutup`
 *      menolak SETIAP `UPDATE`/`DELETE` atas barisnya — termasuk dari `psql`.
 *   3. **Bulan tertutup dibaca dari ANGKA BEKU.** `laporanBulan` bercabang di
 *      satu tempat, dan hasilnya membawa `sumber: 'beku' | 'dihitung'` supaya
 *      pembacanya tidak perlu menebak yang mana yang sedang ia lihat.
 *
 * KENAPA `sumber` IKUT DIKEMBALIKAN, DAN BUKAN DETAIL INTERNAL. Dua laporan
 * yang terlihat identik tapi satu beku dan satu dihitung ulang adalah dua hal
 * yang sangat berbeda saat angkanya dipertanyakan. Menyembunyikan cabangnya
 * berarti pertanyaan *"kenapa angka Maret hari ini beda dari yang saya cetak
 * bulan Maret"* tidak bisa dijawab tanpa membaca kode — dan jawabannya
 * ("karena Maret belum ditutup") adalah satu kata yang halaman seharusnya bisa
 * mengatakannya sendiri (aturan kerja #4).
 *
 * KENAPA `total` MENJUMLAHKAN KOREKSI YANG MENDARAT, BUKAN YANG MENGOREKSI.
 * Satu baris jurnal punya DUA bulan: `bulan` (tempat ia diakui) dan
 * `bulanDikoreksi` (yang ia perbaiki). Total sebuah bulan menjumlahkan koreksi
 * yang MENDARAT di bulan itu — karena itulah arti ketokan "koreksi lewat jurnal
 * di bulan berjalan". Koreksi yang MENUNJUK bulan ini tetap dikembalikan
 * terpisah (`dikoreksiOleh`) supaya laporan Maret bisa mengatakan "angka ini
 * beku, dan sudah dikoreksi Rp X di bulan April" tanpa mengubah satu pun
 * angkanya sendiri.
 */

import { money, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import {
  canBacaAccrual,
  ForbiddenError as AccrualForbiddenError,
  jadwalSemua,
  nilaiBulan,
  type LayananJadwal,
} from './accrual';
import { FINANCE_DIVISION } from './finance';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

const MACHINE = 'periode_buku';
const ENTITY = 'periode_buku';

/** Status periode buku — kosakata yang `sm_machines` daftarkan. */
export const PERIODE_TERBUKA = 'Terbuka';
export const PERIODE_DITUTUP = 'Ditutup';

// --- Pesan BI persis --------------------------------------------------------

export const MSG_TUTUP_DENIED =
  '[hanya Head of Finance atau Direktur yang dapat menutup buku bulanan]';
export const MSG_KOREKSI_DENIED =
  '[hanya Finance atau Direktur yang dapat mencatat jurnal koreksi]';
export const MSG_BULAN_TAK_SAH = '[format bulan harus YYYY-MM]';
export const MSG_BULAN_BELUM_BERAKHIR =
  '[bulan yang belum berakhir tidak dapat ditutup, tunggu sampai bulannya lewat]';
export const MSG_SUDAH_DITUTUP = '[bulan ini sudah ditutup]';
export const MSG_TUTUP_TIDAK_BERURUTAN =
  '[masih ada bulan yang lebih awal dan belum ditutup, buku harus ditutup berurutan]';
export const MSG_KOREKSI_TARGET_BELUM_TUTUP =
  '[jurnal koreksi hanya untuk bulan yang sudah ditutup]';
export const MSG_KOREKSI_TARGET_BUKAN_LAMPAU =
  '[bulan yang dikoreksi harus lebih awal daripada bulan pencatatannya]';
export const MSG_KOREKSI_BULAN_SUDAH_TUTUP =
  '[jurnal koreksi harus dicatat di bulan yang masih terbuka]';
export const MSG_KOREKSI_NILAI_NOL = '[nilai koreksi tidak boleh nol]';
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';

/** Gerbang/validasi tutup buku gagal (pesan BI verbatim). */
export class ForbiddenError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TutupBukuForbiddenError';
  }
}

/** Masukan tidak lolos gerbang wajib (pesan BI verbatim). */
export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TutupBukuValidationError';
  }
}

/** Keadaan tidak mengizinkan aksinya (pesan BI verbatim). */
export class ConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'TutupBukuConflictError';
  }
}

// --- Gerbang peran ----------------------------------------------------------

/**
 * canTutupBuku — Head of Finance (Finance, level lead) atau Director.
 *
 * SENGAJA satu tingkat di atas yang mengisi angkanya, dan sengaja BUKAN OD:
 * OD read-only di mana pun (Role Matrix Fase 0 §4), dan penutupan buku adalah
 * penulisan yang paling tidak bisa dibatalkan di seluruh sistem. Alasan yang
 * sama menempatkan hak sunting Master Service List satu tingkat di atas yang
 * menutup deal (`msl.canEditMasterServices`).
 */
export function canTutupBuku(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === FINANCE_DIVISION && actor.role.level === permission.LevelLead;
}

/**
 * canCatatKoreksi — Finance segala level atau Director.
 *
 * Lebih lebar daripada `canTutupBuku` dan itu disengaja: mencatat koreksi
 * adalah pekerjaan pembukuan harian, bukan keputusan sekali-jalan, dan setiap
 * barisnya immutable + ber-`alasan` + masuk audit log — jadi ia bisa
 * dipertanggungjawabkan tanpa harus dipersempit. OD tetap DI LUAR: ia membaca
 * segalanya dan menulis nol.
 */
export function canCatatKoreksi(actor: Actor): boolean {
  return actor.role.director || actor.role.division === FINANCE_DIVISION;
}

// --- Bentuk keluaran --------------------------------------------------------

/** Satu baris pengakuan di satu bulan. */
export interface BarisLaporan {
  serviceId: string;
  clientId: string;
  nama: string;
  /** DECIMAL(15,2) — yang diakui DI BULAN INI. */
  nilaiDiakui: string;
  /** DECIMAL(15,2) — nilai bruto baris layanan (D-4: nol hitungan PPN). */
  nilaiBruto: string;
  pengakuan: string;
  masterVersionNo: number;
}

/** Satu baris jurnal koreksi. */
export interface BarisKoreksi {
  id: string;
  bulan: string;
  bulanDikoreksi: string;
  clientId: string | null;
  serviceId: string | null;
  /** DECIMAL(15,2) BERTANDA — negatif berarti koreksi turun. */
  nilai: string;
  alasan: string;
  dicatatOleh: string;
  dicatatPada: string;
}

/** Laporan pengakuan pendapatan satu bulan kalender. */
export interface LaporanBulan {
  bulan: string;
  status: string;
  /**
   * Dari mana angkanya datang. `'beku'` = dibaca dari `periode_buku_baris`
   * (bulan sudah ditutup); `'dihitung'` = dihitung ulang dari data mentah
   * (bulan masih terbuka, jadi angkanya MASIH BISA berubah).
   */
  sumber: 'beku' | 'dihitung';
  ditutupPada: string | null;
  ditutupOleh: string | null;
  baris: readonly BarisLaporan[];
  /** Σ `baris` — pengakuan bulan ini sebelum koreksi. */
  totalDiakui: string;
  /** Koreksi yang MENDARAT di bulan ini (memperbaiki bulan-bulan lampau). */
  koreksi: readonly BarisKoreksi[];
  /** Σ `koreksi`, bertanda. */
  totalKoreksi: string;
  /** `totalDiakui + totalKoreksi` — angka bulan ini apa adanya. */
  total: string;
  /**
   * Koreksi yang MENUNJUK bulan ini, dicatat di bulan-bulan sesudahnya. Ia
   * TIDAK ikut menjumlah `total` bulan ini — angka bulan tertutup tidak
   * berubah, itu seluruh gunanya — tapi ia wajib terlihat, karena tanpanya
   * laporan bulan ini terbaca benar padahal sudah diketahui keliru.
   */
  dikoreksiOleh: readonly BarisKoreksi[];
  /** Kenapa `baris` kosong; `null` kalau ada isinya. */
  alasanKosong: string | null;
}

const BULAN_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Alasan BI kenapa sebuah bulan tidak punya satu baris pengakuan pun. */
export const ALASAN_KOSONG_TERBUKA =
  'belum ada layanan yang mengakui pendapatan di bulan ini — bulannya masih terbuka, jadi angkanya masih bisa bertambah';
export const ALASAN_KOSONG_BEKU =
  'bulan ini ditutup tanpa satu pun layanan yang mengakui pendapatan';

// --- Baca -------------------------------------------------------------------

interface PeriodeRow {
  id: string;
  bulan: string;
  status: string;
  ditutup_pada: Date | null;
  ditutup_oleh: string | null;
}

/** Status satu bulan buku, `null` kalau periodenya belum pernah dibuat. */
export async function periode(sql: Queryable, actor: Actor, bulan: string): Promise<PeriodeBuku | null> {
  gerbangBaca(actor);
  bulanSah(bulan);
  const rows = await sql<PeriodeRow[]>`
    select id, bulan, status, ditutup_pada, ditutup_oleh from periode_buku where bulan = ${bulan}`;
  return rows.length === 0 ? null : toPeriode(rows[0]);
}

/** Satu bulan buku. */
export interface PeriodeBuku {
  id: string;
  bulan: string;
  status: string;
  ditutupPada: string | null;
  ditutupOleh: string | null;
}

function toPeriode(r: PeriodeRow): PeriodeBuku {
  return {
    id: r.id,
    bulan: r.bulan,
    status: r.status,
    ditutupPada: r.ditutup_pada === null ? null : tz.dateTimeString(r.ditutup_pada),
    ditutupOleh: r.ditutup_oleh,
  };
}

/**
 * laporanBulan mengembalikan laporan pengakuan satu bulan.
 *
 * SATU cabang, dan ia adalah seluruh isi tuntutan (3): bulan yang `Ditutup`
 * dibaca dari `periode_buku_baris`, dan mesin accrual **tidak dipanggil sama
 * sekali**. Bulan yang masih terbuka dihitung ulang setiap kali dibaca — dan
 * hasilnya menyebut dirinya `'dihitung'`, karena angka yang masih bisa berubah
 * tidak boleh terbaca sama dengan angka yang sudah tidak bisa.
 */
export async function laporanBulan(sql: Queryable, actor: Actor, bulan: string): Promise<LaporanBulan> {
  gerbangBaca(actor);
  bulanSah(bulan);
  const p = await periode(sql, actor, bulan);
  const koreksi = await bacaKoreksi(sql, { bulan });
  const dikoreksiOleh = await bacaKoreksi(sql, { bulanDikoreksi: bulan });
  const totalKoreksi = koreksi.reduce((a, k) => a + money.parse(k.nilai), 0n);

  const baris = p !== null && p.status === PERIODE_DITUTUP
    ? await barisBeku(sql, bulan)
    : barisDihitung(await jadwalSemua(sql, actor), bulan);
  const totalDiakui = baris.reduce((a, b) => a + money.parse(b.nilaiDiakui), 0n);
  const beku = p !== null && p.status === PERIODE_DITUTUP;

  return {
    bulan,
    status: p?.status ?? PERIODE_TERBUKA,
    sumber: beku ? 'beku' : 'dihitung',
    ditutupPada: p?.ditutupPada ?? null,
    ditutupOleh: p?.ditutupOleh ?? null,
    baris,
    totalDiakui: money.decimal(totalDiakui),
    koreksi,
    totalKoreksi: money.decimal(totalKoreksi),
    total: money.decimal(totalDiakui + totalKoreksi),
    dikoreksiOleh,
    alasanKosong: baris.length > 0 ? null : beku ? ALASAN_KOSONG_BEKU : ALASAN_KOSONG_TERBUKA,
  };
}

/** barisBeku membaca angka yang dibekukan saat bulan itu ditutup. */
async function barisBeku(sql: Queryable, bulan: string): Promise<BarisLaporan[]> {
  const rows = await sql<{
    service_id: string; client_id: string; nama: string; nilai_diakui: string;
    nilai_bruto: string; pengakuan: string; master_version_no: number;
  }[]>`
    select b.service_id, b.client_id, s.name as nama, b.nilai_diakui, b.nilai_bruto,
           b.pengakuan, b.master_version_no
      from periode_buku_baris b
      join services s on s.id = b.service_id
     where b.bulan = ${bulan}
     order by b.client_id asc, b.service_id asc`;
  return rows.map((r) => ({
    serviceId: r.service_id,
    clientId: r.client_id,
    nama: r.nama,
    nilaiDiakui: r.nilai_diakui,
    nilaiBruto: r.nilai_bruto,
    pengakuan: r.pengakuan,
    masterVersionNo: Number(r.master_version_no),
  }));
}

/**
 * barisDihitung memilih, dari jadwal setiap layanan, baris bulan yang diminta.
 *
 * Layanan yang tidak mengakui apa pun di bulan itu DIBUANG, bukan dikembalikan
 * ber-nilai nol: baris nol di laporan keuangan terbaca "layanan ini berjalan
 * dan menghasilkan nol", padahal yang benar adalah "layanan ini bukan bagian
 * dari bulan ini". Layanan yang masukannya ditolak mesin (`galat`) juga tidak
 * bisa menyumbang angka — dan ia tetap terlihat lewat `accrual.jadwalSemua`,
 * tempat `galat`-nya dibaca.
 */
function barisDihitung(semua: readonly LayananJadwal[], bulan: string): BarisLaporan[] {
  const out: BarisLaporan[] = [];
  for (const j of semua) {
    if (j.jadwal === null) {
      continue;
    }
    const punya = j.jadwal.baris.some((b) => b.bulan === bulan);
    if (!punya) {
      continue;
    }
    out.push({
      serviceId: j.serviceId,
      clientId: j.clientId,
      nama: j.nama,
      nilaiDiakui: money.decimal(nilaiBulan(j, bulan)),
      nilaiBruto: j.nilaiBruto,
      pengakuan: j.pengakuan,
      masterVersionNo: j.masterVersionNo,
    });
  }
  out.sort((a, b) => (a.clientId === b.clientId
    ? (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0)
    : a.clientId < b.clientId ? -1 : 1));
  return out;
}

interface FilterKoreksi {
  bulan?: string;
  bulanDikoreksi?: string;
}

async function bacaKoreksi(sql: Queryable, f: FilterKoreksi): Promise<BarisKoreksi[]> {
  const rows = await sql<{
    id: string; bulan: string; bulan_dikoreksi: string; client_id: string | null;
    service_id: string | null; nilai: string; alasan: string; created_by: string; created_at: Date;
  }[]>`
    select id, bulan, bulan_dikoreksi, client_id, service_id, nilai, alasan, created_by, created_at
      from jurnal_koreksi
     where ${f.bulan === undefined ? sql`true` : sql`bulan = ${f.bulan}`}
       and ${f.bulanDikoreksi === undefined ? sql`true` : sql`bulan_dikoreksi = ${f.bulanDikoreksi}`}
     order by created_at asc, id asc`;
  return rows.map((r) => ({
    id: r.id,
    bulan: r.bulan,
    bulanDikoreksi: r.bulan_dikoreksi,
    clientId: r.client_id,
    serviceId: r.service_id,
    nilai: r.nilai,
    alasan: r.alasan,
    dicatatOleh: r.created_by,
    dicatatPada: tz.dateTimeString(r.created_at),
  }));
}

// --- Tutup ------------------------------------------------------------------

/**
 * tutupBulan membekukan angka pengakuan satu bulan lalu menutupnya. Satu
 * transaksi, dan tidak ada jalan kembali.
 *
 * Urutan penulisannya PENTING dan bukan selera: baris beku ditulis lebih dulu,
 * lalu stempel `ditutup_pada`/`ditutup_oleh`, BARU transisi statusnya. Sebabnya
 * `guard_periode_buku_tertutup` menolak setiap `UPDATE` atas baris yang
 * status-nya sudah `Ditutup` — jadi apa pun yang ditulis SESUDAH transisi akan
 * ditolak DB-nya sendiri. Membalik urutannya bukan bug halus: ia gagal keras,
 * dan itu memang yang diinginkan.
 *
 * Tiga gerbang keadaan, semuanya menolak dengan pesan BI-nya sendiri:
 *   - bulannya belum berakhir (angkanya masih bertambah setiap hari);
 *   - bulannya sudah tertutup;
 *   - masih ada bulan LEBIH AWAL yang terbuka — buku ditutup berurutan, kalau
 *     tidak, urutan angka bekunya berlubang dan sebuah jurnal koreksi bisa
 *     menunjuk bulan yang belum pernah dibekukan.
 */
export async function tutupBulan(sql: Sql, actor: Actor, bulan: string, now: Date = new Date()): Promise<PeriodeBuku> {
  if (!canTutupBuku(actor)) {
    throw new ForbiddenError(MSG_TUTUP_DENIED);
  }
  bulanSah(bulan);
  if (bulan >= tz.dateString(now).slice(0, 7)) {
    throw new ConflictError(MSG_BULAN_BELUM_BERAKHIR);
  }

  // Angka dihitung DI LUAR transaksi tulis: ia hanya membaca, dan menahan
  // transaksi selama seluruh katalog + audit log dibaca akan memblokir setiap
  // transisi Service yang berjalan bersamaan.
  const semua = await jadwalSemua(sql, actor);
  const baris = barisDihitung(semua, bulan);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const p = await periodeUntukTulis(tx, ex, bulan, actor.employeeId);
    if (p.status === PERIODE_DITUTUP) {
      throw new ConflictError(MSG_SUDAH_DITUTUP);
    }
    const lebihAwal = await tx<{ bulan: string }[]>`
      select bulan from periode_buku
       where status = ${PERIODE_TERBUKA} and bulan < ${bulan}
       order by bulan asc limit 1`;
    if (lebihAwal.length > 0) {
      throw new ConflictError(MSG_TUTUP_TIDAK_BERURUTAN);
    }

    for (const b of baris) {
      await tx`
        insert into periode_buku_baris
          (bulan, service_id, client_id, nilai_diakui, nilai_bruto, pengakuan, master_version_no, created_by)
        values (${bulan}, ${b.serviceId}, ${b.clientId}, ${b.nilaiDiakui}, ${b.nilaiBruto},
                ${b.pengakuan}, ${b.masterVersionNo}, ${actor.employeeId})`;
    }
    await tx`
      update periode_buku set ditutup_pada = ${now}, ditutup_oleh = ${actor.employeeId}
       where bulan = ${bulan}`;

    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE, entityType: ENTITY, table: 'periode_buku', idColumn: 'bulan',
      entityId: bulan, to: PERIODE_DITUTUP, actor,
    });
    if (!res.ok) {
      throw new ConflictError(res.message ?? MSG_SUDAH_DITUTUP);
    }
    await ex.audit.insertAudit({
      entityType: ENTITY, entityId: bulan, actorEmployeeId: actor.employeeId, action: 'tutup_buku',
      beforeJson: null,
      afterJson: {
        bulan,
        baris: baris.length,
        total_diakui: money.decimal(baris.reduce((a, b) => a + money.parse(b.nilaiDiakui), 0n)),
      },
      createdBy: actor.employeeId,
    });
    const after = await tx<PeriodeRow[]>`
      select id, bulan, status, ditutup_pada, ditutup_oleh from periode_buku where bulan = ${bulan}`;
    return toPeriode(after[0]);
  });
}

// --- Jurnal koreksi ---------------------------------------------------------

/** Masukan satu baris jurnal koreksi. */
export interface KoreksiInput {
  /** Bulan BERJALAN tempat koreksi diakui. Harus masih terbuka. */
  bulan: string;
  /** Bulan TERTUTUP yang diperbaiki. */
  bulanDikoreksi: string;
  /** DECIMAL BERTANDA. Negatif = koreksi turun. Nol ditolak. */
  nilai: string;
  alasan: string;
  clientId?: string | null;
  serviceId?: string | null;
}

/**
 * catatKoreksi menulis satu baris jurnal koreksi — satu-satunya jalan
 * memperbaiki bulan yang sudah tertutup (tuntutan 2).
 *
 * Barisnya immutable (trigger `jurnal_koreksi_no_update`/`_no_delete`), jadi
 * "membatalkan" sebuah koreksi berarti mencatat koreksi kedua yang berlawanan —
 * dan itu memang bentuk yang benar: jurnal keuangan tidak menghapus, ia
 * menambah baris yang menjelaskan.
 */
export async function catatKoreksi(sql: Sql, actor: Actor, inp: KoreksiInput, now: Date = new Date()): Promise<BarisKoreksi> {
  if (!canCatatKoreksi(actor)) {
    throw new ForbiddenError(MSG_KOREKSI_DENIED);
  }
  bulanSah(inp.bulan);
  bulanSah(inp.bulanDikoreksi);
  if (inp.bulanDikoreksi >= inp.bulan) {
    throw new ValidationError(MSG_KOREKSI_TARGET_BUKAN_LAMPAU);
  }
  const alasan = (inp.alasan ?? '').trim();
  if (alasan === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  let nilai: money.Money;
  try {
    nilai = money.parse(inp.nilai ?? '');
  } catch {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (nilai === 0n) {
    throw new ValidationError(MSG_KOREKSI_NILAI_NOL);
  }
  // Sebuah koreksi yang menunjuk layanan wajib menunjuk kliennya juga — kalau
  // tidak, laporan per klien diam-diam kehilangan koreksinya (CHECK yang sama
  // ada di DB).
  const serviceId = inp.serviceId ?? null;
  const clientId = inp.clientId ?? null;
  if (serviceId !== null && clientId === null) {
    throw new ValidationError(MSG_INCOMPLETE);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const target = await tx<{ status: string }[]>`
      select status from periode_buku where bulan = ${inp.bulanDikoreksi}`;
    if (target.length === 0 || target[0].status !== PERIODE_DITUTUP) {
      throw new ConflictError(MSG_KOREKSI_TARGET_BELUM_TUTUP);
    }
    const p = await periodeUntukTulis(tx, ex, inp.bulan, actor.employeeId);
    if (p.status === PERIODE_DITUTUP) {
      throw new ConflictError(MSG_KOREKSI_BULAN_SUDAH_TUTUP);
    }

    // Id dicetak SESUDAH seluruh gerbang wajib lolos (aturan rumah #1).
    const id = await ex.ident.identNext('JRK', now);
    await tx`
      insert into jurnal_koreksi
        (id, bulan, bulan_dikoreksi, client_id, service_id, nilai, alasan, created_by)
      values (${id}, ${inp.bulan}, ${inp.bulanDikoreksi}, ${clientId}, ${serviceId},
              ${money.decimal(nilai)}, ${alasan}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'jurnal_koreksi', entityId: id, actorEmployeeId: actor.employeeId,
      action: 'catat_koreksi', beforeJson: null,
      afterJson: {
        bulan: inp.bulan, bulan_dikoreksi: inp.bulanDikoreksi,
        nilai: money.decimal(nilai), alasan, client_id: clientId, service_id: serviceId,
      },
      createdBy: actor.employeeId,
    });
    const rows = await bacaKoreksi(tx, { bulan: inp.bulan });
    return rows.find((r) => r.id === id)!;
  });
}

// --- Internal ---------------------------------------------------------------

/**
 * periodeUntukTulis mengambil baris periode satu bulan, MEMBUATNYA kalau belum
 * ada, dan mengunci barisnya (`for update`) sampai transaksinya selesai.
 *
 * Id-nya dicetak dengan stempel waktu hari PERTAMA bulan itu, bukan `now()`,
 * supaya periode di dalam `PBK-YYYYMM-NNNN` selalu sama dengan bulan yang
 * diwakilinya — buku Maret adalah `PBK-202603-0001` walau ditutup di April.
 * Tanpa itu, id buku Maret akan menyebut April dan setiap orang yang membacanya
 * harus diingatkan untuk tidak mempercayainya.
 *
 * Lock-nya yang membuat dua orang tidak bisa menutup bulan yang sama bersamaan;
 * `sm_transition` juga mengunci, tapi ia mengunci SESUDAH baris beku ditulis,
 * dan pada titik itu lomba sudah terjadi.
 */
async function periodeUntukTulis(
  tx: Queryable,
  ex: ReturnType<typeof executors>,
  bulan: string,
  actorId: string,
): Promise<PeriodeRow> {
  const ada = await tx<PeriodeRow[]>`
    select id, bulan, status, ditutup_pada, ditutup_oleh from periode_buku
     where bulan = ${bulan} for update`;
  if (ada.length > 0) {
    return ada[0];
  }
  const awal = new Date(`${bulan}-01T00:00:00+07:00`);
  const id = await ex.ident.identNext('PBK', awal);
  await tx`insert into periode_buku (id, bulan, created_by) values (${id}, ${bulan}, ${actorId})`;
  const baru = await tx<PeriodeRow[]>`
    select id, bulan, status, ditutup_pada, ditutup_oleh from periode_buku
     where bulan = ${bulan} for update`;
  return baru[0];
}

/**
 * gerbangBaca memakai gerbang yang sama dengan jadwal accrual — satu himpunan
 * peran untuk satu subjek (pengakuan pendapatan), bukan dua yang harus diingat
 * agar tetap sama.
 */
function gerbangBaca(actor: Actor): void {
  if (!canBacaAccrual(actor)) {
    throw new AccrualForbiddenError();
  }
}

function bulanSah(bulan: string): void {
  if (typeof bulan !== 'string' || !BULAN_RE.test(bulan)) {
    throw new ValidationError(MSG_BULAN_TAK_SAH);
  }
}
