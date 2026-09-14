/**
 * PDT (Pusat Data Toko) — baris fakta tertipe (G1-09 sub-langkah 2b-ii, PRD
 * Flow A langkah 6 "tulis baris fakta sesuai whitelist", Rule 8).
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (`commitUploadBatch`,
 * `packages/domain/src/pdt.ts`) yang menulis `pdt_fact_ads`/`pdt_fact_content`.
 *
 * **Modul KEDUA: `tt_video` → `pdt_fact_content`** (lihat `ekstrakBarisTtVideo`
 * di bawah). Beda dari `pdt_fact_ads` — kunci unik `pdt_fact_content`
 * (`client_platform_id, platform_content_id`) TIDAK pernah punya komponen
 * NULL (`ID Video` selalu ada untuk baris yang ditulis), jadi pemanggil bisa
 * memakai `ON CONFLICT ... DO UPDATE` sungguhan di sini — beda dari
 * `pdt_fact_ads` yang harus delete-then-insert karena `sku_id`/`content_id`
 * selalu NULL.
 *
 * **Modul KETIGA (sesi ini): `shopee_parent_sku` + `tt_orders` →
 * `pdt_sku_master`** (lihat `ekstrakBarisSkuMasterShopeeParentSku`/
 * `ekstrakBarisSkuMasterTtOrders` di bawah). Kandidat sebelumnya
 * (`shopee_live`/`shopee_video`, direkomendasikan `HANDOFF_PDT_SESI16.md`)
 * TERNYATA BLOCKED begitu diinvestigasi — `shopee_live` punya kelas blocker
 * SAMA seperti `tt_live` (nol kolom identitas sesi live terverifikasi;
 * `Informasi Streaming` adalah judul bebas, bukan ID stabil — lihat
 * `docs/DECISIONS.md` G1-09-2BII-SHOPEELIVE), dan `shopee_video` masih
 * `UNVERIFIED_SIGNATURE` (`modules.ts`). `pdt_sku_master` dipilih sebagai
 * gantinya — PALING BERHARGA (prasyarat `shopee_ads_cpc`/`pdt_fact_sku_period`/
 * `sku_id` di modul manapun) meski PALING RUMIT (dua platform, upsert bukan
 * insert/replace seperti dua modul di atas). **Bukan** fungsi murni
 * "ekstrak baris" saja seperti dua modul di atas — pemanggil (`commitUploadBatch`)
 * melakukan UPSERT (Rule 19: SKU tidak pernah dihapus, hanya
 * `status_listing`/`last_seen_at` berubah), bukan delete-then-insert atau
 * ON CONFLICT DO UPDATE polos.
 *
 * **`shopee_ads_live` adalah modul PERTAMA yang dipetakan ke tabel fakta**
 * (bukti pola sebelum digeneralisasi ke 24 modul lain — `docs/handoff/
 * HANDOFF_PDT_SESI13.md` §1 butir 1). Dipilih dari ketiga modul iklan Shopee
 * karena SATU-SATUNYA yang tidak butuh `pdt_sku_master` (belum dibangun,
 * pekerjaan terpisah) untuk kunci unik barisnya: `ID Iklan` sendiri sudah
 * unik per baris per periode (satu baris = satu kampanye live), jadi
 * `(client_platform_id, sumber, kampanye_id, sku_id=NULL, content_id=NULL,
 * periode)` (`uq_pdt_fact_ads`, migrasi G1-01) adalah kunci yang SAH tanpa
 * perlu resolusi SKU apa pun.
 *
 * `shopee_ads_cpc` LIHAT Modul KEENAM di bawah — blocker grainnya AKHIRNYA
 * terbuka sesi lalu (sample asli Fim Motor, bukan lagi ditebak). `shopee_ads_search`
 * LIHAT Modul KETUJUH di bawah — blocker `G1-09-2BII-ADS-SEARCH` ("nol kolom
 * biaya/identitas") ditutup sesi ini, sample yang sama membuktikan premis itu
 * sudah usang.
 *
 * **Modul KEEMPAT (sesi ini): `tt_transaction_creator` → `pdt_fact_creator_period`**
 * (lihat `ekstrakBarisKreatorTtTransactionCreator` di bawah) — tabel fakta
 * KEEMPAT yang lahir. Dipilih karena grain barisnya SUDAH per-kreator
 * (`Creator name`, kunci `pdt_fact_creator_period`), jadi NOL ambiguitas
 * kelas `shopee_ads_cpc` di atas — setiap kolom `kolomDipanen` modul ini
 * ber-konsumen EKSPLISIT di `PDT_KOLOM_DIPANEN.md` §1.4 (baik yang menuju
 * kolom skema di sini, maupun yang menuju konsumen LAIN seperti Co-Pilot/PX
 * yang belum dibangun — `Tayangan video`/`Perkiraan komisi` TETAP tidak
 * ditulis ke tabel ini, bukan lupa). `gmv_live`/`gmv_video`/`sampel_terkirim`
 * SENGAJA `null` — modul ini cuma membawa GMV TOTAL kreator (bukan split
 * live/video), dan `Sampel terkirim` MEMANG bukan bagian `kolomDipanen`
 * modul ini (milik `tt_transaction_product`, modul LAIN, grain PER PRODUK
 * — tidak otomatis bisa disatukan ke grain per-kreator tabel ini). **Nol
 * filter akun toko sendiri** — legacy `report/metrik.ts` `affiliateReport`
 * mengecualikan `akunKontenToko` dari daftar kreator (`own.has(...)`), PDT
 * TIDAK mereplikasi filter itu di sini (dicatat, bukan lupa) — beda dari
 * `shopee_ads_cpc` di atas, ini keputusan RENDAH RISIKO (kunci unik tabel
 * TIDAK bisa kolaps karenanya, cuma menambah satu baris ekstra untuk toko
 * sendiri kalau memang muncul di berkas — mudah direvisi lewat reparse).
 *
 * **Modul KELIMA: `shopee_ams_afiliasi` → `pdt_fact_creator_period`**
 * (lihat `ekstrakBarisKreatorShopeeAmsAfiliasi` di bawah) — sisi SHOPEE untuk
 * tabel yang modul KEEMPAT baru mengisi sisi TikTok-nya. ⚠️ **Ejaan kolom
 * DIKOREKSI sesi 20** (`docs/DECISIONS.md` 2026-09-14) — sample asli Fim
 * Motor membuktikan `Username`/`Omzet`/`Komisi` (ejaan sesi ini menulisnya
 * semula) TIDAK PERNAH cocok berkas nyata (`Username Affiliate`/`Omzet
 * Penjualan(Rp)`/`Estimasi Komisi(Rp)`) — bug laten yang membuat modul ini
 * SELALU `parse_status='gagal'` untuk berkas asli sejak lahir, tersembunyi
 * di balik fixture tes yang memalsukan header. Sisa paragraf ini memakai
 * ejaan yang SUDAH dikoreksi. Grain barisnya SUDAH per-kreator (`Username
 * Affiliate`), sama alasan modul KEEMPAT dipilih — kandidat
 * SAUDARANYA di modul yang sama (`shopee_ams_produk`) SENGAJA TIDAK dipetakan
 * di sini: grainnya PER PRODUK (`Kode Item`/`Nama Item`), bukan per-kreator,
 * jadi tidak cocok tabel ini sama sekali — `PDT_KOLOM_DIPANEN.md` §2.10
 * menyebut keduanya bersama sebagai "sinyal PX sisi Shopee / pdt_fact_
 * creator_period Shopee", tapi baris §2.10 itu HARUS dibaca per-grain, bukan
 * "kedua modul menulis ke tabel yang sama". `Komisi`/`ROI` (whitelist modul
 * ini) SENGAJA tidak ditulis ke tabel ini — §2.10 eksplisit `komisi` adalah
 * sumber **`commission_pct`** untuk PX Flow D (konsumen domain LAIN, belum
 * dibangun), bukan kolom `pdt_fact_creator_period` (yang memang tidak punya
 * kolom komisi/ROI sama sekali). `ID Affiliates`/`Produk Terjual` juga tidak
 * dipetakan — tabel ini tidak punya kolom `creator_platform_id` terpisah
 * (beda dari `pdt_fact_content`), dan `Produk Terjual` (hitungan unit) bukan
 * `pesanan_teratribusi` (hitungan pesanan).
 *
 * Angka: `parsePdtAngka(v, true)` — konvensi **Ads Manager** (titik desimal,
 * koma ribuan), BUKAN konvensi Seller Center (`angka.ts` docblock) — cermin
 * `report/shopee/metrik.ts` `parseAdsLive`/`pn(r[ci], true)`, satu-satunya
 * pembaca TERVERIFIKASI untuk bentuk berkas ini sebelum PDT ada.
 *
 * **Modul KEENAM (sesi 19): `shopee_ads_cpc` → `pdt_fact_ads`** (lihat
 * `ekstrakBarisShopeeAdsCpc` di bawah) — blocker grain yang TETAP terbuka
 * sejak sesi 13 (`G1-09-2BII-ADS-CPC`) akhirnya terjawab: sesi ini menerima
 * sample EKSPOR ASLI klien (Fim Motor, berkas fisik `Data+Keseluruhan+Iklan+
 * Shopee-01_07_2026-31_07_2026.csv`, 13 baris data), bukan lagi menebak dari
 * kode legacy saja. Sample membuktikan dugaan sesi 17 **benar**: baris
 * PERTAMA (`Nama Iklan` = "Shop GMV Max", `Jenis Iklan` kosong, `Kode Produk`
 * = `"-"`) adalah iklan TOKO (bukan iklan produk) — TIDAK punya `Kode Produk`
 * sama sekali, tapi tetap satu baris data yang sah (parser legacy
 * `parseAdsCsv` menerimanya, kunci lewat `nama iklan` bukan `Kode Produk`).
 * Grain barisnya **per IKLAN**, bukan per produk — 12 baris sisanya
 * (`Jenis Iklan` = "Iklan Produk") kebetulan satu produk = satu iklan di
 * sample ini, tapi itu properti SAMPLE ini, bukan jaminan skema (produk yang
 * sama BISA punya >1 iklan berjalan). `kampanye_id` (kunci `uq_pdt_fact_ads`)
 * karena itu memakai `nama iklan` — SATU-SATUNYA identitas baris yang selalu
 * ada di whitelist modul ini (tidak ada `ID Iklan` numerik seperti
 * `shopee_ads_live`), cermin PERSIS `parseAdsCsv` legacy (`cNama`, baris
 * ber-nama kosong dilewati). **`sku_id` SENGAJA TETAP `null`** — beda dari
 * dugaan awal PDT_KOLOM_DIPANEN.md §2.3 ("`Kode Produk` konsumen:
 * pdt_fact_ads.sku_id"), sample yang sama menunjukkan `Kode Produk` adalah
 * level PRODUK INDUK (tanpa info varian), sedangkan `pdt_sku_master` (modul
 * KETIGA) berkunci `(platform_product_id, platform_variation_id)` PER VARIAN
 * — satu `Kode Produk` bisa cocok dengan BANYAK baris `pdt_sku_master` (satu
 * per varian), jadi lookup langsung akan mengarang varian mana yang dipilih.
 * Ini KELAS AMBIGUITAS YANG SAMA dengan lookup lintas-tabel yang belum punya
 * preseden (`tt_transaction_product`/`shopee_ams_produk` → `pdt_fact_sku_period`,
 * `docs/handoff/HANDOFF_PDT_SESI18.md` §1 butir 1) — BUKAN diselesaikan diam-
 * diam di sini. Dicatat `G1-09-2BII-ADS-CPC-SKU` (Open baru, `docs/DECISIONS.md`).
 * Angka: `parsePdtAngka(v, true)` — konvensi Ads Manager, sama seperti
 * `shopee_ads_live` (berkas dari dashboard Ads Manager yang sama).
 *
 * **Modul KETUJUH (sesi 22): `shopee_ads_search` → `pdt_fact_ads`** (lihat
 * `ekstrakBarisShopeeAdsSearch` di bawah) — `G1-09-2BII-ADS-SEARCH` DITUTUP.
 * `HANDOFF_PDT_SESI21.md` §3.B: sample asli Fim Motor (`Search-Ads-Overall-
 * Data-*.csv`) TERNYATA punya `Nama Iklan`/`Biaya`, premis blocker lama ("nol
 * kolom biaya/identitas") sudah usang — murni pekerjaan implementasi mengikuti
 * pola `shopee_ads_cpc` di atas, ditandai boleh dikerjakan TANPA menunggu
 * pemilik. **`kampanye_id` KOMPOSIT** — `` `${namaIklan} :: ${kataPencarian}` ``,
 * BUKAN `nama iklan` polos seperti `shopee_ads_cpc` — sample yang tersedia
 * hanya SATU baris data, tidak membuktikan apakah satu iklan search bisa
 * muncul berkali-kali dengan `Kata Pencarian` berbeda dalam satu periode
 * (satu iklan menargetkan banyak keyword, satu baris per keyword). Kalau itu
 * terjadi dan `kampanye_id` cuma `nama iklan`, replace-on-recommit
 * (DELETE+INSERT, sama pola `shopee_ads_cpc`/`shopee_ads_live`) akan diam-diam
 * menimpa baris keyword lain sebagai baris terakhir yang di-loop — bukan
 * error yang kelihatan. Komposit ini aman di kedua kasus: kalau `Kata
 * Pencarian` SELALU `"Semua"` (tidak spesifik keyword, seperti satu-satunya
 * baris sample), komposit berkurang jadi setara `nama iklan` saja (nol
 * downside). `Kata Pencarian` DIBACA di sini tapi SENGAJA TIDAK ditambahkan
 * ke `kolomDipanen` (`modules.ts`) — isinya (bucket 3, Q-6) masih DITAHAN
 * sebagai dimensi laporan, tapi memakainya untuk MEMBENTUK identitas baris
 * bukan pelanggaran penahanan itu (beda tujuan: kunci unik, bukan metrik).
 * `sku_id` tetap `null` — modul ini tidak punya identitas produk sama sekali
 * di whitelist. Angka: `parsePdtAngka(v, true)` — konvensi Ads Manager, sama
 * seperti `shopee_ads_cpc`/`shopee_ads_live`.
 */
