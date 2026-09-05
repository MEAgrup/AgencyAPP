/**
 * Report engine — orchestrator. Takes DETECTED file slots + caller identity/time,
 * returns metrics + score + insights + the stored payload.
 *
 * The period is resolved here, once, and everything downstream reads it: the
 * export's own date range wins; when no range is readable the nominal length of
 * the chosen period type is used AND `rentang_dari_berkas:false` records that it
 * was a fallback, so a reader can tell a real 28-day month from a guess.
 */
import { toko } from '../baseline/metrik';
import { hariNominal, prorateBench, REPORT_BENCH_V1 } from './bench';
import { rentangOf } from './detect';
import { buildInsights, type Insights } from './insight';
import {
  adsReport, affiliateReport, kanal, kpiToko, kuadranProduk, liveReport,
  tokpedReport, ttamReport, videoReport, type ReportMetrics,
} from './metrik';
import { buildReportPayload, type KlienIdentitas, type ReportPayload } from './payload';
import { computeSkor, type Skor } from './skor';
import { buildTahap, type TahapKey, type TahapReport } from './tahap';
import type { PeriodeTipe, ReportBench, ReportFileType, ReportSlots, Rentang } from './types';

export interface RunReportOptions {
  periodeTipe: PeriodeTipe;
  /** Monthly benchmark from `report_benchmark`; volume keys get pro-rated here. */
  bench?: ReportBench;
  benchmarkVersi?: number | null;
  /** 'net' GMV (MEA standard) vs 'gross'. */
  net?: boolean;
  klien: KlienIdentitas;
  /** ISO-8601 from the server clock (modul tz WIB) — never a client `new Date()`. */
  generatedAt: string;
  /** The client's own linked TikTok handles, excluded from the creator pool. */
  akunSendiri?: string[];
  /**
   * R3 — the stage this shop is chasing, read from `client_platforms.tahap_fokus`
   * at generation time and STAMPED into the payload. Null (the default) is a
   * legitimate state: the report renders all three stages with no focus badge.
   */
  tahapFokus?: TahapKey | null;
}

export interface ReportResult {
  M: ReportMetrics;
  skor: Skor;
  tahap: TahapReport;
  insight: Insights;
  payload: ReportPayload;
  rentang: Rentang;
  rentangDariBerkas: boolean;
}

/**
 * Resolve the reporting period. The store export is authoritative (it is the file
 * every headline number comes from); any other export's range is a fallback.
 */
export function resolveRentang(slots: ReportSlots, tipe: PeriodeTipe): { rentang: Rentang; dariBerkas: boolean } {
  const urut: ReportFileType[] = ['shop_tt', 'shop_tp', 'prod_tt', 'live_toko', 'vid_toko', 'aff_kr'];
  for (const k of urut) {
    const s = slots[k];
    if (!s) continue;
    const r = rentangOf(s.meta);
    if (r) return { rentang: r, dariBerkas: true };
  }
  const hari = hariNominal(tipe);
  return { rentang: { mulai: '', akhir: '', hari }, dariBerkas: false };
}

export function runReport(slots: ReportSlots, opts: RunReportOptions): ReportResult {
  const net = opts.net ?? true;
  const T = slots.shop_tt ? toko(slots.shop_tt, { net }) : null;
  if (!T) {
    throw new Error('[berkas Analitik Toko TikTok wajib ada untuk membuat laporan]');
  }
  const { rentang, dariBerkas } = resolveRentang(slots, opts.periodeTipe);
  const benchDasar = opts.bench ?? REPORT_BENCH_V1;
  const bench = prorateBench(benchDasar, rentang.hari);

  // Own accounts: what CDPS records, plus the creators that appear in the store's
  // OWN video/live exports (those files are, by definition, the shop's own posts).
  const sendiri = new Set((opts.akunSendiri ?? []).map((x) => x.trim()).filter(Boolean));
  if (slots.vid_toko) {
    for (const row of slots.vid_toko.rows) {
      const v = row['Nama Kreator'];
      if (v != null && String(v).trim()) sendiri.add(String(v).trim());
    }
  }

  const M: ReportMetrics = {
    kpi: kpiToko(T, net),
    kanal: kanal(T),
    ads: adsReport(slots.ads_prod ?? null, slots.ads_live ?? null),
    live: liveReport(slots.live_toko ?? null),
    video: videoReport(slots.vid_toko ?? null, slots.vid_aff ?? null),
    kuadran: kuadranProduk(slots.prod_tt ?? null, bench),
    affiliate: affiliateReport(slots.aff_kr ?? null, slots.live_aff ?? null, [...sendiri]),
    tokped: tokpedReport(slots.shop_tp ?? null),
    ttam: ttamReport(slots),
    rentang,
  };

  const skor = computeSkor(M, bench);
  // Order matters: the stage layer feeds `buildInsights`, which drafts one
  // paragraph per stage. Both read the SAME `M` and the SAME pro-rated bench, so
  // the prose can never describe a stage differently from the table beside it.
  const tahap = buildTahap(M, bench, opts.tahapFokus ?? null);
  const insight = buildInsights(M, skor, bench, opts.periodeTipe, tahap);

  const presence: Partial<Record<ReportFileType, boolean>> = {};
  for (const k of Object.keys(slots) as ReportFileType[]) if (slots[k]) presence[k] = true;

  const payload = buildReportPayload(M, skor, insight, {
    klien: opts.klien,
    generatedAt: opts.generatedAt,
    periodeTipe: opts.periodeTipe,
    rentang,
    rentangDariBerkas: dariBerkas,
    net,
    bench,
    benchDasar,
    benchmarkVersi: opts.benchmarkVersi ?? null,
    slots: presence,
    tahap,
  });

  return { M, skor, tahap, insight, payload, rentang, rentangDariBerkas: dariBerkas };
}

/**
 * The monthly RUN-RATE of a report's GMV — what `clients.total_sales` is
 * measured in (DECISIONS 2026-08-19, keputusan 3). A monthly report is already a
 * month, so it passes through; a weekly report is scaled to 30 days so a weekly
 * upload and a monthly upload write the same UNIT into the same column. Without
 * this a Monday-morning weekly upload would drop `total_sales` ~4× and crater the
 * client's Health Score for reasons that have nothing to do with performance.
 */
export function gmvRunRateBulanan(gmv: number, tipe: PeriodeTipe, hari: number): number {
  if (tipe === 'bulanan') return gmv;
  const d = Math.max(1, Math.round(hari));
  return (gmv * 30) / d;
}
