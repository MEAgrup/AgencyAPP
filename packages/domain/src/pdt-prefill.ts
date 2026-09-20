/**
 * PDT — pembaca fakta bersama per `client_platform_id` + periode (G3-01).
 *
 * Rule 33 (PRD §3.7): setiap field Riset Awal/Section B/Plan/Brief/WRR yang
 * punya sumber di fakta wajib terisi otomatis DAN membawa **tautan ke batch
 * sumbernya**. Modul ini adalah SATU jalur baca dipakai ulang oleh
 * G3-02..G3-06 (`docs/backlog/PDT_BACKLOG.md` §3) — bukan lima query ad-hoc
 * berbeda per tiket.
 *
 * Bentuk baliknya SENGAJA tidak seragam per tabel:
 * - `pdt_fact_shop_daily` berbutir HARIAN (banyak baris/bulan) — pembaca ini
 *   MENJUMLAHKAN ke satu agregat bulanan (pola sama `bacaKpiShopDaily`/
 *   `bacaKpiTiktokNet` di `pdt.ts`, dipakai laporan G2). `cr` SENGAJA tidak
 *   dijumlah (rasio harian, bukan aditif) — pemanggil menurunkan
 *   `pesanan/pengunjung` sendiri sesuai Rule 7 (pembagian nol ⇒ `—`).
 * - `pdt_fact_sku_period`/`pdt_fact_creator_period`/`pdt_fact_ads`/
 *   `pdt_fact_kesehatan_penalti` SUDAH berbutir bulanan di skema aslinya (kunci
 *   unik masing-masing sudah menyertakan `periode`) — pembaca ini mengembalikan
 *   DAFTAR baris apa adanya, pemanggil (G3-03/05/06/02) menjumlah/menurunkan
 *   sesuai kebutuhan metrik masing-masing (mis. distribusi kuadran SKU tidak
 *   bisa diringkas jadi satu angka).
 * - `pdt_fact_content` (video/live) berbutir per-konten (satu baris = satu
 *   video/sesi live, ditandai `periode` bulan tulis — lihat migrasi
 *   `20261029010000`) — daftar baris juga, G3-04/05 menjumlah sesuai jenis.
 *
 * `batchId`/`parserVersi` melekat APA ADANYA di setiap baris (kolom asli
 * tabel fakta) — modul ini TIDAK meringkasnya jadi satu "batch kanonik" per
 * agregat: Rule 1 ("satu paket = satu toko = satu periode") membuat SATU
 * batch per (client_platform_id, periode) jadi kasus normal, tapi pembaca
 * `pdt_fact_shop_daily` (satu-satunya yang menjumlah lintas baris di sini)
 * tetap mengembalikan `sumberBatch` sebagai DAFTAR kombinasi
 * `(batchId, parserVersi)` distinct yang benar-benar berkontribusi —
 * menyembunyikan kemungkinan campuran lintas-batch (mis. G3-08 jalur koreksi,
 * Rule 36) akan lebih berbahaya daripada menampilkannya apa adanya.
 *
 * `bacaPeriodeTerverifikasiTerbaru` (G3-07) melengkapi pembaca-pembaca di atas
 * dengan sisi "periode mana yang tersedia": daftar N batch `verified` TERBARU
 * untuk sebuah `client_platform_id`, dipakai pemanggil untuk menyusun rentang
 * `periodeAwalBulan` yang di-loop ke `bacaFaktaShopDaily` dkk.
 */
import type { Queryable } from '@cdps/db';

export interface PdtSumberBatch {
  batchId: number;
  parserVersi: number;
}

export interface PdtFaktaShopDailyAgregat {
  /** Jumlah baris harian yang berkontribusi (0 ⇒ pemanggil dapat `null`, bukan objek ini). */
  hari: number;
  gmv: number;
  pesanan: number;
  produkTerjual: number | null;
  pengunjung: number | null;
  produkDiklik: number | null;
  pembeli: number | null;
  pembeliBaru: number | null;
  refund: number | null;
  /** Kombinasi batch+parser_versi distinct yang menyumbang baris di atas (Rule 33). */
  sumberBatch: readonly PdtSumberBatch[];
}

