/**
 * Registry PDT diuji terhadap BARIS HEADER BERKAS NYATA (12 klien, Juli 2026) —
 * lihat `header-nyata.fixture.ts` untuk asal-usul dan kenapa korpus ini ada.
 *
 * Bedanya dengan `detect.test.ts`/`fakta.test.ts`: fixture di sana ditulis
 * TANGAN dari `modules.ts`, jadi ia hanya membuktikan kode konsisten dengan
 * dirinya sendiri. Berkas ini membalik arahnya — header datang dari ekspor
 * platform, dan `modules.ts` yang harus menyesuaikan. Lima bug whitelist yang
 * ditemukan sesi 43 semuanya lolos dari tes gaya lama, dan semuanya akan
 * tertangkap oleh tes gaya ini.
 */
import { describe, expect, it } from 'vitest';
import { detectPdtModule } from './detect';
import { HEADER_NYATA } from './header-nyata.fixture';
import { PDT_KOLOM_ALIAS, PDT_MODULES } from './modules';
import { validasiKolomOpsional, validasiKolomWajib } from './parsestatus';

const modulByKode = new Map(PDT_MODULES.map((m) => [m.kode, m]));

/** Alias Rule 9 per modul, bentuk yang `validasiKolomWajib` terima — cermin `ALIAS_PER_MODUL` di `@cdps/domain` `pdt.ts`. */
function aliasPerKolom(modulKode: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of PDT_KOLOM_ALIAS) {
    if (a.modulKode !== modulKode) continue;
    (out[a.kolomKanonik] ??= []).push(a.alias);
  }
  return out;
}

const entri = Object.entries(HEADER_NYATA).flatMap(([kode, varian]) =>
  varian.map((v, i) => ({ kode, varian: v, label: `${kode}#${i} (${v.klien.join(', ')})` })),
);

describe('registry PDT vs header berkas nyata (sesi 43)', () => {
  it('korpusnya tidak kosong dan seluruh modulnya terdaftar di PDT_MODULES', () => {
    expect(entri.length).toBeGreaterThanOrEqual(28);
    for (const e of entri) expect(modulByKode.get(e.kode), `modul tak dikenal: ${e.kode}`).toBeDefined();
  });

  it.each(entri.map((e) => [e.label, e] as const))(
    'kolom WAJIB lengkap di header nyata — %s',
    (_label, e) => {
      const modul = modulByKode.get(e.kode)!;
      const opsional = modul.kolomOpsional ?? [];
      const wajib = modul.kolomDipanen.filter((k) => !opsional.includes(k));
      const gagal = validasiKolomWajib(e.varian.header, wajib, aliasPerKolom(e.kode));
      // Pesan kegagalan menyebut kolom + klien: itulah yang membuat temuan bisa
      // langsung ditindaklanjuti (minta ekspor ulang vs tambah alias vs koreksi kanonik).
      expect(gagal.map((g) => g.kolom), `${e.kode}: kolom wajib hilang di ekspor ${e.varian.klien.join(', ')}`).toEqual([]);
    },
  );

  it('setiap header nyata mencocokkan tanda tangan modulnya sendiri, dan TIDAK ambigu', () => {
    // Regresi Rule 6: tanda tangan dicocokkan ke ISI, dan dua modul tidak boleh
    // sama-sama menang atas satu berkas (AM tidak akan tahu harus pilih yang mana).
    for (const e of entri) {
      const r = detectPdtModule([e.varian.header], PDT_MODULES);
      // Sebagian modul tanda tangannya ada di baris LAIN (preamble/penanda seksi),
      // jadi "tidak cocok dari baris header saja" itu sah; yang TIDAK boleh adalah
      // cocok ke modul yang SALAH.
      for (const cocok of r.matches) {
        expect(cocok, `header ${e.label} malah cocok ke modul lain: ${cocok}`).toBe(e.kode);
      }
    }
  });

  it('kolom OPSIONAL yang hilang dilaporkan, tapi TIDAK menggagalkan berkas (G1-08-SEBAGIAN)', () => {
    // Bukan uji lulus/gagal — ini dokumentasi hidup: daftar mana yang turun ke
    // 'sebagian' di berkas nyata, supaya penurunan status tidak pernah jadi kejutan.
    const turun: string[] = [];
    for (const e of entri) {
      const modul = modulByKode.get(e.kode)!;
      const hilang = validasiKolomOpsional(e.varian.header, modul.kolomOpsional ?? [], aliasPerKolom(e.kode));
      if (hilang.length > 0) turun.push(`${e.kode}: ${hilang.map((h) => h.kolom).join(', ')}`);
    }
    expect(turun).toEqual([
      // SATU-SATUNYA penurunan status di 12 klien, dan ia informatif: kolom
      // `Pengembalian dana` ADA di ekspor Avitaskin lama ("Sample nama asli",
      // dipakai sesi 33) tapi HILANG di kelima ekspor TikTok yang lebih baru —
      // TikTok memang mencabutnya dari "Shop Analytics_Key metrics". Karena ia
      // `kolomOpsional` (Bucket 2, konsumen laporan — bukan gerbang PDT), akibatnya
      // hanya `parse_status='sebagian'`; batch TETAP lolos ke `verified`. Persis
      // pembedaan yang G1-08-SEBAGIAN dibangun untuk menangani, sekarang terbukti
      // di data nyata dan bukan lagi hipotetis.
      'tt_shop_analytics: Pengembalian dana',
    ]);
  });
});
