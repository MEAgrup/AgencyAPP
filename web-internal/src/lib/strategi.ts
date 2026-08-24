// Module 6A — Strategi (STRG-) and Vendor (VND-) client types + fetchers.
//
// The Section A→J form itself is backlog A-05…A-09; this file is the contract
// the form will be built against, and it exists NOW for a specific reason: in
// CDPS the FE interface is the source of truth the response-shape guard
// (`apps/api/src/lib/shape-parity.test.ts`) checks the wire layer against. A
// converter with no declared FE type is a converter nothing verifies — and the
// last four production blank-page defects were all exactly that.
//
// Everything here is snake_case, matching the wire body. The camelCase↔snake_case
// boundary lives in `apps/api/src/lib/wire.ts` and nowhere else.

import { api } from './api';

// ---------------------------------------------------------------------------
// Vendor (M6A §7 / D19) — the E-8 / F-4 prerequisite.
// ---------------------------------------------------------------------------

export type VendorService = 'live_stream' | 'produksi_video' | 'talent' | 'lainnya';
export type VendorFeeScheme = 'per_jam' | 'per_sesi' | 'bagi_hasil' | 'retainer';
export type VendorStatus = 'Aktif' | 'Nonaktif' | 'Blacklist';

export interface VendorDocument {
  nama: string;
  url: string;
}

export interface Vendor {
  id: string;
  nama_vendor: string;
  jenis_layanan: VendorService;
  status: VendorStatus;
  pic_nama: string;
  pic_kontak: string;
  skema_biaya: VendorFeeScheme;
  // Rupiah for per_jam / per_sesi / retainer; null for bagi_hasil (which uses
  // the percentage instead — the two never coexist).
  tarif: string | null;
  bagi_hasil_persen: number | null;
  catatan_kinerja: string;
  dokumen: VendorDocument[];
  created_by: string;
  created_at: string;
}

export interface VendorBody {
  nama_vendor: string;
  jenis_layanan: VendorService;
  pic_nama: string;
  pic_kontak: string;
  skema_biaya: VendorFeeScheme;
  tarif?: string | null;
  bagi_hasil_persen?: number | null;
  catatan_kinerja?: string;
  dokumen?: VendorDocument[];
}

/** The E-8 / F-4 picker: active vendors only unless the admin list asks for all. */
export function listVendors(opts: { jenis?: VendorService; includeInactive?: boolean } = {}): Promise<Vendor[]> {
  const q = new URLSearchParams();
  if (opts.jenis) q.set('jenis_layanan', opts.jenis);
  if (opts.includeInactive) q.set('include_inactive', 'true');
  const qs = q.toString();
  return api.get<Vendor[]>(`/vendors${qs ? `?${qs}` : ''}`);
}

export function getVendor(id: string): Promise<Vendor> {
  return api.get<Vendor>(`/vendors/${id}`);
}

export function createVendor(body: VendorBody): Promise<Vendor> {
  return api.post<Vendor>('/vendors', body);
}

export function updateVendor(id: string, body: VendorBody): Promise<Vendor> {
  return api.put<Vendor>(`/vendors/${id}`, body);
}

/** Status moves through the engine; Blacklist → Aktif is deliberately two steps. */
export function setVendorStatus(id: string, status: VendorStatus): Promise<Vendor> {
  return api.post<Vendor>(`/vendors/${id}/status`, { status });
}

// ---------------------------------------------------------------------------
// Strategi (M6A)
// ---------------------------------------------------------------------------

export type StrategiStatus =
  | 'Draft'
  | 'Diajukan'
  | 'Aktif'
  | 'Draft Revisi'
  | 'Kedaluwarsa'
  | 'Diarsipkan';

export type Channel = 'Shopee' | 'TikTok Shop' | 'Tokopedia' | 'Lazada' | 'Website' | 'Lainnya';
export type ChannelState = 'Eksisting' | 'Belum Aktif';
export type AssumptionState = 'Berlaku' | 'Gugur' | 'Terverifikasi';
export type RiskLevel = 'rendah' | 'sedang' | 'tinggi';

/**
 * D-4 metric vocabulary — and therefore also the D-6 leading-indicator set
 * (A-08). §4 never wrote D-6's list, so it reuses the one the PRD did write
 * (open question X-13). Server-side these are one array (`TARGET_METRICS`) and a
 * DB CHECK; if the set is ever widened, this literal moves in the same commit.
 */
export type LeadingIndicator =
  | 'gmv'
  | 'pengunjung'
  | 'cr'
  | 'aov'
  | 'roas_min'
  | 'acos_maks'
  | 'sku_winner'
  | 'affiliate_aktif'
  | 'jam_live'
  | 'jumlah_video';

/** D-6 — "maks 5" (§4). Enforced by the API and by `ck_strategi_leading_indicator`. */
export const LEADING_INDICATOR_MAX = 5;

/**
 * The metric vocabulary as the form offers it (A-13).
 *
 * ONE list, three uses — D-4 targets, D-6 leading indicators, I-3 report
 * metrics — because server-side it is one array and one DB CHECK. A second
 * literal here would be the O48/O51 defect class wearing a UI costume: the
 * picker would drift from what the server accepts, and the AM would get
 * `[metrik laporan klien tidak dikenal]` for an option the form offered them.
 *
 * ⚠️ I-3 is expected to widen later (X-14, owner 2026-08-08: the monthly client
 * report comes from an HTML generator and most of its metrics are not in CDPS
 * yet). When it does, I-3 gets its OWN list here — D-4/D-6 do not follow.
 */
export const METRIC_LABELS: { value: LeadingIndicator; label: string }[] = [
  { value: 'gmv', label: 'GMV' },
  { value: 'pengunjung', label: 'Pengunjung' },
  { value: 'cr', label: 'Conversion rate' },
  { value: 'aov', label: 'AOV' },
  { value: 'roas_min', label: 'ROAS minimum' },
  { value: 'acos_maks', label: 'ACOS maksimum' },
  { value: 'sku_winner', label: 'SKU winner baru' },
  { value: 'affiliate_aktif', label: 'Affiliate aktif' },
  { value: 'jam_live', label: 'Jam live' },
  { value: 'jumlah_video', label: 'Jumlah video' },
];

