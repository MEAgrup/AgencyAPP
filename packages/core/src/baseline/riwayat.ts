/**
 * Baseline engine — 6-month GMV history stats (RAB-02).
 * Ported from the tool `histStats` (lines 388-403). The month labels are built
 * by the UI; here the caller passes the entered `HistRow[]` and this computes
 * the anchors. DOM-free & deterministic.
 *
 * ⚠️ Satuan (resolusi §5.2, DECISIONS 2026-08-17): `med` (median 6 bln) dan `rr`
 * (run-rate 3 bln) keduanya **per bulan** (Rp/bulan). B1-5 = total 3 bulan ⇒
 * JANGAN petakan `med` ke B1-5 (salah satuan ~3×). `med`/`rr` → baseline GMV.
 */
import { median, n } from './angka';
import type { Benchmark, HistRow } from './types';

export interface HistFilledRow extends HistRow {
  g: number;
  o: number;
}

export interface HistStats {
  filled: HistFilledRow[];
  /** GMV Baseline · median (per bulan) — jangkar target kontrak. */
  med: number;
  /** rata-rata GMV 6 bulan terisi (per bulan). */
  avg6: number;
  /** run-rate: rata-rata GMV 3 bulan terakhir (per bulan) — kondisi terkini. */
  rr: number;
  /** rata-rata GMV 3 bulan sebelumnya (per bulan). */
  pr: number;
  /** (rr-pr)/pr, atau null bila belum ada 6 bulan. */
  trend: number | null;
  peak: number;
  peakRow: HistFilledRow | null;
  spike: boolean;
  months: number;
  cakupan: 'cukup' | 'kurang';
}

export function histStats(hist: HistRow[], bench: Benchmark): HistStats {
  const rows = hist.map((h) => ({ ...h, g: n(h.gmv), o: n(h.order) })).filter((r) => r.flag !== 'belum');
  const filled = rows.filter((r) => r.g > 0);
  const gs = filled.map((r) => r.g);
  const med = median(gs);
  const avg6 = gs.length ? gs.reduce((a, b) => a + b, 0) / gs.length : 0;
  const seq = hist.filter((h) => h.flag !== 'belum' && n(h.gmv) > 0);
  const last3 = seq.slice(-3).map((r) => n(r.gmv)), prev3 = seq.slice(-6, -3).map((r) => n(r.gmv));
  const rr = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
  const pr = prev3.length ? prev3.reduce((a, b) => a + b, 0) / prev3.length : 0;
  const trend = pr ? (rr - pr) / pr : null;
  const peak = Math.max(0, ...gs);
  const spike = med > 0 && peak >= med * bench.spikeFlag;
  const peakRow = filled.find((r) => r.g === peak) || null;
  return { filled, med, avg6, rr, pr, trend, peak, peakRow, spike, months: filled.length, cakupan: filled.length >= 3 ? 'cukup' : 'kurang' };
}