import { parsePdtAngka } from './angka';

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/** Satu baris `pdt_fact_ads` mentah dari `shopee_ads_live`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi — sama seperti fungsi lain di paket ini, murni tidak tahu konteks batch). */
export interface PdtBarisAdsShopeeLive {
  kampanyeId: string;
  tayangan: number | null;
  pesananSku: number | null;
  gmv: number | null;
  biaya: number;
  roas: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ads_live` (Rule 8 whitelist `modules.ts`:
 * `['ID Iklan', 'Penonton', 'Pesanan', 'Omzet', 'Biaya', 'Efektifitas Iklan']`
 * — tidak ada `klik` di modul ini, beda dari `shopee_ads_cpc`). Baris ber-
 * `ID Iklan` kosong dilewati (bukan baris data sungguhan — cermin
 * `parseAdsLive` legacy: `if (!nama) continue;`).
 */
export function ekstrakBarisShopeeAdsLive(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisAdsShopeeLive[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKampanye = idx('ID Iklan');
  const iTayangan = idx('Penonton');
  const iPesanan = idx('Pesanan');
  const iGmv = idx('Omzet');
  const iBiaya = idx('Biaya');
  const iRoas = idx('Efektifitas Iklan');

  const hasil: PdtBarisAdsShopeeLive[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const kampanyeId = iKampanye === -1 ? '' : String(row?.[iKampanye] ?? '').trim();
    if (kampanyeId === '') continue;
    hasil.push({
      kampanyeId,
      tayangan: iTayangan === -1 ? null : parsePdtAngka(row?.[iTayangan], true),
      pesananSku: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv], true),
      biaya: iBiaya === -1 ? 0 : parsePdtAngka(row?.[iBiaya], true),
      roas: iRoas === -1 ? null : parsePdtAngka(row?.[iRoas], true),
    });
  }
  return hasil;
}

/**
 * Satu baris `pdt_fact_content` mentah dari `tt_video`, SEBELUM
 * `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang
 * melengkapi). `waktuPosting`/`skuId` SENGAJA tidak ada field-nya di sini —
 * lihat docblock `ekstrakBarisTtVideo` untuk kenapa keduanya tetap NULL di
 * pemanggil, bukan dihitung di sini.
 */