/**
 * The unit each D-4 supporting metric is counted in, plus a one-line hint of what
 * the number means. FE-only presentation (owner QA 2026-08-20 §3.C: "tampilkan
 * metrik angka jelas") — the stored value is still a plain `numeric` in
 * `strategi_target.nilai_stretch`; nothing here changes the schema or the domain.
 * `satuan` renders as the input suffix, `contoh` as its placeholder, so the AM
 * knows a CR target is a percent and a ROAS target is a multiplier without
 * guessing. Keyed by the same `TARGET_METRICS` vocabulary as the labels above.
 */
export const METRIC_UNITS: Record<LeadingIndicator, { satuan: string; contoh: string }> = {
  gmv: { satuan: 'Rp', contoh: 'mis. 250.000.000' },
  pengunjung: { satuan: 'orang/bln', contoh: 'mis. 120.000' },
  cr: { satuan: '%', contoh: 'mis. 3,2' },
  aov: { satuan: 'Rp', contoh: 'mis. 95.000' },
  roas_min: { satuan: '× (kali)', contoh: 'mis. 5' },
  acos_maks: { satuan: '%', contoh: 'mis. 18' },
  sku_winner: { satuan: 'SKU', contoh: 'mis. 3' },
  affiliate_aktif: { satuan: 'akun', contoh: 'mis. 60' },
  jam_live: { satuan: 'jam/bln', contoh: 'mis. 36' },
  jumlah_video: { satuan: 'video/bln', contoh: 'mis. 40' },
};

/** E-2 — the three channel roles §4 writes itself. */
export const PRIORITAS_LABELS: { value: string; label: string }[] = [
  { value: 'engine_utama', label: 'Engine utama' },
  { value: 'pendukung', label: 'Pendukung' },
  { value: 'maintenance', label: 'Maintenance' },
];

/**
 * H-2 — the seven revision triggers, transcribed from §4 H-2.
 *
 * `ambang` marks the two §4 writes with an "X". The API refuses a threshold on
 * the other five and refuses its absence on these two (`ck_strtrg_ambang`
 * enforces the equivalence in both directions), so the form must not offer the
 * input where it does not belong.
 *
 * This is also the J-3 list: `openStrategiRevision` only accepts a trigger this
 * Strategi declared here.
 */
export const TRIGGER_REVISI_LABELS: {
  value: string;
  label: string;
  ambang?: { satuan: string; maks?: number };
}[] = [
  {
    value: 'pencapaian_di_bawah_target',
    label: 'Pencapaian di bawah target 2 bulan berturut',
    ambang: { satuan: '% target', maks: 100 },
  },
  { value: 'klien_ubah_lini_produk', label: 'Klien ubah lini produk' },
  { value: 'stok_kosong', label: 'Stok kosong', ambang: { satuan: 'hari' } },
  { value: 'budget_iklan_dipotong', label: 'Budget iklan dipotong' },
  { value: 'kebijakan_platform_berubah', label: 'Perubahan kebijakan platform' },
  { value: 'ganti_pic_klien', label: 'Ganti PIC klien' },
  { value: 'lainnya', label: 'Lainnya (wajib dijelaskan)' },
];

/**
 * I-2 — divisions that can receive a Brief.
 *
 * Identical to `briefs.assigned_division`. `Live Stream` is here even though
 * Rule 18 keeps hosting with a vendor: Live Stream briefs exist, they just skip
 * the task machine and end at a vendor tracker, so the dispatch order has to be
 * able to name one.
 */
export const DISPATCH_DIVISIONS = ['Creative', 'Ads', 'KOL', 'Live Stream'] as const;

/** H-1 — §4's three impact/likelihood levels. */
export const RISK_LEVELS: { value: RiskLevel; label: string }[] = [
  { value: 'rendah', label: 'Rendah' },
  { value: 'sedang', label: 'Sedang' },
  { value: 'tinggi', label: 'Tinggi' },
];

// ---------------------------------------------------------------------------
// Vocabulary constants — runtime arrays that mirror the type unions above and
// the DB CHECKs in the migration files. Components import these for <select>
// and checkbox lists. Any change here must match the corresponding constant in
// `packages/domain/src/strategi.ts` and the DB CHECK; they are one truth in
// three representations, not three separate truths.
// ---------------------------------------------------------------------------

// --- Section A (A-05) ---

export const CHANNELS = [
  'Shopee',
  'TikTok Shop',
  'Tokopedia',
  'Lazada',
  'Website',
  'Lainnya',
] as const;

/** B-0.2 — `Belum Aktif` skips the historical baseline (Rule 4). */
export const CHANNEL_STATES = ['Eksisting', 'Belum Aktif'] as const;

export const BUSINESS_MODELS = [
  'produsen',
  'brand_owner',
  'distributor',
  'reseller',
] as const;

export const PRICE_POSITIONS = ['premium', 'mid', 'budget', 'price_fighter'] as const;

export const STOCK_CAPACITIES = ['ready_stock', 'produksi_per_order'] as const;

export const CLIENT_ASSETS = [
  'foto_produk',
  'video',
  'sampel',
  'katalog',
  'budget_iklan',
  'host_live',
] as const;

/** A-5 minimum unique selling points. */
export const USP_MIN = 3;

export const ACCESS_KINDS = [
  'seller_center',
  'ads_manager',
  'affiliate_center',
  'akun_chat',
  'gudang_stok',
] as const;

/** Owner QA 2026-08-24: 4th value `tidak_butuh` — see packages/domain ACCESS_STATES. */
export const ACCESS_STATES = ['sudah', 'pending', 'ditolak', 'tidak_butuh'] as const;

// --- Section B (A-06) ---

/** B-2.4 — biggest entry point (optional field). */
export const ENTRY_POINTS = ['search', 'feed', 'live', 'keranjang', 'chat'] as const;

/** B-6.5 — who funds the sampling/seeding programme. */
export const SAMPLE_PROGRAMS = ['tidak_ada', 'klien', 'mea', 'kreator'] as const;

/** B-7.3 — who hosts the live sessions today. */
export const LIVE_HOSTS = [
  'internal_klien',
  'vendor',
  'tim_mea',
  'belum_ada',
] as const;

/** B-7.4 — studio & equipment availability. */
export const STUDIO_STATES = ['tersedia', 'sebagian', 'tidak_ada'] as const;

/** B-5.3 — campaign types running on the channel. */
export const CAMPAIGN_TYPES = [
  'gmv_max',
  'manual_keyword',
  'auto',
  'live_ads',
  'video_ads',
  'affiliate_ads',
  'lainnya',
] as const;

