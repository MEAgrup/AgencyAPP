/**
 * Orkestrator baseline Shopee (B2) — padanan `../run.ts` (TikTok).
 *
 * Alurnya sengaja MEMANGGIL mesin laporan Shopee apa adanya
 * (`detect` → `SHOPEE_PARSERS` → `buildShopeeMetrics` → `computeSkor`) dan
 * hanya menambahkan dua langkah baseline di ujungnya: irisan Section B
 * (`buildShopeeBaselineMetrics`) dan payload (`buildShopeeBaselinePayload`).
 * Tidak ada parser, ambang, atau rumus skor yang ditulis ulang di sini —
 * kalau ada, itu versi kedua dari aturan bisnis yang sama.
 */
import { detectModule } from '../../report/shopee/detect';
import { buildShopeeMetrics, SHOPEE_PARSERS, type ParsedShopee, type ShopeeMetrics } from '../../report/shopee/metrik';
import { computeSkor, type Skor } from '../../report/shopee/skor';
import type { Aoa } from '../types';
import type { ShopeeBench, ShopeeModule } from '../../report/shopee/types';
import { histStats, type HistStats } from '../riwayat';
import type { Benchmark, HistRow } from '../types';
import { buildShopeeBaselineMetrics, type ShopeeBaselineMetrics } from './metrik-baseline';
import { buildShopeeBaselinePayload, type PayloadOptionsShopeeBaseline, type ShopeeBaselinePayload } from './payload';

/** Pesan BI (aturan rumah #5). */
export const MSG_SHOPEE_HOME_WAJIB = '[berkas Bisnis — Home wajib ada untuk membuat baseline Shopee]';
export const MSG_SHOPEE_TIDAK_DIKENALI = '[tipe berkas Shopee tidak dikenali — pilih tipe untuk berkas berikut]';

/** Satu berkas export yang sudah di-AoA-kan di browser (parser xlsx tetap di tepi). */
export interface ShopeeFileInput {
  filename: string;
  aoa: Aoa;
  /** Pilihan tipe eksplisit AM ketika deteksi gagal — mesin tak pernah menebak diam-diam. */
  tipeOverride?: ShopeeModule | null;
}

export interface RunShopeeBaselineOptions {
  bench: ShopeeBench;
  /** Versi `report_benchmark_shopee` yang `bench` berasal darinya. */
  benchmarkVersi: number | null;
  /** Ambang riwayat GMV (`riset_awal_benchmark`) — dipakai `histStats` saja,
   *  yang platform-netral. Ambang PERFORMA Shopee tetap dari `bench` di atas. */
  benchRiwayat: Benchmark;
  klien: PayloadOptionsShopeeBaseline['klien'];
  generatedAt: string;
  periode: string | null;
}

export interface ShopeeBaselineResult {
  M: ShopeeMetrics;
  B: ShopeeBaselineMetrics;
  H: HistStats;
  skor: Skor;
  payload: ShopeeBaselinePayload;
  /** Tipe yang akhirnya dipakai per berkas — untuk baris provenance. */
  terdeteksi: { filename: string; module: ShopeeModule | null }[];
}

export function runShopeeBaseline(
  files: ShopeeFileInput[],
  hist: HistRow[],
  opts: RunShopeeBaselineOptions,
): ShopeeBaselineResult {
  const parsed: ParsedShopee = {};
  const slots: Partial<Record<ShopeeModule, boolean>> = {};
  const terdeteksi: { filename: string; module: ShopeeModule | null }[] = [];
  const gagal: string[] = [];

  for (const f of files) {
    const mod = f.tipeOverride ?? detectModule(f.filename, f.aoa)?.module ?? null;
    terdeteksi.push({ filename: f.filename, module: mod });
    if (!mod) { gagal.push(f.filename); continue; }
    // Berkas kedua untuk slot yang sama: yang PERTAMA menang, sama seperti
    // mesin laporan. Menimpanya diam-diam akan membuat hasil bergantung pada
    // urutan unggah.
    if (slots[mod]) continue;
    parsed[mod] = SHOPEE_PARSERS[mod](f.aoa) as never;
    slots[mod] = true;
  }

  // Gerbang berkas: HANYA `bisnis_home` yang wajib (keputusan pemilik
  // 2026-09-06). Modul lain yang absen ⇒ bloknya `null` di payload dan
  // dimensinya dinilai netral 5/10 SAMBIL mengatakan berkasnya tak diunggah.
  if (!parsed.bisnis_home) {
    throw new Error(gagal.length > 0 ? `${MSG_SHOPEE_TIDAK_DIKENALI} ${gagal.join(', ')}` : MSG_SHOPEE_HOME_WAJIB);
  }

  const M = buildShopeeMetrics(parsed, opts.bench);
  const skor = computeSkor(M);
  const B = buildShopeeBaselineMetrics(M, slots);
  const H = histStats(hist, opts.benchRiwayat);
  const payload = buildShopeeBaselinePayload(B, H, skor, {
    klien: opts.klien,
    generatedAt: opts.generatedAt,
    periode: opts.periode,
    bench: opts.bench,
    benchmarkVersi: opts.benchmarkVersi,
    hist,
    slots,
  });
  return { M, B, H, skor, payload, terdeteksi };
}