/**
 * Agregat bulanan `pdt_fact_shop_daily` — dipakai G3-02 (B-1 GMV/pesanan,
 * `refundRatePersen`, `pengunjungPerBulan`/`conversionRatePersen`) dan G3-07
 * (riwayat GMV 6 bulan). `basis` WAJIB eksplisit (Rule 15/16: `net`/`dibuat`/
 * `siap_dikirim`/`dibayar` TIDAK PERNAH dijumlah lintas basis).
 */
export async function bacaFaktaShopDaily(
  sql: Queryable,
  clientPlatformId: number,
  periodeAwalBulan: string,
  basis: 'net' | 'dibuat' | 'siap_dikirim' | 'dibayar',
): Promise<PdtFaktaShopDailyAgregat | null> {
  const [row] = await sql<
    {
      hari: number;
      gmv: string;
      pesanan: string;
      produk_terjual_n: number;
      produk_terjual: string;
      pengunjung_n: number;
      pengunjung: string;
      produk_diklik_n: number;
      produk_diklik: string;
      pembeli_n: number;
      pembeli: string;
      pembeli_baru_n: number;
      pembeli_baru: string;
      refund_n: number;
      refund: string;
    }[]
  >`
    select count(*)::int as hari,
           coalesce(sum(gmv), 0) as gmv,
           coalesce(sum(pesanan), 0) as pesanan,
           count(produk_terjual)::int as produk_terjual_n, coalesce(sum(produk_terjual), 0) as produk_terjual,
           count(pengunjung)::int as pengunjung_n, coalesce(sum(pengunjung), 0) as pengunjung,
           count(produk_diklik)::int as produk_diklik_n, coalesce(sum(produk_diklik), 0) as produk_diklik,
           count(pembeli)::int as pembeli_n, coalesce(sum(pembeli), 0) as pembeli,
           count(pembeli_baru)::int as pembeli_baru_n, coalesce(sum(pembeli_baru), 0) as pembeli_baru,
           count(refund)::int as refund_n, coalesce(sum(refund), 0) as refund
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = ${basis}
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')`;
  if (row.hari === 0) return null;

  const sumberBatch = await sql<PdtSumberBatch[]>`
    select distinct batch_id as "batchId", parser_versi as "parserVersi"
      from pdt_fact_shop_daily
     where client_platform_id = ${clientPlatformId}
       and basis = ${basis}
       and tanggal >= ${periodeAwalBulan}::date
       and tanggal < (${periodeAwalBulan}::date + interval '1 month')
     order by "batchId"`;

  return {
    hari: row.hari,
    gmv: Number(row.gmv),
    pesanan: Number(row.pesanan),
    produkTerjual: row.produk_terjual_n === 0 ? null : Number(row.produk_terjual),
    pengunjung: row.pengunjung_n === 0 ? null : Number(row.pengunjung),
    produkDiklik: row.produk_diklik_n === 0 ? null : Number(row.produk_diklik),
    pembeli: row.pembeli_n === 0 ? null : Number(row.pembeli),
    pembeliBaru: row.pembeli_baru_n === 0 ? null : Number(row.pembeli_baru),
    refund: row.refund_n === 0 ? null : Number(row.refund),
    sumberBatch,
  };
}

export interface PdtFaktaSkuPeriodeBaris extends PdtSumberBatch {
  /** `null` untuk baris level-produk-induk (mis. `tt_product_analytics`) — identitasnya `platformProductId`, bukan varian (G1-09-2BII-ADS-CPC-SKU). */
  skuId: number | null;
  /** Identitas produk induk disalin langsung dari sumber — SELALU terisi untuk baris `skuId: null` (`ck_pdt_fact_sku_period_identitas`). */
  platformProductId: string | null;
  /** Tampilan UI SAJA (Rule 20) — bukan kunci, boleh `null` untuk baris lama tanpa sumber nama. */
  namaProduk: string | null;
  gmv: number | null;
  gmvDariKreator: number | null;
  gmvVideoPenjual: number | null;
  gmvLivePenjual: number | null;
  pesanan: number | null;
  pesananSku: number | null;
  produkTerjual: number | null;
  impresi: number | null;
  klik: number | null;
  ctr: number | null;
  ctor: number | null;
  atc: number | null;
  cr: number | null;
  refund: number | null;
  kuadran: string | null;
}

