// Adapter: MEA Video Factory (`/tools/video-factory`) → Strategi Section B.
//
// ## Kenapa modul ini ada
//
// Video Factory menganalisa export TikTok Shop dan bisa MENURUNKAN ~60% field
// Section B (baseline per channel) otomatis. Sebelumnya hasilnya cuma bisa
// di-copy sebagai teks/JSON untuk mata manusia — tidak ada jalur memasukkannya
// ke form Strategi, jadi AM harus mengetik ulang. Tool sekarang mengeluarkan
// payload mesin `cdps.section_b.v1` (tombol "Copy untuk CDPS Section B"); modul
// ini mem-parse-nya dan menyalinnya ke `ChannelDraft` TikTok Shop.
//
// ## Kontraknya sama dengan Riset Awal → Section B (RAB-19, `mergeBaselinePrefill`)
//
//   1. SARAN, bukan pengisian paksa: hanya field KOSONG yang diisi — nilai yang
//      sudah diketik/disimpan AM tidak pernah ditimpa. AM meninjau lalu SIMPAN
//      lewat jalur Section B biasa (submit → approve, machine #15). Modul ini
//      tidak menulis apa pun ke server.
//   2. Math tetap di tool (satu sumber): payload membawa nilai MENTAH persis
//      yang diharapkan form (uang = string rupiah major, persen = angka 0..100,
//      hitung = bilangan bulat). Tidak ada penghitungan ulang di sini — hanya
//      pemetaan nama-field + guard tipe.
//   3. Tool hanya menyertakan field yang benar-benar terbaca; field N/A (umur
//      toko, komposisi trafik resmi, penalti, kompetitor, dst.) sengaja absen
//      dan tetap manual di Section B.
//
// Tool bersifat TikTok-Shop-only, jadi payload selalu channel "TikTok Shop":
// prefill menyasar channel TikTok Shop di draft, dan MEMBUATNYA bila belum ada.

import { blankChannel, type ChannelDraft } from '@/components/strategi/SectionB';

/** Skema payload yang di-emit `sectionBPayload()` di video-factory.html. */
export const VIDEO_FACTORY_SCHEMA = 'cdps.section_b.v1';

/** Satu kreator pada payload — hanya nama + gmv yang diturunkan tool. */
interface VfNamaGmv {
  nama: string;
  gmv: string;
}

/** Satu SKU pada payload. v5 juga menurunkan unit terjual + harga rata-rata
 *  (GMV ÷ unit); keduanya opsional supaya payload lama (nama+gmv) tetap sah. */
interface VfTopSku {
  nama: string;
  gmv: string;
  unit_terjual?: string;
  harga_jual?: string;
}

/** Blok `channel` di dalam payload. Semua field selain `channel` opsional:
 *  tool hanya menyertakan yang terbaca dari export. */
export interface VideoFactoryChannel {
  channel: string;
  status_channel?: string;
  nama_toko?: string;
  sumber_data?: string;
  tanggal_ambil_data?: string;
  periode_baseline_bulan?: number;
  pengunjung_per_bulan?: number;
  conversion_rate_persen?: number;
  sku_listed?: number;
  sku_aktif?: number;
  sku_pareto_80?: number;
  sku_slow_moving?: number;
  top_sku?: VfTopSku[];
  sku_stok_kritis?: string[];
  rating_toko?: number;
  jumlah_ulasan?: number;
  chat_response_rate_persen?: number;
  pesanan_terlambat_persen?: number;
  jumlah_kampanye_aktif?: number;
  /** B-5.3 — tipe kampanye aktif, sebagai KEY form (mis. 'video_ads',
   *  'live_ads', 'gmv_max'), bukan label. */
  tipe_kampanye?: string[];
  top_keyword?: { keyword: string }[];
  affiliate_aktif_30hari?: number;
  gmv_affiliate?: string;
  gmv_affiliate_persen?: number;
  top_kreator?: VfNamaGmv[];
  jumlah_video_per_bulan?: number;
  total_views?: number;
  gmv_video?: string;
  jam_live_per_bulan?: number;
  gmv_live?: string;
  host_live?: string;
}

