/**
 * Irisan BASELINE dari mesin laporan Shopee (B2).
 *
 * ⚠️ Ini BUKAN parser. `packages/core/src/report/shopee/` sudah memuat 17 slot
 * modul, ~3.000 baris parser, dan sudah UAT dengan export Shopee ASLI (Fim
 * Motor, Juli 2026, 15 berkas — `DECISIONS.md` 2026-09-03). Menulis parser
 * kedua di sini berarti dua versi aturan yang sama untuk satu export.
 *
 * Yang belum ada — dan yang modul ini isi — adalah IRISANNYA: dari
 * `ShopeeMetrics` (yang menjawab "bagaimana performa bulan ini") ke bentuk yang
 * Section B Strategi butuhkan (yang menjawab "di mana toko ini berdiri saat
 * kita mulai"). Bentuk keluarannya sengaja dibuat sekongruen mungkin dengan
 * `../metrik.ts` (TikTok) supaya B3 bisa memetakan keduanya lewat SATU pemeta,
 * bukan dua cabang besar.
 *
 * ATURAN YANG MENGIKAT SELURUH BERKAS INI: **absen ≠ nol.** Modul export yang
 * tidak diunggah ⇒ blok `null`, bukan blok berisi nol. `0` di Section B adalah
 * sebuah PERNYATAAN ("toko ini tidak beriklan"); `null` adalah kolom yang masih
 * harus diisi AM. Menukar keduanya adalah kelas kesalahan yang mesin baseline
 * justru ada untuk mencegah (RAB-02 fix #2).
 */
import { div } from '../angka';
import { skuPareto80, skuSlowMoving } from '../payload';
import type { AffItem, ProdukShopeeRec, ShopeeMetrics } from '../../report/shopee/metrik';
import type { ShopeeModule } from '../../report/shopee/types';

// ---------------------------------------------------------------------------
// Bentuk irisan
// ---------------------------------------------------------------------------
export interface ShopeeBaselineToko {
  /** GMV pesanan DIBUAT — angka utama, sama seperti headline laporan (SHP-1). */
  gmv: number | null;
  /** GMV pesanan DIBAYAR; `null` bila seksi itu tak ada di export. */
  gmv_dibayar: number | null;
  pesanan: number | null;
  pembeli: number | null;
  pembeli_baru: number | null;
  aov: number | null;
  pengunjung: number | null;
  konversi: number | null;
  repeat_rate: number | null;
  batal_pesanan: number | null;
  batal_nilai: number | null;
  retur_pesanan: number | null;
  retur_nilai: number | null;
  /** B-1.4 — lihat `batalReturRate` untuk definisinya. */
  batal_retur_rate: number | null;
}

export interface ShopeeBaselineTopSku {
  nama: string | null;
  kode: string;
  gmv: number | null;
  pengunjung: number | null;
  konversi: number | null;
}

export interface ShopeeBaselineProduk {
  sku_total: number;
  sku_ada_penjualan: number;
  rate: number | null;
  top3_share: number | null;
  sku_pareto_80: number | null;
  sku_slow_moving: number;
  top_sku: ShopeeBaselineTopSku[];
  /** Kuadran mode BENCHMARK (absolute) — ambang tetap, bukan persentil kohort;
   *  satu-satunya yang bisa dibandingkan antar klien dan antar periode. */
  kuadran: Record<string, number> | null;
}

export interface ShopeeBaselineIklan {
  belanja: number | null;
  pendapatan_teratribusi: number | null;
  roas: number | null;
  acos: number | null;
  ctr: number | null;
  setara_persen_gmv: number | null;
  jumlah_kampanye: number | null;
  tipe_materi: string[] | null;
}

export interface ShopeeBaselineAfiliasi {
  kreator_total: number;
  gmv: number | null;
  komisi: number | null;
  top5_share: number | null;
  produk_terafiliasi: number;
  top_kreator: { nama: string; gmv: number | null; pesanan: number | null; komisi: number | null }[];
}

/**
 * ⚠️ Sengaja TIDAK ada di sini: padanan `afiliasi.rate` / `kreator_posting` /
 * `posting_dan_ada_penjualan` milik TikTok. `ShopeeMetrics.affiliate` hanya
 * menyimpan 10 kreator teratas, bukan daftar penuh, jadi "berapa kreator yang
 * menghasilkan penjualan" tidak bisa dihitung tanpa menebak. Kunci yang
 * Shopee tak punya harus ABSEN dari payload — dan absen berarti Section B
 * memintanya manual, yang benar. Mengarang angka dari 10 baris teratas akan
 * membuat B-6 terlihat terisi padahal ia salah.
 */

