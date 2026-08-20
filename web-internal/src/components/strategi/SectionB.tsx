'use client';

/**
 * A-13b — Section B (Baseline per Channel).
 *
 * One ChannelDraft per contracted channel; all fields are text so that empty
 * stays empty (Number('') = 0 silently, which is wrong for "not yet entered").
 *
 * B-1 (baseline months) and E-2 (priority) are saved via saveStrategiChannels;
 * baseline rows use a separate endpoint saveStrategiBaseline per channel.
 * The page.tsx save case for 'B' calls channelDraftToBody() for the channels
 * PUT, then baselineDraftToBody() for each channel's baseline PUT.
 *
 * Note on Rule 4: channels with status_channel === 'Belum Aktif' skip the
 * historical baseline (B-1) and most B-2…B-9 fields; only B-0 identity +
 * opening prerequisites + E-2 priority are shown for them.
 */

import { useState } from 'react';
import RepeatList from './RepeatList';
import {
  CAMPAIGN_TYPES,
  CHANNEL_STATES,
  CHANNELS,
  COMPETITOR_EDGES,
  ENTRY_POINTS,
  KOMPETITOR_MAX,
  LIVE_HOSTS,
  PLATFORM_PROGRAMS,
  PRIORITAS_LABELS,
  SAMPLE_PROGRAMS,
  STUDIO_STATES,
  TOP_SKU_MAX,
  type Channel,
  type StrategiBaselinePrefill,
  type StrategiChannelBaselineSuggestion,
  type StrategiDetail,
} from '@/lib/strategi';

// ---------------------------------------------------------------------------
// Draft types
// ---------------------------------------------------------------------------

export interface BaselineMonthDraft {
  month_index: number;
  gmv: string;
  jumlah_pesanan: string;
  persen_batal: string;
  ad_spend: string;
  roas: string;
  acos: string;
}

export interface TopSkuDraft {
  nama: string;
  gmv: string;
  unit_terjual: string;
  harga_jual: string;
  margin_persen: string;
}

export interface TopKeywordDraft {
  keyword: string;
  jumlah_order: string;
}

export interface KampanyeBoncosDraft {
  nama: string;
  spend: string;
}

export interface TopKreatorDraft {
  nama: string;
  gmv: string;
}

export interface VoucherDraft {
  tipe: string;
  nilai: string;
  syarat: string;
}

export interface KompetitorDraft {
  nama: string;
  url: string;
  harga_sebanding: string;
  estimasi_penjualan_bulan: string;
}

/** One entry per contracted channel — the complete B-0…B-9 + E-2 payload. */
export interface ChannelDraft {
  // B-0 identity
  channel: string;
  channel_lain: string;
  status_channel: string;
  nama_toko: string;
  url_toko: string;
  umur_toko_bulan: string;
  badge: string;
  /** Only for 'Belum Aktif' */
  target_tanggal_live: string;
  prasyarat_pembukaan: string[];
  // B-0 data provenance
  sumber_data: string;
  tanggal_ambil_data: string;
  lampiran: string;
  // B-0.7 baseline period
  periode_baseline_bulan: string;
  periode_mulai: string;
  periode_akhir: string;
  alasan_periode_pendek: string;
  catatan_periode_pendek: string;
  // E-2 priority (saved with channels)
  prioritas: string;
  prioritas_alasan: string;
  // B-1 baseline months
  baseline: BaselineMonthDraft[];
  // B-2 trafik
  pengunjung_per_bulan: string;
  conversion_rate_persen: string;
  trafik_organik_persen: string;
  trafik_iklan_persen: string;
  trafik_affiliate_persen: string;
  trafik_live_persen: string;
  trafik_video_persen: string;
  trafik_luar_persen: string;
  entry_point_utama: string;
  entry_point_catatan: string;
  // B-3 SKU
  sku_listed: string;
  sku_aktif: string;
  sku_pareto_80: string;
  top_sku: TopSkuDraft[];
  sku_slow_moving: string;
  sku_stok_kritis: string[];
  listing_layak_persen: string;
  // B-4 store health
  rating_toko: string;
  jumlah_ulasan: string;
  chat_response_rate_persen: string;
  chat_response_menit: string;
  pesanan_terlambat_persen: string;
  poin_penalti: string;
  catatan_penalti: string;
  tema_keluhan: string[];
  // B-5 ads
  tipe_kampanye: string[];
  tipe_kampanye_tidak_ada: boolean;
  jumlah_kampanye_aktif: string;
  top_keyword: TopKeywordDraft[];
  kampanye_boncos: KampanyeBoncosDraft[];
  // B-6 affiliate
  affiliate_aktif_30hari: string;
  gmv_affiliate: string;
  gmv_affiliate_persen: string;
  komisi_open_persen: string;
  komisi_target_persen: string;
  top_kreator: TopKreatorDraft[];
  program_sampel: string;
  program_sampel_catatan: string;
  // B-7 content & live
  jumlah_video_per_bulan: string;
  total_views: string;
  gmv_video: string;
  jam_live_per_bulan: string;
  gmv_live: string;
  host_live: string;
  studio_live: string;
  studio_catatan: string;
  // B-8 promo
  voucher_aktif: VoucherDraft[];
  voucher_aktif_tidak_ada: boolean;
  program_platform: string[];
  program_platform_tidak_ada: boolean;
  beban_promo_persen: string;
  // B-9 competitor
  kompetitor: KompetitorDraft[];
  kompetitor_lebih_baik: string[];
  kompetitor_catatan: string;
  celah_kompetitor: string;
}

// ---------------------------------------------------------------------------
// Draft factory
// ---------------------------------------------------------------------------

function blankChannel(channel: string): ChannelDraft {
  return {
    channel,
    channel_lain: '',
    status_channel: 'Eksisting',
    nama_toko: '',
    url_toko: '',
    umur_toko_bulan: '',
    badge: '',
    target_tanggal_live: '',
    prasyarat_pembukaan: [],
    sumber_data: '',
    tanggal_ambil_data: '',
    lampiran: '',
    periode_baseline_bulan: '',
    periode_mulai: '',
    periode_akhir: '',
    alasan_periode_pendek: '',
    catatan_periode_pendek: '',
    prioritas: '',
    prioritas_alasan: '',
    baseline: [],
    pengunjung_per_bulan: '',
    conversion_rate_persen: '',
    trafik_organik_persen: '',
    trafik_iklan_persen: '',
    trafik_affiliate_persen: '',
    trafik_live_persen: '',
    trafik_video_persen: '',
    trafik_luar_persen: '',
    entry_point_utama: '',
    entry_point_catatan: '',
    sku_listed: '',
    sku_aktif: '',
    sku_pareto_80: '',
    top_sku: [],
    sku_slow_moving: '',
    sku_stok_kritis: [],
    listing_layak_persen: '',
    rating_toko: '',
    jumlah_ulasan: '',
    chat_response_rate_persen: '',
    chat_response_menit: '',
    pesanan_terlambat_persen: '',
    poin_penalti: '',
    catatan_penalti: '',
    tema_keluhan: [],
    tipe_kampanye: [],
    tipe_kampanye_tidak_ada: false,
    jumlah_kampanye_aktif: '',
    top_keyword: [],
    kampanye_boncos: [],
    affiliate_aktif_30hari: '',
    gmv_affiliate: '',
    gmv_affiliate_persen: '',
    komisi_open_persen: '',
    komisi_target_persen: '',
    top_kreator: [],
    program_sampel: '',
    program_sampel_catatan: '',
    jumlah_video_per_bulan: '',
    total_views: '',
    gmv_video: '',
    jam_live_per_bulan: '',
    gmv_live: '',
    host_live: '',
    studio_live: '',
    studio_catatan: '',
    voucher_aktif: [],
    voucher_aktif_tidak_ada: false,
    program_platform: [],
    program_platform_tidak_ada: false,
    beban_promo_persen: '',
    kompetitor: [],
    kompetitor_lebih_baik: [],
    kompetitor_catatan: '',
    celah_kompetitor: '',
  };
}