/** B-8.2 — platform programmes the store joined. */
export const PLATFORM_PROGRAMS = [
  'gratis_ongkir_xtra',
  'cashback',
  'campaign_seasonal',
  'flash_sale',
  'voucher_platform',
  'lainnya',
] as const;

/** B-9.2 — what competitors do better. */
export const COMPETITOR_EDGES = [
  'harga',
  'konten',
  'ulasan',
  'iklan',
  'live',
  'bundling',
] as const;

/** B-3.3 cap — at most 5 top SKUs. */
export const TOP_SKU_MAX = 5;
/** B-9.1 cap — at most 3 competing stores. */
export const KOMPETITOR_MAX = 3;

// --- Section C (A-07) ---

/** C-1 enum — bottleneck utama per channel. */
export const BOTTLENECK_KINDS = [
  'trafik',
  'konversi',
  'aov',
  'repeat_order',
  'margin',
  'operasional',
  'konten',
  'harga',
  'listing',
] as const;

// ---------------------------------------------------------------------------
// Section A / Section B repeatable structs (stored as jsonb server-side).
// Named interfaces, not `Record<string, unknown>[]`: the response-shape guard
// follows a key whose type names an interface, and an anonymous bag is a shape
// nothing verifies. Money is a string, as everywhere else on this wire.
// ---------------------------------------------------------------------------

/** A-12 — who may approve at the client, and how to escalate past them. */
export interface StrategiDecisionMaker {
  nama: string;
  jabatan: string;
  berhak_approve: boolean;
  jalur_eskalasi: string;
}

/** B-3.3 — a top SKU by GMV. At most 5 (the PRD's "(5)" read as a maximum). */
export interface StrategiTopSku {
  nama: string;
  gmv: string;
  unit_terjual: number;
  harga_jual: string;
  margin_persen: number;
}

/** B-5.4 — a keyword/audience that produced orders. */
export interface StrategiTopKeyword {
  keyword: string;
  jumlah_order: number;
}

/** B-5.5 — spend with no orders behind it. */
export interface StrategiKampanyeBoncos {
  nama: string;
  spend: string;
}

/** B-6.4 — a top creator by GMV. */
export interface StrategiTopKreator {
  nama: string;
  gmv: string;
}

/** B-8.1 — an active voucher/promo. */
export interface StrategiVoucher {
  tipe: string;
  nilai: string;
  syarat: string;
}

/** B-9.1 — a competing store. At most 3. */
export interface StrategiKompetitor {
  nama: string;
  url: string;
  harga_sebanding: string;
  estimasi_penjualan_bulan: string;
}

export type BusinessModel = 'produsen' | 'brand_owner' | 'distributor' | 'reseller';
export type PricePosition = 'premium' | 'mid' | 'budget' | 'price_fighter';
export type StockCapacity = 'ready_stock' | 'produksi_per_order';
export type ClientAsset =
  | 'foto_produk'
  | 'video'
  | 'sampel'
  | 'katalog'
  | 'budget_iklan'
  | 'host_live';

export type AccessKind =
  | 'seller_center'
  | 'ads_manager'
  | 'affiliate_center'
  | 'akun_chat'
  | 'gudang_stok';
export type AccessState = 'sudah' | 'pending' | 'ditolak' | 'tidak_butuh';
/** `Umum` is not a channel — it is where an access owned by none is recorded. */
export type AccessChannel = Channel | 'Umum';

/** A-15 + A-16 — one row per (channel, akses); the blocker is a flag on it. */
export interface StrategiAkses {
  id: number;
  channel: string;
  akses: string;
  status: string;
  memblokir: boolean;
  target_tanggal_beres: string | null;
  catatan: string;
}

export type EntryPoint = 'search' | 'feed' | 'live' | 'keranjang' | 'chat';
export type SampleProgram = 'tidak_ada' | 'klien' | 'mea' | 'kreator';
export type LiveHost = 'internal_klien' | 'vendor' | 'tim_mea' | 'belum_ada';
export type StudioState = 'tersedia' | 'sebagian' | 'tidak_ada';
export type CampaignType =
  | 'gmv_max'
  | 'manual_keyword'
  | 'auto'
  | 'live_ads'
  | 'video_ads'
  | 'affiliate_ads'
  | 'lainnya';
export type PlatformProgram =
  | 'gratis_ongkir_xtra'
  | 'cashback'
  | 'campaign_seasonal'
  | 'flash_sale'
  | 'voucher_platform'
  | 'lainnya';
export type CompetitorEdge = 'harga' | 'konten' | 'ulasan' | 'iklan' | 'live' | 'bundling';
/** B-1.5 — derived from the baseline months, never typed. */
export type TrenState = 'naik' | 'stabil' | 'turun';

export interface Strategi {
  id: string;
  /** O57 — the agreement (CTR-), which may cover several Services. */
  contract_id: string;
  client_id: string;
  versi_no: number;
  strategi_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  status: StrategiStatus;
  /** Derived from the Contract — read-only (house rule #4). */
  durasi_kontrak_bulan: number;
  tanggal_mulai_kontrak: string;
  tanggal_akhir_kontrak: string;
  tanggal_mulai_siklus: string | null;
  siklus_terkunci: boolean;
  toleransi_over_persen: number;
  diajukan_pada: string | null;
  disetujui_pada: string | null;
  disetujui_oleh: string | null;
  catatan_reviewer: string | null;
  created_by: string;
  created_at: string;
  // Section A — Konteks Klien & Bisnis (A-05). Nullable: the record is born
  // `Draft`, the form autosaves, and the submit gate is what requires the 16
  // answers (`strategiKekurangan` returns which ones are still missing).
  nama_brand: string | null;
  kategori_utama: string | null;
  sub_kategori: string[];
  model_bisnis: string | null;
  // A-3 / A-13 default to `Internal Saja` in the §4.1 visibility map; A-10 is
  // hard-internal and can never be shared. The overlay that enforces it is A-10.
  margin_kotor_persen: number | null;
  posisi_harga: string | null;
  usp: string[];
  kapasitas_stok: string | null;
  lead_time_restock_hari: number | null;
  plafon_unit_per_bulan: number | null;
  titik_kirim_kota: string | null;
  titik_kirim_detail: string | null;
  ekspektasi_klien: string | null;
  riwayat_agensi: string | null;
  pantangan_klien: string[];
  /** A-11 (O58) — "tidak ada" as an explicit answer, not an empty list. */
  pantangan_klien_tidak_ada: boolean;
  decision_maker: StrategiDecisionMaker[];
  sla_klien_jam: number | null;
  sla_klien_catatan: string | null;
  aset_dari_klien: string[];
  /** A-14 (O58). */
  aset_dari_klien_tidak_ada: boolean;
  aset_catatan: string | null;