export interface PdtBarisContentTtVideo {
  platformContentId: string;
  creatorPlatformId: string | null;
  creatorHandle: string | null;
  /** `true` bila `creatorPlatformId` ada di `akunKontenToko` klien (Rule 3-4 pola sama `validasiIdentitasTiktok`, tapi PER BARIS bukan verdict file). Selalu `false` (bukan `null`) bila `akunKontenToko` belum terikat — kolom DB `NOT NULL DEFAULT false`. */
  isAkunToko: boolean;
  vv: number | null;
  likes: number | null;
  dibagikan: number | null;
  klikProduk: number | null;
  gmv: number | null;
}

/**
 * Ekstrak seluruh baris data `tt_video` (Rule 8 whitelist `modules.ts`:
 * `['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan',
 * 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari
 * video (Rp)']`). Baris ber-`ID Video` kosong dilewati (bukan baris data
 * sungguhan — cermin `baseline/metrik.ts` `video()`:
 * `.filter(r => r['ID Video'] != null || r['Informasi Video'] != null)`,
 * disederhanakan ke `ID Video` saja karena itulah `platform_content_id`,
 * NOT NULL di skema).
 *
 * **`waktu_posting`/`sku_id` TIDAK ada di hasil fungsi ini** (pemanggil
 * SELALU menulis NULL untuk keduanya, sama pola `sku_id` di
 * `ekstrakBarisShopeeAdsLive`):
 *  - `sku_id` (FK `pdt_sku_master`, dari kolom `Produk`) — SKU master belum
 *    dibangun, sama alasan `shopee_ads_cpc` belum dipetakan.
 *  - `waktu_posting` — nol parser TERVERIFIKASI untuk format kolom `Waktu`
 *    modul ini di seluruh repo (beda dari `Waktu Live` milik `tt_live`, yang
 *    PUNYA parser terverifikasi `report/metrik.ts` `parseWaktuLive`). Satu
 *    petunjuk PARSIAL ditemukan: `baseline/metrik.ts` `video()` mencocokkan
 *    `waktu.startsWith(tahun + '/' + bulan)` (prefix `YYYY/MM`) untuk filter
 *    periode — cukup untuk MENYIMPULKAN awalan formatnya, TIDAK cukup untuk
 *    parser timestamp penuh (hari/jam/menit sesudahnya belum pernah
 *    diverifikasi). Menebak sisanya persis kelas kesalahan
 *    `G1-06-PERIODE-TIKTOK` sudah peringatkan — dicatat `docs/DECISIONS.md`
 *    sebagai Open, bukan ditebak.
 *
 * Angka: `parsePdtAngka(v)` TANPA `raw` — konvensi **Seller Center** (titik
 * ribuan, koma desimal), BEDA dari `shopee_ads_live` (Ads Manager) — cermin
 * `baseline/metrik.ts` `video()`, yang memanggil `n(r['VV'])` dkk TANPA flag
 * `raw` (lihat docblock `baseline/angka.ts` `n(v,raw)` untuk kontras kedua
 * konvensi).
 */