export function channelsDraftOf(d: StrategiDetail): ChannelDraft[] {
  return d.channels.map((c) => ({
    channel: c.channel,
    channel_lain: c.channel_lain ?? '',
    status_channel: c.status_channel ?? 'Eksisting',
    nama_toko: c.nama_toko ?? '',
    url_toko: c.url_toko ?? '',
    umur_toko_bulan: c.umur_toko_bulan !== null ? String(c.umur_toko_bulan) : '',
    badge: c.badge ?? '',
    target_tanggal_live: c.target_tanggal_live ?? '',
    prasyarat_pembukaan: c.prasyarat_pembukaan ?? [],
    sumber_data: c.sumber_data ?? '',
    tanggal_ambil_data: c.tanggal_ambil_data ?? '',
    lampiran: c.lampiran ?? '',
    periode_baseline_bulan:
      c.periode_baseline_bulan !== null ? String(c.periode_baseline_bulan) : '',
    periode_mulai: c.periode_mulai ?? '',
    periode_akhir: c.periode_akhir ?? '',
    alasan_periode_pendek: c.alasan_periode_pendek ?? '',
    catatan_periode_pendek: c.catatan_periode_pendek ?? '',
    prioritas: c.prioritas ?? '',
    prioritas_alasan: c.prioritas_alasan ?? '',
    baseline: c.baseline.map((m) => ({
      month_index: m.month_index,
      gmv: m.gmv ?? '',
      jumlah_pesanan: m.jumlah_pesanan !== null ? String(m.jumlah_pesanan) : '',
      persen_batal: m.persen_batal !== null ? String(m.persen_batal) : '',
      ad_spend: m.ad_spend ?? '',
      roas: m.roas !== null ? String(m.roas) : '',
      acos: m.acos !== null ? String(m.acos) : '',
    })),
    pengunjung_per_bulan:
      c.pengunjung_per_bulan !== null ? String(c.pengunjung_per_bulan) : '',
    conversion_rate_persen:
      c.conversion_rate_persen !== null ? String(c.conversion_rate_persen) : '',
    trafik_organik_persen:
      c.trafik_organik_persen !== null ? String(c.trafik_organik_persen) : '',
    trafik_iklan_persen:
      c.trafik_iklan_persen !== null ? String(c.trafik_iklan_persen) : '',
    trafik_affiliate_persen:
      c.trafik_affiliate_persen !== null ? String(c.trafik_affiliate_persen) : '',
    trafik_live_persen:
      c.trafik_live_persen !== null ? String(c.trafik_live_persen) : '',
    trafik_video_persen:
      c.trafik_video_persen !== null ? String(c.trafik_video_persen) : '',
    trafik_luar_persen:
      c.trafik_luar_persen !== null ? String(c.trafik_luar_persen) : '',
    entry_point_utama: c.entry_point_utama ?? '',
    entry_point_catatan: c.entry_point_catatan ?? '',
    sku_listed: c.sku_listed !== null ? String(c.sku_listed) : '',
    sku_aktif: c.sku_aktif !== null ? String(c.sku_aktif) : '',
    sku_pareto_80: c.sku_pareto_80 !== null ? String(c.sku_pareto_80) : '',
    top_sku: c.top_sku.map((s) => ({
      nama: s.nama,
      gmv: s.gmv,
      unit_terjual: String(s.unit_terjual),
      harga_jual: s.harga_jual,
      margin_persen: String(s.margin_persen),
    })),
    sku_slow_moving: c.sku_slow_moving !== null ? String(c.sku_slow_moving) : '',
    sku_stok_kritis: c.sku_stok_kritis ?? [],
    listing_layak_persen:
      c.listing_layak_persen !== null ? String(c.listing_layak_persen) : '',
    rating_toko: c.rating_toko !== null ? String(c.rating_toko) : '',
    jumlah_ulasan: c.jumlah_ulasan !== null ? String(c.jumlah_ulasan) : '',
    chat_response_rate_persen:
      c.chat_response_rate_persen !== null ? String(c.chat_response_rate_persen) : '',
    chat_response_menit:
      c.chat_response_menit !== null ? String(c.chat_response_menit) : '',
    pesanan_terlambat_persen:
      c.pesanan_terlambat_persen !== null ? String(c.pesanan_terlambat_persen) : '',
    poin_penalti: c.poin_penalti !== null ? String(c.poin_penalti) : '',
    catatan_penalti: c.catatan_penalti ?? '',
    tema_keluhan: c.tema_keluhan ?? [],
    tipe_kampanye: c.tipe_kampanye ?? [],
    tipe_kampanye_tidak_ada: c.tipe_kampanye_tidak_ada ?? false,
    jumlah_kampanye_aktif:
      c.jumlah_kampanye_aktif !== null ? String(c.jumlah_kampanye_aktif) : '',
    top_keyword: c.top_keyword.map((k) => ({
      keyword: k.keyword,
      jumlah_order: String(k.jumlah_order),
    })),
    kampanye_boncos: c.kampanye_boncos.map((k) => ({
      nama: k.nama,
      spend: k.spend,
    })),
    affiliate_aktif_30hari:
      c.affiliate_aktif_30hari !== null ? String(c.affiliate_aktif_30hari) : '',
    gmv_affiliate: c.gmv_affiliate ?? '',
    gmv_affiliate_persen:
      c.gmv_affiliate_persen !== null ? String(c.gmv_affiliate_persen) : '',
    komisi_open_persen:
      c.komisi_open_persen !== null ? String(c.komisi_open_persen) : '',
    komisi_target_persen:
      c.komisi_target_persen !== null ? String(c.komisi_target_persen) : '',
    top_kreator: c.top_kreator.map((k) => ({ nama: k.nama, gmv: k.gmv })),
    program_sampel: c.program_sampel ?? '',
    program_sampel_catatan: c.program_sampel_catatan ?? '',
    jumlah_video_per_bulan:
      c.jumlah_video_per_bulan !== null ? String(c.jumlah_video_per_bulan) : '',
    total_views: c.total_views !== null ? String(c.total_views) : '',
    gmv_video: c.gmv_video ?? '',
    jam_live_per_bulan:
      c.jam_live_per_bulan !== null ? String(c.jam_live_per_bulan) : '',
    gmv_live: c.gmv_live ?? '',
    host_live: c.host_live ?? '',
    studio_live: c.studio_live ?? '',
    studio_catatan: c.studio_catatan ?? '',
    voucher_aktif: c.voucher_aktif.map((v) => ({
      tipe: v.tipe,
      nilai: v.nilai,
      syarat: v.syarat,
    })),
    voucher_aktif_tidak_ada: c.voucher_aktif_tidak_ada ?? false,
    program_platform: c.program_platform ?? [],
    program_platform_tidak_ada: c.program_platform_tidak_ada ?? false,
    beban_promo_persen:
      c.beban_promo_persen !== null ? String(c.beban_promo_persen) : '',
    kompetitor: c.kompetitor.map((k) => ({
      nama: k.nama,
      url: k.url,
      harga_sebanding: k.harga_sebanding,
      estimasi_penjualan_bulan: k.estimasi_penjualan_bulan,
    })),
    kompetitor_lebih_baik: c.kompetitor_lebih_baik ?? [],
    kompetitor_catatan: c.kompetitor_catatan ?? '',
    celah_kompetitor: c.celah_kompetitor ?? '',
  }));
}

// ---------------------------------------------------------------------------
// API payload converters (used by page.tsx saveActive 'B')
// ---------------------------------------------------------------------------

function numOrNull(s: string): number | null {
  const t = s.trim();
  return t === '' ? null : Number(t);
}