export interface VideoFactoryPayload {
  schema: string;
  channel: VideoFactoryChannel;
}

export type ParseResult =
  | { ok: true; payload: VideoFactoryPayload }
  | { ok: false; error: string };

/**
 * Parse + validasi teks yang ditempel AM. Pesan galat Bahasa Indonesia dalam
 * kurung siku (house rule #5). Menerima payload apa adanya dari tool; hanya
 * memastikan bentuk minimum (schema cocok + ada blok channel) supaya paste yang
 * salah (mis. TSV, teks baseline, JSON lain) ditolak dengan jelas alih-alih
 * mengisi form dengan sampah.
 */
export function parseVideoFactoryPayload(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: '[tempel dulu hasil "Copy untuk CDPS Section B" dari Video Factory]' };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: '[format tidak dikenali — pakai tombol "Copy untuk CDPS Section B", bukan "Copy baseline (teks)"]' };
  }
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: '[format tidak dikenali — pakai tombol "Copy untuk CDPS Section B", bukan "Copy baseline (teks)"]' };
  }
  const rec = obj as Record<string, unknown>;
  if (rec.schema !== VIDEO_FACTORY_SCHEMA) {
    return { ok: false, error: '[payload ini bukan hasil "Copy untuk CDPS Section B" (versi tidak cocok)]' };
  }
  const channel = rec.channel;
  if (!channel || typeof channel !== 'object') {
    return { ok: false, error: '[payload tidak berisi data channel — jalankan analisa baseline di Video Factory dulu]' };
  }
  return { ok: true, payload: { schema: VIDEO_FACTORY_SCHEMA, channel: channel as VideoFactoryChannel } };
}

// ---------------------------------------------------------------------------
// Penerapan ke draft
// ---------------------------------------------------------------------------

/** Isi field string HANYA jika kosong; kembalikan apakah ada perubahan. Semua
 *  field sasaran bertipe `string` di ChannelDraft, jadi cast lewat Record aman. */
function fillStr(
  ch: ChannelDraft,
  key: keyof ChannelDraft,
  value: string | number | undefined | null,
): boolean {
  if (value == null || value === '') return false;
  const bag = ch as unknown as Record<string, unknown>;
  if (String(bag[key as string] ?? '').trim() !== '') return false;
  bag[key as string] = String(value);
  return true;
}

/** Deskripsi ringkas hasil penerapan, untuk ditampilkan panel ke AM. */
export interface ApplySummary {
  channelLabel: string;
  channelCreated: boolean;
  fieldsFilled: number;
  fieldsSkipped: number;
}

/**
 * Terapkan payload ke daftar channel draft. Menyasar channel TikTok Shop; kalau
 * belum ada, tambahkan. Field yang sudah terisi dilewati (tidak ditimpa).
 * Mengembalikan daftar channel baru + ringkasan.
 */
