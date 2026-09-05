/**
 * Report engine — the buyer-journey layer (Awareness → Consideration → Conversion).
 *
 * ## Why this exists
 *
 * `payload` is organised by SOURCE FILE — `kpi`, `kanal`, `iklan`, `live`,
 * `video`, `produk`, `afiliasi`, `tokopedia`, `ads_manager`. That is the right
 * shape for MEA, which knows which export each number came from. It is the wrong
 * shape for the client, whose question is "how far along is my shop?"
 *
 * Clients arrive at MEA at different business stages. A one-month-old shop is
 * legitimately heavy at Awareness and should not be read off a red store CVR on
 * page one — this period's money was deliberately not pointed there. This module
 * re-reads the SAME metrics through the three stages so the report can say that.
 *
 * ## The hard rule this module obeys
 *
 * **It computes nothing new.** Every figure here is a re-projection of a value
 * `metrik.ts` already produced, through the same `div`/`fx` helpers. There is no
 * manual input anywhere in the chain: `tahap_fokus` (which stage is being chased)
 * is the ONE human decision, and it is a label, never a number. House rule #4
 * stays intact — a stored report recomputes to the same stage layer from the
 * same slots and the same benchmark version.
 *
 * ## Why NO step-to-step rate carries a band
 *
 * The rungs report a pass-through against the previous rung that HAS a number,
 * and that denominator moves: with the Showcase Ads file, orders are measured
 * against add-to-cart; without it, against visitors. `cvr_toko` describes
 * exactly one of those ratios — orders ÷ VISITORS — so hanging it on "the orders
 * rung" would flag a store green on 42/849 while its real conversion, 42/20.543,
 * is a fifth of the threshold. A band that changes meaning with which files were
 * uploaded is worse than no band.
 *
 * So the ratio `cvr_toko` actually describes is reported SEPARATELY, as
 * `konversiTotal`: orders ÷ visitors, always the same two numbers, judged. The
 * rungs themselves are unjudged and the renderer shows `—` for their range.
 *
 * That is deliberate, and it is the whole point of the header comment in
 * `types.ts`: the owner's original browser tool let anyone edit the thresholds,
 * so two AMs scored the same month differently and an old report could not be
 * recomputed. Every threshold in this engine comes from a VERSIONED
 * `report_benchmark` row. Typing "1,5–3% is healthy" into this file would create
 * exactly the unversioned threshold that was removed — invisible in the payload,
 * unattributable, and unchangeable without a code release. Bands for the click,
 * visit and add-to-cart steps are a benchmark CALIBRATION (a new `versi` row
 * approved by the owner), not a constant a developer picks.
 */
import { div, fx } from '../baseline/angka';
import type { ReportMetrics } from './metrik';
import type { BenchBand, Flag, ReportBench } from './types';

export type TahapKey = 'awareness' | 'consideration' | 'conversion';

export const ALL_TAHAP: readonly TahapKey[] = ['awareness', 'consideration', 'conversion'];

export const TAHAP_LABEL: Record<TahapKey, string> = {
  awareness: 'Awareness',
  consideration: 'Consideration',
  conversion: 'Conversion',
};

/** Is `v` one of the three stage keys? The single gate every layer above reuses. */
export function isTahapKey(v: unknown): v is TahapKey {
  return typeof v === 'string' && (ALL_TAHAP as readonly string[]).includes(v);
}

/** How a stage metric must be rendered. The renderer owns the formatting, not this module. */
export type Satuan = 'rupiah' | 'angka' | 'persen' | 'kali';

function flagOf(v: number | null, band: BenchBand | null, higher = true): Flag {
  if (v == null || band == null) return 'kosong';
  if (higher) return v >= band.good ? 'hijau' : v >= band.warn ? 'kuning' : 'merah';
  return v <= band.good ? 'hijau' : v <= band.warn ? 'kuning' : 'merah';
}

/**
 * One rung of the buyer journey. `lolos` is the share of the PREVIOUS rung that
 * reached this one — null when either side is missing, never 0 (aturan rumah #7:
 * "we could not measure it" and "nobody did it" are different facts).
 */
export interface FunnelLangkah {
  key: string;
  label: string;
  nilai: number | null;
  lolos: number | null;
  /** Label of the rung `lolos` is measured against; null for the first rung with a value. */
  lolosDari: string | null;
  band: BenchBand | null;
  flag: Flag;
  /** Why this rung has no number. Null when it has one. */
  catatan: string | null;
}

export interface TahapMetrik {
  key: string;
  label: string;
  nilai: number | null;
  satuan: Satuan;
  flag: Flag;
}

export interface TahapBlok {
  key: TahapKey;
  label: string;
  tujuan: string;
  /** True for the stage the AM set as this shop's focus. All false when none is set. */
  fokus: boolean;
  /** Media spend attributable to this stage; null when no ads export covers it. */
  belanja: number | null;
  belanjaPersen: number | null;
  metrik: TahapMetrik[];
}

