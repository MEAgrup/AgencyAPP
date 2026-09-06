/**
 * Payload baseline Shopee — `cdps.baseline.shopee.v1` (B2).
 *
 * KONGRUEN, BUKAN IDENTIK, dengan `cdps.baseline.tiktok.v1`. Kunci yang punya
 * arti sama di dua platform memakai NAMA yang sama dan SATUAN yang sama
 * (`toko`, `produk`, `iklan`, `afiliasi`, `video`, `live`, `gmv_baseline`,
 * `gmv_mix`, `skor`, `benchmark_versi`, `temuan`, `kelengkapan_file`) supaya
 * B3 memetakan keduanya lewat SATU pemeta yang memilih cabang dari
 * `payload.schema` — bukan dua pemeta yang perlahan berbeda.
 *
 * Kunci yang Shopee tidak punya (`gmv_mix.video_afiliasi`, `afiliasi.rate`,
 * `video.gpm_median`, …) **ABSEN**, tidak diisi `0` dan tidak diisi `null`
 * palsu: absen berarti Section B memintanya manual, dan itu jawaban yang benar.
 * Dua kunci yang TikTok tak punya (`layanan`, `kesehatan_toko`) ada di sini
 * karena export Shopee benar-benar membawanya — keputusan pemilik 2026-09-06.
 *
 * SKALA SKOR. `computeSkor` Shopee mengeluarkan 0–10 (bobot dimensi × 10),
 * sedangkan `riset_awal_analisa.skor` bertipe `integer` 0–100 dan
 * `kondisiTokoFromScore` berambang 75/60/45 pada skala itu. Karena itu total
 * Shopee DINAIKKAN ×10 di sini, satu kali, di satu tempat. `skor.total_mesin`
 * menyimpan angka 0–10 aslinya supaya laporan dan baseline tidak pernah
 * berdebat soal angka yang sama.
 */
import { fx, n } from '../angka';
import { kondisiTokoFromScore } from '../payload';
import type { KondisiToko } from '../types';
import type { HistRow } from '../types';
import type { HistStats } from '../riwayat';
import type { Skor } from '../../report/shopee/skor';
import { ALL_SHOPEE_MODULES, type ShopeeBench, type ShopeeModule } from '../../report/shopee/types';
import type { ShopeeBaselineMetrics } from './metrik-baseline';

/** Versi mesin baseline Shopee — ditulis ke `riset_awal_analisa.parser_versi`. */
export const PARSER_VERSI_SHOPEE = 'cdps-baseline-shopee-v1';

const r = (v: number | null | undefined): number | null =>
  v == null || typeof v !== 'number' || !isFinite(v) ? null : Math.round(v);

export interface KlienIdentityShopee {
  nama: string | null;
  toko: string | null;
  /** Tautan toko Shopee (`client_platforms.store_link`) — padanan `akun_tiktok`. */
  store_link: string | null;
  kategori: string | null;
  umur_toko_bulan: number | null;
  account_manager: string | null;
}

export interface PayloadOptionsShopeeBaseline {
  klien: KlienIdentityShopee;
  /** ISO-8601 dari jam server (modul tz WIB), BUKAN jam browser. */
  generatedAt: string;
  /** Label periode bebas-teks yang AM isi — export Shopee tak membawa rentang
   *  tanggal yang bisa dibaca mesin (sama seperti mesin laporan Shopee). */
  periode: string | null;
  bench: ShopeeBench;
  /** Versi `report_benchmark_shopee` yang dipakai — BUKAN `riset_awal_benchmark`. */
  benchmarkVersi: number | null;
  hist: HistRow[];
  slots: Partial<Record<ShopeeModule, boolean>>;
}

/**
 * Skala 0–10 mesin laporan Shopee → 0–100, skala yang `kondisiTokoFromScore`
 * dan kolom `riset_awal_analisa.skor` (integer 0–100) pakai. Dibulatkan sekali
 * di sini; setiap pembaca hilir memakai hasilnya apa adanya.
 */
export function skorShopeeKe100(total: number): number {
  return Math.max(0, Math.min(100, Math.round(total * 10)));
}

