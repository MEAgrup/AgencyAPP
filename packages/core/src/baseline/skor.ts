/**
 * Baseline engine — Skor Kondisi Toko, 5 pilar sadar-cakupan (RAB-02).
 * Ported from the tool `sub` + `score` (lines 810-861).
 *
 * ⛔ JANGAN ubah: median-bukan-rata-rata (via histStats), bobot 5 pilar,
 * normalisasi ulang bobot saat sebuah pilar tanpa data (`ada=false`).
 *
 * FIX #1 (handoff §2.2): SEMUA situs panggil memakai `mul(x,100)` — `null*100`
 * jadi `0` membatalkan penjagaan null, jadi metrik yang null (kolom absen) tak
 * boleh menyusup sebagai 0% ke skor.
 * FIX #4: benchmark = PARAMETER (`bench`), bukan global yang bisa diedit browser.
 */
import { clamp, div, mul } from './angka';
import type { Metrics } from './metrik';
import type { HistStats } from './riwayat';
import type { Benchmark } from './types';

/** One weighted sub-signal: normalised ratio r∈[0,1] with weight w. */
export interface Sub {
  r: number;
  w: number;
}

export interface Pillar {
  k: 'gmv' | 'video' | 'live' | 'aff' | 'prod';
  l: string;
  parts: (Sub | null)[];
  /** total weight of the non-null parts (0 when the pillar has no data). */
  w: number;
  /** 0..100, or null when the pillar has no data. */
  score: number | null;
  ada: boolean;
}

export interface Score {
  P: Pillar[];
  /** 0..100, or null when nothing scorable was uploaded. */
  total: number | null;
  /** tool label: "Mesin Jalan" | "Mesin Sebagian" | "Fondasi Perlu Dibenahi" | "Mesin Belum Terbangun" | "—". */
  verdict: string;
  vclass: 'ok' | 'mid' | 'low' | 'bad' | 'off';
  /** fraction of the maximum possible weight that actually had data. */
  coverage: number | null;
}

/** Normalise one signal to r∈[0,1] against a target; invert for "lower is better". */
export function sub(val: number | null, target: number, invert: boolean, w: number): Sub | null {
  if (val == null) return null;
  const r = invert ? (val <= target ? 1 : target / val) : target ? val / target : 0;
  return { r: clamp(r, 0, 1), w };
}

export function score(M: Metrics, H: HistStats, bench: Benchmark): Score {
  const B = bench;
  const P: Pillar[] = [];

  // 1 — GMV & pertumbuhan
  const g: (Sub | null)[] = [];
  g.push(sub(H.months, 6, false, 8));
  g.push(M.toko ? sub(mul(M.toko.cr, 100), B.cr, false, 9) : null);
  g.push(M.toko ? sub(mul(M.toko.refundRate, 100), B.refund, true, 4) : null);
  g.push(H.trend == null ? null : { r: clamp((H.trend + 0.2) / 0.4, 0, 1), w: 4 });
  P.push({ k: 'gmv', l: 'GMV & Pertumbuhan', parts: g, w: 0, score: null, ada: false });

  // 2 — konten video
  const v: (Sub | null)[] = [];
  if (M.vT) {
    v.push(sub(M.vT.posted || M.vT.total, B.vidPostToko, false, 5));
    v.push(sub(mul(M.vT.rate, 100), B.vidSalesToko, false, 10));
    v.push(sub(M.vT.gpmMed, B.gpmToko, false, 3));
  }
  if (M.vA) v.push(sub(mul(M.vA.rate, 100), B.vidSalesAff, false, 7));
  P.push({ k: 'video', l: 'Konten Video', parts: v.length ? v : [null], w: 0, score: null, ada: false });

  // 3 — live
  const l: (Sub | null)[] = [];
  if (M.lT) {
    l.push(sub(M.lT.sesi, B.liveSesi, false, 7));
    l.push(sub(M.lT.jam, B.liveJam, false, 5));
    l.push(sub(M.lT.gmvPerJam, B.liveGmvJam, false, 5));
    l.push(sub(mul(M.lT.ctorMed, 100), B.liveCtor, false, 3));
  }
  P.push({ k: 'live', l: 'LIVE Toko', parts: l.length ? l : [null], w: 0, score: null, ada: false });

  // 4 — affiliate
  const a: (Sub | null)[] = [];
  if (M.aff) {
    a.push(sub(mul(M.aff.rateAktif, 100), B.krSales, false, 7));
    a.push(sub(mul(M.aff.nempelRate, 100), 40, true, 4));
    a.push(sub(mul(M.aff.top5Share, 100), B.krKonsen, true, 5));
  }
  if (M.vA) a.push(sub(mul(M.vA.rate, 100), B.vidSalesAff, false, 4));
  P.push({ k: 'aff', l: 'Mesin Afiliasi', parts: a.length ? a : [null], w: 0, score: null, ada: false });

  // 5 — produk & ads
  const p: (Sub | null)[] = [];
  if (M.prod) p.push(sub(mul(M.prod.rate, 100), B.skuSales, false, 5));
  if (M.ads && M.ads.spend > 0) {
    p.push(sub(M.ads.roas, B.roas, false, 3));
    if (M.toko) p.push(sub(mul(div(M.ads.rev, M.toko.gmv), 100), B.adsDep, true, 2));
  }
  P.push({ k: 'prod', l: 'Produk & Iklan', parts: p.length ? p : [null], w: 0, score: null, ada: false });

  P.forEach((pl) => {
    const ok = pl.parts.filter((x): x is Sub => Boolean(x));
    pl.w = ok.reduce((acc, x) => acc + x.w, 0);
    pl.score = pl.w ? clamp((ok.reduce((acc, x) => acc + x.r * x.w, 0) / pl.w) * 100, 0, 100) : null;
    pl.ada = !!pl.w;
  });
  const wsum = P.filter((pl) => pl.ada).reduce((acc, pl) => acc + pl.w, 0);
  const total = wsum ? Math.round(P.filter((pl) => pl.ada).reduce((acc, pl) => acc + (pl.score as number) * pl.w, 0) / wsum) : null;
  const vd: [string, Score['vclass']] =
    total == null ? ['—', 'off']
      : total >= 75 ? ['Mesin Jalan', 'ok']
        : total >= 60 ? ['Mesin Sebagian', 'mid']
          : total >= 45 ? ['Fondasi Perlu Dibenahi', 'low']
            : ['Mesin Belum Terbangun', 'bad'];
  return { P, total, verdict: vd[0], vclass: vd[1], coverage: div(wsum, P.reduce((acc, pl) => acc + (pl.w || 0), 0)) };
}