/** Converts one ChannelDraft to the body shape saveStrategiChannels expects. */
export function channelDraftToBody(ch: ChannelDraft) {
  return {
    channel: ch.channel as Channel,
    channel_lain: ch.channel === 'Lainnya' ? (ch.channel_lain || null) : null,
    status_channel: ch.status_channel || null,
    nama_toko: ch.nama_toko || null,
    url_toko: ch.url_toko || null,
    umur_toko_bulan: numOrNull(ch.umur_toko_bulan),
    badge: ch.badge || null,
    target_tanggal_live:
      ch.status_channel === 'Belum Aktif' ? (ch.target_tanggal_live || null) : null,
    prasyarat_pembukaan:
      ch.status_channel === 'Belum Aktif' ? ch.prasyarat_pembukaan.filter(Boolean) : [],
    sumber_data: ch.sumber_data || null,
    tanggal_ambil_data: ch.tanggal_ambil_data || null,
    lampiran: ch.lampiran || null,
    periode_baseline_bulan: numOrNull(ch.periode_baseline_bulan),
    periode_mulai: ch.periode_mulai || null,
    periode_akhir: ch.periode_akhir || null,
    alasan_periode_pendek: ch.alasan_periode_pendek || null,
    catatan_periode_pendek: ch.catatan_periode_pendek || null,
    prioritas: ch.prioritas || null,
    prioritas_alasan: ch.prioritas_alasan || null,
    pengunjung_per_bulan: numOrNull(ch.pengunjung_per_bulan),
    conversion_rate_persen: numOrNull(ch.conversion_rate_persen),
    trafik_organik_persen: numOrNull(ch.trafik_organik_persen),
    trafik_iklan_persen: numOrNull(ch.trafik_iklan_persen),
    trafik_affiliate_persen: numOrNull(ch.trafik_affiliate_persen),
    trafik_live_persen: numOrNull(ch.trafik_live_persen),
    trafik_video_persen: numOrNull(ch.trafik_video_persen),
    trafik_luar_persen: numOrNull(ch.trafik_luar_persen),
    entry_point_utama: ch.entry_point_utama || null,
    entry_point_catatan: ch.entry_point_catatan || null,
    sku_listed: numOrNull(ch.sku_listed),
    sku_aktif: numOrNull(ch.sku_aktif),
    sku_pareto_80: numOrNull(ch.sku_pareto_80),
    top_sku: ch.top_sku
      .filter((s) => s.nama.trim())
      .map((s) => ({
        nama: s.nama,
        gmv: s.gmv,
        unit_terjual: Number(s.unit_terjual) || 0,
        harga_jual: s.harga_jual,
        margin_persen: Number(s.margin_persen) || 0,
      })),
    sku_slow_moving: numOrNull(ch.sku_slow_moving),
    sku_stok_kritis: ch.sku_stok_kritis.filter(Boolean),
    listing_layak_persen: numOrNull(ch.listing_layak_persen),
    rating_toko: numOrNull(ch.rating_toko),
    jumlah_ulasan: numOrNull(ch.jumlah_ulasan),
    chat_response_rate_persen: numOrNull(ch.chat_response_rate_persen),
    chat_response_menit: numOrNull(ch.chat_response_menit),
    pesanan_terlambat_persen: numOrNull(ch.pesanan_terlambat_persen),
    poin_penalti: numOrNull(ch.poin_penalti),
    catatan_penalti: ch.catatan_penalti || null,
    tema_keluhan: ch.tema_keluhan.filter(Boolean),
    tipe_kampanye: ch.tipe_kampanye_tidak_ada ? [] : ch.tipe_kampanye,
    tipe_kampanye_tidak_ada: ch.tipe_kampanye_tidak_ada,
    jumlah_kampanye_aktif: numOrNull(ch.jumlah_kampanye_aktif),
    top_keyword: ch.top_keyword
      .filter((k) => k.keyword.trim())
      .map((k) => ({ keyword: k.keyword, jumlah_order: Number(k.jumlah_order) || 0 })),
    kampanye_boncos: ch.kampanye_boncos
      .filter((k) => k.nama.trim())
      .map((k) => ({ nama: k.nama, spend: k.spend })),
    affiliate_aktif_30hari: numOrNull(ch.affiliate_aktif_30hari),
    gmv_affiliate: ch.gmv_affiliate || null,
    gmv_affiliate_persen: numOrNull(ch.gmv_affiliate_persen),
    komisi_open_persen: numOrNull(ch.komisi_open_persen),
    komisi_target_persen: numOrNull(ch.komisi_target_persen),
    top_kreator: ch.top_kreator
      .filter((k) => k.nama.trim())
      .map((k) => ({ nama: k.nama, gmv: k.gmv })),
    program_sampel: ch.program_sampel || null,
    program_sampel_catatan: ch.program_sampel_catatan || null,
    jumlah_video_per_bulan: numOrNull(ch.jumlah_video_per_bulan),
    total_views: numOrNull(ch.total_views),
    gmv_video: ch.gmv_video || null,
    jam_live_per_bulan: numOrNull(ch.jam_live_per_bulan),
    gmv_live: ch.gmv_live || null,
    host_live: ch.host_live || null,
    studio_live: ch.studio_live || null,
    studio_catatan: ch.studio_catatan || null,
    voucher_aktif: ch.voucher_aktif_tidak_ada
      ? []
      : ch.voucher_aktif.filter((v) => v.tipe.trim()).map((v) => ({
          tipe: v.tipe,
          nilai: v.nilai,
          syarat: v.syarat,
        })),
    voucher_aktif_tidak_ada: ch.voucher_aktif_tidak_ada,
    program_platform: ch.program_platform_tidak_ada ? [] : ch.program_platform,
    program_platform_tidak_ada: ch.program_platform_tidak_ada,
    beban_promo_persen: numOrNull(ch.beban_promo_persen),
    kompetitor: ch.kompetitor
      .filter((k) => k.nama.trim())
      .map((k) => ({
        nama: k.nama,
        url: k.url,
        harga_sebanding: k.harga_sebanding,
        estimasi_penjualan_bulan: k.estimasi_penjualan_bulan,
      })),
    kompetitor_lebih_baik: ch.kompetitor_lebih_baik,
    kompetitor_catatan: ch.kompetitor_catatan || null,
    celah_kompetitor: ch.celah_kompetitor || null,
  };
}

/**
 * Converts baseline month drafts to the body saveStrategiBaseline expects.
 * Months with no data are still sent (all-zero) so the server can compute tren.
 */
export function baselineDraftToBody(months: BaselineMonthDraft[]) {
  return months.map((m) => ({
    month_index: m.month_index,
    gmv: m.gmv || '0',
    jumlah_pesanan: m.jumlah_pesanan.trim() ? Number(m.jumlah_pesanan) : 0,
    persen_batal: m.persen_batal.trim() ? Number(m.persen_batal) : 0,
    ad_spend: m.ad_spend || '0',
    roas: m.roas.trim() ? Number(m.roas) : 0,
    acos: m.acos.trim() ? Number(m.acos) : 0,
  }));
}

// ---------------------------------------------------------------------------
// Sub-section helpers
// ---------------------------------------------------------------------------

const CAMPAIGN_LABELS: Record<string, string> = {
  gmv_max: 'GMV Max',
  manual_keyword: 'Manual keyword',
  auto: 'Auto',
  live_ads: 'Live Ads',
  video_ads: 'Video Ads',
  affiliate_ads: 'Affiliate Ads',
  lainnya: 'Lainnya',
};

const PLATFORM_LABELS: Record<string, string> = {
  gratis_ongkir_xtra: 'Gratis Ongkir Xtra',
  cashback: 'Cashback',
  campaign_seasonal: 'Campaign Seasonal',
  flash_sale: 'Flash Sale',
  voucher_platform: 'Voucher Platform',
  lainnya: 'Lainnya',
};

const COMPETITOR_EDGE_LABELS: Record<string, string> = {
  harga: 'Harga',
  konten: 'Konten',
  ulasan: 'Ulasan',
  iklan: 'Iklan',
  live: 'Live',
  bundling: 'Bundling',
};