  // Section D header (A-08). The rest of Section D is elsewhere in this shape:
  // D-1/D-2/D-4 in `targets`, D-3 in `komposisi_kontribusi` (derived), D-8/D-9 in
  // `assumptions`.
  /** D-5 — all three are `W`; the submit gate reports the group as `D-5`. */
  definisi_berhasil_30: string | null;
  definisi_berhasil_60: string | null;
  definisi_berhasil_90: string | null;
  /**
   * D-6 — maks 5, drawn from the D-4 metric vocabulary (`TARGET_METRICS`). The
   * form must offer a closed checkbox list, not a free-text field: a value outside
   * the set is refused by the API and by a DB CHECK.
   */
  leading_indicator: LeadingIndicator[];
  /**
   * D-7 — Sanggahan Target. **HARD-INTERNAL (§4.1): never render this on anything
   * client-facing.** Advisory only: `sanggahan_target_realistis` is the AM's
   * opinion and is never the floor — the floor stays `targets[].nilai_floor`.
   * `null` across all five means no challenge was filed (D-7 is `O`).
   */
  sanggahan_alasan: string | null;
  /** Money ⇒ string (integer minor units), formatted `Rp. X.XXX.XXX,00` for display. */
  sanggahan_angka_pembanding: string | null;
  sanggahan_target_realistis: string | null;
  sanggahan_diajukan_pada: string | null;
  sanggahan_diajukan_oleh: string | null;

  // Section E/H narrative (A-09a). The rest of E/H are child rows: E-3…E-11 in
  // `pillars`, H-1 in `risks`. `E-1`/`E-13`/`H-3` are `W` and appear in
  // `strategiKekurangan`; `H-4` is `O`.
  /** E-1 — the thesis the rest of Section E descends from. */
  growth_thesis: string | null;
  /** E-13 — why pillar A precedes pillar B (the order itself is `pillars[].urutan`). */
  urutan_eksekusi_alasan: string | null;
  /** H-3 — fallback if the main strategy fails in phase 1. */
  skenario_mundur: string | null;
  /**
   * H-4 — when MEA advises stop / scope change.
   * ⚠️ **HARD-INTERNAL (§4.1): never render this anywhere client-facing.**
   */
  kondisi_stop_scope: string | null;

  // --- Section G/I header (A-09b). G-1/G-2 are child lists on StrategiDetail.
  /** G-3 — client review cadence. FREE TEXT: §4 marks G-3/G-4 `Struct`, not enum. */
  review_klien_frekuensi: string | null;
  /** G-3 — report format used at the review. */
  review_klien_format: string | null;
  /** G-3 — who runs it on MEA's side. */
  review_klien_pic: string | null;
  /** G-4 — internal SPV review cadence. Free text, same reason as G-3. */
  review_internal_frekuensi: string | null;
  /** I-3 — metrics pulled into the monthly client report (D-4 vocabulary). */
  metrik_laporan_klien: string[];
}

/** B-1 / B-5 — one row per month of the declared baseline window (B-0.7). */
export interface StrategiBaselineMonth {
  month_index: number;
  gmv: string;
  jumlah_pesanan: number;
  persen_batal: number;
  ad_spend: string;
  roas: number;
  acos: number;
  // B-1.3 auto (GMV/order). Null when there were no orders — render `—`.
  aov: string | null;
}

export interface StrategiChannel {
  id: number;
  channel: Channel;
  channel_lain: string | null;
  status_channel: ChannelState;
  nama_toko: string;
  url_toko: string;
  umur_toko_bulan: number | null;
  badge: string | null;
  target_tanggal_live: string | null;
  prasyarat_pembukaan: string[];
  sumber_data: string | null;
  tanggal_ambil_data: string | null;
  lampiran: string | null;
  periode_baseline_bulan: number | null;
  periode_mulai: string | null;
  periode_akhir: string | null;
  alasan_periode_pendek: string | null;
  catatan_periode_pendek: string | null;
  /**
   * E-2 (A-09b) — Section E, but per channel, because that is the grain of the
   * question. Sent back through `saveStrategiChannels`, NOT a separate call:
   * that endpoint replaces the whole channel list, so a channel posted without
   * these two clears them.
   */
  prioritas: string | null;
  prioritas_alasan: string | null;
  // Section B groups B-2 … B-9 (A-06). One figure per channel; the monthly ones
  // (B-1, B-5.1/5.2) are rows in `baseline` below.
  pengunjung_per_bulan: number | null;
  conversion_rate_persen: number | null;
  // B-2.3 — six shares, all present or all absent, summing to 100 ±0,5.
  trafik_organik_persen: number | null;
  trafik_iklan_persen: number | null;
  trafik_affiliate_persen: number | null;
  trafik_live_persen: number | null;
  trafik_video_persen: number | null;
  trafik_luar_persen: number | null;
  entry_point_utama: string | null;
  entry_point_catatan: string | null;
  sku_listed: number | null;
  sku_aktif: number | null;
  sku_pareto_80: number | null;
  top_sku: StrategiTopSku[];
  sku_slow_moving: number | null;
  sku_stok_kritis: string[];
  listing_layak_persen: number | null;
  rating_toko: number | null;
  jumlah_ulasan: number | null;
  chat_response_rate_persen: number | null;
  chat_response_menit: number | null;
  pesanan_terlambat_persen: number | null;
  poin_penalti: number | null;
  catatan_penalti: string | null;
  tema_keluhan: string[];
  tipe_kampanye: string[];
  /** B-5.3 (O58). */
  tipe_kampanye_tidak_ada: boolean;
  jumlah_kampanye_aktif: number | null;
  top_keyword: StrategiTopKeyword[];
  kampanye_boncos: StrategiKampanyeBoncos[];
  affiliate_aktif_30hari: number | null;
  gmv_affiliate: string | null;
  gmv_affiliate_persen: number | null;
  komisi_open_persen: number | null;
  komisi_target_persen: number | null;
  top_kreator: StrategiTopKreator[];
  program_sampel: string | null;
  program_sampel_catatan: string | null;
  jumlah_video_per_bulan: number | null;
  total_views: number | null;
  gmv_video: string | null;
  jam_live_per_bulan: number | null;
  gmv_live: string | null;
  // B-7.2 third figure — computed server-side. Null at zero live hours: render
  // `—`, never `0` and never an error (house rules #4 and #7).
  gmv_per_jam_live: string | null;
  host_live: string | null;
  studio_live: string | null;
  studio_catatan: string | null;
  voucher_aktif: StrategiVoucher[];
  /** B-8.1 (O58). */
  voucher_aktif_tidak_ada: boolean;
  program_platform: string[];
  /** B-8.2 (O58). */
  program_platform_tidak_ada: boolean;
  beban_promo_persen: number | null;
  kompetitor: StrategiKompetitor[];
  kompetitor_lebih_baik: string[];
  kompetitor_catatan: string | null;
  celah_kompetitor: string | null;
  // B-1.5 — derived from `baseline`, never stored. `tren_persen` is null when
  // the oldest month's GMV was 0: render `—`.
  tren: string | null;
  tren_persen: number | null;
  baseline: StrategiBaselineMonth[];
}