export function ekstrakBarisTtVideo(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
  akunKontenToko: readonly string[] | null,
): PdtBarisContentTtVideo[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iIdVideo = idx('ID Video');
  const iIdKreator = idx('ID Kreator');
  const iNamaKreator = idx('Nama Kreator');
  const iVv = idx('VV');
  const iLikes = idx('Likes');
  const iDibagikan = idx('Dibagikan');
  const iKlikProduk = idx('Klik Produk');
  const iGmv = idx('GMV dari video (Rp)');

  const hasil: PdtBarisContentTtVideo[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformContentId = iIdVideo === -1 ? '' : String(row?.[iIdVideo] ?? '').trim();
    if (platformContentId === '') continue;
    const creatorPlatformId = iIdKreator === -1 ? null : (String(row?.[iIdKreator] ?? '').trim() || null);
    hasil.push({
      platformContentId,
      creatorPlatformId,
      creatorHandle: iNamaKreator === -1 ? null : (String(row?.[iNamaKreator] ?? '').trim() || null),
      isAkunToko: creatorPlatformId != null && akunKontenToko != null && akunKontenToko.includes(creatorPlatformId),
      vv: iVv === -1 ? null : parsePdtAngka(row?.[iVv]),
      likes: iLikes === -1 ? null : parsePdtAngka(row?.[iLikes]),
      dibagikan: iDibagikan === -1 ? null : parsePdtAngka(row?.[iDibagikan]),
      klikProduk: iKlikProduk === -1 ? null : parsePdtAngka(row?.[iKlikProduk]),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv]),
    });
  }
  return hasil;
}

/**
 * Satu baris (SATU SKU/varian, sesudah dedup) `pdt_sku_master`, SEBELUM
 * `client_platform_id`/`batch_id`/`parser_versi` (pemanggil yang melengkapi,
 * pola sama fungsi lain di paket ini). `platformVariationId` `''` bila
 * platform/modul sumber tidak membawa id varian terpisah (kolom DB
 * `DEFAULT ''`, bukan `NULL` — cermin skema `pdt_sku_master`,
 * `uq_pdt_sku_master (client_platform_id, platform_product_id,
 * platform_variation_id)`).
 */
export interface PdtBarisSkuMaster {
  platformProductId: string;
  platformVariationId: string;
  sellerSku: string | null;
  namaProduk: string | null;
  namaVariasi: string | null;
  kategoriPlatform: string | null;
  hargaSatuanTerakhir: number | null;
}