export function applyVideoFactoryPrefill(
  channels: ChannelDraft[],
  payload: VideoFactoryPayload,
): { channels: ChannelDraft[]; summary: ApplySummary } {
  const c = payload.channel;
  const targetChannel = c.channel || 'TikTok Shop';

  const idx = channels.findIndex((x) => x.channel === targetChannel);
  const created = idx < 0;
  const base = created ? blankChannel(targetChannel) : channels[idx];
  const next: ChannelDraft = { ...base };

  let filled = 0;
  let skipped = 0;
  const scalar = (key: keyof ChannelDraft, value: string | number | undefined | null) => {
    if (value == null || value === '') return;
    if (fillStr(next, key, value)) filled++;
    else skipped++;
  };

  // B-0 identitas + provenance. Untuk channel baru, status ikut payload
  // (default blankChannel sudah 'Eksisting'); channel yang sudah ada tidak
  // disentuh statusnya — AM yang menentukan.
  if (created && c.status_channel) next.status_channel = c.status_channel;
  scalar('nama_toko', c.nama_toko);
  scalar('sumber_data', c.sumber_data);
  scalar('tanggal_ambil_data', c.tanggal_ambil_data);
  scalar('periode_baseline_bulan', c.periode_baseline_bulan);
  // B-2 trafik & konversi
  scalar('pengunjung_per_bulan', c.pengunjung_per_bulan);
  scalar('conversion_rate_persen', c.conversion_rate_persen);
  // B-3 SKU
  scalar('sku_listed', c.sku_listed);
  scalar('sku_aktif', c.sku_aktif);
  scalar('sku_pareto_80', c.sku_pareto_80);
  scalar('sku_slow_moving', c.sku_slow_moving);
  // B-4 kesehatan toko
  scalar('rating_toko', c.rating_toko);
  scalar('jumlah_ulasan', c.jumlah_ulasan);
  scalar('chat_response_rate_persen', c.chat_response_rate_persen);
  scalar('pesanan_terlambat_persen', c.pesanan_terlambat_persen);
  // B-5 iklan
  scalar('jumlah_kampanye_aktif', c.jumlah_kampanye_aktif);
  // B-6 affiliate
  scalar('affiliate_aktif_30hari', c.affiliate_aktif_30hari);
  scalar('gmv_affiliate', c.gmv_affiliate);
  scalar('gmv_affiliate_persen', c.gmv_affiliate_persen);
  // B-7 konten & live
  scalar('jumlah_video_per_bulan', c.jumlah_video_per_bulan);
  scalar('total_views', c.total_views);
  scalar('gmv_video', c.gmv_video);
  scalar('jam_live_per_bulan', c.jam_live_per_bulan);
  scalar('gmv_live', c.gmv_live);
  scalar('host_live', c.host_live);

  // B-5.3 tipe kampanye — isi hanya bila belum ditandai AM (tidak menimpa, dan
  // tidak menyentuh channel yang sudah ditandai "tidak ada kampanye").
  if (
    Array.isArray(c.tipe_kampanye) &&
    c.tipe_kampanye.length &&
    next.tipe_kampanye.length === 0 &&
    !next.tipe_kampanye_tidak_ada
  ) {
    next.tipe_kampanye = c.tipe_kampanye.filter((t) => typeof t === 'string' && t);
    if (next.tipe_kampanye.length) filled++;
  }

  // List — isi hanya jika list tujuan masih kosong (tidak menggabung/menimpa).
  if (Array.isArray(c.top_sku) && c.top_sku.length && next.top_sku.length === 0) {
    next.top_sku = c.top_sku
      .filter((s) => s && s.nama)
      .map((s) => ({
        nama: s.nama,
        gmv: s.gmv ?? '',
        unit_terjual: s.unit_terjual ?? '',
        harga_jual: s.harga_jual ?? '',
        margin_persen: '',
      }));
    if (next.top_sku.length) filled++;
  }
  if (Array.isArray(c.top_kreator) && c.top_kreator.length && next.top_kreator.length === 0) {
    next.top_kreator = c.top_kreator
      .filter((s) => s && s.nama)
      .map((s) => ({ nama: s.nama, gmv: s.gmv ?? '' }));
    if (next.top_kreator.length) filled++;
  }
  if (Array.isArray(c.top_keyword) && c.top_keyword.length && next.top_keyword.length === 0) {
    next.top_keyword = c.top_keyword
      .filter((k) => k && k.keyword)
      .map((k) => ({ keyword: k.keyword, jumlah_order: '' }));
    if (next.top_keyword.length) filled++;
  }
  if (Array.isArray(c.sku_stok_kritis) && c.sku_stok_kritis.length && next.sku_stok_kritis.length === 0) {
    next.sku_stok_kritis = c.sku_stok_kritis.filter(Boolean);
    if (next.sku_stok_kritis.length) filled++;
  }

  const outChannels = created ? [...channels, next] : channels.map((x, i) => (i === idx ? next : x));
  return {
    channels: outChannels,
    summary: {
      channelLabel: targetChannel,
      channelCreated: created,
      fieldsFilled: filled,
      fieldsSkipped: skipped,
    },
  };
}