export interface StrategiTarget {
  channel: string;
  month_index: number;
  metric: string;
  nilai_floor: string | null;
  nilai_stretch: string;
  // O57 item (b): the APPROVAL PATH, not the origin — `input_am` while the AM
  // still owns the number, `disetujui_head` once a Head signed off, after which
  // Rule 7 makes it read-only (enforced by a DB trigger).
  sumber_floor: string | null;
}

/**
 * D-3 — komposisi kontribusi channel (% dari total GMV).
 *
 * TURUNAN dari `targets` metrik `gmv` (X-11): server yang menghitungnya, form
 * TIDAK boleh menyediakan input untuk ini. `persen` null saat total nol —
 * render `—`, bukan `0%` (aturan rumah #7). Kolomnya bisa berjumlah 99,99 atau
 * 100,01 karena pembulatan per baris; itu benar untuk field turunan.
 */
export interface StrategiKomposisi {
  channel: string;
  target_gmv: string;
  persen: number | null;
}

export interface StrategiAssumption {
  kode: string;
  asumsi: string;
  pemilik: string;
  cara_verifikasi: string;
  status: AssumptionState;
  // D-9 mapping, as target keys `metric:channel:month_index`.
  target_terkait: string[];
}

export interface StrategiPillar {
  id: number;
  jenis: string;
  channel: string | null;
  urutan: number;
  sku: string | null;
  peran: string | null;
  aksi: string;
  target: string;
  harga_normal: string | null;
  harga_promo: string | null;
  floor_price: string | null;
  vendor_id: string | null;
  slot_jam: number | null;
  tarif: string | null;
  target_gmv_per_jam: string | null;
  detail: Record<string, unknown>;
}

export interface StrategiResource {
  id: number;
  jenis: string;
  channel: string | null;
  divisi: string | null;
  nilai: string | null;
  jumlah: number | null;
  satuan: string | null;
  sumber_dana: string | null;
  vendor_id: string | null;
  skema_biaya: string | null;
  catatan: string;
}

export interface StrategiRisk {
  id: number;
  risiko: string;
  dampak: RiskLevel;
  kemungkinan: RiskLevel;
  mitigasi: string;
  pic: string;
  urutan: number;
}

/** A-09b E-12 — what the client supplies DURING execution, and the cost of late. */
export interface StrategiKetergantungan {
  id: number;
  item: string;
  /** Free text, not a date: §4 exemplifies "tiap tgl 1". */
  kapan: string;
  konsekuensi: string;
  urutan: number;
}

/** A-09b G-1 — work phase. Min 2 required at submit. */
export interface StrategiFase {
  id: number;
  nama: string;
  tanggal_mulai: string;
  tanggal_akhir: string;
  tujuan: string;
  kriteria_lulus: string;
  urutan: number;
}

/** A-09b G-2 — big date in the contract window, and its role. */
export interface StrategiTanggalBesar {
  id: number;
  tanggal: string;
  nama: string;
  peran: string;
  urutan: number;
}

/**
 * A-09b H-2 — a declared revision trigger.
 * `ambang` is a COUNT (percent for `pencapaian_di_bawah_target`, days for
 * `stok_kosong`), so it is a number — the string rule here is only for rupiah.
 * Required for exactly those two codes, and null for the rest.
 */
export interface StrategiTriggerRevisi {
  id: number;
  kode: string;
  ambang: number | null;
  catatan: string | null;
  urutan: number;
}

/** A-09b I-2 + I-4 — Brief-receiving division, dispatch position, division note. */
export interface StrategiDispatch {
  id: number;
  divisi: string;
  urutan: number;
  /** I-4 — optional. */
  catatan: string | null;
}

/** Section J — append-only, one row per event (a version can be returned twice). */
export interface StrategiEvent {
  versi_no: number;
  peristiwa: string;
  aktor: string;
  catatan: string | null;
  trigger_revisi: string[];
  alasan_revisi: string | null;
  asumsi_gugur: string[];
  created_at: string;
}

/** A-07 Section C — C-1/C-2/C-3/C-4 per channel. */
export interface StrategiDiagnosa {
  id: number;
  channel: string;
  bottleneck: string;
  /** Rule 6: free-text reason/evidence for the bottleneck. Required, non-empty. */
  alasan: string;
  akar_masalah: string | null;
  gap_kompetitor: string | null;
}

/** A-07 Section C-5 — quick wins in the first 14 days. */
export interface StrategiQuickWin {
  id: number;
  aksi: string;
  channel: string;
  pic_divisi: string;
  dampak_diharapkan: string;
  urutan: number;
}

/** A-07 Section C-6 — structural risks that cannot be eliminated. */
export interface StrategiRisikoStruktural {
  id: number;
  risiko: string;
  urutan: number;
}

/** A-07 Section C-7 — things the client must resolve before execution. */
export interface StrategiPrasyaratKlien {
  id: number;
  item: string;
  pic_klien: string;
  deadline: string | null;
  urutan: number;
}

/**
 * A-10 / Rule 16 — one field's client visibility.
 *
 * `tier` and `dapat_diubah` arrive from the server DERIVED, and the page must
 * use them rather than re-deciding: the §4.1 map lives in `packages/core` and a
 * copy of it here is the copy most likely to forget a hard-internal field, which
 * is a leak rather than a bug. Render `dapat_diubah: false` as a locked row.
 */
export interface StrategiFieldVisibility {
  field_id: string;
  visibilitas: string;
  /** `hard_internal` | `default_internal` | `default_shareable`. */
  tier: string;
  dapat_diubah: boolean;
  /** null while the row is still the untouched §4.1 default. */
  diubah_oleh: string | null;
  diubah_pada: string | null;
}