/** Baris `pdt_fact_sku_period` bulan berjalan (satu baris/SKU) — dipakai G3-03 (distribusi kuadran/Pareto). */
export async function bacaFaktaSkuPeriode(
  sql: Queryable,
  clientPlatformId: number,
  periodeAwalBulan: string,
  basis: 'net' | 'dibuat' | 'siap_dikirim' | 'dibayar',
): Promise<PdtFaktaSkuPeriodeBaris[]> {
  const rows = await sql<
    {
      sku_id: number | null;
      platform_product_id: string | null;
      nama_produk: string | null;
      gmv: string | null;
      gmv_dari_kreator: string | null;
      gmv_video_penjual: string | null;
      gmv_live_penjual: string | null;
      pesanan: number | null;
      pesanan_sku: number | null;
      produk_terjual: number | null;
      impresi: number | null;
      klik: number | null;
      ctr: string | null;
      ctor: string | null;
      atc: number | null;
      cr: string | null;
      refund: string | null;
      kuadran: string | null;
      batch_id: number;
      parser_versi: number;
    }[]
  >`
    select sku_id, platform_product_id, nama_produk, gmv, gmv_dari_kreator, gmv_video_penjual,
           gmv_live_penjual, pesanan, pesanan_sku, produk_terjual, impresi, klik, ctr, ctor,
           atc, cr, refund, kuadran, batch_id, parser_versi
      from pdt_fact_sku_period
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and basis = ${basis}
     order by sku_id`;

  return rows.map((r) => ({
    skuId: r.sku_id,
    platformProductId: r.platform_product_id,
    namaProduk: r.nama_produk,
    gmv: r.gmv === null ? null : Number(r.gmv),
    gmvDariKreator: r.gmv_dari_kreator === null ? null : Number(r.gmv_dari_kreator),
    gmvVideoPenjual: r.gmv_video_penjual === null ? null : Number(r.gmv_video_penjual),
    gmvLivePenjual: r.gmv_live_penjual === null ? null : Number(r.gmv_live_penjual),
    pesanan: r.pesanan,
    pesananSku: r.pesanan_sku,
    produkTerjual: r.produk_terjual,
    impresi: r.impresi,
    klik: r.klik,
    ctr: r.ctr === null ? null : Number(r.ctr),
    ctor: r.ctor === null ? null : Number(r.ctor),
    atc: r.atc,
    cr: r.cr === null ? null : Number(r.cr),
    refund: r.refund === null ? null : Number(r.refund),
    kuadran: r.kuadran,
    batchId: r.batch_id,
    parserVersi: r.parser_versi,
  }));
}

export interface PdtFaktaContentBaris extends PdtSumberBatch {
  platformContentId: string;
  creatorPlatformId: string | null;
  creatorHandle: string | null;
  isAkunToko: boolean;
  waktuPosting: string | null;
  skuId: number | null;
  vv: number | null;
  likes: number | null;
  komentar: number | null;
  dibagikan: number | null;
  pengikutBaru: number | null;
  produkDilihat: number | null;
  klikProduk: number | null;
  gmv: number | null;
  durasiDetik: number | null;
}

/** Baris `pdt_fact_content` bulan berjalan (satu baris/konten) — dipakai G3-04 (video/live) dan G3-05 (join creator_handle). */
export async function bacaFaktaContent(
  sql: Queryable,
  clientPlatformId: number,
  periodeAwalBulan: string,
  jenis: 'video' | 'live',
  isAkunToko?: boolean,
): Promise<PdtFaktaContentBaris[]> {
  const rows = await sql<
    {
      platform_content_id: string;
      creator_platform_id: string | null;
      creator_handle: string | null;
      is_akun_toko: boolean;
      waktu_posting: string | null;
      sku_id: number | null;
      vv: number | null;
      likes: number | null;
      komentar: number | null;
      dibagikan: number | null;
      pengikut_baru: number | null;
      produk_dilihat: number | null;
      klik_produk: number | null;
      gmv: string | null;
      durasi_detik: number | null;
      batch_id: number;
      parser_versi: number;
    }[]
  >`
    select platform_content_id, creator_platform_id, creator_handle, is_akun_toko, waktu_posting,
           sku_id, vv, likes, komentar, dibagikan, pengikut_baru, produk_dilihat, klik_produk,
           gmv, durasi_detik, batch_id, parser_versi
      from pdt_fact_content
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       and jenis = ${jenis}
       ${isAkunToko === undefined ? sql`` : sql`and is_akun_toko = ${isAkunToko}`}
     order by platform_content_id`;

  return rows.map((r) => ({
    platformContentId: r.platform_content_id,
    creatorPlatformId: r.creator_platform_id,
    creatorHandle: r.creator_handle,
    isAkunToko: r.is_akun_toko,
    waktuPosting: r.waktu_posting,
    skuId: r.sku_id,
    vv: r.vv,
    likes: r.likes,
    komentar: r.komentar,
    dibagikan: r.dibagikan,
    pengikutBaru: r.pengikut_baru,
    produkDilihat: r.produk_dilihat,
    klikProduk: r.klik_produk,
    gmv: r.gmv === null ? null : Number(r.gmv),
    durasiDetik: r.durasi_detik,
    batchId: r.batch_id,
    parserVersi: r.parser_versi,
  }));
}

