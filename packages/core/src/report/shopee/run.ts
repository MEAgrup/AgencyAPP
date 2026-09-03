/**
 * Shopee report engine — orchestrator (tool `runPipeline`). Takes DETECTED
 * file slots + caller identity/time, returns metrics + score + insights + the
 * stored payload. Same shape as TikTok's `../run.ts`.
 *
 * Unlike TikTok, there is no export-derived date RANGE to resolve here —
 * Shopee's Seller Centre exports carry no machine-readable period header the
 * tool ever parsed (the owner's tool takes `periodName` as free text the AM
 * types, e.g. "Juni 2026"); `opts.periode` is that same free-text label,
 * passed straight through to the payload. `generatedAt` is still always the
 * SERVER clock (WIB), never a browser's — never called here, only received.
 */
import { buildInsights } from './insight';
import {
  buildShopeeMetrics, SHOPEE_PARSERS, type ParsedShopee, type ShopeeMetrics,
} from './metrik';
import { buildShopeeReportPayload, ENGINE_VERSI, type KlienIdentitasShopee, type ShopeeReportPayload } from './payload';
import { computeSkor, type Skor } from './skor';
import type { Insights } from '../insight';
import type { ShopeeBench, ShopeeModule, ShopeeSlots } from './types';

export interface RunShopeeReportOptions {
  bench: ShopeeBench;
  benchmarkVersi: number | null;
  klien: KlienIdentitasShopee;
  /** ISO-8601 from the server clock (modul tz WIB) — never a client `new Date()`. */
  generatedAt: string;
  /** Free-text period label the AM supplies (tool `periodName`) — Shopee has no machine-readable range to derive it from. */
  periode: string;
  /** Filenames rejected upstream for carrying a different store identity (tool guardrail `extractIdentity`). */
  filesRejected?: string[];
}

export interface ShopeeReportResult {
  M: ShopeeMetrics;
  skor: Skor;
  insight: Insights;
  payload: ShopeeReportPayload;
}

export function runShopeeReport(slots: ShopeeSlots, opts: RunShopeeReportOptions): ShopeeReportResult {
  if (!slots.bisnis_home) {
    throw new Error('[berkas Bisnis — Home wajib ada untuk membuat laporan]');
  }
  const parsed: ParsedShopee = {};
  const errors: Partial<Record<ShopeeModule, string>> = {};
  for (const mod of Object.keys(slots) as ShopeeModule[]) {
    const aoa = slots[mod];
    if (!aoa) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parsed as any)[mod] = SHOPEE_PARSERS[mod](aoa);
    } catch (e) {
      errors[mod] = e instanceof Error ? e.message : String(e);
    }
  }
  if (!parsed.bisnis_home) {
    throw new Error(errors.bisnis_home ?? '[berkas Bisnis — Home gagal diparse]');
  }

  const M = buildShopeeMetrics(parsed, opts.bench);
  const skor = computeSkor(M);
  const insight = buildInsights(M, skor);

  const presence: Partial<Record<ShopeeModule, boolean>> = {};
  for (const mod of Object.keys(slots) as ShopeeModule[]) if (slots[mod]) presence[mod] = true;

  const payload = buildShopeeReportPayload(M, skor, insight, {
    klien: opts.klien,
    generatedAt: opts.generatedAt,
    periode: opts.periode,
    bench: opts.bench,
    benchmarkVersi: opts.benchmarkVersi,
    slots: presence,
    filesRejected: opts.filesRejected ?? [],
  });

  return { M, skor, insight, payload };
}

export { ENGINE_VERSI };