export interface StrategiDetail extends Strategi {
  channels: StrategiChannel[];
  akses: StrategiAkses[];
  /** A-07 Section C. */
  diagnosa: StrategiDiagnosa[];
  quick_wins: StrategiQuickWin[];
  risiko_struktural: StrategiRisikoStruktural[];
  prasyarat_klien: StrategiPrasyaratKlien[];
  targets: StrategiTarget[];
  komposisi_kontribusi: StrategiKomposisi[];
  assumptions: StrategiAssumption[];
  pillars: StrategiPillar[];
  resources: StrategiResource[];
  risks: StrategiRisk[];
  /** A-09b — Section E-12 / G-1 / G-2 / H-2 / I-2+I-4. */
  ketergantungan: StrategiKetergantungan[];
  fase: StrategiFase[];
  tanggal_besar: StrategiTanggalBesar[];
  trigger_revisi: StrategiTriggerRevisi[];
  dispatch: StrategiDispatch[];
  /** A-10 — the §4.1 visibility overlay, one entry per field ID (Rule 16). */
  visibilitas: StrategiFieldVisibility[];
  riwayat: StrategiEvent[];
}

/** One unmet requirement — §5 step 5 asks for a live count, not a first error. */
export interface StrategiKekurangan {
  kode: string;
  pesan: string;
}

// Interview → Strategi prefill (RAB-09). Suggestions the AM may accept into
// Section A/C/E; the value is the interview answer as stored (enum code / rupiah
// minor / plain text). Keys are snake_case — they are the wire body verbatim.
export interface StrategiPrefillItem {
  interview_field: string;
  strategi_field: string;
  nilai: string;
  catatan: string | null;
}

export interface StrategiPrefill {
  interview_id: string;
  verdict: string;
  unlocked: boolean;
  flags: string[];
  copy_prasyarat_ke_c7: boolean;
  wajib_catatan_mitigasi: boolean;
  items: StrategiPrefillItem[];
}

/**
 * The five Section A fields that moved to the Interview form (QA §3.A 2026-08-20):
 * A-1 (brand + kategori), A-5 (USP), A-8 (titik kirim), A-10 (riwayat agensi),
 * A-12 (decision maker). Strategi shows them READ-ONLY; this is where the values
 * come from — the Interview answers surfaced by `getStrategiPrefill`. `kategori`
 * rides the `klien.kategori` item (client record), `namaBrand` the `B2-1` item;
 * the rest map by their `strategi_field`. A-14 (aset) is NOT here — it stayed the
 * editable Strategi checklist.
 */
export interface InheritedKonteks {
  namaBrand: string | null;
  kategori: string | null;
  usp: string | null;
  titikKirim: string | null;
  riwayatAgensi: string | null;
  decisionMaker: string | null;
}

/** Field IDs whose Strategi editor is now a read-only mirror of the Interview. */
export const INHERITED_KONTEKS_FIELDS = ['A-1', 'A-5', 'A-8', 'A-10', 'A-12'] as const;

/** Projects the prefill items into the read-only Section A values, or all-null. */
export function inheritedKonteksOf(prefill: StrategiPrefill | null): InheritedKonteks {
  const pick = (sf: string): string | null =>
    prefill?.items.find((it) => it.strategi_field === sf)?.nilai ?? null;
  const brand = prefill?.items.find(
    (it) => it.strategi_field === 'A-1' && it.interview_field !== 'klien.kategori',
  )?.nilai ?? null;
  const kategori = prefill?.items.find(
    (it) => it.strategi_field === 'A-1' && it.interview_field === 'klien.kategori',
  )?.nilai ?? null;
  return {
    namaBrand: brand,
    kategori,
    usp: pick('A-5'),
    titikKirim: pick('A-8'),
    riwayatAgensi: pick('A-10'),
    decisionMaker: pick('A-12'),
  };
}

// Riset awal baseline → Section B channel prefill (RAB-11 / RAB-12). Suggestions
// the AM may accept into Section B; keys are snake_case — the wire body verbatim.
export interface StrategiBaselineMonthSuggestion {
  month_index: number;
  label: string | null;
  gmv: string | null;
  jumlah_pesanan: number | null;
}

// RAB-12 — attribution WITHIN the TikTok Shop platform, shown as a rincian under
// the TikTok Shop channel; never its own channel row.
export interface StrategiGmvMixRincian {
  video_afiliasi: number | null;
  live_afiliasi: number | null;
  video_toko: number | null;
  live_toko: number | null;
  kartu_produk_dan_lain: number | null;
}

export interface StrategiChannelBaselineSuggestion {
  client_platform_id: number;
  platform: string;
  channel: string;
  channel_lain: string | null;
  metode_baseline: string;
  kondisi_toko: string;
  skor: number | null;
  periode_baseline_bulan: number | null;
  cakupan_riwayat: string | null;
  alasan_periode_pendek_wajib: boolean;
  sumber_data: string | null;
  tanggal_ambil_data: string | null;
  lampiran: string | null;
  roas: number | null;
  ad_spend: string | null;
  aov: string | null;
  baseline_bulan: StrategiBaselineMonthSuggestion[];
  gmv_mix: StrategiGmvMixRincian | null;
}

export interface StrategiBaselinePrefill {
  interview_id: string;
  channels: StrategiChannelBaselineSuggestion[];
}

export interface StrategiHeaderBody {
  durasi_kontrak_bulan: number;
  tanggal_mulai_kontrak: string;
  tanggal_akhir_kontrak: string;
  tanggal_mulai_siklus?: string | null;
  toleransi_over_persen?: number | null;
}

export function listStrategi(serviceId: string): Promise<Strategi[]> {
  return api.get<Strategi[]>(`/services/${serviceId}/strategi`);
}

export function createStrategi(serviceId: string, body: StrategiHeaderBody): Promise<Strategi> {
  return api.post<Strategi>(`/services/${serviceId}/strategi`, body);
}

export function getStrategi(id: string): Promise<StrategiDetail> {
  return api.get<StrategiDetail>(`/strategi/${id}`);
}

export function updateStrategiHeader(id: string, body: StrategiHeaderBody): Promise<Strategi> {
  return api.put<Strategi>(`/strategi/${id}`, body);
}