export interface ShopeeBaselineVideo {
  ada_aktivitas: boolean;
  gmv: number | null;
  pesanan: number | null;
  ditonton: number | null;
  penonton: number | null;
  ctr: number | null;
  completion: number | null;
}

export interface ShopeeBaselineLive {
  /** `false` ⇒ berkas Live tidak diunggah (beda dari "diunggah tapi nol sesi"). */
  diunggah: boolean;
  ada_aktivitas: boolean;
}

export interface ShopeeBaselineLayanan {
  chat_masuk: number | null;
  chat_dibalas: number | null;
  response_rate: number | null;
  waktu_respon_detik: number | null;
  csat: number | null;
  konversi_chat: number | null;
  gmv_chat: number | null;
}

export interface ShopeeBaselineKesehatan {
  poin_total: number;
  penalti: { poin: number; deskripsi: string; durasi: string }[];
}

export interface ShopeeBaselinePromo {
  voucher_gmv: number | null;
  voucher_biaya: number | null;
  voucher_klaim: number | null;
  /** `null` = berkas Promo—Diskon tak diunggah; `false` = diunggah, nihil aktivitas. */
  diskon_aktif: boolean | null;
}

/**
 * ⚠️ Sengaja TIDAK ada: `flashsale_aktif`. Slot `promo_flashsale` memang
 * terdeteksi dan terparse, tapi `ShopeeMetrics` tidak membawa hasilnya —
 * `ZERO_ACTIVITY_MODULES` (`report/shopee/metrik.ts`) hanya memantau
 * `bisnis_live`, `promo_diskon`, `layanan_broadcast`, `bisnis_video`. Membaca
 * `zero_activity` untuk flash sale akan SELALU mengembalikan "ada aktivitas",
 * termasuk untuk toko yang tidak pernah ikut flash sale. B-8 tetap manual
 * untuk baris itu sampai mesin laporan benar-benar membawanya.
 */

export interface ShopeeBaselineMetrics {
  toko: ShopeeBaselineToko | null;
  produk: ShopeeBaselineProduk | null;
  iklan: ShopeeBaselineIklan | null;
  afiliasi: ShopeeBaselineAfiliasi | null;
  video: ShopeeBaselineVideo | null;
  live: ShopeeBaselineLive;
  layanan: ShopeeBaselineLayanan | null;
  kesehatan_toko: ShopeeBaselineKesehatan | null;
  promo: ShopeeBaselinePromo;
  /** Atribusi GMV DI DALAM Shopee (padanan `gmv_mix` TikTok, RAB-12). */
  gmv_mix: Record<string, number> | null;
}

// ---------------------------------------------------------------------------
// Turunan
// ---------------------------------------------------------------------------
/**
 * B-1.4 "Pesanan dibatalkan / dikembalikan (%)" (PRD M6A §B-1.4).
 *
 * Rasio NILAI, bukan cacah pesanan — supaya sekelas dengan `toko.refund_rate`
 * TikTok, yang juga `pengembalian dana ÷ GMV`. Bedanya, dan ini disengaja:
 * export Shopee memisahkan **batal** (pesanan gugur sebelum dibayar) dari
 * **retur** (barang kembali setelah dibayar), sementara TikTok hanya melaporkan
 * yang kedua. Judul kolom PRD-nya menyebut KEDUANYA, jadi keduanya dijumlahkan
 * di sini; memakai retur saja akan mengecilkan angka Shopee ±14× pada export
 * contoh dan membuat dua platform tak sebanding di kolom yang sama.
 */
export function batalReturRate(t: {
  gmv: number | null; batal_nilai: number | null; retur_nilai: number | null;
}): number | null {
  if (t.gmv == null || t.gmv <= 0) return null;
  // Absen ≠ nol HANYA berlaku untuk seluruh blok. Di dalam blok yang ADA, satu
  // dari dua komponen yang kosong berarti nol rupiah batal/retur di kolom itu.
  if (t.batal_nilai == null && t.retur_nilai == null) return null;
  return div((t.batal_nilai ?? 0) + (t.retur_nilai ?? 0), t.gmv);
}

/**
 * Pembagian null-safe. `div` inti menuntut dua `number`; di sini pembilang atau
 * penyebutnya rutin `null` (kolom yang export-nya tidak bawa). `null ÷ x` harus
 * `null`, BUKAN `0 ÷ x = 0` — sekali lagi: absen ≠ nol.
 */
