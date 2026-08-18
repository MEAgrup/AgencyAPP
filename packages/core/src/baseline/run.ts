/**
 * Baseline engine — orchestrator (RAB-02). Mirrors the tool `run()` (lines 788-807)
 * minus the DOM: takes the DETECTED slots + entered 6-month history + caller
 * identity/time, returns metrics + score + findings + the payload.
 */
import { aff, ads, live, prod, tp, toko, video, type Metrics } from './metrik';
import { buildPayload, type BaselinePayload, type PayloadOptions } from './payload';
import { histStats, type HistStats } from './riwayat';
import { score, type Score } from './skor';
import { findings } from './temuan';
import type { Benchmark, FileType, Finding, HistRow, Sheet } from './types';

/** Detected file-type slots (each an already-parsed Sheet). */
export type RunSlots = Partial<Record<FileType, Sheet>>;

export interface RunOptions {
  bench: Benchmark;
  benchmarkVersi?: number | null;
  /** 'net' GMV (MEA standard) vs 'gross'. */
  net: boolean;
  klien: PayloadOptions['klien'];
  /** ISO-8601 from the server clock (modul tz WIB) — never a client `new Date()`. */
  generatedAt: string;
}

export interface BaselineResult {
  M: Metrics;
  H: HistStats;
  sc: Score;
  F: Finding[];
  payload: BaselinePayload;
}

export function runBaseline(slots: RunSlots, hist: HistRow[], opts: RunOptions): BaselineResult {
  const net = opts.net;
  const M: Metrics = {
    toko: slots.shop_tt ? toko(slots.shop_tt, { net }) : null,
    tp: slots.shop_tp ? tp(slots.shop_tp) : null,
    vT: slots.vid_toko ? video(slots.vid_toko, (slots.shop_tt || slots.vid_toko).periode) : null,
    vA: slots.vid_aff ? video(slots.vid_aff, (slots.shop_tt || slots.vid_aff).periode) : null,
    lT: slots.live_toko ? live(slots.live_toko) : null,
    lA: slots.live_aff ? live(slots.live_aff) : null,
    aff: slots.aff_kr ? aff(slots.aff_kr) : null,
    prod: slots.prod_tt ? prod(slots.prod_tt) : null,
    ads: slots.ads_prod || slots.ads_live ? ads(slots.ads_prod ?? null, slots.ads_live ?? null) : null,
  };
  const H = histStats(hist, opts.bench);
  const sc = score(M, H, opts.bench);
  const F = findings(M, H, sc, opts.bench);
  const presence: Partial<Record<FileType, boolean>> = {};
  (Object.keys(slots) as FileType[]).forEach((k) => {
    if (slots[k]) presence[k] = true;
  });
  const payload = buildPayload(M, H, sc, F, {
    klien: opts.klien,
    generatedAt: opts.generatedAt,
    net,
    bench: opts.bench,
    benchmarkVersi: opts.benchmarkVersi ?? null,
    hist,
    slots: presence,
  });
  return { M, H, sc, F, payload };
}