/** Section A body (A-05). Every field optional — autosave posts what it has. */
export interface StrategiKonteksBody {
  nama_brand?: string | null;
  kategori_utama?: string | null;
  sub_kategori?: string[];
  model_bisnis?: BusinessModel | null;
  margin_kotor_persen?: number | null;
  posisi_harga?: PricePosition | null;
  usp?: string[];
  kapasitas_stok?: StockCapacity | null;
  lead_time_restock_hari?: number | null;
  plafon_unit_per_bulan?: number | null;
  titik_kirim_kota?: string | null;
  titik_kirim_detail?: string | null;
  ekspektasi_klien?: string | null;
  riwayat_agensi?: string | null;
  pantangan_klien?: string[];
  pantangan_klien_tidak_ada?: boolean;
  decision_maker?: StrategiDecisionMaker[];
  sla_klien_jam?: number | null;
  sla_klien_catatan?: string | null;
  aset_dari_klien?: ClientAsset[];
  aset_dari_klien_tidak_ada?: boolean;
  aset_catatan?: string | null;
}

/** A-15 row; `memblokir` + `target_tanggal_beres` are A-16 on the same row. */
export interface StrategiAksesBody {
  channel: AccessChannel;
  akses: AccessKind;
  status: AccessState;
  memblokir?: boolean;
  target_tanggal_beres?: string | null;
  catatan?: string;
}

/** Section A — filled once per Strategi, not per channel (§4). */
export function saveStrategiKonteks(
  id: string,
  body: StrategiKonteksBody,
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/konteks`, body);
}

/** A-15/A-16 — the whole matrix, saved as one set. */
export function saveStrategiAkses(id: string, akses: StrategiAksesBody[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/akses`, { akses });
}

// ---------------------------------------------------------------------------
// Section C (A-07) bodies
// ---------------------------------------------------------------------------

export interface StrategiDiagnosaBody {
  channel: string;
  bottleneck: string;
  /** Rule 6: free-text reason/evidence, required non-empty. */
  alasan: string;
  akar_masalah?: string | null;
  gap_kompetitor?: string | null;
}

export interface StrategiQuickWinBody {
  aksi: string;
  channel: string;
  pic_divisi: string;
  dampak_diharapkan: string;
  urutan?: number;
}

export interface StrategiRisikoStrukturalBody {
  risiko: string;
  urutan?: number;
}

export interface StrategiPrasyaratKlienBody {
  item: string;
  pic_klien: string;
  deadline?: string | null;
  urutan?: number;
}

export interface StrategiDiagnosaPayload {
  diagnosa: StrategiDiagnosaBody[];
  quick_wins: StrategiQuickWinBody[];
  risiko_struktural: StrategiRisikoStrukturalBody[];
  prasyarat_klien: StrategiPrasyaratKlienBody[];
}

/** Section C — saved as one atomic set (diagnosa + quick wins + risks + prereqs). */
export function saveStrategiDiagnosa(
  id: string,
  body: StrategiDiagnosaPayload,
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/diagnosa`, body);
}

export function saveStrategiChannels(id: string, channels: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/channels`, { channels });
}

export function saveStrategiBaseline(
  id: string,
  channelId: number,
  months: unknown[],
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/channels/${channelId}/baseline`, { months });
}

export function saveStrategiTargets(id: string, targets: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/targets`, { targets });
}

export function saveStrategiAssumptions(id: string, assumptions: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/assumptions`, { assumptions });
}

/**
 * D-5 + D-6 (A-08). Partial bodies are legal — this is the autosave door (§7), so
 * the form may send whatever the AM has typed so far. There is deliberately NO
 * setter for D-3: it is derived from D-2 (X-11) and arrives as
 * `komposisi_kontribusi`.
 */
export function saveStrategiKpi(
  id: string,
  body: {
    definisi_berhasil_30?: string | null;
    definisi_berhasil_60?: string | null;
    definisi_berhasil_90?: string | null;
    leading_indicator?: LeadingIndicator[];
  },
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/kpi`, body);
}

/**
 * E-1 / E-13 / H-3 / H-4 (A-09a) — the Section E/H paragraph fields. Partial
 * bodies are legal; this is the autosave door (§7). The rest of E/H go through
 * `saveStrategiPillars` (E-3…E-11) and `saveStrategiRisks` (H-1).
 *
 * ⚠️ `kondisi_stop_scope` is HARD-INTERNAL (§4.1) — the form may collect it, but
 * it must never reach a client-facing view.
 */
export function saveStrategiNarasi(
  id: string,
  body: {
    growth_thesis?: string | null;
    urutan_eksekusi_alasan?: string | null;
    skenario_mundur?: string | null;
    kondisi_stop_scope?: string | null;
  },
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/narasi`, body);
}

/**
 * D-7 Sanggahan Target (Rule 19). POST because filing one is an act: the first
 * call notifies SPV Account + Head of Sales, later calls correct the text without
 * notifying again.
 *
 * It does not and cannot lower the floor — the form must not present it as a way
 * to change the target. `angka_pembanding` / `target_realistis` are money, so they
 * travel as strings.
 */
export function raiseStrategiSanggahan(
  id: string,
  body: { alasan: string; angka_pembanding: string; target_realistis: string },
): Promise<StrategiDetail> {
  return api.post<StrategiDetail>(`/strategi/${id}/sanggahan`, body);
}

/**
 * Flip one D-8 assumption's status. Reachable while the Strategi is `Aktif` —
 * unlike `saveStrategiAssumptions`, which is Draft-only — because that is when an
 * assumption actually breaks. `Gugur` notifies AM + SPV that a revision is
 * advisable; it does not start one.
 */
export function setStrategiAssumptionStatus(
  id: string,
  kode: string,
  status: AssumptionState,
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(
    `/strategi/${id}/assumptions/${encodeURIComponent(kode)}/status`,
    { status },
  );
}

export function saveStrategiPillars(id: string, pillars: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/pillars`, { pillars });
}

export function saveStrategiResources(id: string, resources: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/resources`, { resources });
}

export function saveStrategiRisks(id: string, risks: unknown[]): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/risks`, { risks });
}

/**
 * E-12 (A-09b). The body replaces the list — an empty array clears it, same as
 * `saveStrategiPillars`. Do NOT reuse the C-7 form for this: C-7 is the
 * pre-execution gate list and has no `konsekuensi`, which is the field that
 * makes E-12 worth citing when a target is missed.
 */
