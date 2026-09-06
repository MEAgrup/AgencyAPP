/**
 * B3 — SATU pemeta payload baseline → usulan Section B.
 *
 * Handoff Gelombang B §4.3/§4.4: `getBaselinePrefill` sudah membaca
 * `riset_awal_analisa.payload`, tapi hanya 4 field yang sampai ke Section B.
 * ~15 angka lain SUDAH ADA di payload dan tetap diketik ulang AM. Modul ini
 * membacanya, sekali, untuk SEMUA schema payload baseline.
 *
 * ## Kenapa satu pemeta, bukan satu per platform
 *
 * Aturan B2 §6.5 #1 mewajibkan payload Shopee sekongruen mungkin dengan
 * `cdps.baseline.tiktok.v1` (`toko`, `produk`, `iklan`, `afiliasi`, `video`,
 * `live`, `gmv_mix`, `gmv_baseline`, `skor`, …). Jadi pemeta ini membaca
 * **jalur kunci bersama** dan tidak punya satu pun cabang per platform:
 * kunci yang sebuah platform tak punya jatuh ke `null`, dan `null` di sini
 * berarti **"AM isi manual"** — bukan nol.
 *
 * Konsekuensi yang disengaja: modul ini tidak perlu tahu engine Shopee sudah
 * ada atau belum, dan tidak perlu diubah saat B1 menambah `produk.sku_pareto_80`,
 * `produk.sku_slow_moving`, `iklan.jumlah_kampanye`, `iklan.tipe_materi[]`.
 * Kunci-kunci itu dibaca di sini hari ini; selama B1 belum mendarat mereka absen
 * dan hasilnya `null`, bukan `0`.
 *
 * ## Aturan rumah yang ditegakkan di sini
 *
 * 1. **Absen ≠ nol** (RAB-02 fix #2). Setiap pembaca memakai `numOrNull`, yang
 *    menolak `undefined`, `null`, string kosong, dan NaN — `Number(null) === 0`
 *    adalah kelas kesalahan yang engine baseline sendiri ada untuk mencegah.
 * 2. **Nol perhitungan ulang di domain/FE** (CLAUDE.md). Semua turunan (share
 *    B-2.3, % GMV affiliate, penjumlahan video toko+afiliasi) dihitung di sini.
 * 3. **Organik BUKAN residu** (`DECISIONS.md` 2026-08-22). Share platform boleh
 *    tumpang tindih dan boleh >100%, jadi "sisanya organik" adalah angka karangan.
 *    `trafikOrganikPersen` selalu `null` — begitu juga `trafikAffiliatePersen`,
 *    karena GMV afiliasi sudah ikut terhitung di bucket video dan LIVE.
 */
import { nil } from './angka';

/** B-3.3 — satu baris top SKU yang payload bawa (nama + GMV + klik + CTOR). */
export interface SectionBTopSku {
  nama: string;
  /** Rupiah major, string — satuan yang `strategi_channel.top_sku` simpan. */
  gmv: string | null;
  klik: number | null;
  ctorPersen: number | null;
}

/** B-6.4 — satu baris top kreator. */
export interface SectionBTopKreator {
  nama: string;
  gmv: string | null;
}

/**
 * Usulan Section B dari satu payload baseline. Setiap field `null` = payload
 * tidak membawanya ⇒ tetap manual, dan halaman harus MENGATAKANNYA.
 */
export interface SectionBFromBaseline {
  /** `payload.schema` apa adanya, untuk ditampilkan; `null` pada payload lama. */
  schema: string | null;
  /**
   * Payload ini punya salah satu blok yang pemeta ini baca. `false` = payload
   * versi lama (atau baseline manual): halaman menampilkan kalimat jujur
   * "payload versi lama, hanya 4 field yang bisa diwarisi", bukan kolom nol.
   */
  adaIsi: boolean;
  /** `klien.periode_referensi` — bulan yang angka periodenya berasal. */
  periodeReferensi: string | null;

  // B-1.4 — agregat periode, BUKAN per bulan. Dipasangkan ke satu baris bulan
  // hanya bila labelnya persis sama dengan `periodeReferensi` (lihat §pemakai).
  refundRatePersen: number | null;

