/**
 * Jahitan mesin accrual — merakit `core.accrual.LayananTerbeli` dari data nyata
 * dan menjadwalkan pengakuan pendapatan per layanan terbeli (Gelombang D).
 *
 * APA MODUL INI ADALAH. Satu pembaca. Mesin hitungnya ada di `@cdps/core`
 * (`accrual.jadwalkan`, murni, nol DB); yang ada di sini hanyalah **dari mana
 * setiap masukannya datang**, dan itu pertanyaan yang sepenuhnya tentang skema
 * CDPS. Memisahkan keduanya bukan selera arsitektur: aturan uangnya harus bisa
 * diuji tanpa Postgres, dan pemetaan skemanya harus diuji DENGAN Postgres —
 * dan satu tes yang memanggil KEDUA sisi sungguhan (`accrual.reals.test.ts`)
 * adalah satu-satunya yang membuktikan keduanya masih bertemu (aturan kerja #1).
 *
 * ⚠️ SEMUA TANGGALNYA DITURUNKAN DARI `audit_log`, BUKAN DARI KOLOM. Sebuah
 * `SVC-` tidak punya kolom tanggal mulai, tanggal selesai, riwayat hold, atau
 * tanggal void — dan itu bukan kekurangan yang ditambal di sini dengan empat
 * kolom baru. Riwayat transisinya sudah ada, immutable, dan satu-satunya sumber
 * yang tidak bisa berbeda dari status yang sedang berjalan (aturan rumah #3:
 * *"All duration metrics derive from these timestamps"*). Pola pembacaannya
 * meniru `ads.computeTotalHariHold` yang sudah dipakai Ads Management Date.
 *
 *   mulai jalan     transisi PERTAMA `-> [In Execution]`
 *   hold            setiap pasangan `-> [On Hold]` … `-> [In Execution]`
 *   void            transisi `-> [Cancelled — Service Voided]`
 *   selesai         transisi `-> Done`
 *   penjualan       `services.created_at` (baris ini lahir di Closing)
 *
 * `[Hold Requested]` **BUKAN** hold: migrasi `20260814080000` menyatakannya
 * ACTIVE, dan pengakuan pendapatan berhenti saat Head MENYETUJUI hold, bukan
 * saat AM memintanya. Penolakan hold (`[Hold Requested] -> [In Execution]`)
 * karena itu juga tidak pernah tercatat sebagai hold: pasangan hanya dibuka
 * oleh `-> [On Hold]`.
 *
 * ⚠️ QTY MENGALIKAN DURASI, TIDAK PERNAH MENGALIKAN UANG. `services
 * .standard_price` menyimpan `proposed_price` hasil negosiasi per baris, dan
 * Σ baris itulah `transactions.total_agreed_value` (`sales.close`). Jadi
 * nilainya SUDAH mencakup qty; mengalikannya lagi di sini akan membuat Σ jadwal
 * accrual melebihi nilai deal yang benar-benar disepakati. Qty dibaca HANYA
 * untuk `durasiTotalBulan`, dan tesnya menyebut hal itu eksplisit.
 *
 * Qty-nya sendiri datang dari `qualified_form_services.quantity` lewat
 * `clients.winning_attempt_id`, karena `negotiation_proposal_lines` (yang
 * melahirkan `services`) tidak punya kolom qty. Layanan yang tidak punya baris
 * QFS — mis. yang lahir dari perpanjangan — memakai qty 1, yang untuk
 * `qty_menambah='volume'` tidak mengubah apa pun sama sekali.
 */

import { accrual as core, money, permission, tz } from '@cdps/core';
import { type Queryable } from '@cdps/db';
// Gerbang bacanya SENGAJA fungsi yang sama dengan antrean Finance, bukan
// salinan set peran yang sama: jadwal accrual adalah worklist Finance (Finance
// segala level, OD, Director), dan dua daftar untuk satu aturan akan berbeda
// pada perubahan pertama yang hanya diingat di salah satunya.
import { canReadFinanceQueue } from './finance';
import {
  SERVICE_DONE,
  SERVICE_IN_EXECUTION,
  SERVICE_ON_HOLD,
  SERVICE_VOIDED,
} from './client';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** Layanan yang diminta tidak ada. */
export class ServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`service not found: ${serviceId}`);
    this.name = 'AccrualServiceNotFoundError';
  }
}

