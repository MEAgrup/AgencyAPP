/**
 * Shopee report engine — shared types (`cdps.report.shopee.v1`).
 *
 * Sibling of `../` (TikTok, `cdps.report.tiktok.v1`): same purity contract (no
 * DOM, no xlsx dependency, no clock of its own), same overall pipeline shape
 * (detect → metrik → skor → insight → payload → render → run). Ported from the
 * owner's `MEA Shopee Report Engine` HTML tool (`docs/design/SHOPEE_REPORT_ENGINE.html`).
 *
 * Where this DELIBERATELY does not mirror TikTok's shape 1:1 — logged here so
 * the divergence reads as a decision, not a miss:
 *
 *  - Shopee's exports are not one-header-row-per-file like Seller Center. A
 *    single "Home" export carries TWO sections ("Pesanan Dibuat" /
 *    "Pesanan Siap Dikirim") each with their own header row found by scanning,
 *    and "Produk"/"Voucher"/"Chat" locate their header by searching for an
 *    anchor cell rather than reading a fixed row. TikTok's `Sheet` (one
 *    detected header → column-keyed rows) cannot express that, so this module
 *    works on the raw `Aoa` (array-of-arrays) throughout, the same shape the
 *    owner's tool parsed — `detect.ts`/`metrik.ts` do their own header-finding,
 *    matching the tool's `findRow`/`mapHeader` approach, just typed and with
 *    the required fixes applied.
 *  - CONFIG (`kuadran`/`health`/`layanan`) has no per-day VOLUME thresholds the
 *    way TikTok's `sesi_live`/`quad_klik` do (Shopee's bands are all rates or
 *    percentiles), so there is no `prorateBench` here — see `bench.ts`.
 */
import type { Aoa } from '../../baseline/types';

/** The 17 file-type slots the tool's `MODULE_MAP` recognises. */
export type ShopeeModule =
  | 'bisnis_home'
  | 'bisnis_produk'
  | 'bisnis_live'
  | 'bisnis_kesehatan'
  | 'bisnis_video'
  | 'ads_toko'
  | 'ads_produk'
  | 'ads_live'
  | 'ads_banner'
  | 'aff_product'
  | 'aff_creator'
  | 'promo_diskon'
  | 'promo_voucher'
  | 'promo_flashsale'
  | 'layanan_chat'
  | 'layanan_broadcast'
  | 'meta';

/** Canonical order — mirrors the tool's `MODULE_MAP` value order. */
export const ALL_SHOPEE_MODULES: readonly ShopeeModule[] = [
  'bisnis_home', 'bisnis_produk', 'bisnis_live', 'ads_toko', 'ads_produk',
  'aff_product', 'aff_creator', 'promo_diskon', 'promo_voucher', 'promo_flashsale',
  'layanan_chat', 'layanan_broadcast', 'meta', 'bisnis_kesehatan', 'bisnis_video',
  'ads_live', 'ads_banner',
];

/** A detected file slot: the module it filled, plus the raw rows. */
export type ShopeeSlots = Partial<Record<ShopeeModule, Aoa>>;

/** Human label for each module — upload UI / diagnostics (tool `MODULE_LABEL`). */
export const SHOPEE_MODULE_LABEL: Record<ShopeeModule, string> = {
  bisnis_home: 'Bisnis — Home',
  bisnis_produk: 'Bisnis — Produk',
  bisnis_live: 'Bisnis — Live',
  ads_toko: 'Ads — Toko',
  ads_produk: 'Ads — Produk',
  aff_product: 'Affiliate — Product',
  aff_creator: 'Affiliate — Creator',
  promo_diskon: 'Promo — Diskon',
  promo_voucher: 'Promo — Voucher',
  promo_flashsale: 'Promo — Flashsale',
  layanan_chat: 'Layanan — Chat',
  layanan_broadcast: 'Layanan — Broadcast',
  meta: 'Meta CPAS',
  bisnis_kesehatan: 'Bisnis — Kesehatan Toko',
  bisnis_video: 'Bisnis — Shopee Video',
  ads_live: 'Ads — Live',
  ads_banner: 'Ads — Banner (Search Brand)',
};

/**
 * Benchmark shape — mirrors `CONFIG` in the HTML source (`kuadran`/`health`/
 * `layanan`) field-for-field, sourced from `report_benchmark_shopee`. Kept
 * nested (not flattened to `Record<key,{good,warn}>` like TikTok's
 * `ReportBench`) because CONFIG itself is nested and heterogeneous — some
 * entries are percentile fractions, some absolute cut-offs, two are booleans.
 * Flattening would just be a relabelling exercise with more surface for typos.
 */
export interface ShopeeBench {
  kuadran: {
    /** Which store metric feeds the CR axis. The tool supports only this one. */
    cr_basis: 'pesanan_per_pengunjung';
    percentile: { traffic_high_pct: number; traffic_low_pct: number; cr_high_pct: number; cr_low_pct: number };
    absolute: { traffic_low_max: number; traffic_high_min: number; conversion_low_max: number; conversion_high_min: number };
    /** A "medium" traffic band resolves to "high" when CR is high too (tool default: true). */
    medium_traffic_high_if_cr_high: boolean;
    /** A "medium" CR band resolves to "high" when traffic is high too (tool default: true). */
    medium_cr_high_if_traffic_high: boolean;
    /** Below this many visitors a product has not been tested fairly at all ("tidur"). */
    sleeper_visitor_max: number;
  };
  health: {
    roas_good: number; roas_warn: number;
    acos_good: number; acos_warn: number;
    ctr_good: number; cr_good: number;
    csat_good: number; chat_respon_max_detik: number;
  };
  layanan: {
    chat_response_rate_good: number;
    chat_order_conversion_good: number;
    csat_good: number;
    chat_respon_max_detik: number;
    cancel_rate_good: number;
    cancel_rate_warn: number;
  };
}

/** Traffic-light flag — reused from `../types` (TikTok declares it, Shopee is the first to actually attach one per metric). */
export type { Flag, Rekomendasi, SkorDimensi } from '../types';