/**
 * One stage's prose, as the engine drafts it and the AM rewrites it.
 *
 * It rides in the INSIGHT block, not in the stage block — the stage block is
 * numbers, and numbers are frozen. This is the recommendation half, so it lives
 * in `client_report_insight` alongside the summary and the recommendation cards
 * and follows exactly their rules: append-only revisions, revision 0 = machine,
 * the client reads the pinned one.
 */
export interface TahapNarasi {
  tahap: TahapKey;
  judul: string;
  teks: string;
}

export interface TahapReport {
  fokus: TahapKey | null;
  funnel: FunnelLangkah[];
  /**
   * Orders ÷ visitors — the end-to-end conversion `cvr_toko` is written against,
   * and the ONE rate in this layer that is judged. Kept apart from the rungs
   * precisely because its two numbers never change with which files were
   * uploaded, so its verdict means the same thing on every report.
   */
  konversiTotal: { nilai: number | null; band: BenchBand; flag: Flag };
  blok: TahapBlok[];
  belanjaTotal: number | null;
}

const TUJUAN: Record<TahapKey, string> = {
  awareness: 'Membuat toko dikenal, dan membangun aset audiens yang bisa dipakai berulang di periode berikutnya.',
  consideration: 'Memindahkan orang dari sekadar tahu menjadi tertarik dan mengevaluasi produk.',
  conversion: 'Mengubah pengunjung menjadi pembeli, dan menaikkan nilai setiap transaksi.',
};

/**
 * Build the funnel rungs.
 *
 * The Add-to-Cart rung is the one that can genuinely be absent: store-wide ATC
 * is NOT in any of the 12 Seller Center exports — the only source is the
 * `Adds to cart (Shop)` column of the Showcase Ads export. Without that file the
 * rung renders `—` and says which file would fill it. It must never render 0:
 * "nobody added to cart" is a catastrophic finding and "we did not upload the
 * ads file" is an errand, and a client cannot tell them apart from a zero.
 */
function buildFunnel(M: ReportMetrics): FunnelLangkah[] {
  const atc = M.ttam?.showcase?.atc ?? null;
  const rows: Omit<FunnelLangkah, 'lolos' | 'lolosDari' | 'flag'>[] = [
    { key: 'impresi', label: 'Impresi produk', nilai: M.kpi.impresi, band: null, catatan: M.kpi.impresi == null ? 'tidak ada di export Analitik Toko periode ini' : null },
    { key: 'klik', label: 'Klik ke halaman produk', nilai: M.kpi.klik, band: null, catatan: M.kpi.klik == null ? 'tidak ada di export Analitik Toko periode ini' : null },
    { key: 'pengunjung', label: 'Pengunjung toko', nilai: M.kpi.pengunjung, band: null, catatan: null },
    { key: 'atc', label: 'Add to Cart', nilai: atc, band: null, catatan: atc == null ? 'hanya terbaca dari export Showcase Ads — berkas itu belum diunggah' : null },
    { key: 'pesanan', label: 'Pesanan', nilai: M.kpi.pesanan, band: null, catatan: null },
  ];

  const out: FunnelLangkah[] = [];
  // The rung `lolos` is measured against is the last one that HAD a number, not
  // the one directly above: with the ads file missing, Pesanan is still a share
  // of Pengunjung, and skipping the pairing entirely would drop the single rung
  // this engine can actually judge.
  let prev: { label: string; nilai: number } | null = null;
  for (const r of rows) {
    const lolos = prev && r.nilai != null ? div(r.nilai, prev.nilai) : null;
    out.push({
      ...r,
      lolos: fx(lolos, 5),
      lolosDari: lolos == null ? null : prev!.label,
      flag: flagOf(lolos, r.band),
    });
    if (r.nilai != null) prev = { label: r.label, nilai: r.nilai };
  }
  return out;
}

const m = (key: string, label: string, nilai: number | null, satuan: Satuan, flag: Flag = 'kosong'): TahapMetrik =>
  ({ key, label, nilai, satuan, flag });

/**
 * Split media spend across the three stages by what each campaign type is
 * OPTIMISED FOR, which is the only split the exports support: Ads Manager
 * video-views/follows buy attention, showcase/consideration buy product intent,
 * GMV Max buys orders. It is not a split by outcome — an awareness campaign that
 * happens to produce a sale is still awareness spend, and pretending otherwise
 * is the double-count `payload.ads_manager.catatan` already warns about.
 */
function belanjaTahap(M: ReportMetrics): Record<TahapKey, number | null> {
  const t = M.ttam;
  const awareness = t == null ? null : (t.videoviews?.spend ?? 0) + (t.follows?.spend ?? 0);
  const consideration = t == null ? null : (t.showcase?.spend ?? 0) + (t.consideration?.spend ?? 0);
  const conversion = M.ads ? M.ads.total.biaya : null;
  return { awareness, consideration, conversion };
}