const divN = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : div(a, b));

/** `ProdukShopeeRec` → bentuk yang `skuPareto80`/`skuSlowMoving` (B1) baca. */
const asGmvRows = (products: ProdukShopeeRec[]): { rows: { gmv: number }[] } => ({
  rows: products.map((p) => ({ gmv: p.penjualan_dibuat ?? 0 })),
});

const topSku = (products: ProdukShopeeRec[]): ShopeeBaselineTopSku[] =>
  [...products]
    .filter((p) => (p.penjualan_dibuat ?? 0) > 0)
    .sort((a, b) => (b.penjualan_dibuat ?? 0) - (a.penjualan_dibuat ?? 0)
      || a.kode_produk.localeCompare(b.kode_produk))
    .slice(0, 5)
    .map((p) => ({
      nama: p.nama_produk, kode: p.kode_produk, gmv: p.penjualan_dibuat,
      pengunjung: p.pengunjung_produk,
      konversi: (p.pengunjung_produk && p.pesanan_dibuat != null) ? div(p.pesanan_dibuat, p.pengunjung_produk) : null,
    }));

const topKreator = (items: AffItem[]): ShopeeBaselineAfiliasi['top_kreator'] =>
  items.slice(0, 5).map((k) => ({ nama: k.nama, gmv: k.omzet, pesanan: k.pesanan, komisi: k.komisi }));

/**
 * Jenis materi iklan Shopee — registry TERTUTUP, padanan `tipeMateriIklan`
 * (TikTok, B1). Sumbernya bukan sebuah kolom "jenis materi" seperti di Ads
 * Manager TikTok, melainkan SLOT BERKAS yang diunggah: Ads Center mengekspor
 * satu berkas per jenis iklan, dan `detect.ts` sudah memisahkannya. Label
 * bebas dari isi berkas klien tidak pernah diteruskan.
 */
const SLOT_MATERI: ReadonlyArray<readonly ['toko' | 'produk' | 'live' | 'banner', string]> = [
  ['toko', 'iklan_toko'],
  ['produk', 'iklan_produk'],
  ['live', 'iklan_live'],
  ['banner', 'iklan_banner'],
];

export function tipeMateriShopee(ads: ShopeeMetrics['ads']): string[] | null {
  const out = SLOT_MATERI.filter(([slot]) => ads[slot].length > 0).map(([, key]) => key);
  return out.length > 0 ? out : null;
}

/**
 * Jumlah kampanye = cacah baris iklan berbeda (nama kampanye) di keempat slot.
 * `null` bila tidak satu pun berkas iklan diunggah — bukan `0`, yang akan
 * terbaca sebagai "klien ini tidak beriklan".
 */
export function jumlahKampanyeShopee(ads: ShopeeMetrics['ads']): number | null {
  const nama = new Set<string>();
  for (const [slot] of SLOT_MATERI) for (const it of ads[slot]) if (it.nama) nama.add(`${slot}:${it.nama}`);
  return nama.size > 0 ? nama.size : null;
}

// ---------------------------------------------------------------------------
// Irisan
// ---------------------------------------------------------------------------
/**
 * `slots` adalah presence per modul — berkas mana yang benar-benar diunggah AM.
 * Ia WAJIB, bukan opsional: tanpanya "promo diskon tidak diunggah" dan "promo
 * diskon diunggah tapi nol aktivitas" tak bisa dibedakan, dan hanya yang kedua
 * boleh mengisi Section B.
 */