  // B-2 Trafik & Konversi
  pengunjungPerBulan: number | null;
  conversionRatePersen: number | null;
  /** Selalu null — organik tidak boleh dihitung sebagai residu. */
  trafikOrganikPersen: null;
  trafikIklanPersen: number | null;
  /** Selalu null — GMV afiliasi sudah masuk bucket video & LIVE (dobel hitung). */
  trafikAffiliatePersen: null;
  trafikLivePersen: number | null;
  trafikVideoPersen: number | null;
  trafikLuarPersen: number | null;

  // B-3 Portofolio SKU
  skuListed: number | null;
  skuAktif: number | null;
  /** B1 menambahkannya ke payload; sampai itu mendarat, `null`. */
  skuPareto80: number | null;
  /** idem B1. */
  skuSlowMoving: number | null;
  topSku: SectionBTopSku[];

  // B-5 Iklan
  /** idem B1 (`iklan.jumlah_kampanye`). */
  jumlahKampanyeAktif: number | null;
  /**
   * idem B1 (`iklan.tipe_materi[]`). Mentah dan sudah dirapikan (trim + dedup),
   * BELUM disaring ke taksonomi `CAMPAIGN_TYPES` — enum itu milik domain, dan
   * penyaringnya ada di sana supaya taksonomi tidak punya dua rumah.
   */
  tipeKampanye: string[];

  // B-6 Affiliate / KOL
  affiliateAktif30Hari: number | null;
  gmvAffiliate: string | null;
  gmvAffiliatePersen: number | null;
  topKreator: SectionBTopKreator[];
  /** B-6.5 — jumlah sampel terkirim. Siapa yang menanggung (enum `program_sampel`)
   *  tidak ada di export mana pun ⇒ tetap manual. */
  sampelTerkirim: number | null;

  // B-7 Konten & Live
  jumlahVideoPerBulan: number | null;
  totalViews: number | null;
  gmvVideo: string | null;
  jamLivePerBulan: number | null;
  gmvLive: string | null;
}

// ---------------------------------------------------------------------------
// Pembaca — absen, kosong, dan NaN semuanya jatuh ke null
// ---------------------------------------------------------------------------

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => obj(x) !== null) : [];
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

/** Rupiah major → string, satuan kolom `numeric` di `strategi_channel`. */
function money(v: unknown): string | null {
  const n = numOrNull(v);
  return n === null ? null : String(n);
}

/** Pecahan payload (0,0537) → persen kolom `numeric(6,2)` (5,37). */
export function pecahanKePersen(v: unknown): number | null {
  const n = numOrNull(v);
  if (n === null) return null;
  return Math.round(n * 10000) / 100;
}