/** Dedup berdasar `(platformProductId, platformVariationId)` — baris belakangan menang (menimpa baris sebelumnya di array yang sama), cermin semantik `ON CONFLICT DO UPDATE` yang dipakai pemanggil. Satu berkas bisa membawa SKU yang sama berkali-kali (mis. satu baris per pesanan) — tabel master butuh SATU baris per SKU, bukan satu per kemunculan. */
function dedupSkuMaster(baris: readonly PdtBarisSkuMaster[]): PdtBarisSkuMaster[] {
  const byKey = new Map<string, PdtBarisSkuMaster>();
  for (const b of baris) byKey.set(`${b.platformProductId} ${b.platformVariationId}`, b);
  return [...byKey.values()];
}

/**
 * Ekstrak master SKU dari `shopee_parent_sku` (Rule 18: sumber kanonik Shopee
 * — `parentskudetail.xlsx`, `Kode Produk`/`Kode Variasi`/`SKU Induk`, ketiga
 * satu-satunya kolom identitas modul ini di `kolomDipanen`,
 * `PDT_KOLOM_DIPANEN.md` §2.2). **`nama_produk`/`kategori_platform`/
 * `harga_satuan_terakhir` SENGAJA selalu `null` di sini** — modul ini tidak
 * membawa satu pun dari ketiganya di whitelist (bukan lupa dipetakan; ketiga
 * nama kolom itu genuinely tidak ada di `kolomDipanen` modul ini). Baris
 * ber-`Kode Produk` kosong dilewati.
 */
export function ekstrakBarisSkuMasterShopeeParentSku(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisSkuMaster[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKodeProduk = idx('Kode Produk');
  const iKodeVariasi = idx('Kode Variasi');
  const iSkuInduk = idx('SKU Induk');

  const hasil: PdtBarisSkuMaster[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformProductId = iKodeProduk === -1 ? '' : String(row?.[iKodeProduk] ?? '').trim();
    if (platformProductId === '') continue;
    hasil.push({
      platformProductId,
      platformVariationId: iKodeVariasi === -1 ? '' : String(row?.[iKodeVariasi] ?? '').trim(),
      sellerSku: iSkuInduk === -1 ? null : (String(row?.[iSkuInduk] ?? '').trim() || null),
      namaProduk: null,
      namaVariasi: null,
      kategoriPlatform: null,
      hargaSatuanTerakhir: null,
    });
  }
  return dedupSkuMaster(hasil);
}

/**
 * Ekstrak master SKU dari `tt_orders` (`Semua Pesanan`, Rule 18 separuh
 * TikTok). **Deviasi sadar dari Rule 18 harfiah** (dicatat
 * `docs/DECISIONS.md`): PRD minta `tt_orders` DIGABUNG
 * `tt_transaction_product` (`Transaction_Analysis_Product_List`, `Product
 * ID`/`Product category`) — tapi TIDAK ADA kolom kunci gabung yang
 * terverifikasi antara keduanya (`tt_orders` punya `SKU ID`, level VARIAN;
 * `tt_transaction_product` punya `Product ID`, diduga level PRODUK INDUK —
 * dua grain berbeda, nol kolom penghubung di `kolomDipanen` manapun).
 * Mengarang join tanpa kunci sungguhan berisiko salah-gabung SKU yang
 * berbeda. **`tt_orders` kolomDipanen sendiri sudah membawa `Product
 * Category`** (`modules.ts`) — jadi `kategori_platform` TETAP terisi tanpa
 * berkas kedua, dan seluruh field skema lain (`seller_sku`/`nama_produk`/
 * `nama_variasi`/`harga_satuan_terakhir`) juga tercakup oleh SATU berkas ini
 * saja. `platform_variation_id` diisi `''` (bukan `SKU ID` dipakai dua kali)
 * — `SKU ID` sendiri sudah level-varian (satu-satunya id yang tersedia),
 * jadi ia jadi `platformProductId`; TikTok tidak mengekspos id level-produk-
 * induk terpisah di whitelist modul ini. Baris ber-`SKU ID` kosong dilewati.
 * Angka (`SKU Unit Original Price`): `parsePdtAngka(v)` TANPA `raw` —
 * konvensi Seller Center, sama seperti `tt_orders` adalah ekspor Seller
 * Center (bukan Ads Manager).
 */
export function ekstrakBarisSkuMasterTtOrders(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisSkuMaster[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iSkuId = idx('SKU ID');
  const iSellerSku = idx('Seller SKU');
  const iProductName = idx('Product Name');
  const iVariation = idx('Variation');
  const iProductCategory = idx('Product Category');
  const iHarga = idx('SKU Unit Original Price');

  const hasil: PdtBarisSkuMaster[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformProductId = iSkuId === -1 ? '' : String(row?.[iSkuId] ?? '').trim();
    if (platformProductId === '') continue;
    hasil.push({
      platformProductId,
      platformVariationId: '',
      sellerSku: iSellerSku === -1 ? null : (String(row?.[iSellerSku] ?? '').trim() || null),
      namaProduk: iProductName === -1 ? null : (String(row?.[iProductName] ?? '').trim() || null),
      namaVariasi: iVariation === -1 ? null : (String(row?.[iVariation] ?? '').trim() || null),
      kategoriPlatform: iProductCategory === -1 ? null : (String(row?.[iProductCategory] ?? '').trim() || null),
      hargaSatuanTerakhir: iHarga === -1 ? null : parsePdtAngka(row?.[iHarga]),
    });
  }
  return dedupSkuMaster(hasil);
}

/** Satu baris `pdt_fact_creator_period` mentah dari `tt_transaction_creator`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi, pola sama fungsi lain di paket ini). */
export interface PdtBarisKreatorTtTransactionCreator {
  creatorHandle: string;
  gmv: number | null;
  pesananTeratribusi: number | null;
  aov: number | null;
  ctor: number | null;
  jumlahLive: number | null;
  jumlahVideo: number | null;
}

/**
 * Ekstrak seluruh baris data `tt_transaction_creator` (Rule 8 whitelist
 * `modules.ts`: `['Creator name', 'GMV dari kreator', 'AOV', 'CTOR',
 * 'Pesanan teratribusi', 'Tayangan video', 'Video', 'Siaran LIVE', 'Perkiraan
 * komisi']`). `Tayangan video`/`Perkiraan komisi` SENGAJA tidak dipetakan ke
 * field manapun di sini — konsumennya Co-Pilot/PX (`PDT_KOLOM_DIPANEN.md`
 * §1.4), belum dibangun, BUKAN kolom `pdt_fact_creator_period`. Baris
 * ber-`Creator name` kosong dilewati (kunci NOT NULL `pdt_fact_creator_period`).
 * Angka: `parsePdtAngka(v)` TANPA `raw` — konvensi Seller Center, cermin
 * `report/metrik.ts` `affiliateReport`/`reader()` (dipanggil tanpa flag `raw`).
 */
export function ekstrakBarisKreatorTtTransactionCreator(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisKreatorTtTransactionCreator[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iCreatorName = idx('Creator name');
  const iGmv = idx('GMV dari kreator');
  const iPesanan = idx('Pesanan teratribusi');
  const iAov = idx('AOV');
  const iCtor = idx('CTOR');
  const iVideo = idx('Video');
  const iLive = idx('Siaran LIVE');

  const hasil: PdtBarisKreatorTtTransactionCreator[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const creatorHandle = iCreatorName === -1 ? '' : String(row?.[iCreatorName] ?? '').trim();
    if (creatorHandle === '') continue;
    hasil.push({
      creatorHandle,
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv]),
      pesananTeratribusi: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan]),
      aov: iAov === -1 ? null : parsePdtAngka(row?.[iAov]),
      ctor: iCtor === -1 ? null : parsePdtAngka(row?.[iCtor]),
      jumlahLive: iLive === -1 ? null : parsePdtAngka(row?.[iLive]),
      jumlahVideo: iVideo === -1 ? null : parsePdtAngka(row?.[iVideo]),
    });
  }
  return hasil;
}