const ENTRY_LABELS: Record<string, string> = {
  search: 'Search',
  feed: 'Feed / Rekomendasi',
  live: 'Live',
  keranjang: 'Keranjang',
  chat: 'Chat',
};

const SAMPLE_LABELS: Record<string, string> = {
  tidak_ada: 'Tidak ada',
  klien: 'Dibiayai klien',
  mea: 'Dibiayai MEA',
  kreator: 'Dibiayai kreator',
};

const LIVE_HOST_LABELS: Record<string, string> = {
  internal_klien: 'Host internal klien',
  vendor: 'Vendor',
  tim_mea: 'Tim MEA',
  belum_ada: 'Belum ada',
};

const STUDIO_LABELS: Record<string, string> = {
  tersedia: 'Tersedia lengkap',
  sebagian: 'Sebagian',
  tidak_ada: 'Tidak ada',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** RAB-19 "warisi yang bersumber saja" — the fields Riset Awal is authoritative
 *  for are rendered read-only with this chip, so the AM confirms them instead of
 *  re-typing. A correction goes back to Riset Awal (the single source), not into a
 *  second Strategi copy — the same rule as the interview dedup (M6 Interview §7).
 *  The value itself is seeded into the draft by the page (`mergeBaselinePrefill`),
 *  so a normal Section B save still persists it and the DB gate stays satisfied. */
function InheritedChip() {
  return (
    <span className="badge badge-gray" style={{ fontWeight: 400, fontSize: 11 }} title="Nilai dari Riset Awal — perbaiki di Riset Awal, bukan di sini.">
      terisi dari Riset Awal
    </span>
  );
}

export default function SectionB({
  draft,
  onChange,
  disabled,
  baselinePrefill,
}: {
  draft: ChannelDraft[];
  onChange: (channels: ChannelDraft[]) => void;
  disabled: boolean;
  baselinePrefill: StrategiBaselinePrefill | null;
}) {
  const [activeIdx, setActiveIdx] = useState(0);

  // Section B is the ONLY place a channel block is created: `createStrategi`
  // seeds none, and there is no contract-level channel list to inherit from (no
  // `contract_channel` table exists). So the editable `draft` IS the source of
  // truth — `channelsDraftOf(detail)` seeds it from whatever is already saved,
  // and the AM adds/removes blocks here. Before this, the section rendered only
  // `detail.channels` with no way to add the first row, so a fresh Strategi could
  // never fill Section B at all (and C/D, which gate per channel, stayed blocked).
  const channels = draft;

  const addChannel = () => {
    const used = new Set(channels.map((c) => c.channel));
    // Offer the first channel not yet used; `Lainnya` is always allowed (it is
    // disambiguated by `channel_lain`), so it is the fallback when all are taken.
    const pick = CHANNELS.find((c) => c === 'Lainnya' || !used.has(c)) ?? 'Lainnya';
    onChange([...channels, blankChannel(pick)]);
    setActiveIdx(channels.length);
  };

  const removeChannel = (i: number) => {
    onChange(channels.filter((_, x) => x !== i));
    setActiveIdx((cur) => (cur >= i && cur > 0 ? cur - 1 : cur));
  };

  if (channels.length === 0) {
    return (
      <div className="stack">
        <div className="alert alertInfo" style={{ fontSize: 13 }}>
          Belum ada channel. Tambahkan channel yang dikerjakan pada kontrak ini untuk mulai
          mengisi baseline — Section C dan D memerlukan minimal satu channel.
        </div>
        {!disabled && (
          <button type="button" className="btn btnPrimary btnSm" onClick={addChannel}>
            Tambah channel
          </button>
        )}
      </div>
    );
  }

  const clampedIdx = Math.min(activeIdx, channels.length - 1);
  const ch = channels[clampedIdx];

  const setCh = (patch: Partial<ChannelDraft>) => {
    onChange(channels.map((c, i) => (i === clampedIdx ? { ...c, ...patch } : c)));
  };

  // RAB-19 "warisi yang bersumber saja" — the Riset Awal suggestion for THIS
  // channel, if any. When present, the sourced fields (B-0.6 provenance, B-0.7
  // window, B-1 per-month GMV + orders) are inherited read-only; every field
  // Riset Awal has no source for (persen batal, ad spend, ROAS, ACOS, and all of
  // B-2…B-9) stays editable.
  const sugg: StrategiChannelBaselineSuggestion | null =
    baselinePrefill?.channels.find(
      (s) =>
        s.channel === ch.channel &&
        (ch.channel !== 'Lainnya' || (s.channel_lain ?? '') === (ch.channel_lain ?? '')),
    ) ?? null;
  const suggMonth = (i: number) => sugg?.baseline_bulan.find((m) => m.month_index === i) ?? null;
  const provInherited = sugg !== null;
  const periodeInherited = sugg !== null && sugg.periode_baseline_bulan != null;

  const isEksisting = ch.status_channel !== 'Belum Aktif';

  // Derive baseline row count from the declared period length.
  const nMonths = ch.periode_baseline_bulan.trim()
    ? Math.max(1, Math.min(12, Math.round(Number(ch.periode_baseline_bulan))))
    : 0;

  // Ensure the baseline array has exactly nMonths rows (adding empties, trimming extras).
  const ensuredBaseline: BaselineMonthDraft[] = Array.from({ length: nMonths }, (_, i) => {
    return (
      ch.baseline.find((m) => m.month_index === i) ?? {
        month_index: i,
        gmv: '',
        jumlah_pesanan: '',
        persen_batal: '',
        ad_spend: '',
        roas: '',
        acos: '',
      }
    );
  });

  // Trafik share sum — B-2.3 warns when not 100.
  const trafik6 = [
    ch.trafik_organik_persen,
    ch.trafik_iklan_persen,
    ch.trafik_affiliate_persen,
    ch.trafik_live_persen,
    ch.trafik_video_persen,
    ch.trafik_luar_persen,
  ];
  const trafikSum = trafik6.reduce((s, v) => s + (v.trim() ? Number(v) : 0), 0);
  const trafikAllFilled = trafik6.every((v) => v.trim() !== '');

  return (
    <div className="stack">
      {/* Channel tabs */}
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {channels.map((c, i) => (
          <button
            key={i}
            type="button"
            className={i === clampedIdx ? 'btn btnSecondary btnSm' : 'btn btnGhost btnSm'}
            onClick={() => setActiveIdx(i)}
          >
            {c.channel === 'Lainnya' && c.channel_lain ? c.channel_lain : c.channel}
          </button>
        ))}
        {!disabled && (
          <button type="button" className="btn btnGhost btnSm" onClick={addChannel}>
            + Tambah channel
          </button>
        )}
      </div>

      {!disabled && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btnGhost btnSm"
            onClick={() => removeChannel(clampedIdx)}
            title="Hapus channel ini beserta seluruh isian baseline-nya"
          >
            Hapus channel “{ch.channel === 'Lainnya' && ch.channel_lain ? ch.channel_lain : ch.channel}”
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* B-0 Identity & status                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <div className="cardHeader">B-0 · Identitas Channel</div>
        <div className="formRow">
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Channel (B-0.1)</span>
            <select
              value={ch.channel}
              disabled={disabled}
              onChange={(e) => setCh({ channel: e.target.value })}
            >
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          {ch.channel === 'Lainnya' && (
            <label className="field">
              <span className="muted" style={{ fontSize: 12 }}>Nama channel lain</span>
              <input
                value={ch.channel_lain}
                disabled={disabled}
                onChange={(e) => setCh({ channel_lain: e.target.value })}
              />
            </label>
          )}
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Status channel (B-0.2)</span>
            <select
              value={ch.status_channel}
              disabled={disabled}
              onChange={(e) => setCh({ status_channel: e.target.value })}
            >
              {CHANNEL_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="formRow" style={{ marginTop: 6 }}>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Nama toko (B-0.3)</span>
            <input
              value={ch.nama_toko}
              disabled={disabled}
              onChange={(e) => setCh({ nama_toko: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>URL toko</span>
            <input
              value={ch.url_toko}
              disabled={disabled}
              onChange={(e) => setCh({ url_toko: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Umur toko (bulan)</span>
            <input
              type="number"
              min={0}
              value={ch.umur_toko_bulan}
              disabled={disabled}
              onChange={(e) => setCh({ umur_toko_bulan: e.target.value })}
            />
          </label>
        </div>

        <div className="formRow" style={{ marginTop: 6 }}>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Badge / sertifikasi</span>
            <input
              placeholder="Official Store, Star Seller, dll."
              value={ch.badge}
              disabled={disabled}
              onChange={(e) => setCh({ badge: e.target.value })}
            />
          </label>
        </div>

        {/* 'Belum Aktif' — rencana pembukaan */}
        {!isEksisting && (
          <>
            <div className="formRow" style={{ marginTop: 8 }}>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Target tanggal live (B-0.5)</span>
                <input
                  type="date"
                  value={ch.target_tanggal_live}
                  disabled={disabled}
                  onChange={(e) => setCh({ target_tanggal_live: e.target.value })}
                />
              </label>
            </div>
            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Prasyarat pembukaan — hal yang harus selesai sebelum go-live
              </span>
              {ch.prasyarat_pembukaan.map((item, i) => (
                <div key={i} className="row" style={{ gap: 4, marginBottom: 4 }}>
                  <input
                    value={item}
                    disabled={disabled}
                    style={{ flex: 1 }}
                    onChange={(e) => {
                      const next = [...ch.prasyarat_pembukaan];
                      next[i] = e.target.value;
                      setCh({ prasyarat_pembukaan: next });
                    }}
                  />
                  {!disabled && (
                    <button
                      type="button"
                      className="btn btnGhost btnSm"
                      onClick={() =>
                        setCh({ prasyarat_pembukaan: ch.prasyarat_pembukaan.filter((_, x) => x !== i) })
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!disabled && (
                <button
                  type="button"
                  className="btn btnSecondary btnSm"
                  style={{ marginTop: 4 }}
                  onClick={() => setCh({ prasyarat_pembukaan: [...ch.prasyarat_pembukaan, ''] })}
                >
                  Tambah prasyarat
                </button>
              )}
            </div>
          </>
        )}

        {/* Data provenance (B-0.6) — inherited from Riset Awal when available. */}
        <div className="formRow" style={{ marginTop: 8 }}>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>
              Sumber data (B-0.6) {provInherited && <InheritedChip />}
            </span>
            <input
              placeholder="Seller Center export, screenshot, dll."
              value={ch.sumber_data}
              disabled={disabled || provInherited}
              onChange={(e) => setCh({ sumber_data: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>
              Tanggal ambil data {provInherited && <InheritedChip />}
            </span>
            <input
              type="date"
              value={ch.tanggal_ambil_data}
              disabled={disabled || provInherited}
              onChange={(e) => setCh({ tanggal_ambil_data: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>
              Lampiran (link/path) {provInherited && <InheritedChip />}
            </span>
            <input
              value={ch.lampiran}
              disabled={disabled || provInherited}
              onChange={(e) => setCh({ lampiran: e.target.value })}
            />
          </label>
        </div>

        {/* Baseline period (only for Eksisting) */}
        {isEksisting && (
          <div style={{ marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              Periode baseline (B-0.7) — berapa bulan data historis yang dikumpulkan (min 1, max 12)
            </span>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>
                  Jumlah bulan {periodeInherited && <InheritedChip />}
                </span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={ch.periode_baseline_bulan}
                  disabled={disabled || periodeInherited}
                  onChange={(e) => setCh({ periode_baseline_bulan: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Bulan mulai (YYYY-MM)</span>
                <input
                  type="month"
                  value={ch.periode_mulai}
                  disabled={disabled}
                  onChange={(e) => setCh({ periode_mulai: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Bulan akhir (YYYY-MM)</span>
                <input
                  type="month"
                  value={ch.periode_akhir}
                  disabled={disabled}
                  onChange={(e) => setCh({ periode_akhir: e.target.value })}
                />
              </label>
            </div>
            {Number(ch.periode_baseline_bulan) < 3 && ch.periode_baseline_bulan.trim() && (
              <div style={{ marginTop: 6 }}>
                <label className="field" style={{ display: 'block' }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Alasan periode pendek (wajib jika &lt; 3 bulan)
                  </span>
                  <input
                    value={ch.alasan_periode_pendek}
                    disabled={disabled}
                    onChange={(e) => setCh({ alasan_periode_pendek: e.target.value })}
                  />
                </label>
                <label className="field" style={{ display: 'block', marginTop: 4 }}>
                  <span className="muted" style={{ fontSize: 12 }}>Catatan tambahan</span>
                  <input
                    value={ch.catatan_periode_pendek}
                    disabled={disabled}
                    onChange={(e) => setCh({ catatan_periode_pendek: e.target.value })}
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* E-2 priority (saved with channels)                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <div className="cardHeader">E-2 · Prioritas Channel</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Engine utama, pendukung, atau maintenance. Diset per channel; Section E menampilkan
          hasilnya secara read-only untuk konteks.
        </p>
        <div className="formRow">
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Prioritas</span>
            <select
              value={ch.prioritas}
              disabled={disabled}
              onChange={(e) => setCh({ prioritas: e.target.value })}
            >
              <option value="">— pilih —</option>
              {PRIORITAS_LABELS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Alasan</span>
            <input
              placeholder="Kenapa channel ini diberi peran ini"
              value={ch.prioritas_alasan}
              disabled={disabled}
              onChange={(e) => setCh({ prioritas_alasan: e.target.value })}
            />
          </label>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* B-1 Baseline months — only for Eksisting                           */}
      {/* ------------------------------------------------------------------ */}
      {isEksisting && nMonths > 0 && (
        <div className="card">
          <div className="cardHeader">B-1 · Data Penjualan Bulanan (Baseline)</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Isi {nMonths} bulan dari yang paling lama ke paling baru (bulan 1 = tertua).
            AOV dihitung otomatis oleh server.
            {sugg && sugg.baseline_bulan.length > 0 && (
              <>
                {' '}
                <strong>GMV &amp; Pesanan</strong> terisi dari Riset Awal — % batal, ad spend, ROAS,
                dan ACOS tetap diisi manual (Riset Awal hanya kasih angka agregat, bukan per bulan).
              </>
            )}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 13, minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Bulan</th>
                  <th style={{ textAlign: 'left' }}>GMV</th>
                  <th style={{ textAlign: 'left' }}>Pesanan</th>
                  <th style={{ textAlign: 'left' }}>% Batal</th>
                  <th style={{ textAlign: 'left' }}>Ad Spend</th>
                  <th style={{ textAlign: 'left' }}>ROAS</th>
                  <th style={{ textAlign: 'left' }}>ACOS %</th>
                </tr>
              </thead>
              <tbody>
                {ensuredBaseline.map((m, i) => (
                  <tr key={m.month_index}>
                    <td style={{ paddingRight: 8 }}>Bulan {m.month_index + 1}</td>
                    {(
                      [
                        ['gmv', 'text'] as const,
                        ['jumlah_pesanan', 'number'] as const,
                        ['persen_batal', 'number'] as const,
                        ['ad_spend', 'text'] as const,
                        ['roas', 'number'] as const,
                        ['acos', 'number'] as const,
                      ] as [keyof BaselineMonthDraft, string][]
                    ).map(([field, type]) => {
                      // GMV + Pesanan are inherited from Riset Awal when it has a
                      // figure for this month; the rest stay editable.
                      const sm = suggMonth(m.month_index);
                      const inheritedCell =
                        (field === 'gmv' && sm?.gmv != null) ||
                        (field === 'jumlah_pesanan' && sm?.jumlah_pesanan != null);
                      return (
                        <td key={field} style={{ paddingRight: 8 }}>
                          <input
                            type={type}
                            min={type === 'number' ? 0 : undefined}
                            value={m[field] as string}
                            disabled={disabled || inheritedCell}
                            title={inheritedCell ? 'Terisi dari Riset Awal' : undefined}
                            style={{ width: 100 }}
                            onChange={(e) => {
                              const nextBaseline = ensuredBaseline.map((row, ri) =>
                                ri === i ? { ...row, [field]: e.target.value } : row,
                              );
                              setCh({ baseline: nextBaseline });
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* The rest of B-2…B-9 only renders for 'Eksisting' channels */}
      {isEksisting && (
        <>
          {/* ---------------------------------------------------------------- */}
          {/* B-2 Trafik & Konversi                                            */}
          {/* ---------------------------------------------------------------- */}
          <div className="card">
            <div className="cardHeader">B-2 · Trafik &amp; Konversi</div>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Pengunjung per bulan (B-2.1)</span>
                <input
                  type="number"
                  min={0}
                  value={ch.pengunjung_per_bulan}
                  disabled={disabled}
                  onChange={(e) => setCh({ pengunjung_per_bulan: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Conversion rate % (B-2.2)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={ch.conversion_rate_persen}
                  disabled={disabled}
                  onChange={(e) => setCh({ conversion_rate_persen: e.target.value })}
                />
              </label>
            </div>

            {/* Traffic mix — 6 shares sum to 100 */}
            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Komposisi trafik (B-2.3) — semua 6 harus diisi dan jumlahnya harus 100%
              </span>
              <div className="formRow">
                {(
                  [
                    ['trafik_organik_persen', 'Organik'],
                    ['trafik_iklan_persen', 'Iklan'],
                    ['trafik_affiliate_persen', 'Affiliate'],
                    ['trafik_live_persen', 'Live'],
                    ['trafik_video_persen', 'Video'],
                    ['trafik_luar_persen', 'Luar platform'],
                  ] as [keyof ChannelDraft, string][]
                ).map(([field, label]) => (
                  <label key={field} className="field">
                    <span className="muted" style={{ fontSize: 12 }}>{label} %</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={ch[field] as string}
                      disabled={disabled}
                      onChange={(e) => setCh({ [field]: e.target.value } as Partial<ChannelDraft>)}
                    />
                  </label>
                ))}
              </div>
              {trafikAllFilled && Math.abs(trafikSum - 100) > 0.5 && (
                <div className="alert alertError" style={{ fontSize: 12, marginTop: 6 }}>
                  Total trafik = {trafikSum.toFixed(1)}% — harus 100%.
                </div>
              )}
            </div>

            <div className="formRow" style={{ marginTop: 6 }}>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Entry point utama (B-2.4)</span>
                <select
                  value={ch.entry_point_utama}
                  disabled={disabled}
                  onChange={(e) => setCh({ entry_point_utama: e.target.value })}
                >
                  <option value="">— pilih —</option>
                  {ENTRY_POINTS.map((ep) => (
                    <option key={ep} value={ep}>{ENTRY_LABELS[ep] ?? ep}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Catatan entry point</span>
                <input
                  value={ch.entry_point_catatan}
                  disabled={disabled}
                  onChange={(e) => setCh({ entry_point_catatan: e.target.value })}
                />
              </label>
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* B-3 SKU Portfolio                                                */}
          {/* ---------------------------------------------------------------- */}
          <div className="card">
            <div className="cardHeader">B-3 · Portofolio SKU</div>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>SKU terdaftar (B-3.1)</span>
                <input
                  type="number"
                  min={0}
                  value={ch.sku_listed}
                  disabled={disabled}
                  onChange={(e) => setCh({ sku_listed: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>SKU aktif</span>
                <input
                  type="number"
                  min={0}
                  value={ch.sku_aktif}
                  disabled={disabled}
                  onChange={(e) => setCh({ sku_aktif: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>SKU penyumbang 80% GMV (B-3.2)</span>
                <input
                  type="number"
                  min={0}
                  value={ch.sku_pareto_80}
                  disabled={disabled}
                  onChange={(e) => setCh({ sku_pareto_80: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>SKU slow moving</span>
                <input
                  type="number"
                  min={0}
                  value={ch.sku_slow_moving}
                  disabled={disabled}
                  onChange={(e) => setCh({ sku_slow_moving: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Listing layak % (B-3.6)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={ch.listing_layak_persen}
                  disabled={disabled}
                  onChange={(e) => setCh({ listing_layak_persen: e.target.value })}
                />
              </label>
            </div>

            <RepeatList<TopSkuDraft>
              label={`B-3.3 · Top SKU berdasarkan GMV (maks ${TOP_SKU_MAX})`}
              hint="Maksimal 5 SKU terlaris."
              rows={ch.top_sku}
              max={TOP_SKU_MAX}
              onChange={(rows) => setCh({ top_sku: rows })}
              blank={() => ({ nama: '', gmv: '', unit_terjual: '', harga_jual: '', margin_persen: '' })}
              disabled={disabled}
              addLabel="Tambah SKU"
              empty="Belum ada top SKU."
            >
              {(row, set) => (
                <div className="formRow">
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Nama SKU</span>
                    <input
                      value={row.nama}
                      disabled={disabled}
                      onChange={(e) => set({ nama: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>GMV</span>
                    <input
                      value={row.gmv}
                      disabled={disabled}
                      placeholder="Rp."
                      onChange={(e) => set({ gmv: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Unit terjual</span>
                    <input
                      type="number"
                      min={0}
                      value={row.unit_terjual}
                      disabled={disabled}
                      onChange={(e) => set({ unit_terjual: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Harga jual</span>
                    <input
                      value={row.harga_jual}
                      disabled={disabled}
                      placeholder="Rp."
                      onChange={(e) => set({ harga_jual: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Margin %</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={row.margin_persen}
                      disabled={disabled}
                      onChange={(e) => set({ margin_persen: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </RepeatList>

            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                B-3.5 · SKU stok kritis — nama SKU yang mendekati habis
              </span>
              {ch.sku_stok_kritis.map((item, i) => (
                <div key={i} className="row" style={{ gap: 4, marginBottom: 4 }}>
                  <input
                    value={item}
                    disabled={disabled}
                    style={{ flex: 1 }}
                    onChange={(e) => {
                      const next = [...ch.sku_stok_kritis];
                      next[i] = e.target.value;
                      setCh({ sku_stok_kritis: next });
                    }}
                  />
                  {!disabled && (
                    <button
                      type="button"
                      className="btn btnGhost btnSm"
                      onClick={() =>
                        setCh({ sku_stok_kritis: ch.sku_stok_kritis.filter((_, x) => x !== i) })
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!disabled && (
                <button
                  type="button"
                  className="btn btnSecondary btnSm"
                  style={{ marginTop: 4 }}
                  onClick={() => setCh({ sku_stok_kritis: [...ch.sku_stok_kritis, ''] })}
                >
                  Tambah SKU kritis
                </button>
              )}
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* B-4 Store Health                                                 */}
          {/* ---------------------------------------------------------------- */}
          <div className="card">
            <div className="cardHeader">B-4 · Kesehatan Toko</div>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Rating toko (B-4.1)</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step="0.1"
                  value={ch.rating_toko}
                  disabled={disabled}
                  onChange={(e) => setCh({ rating_toko: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Jumlah ulasan</span>
                <input
                  type="number"
                  min={0}
                  value={ch.jumlah_ulasan}
                  disabled={disabled}
                  onChange={(e) => setCh({ jumlah_ulasan: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Chat response rate % (B-4.2)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={ch.chat_response_rate_persen}
                  disabled={disabled}
                  onChange={(e) => setCh({ chat_response_rate_persen: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Response time (menit)</span>
                <input
                  type="number"
                  min={0}
                  value={ch.chat_response_menit}
                  disabled={disabled}
                  onChange={(e) => setCh({ chat_response_menit: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Pesanan terlambat % (B-4.3)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={ch.pesanan_terlambat_persen}
                  disabled={disabled}
                  onChange={(e) => setCh({ pesanan_terlambat_persen: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Poin penalti (B-4.4)</span>
                <input
                  type="number"
                  min={0}
                  value={ch.poin_penalti}
                  disabled={disabled}
                  onChange={(e) => setCh({ poin_penalti: e.target.value })}
                />
              </label>
            </div>
            <label className="field" style={{ display: 'block', marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Catatan penalti</span>
              <input
                value={ch.catatan_penalti}
                disabled={disabled}
                onChange={(e) => setCh({ catatan_penalti: e.target.value })}
              />
            </label>

            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Tema keluhan terbanyak dari ulasan (B-4.5)
              </span>
              {ch.tema_keluhan.map((item, i) => (
                <div key={i} className="row" style={{ gap: 4, marginBottom: 4 }}>
                  <input
                    value={item}
                    disabled={disabled}
                    style={{ flex: 1 }}
                    onChange={(e) => {
                      const next = [...ch.tema_keluhan];
                      next[i] = e.target.value;
                      setCh({ tema_keluhan: next });
                    }}
                  />
                  {!disabled && (
                    <button
                      type="button"
                      className="btn btnGhost btnSm"
                      onClick={() =>
                        setCh({ tema_keluhan: ch.tema_keluhan.filter((_, x) => x !== i) })
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {!disabled && (
                <button
                  type="button"
                  className="btn btnSecondary btnSm"
                  style={{ marginTop: 4 }}
                  onClick={() => setCh({ tema_keluhan: [...ch.tema_keluhan, ''] })}
                >
                  Tambah tema keluhan
                </button>
              )}
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* B-5 Iklan                                                        */}
          {/* ---------------------------------------------------------------- */}
          <div className="card">
            <div className="cardHeader">B-5 · Iklan (Ads)</div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={ch.tipe_kampanye_tidak_ada}
                  disabled={disabled}
                  onChange={(e) =>
                    setCh({ tipe_kampanye_tidak_ada: e.target.checked, tipe_kampanye: [] })
                  }
                />
                <span style={{ fontSize: 13 }}>Tidak ada kampanye iklan aktif (B-5.3 tidak ada)</span>
              </label>
            </div>

            {!ch.tipe_kampanye_tidak_ada && (
              <>
                <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  Tipe kampanye aktif (B-5.3) — pilih semua yang berlaku
                </span>
                <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
                  {CAMPAIGN_TYPES.map((t) => (
                    <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={ch.tipe_kampanye.includes(t)}
                        disabled={disabled}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...ch.tipe_kampanye, t]
                            : ch.tipe_kampanye.filter((x) => x !== t);
                          setCh({ tipe_kampanye: next });
                        }}
                      />
                      <span>{CAMPAIGN_LABELS[t] ?? t}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            <label className="field" style={{ display: 'block' }}>
              <span className="muted" style={{ fontSize: 12 }}>Jumlah kampanye aktif (B-5.3)</span>
              <input
                type="number"
                min={0}
                value={ch.jumlah_kampanye_aktif}
                disabled={disabled}
                onChange={(e) => setCh({ jumlah_kampanye_aktif: e.target.value })}
              />
            </label>

            <RepeatList<TopKeywordDraft>
              label="B-5.4 · Top keyword/audience yang menghasilkan order"
              hint="Keyword atau audience segment yang sudah terbukti menghasilkan pesanan."
              rows={ch.top_keyword}
              onChange={(rows) => setCh({ top_keyword: rows })}
              blank={() => ({ keyword: '', jumlah_order: '' })}
              disabled={disabled}
              addLabel="Tambah keyword"
              empty="Belum ada keyword."
            >
              {(row, set) => (
                <div className="formRow">
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Keyword / audience</span>
                    <input
                      value={row.keyword}
                      disabled={disabled}
                      onChange={(e) => set({ keyword: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Jumlah order</span>
                    <input
                      type="number"
                      min={0}
                      value={row.jumlah_order}
                      disabled={disabled}
                      onChange={(e) => set({ jumlah_order: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </RepeatList>

            <RepeatList<KampanyeBoncosDraft>
              label="B-5.5 · Kampanye yang boros (spend tanpa order)"
              hint="Kampanye yang sudah dicoba tapi tidak menghasilkan pesanan."
              rows={ch.kampanye_boncos}
              onChange={(rows) => setCh({ kampanye_boncos: rows })}
              blank={() => ({ nama: '', spend: '' })}
              disabled={disabled}
              addLabel="Tambah kampanye boncos"
              empty="Belum ada."
            >
              {(row, set) => (
                <div className="formRow">
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Nama kampanye</span>
                    <input
                      value={row.nama}
                      disabled={disabled}
                      onChange={(e) => set({ nama: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Spend</span>
                    <input
                      value={row.spend}
                      disabled={disabled}
                      placeholder="Rp."
                      onChange={(e) => set({ spend: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </RepeatList>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* B-6 Affiliate                                                    */}
          {/* ---------------------------------------------------------------- */}
          <div className="card">
            <div className="cardHeader">B-6 · Affiliate</div>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Affiliate aktif 30 hari (B-6.1)</span>
                <input
                  type="number"
                  min={0}
                  value={ch.affiliate_aktif_30hari}
                  disabled={disabled}
                  onChange={(e) => setCh({ affiliate_aktif_30hari: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>GMV dari affiliate</span>
                <input
                  value={ch.gmv_affiliate}
                  disabled={disabled}
                  placeholder="Rp."
                  onChange={(e) => setCh({ gmv_affiliate: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>% GMV dari affiliate (B-6.2)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={ch.gmv_affiliate_persen}
                  disabled={disabled}
                  onChange={(e) => setCh({ gmv_affiliate_persen: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Komisi open % (B-6.3)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={ch.komisi_open_persen}
                  disabled={disabled}
                  onChange={(e) => setCh({ komisi_open_persen: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Komisi target %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={ch.komisi_target_persen}
                  disabled={disabled}
                  onChange={(e) => setCh({ komisi_target_persen: e.target.value })}
                />
              </label>
            </div>

            <RepeatList<TopKreatorDraft>
              label="B-6.4 · Top kreator berdasarkan GMV"
              hint="Kreator affiliate terlaris di channel ini."
              rows={ch.top_kreator}
              onChange={(rows) => setCh({ top_kreator: rows })}
              blank={() => ({ nama: '', gmv: '' })}
              disabled={disabled}
              addLabel="Tambah kreator"
              empty="Belum ada."
            >
              {(row, set) => (
                <div className="formRow">
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Nama kreator</span>
                    <input
                      value={row.nama}
                      disabled={disabled}
                      onChange={(e) => set({ nama: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>GMV</span>
                    <input
                      value={row.gmv}
                      disabled={disabled}
                      placeholder="Rp."
                      onChange={(e) => set({ gmv: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </RepeatList>

            <div className="formRow" style={{ marginTop: 8 }}>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>
                  Program sampel / seeding (B-6.5)
                </span>
                <select
                  value={ch.program_sampel}
                  disabled={disabled}
                  onChange={(e) => setCh({ program_sampel: e.target.value })}
                >
                  <option value="">— pilih —</option>
                  {SAMPLE_PROGRAMS.map((s) => (
                    <option key={s} value={s}>{SAMPLE_LABELS[s] ?? s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Catatan program sampel</span>
                <input
                  value={ch.program_sampel_catatan}
                  disabled={disabled}
                  onChange={(e) => setCh({ program_sampel_catatan: e.target.value })}
                />
              </label>
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* B-7 Konten & Live                                                */}
          {/* ---------------------------------------------------------------- */}
          <div className="card">
            <div className="cardHeader">B-7 · Konten &amp; Live</div>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Video per bulan (B-7.1)</span>
                <input
                  type="number"
                  min={0}
                  value={ch.jumlah_video_per_bulan}
                  disabled={disabled}
                  onChange={(e) => setCh({ jumlah_video_per_bulan: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Total views</span>
                <input
                  type="number"
                  min={0}
                  value={ch.total_views}
                  disabled={disabled}
                  onChange={(e) => setCh({ total_views: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>GMV dari video</span>
                <input
                  value={ch.gmv_video}
                  disabled={disabled}
                  placeholder="Rp."
                  onChange={(e) => setCh({ gmv_video: e.target.value })}
                />
              </label>
            </div>
            <div className="formRow" style={{ marginTop: 6 }}>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Jam live per bulan (B-7.2)</span>
                <input
                  type="number"
                  min={0}
                  value={ch.jam_live_per_bulan}
                  disabled={disabled}
                  onChange={(e) => setCh({ jam_live_per_bulan: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>GMV dari live</span>
                <input
                  value={ch.gmv_live}
                  disabled={disabled}
                  placeholder="Rp."
                  onChange={(e) => setCh({ gmv_live: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Host live (B-7.3)</span>
                <select
                  value={ch.host_live}
                  disabled={disabled}
                  onChange={(e) => setCh({ host_live: e.target.value })}
                >
                  <option value="">— pilih —</option>
                  {LIVE_HOSTS.map((h) => (
                    <option key={h} value={h}>{LIVE_HOST_LABELS[h] ?? h}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="formRow" style={{ marginTop: 6 }}>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Studio (B-7.4)</span>
                <select
                  value={ch.studio_live}
                  disabled={disabled}
                  onChange={(e) => setCh({ studio_live: e.target.value })}
                >
                  <option value="">— pilih —</option>
                  {STUDIO_STATES.map((s) => (
                    <option key={s} value={s}>{STUDIO_LABELS[s] ?? s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Catatan studio</span>
                <input
                  value={ch.studio_catatan}
                  disabled={disabled}
                  onChange={(e) => setCh({ studio_catatan: e.target.value })}
                />
              </label>
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* B-8 Promo                                                        */}
          {/* ---------------------------------------------------------------- */}
          <div className="card">
            <div className="cardHeader">B-8 · Promosi</div>

            {/* Vouchers */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={ch.voucher_aktif_tidak_ada}
                  disabled={disabled}
                  onChange={(e) =>
                    setCh({ voucher_aktif_tidak_ada: e.target.checked, voucher_aktif: [] })
                  }
                />
                <span style={{ fontSize: 13 }}>Tidak ada voucher aktif (B-8.1 tidak ada)</span>
              </label>
            </div>

            {!ch.voucher_aktif_tidak_ada && (
              <RepeatList<VoucherDraft>
                label="B-8.1 · Voucher aktif"
                hint="Voucher atau promo yang sedang berjalan di channel ini."
                rows={ch.voucher_aktif}
                onChange={(rows) => setCh({ voucher_aktif: rows })}
                blank={() => ({ tipe: '', nilai: '', syarat: '' })}
                disabled={disabled}
                addLabel="Tambah voucher"
                empty="Belum ada voucher."
              >
                {(row, set) => (
                  <div className="formRow">
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>Tipe</span>
                      <input
                        value={row.tipe}
                        disabled={disabled}
                        placeholder="Diskon, Cashback, dll."
                        onChange={(e) => set({ tipe: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>Nilai</span>
                      <input
                        value={row.nilai}
                        disabled={disabled}
                        placeholder="Rp. atau %"
                        onChange={(e) => set({ nilai: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span className="muted" style={{ fontSize: 12 }}>Syarat</span>
                      <input
                        value={row.syarat}
                        disabled={disabled}
                        placeholder="Min. pembelian, dll."
                        onChange={(e) => set({ syarat: e.target.value })}
                      />
                    </label>
                  </div>
                )}
              </RepeatList>
            )}

            {/* Platform programs */}
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={ch.program_platform_tidak_ada}
                  disabled={disabled}
                  onChange={(e) =>
                    setCh({ program_platform_tidak_ada: e.target.checked, program_platform: [] })
                  }
                />
                <span style={{ fontSize: 13 }}>Tidak ikut program platform (B-8.2 tidak ada)</span>
              </label>
            </div>

            {!ch.program_platform_tidak_ada && (
              <div style={{ marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  B-8.2 · Program platform yang diikuti
                </span>
                <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                  {PLATFORM_PROGRAMS.map((p) => (
                    <label key={p} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={ch.program_platform.includes(p)}
                        disabled={disabled}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...ch.program_platform, p]
                            : ch.program_platform.filter((x) => x !== p);
                          setCh({ program_platform: next });
                        }}
                      />
                      <span>{PLATFORM_LABELS[p] ?? p}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className="field" style={{ display: 'block', marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12 }}>Beban promo % dari GMV (B-8.3)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={ch.beban_promo_persen}
                disabled={disabled}
                onChange={(e) => setCh({ beban_promo_persen: e.target.value })}
              />
            </label>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* B-9 Kompetitor                                                   */}
          {/* ---------------------------------------------------------------- */}
          <div className="card">
            <div className="cardHeader">B-9 · Kompetitor</div>

            <RepeatList<KompetitorDraft>
              label={`B-9.1 · Toko kompetitor (maks ${KOMPETITOR_MAX})`}
              hint="Toko yang bersaing langsung di channel ini. Minimal satu."
              rows={ch.kompetitor}
              min={1}
              max={KOMPETITOR_MAX}
              onChange={(rows) => setCh({ kompetitor: rows })}
              blank={() => ({ nama: '', url: '', harga_sebanding: '', estimasi_penjualan_bulan: '' })}
              disabled={disabled}
              addLabel="Tambah kompetitor"
              empty="Belum ada kompetitor."
            >
              {(row, set) => (
                <div className="formRow">
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Nama toko</span>
                    <input
                      value={row.nama}
                      disabled={disabled}
                      onChange={(e) => set({ nama: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>URL toko</span>
                    <input
                      value={row.url}
                      disabled={disabled}
                      onChange={(e) => set({ url: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Harga sebanding</span>
                    <input
                      value={row.harga_sebanding}
                      disabled={disabled}
                      placeholder="Rp."
                      onChange={(e) => set({ harga_sebanding: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="muted" style={{ fontSize: 12 }}>Est. penjualan/bulan</span>
                    <input
                      value={row.estimasi_penjualan_bulan}
                      disabled={disabled}
                      placeholder="Rp."
                      onChange={(e) => set({ estimasi_penjualan_bulan: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </RepeatList>

            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                B-9.2 · Kompetitor lebih baik dalam hal — pilih semua yang berlaku
              </span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                {COMPETITOR_EDGES.map((e) => (
                  <label key={e} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={ch.kompetitor_lebih_baik.includes(e)}
                      disabled={disabled}
                      onChange={(ev) => {
                        const next = ev.target.checked
                          ? [...ch.kompetitor_lebih_baik, e]
                          : ch.kompetitor_lebih_baik.filter((x) => x !== e);
                        setCh({ kompetitor_lebih_baik: next });
                      }}
                    />
                    <span>{COMPETITOR_EDGE_LABELS[e] ?? e}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="field" style={{ display: 'block', marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Catatan kompetitor</span>
              <input
                value={ch.kompetitor_catatan}
                disabled={disabled}
                onChange={(e) => setCh({ kompetitor_catatan: e.target.value })}
              />
            </label>
            <label className="field" style={{ display: 'block', marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Celah vs kompetitor yang paling bisa dieksploitasi (B-9.3)
              </span>
              <textarea
                rows={2}
                value={ch.celah_kompetitor}
                disabled={disabled}
                onChange={(e) => setCh({ celah_kompetitor: e.target.value })}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