export function buildShopeeBaselineMetrics(
  M: ShopeeMetrics,
  slots: Partial<Record<ShopeeModule, boolean>>,
): ShopeeBaselineMetrics {
  const k = M.kpi_utama.pesanan_dibuat;
  const dibayar = M.kpi_utama.pesanan_dibayar;
  // `bisnis_home` wajib (gerbang `runShopeeReport`), jadi `toko` selalu ada —
  // tapi setiap kolomnya boleh null bila seksi export-nya tak membawanya.
  const toko: ShopeeBaselineToko = {
    gmv: k.gmv, gmv_dibayar: dibayar ? dibayar.gmv : null,
    pesanan: k.pesanan, pembeli: k.pembeli, pembeli_baru: k.pembeli_baru,
    aov: k.aov, pengunjung: k.pengunjung, konversi: k.cr, repeat_rate: k.repeat_rate,
    batal_pesanan: k.batal_pesanan, batal_nilai: k.batal_nilai,
    retur_pesanan: k.retur_pesanan, retur_nilai: k.retur_nilai,
    batal_retur_rate: batalReturRate(k),
  };

  const bucket = M.kuadran?.mode_absolute ?? null;
  const products = bucket
    ? Object.values(bucket).flat()
    : null;
  const produk: ShopeeBaselineProduk | null = products
    ? (() => {
        const jual = products.filter((p) => (p.penjualan_dibuat ?? 0) > 0);
        const totalGmv = jual.reduce((a, p) => a + (p.penjualan_dibuat ?? 0), 0);
        const top3 = [...jual].sort((a, b) => (b.penjualan_dibuat ?? 0) - (a.penjualan_dibuat ?? 0)).slice(0, 3);
        return {
          sku_total: products.length,
          sku_ada_penjualan: jual.length,
          rate: div(jual.length, products.length),
          top3_share: div(top3.reduce((a, p) => a + (p.penjualan_dibuat ?? 0), 0), totalGmv),
          sku_pareto_80: skuPareto80(asGmvRows(products)),
          sku_slow_moving: skuSlowMoving(asGmvRows(products)),
          top_sku: topSku(products),
          kuadran: Object.fromEntries(Object.entries(bucket as Record<string, ProdukShopeeRec[]>).map(([q, arr]) => [q, arr.length])),
        };
      })()
    : null;

  const a = M.health.ads;
  const iklan: ShopeeBaselineIklan | null = a
    ? {
        belanja: a.spend, pendapatan_teratribusi: a.omzet, roas: a.roas, acos: a.acos, ctr: a.ctr,
        setara_persen_gmv: divN(a.omzet, k.gmv),
        jumlah_kampanye: jumlahKampanyeShopee(M.ads), tipe_materi: tipeMateriShopee(M.ads),
      }
    : null;

  const af = M.affiliate;
  const adaAfiliasi = slots.aff_creator === true || slots.aff_product === true;
  const afiliasi: ShopeeBaselineAfiliasi | null = adaAfiliasi
    ? {
        kreator_total: af.total_creators,
        gmv: af.total_omzet, komisi: af.total_komisi,
        top5_share: divN(af.top_creators.slice(0, 5).reduce((s, c) => s + (c.omzet ?? 0), 0), af.total_omzet),
        produk_terafiliasi: af.total_products,
        top_kreator: topKreator(af.top_creators),
      }
    : null;

  const v = M.video;
  const video: ShopeeBaselineVideo | null = v
    ? {
        ada_aktivitas: v.has_activity,
        gmv: (v.summary.penjualan_dibuat as number | null) ?? null,
        pesanan: (v.summary.pesanan_dibuat as number | null) ?? null,
        ditonton: (v.summary.ditonton as number | null) ?? null,
        penonton: (v.summary.penonton as number | null) ?? null,
        ctr: (v.summary.ctr as number | null) ?? null,
        completion: (v.summary.completion as number | null) ?? null,
      }
    : null;

  const c = M.health.chat;
  const chat = M.chat;
  const layanan: ShopeeBaselineLayanan | null = (c || chat)
    ? {
        chat_masuk: (chat?.summary.chat_masuk as number | null) ?? null,
        chat_dibalas: (chat?.summary.chat_dibalas as number | null) ?? null,
        response_rate: c ? c.response_rate : null,
        waktu_respon_detik: c ? c.respon_detik : null,
        csat: c ? c.csat : null,
        konversi_chat: c ? c.order_conversion : null,
        gmv_chat: (chat?.summary.penjualan_dari_chat as number | null) ?? null,
      }
    : null;

  const kt = M.kesehatan_toko;
  return {
    toko, produk, iklan, afiliasi, video,
    live: { diunggah: M.live_uploaded, ada_aktivitas: M.live_uploaded && !M.zero_activity.includes('bisnis_live') },
    layanan,
    kesehatan_toko: kt ? { poin_total: kt.poin_total, penalti: kt.penalti } : null,
    promo: {
      voucher_gmv: (M.voucher?.summary.penjualan_dibuat as number | null) ?? null,
      voucher_biaya: (M.voucher?.summary.biaya_dibuat as number | null) ?? null,
      voucher_klaim: (M.voucher?.summary.klaim as number | null) ?? null,
      diskon_aktif: slots.promo_diskon ? !M.zero_activity.includes('promo_diskon') : null,
    },
    gmv_mix: Object.keys(M.kanal.kanal).length > 0
      ? Object.fromEntries(Object.entries(M.kanal.kanal).map(([nama, v2]) => [nama, v2.nilai]))
      : null,
  };
}
