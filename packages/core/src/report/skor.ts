/**
 * Report engine — overall 0–10 performance score (tool `computeScore`).
 *
 * Six weighted dimensions summing to 1.00. A dimension whose source file was not
 * uploaded scores a NEUTRAL 5 and says so in its note — it is neither rewarded
 * nor punished, because "we have no data" is not "it went badly". The note is
 * what makes that visible instead of silently averaged away.
 */
import { div } from '../baseline/angka';
import type { ReportMetrics } from './metrik';
import type { ReportBench, SkorDimensi } from './types';

export interface Skor {
  total: number;
  label: 'SEHAT' | 'PERLU PERHATIAN' | 'KRITIS';
  dimensi: SkorDimensi[];
}

/** Map a value onto 0–10 within [lo,hi], clamped. A null input is the neutral 5. */
export function scale(v: number | null | undefined, lo: number, hi: number): number {
  if (v == null || !isFinite(v) || hi === lo) return 5;
  const x = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return Math.round(x * 100) / 10;
}

const clamp10 = (v: number): number => Math.round(Math.max(0, Math.min(10, v)) * 10) / 10;
const pctTxt = (v: number | null, d = 0): string => (v == null ? '—' : (v * 100).toFixed(d).replace('.', ',') + '%');
const ribu = (v: number | null): string => (v == null ? '—' : 'Rp' + Math.round(v / 1000).toLocaleString('id-ID') + 'rb');

const MISSING = (label: string): string => `berkas ${label} tidak diunggah — dimensi ini dinilai netral (5/10)`;

export function computeSkor(M: ReportMetrics, B: ReportBench): Skor {
  const D: SkorDimensi[] = [];
  const push = (key: string, label: string, bobot: number, skor: number, catatan: string): void => {
    D.push({ key, label, bobot, skor: clamp10(skor), catatan });
  };

  // 1 — GMV Max Ads (22%)
  if (M.ads && M.ads.total.biaya > 0) {
    const roi = M.ads.total.roi ?? 0;
    const sRoi = scale(roi, 0, B.roi_gmvmax.good * 1.5);
    const ratio = M.ads.total.cpaRatio;
    const sCpa = ratio == null ? 5 : scale(B.cpa_ratio.warn * 2 - ratio, 0, B.cpa_ratio.warn * 2);
    const burn = M.ads.burners.pctSpend;
    const sBurn = burn == null ? 5 : scale(1 - burn, 0, 1);
    push('gmvmax', 'GMV Max Ads', 0.22, sRoi * 0.6 + sCpa * 0.25 + sBurn * 0.15,
      `ROI ${roi.toFixed(2)}x • CPA ${pctTxt(ratio)} dari AOV • ${pctTxt(burn)} belanja tanpa pesanan`);
  } else {
    push('gmvmax', 'GMV Max Ads', 0.22, 5, MISSING('iklan'));
  }

  // 2 — LIVE (22%)
  if (M.live) {
    const gph = M.live.gmvPerJam ?? 0;
    push('live', 'LIVE Streaming', 0.22,
      scale(gph, 0, B.gmv_per_jam_live.good * 1.5) * 0.5
      + scale(M.live.sesi, 0, B.sesi_live.good * 1.5) * 0.25
      + scale(1 - (M.live.nol.pct ?? 0), 0, 1) * 0.25,
      `${ribu(gph)}/jam • ${M.live.sesi} sesi • ${pctTxt(M.live.nol.pct)} sesi tanpa penjualan`);
  } else {
    push('live', 'LIVE Streaming', 0.22, 5, MISSING('LIVE'));
  }

  // 3 — Video (18%)
  if (M.video) {
    const sr = M.video.salesRate ?? 0;
    push('video', 'Video / Konten', 0.18,
      scale(sr, 0, B.pct_video_sales.good * 1.5) * 0.55 + scale(M.video.gpm ?? 0, 0, B.gpm_video.good * 1.5) * 0.45,
      `${M.video.adaPenjualan}/${M.video.total} video ada penjualan (${pctTxt(sr, 1)}) • ${M.video.gpm == null ? '—' : 'Rp' + Math.round(M.video.gpm).toLocaleString('id-ID')}/1.000 views`);
  } else {
    push('video', 'Video / Konten', 0.18, 5, MISSING('video'));
  }

  // 4 — Kartu produk & Shop Tab (14%)
  {
    const kartu = M.kanal.items.find((x) => x.key === 'kartu');
    const share = kartu?.persen ?? null;
    const cvr = M.kpi.cvr;
    push('kartu', 'Kartu Produk & Shop Tab', 0.14,
      scale(share, 0, 0.4) * 0.5 + scale(cvr, 0, B.cvr_toko.good * 1.5) * 0.5,
      `Kontribusi ${pctTxt(share, 1)} GMV • CVR toko ${pctTxt(cvr, 2)}`);
  }

  // 5 — Affiliate (12%)
  if (M.affiliate) {
    const pp = M.affiliate.pctProduktif ?? 0;
    push('affiliate', 'Affiliate / Kreator', 0.12,
      scale(pp, 0, B.pct_kreator_produktif.good * 1.5) * 0.6
      + scale(div(M.affiliate.gmv, M.kpi.gmvKotor) ?? 0, 0, 0.4) * 0.4,
      `${M.affiliate.produktif}/${M.affiliate.total} kreator hasilkan penjualan (${pctTxt(pp, 1)}) • ${M.affiliate.nempel} posting tanpa hasil`);
  } else {
    push('affiliate', 'Affiliate / Kreator', 0.12, 5, MISSING('afiliasi'));
  }

  // 6 — Portfolio produk (12%). Weighted by GMV, not SKU count: a 500-SKU
  // catalogue always has a long low-traffic tail, and counting SKUs would fail
  // every large store regardless of where the revenue actually comes from.
  if (M.kuadran) {
    const b = M.kuadran.benchmark;
    const g = (q: keyof typeof b): number => b[q].reduce((a, p) => a + p.gmv, 0);
    const aktif = g('bintang') + g('hidden_gem') + g('bocor_traffic') + g('evaluasi');
    if (aktif > 0) {
      const baik = (g('bintang') + g('hidden_gem')) / aktif, bocor = g('bocor_traffic') / aktif;
      push('produk', 'Portfolio Produk', 0.12, 3 + baik * 7 - bocor * 3,
        `${b.bintang.length} bintang & ${b.hidden_gem.length} hidden gem = ${pctTxt(baik)} GMV • ${b.bocor_traffic.length} bocor traffic = ${pctTxt(bocor)} GMV`);
    } else {
      push('produk', 'Portfolio Produk', 0.12, 3, 'tidak ada produk aktif di periode ini');
    }
  } else {
    push('produk', 'Portfolio Produk', 0.12, 5, MISSING('analitik produk'));
  }

  const total = Math.round(D.reduce((a, x) => a + x.skor * x.bobot, 0) * 10) / 10;
  return { total, label: total >= 8 ? 'SEHAT' : total >= 6 ? 'PERLU PERHATIAN' : 'KRITIS', dimensi: D };
}