/** Jumlah yang null-preserving: null + null = null, null + 5 = 5. */
function tambah(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * B-2.3 — share video / LIVE / luar dari `gmv_mix`, dengan penyebut = jumlah
 * kelima bucket mix itu sendiri (bukan `toko.gmv`): mix adalah atribusi DI DALAM
 * satu platform dan kelima bucketnya memang membagi habis GMV platform, jadi
 * itulah satu-satunya penyebut yang konsisten dengan pembilangnya. Share iklan
 * TIDAK ikut penyebut ini — ia datang jadi (`iklan.setara_persen_gmv`) dengan
 * penyebutnya sendiri, dan itu justru sebabnya keenam kolom boleh tak berjumlah
 * 100 (CHECK `ck_strch_trafik_total` sudah dicabut migrasi 20260822010000).
 */
function shareMix(mix: Record<string, unknown> | null): {
  video: number | null;
  live: number | null;
  luar: number | null;
} {
  const kosong = { video: null, live: null, luar: null };
  if (!mix) return kosong;
  const vidAff = numOrNull(mix.video_afiliasi);
  const liveAff = numOrNull(mix.live_afiliasi);
  const vidToko = numOrNull(mix.video_toko);
  const liveToko = numOrNull(mix.live_toko);
  const lain = numOrNull(mix.kartu_produk_dan_lain);
  const semua = [vidAff, liveAff, vidToko, liveToko, lain];
  if (semua.every((x) => x === null)) return kosong;
  const total = semua.reduce<number>((s, x) => s + (x ?? 0), 0);
  // Penyebut 0 = tidak ada dasar untuk membagi, BUKAN nol (aturan rumah #7).
  if (nil(total) || total <= 0) return kosong;
  const bagi = (a: number | null, b: number | null): number | null => {
    const j = tambah(a, b);
    return j === null ? null : Math.round((j / total) * 10000) / 100;
  };
  return { video: bagi(vidToko, vidAff), live: bagi(liveToko, liveAff), luar: bagi(lain, null) };
}

function daftarTeks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x);
    if (s !== null && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Baca satu payload baseline (schema apa pun) jadi usulan Section B.
 *
 * Payload yang bukan objek, atau yang tidak membawa satu pun blok yang dibaca di
 * sini, menghasilkan hasil kosong dengan `adaIsi === false` — itulah sinyal yang
 * dipakai halaman untuk bilang "payload versi lama", bukan menampilkan nol.
 */
export function mapPayloadToSectionB(payload: unknown): SectionBFromBaseline {
  const p = obj(payload);
  const toko = obj(p?.toko);
  const mix = obj(p?.gmv_mix);
  const produk = obj(p?.produk);
  const iklan = obj(p?.iklan);
  const afiliasi = obj(p?.afiliasi);
  const video = obj(p?.video);
  const live = obj(p?.live);
  const videoToko = obj(video?.toko);
  const videoAff = obj(video?.afiliasi);
  const liveToko = obj(live?.toko);
  const klien = obj(p?.klien);

  const share = shareMix(mix);
  const gmvToko = numOrNull(toko?.gmv);
  const gmvAff = numOrNull(afiliasi?.gmv);

  return {
    schema: str(p?.schema),
    adaIsi: [toko, mix, produk, iklan, afiliasi, video, live].some((x) => x !== null),
    periodeReferensi: str(klien?.periode_referensi),

    refundRatePersen: pecahanKePersen(toko?.refund_rate),

    pengunjungPerBulan: numOrNull(toko?.pengunjung),
    conversionRatePersen: pecahanKePersen(toko?.konversi),
    trafikOrganikPersen: null,
    trafikIklanPersen: pecahanKePersen(iklan?.setara_persen_gmv),
    trafikAffiliatePersen: null,
    trafikLivePersen: share.live,
    trafikVideoPersen: share.video,
    trafikLuarPersen: share.luar,

    skuListed: numOrNull(produk?.sku_total),
    skuAktif: numOrNull(produk?.sku_ada_penjualan),
    skuPareto80: numOrNull(produk?.sku_pareto_80),
    skuSlowMoving: numOrNull(produk?.sku_slow_moving),
    topSku: arr(produk?.top_sku)
      .map((s) => ({
        nama: str(s.nama) ?? '',
        gmv: money(s.gmv),
        klik: numOrNull(s.klik),
        ctorPersen: pecahanKePersen(s.ctor),
      }))
      .filter((s) => s.nama !== ''),

    jumlahKampanyeAktif: numOrNull(iklan?.jumlah_kampanye),
    tipeKampanye: daftarTeks(iklan?.tipe_materi),

    affiliateAktif30Hari: numOrNull(afiliasi?.kreator_posting),
    gmvAffiliate: money(afiliasi?.gmv),
    // Penyebut 0/absen ⇒ null (aturan rumah #7), bukan 0%.
    gmvAffiliatePersen:
      gmvAff === null || gmvToko === null || gmvToko <= 0
        ? null
        : Math.round((gmvAff / gmvToko) * 10000) / 100,
    topKreator: arr(afiliasi?.top_kreator)
      .map((k) => ({ nama: str(k.nama) ?? '', gmv: money(k.gmv) }))
      .filter((k) => k.nama !== ''),
    sampelTerkirim: numOrNull(afiliasi?.sampel_terkirim),

    // B-7.1 menghitung SELURUH video yang tayang di periode itu — toko + afiliasi.
    // `diposting_periode` hanya ada di sisi toko; sisi afiliasi membawa `aktif`.
    jumlahVideoPerBulan: tambah(
      numOrNull(videoToko?.diposting_periode) ?? numOrNull(videoToko?.aktif),
      numOrNull(videoAff?.aktif),
    ),
    totalViews: tambah(numOrNull(videoToko?.vv), numOrNull(videoAff?.vv)),
    gmvVideo: (() => {
      const j = tambah(numOrNull(videoToko?.gmv), numOrNull(videoAff?.gmv));
      return j === null ? null : String(j);
    })(),
    // B-7.2 hanya LIVE toko: jam & GMV live afiliasi bukan kapasitas yang tim MEA
    // jadwalkan, dan menjumlahkannya membuat "GMV per jam" (turunan) salah.
    jamLivePerBulan: numOrNull(liveToko?.jam),
    gmvLive: money(liveToko?.gmv),
  };
}
