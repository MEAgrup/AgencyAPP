/**
 * Shopee report engine — overall 0–10 performance score (tool `computeScore`).
 *
 * Six weighted dimensions summing to 1.00 — weights and formulas ported
 * VERBATIM from `docs/design/SHOPEE_REPORT_ENGINE.html` (`DIMENSI`), already
 * confirmed against `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` §5:
 * ROAS & Channel .22, Traffic Quality .22, Conversion & Retention .18, Product
 * Performance .14, Live Streaming .12, Kesehatan Toko .12.
 *
 * Two classes of fix applied while porting (required fix #1 — null must never
 * read as a confirmed value):
 *  - every `x||0` guarding a scale-function INPUT is removed. `scaleV()` (like
 *    TikTok's `scale()`) already returns a neutral 5 for a null input; feeding
 *    it `null||0` instead defeats that on purpose and scores "no data" as
 *    "the worst possible value", which is a much stronger and wronger claim.
 *  - `scoreLive` scored a MISSING file (bisnis_live never uploaded) the exact
 *    same 5 as "uploaded and has activity" — same NUMBER as TikTok's own
 *    missing-dimension convention (a neutral 5), but the note lied about why.
 *    The number is kept (it already matched the house pattern by accident);
 *    the note now says "tidak diunggah" instead of implying real activity.
 *
 * One class of INTENTIONAL non-fix, logged so it doesn't read as an oversight:
 * `scoreProduct` weights the portfolio dimension by SKU COUNT (bintang+hidden
 * vs bocor+evaluasi as a share of active SKUs), not by GMV the way TikTok's
 * `../skor.ts` portfolio dimension does. That is a genuine methodology
 * difference between the two shipped tools, not a bug — the task is to port
 * Shopee's business rule faithfully, not to make it match TikTok's.
 */
import { div } from '../../baseline/angka';
import type { ShopeeMetrics } from './metrik';
import type { Rekomendasi, SkorDimensi } from './types';

export interface Skor {
  total: number;
  label: 'SEHAT' | 'PERLU PERHATIAN' | 'KRITIS';
  dimensi: SkorDimensi[];
}

/**
 * Shopee's own `scaleV` (tool), kept distinct from TikTok's `../skor.ts:scale`
 * only because it needs an `invert` flag TikTok's dimensions never use (a
 * higher cancel rate is WORSE — cf. `scoreConv`). Same null-neutral contract:
 * a null input can never be scored, so it gets the same 5 as "average".
 */
function scaleV(v: number | null, low: number, high: number, invert = false): number {
  if (v == null || !isFinite(v) || high === low) return 5;
  const x = Math.max(0, Math.min(1, (v - low) / (high - low)));
  return Math.round((invert ? 10 * (1 - x) : 10 * x) * 10) / 10;
}

const clamp10 = (v: number): number => Math.round(Math.max(0, Math.min(10, v)) * 10) / 10;
const round1 = (v: number): number => Math.round(v * 10) / 10;
const pctTxt = (v: number | null, d = 1): string => (v == null ? '—' : (v * 100).toFixed(d).replace('.', ',') + '%');

const MISSING = (label: string): string => `file ${label} tidak diunggah — dimensi ini dinilai netral (5/10)`;

function scoreRoas(r: ShopeeMetrics): [number, string] {
  const a = r.health.ads;
  if (!a) return [5, MISSING('iklan')];
  if (a.roas == null) return [5, 'ROAS tidak bisa dihitung dari data yang tersedia — dinilai netral (5/10)'];
  const roas = a.roas;
  let s: number;
  if (roas >= 6) s = 10;
  else if (roas >= 4) s = 7 + (roas - 4) * 1.5;
  else if (roas >= 2) s = 4 + (roas - 2) * 1.5;
  else s = Math.max(1, roas * 3);
  return [clamp10(s), `ROAS overall ${roas.toFixed(2)}x`];
}

