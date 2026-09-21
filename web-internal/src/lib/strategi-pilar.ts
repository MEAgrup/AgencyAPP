/**
 * Kontrak simpan pilar Section E (E-3…E-10) — bentuk badan `PUT
 * /strategi/{id}/pillars` dan aturan gabungnya.
 *
 * ## Asal-usul
 *
 * Dua fungsi di berkas ini dulu tinggal di `strategi-cockpit-import.ts`
 * (`CockpitPillarBody`, `mergeCockpitPillars`) — modul pengurai JSON tempel dari
 * tool AM Cockpit / AM Co-Pilot. Tool itu pensiun 2026-09-21 (`docs/DECISIONS.md`
 * "PENSIUN-AMTOOLS") dan modulnya ikut dibuang, tapi **kontrak simpannya tidak
 * ikut pensiun**: ia milik Section E, bukan milik tool. Editor pilar manual
 * memakai keduanya apa adanya.
 *
 * Namanya ikut dibersihkan dari kata "cockpit" supaya tidak ada yang mengira
 * masih ada jalur impor JSON — tidak ada.
 */
import type { StrategiPillar } from './strategi';

/** Yang diterima `PUT /strategi/{id}/pillars` — snake_case, batas wire. */
export interface PilarBody {
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

/** Baris pilar kosong — titik awal satu baris yang AM ketik sendiri. */
export function blankPilar(jenis: string, urutan: number): PilarBody {
  return {
    jenis,
    channel: null,
    urutan,
    sku: null,
    // BUKAN label pilar: `peran` adalah enum peran SKU yang tertutup
    // ('hero'/'pendamping'/'bundling'/'baru'/'dimatikan', `ck_strpil_peran`).
    // Mengisinya dengan apa pun di luar itu membuat INSERT `savePillars`
    // melempar galat Postgres yang tak terpetakan — AM melihatnya sebagai
    // "internal server error". Label pilar tinggal di `detail`.
    peran: null,
    aksi: '',
    target: '',
    harga_normal: null,
    harga_promo: null,
    floor_price: null,
    vendor_id: null,
    slot_jam: null,
    tarif: null,
    target_gmv_per_jam: null,
    detail: {},
  };
}

/**
 * `saveStrategiPillars` mengganti SELURUH daftar pilar Section E, jadi
 * "kirim yang baru saja" akan menghapus setiap baris out-of-scope (E-11) dan
 * setiap pilar lain yang AM sudah punya. Fungsi ini menahan semuanya KECUALI
 * baris yang beridentitas sama dengan baris baru — (jenis, channel, aksi) —
 * sehingga memilih ulang aksi yang sama memperbarui di tempat, bukan
 * menggandakan.
 */
export function mergePilar(
  existing: readonly StrategiPillar[],
  fresh: readonly PilarBody[],
): PilarBody[] {
  const replaced = (p: StrategiPillar) =>
    fresh.some((f) => f.jenis === p.jenis && f.channel === p.channel && f.aksi === p.aksi);
  const kept: PilarBody[] = existing
    .filter((p) => !replaced(p))
    .map((p) => ({
      jenis: p.jenis,
      channel: p.channel,
      urutan: p.urutan,
      sku: p.sku,
      peran: p.peran,
      aksi: p.aksi,
      target: p.target,
      harga_normal: p.harga_normal,
      harga_promo: p.harga_promo,
      floor_price: p.floor_price,
      vendor_id: p.vendor_id,
      slot_jam: p.slot_jam,
      tarif: p.tarif,
      target_gmv_per_jam: p.target_gmv_per_jam,
      detail: p.detail,
    }));
  return [...kept, ...fresh].map((p, i) => ({ ...p, urutan: i + 1 }));
}