export function buildShopeeBaselinePayload(
  B: ShopeeBaselineMetrics,
  H: HistStats,
  sk: Skor,
  opts: PayloadOptionsShopeeBaseline,
) {
  const total100 = skorShopeeKe100(sk.total);
  const T = B.toko;
  return {
    schema: 'cdps.baseline.shopee.v1' as const,
    generated_at: opts.generatedAt,
    parser_versi: PARSER_VERSI_SHOPEE,
    sumber: 'MEA CDPS Baseline Engine v1 — export Shopee Seller Centre & Ads Center',
    klien: {
      nama: opts.klien.nama,
      toko: opts.klien.toko,
      store_link: opts.klien.store_link,
      kategori: opts.klien.kategori,
      umur_toko_bulan: opts.klien.umur_toko_bulan,
      account_manager: opts.klien.account_manager,
      periode_referensi: opts.periode,
      // Headline Shopee adalah pesanan DIBUAT (SHP-1) — sama seperti laporan.
      definisi_gmv: 'gross' as const,
      gmv_bersih_sumber: (T && T.gmv_dibayar != null ? 'pesanan_dibayar' : 'tidak_tersedia') as 'pesanan_dibayar' | 'tidak_tersedia',
    },
    // Riwayat 6 bulan diketik AM, sama persis seperti TikTok — `histStats` ini
    // platform-netral, jadi jalurnya SATU untuk kedua mesin.
    gmv_baseline: {
      median_6m: r(H.med), runrate_3m: r(H.rr), avg_terisi: r(H.avg6),
      trend_3v3: H.trend == null ? null : fx(H.trend, 4),
      bulan_terisi: H.months, cakupan_riwayat: H.cakupan, campaign_driven: H.spike,
      bulan_puncak: H.peakRow ? H.peakRow.label : null,
      riwayat: opts.hist.map((h) => ({ bulan: h.key, label: h.label, gmv: r(n(h.gmv)), order: r(n(h.order)), tanda: h.flag })),
    },
    toko: T
      ? {
          gmv: r(T.gmv), gmv_dibayar: r(T.gmv_dibayar),
          batal_pesanan: r(T.batal_pesanan), batal_nilai: r(T.batal_nilai),
          retur_pesanan: r(T.retur_pesanan), retur_nilai: r(T.retur_nilai),
          // B-1.4 — nama kunci sengaja BEDA dari `refund_rate` TikTok karena
          // isinya beda (batal + retur, bukan retur saja). B3 memetakan
          // keduanya ke kolom B-1.4 yang sama; menyamakan namanya akan
          // menyembunyikan bahwa definisinya tidak identik.
          batal_retur_rate: fx(T.batal_retur_rate, 4),
          pesanan: r(T.pesanan), pembeli: r(T.pembeli), pembeli_baru: r(T.pembeli_baru),
          aov: r(T.aov), pengunjung: r(T.pengunjung), konversi: fx(T.konversi, 5),
          repeat_rate: fx(T.repeat_rate, 4),
        }
      : null,
    // Atribusi DI DALAM Shopee (RAB-12) — share antar kanal boleh tumpang
    // tindih dan menjumlah >100%; jangan pernah dipakai sebagai residu.
    gmv_mix: B.gmv_mix ? Object.fromEntries(Object.entries(B.gmv_mix).map(([k, v]) => [k, r(v)])) : null,
    produk: B.produk
      ? {
          sku_total: B.produk.sku_total, sku_ada_penjualan: B.produk.sku_ada_penjualan,
          rate: fx(B.produk.rate, 4), top3_share: fx(B.produk.top3_share, 4),
          sku_pareto_80: B.produk.sku_pareto_80, sku_slow_moving: B.produk.sku_slow_moving,
          kuadran: B.produk.kuadran,
          top_sku: B.produk.top_sku.map((s) => ({ nama: s.nama, kode: s.kode, gmv: r(s.gmv), pengunjung: r(s.pengunjung), konversi: fx(s.konversi, 5) })),
        }
      : null,
    iklan: B.iklan
      ? {
          belanja: r(B.iklan.belanja), pendapatan_teratribusi: r(B.iklan.pendapatan_teratribusi),
          roas: fx(B.iklan.roas, 2), acos: fx(B.iklan.acos, 4), ctr: fx(B.iklan.ctr, 5),
          setara_persen_gmv: fx(B.iklan.setara_persen_gmv, 4),
          jumlah_kampanye: B.iklan.jumlah_kampanye, tipe_materi: B.iklan.tipe_materi,
          // Guardrail single-source (RM-3), sama seperti TikTok.
          catatan: 'pendapatan teratribusi tumpang tindih dengan GMV afiliasi/organik, jangan dijumlah',
        }
      : null,
    afiliasi: B.afiliasi
      ? {
          kreator_total: B.afiliasi.kreator_total, produk_terafiliasi: B.afiliasi.produk_terafiliasi,
          gmv: r(B.afiliasi.gmv), komisi: r(B.afiliasi.komisi), top5_share: fx(B.afiliasi.top5_share, 4),
          top_kreator: B.afiliasi.top_kreator.map((k) => ({ nama: k.nama, gmv: r(k.gmv), pesanan: r(k.pesanan), komisi: r(k.komisi) })),
        }
      : null,
    video: B.video
      ? {
          ada_aktivitas: B.video.ada_aktivitas, gmv: r(B.video.gmv), pesanan: r(B.video.pesanan),
          ditonton: r(B.video.ditonton), penonton: r(B.video.penonton),
          ctr: fx(B.video.ctr, 5), completion: fx(B.video.completion, 4),
        }
      : null,
    // Shopee Live tidak mengekspor jam/sesi/GMV per sesi seperti TikTok — hanya
    // "ada aktivitas atau tidak". Jadi B-7.2 (jam live, GMV per jam) TETAP
    // manual untuk Shopee, dan payload ini mengatakannya alih-alih menebak.
    live: B.live.diunggah ? { ada_aktivitas: B.live.ada_aktivitas } : null,
    // Dua blok yang TikTok tidak punya sumbernya (keputusan pemilik 2026-09-06:
    // B-4 Shopee diisi otomatis; B-4 TikTok tetap manual seluruhnya).
    layanan: B.layanan
      ? {
          chat_masuk: r(B.layanan.chat_masuk), chat_dibalas: r(B.layanan.chat_dibalas),
          response_rate: fx(B.layanan.response_rate, 4), waktu_respon_detik: r(B.layanan.waktu_respon_detik),
          csat: fx(B.layanan.csat, 4), konversi_chat: fx(B.layanan.konversi_chat, 4),
          gmv_chat: r(B.layanan.gmv_chat),
        }
      : null,
    kesehatan_toko: B.kesehatan_toko
      ? { poin_total: B.kesehatan_toko.poin_total, penalti: B.kesehatan_toko.penalti.map((p) => ({ poin: p.poin, deskripsi: p.deskripsi, durasi: p.durasi })) }
      : null,
    promo: { voucher_gmv: r(B.promo.voucher_gmv), voucher_biaya: r(B.promo.voucher_biaya), voucher_klaim: r(B.promo.voucher_klaim), diskon_aktif: B.promo.diskon_aktif },
    skor: {
      total: total100,
      /** Angka 0–10 apa adanya dari mesin laporan Shopee — provenance skala. */
      total_mesin: sk.total,
      verdict: sk.label,
      kondisi_toko: kondisiTokoFromScore(total100) as KondisiToko,
      // Padanan `cakupan_data` TikTok: berapa bagian dari 6 dimensi yang
      // benar-benar punya berkas, bukan yang dinilai netral 5/10.
      cakupan_data: fx(sk.dimensi.filter((d) => !d.catatan.includes('tidak diunggah')).length / sk.dimensi.length, 2),
      pilar: Object.fromEntries(sk.dimensi.map((d) => [d.key, Math.round(d.skor * 10)])),
    },
    benchmark_versi: opts.benchmarkVersi,
    benchmark_dipakai: { ...opts.bench },
    // `temuan` TikTok berasal dari `temuan.ts` (mesin baseline). Mesin Shopee
    // punya narasinya sendiri di `report/shopee/insight.ts`, tapi itu adalah
    // narasi LAPORAN BULANAN, bukan temuan baseline — memakainya di sini akan
    // menaruh kalimat "bulan ini turun 12%" di dokumen yang seharusnya
    // menggambarkan titik awal. Jadi: catatan per dimensi dari skor, apa adanya.
    temuan: sk.dimensi.map((d) => ({ level: d.skor >= 7 ? 'baik' : d.skor >= 4 ? 'perhatian' : 'kritis', teks: `${d.label}: ${d.catatan}` })),
    kelengkapan_file: Object.fromEntries(ALL_SHOPEE_MODULES.map((m) => [m, !!opts.slots[m]])),
  };
}

export type ShopeeBaselinePayload = ReturnType<typeof buildShopeeBaselinePayload>;