function scoreTraffic(r: ShopeeMetrics): [number, string] {
  const ctr = r.health.ads?.ctr ?? null;
  const cr = r.kpi_utama.pesanan_dibuat.cr;
  const c = round1((scaleV(ctr, 0.005, 0.03) + scaleV(cr, 0.02, 0.06)) / 2);
  return [c, `CTR ads ${pctTxt(ctr, 2)}, CR toko ${pctTxt(cr, 2)}`];
}

function scoreConv(r: ShopeeMetrics): [number, string] {
  const k = r.kpi_utama.pesanan_dibuat;
  const cancel = k.pesanan ? div(k.batal_pesanan ?? 0, k.pesanan) : null;
  const c = round1(scaleV(k.cr, 0.02, 0.06) * 0.5 + scaleV(k.repeat_rate, 0.10, 0.30) * 0.2 + scaleV(cancel, 0.02, 0.20, true) * 0.3);
  return [c, `CR ${pctTxt(k.cr, 2)}, repeat ${pctTxt(k.repeat_rate)}, cancel ${pctTxt(cancel, 1)}`];
}

function scoreProduct(r: ShopeeMetrics): [number, string] {
  const b = r.kuadran?.mode_absolute ?? r.kuadran?.mode_relatif;
  if (!b) return [5, MISSING('Analitik Produk')];
  const aktif = b.bintang.length + b.hidden_gem.length + b.bocor_traffic.length + b.evaluasi.length;
  if (!aktif) return [3, 'tidak ada produk aktif di periode ini'];
  const good = (b.bintang.length + b.hidden_gem.length) / aktif;
  const bad = (b.bocor_traffic.length + b.evaluasi.length) / aktif;
  const s = clamp10(3 + good * 7 - bad * 4);
  return [s, `${b.bintang.length} bintang, ${b.hidden_gem.length} hidden gem, ${b.bocor_traffic.length} bocor traffic, ${b.evaluasi.length} evaluasi (vs benchmark)`];
}

function scoreLive(r: ShopeeMetrics): [number, string] {
  if (!r.live_uploaded) return [5, MISSING('Live (Bisnis)')];
  if (r.zero_activity.includes('bisnis_live')) return [1, 'Tidak ada sesi live streaming di periode ini'];
  return [5, 'Ada aktivitas live streaming di periode ini'];
}

function scoreKesehatanToko(r: ShopeeMetrics): [number, string] {
  const kt = r.kesehatan_toko;
  if (!kt) return [5, MISSING('Kesehatan Toko')];
  const p = kt.poin_total;
  if (p === 0) return [10, '0 poin penalti — toko bersih'];
  const s = p === 1 ? 5 : p === 2 ? 3 : 1;
  const d = kt.penalti[0]?.deskripsi ?? '';
  return [s, `${p} poin penalti aktif — ${d.slice(0, 45)}`];
}

const DIMENSI: [string, string, number, (r: ShopeeMetrics) => [number, string]][] = [
  ['roas_channel', 'ROAS & Channel', 0.22, scoreRoas],
  ['traffic_quality', 'Traffic Quality', 0.22, scoreTraffic],
  ['conversion_retention', 'Conversion & Retention', 0.18, scoreConv],
  ['product_performance', 'Product Performance', 0.14, scoreProduct],
  ['live_streaming', 'Live Streaming', 0.12, scoreLive],
  ['kesehatan_toko', 'Kesehatan Toko', 0.12, scoreKesehatanToko],
];

export function computeSkor(M: ShopeeMetrics): Skor {
  const dimensi: SkorDimensi[] = [];
  let total = 0;
  for (const [key, label, bobot, fn] of DIMENSI) {
    const [skor, catatan] = fn(M);
    total += Math.round(skor * bobot * 100) / 100;
    dimensi.push({ key, label, bobot, skor, catatan });
  }
  total = Math.round(total * 10) / 10;
  const label = total >= 8 ? 'SEHAT' : total >= 6 ? 'PERLU PERHATIAN' : 'KRITIS';
  return { total, label, dimensi };
}

export type { Rekomendasi };
