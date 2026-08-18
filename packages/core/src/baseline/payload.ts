/**
 * Baseline engine — payload `cdps.baseline.tiktok.v1` + kondisi_toko mapping (RAB-02).
 * Ported from the tool `payload` (lines 1238-1288).
 *
 * Perbedaan dari tool (semua sadar): identitas klien & `generated_at` DIINJEKSI
 * caller (dari CDPS + modul tz WIB server, bukan `$('#fKlien')`/`new Date()`
 * klien — handoff §2.2 #5,#7). Benchmark = parameter + `benchmark_versi` dicatat
 * (fix #4, aturan rumah #4). `verdict` string tool DIPETAKAN ke `kondisi_toko`
 * snake_case (RAB-01) — kosakata TERPISAH dari verdict Blok C (handoff §2.3).
 */
import { div, fx, n, nil } from './angka';
import type { Metrics } from './metrik';
import type { HistStats } from './riwayat';
import type { Score } from './skor';
import { arah } from './temuan';
import { ALL_FILE_TYPES, type Benchmark, type FileType, type Finding, type HistRow, type KondisiToko } from './types';

const r = (v: number | null | undefined): number | null => (nil(v) ? null : Math.round(v as number));

/**
 * Map the engine's numeric total to one of the 4 COMPUTED Kondisi Toko values.
 * `belum_dapat_diukur` (the 5th) is NOT produced here — it is set by the caller
 * for platforms with no analysis engine (manual / Tokopedia tipis). A null total
 * (nothing scorable) floors to `mesin_belum_terbangun`.
 */
export function kondisiTokoFromScore(total: number | null): Exclude<KondisiToko, 'belum_dapat_diukur'> {
  if (total == null) return 'mesin_belum_terbangun';
  if (total >= 75) return 'mesin_jalan';
  if (total >= 60) return 'mesin_sebagian';
  if (total >= 45) return 'fondasi_perlu_dibenahi';
  return 'mesin_belum_terbangun';
}

export interface KlienIdentity {
  nama: string | null;
  toko: string | null;
  akun_tiktok: string | null;
  kategori: string | null;
  umur_toko_bulan: number | null;
  account_manager: string | null;
}

export interface PayloadOptions {
  klien: KlienIdentity;
  /** ISO-8601 timestamp from the server (modul tz WIB), NOT a client clock. */
  generatedAt: string;
  /** 'net' = GMV − pengembalian dana (standar MEA); 'gross' = GMV kotor. */
  net: boolean;
  bench: Benchmark;
  /** The benchmark version used (from `riset_awal_benchmark`) — recorded for recompute. */
  benchmarkVersi?: number | null;
  hist: HistRow[];
  /** Which file-type slots were supplied (kelengkapan_file). */
  slots: Partial<Record<FileType, boolean>>;
}