export function buildTahap(M: ReportMetrics, B: ReportBench, fokus: TahapKey | null): TahapReport {
  const belanja = belanjaTahap(M);
  const adaBelanja = ALL_TAHAP.some((k) => belanja[k] != null);
  const belanjaTotal = adaBelanja ? ALL_TAHAP.reduce((a, k) => a + (belanja[k] ?? 0), 0) : null;

  const metrik: Record<TahapKey, TahapMetrik[]> = {
    awareness: [
      m('vv_impresi', 'Impresi iklan awareness', M.ttam?.videoviews?.impresi ?? null, 'angka'),
      m('vv_views', 'Video views (iklan)', M.ttam?.videoviews?.views ?? null, 'angka'),
      m('vv_cpm', 'CPM', M.ttam?.videoviews?.cpm ?? null, 'rupiah'),
      m('vv_per1k', 'Biaya per 1.000 views', M.ttam?.videoviews?.costPer1k ?? null, 'rupiah'),
      m('fol_follows', 'Follower dari campaign', M.ttam?.follows?.follows ?? null, 'angka'),
      m('fol_cost', 'Biaya per follower', M.ttam?.follows?.costPer ?? null, 'rupiah'),
      m('konten_n', 'Konten diproduksi & tayang', M.video?.total ?? null, 'angka'),
      m('konten_vv', 'Total views konten', M.video?.vv ?? null, 'angka'),
      m('konten_follower', 'Follower baru dari konten', M.video?.followerBaru ?? null, 'angka'),
    ],
    consideration: [
      m('sc_impresi', 'Impresi iklan showcase', M.ttam?.showcase?.impresi ?? null, 'angka'),
      m('sc_klik', 'Klik ke halaman produk (iklan)', M.ttam?.showcase?.klik ?? null, 'angka'),
      m('sc_ctr', 'CTR showcase', M.ttam?.showcase?.ctr ?? null, 'persen',
        flagOf(M.ttam?.showcase?.ctr ?? null, B.ctr_ads)),
      m('sc_atc', 'Add to cart (iklan showcase)', M.ttam?.showcase?.atc ?? null, 'angka'),
      m('sc_cost_atc', 'Biaya per add to cart', M.ttam?.showcase?.costPerAtc ?? null, 'rupiah'),
      m('toko_impresi', 'Impresi produk (toko)', M.kpi.impresi, 'angka'),
      m('toko_klik', 'Klik produk (toko)', M.kpi.klik, 'angka'),
      m('aff_total', 'Kreator afiliasi terdaftar', M.affiliate?.total ?? null, 'angka'),
      m('aff_posting', 'Kreator memposting konten', M.affiliate?.posting ?? null, 'angka'),
    ],
    conversion: [
      m('gmv', 'GMV', M.kpi.gmv, 'rupiah'),
      m('pesanan', 'Pesanan', M.kpi.pesanan, 'angka'),
      m('cvr', 'Conversion rate toko', M.kpi.cvr, 'persen', flagOf(M.kpi.cvr, B.cvr_toko)),
      m('aov', 'Nilai rata-rata per pesanan', M.kpi.aov, 'rupiah'),
      m('roi', 'ROI iklan konversi (GMV Max)', M.ads?.total.roi ?? null, 'kali',
        flagOf(M.ads?.total.roi ?? null, B.roi_gmvmax)),
      m('cpa', 'Biaya per pesanan (GMV Max)', M.ads?.total.cpa ?? null, 'rupiah'),
      m('aff_produktif', 'Kreator menghasilkan penjualan', M.affiliate?.produktif ?? null, 'angka'),
      m('tp_gmv', 'GMV ShopTokopedia', M.tokped?.gmv ?? null, 'rupiah'),
    ],
  };

  return {
    fokus,
    funnel: buildFunnel(M),
    konversiTotal: { nilai: fx(M.kpi.cvr, 5), band: B.cvr_toko, flag: flagOf(M.kpi.cvr, B.cvr_toko) },
    belanjaTotal: belanjaTotal == null ? null : Math.round(belanjaTotal),
    blok: ALL_TAHAP.map((key) => ({
      key,
      label: TAHAP_LABEL[key],
      tujuan: TUJUAN[key],
      fokus: fokus === key,
      belanja: belanja[key] == null ? null : Math.round(belanja[key] as number),
      // Share of the period's TOTAL media spend, so the three shares sum to 100%
      // and the reader can see the composition shift between periods.
      belanjaPersen: belanja[key] == null || !belanjaTotal ? null : fx(div(belanja[key] as number, belanjaTotal), 4),
      metrik: metrik[key],
    })),
  };
}
