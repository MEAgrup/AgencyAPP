/**
 * TikTok Ads Scanner engine — orchestrator. Mirrors `../../report/run.ts` /
 * `../../baseline/run.ts`: takes already-detected/parsed input + caller
 * identity/time, returns metrics + score + insight + the stored payload.
 *
 * Scope of this pass (see `docs/DECISIONS.md` O67): scores ONE client's
 * dataset per call. The tool's multi-client portfolio/`localStorage` layer
 * is not represented here at all — there is no `state.clients` equivalent.
 */
import { ADSSCANNER_BENCH_V1, benchOf } from './bench';
import { buildInsight, type AdsScannerInsight } from './insight';
import { computeMetrik, type AdsScannerInput, type Metrik } from './metrik';
import { buildAdsScannerPayload, type AdsScannerPayload, type KlienIdentitas, type PeriodeOptions } from './payload';
import { realokasiPool, scoreAll } from './skor';
import type { AdsScannerBench, AdsScannerConfig, AdsScannerFileType, SkuResult } from './types';

export interface RunAdsScannerOptions {
  cfg: AdsScannerConfig;
  /** Versioned benchmark table; defaults to `ADSSCANNER_BENCH_V1`. */
  bench?: AdsScannerBench;
  benchmarkVersi?: number | null;
  klien: KlienIdentitas;
  /** ISO-8601 from the server clock (modul tz WIB) — never a client `new Date()`. */
  generatedAt: string;
  /** AM-entered "which week is this export" date — pure data, not a clock read. */
  periode: PeriodeOptions;
}

export interface AdsScannerResult {
  M: Metrik;
  sku: SkuResult[];
  insight: AdsScannerInsight;
  payload: AdsScannerPayload;
}

export function runAdsScanner(input: AdsScannerInput, opts: RunAdsScannerOptions): AdsScannerResult {
  const bench = opts.bench ?? ADSSCANNER_BENCH_V1;
  const benchKat = benchOf(bench, opts.cfg.category);

  const M = computeMetrik(input, opts.cfg);
  const sku = scoreAll(M.sku, benchKat, opts.cfg, M.medCtr, M.medCtor, M.gmvP70);
  const { pool, realokasi } = realokasiPool(sku, M.orphan);

  const insight = buildInsight({
    sku,
    videosRaw: M.videos,
    orphan: M.orphan,
    bench: benchKat,
    cfg: opts.cfg,
    poolRealokasi: pool,
    medCtr: M.medCtr,
    medCtor: M.medCtor,
  });

  const slots: Partial<Record<AdsScannerFileType, boolean>> = {
    analitik: input.analitik.length > 0,
    ads: input.ads.length > 0,
    video: input.videos.length > 0,
    adslive: input.adslive.length > 0,
  };

  const payload = buildAdsScannerPayload(
    {
      ringkasan: insight.ringkasan,
      flags: insight.flags,
      vonis: insight.vonis,
      sku,
      orphan: M.orphan,
      realokasiPool: pool,
      realokasi,
      anglesKreator: insight.anglesKreator,
      anglesToko: insight.anglesToko,
      perSkuWinners: insight.perSkuWinners,
      gpmBm: insight.gpmBm,
    },
    {
      klien: opts.klien,
      generatedAt: opts.generatedAt,
      cfg: opts.cfg,
      bench,
      benchmarkVersi: opts.benchmarkVersi ?? null,
      periode: opts.periode,
      slots,
    },
  );

  return { M, sku, insight, payload };
}