export function buildPayload(M: Metrics, H: HistStats, sc: Score, F: Finding[], opts: PayloadOptions) {
  const T = M.toko;
  const { klien, bench: B } = opts;
  const p = {
    schema: 'cdps.baseline.tiktok.v1' as const,
    generated_at: opts.generatedAt,
    sumber: 'MEA CDPS Baseline Engine v1 — export TikTok Shop Seller Center & Ads Manager',
    klien: {
      nama: klien.nama,
      toko: klien.toko,
      akun_tiktok: klien.akun_tiktok,
      kategori: klien.kategori,
      umur_toko_bulan: klien.umur_toko_bulan,
      account_manager: klien.account_manager,
      periode_referensi: T ? T.periode ?? null : null,
      definisi_gmv: opts.net ? 'net' : 'gross',
    },
    gmv_baseline: {
      median_6m: r(H.med),
      runrate_3m: r(H.rr),
      avg_terisi: r(H.avg6),
      trend_3v3: H.trend == null ? null : fx(H.trend, 4),
      bulan_terisi: H.months,
      cakupan_riwayat: H.cakupan,
      campaign_driven: H.spike,
      bulan_puncak: H.peakRow ? H.peakRow.label : null,
      riwayat: opts.hist.map((h) => ({ bulan: h.key, label: h.label, gmv: r(n(h.gmv)), order: r(n(h.order)), tanda: h.flag })),
    },
    toko: T
      ? {
          gmv: r(T.gmvBase), gmv_kotor: r(T.gmv), refund: r(T.refund), refund_rate: fx(T.refundRate, 4),
          pesanan: r(T.pesanan), pembeli: r(T.pembeli), aov: r(T.aov), pengunjung: r(T.visitor),
          konversi: fx(T.cr, 5), hari_aktif: T.hariAktif, hari_total: T.hariTotal, share_hari_terbesar: fx(T.peakShare, 4),
          mom: { gmv: T.chGmv, pengunjung: T.chVisitor, pesanan: T.chOrder },
        }
      : null,
    // gmv_mix = atribusi DI DALAM satu platform (RAB-12: BUKAN baseline per-kanal).
    gmv_mix: T
      ? {
          video_afiliasi: r(T.vidAff), live_afiliasi: r(T.liveAff), video_toko: r(T.vidToko),
          live_toko: r(T.liveToko), kartu_produk_dan_lain: r(T.other),
        }
      : null,
    video: {
      toko: M.vT ? { aktif: M.vT.total, diposting_periode: M.vT.posted, ada_penjualan: M.vT.withSales, rate: fx(M.vT.rate, 4), gmv: r(M.vT.gmv), gpm_median: r(M.vT.gpmMed), vv: r(M.vT.vv) } : null,
      afiliasi: M.vA ? { aktif: M.vA.total, ada_penjualan: M.vA.withSales, rate: fx(M.vA.rate, 4), gmv: r(M.vA.gmv), gpm_median: r(M.vA.gpmMed), vv: r(M.vA.vv), kreator_posting: M.vA.kreator } : null,
      top_video: [...(M.vT ? M.vT.sales : []), ...(M.vA ? M.vA.sales : [])]
        .sort((a, b) => b.gmv - a.gmv)
        .slice(0, 10)
        .map((v) => ({ judul: v.judul, akun: v.kreator, gmv: r(v.gmv), gpm: r(v.gpm), vv: r(v.vv), tuntas: fx(v.finish, 4), ctr: fx(v.ctr, 4) })),
    },
    live: {
      toko: M.lT ? { sesi: M.lT.sesi, jam: fx(M.lT.jam, 2), gmv: r(M.lT.gmv), gmv_per_jam: r(M.lT.gmvPerJam), sesi_ada_penjualan: M.lT.withSales, penonton: r(M.lT.penonton), ctor_median: fx(M.lT.ctorMed, 4), share_prime_time: fx(M.lT.primeShare, 4) } : null,
      afiliasi: M.lA ? { sesi: M.lA.sesi, jam: fx(M.lA.jam, 2), gmv: r(M.lA.gmv), gmv_per_jam: r(M.lA.gmvPerJam), kreator: M.lA.kreator, penonton: r(M.lA.penonton) } : null,
    },
    afiliasi: M.aff
      ? {
          kreator_total: M.aff.total, kreator_posting: M.aff.posted, posting_dan_ada_penjualan: M.aff.postedSales, ada_penjualan: M.aff.withSales,
          rate: fx(M.aff.rate, 4), rate_dari_posting: fx(M.aff.rateAktif, 4), posting_tanpa_penjualan: M.aff.nempel, gmv: r(M.aff.gmv),
          top5_share: fx(M.aff.top5Share, 4), sampel_terkirim: r(M.aff.sampel), sampel_berhasil: M.aff.sampelSukses,
          top_kreator: M.aff.top.slice(0, 5).map((k) => ({ nama: k.nama, gmv: r(k.gmv), video: r(k.nVid), live: r(k.nLive) })),
        }
      : null,
    produk: M.prod
      ? {
          sku_total: M.prod.total, sku_ada_penjualan: M.prod.withSales, rate: fx(M.prod.rate, 4), top3_share: fx(M.prod.top3Share, 4), kuadran: M.prod.quad,
          top_sku: M.prod.top.slice(0, 5).map((s) => ({ nama: s.nama, gmv: r(s.gmv), klik: r(s.klik), ctor: fx(s.ctor, 4) })),
        }
      : null,
    iklan:
      M.ads && M.ads.ada
        ? {
            belanja: r(M.ads.spend), pendapatan_teratribusi: r(M.ads.rev), roas: fx(M.ads.roas, 2), biaya_per_pesanan: r(M.ads.cpo),
            setara_persen_gmv: T ? fx(div(M.ads.rev, T.gmv), 4) : null,
            // guardrail single-source (RM-3): jangan dijumlah dengan GMV organik.
            catatan: 'pendapatan teratribusi tumpang tindih dengan GMV afiliasi/organik, jangan dijumlah',
          }
        : null,
    skor: {
      total: sc.total,
      verdict: sc.verdict,
      // kondisi_toko snake_case (RAB-01) — kosakata TERPISAH dari verdict Blok C.
      kondisi_toko: kondisiTokoFromScore(sc.total) as KondisiToko,
      cakupan_data: fx(sc.coverage, 2),
      pilar: Object.fromEntries(sc.P.map((pl) => [pl.k, pl.ada ? Math.round(pl.score as number) : null])),
    },
    benchmark_versi: opts.benchmarkVersi ?? null,
    benchmark_dipakai: { ...B },
    temuan: F.map((f) => ({ level: f.lv, teks: f.t.replace(/<[^>]+>/g, '') })),
    arah_strategi: arah(M, sc),
    kelengkapan_file: Object.fromEntries(ALL_FILE_TYPES.map((k) => [k, !!opts.slots[k]])),
  };
  return p;
}

/** The full baseline payload shape (inferred from the builder). */
export type BaselinePayload = ReturnType<typeof buildPayload>;