/** Aktor tidak berhak membaca jadwal accrual (verbatim BI). */
export class ForbiddenError extends Error {
  constructor() {
    super(MSG_ACCRUAL_DENIED);
    this.name = 'AccrualForbiddenError';
  }
}

/** Pesan BI persis untuk pembacaan jadwal accrual tanpa hak. */
export const MSG_ACCRUAL_DENIED = '[anda tidak memiliki akses ke laporan pengakuan pendapatan]';

/**
 * canBacaAccrual — Finance segala level, OD, atau Director. Ia MEMANGGIL
 * `finance.canReadFinanceQueue` alih-alih mengulang setnya, jadi kalau suatu
 * hari set itu berubah, jadwal accrual ikut berubah bersamanya.
 */
export function canBacaAccrual(actor: Actor): boolean {
  return canReadFinanceQueue(actor);
}

/**
 * Jadwal pengakuan satu layanan terbeli, beserta seluruh bahan yang
 * menghasilkannya. Bahannya ikut dikembalikan karena aturan rumah #4 menuntut
 * angka turunan bisa ditelusuri: sebuah baris laporan yang menyebut Rp 17 juta
 * di bulan Maret harus bisa menunjukkan hari mulai, durasi, dan hold yang
 * melahirkan angka itu — tanpa membuka `audit_log` sendiri.
 */
export interface LayananJadwal {
  serviceId: string;
  clientId: string;
  nama: string;
  status: string;
  masterServiceId: string;
  masterVersionNo: number;
  pengakuan: core.Pengakuan;
  /** DECIMAL(15,2) — nilai BRUTO baris ini (D-4: nol hitungan PPN di sini). */
  nilaiBruto: string;
  /** Qty yang dibeli. Mengalikan DURASI, tidak pernah mengalikan uang. */
  qty: string;
  /** Durasi katalog per satu qty (BULAN kalender). null = sekali jadi. */
  durasiBulan: number | null;
  /** Durasi total sesudah qty diterapkan (`core.durasiTotalBulan`). */
  durasiBulanTotal: number | null;
  tanggalMulai: string | null;
  tanggalSelesai: string | null;
  tanggalVoid: string | null;
  tanggalPenjualan: string;
  holds: readonly core.Hold[];
  /**
   * Jadwalnya, atau `null` kalau mesin MENOLAK masukannya. `null` di sini tidak
   * pernah berarti "kosong": `galat` selalu mengatakan sebabnya, karena baris
   * yang hilang dari laporan keuangan tanpa penjelasan tidak bisa dibedakan
   * dari layanan yang memang tidak menghasilkan apa pun (aturan kerja #4).
   */
  jadwal: core.Jadwal | null;
  /** Kenapa `jadwal` null. Selalu null saat `jadwal` ada, dan sebaliknya. */
  galat: string | null;
}

interface ServiceRow {
  id: string;
  client_id: string;
  name: string;
  status: string;
  standard_price: string;
  created_at: Date;
  master_service_id: string;
  master_version_no: number;
  durasi_bulan: number | null;
  qty_menambah: string;
  pengakuan: string;
  quantity: string;
}

const SERVICE_COLUMNS = `
    s.id, s.client_id, s.name, s.status, s.standard_price, s.created_at,
    s.master_service_id, s.master_version_no,
    msv.durasi_bulan, msv.qty_menambah, msv.pengakuan,
    coalesce(qfs.quantity, 1) as quantity`;

/**
 * jadwalLayanan menjadwalkan SATU layanan terbeli.
 *
 * Versi MSL yang dibaca adalah versi yang DIPIN pada baris `services`
 * (`master_service_id`/`master_version_no`), bukan versi terbaru — sama seperti
 * `ads.computeAdsManagementEndDate`. Kalau Sales Head mengubah `pengakuan`
 * sebuah layanan besok, engagement yang sudah jalan tetap dijadwalkan dengan
 * penanda yang berlaku saat ia di-closing (aturan rumah #3/#4).
 */