export interface PdtFaktaCreatorPeriodeBaris extends PdtSumberBatch {
  creatorHandle: string;
  gmv: number | null;
  gmvLive: number | null;
  gmvVideo: number | null;
  pesananTeratribusi: number | null;
  aov: number | null;
  ctor: number | null;
  jumlahLive: number | null;
  jumlahVideo: number | null;
  sampelTerkirim: number | null;
}

/** Baris `pdt_fact_creator_period` bulan berjalan (satu baris/kreator) — dipakai G3-05 (B-6 afiliasi/kreator). */
export async function bacaFaktaCreatorPeriode(
  sql: Queryable,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<PdtFaktaCreatorPeriodeBaris[]> {
  const rows = await sql<
    {
      creator_handle: string;
      gmv: string | null;
      gmv_live: string | null;
      gmv_video: string | null;
      pesanan_teratribusi: number | null;
      aov: string | null;
      ctor: string | null;
      jumlah_live: number | null;
      jumlah_video: number | null;
      sampel_terkirim: number | null;
      batch_id: number;
      parser_versi: number;
    }[]
  >`
    select creator_handle, gmv, gmv_live, gmv_video, pesanan_teratribusi, aov, ctor,
           jumlah_live, jumlah_video, sampel_terkirim, batch_id, parser_versi
      from pdt_fact_creator_period
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
     order by creator_handle`;

  return rows.map((r) => ({
    creatorHandle: r.creator_handle,
    gmv: r.gmv === null ? null : Number(r.gmv),
    gmvLive: r.gmv_live === null ? null : Number(r.gmv_live),
    gmvVideo: r.gmv_video === null ? null : Number(r.gmv_video),
    pesananTeratribusi: r.pesanan_teratribusi,
    aov: r.aov === null ? null : Number(r.aov),
    ctor: r.ctor === null ? null : Number(r.ctor),
    jumlahLive: r.jumlah_live,
    jumlahVideo: r.jumlah_video,
    sampelTerkirim: r.sampel_terkirim,
    batchId: r.batch_id,
    parserVersi: r.parser_versi,
  }));
}

export interface PdtFaktaAdsBaris extends PdtSumberBatch {
  sumber: string;
  kampanyeId: string;
  skuId: number | null;
  contentId: number | null;
  biaya: number;
  tayangan: number | null;
  klik: number | null;
  pesananSku: number | null;
  gmv: number | null;
  roas: number | null;
  /**
   * G3-06 — teks MENTAH konfigurasi kampanye dari berkas, apa adanya.
   * Pemetaannya ke `CAMPAIGN_TYPES` ada di `strategi.petakanTipeKampanye`
   * (taksonomi punya satu rumah), dan dilakukan saat DIBACA, bukan disimpan.
   * `null` = berkas sumbernya tidak membawa kolomnya (termasuk seluruh baris
   * yang ditulis sebelum migrasi `20261120010000`).
   */
  tipeKampanyeSumber: string | null;
}

/**
 * Baris `pdt_fact_ads` bulan berjalan (satu baris/kampanye) — dipakai G3-06
 * (B-4/B-5 belanja+ROAS+kampanye). `sumber` opsional menyaring modul parser
 * tertentu (pola sama `bacaKanalShopee` di `pdt.ts`, mis. `shopee_ads_cpc`/
 * `shopee_ads_search`/`shopee_ads_live`) — tanpa filter, seluruh sumber ikut.
 */
export async function bacaFaktaAds(
  sql: Queryable,
  clientPlatformId: number,
  periodeAwalBulan: string,
  sumber?: readonly string[],
): Promise<PdtFaktaAdsBaris[]> {
  const rows = await sql<
    {
      sumber: string;
      kampanye_id: string;
      sku_id: number | null;
      content_id: number | null;
      biaya: string;
      tayangan: number | null;
      klik: number | null;
      pesanan_sku: number | null;
      gmv: string | null;
      roas: string | null;
      tipe_kampanye_sumber: string | null;
      batch_id: number;
      parser_versi: number;
    }[]
  >`
    select sumber, kampanye_id, sku_id, content_id, biaya, tayangan, klik, pesanan_sku, gmv, roas,
           tipe_kampanye_sumber, batch_id, parser_versi
      from pdt_fact_ads
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
       ${sumber && sumber.length > 0 ? sql`and sumber = any(${sumber})` : sql``}
     order by sumber, kampanye_id`;

  return rows.map((r) => ({
    sumber: r.sumber,
    kampanyeId: r.kampanye_id,
    skuId: r.sku_id,
    contentId: r.content_id,
    biaya: Number(r.biaya),
    tayangan: r.tayangan,
    klik: r.klik,
    pesananSku: r.pesanan_sku,
    gmv: r.gmv === null ? null : Number(r.gmv),
    roas: r.roas === null ? null : Number(r.roas),
    tipeKampanyeSumber: r.tipe_kampanye_sumber,
    batchId: r.batch_id,
    parserVersi: r.parser_versi,
  }));
}

export interface PdtFaktaKesehatanPenaltiBaris extends PdtSumberBatch {
  poin: number;
  deskripsi: string;
  durasi: string;
}

/** Baris `pdt_fact_kesehatan_penalti` bulan berjalan (satu baris/pelanggaran aktif) — dipakai G3-02 (`poinPenalti` = Σ). */
export async function bacaFaktaKesehatanPenalti(
  sql: Queryable,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<PdtFaktaKesehatanPenaltiBaris[]> {
  const rows = await sql<
    { poin: string; deskripsi: string; durasi: string; batch_id: number; parser_versi: number }[]
  >`
    select poin, deskripsi, durasi, batch_id, parser_versi
      from pdt_fact_kesehatan_penalti
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date
     order by poin desc`;

  return rows.map((r) => ({
    poin: Number(r.poin),
    deskripsi: r.deskripsi,
    durasi: r.durasi,
    batchId: r.batch_id,
    parserVersi: r.parser_versi,
  }));
}

export interface PdtFaktaLayananChatBaris extends PdtSumberBatch {
  chatMasuk: number | null;
  chatDibalas: number | null;
  waktuResponDetik: number | null;
}

/**
 * Baris `pdt_fact_layanan_chat` bulan berjalan (satu baris ringkasan per
 * unggahan `shopee_chat`, G3-02a) — dipakai G3-02 (`chatResponseRatePersen`
 * = Σ`chatDibalas`/Σ`chatMasuk`×100, `chatResponseMenit` dari rata-rata
 * `waktuResponDetik`÷60 — pemanggil yang menjumlahkan, pola ratio-of-sums
 * sama seperti `bacaFaktaKesehatanPenalti`/seluruh rasio PDT lain).
 * `pengunjung`/`csatPersen`/`totalPesanan`/`penjualan`/
 * `tingkatKonversiChatDibalas` TIDAK dibaca di sini — nol konsumen hari ini
 * (insight-only, lihat docblock kolom di migrasi).
 */
export async function bacaFaktaLayananChat(
  sql: Queryable,
  clientPlatformId: number,
  periodeAwalBulan: string,
): Promise<PdtFaktaLayananChatBaris[]> {
  const rows = await sql<
    { chat_masuk: number | null; chat_dibalas: number | null; waktu_respon_detik: number | null; batch_id: number; parser_versi: number }[]
  >`
    select chat_masuk, chat_dibalas, waktu_respon_detik, batch_id, parser_versi
      from pdt_fact_layanan_chat
     where client_platform_id = ${clientPlatformId}
       and periode = ${periodeAwalBulan}::date`;

  return rows.map((r) => ({
    chatMasuk: r.chat_masuk,
    chatDibalas: r.chat_dibalas,
    waktuResponDetik: r.waktu_respon_detik,
    batchId: r.batch_id,
    parserVersi: r.parser_versi,
  }));
}

export interface PdtPeriodeTerverifikasi extends PdtSumberBatch {
  /** Awal bulan (`pdt_upload_batch.periode_mulai`) — dipakai sebagai `periodeAwalBulan` ke pembaca lain di modul ini. */
  periodeAwalBulan: string;
  /**
   * Tanggal batch ini diunggah (`pdt_upload_batch.dibuat_pada`, dipotong ke
   * tanggal). Inilah "tanggal ambil data" untuk baseline yang bersumber PDT:
   * `riset_awal_sumber_berkas.tanggal_ambil` tidak pernah diisi di jalur PDT,
   * jadi tanpa ini B-0.6 tidak pernah bisa lengkap otomatis — lihat
   * `getBaselinePrefill`.
   */
  tanggalUnggah: string;
}

/**
 * `limit` batch TERBARU yang `status='verified'` untuk `client_platform_id`,
 * urut KRONOLOGIS NAIK (lama → baru) — dipakai G3-07 (riwayat GMV, `monthIndex`
 * 1..N sama seperti `getBaselinePrefill` hari ini, `monthIndex` N = bulan
 * paling baru). Filter `status='verified'` SUDAH cukup untuk G3-08 (batch
 * `digantikan`/`ditolak`/`parsing` tidak pernah dianggap sumber) — Rule 36
 * menandai batch lama `digantikan` saat batch koreksi diverifikasi, jadi tidak
 * ada baris chain `menggantikan_batch_id` tambahan yang perlu diikuti di sini.
 * Array KOSONG (bukan error) ⇒ `client_platform_id` ini belum punya batch PDT
 * terverifikasi sama sekali — pemanggil (G3-07) jatuh kembali ke sumber lama
 * (payload Riset Awal), pola strangler yang sama dengan G3-10.
 */
export async function bacaPeriodeTerverifikasiTerbaru(
  sql: Queryable,
  clientPlatformId: number,
  limit: number,
): Promise<PdtPeriodeTerverifikasi[]> {
  const rows = await sql<
    { periode_awal_bulan: string; batch_id: number; parser_versi: number; tanggal_unggah: string }[]
  >`
    select periode_mulai::text as periode_awal_bulan, id as batch_id, parser_versi,
           (dibuat_pada at time zone 'Asia/Jakarta')::date::text as tanggal_unggah
      from pdt_upload_batch
     where client_platform_id = ${clientPlatformId}
       and status = 'verified'
     order by periode_mulai desc
     limit ${limit}`;

  return rows
    .map((r) => ({
      periodeAwalBulan: r.periode_awal_bulan,
      batchId: r.batch_id,
      parserVersi: r.parser_versi,
      tanggalUnggah: r.tanggal_unggah,
    }))
    .reverse();
}

export interface PdtJumlahSkuMaster {
  /** `count(*)` seluruh baris `pdt_sku_master` — kumulatif lintas periode (Rule 19: SKU tidak pernah dihapus), bukan hitungan "bulan ini". */
  skuListed: number;
  /** `count(*) where status_listing = 'aktif'`. */
  skuAktif: number;
}

/**
 * Hitungan `pdt_sku_master` per `client_platform_id` (B-3.1) — dipakai G3-03.
 * TIDAK berbutir periode: `pdt_sku_master` adalah master lintas periode
 * (Rule 17-20, `status_listing`/`last_seen_at` mencerminkan keadaan TERKINI,
 * bukan snapshot bulan tertentu), jadi hitungannya sama untuk periode acuan
 * PDT mana pun yang dipilih pemanggil. `{ skuListed: 0, skuAktif: 0 }` (bukan
 * `null`) ketika `client_platform_id` ini belum pernah punya baris SKU sama
 * sekali — pemanggil yang memutuskan jatuh ke payload lama (mis. saat channel
 * ini belum onboarding PDT sama sekali), bukan modul ini.
 */
export async function bacaJumlahSkuMaster(
  sql: Queryable,
  clientPlatformId: number,
): Promise<PdtJumlahSkuMaster> {
  const rows = await sql<{ sku_listed: string; sku_aktif: string }[]>`
    select count(*) as sku_listed,
           count(*) filter (where status_listing = 'aktif') as sku_aktif
      from pdt_sku_master
     where client_platform_id = ${clientPlatformId}`;
  return { skuListed: Number(rows[0].sku_listed), skuAktif: Number(rows[0].sku_aktif) };
}