/** Satu baris `pdt_fact_creator_period` mentah dari `shopee_ams_afiliasi`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi). */
export interface PdtBarisKreatorShopeeAmsAfiliasi {
  creatorHandle: string;
  gmv: number | null;
  pesananTeratribusi: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ams_afiliasi` (Rule 8 whitelist
 * `modules.ts`: `['ID Affiliates', 'Username Affiliate', 'Omzet
 * Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI']`
 * — ejaan PERSIS sample asli Fim Motor, dikoreksi sesi 20 dari ejaan lama
 * ('Username'/'Omzet'/'Komisi') yang TIDAK PERNAH cocok berkas nyata, lihat
 * docblock kepala berkas). `Username Affiliate` (bukan `ID Affiliates`)
 * dipakai sebagai `creatorHandle` — cermin `report/shopee/metrik.ts`
 * `parseAffCsv` (dipanggil dari `aff_creator`, `nameKws: ['username',
 * 'kreator', 'creator', 'nama']`, kolom NAMA yang dipakai sebagai kunci baris
 * `nm`, bukan ID). `ID Affiliates`/`Produk Terjual` TIDAK dipetakan ke field
 * manapun di sini — `pdt_fact_creator_period` tidak punya kolom untuk
 * keduanya (nol `creator_platform_id` terpisah di tabel ini, beda dari
 * `pdt_fact_content`; `Produk Terjual` = hitungan unit, bukan
 * `pesanan_teratribusi`). `Estimasi Komisi(Rp)`/`ROI` JUGA tidak dipetakan —
 * keduanya sinyal **PX Flow D** (`PDT_KOLOM_DIPANEN.md` §2.10: `komisi`
 * sumber `commission_pct` Shopee), konsumen di domain LAIN
 * (`productexchange`), bukan `pdt_fact_creator_period` — menuliskannya di
 * sini akan mengarang kolom yang tidak diminta whitelist ini. Baris
 * ber-`Username Affiliate` kosong dilewati (kunci NOT NULL
 * `pdt_fact_creator_period`). Angka: `parsePdtAngka(v, true)` — konvensi
 * **Ads Manager**, cermin `parseAffCsv`/`pn(r[ci], true)`.
 */
export function ekstrakBarisKreatorShopeeAmsAfiliasi(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisKreatorShopeeAmsAfiliasi[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iUsername = idx('Username Affiliate');
  const iOmzet = idx('Omzet Penjualan(Rp)');
  const iPesanan = idx('Pesanan');

  const hasil: PdtBarisKreatorShopeeAmsAfiliasi[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const creatorHandle = iUsername === -1 ? '' : String(row?.[iUsername] ?? '').trim();
    if (creatorHandle === '') continue;
    hasil.push({
      creatorHandle,
      gmv: iOmzet === -1 ? null : parsePdtAngka(row?.[iOmzet], true),
      pesananTeratribusi: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
    });
  }
  return hasil;
}

/**
 * Satu baris `pdt_fact_sku_period` mentah dari `shopee_ams_produk`, SEBELUM
 * `client_platform_id`/`batch_id`/`periode`/`parser_versi`/`basis`
 * (pemanggil yang melengkapi — `basis` bukan hasil fungsi ini karena bukan
 * diturunkan dari kolom apa pun di sini, lihat docblock `ekstrakBarisShopeeAmsProduk`).
 * `sku_id` SELALU `null` di pemanggil (level produk-induk, lihat docblock
 * kepala berkas — `G1-09-2BII-ADS-CPC-SKU`).
 */
export interface PdtBarisSkuPeriodShopeeAmsProduk {
  platformProductId: string;
  gmv: number | null;
  produkTerjual: number | null;
  pesanan: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ams_produk` (Modul KEDELAPAN, sesi 23
 * — `G1-09-2BII-ADS-CPC-SKU` DITUTUP juga membuka blocker modul ini:
 * `pdt_fact_sku_period.sku_id` sekarang NULLABLE, lihat docblock kepala
 * berkas). Rule 8 whitelist `modules.ts`: `['Kode Item', 'Nama Item',
 * 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi
 * Komisi(Rp)', 'ROI']` — `Nama Item` TIDAK dipetakan (tampilan UI saja,
 * Rule 20 melarangnya jadi kunci). `Estimasi Komisi(Rp)`/`ROI` SENGAJA
 * TIDAK ditulis ke tabel ini — `PDT_KOLOM_DIPANEN.md` §2.10: `Estimasi
 * Komisi(Rp)` adalah sumber `commission_pct` untuk PX Flow D (konsumen
 * domain LAIN, belum dibangun), dan `pdt_fact_sku_period` memang tidak
 * punya kolom komisi/ROI sama sekali — sama pola `shopee_ams_afiliasi`/
 * modul KELIMA di atas. `sku_id` SELALU `null` di pemanggil — `Kode Item`
 * level PRODUK INDUK, `pdt_sku_master` berkunci per varian (lihat docblock
 * kepala berkas, `G1-09-2BII-ADS-CPC-SKU`: pemilik menjawab "kebutuhan
 * hanya GMV per produk bukan sampai varian"). Baris ber-`Kode Item` kosong
 * dilewati (bukan baris data sungguhan, sama pola modul lain di paket ini).
 * **`basis = 'dibayar'`** — DITETAPKAN pemanggil (bukan diturunkan di sini),
 * keputusan pemilik (`AskUserQuestion` sesi 23): AMS tidak menyebutkan
 * basis GMV-nya secara eksplisit (beda dari `shopee_parent_sku`/G1-07 yang
 * memang menulisnya di nama kolom), diperlakukan sebagai "Pesanan
 * Dibayar/Selesai" (lazim untuk program afiliasi — komisi biasanya baru
 * dihitung dari pesanan yang benar-benar selesai, mencegah kecurangan lewat
 * order yang dibatalkan). Angka: `parsePdtAngka(v, true)` — konvensi Ads
 * Manager, sama seperti `shopee_ams_afiliasi` (dashboard AMS yang sama).
 */
export function ekstrakBarisShopeeAmsProduk(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisSkuPeriodShopeeAmsProduk[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKodeItem = idx('Kode Item');
  const iOmzet = idx('Omzet Penjualan(Rp)');
  const iProdukTerjual = idx('Produk Terjual');
  const iPesanan = idx('Pesanan');

  const hasil: PdtBarisSkuPeriodShopeeAmsProduk[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const platformProductId = iKodeItem === -1 ? '' : String(row?.[iKodeItem] ?? '').trim();
    if (platformProductId === '') continue;
    hasil.push({
      platformProductId,
      gmv: iOmzet === -1 ? null : parsePdtAngka(row?.[iOmzet], true),
      produkTerjual: iProdukTerjual === -1 ? null : parsePdtAngka(row?.[iProdukTerjual], true),
      pesanan: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
    });
  }
  return hasil;
}

/** Satu baris `pdt_fact_ads` mentah dari `shopee_ads_cpc`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi, pola sama fungsi lain di paket ini). `sku_id`/`content_id` SELALU `null` di pemanggil — lihat docblock kepala berkas untuk kenapa (`Kode Produk` level induk, `pdt_sku_master` berkunci per varian). `platformProductId` DIISI (sesi 23, `G1-09-2BII-ADS-CPC-SKU`) — salinan identitas `Kode Produk`, BUKAN lookup ke `pdt_sku_master`. */
export interface PdtBarisAdsShopeeCpc {
  kampanyeId: string;
  platformProductId: string | null;
  tayangan: number | null;
  klik: number | null;
  pesananSku: number | null;
  gmv: number | null;
  biaya: number;
  roas: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ads_cpc` (Rule 8 whitelist `modules.ts`:
 * `['ID Toko', 'Periode', 'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi',
 * 'Biaya', 'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Biaya Iklan
 * Terhadap Omzet (ACOS) (%)']` — `ID Toko`/`Periode` adalah preamble batch,
 * bukan kolom baris, dan ACOS tidak punya kolom skema `pdt_fact_ads` (dicatat,
 * bukan hilang diam-diam — konsumennya `HealthAds.acos`, domain LAIN).
 * `kampanye_id` memakai `nama iklan` (BUKAN `Kode Produk` — lihat docblock
 * kepala berkas untuk bukti grain PER IKLAN dari sample Fim Motor), cermin
 * PERSIS `parseAdsCsv` legacy (`report/shopee/metrik.ts`, `cNama`). Baris
 * ber-`nama iklan` kosong dilewati (bukan baris data sungguhan — sama alasan
 * legacy: `if (!nama) continue`). Angka: `parsePdtAngka(v, true)` — konvensi
 * Ads Manager, sama seperti `shopee_ads_live`.
 *
 * `platformProductId` (sesi 23, `G1-09-2BII-ADS-CPC-SKU` DITUTUP — pemilik:
 * "kebutuhan hanya GMV per produk bukan sampai varian") — `Kode Produk`
 * disalin LANGSUNG (bukan lookup `pdt_sku_master`, yang berkunci per
 * varian). Nilai `'-'` (sample "Shop GMV Max" Fim Motor asli, iklan TOKO
 * tanpa produk) dan sel kosong SAMA-SAMA dipetakan `null`, BUKAN string
 * literal `'-'` — `'-'` bukan identitas produk sungguhan.
 */
export function ekstrakBarisShopeeAdsCpc(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisAdsShopeeCpc[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKampanye = idx('nama iklan');
  const iKodeProduk = idx('Kode Produk');
  const iTayangan = idx('Dilihat');
  const iKlik = idx('Jumlah Klik');
  const iPesanan = idx('Konversi');
  const iGmv = idx('omzet penjualan');
  const iBiaya = idx('Biaya');
  const iRoas = idx('Efektifitas Iklan');

  const hasil: PdtBarisAdsShopeeCpc[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const kampanyeId = iKampanye === -1 ? '' : String(row?.[iKampanye] ?? '').trim();
    if (kampanyeId === '') continue;
    const kodeProduk = iKodeProduk === -1 ? '' : String(row?.[iKodeProduk] ?? '').trim();
    hasil.push({
      kampanyeId,
      platformProductId: kodeProduk === '' || kodeProduk === '-' ? null : kodeProduk,
      tayangan: iTayangan === -1 ? null : parsePdtAngka(row?.[iTayangan], true),
      klik: iKlik === -1 ? null : parsePdtAngka(row?.[iKlik], true),
      pesananSku: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv], true),
      biaya: iBiaya === -1 ? 0 : parsePdtAngka(row?.[iBiaya], true),
      roas: iRoas === -1 ? null : parsePdtAngka(row?.[iRoas], true),
    });
  }
  return hasil;
}

/** Satu baris `pdt_fact_ads` mentah dari `shopee_ads_search`, SEBELUM `client_platform_id`/`batch_id`/`periode`/`parser_versi` (pemanggil yang melengkapi). */
export interface PdtBarisAdsShopeeSearch {
  kampanyeId: string;
  tayangan: number | null;
  klik: number | null;
  pesananSku: number | null;
  gmv: number | null;
  biaya: number;
  roas: number | null;
}

/**
 * Ekstrak seluruh baris data `shopee_ads_search` (Modul KETUJUH — lihat
 * docblock kepala berkas untuk kenapa blocker `G1-09-2BII-ADS-SEARCH`
 * akhirnya ditutup sesi ini). Rule 8 whitelist `modules.ts`: `['Jumlah
 * Klik', 'Konversi', 'Nama Iklan', 'Biaya']` — `Kata Pencarian` DIBACA di
 * sini untuk membentuk `kampanye_id` KOMPOSIT tapi SENGAJA TIDAK ditambah
 * ke `kolomDipanen` (Q-6 masih DITAHAN, isinya belum boleh jadi dimensi
 * laporan). `kampanye_id` memakai `` `${namaIklan} :: ${kataPencarian}` ``
 * (bukan `nama iklan` polos seperti `shopee_ads_cpc`) — lihat docblock
 * kepala berkas untuk alasan lengkap. Baris ber-`Nama Iklan` kosong
 * dilewati (bukan baris data sungguhan — sama pola `shopee_ads_cpc`/
 * `shopee_ads_live`). Angka: `parsePdtAngka(v, true)` — konvensi Ads
 * Manager, sama seperti `shopee_ads_cpc`/`shopee_ads_live` (berkas dari
 * dashboard yang sama).
 */
export function ekstrakBarisShopeeAdsSearch(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
): PdtBarisAdsShopeeSearch[] {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = (nama: string): number => header.findIndex((c) => norm(c) === norm(nama));
  const iKampanye = idx('Nama Iklan');
  const iKataPencarian = idx('Kata Pencarian');
  const iTayangan = idx('Dilihat');
  const iKlik = idx('Jumlah Klik');
  const iPesanan = idx('Konversi');
  const iGmv = idx('Omzet Penjualan');
  const iBiaya = idx('Biaya');
  const iRoas = idx('Efektifitas Iklan');

  const hasil: PdtBarisAdsShopeeSearch[] = [];
  for (const row of aoa.slice(barisHeader)) {
    const namaIklan = iKampanye === -1 ? '' : String(row?.[iKampanye] ?? '').trim();
    if (namaIklan === '') continue;
    const kataPencarian = iKataPencarian === -1 ? '' : String(row?.[iKataPencarian] ?? '').trim();
    hasil.push({
      kampanyeId: `${namaIklan} :: ${kataPencarian}`,
      tayangan: iTayangan === -1 ? null : parsePdtAngka(row?.[iTayangan], true),
      klik: iKlik === -1 ? null : parsePdtAngka(row?.[iKlik], true),
      pesananSku: iPesanan === -1 ? null : parsePdtAngka(row?.[iPesanan], true),
      gmv: iGmv === -1 ? null : parsePdtAngka(row?.[iGmv], true),
      biaya: iBiaya === -1 ? 0 : parsePdtAngka(row?.[iBiaya], true),
      roas: iRoas === -1 ? null : parsePdtAngka(row?.[iRoas], true),
    });
  }
  return hasil;
}