export async function jadwalLayanan(sql: Queryable, actor: Actor, serviceId: string): Promise<LayananJadwal> {
  if (!canBacaAccrual(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<ServiceRow[]>`
    select ${sql.unsafe(SERVICE_COLUMNS)}
      from services s
      join master_service_versions msv
        on msv.service_id = s.master_service_id and msv.version_no = s.master_version_no
      join clients c on c.id = s.client_id
      left join qualified_form_services qfs
        on qfs.attempt_id = c.winning_attempt_id and qfs.master_service_id = s.master_service_id
     where s.id = ${serviceId}`;
  if (rows.length === 0) {
    throw new ServiceNotFoundError(serviceId);
  }
  const riwayat = await riwayatTransisi(sql, [serviceId]);
  return rakit(rows[0], riwayat.get(serviceId) ?? kosongRiwayat());
}

/**
 * jadwalKlien menjadwalkan SEMUA layanan terbeli satu klien, urut lahirnya.
 *
 * Layanan yang di-void ikut dikembalikan, tidak disaring: nilai yang HANGUS
 * (D-1) adalah angka yang laporan keuangan justru perlu sebut, dan menyaringnya
 * di sini akan membuat Σ jadwal tidak lagi bisa diadu ke nilai deal.
 */
export async function jadwalKlien(sql: Queryable, actor: Actor, clientId: string): Promise<LayananJadwal[]> {
  if (!canBacaAccrual(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<ServiceRow[]>`
    select ${sql.unsafe(SERVICE_COLUMNS)}
      from services s
      join master_service_versions msv
        on msv.service_id = s.master_service_id and msv.version_no = s.master_version_no
      join clients c on c.id = s.client_id
      left join qualified_form_services qfs
        on qfs.attempt_id = c.winning_attempt_id and qfs.master_service_id = s.master_service_id
     where s.client_id = ${clientId}
     order by s.created_at asc, s.id asc`;
  // SATU kueri riwayat untuk semua layanan, bukan satu per baris: jumlah kueri
  // tidak boleh tumbuh bersama jumlah layanan (disiplin P-1, lihat
  // `perf_n1.test.ts`). Klien dengan lima layanan dan klien dengan lima puluh
  // sama-sama dua kueri — dan penutupan buku bulanan D-3 akan memanggil ini
  // untuk setiap klien sekaligus.
  const riwayat = await riwayatTransisi(sql, rows.map((r) => r.id));
  return rows.map((r) => rakit(r, riwayat.get(r.id) ?? kosongRiwayat()));
}

/**
 * jadwalSemua menjadwalkan SETIAP layanan terbeli seluruh klien — masukan
 * penutupan buku bulanan (D-3).
 *
 * ⚠️ SENGAJA TANPA SARINGAN BULAN. Versi pertama fungsi ini menerima
 * `sampaiBulan` dan membuang layanan yang `created_at`-nya lebih baru daripada
 * akhir bulan itu, dengan alasan yang terdengar benar: layanan yang di-closing
 * bulan Mei tidak bisa mengakui apa pun di bulan Maret. Saringan itu DICABUT.
 *
 * Alasannya bukan performa, melainkan kelas kesalahannya: sebuah saringan pada
 * laporan KEUANGAN yang bisa membuang baris akan, saat ia keliru, menghasilkan
 * laporan yang terlihat lengkap dan berjumlah kurang — dan tidak ada yang bisa
 * melihat bedanya. Ia langsung terbukti bisa keliru: hari pengakuan diturunkan
 * dari `audit_log`, dan sebuah baris transisi bisa bertanggal lebih awal
 * daripada baris `services`-nya (koreksi riwayat, impor, backfill). Yang benar
 * adalah membaca semuanya lalu memilih bulannya — dua kueri, apa pun jumlah
 * layanannya (lihat catatan P-1 di `jadwalKlien`). Kalau suatu hari volumenya
 * menuntut batas, batasnya harus datang dari `audit_log` (bulan transisi),
 * bukan dari `services.created_at`.
 */
export async function jadwalSemua(sql: Queryable, actor: Actor): Promise<LayananJadwal[]> {
  if (!canBacaAccrual(actor)) {
    throw new ForbiddenError();
  }
  const rows = await sql<ServiceRow[]>`
    select ${sql.unsafe(SERVICE_COLUMNS)}
      from services s
      join master_service_versions msv
        on msv.service_id = s.master_service_id and msv.version_no = s.master_version_no
      join clients c on c.id = s.client_id
      left join qualified_form_services qfs
        on qfs.attempt_id = c.winning_attempt_id and qfs.master_service_id = s.master_service_id
     order by s.created_at asc, s.id asc`;
  const riwayat = await riwayatTransisi(sql, rows.map((r) => r.id));
  return rows.map((r) => rakit(r, riwayat.get(r.id) ?? kosongRiwayat()));
}

/**
 * nilaiBulan mengembalikan berapa yang diakui satu layanan DI SATU BULAN
 * kalender, `0n` kalau bulan itu tidak ada di jadwalnya.
 *
 * Nol dan ketiadaan baris sengaja DISAMAKAN di sini, dan hanya di sini: fungsi
 * ini menjawab pertanyaan "berapa", dan jawabannya nol. Yang membedakan
 * "diperiksa, hasilnya nol" dari "layanan ini tidak ada di bulan itu" adalah
 * ADA-TIDAKNYA baris yang dibekukan — pertanyaan berbeda, dan `jadwal.baris`
 * yang menjawabnya.
 */
export function nilaiBulan(j: LayananJadwal, bulan: string): money.Money {
  return j.jadwal?.baris.find((b) => b.bulan === bulan)?.nilai ?? 0n;
}

/** rakit merakit satu `LayananJadwal` dari baris `services` + riwayat auditnya. */
function rakit(r: ServiceRow, riwayat: Riwayat): LayananJadwal {
  const pengakuan = r.pengakuan as core.Pengakuan;
  const qty = r.quantity;
  const tanggalPenjualan = tz.dateString(r.created_at);

  const dasar = {
    serviceId: r.id,
    clientId: r.client_id,
    nama: r.name,
    status: r.status,
    masterServiceId: r.master_service_id,
    masterVersionNo: Number(r.master_version_no),
    pengakuan,
    nilaiBruto: r.standard_price,
    qty,
    durasiBulan: r.durasi_bulan === null ? null : Number(r.durasi_bulan),
    tanggalMulai: riwayat.mulai,
    tanggalSelesai: riwayat.selesai,
    tanggalVoid: riwayat.voidPada,
    tanggalPenjualan,
    holds: riwayat.holds,
  };

  // Qty datang dari kolom numeric(15,2) yang diisi manusia, jadi ia bisa
  // pecahan — dan qty pecahan untuk layanan ber-`qty_menambah='durasi'` tidak
  // punya arti ("2,5 periode"). Mesin murni menolaknya; yang dilakukan di sini
  // adalah MENYAMPAIKAN penolakan itu sebagai satu baris ber-`galat`, bukan
  // meruntuhkan laporan satu klien karena satu baris, dan bukan pula
  // membulatkannya diam-diam.
  let durasiBulanTotal: number | null;
  try {
    durasiBulanTotal = core.durasiTotalBulan(
      dasar.durasiBulan,
      r.qty_menambah as core.QtyMenambah,
      Number(qty),
    );
  } catch (e) {
    return { ...dasar, durasiBulanTotal: null, jadwal: null, galat: pesanGalat(e) };
  }

  try {
    const jadwal = core.jadwalkan({
      // Nilai BRUTO apa adanya (D-4). Qty TIDAK dikalikan ke sini — lihat
      // header berkas: nilainya sudah hasil negosiasi per baris, dan Σ-nya
      // adalah `transactions.total_agreed_value`.
      nilaiBruto: money.parse(r.standard_price),
      pengakuan,
      tanggalMulai: riwayat.mulai,
      durasiBulanTotal,
      holds: riwayat.holds,
      tanggalVoid: riwayat.voidPada,
      tanggalSelesai: riwayat.selesai,
      tanggalPenjualan,
    });
    return { ...dasar, durasiBulanTotal, jadwal, galat: null };
  } catch (e) {
    return { ...dasar, durasiBulanTotal, jadwal: null, galat: pesanGalat(e) };
  }
}

interface Riwayat {
  mulai: string | null;
  selesai: string | null;
  voidPada: string | null;
  holds: core.Hold[];
}

/** Riwayat kosong — layanan yang belum pernah bertransisi sama sekali. */
function kosongRiwayat(): Riwayat {
  return { mulai: null, selesai: null, voidPada: null, holds: [] };
}

/**
 * riwayatTransisi membaca riwayat transisi `service` dari `audit_log` untuk
 * SEKUMPULAN layanan sekaligus, dan menurunkan keempat tanggal yang mesin
 * accrual butuhkan per layanan.
 *
 * Satu kueri untuk n layanan, bukan n kueri: lihat catatan P-1 di `jadwalKlien`.
 *
 * Urutannya `entity_id, created_at, id` — `id` sebagai pemecah seri karena dua
 * transisi dalam satu transaksi bisa berbagi `now()` yang sama persis, dan
 * urutan yang salah di sana akan memasangkan hold dengan resume yang bukan
 * miliknya.
 *
 * Transisi `-> [In Execution]` PERTAMA adalah hari mulai jalan, bukan resume:
 * tidak ada hold yang sedang terbuka saat itu, jadi pasangan hold-nya tidak
 * pernah bisa keliru membacanya. Hold yang belum ditutup (layanan sedang
 * `[On Hold]` sekarang) dikembalikan dengan `selesai: null` — mesin murni yang
 * memutuskan apa artinya, dan ia memotong jadwalnya alih-alih menebak.
 */
async function riwayatTransisi(sql: Queryable, serviceIds: readonly string[]): Promise<Map<string, Riwayat>> {
  const out = new Map<string, Riwayat>();
  if (serviceIds.length === 0) {
    return out;
  }
  const rows = await sql<{ entity_id: string; action: string; created_at: Date }[]>`
    select entity_id, action, created_at from audit_log
     where entity_type = 'service' and entity_id in ${sql(serviceIds as string[])}
       and action like 'transition:%'
     order by entity_id asc, created_at asc, id asc`;

  const holdMulai = new Map<string, string>();
  for (const row of rows) {
    let r = out.get(row.entity_id);
    if (r === undefined) {
      r = kosongRiwayat();
      out.set(row.entity_id, r);
    }
    const tanggal = tz.dateString(row.created_at);
    if (row.action.endsWith(`->${SERVICE_ON_HOLD}`)) {
      // Hold kedua tanpa resume di antaranya tidak bisa terjadi lewat mesin
      // status (tidak ada edge `[On Hold] -> [On Hold]`), tapi kalau ia toh
      // ada, yang PERTAMA yang benar: pengakuan berhenti di situ.
      if (!holdMulai.has(row.entity_id)) {
        holdMulai.set(row.entity_id, tanggal);
      }
      continue;
    }
    if (row.action.endsWith(`->${SERVICE_IN_EXECUTION}`)) {
      if (r.mulai === null) {
        r.mulai = tanggal;
      } else {
        const mulaiHold = holdMulai.get(row.entity_id);
        if (mulaiHold !== undefined) {
          r.holds.push({ mulai: mulaiHold, selesai: tanggal });
          holdMulai.delete(row.entity_id);
        }
      }
      continue;
    }
    if (row.action.endsWith(`->${SERVICE_VOIDED}`)) {
      r.voidPada ??= tanggal;
      continue;
    }
    if (row.action.endsWith(`->${SERVICE_DONE}`)) {
      r.selesai ??= tanggal;
    }
  }
  // Hold yang masih terbuka pada akhir riwayat: layanan sedang `[On Hold]`.
  for (const [id, mulai] of holdMulai) {
    out.get(id)!.holds.push({ mulai, selesai: null });
  }
  return out;
}

/** pesanGalat mengambil pesan yang bisa dibaca dari apa pun yang dilempar. */
function pesanGalat(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