export function saveStrategiKetergantungan(
  id: string,
  ketergantungan: unknown[],
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/ketergantungan`, { ketergantungan });
}

/**
 * A-10 / Rule 16(b) — flip one field's client visibility.
 *
 * ONE field per call, unlike every other saver in this file. The others replace
 * a list; this records a decision, and Rule 16(b) requires it audit-logged — a
 * batch would write "12 fields changed" into the log that exists to answer which
 * one, and who.
 *
 * Returns the whole overlay, so the page replaces its copy rather than merging
 * one row into it. Never send a field whose `dapat_diubah` is false: the server
 * refuses it twice (domain + DB CHECK), and the UI should not offer the switch.
 */
export function setStrategiFieldVisibility(
  id: string,
  fieldId: string,
  visibilitas: string,
): Promise<{ visibilitas: StrategiFieldVisibility[] }> {
  return api.put<{ visibilitas: StrategiFieldVisibility[] }>(`/strategi/${id}/visibilitas`, {
    field_id: fieldId,
    visibilitas,
  });
}

/**
 * Section G (A-09b) — G-1 phases, G-2 big dates, G-3/G-4 review cadence, saved
 * together because they are one screen and one autosave (§7).
 *
 * G-0 (`tanggal_mulai_siklus`) is NOT here: Rule 17 locks it once period 1
 * closes, so it stays on the header endpoint rather than riding an autosave.
 */
export function saveStrategiKalender(
  id: string,
  body: {
    fase?: unknown[];
    tanggal_besar?: unknown[];
    review_klien_frekuensi?: string | null;
    review_klien_format?: string | null;
    review_klien_pic?: string | null;
    review_internal_frekuensi?: string | null;
  },
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/kalender`, body);
}

/**
 * H-2 (A-09b) — the triggers this client's revisions may cite.
 *
 * The form must offer exactly `TRIGGER_REVISI_CODES`; `openRevision` refuses
 * anything not declared here, so a free-text field would produce a Strategi that
 * cannot state why it was revised.
 */
export function saveStrategiTriggerRevisi(
  id: string,
  trigger_revisi: unknown[],
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/trigger-revisi`, { trigger_revisi });
}

/**
 * Section I (A-09b) — I-2 dispatch order, I-3 report metrics, I-4 division notes.
 * I-1 and J-4 are derived server-side and never posted.
 */
export function saveStrategiHandoff(
  id: string,
  body: { dispatch?: unknown[]; metrik_laporan_klien?: string[] },
): Promise<StrategiDetail> {
  return api.put<StrategiDetail>(`/strategi/${id}/handoff`, body);
}

/** The live "what is still missing" list the submit button reads (§5 step 5). */
/** Interview→Strategi prefill (RAB-09). `null` when the client has no scored,
 *  completed interview yet. */
export function getStrategiPrefill(id: string): Promise<StrategiPrefill | null> {
  return api.get<StrategiPrefill | null>(`/strategi/${id}/prefill`);
}

/** Riset awal baseline → Section B prefill (RAB-11/RAB-12). `null` when the client
 *  has no scored interview / no analysis rows. Suggestion-only. */
export function getBaselinePrefill(id: string): Promise<StrategiBaselinePrefill | null> {
  return api.get<StrategiBaselinePrefill | null>(`/strategi/${id}/baseline-prefill`);
}

export function strategiKekurangan(id: string): Promise<StrategiKekurangan[]> {
  return api.get<StrategiKekurangan[]>(`/strategi/${id}/kekurangan`);
}

export function submitStrategi(id: string): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/submit`);
}

export function approveStrategi(id: string): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/approve`);
}

export function returnStrategi(id: string, catatan: string): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/return`, { catatan });
}

/** Rule 13: a revision must declare trigger + reason + which assumptions broke. */
export function openStrategiRevision(
  id: string,
  body: { trigger_revisi: string[]; alasan_revisi: string; asumsi_gugur: string[] },
): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/revision`, body);
}

export function expireStrategi(id: string): Promise<Strategi> {
  return api.post<Strategi>(`/strategi/${id}/expire`);
}

/**
 * A-11 (§7 D20) — the client share link `/s/{token}`.
 *
 * `status` only ever describes the CURRENT link; the 32-byte secret is returned
 * exactly once, by `createShareLink`, and never readable again. Keys are the wire
 * shape (`ShareLinkStatusWire` / `ShareTokenCreatedWire`).
 */
export interface ShareLinkStatus {
  status: 'none' | 'aktif' | 'dicabut';
  tanggal_kedaluwarsa: string | null;
  created_at: string | null;
  created_by: string | null;
  dicabut_pada: string | null;
}

export interface ShareTokenCreated extends ShareLinkStatus {
  /** Plaintext token, shown once — build the URL as `/s/{token}` and copy it now. */
  token: string;
}

export function getStrategiShareLink(id: string): Promise<ShareLinkStatus> {
  return api.get<ShareLinkStatus>(`/strategi/${id}/share-link`);
}

/** Mint or ROTATE the link — rotating revokes the previous one immediately (§7). */
export function createStrategiShareLink(id: string): Promise<ShareTokenCreated> {
  return api.post<ShareTokenCreated>(`/strategi/${id}/share-link`);
}

export function revokeStrategiShareLink(id: string): Promise<ShareLinkStatus> {
  return api.delete<ShareLinkStatus>(`/strategi/${id}/share-link`);
}

// ---------------------------------------------------------------------------
// J-4 — auto-diff vs the previous version (§4 J-4, "Ringkasan perubahan").
// ---------------------------------------------------------------------------
//
// Derived (computed on read, never stored). Version 1 answers `ada_perbandingan:
// false`. INTERNAL only — RA-7 keeps every diff off the client link. Keys are the
// wire shape (`StrategiDiffWire` / `StrategiDiffEntryWire`); `jenis` says which
// half of each entry is meaningful (scalar → `sebelum`/`sesudah`, collection →
// `ditambah`/`dihapus`/`diubah`).

export interface StrategiDiffEntry {
  jenis: 'skalar' | 'koleksi';
  field_id: string;
  seksi: string;
  label: string;
  sebelum: string | null;
  sesudah: string | null;
  ditambah: string[];
  dihapus: string[];
  diubah: number;
}

export interface StrategiDiff {
  versi_no: number;
  versi_sebelumnya_id: string | null;
  versi_sebelumnya_no: number | null;
  ada_perbandingan: boolean;
  entri: StrategiDiffEntry[];
}

export function getStrategiDiff(id: string): Promise<StrategiDiff> {
  return api.get<StrategiDiff>(`/strategi/${id}/diff`);
}
