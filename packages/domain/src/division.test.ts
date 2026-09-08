/**
 * M16 — pasangan `punyaKuotaSatuan` ↔ `TASK_CATALOG`.
 *
 * Tinggal di `@cdps/domain` (bukan di `division.registry.test.ts` milik
 * `@cdps/db`) karena butuh `TASK_CATALOG`, dan `@cdps/domain` bergantung pada
 * `@cdps/db` — mengimpornya dari sana akan menciptakan siklus.
 *
 * KENAPA INI PENTING. Komentar `ALLOWED_DIVISIONS` di `account.ts` menyatakan
 * memperlebar himpunan itu akan **meng-crash** comparator `normalizeTasks`:
 * `TASK_CATALOG[a.divisi].findIndex(...)` atas `undefined`. Sebelum M16, satu-
 * satunya penjaga aturan itu adalah komentar. Sekarang ia gerbang.
 *
 * Inilah alasan registry punya TIGA flag, bukan satu: Store Operation menerima
 * Brief dan jadi tujuan dispatch sejak M16, sementara `punyaKuotaSatuan`-nya
 * baru dinyalakan di M18 — bersama entri `TASK_CATALOG` dan cabang
 * `wrr_aggregate`-nya, di commit yang sama. Pipeline tahapannya (LT-2) masih
 * terbuka sampai hari ini dan tidak dituntut oleh satu pun flag di sini.
 */
import { describe, expect, it } from 'vitest';
import { division, plantask } from '@cdps/core';
import { ALLOWED_DIVISIONS, BRIEF_ASSIGNABLE_DIVISIONS, TASK_CATALOG } from './account';
import { DISPATCH_DIVISIONS } from './strategi';

describe('M16 registry divisi ↔ TASK_CATALOG', () => {
  it('setiap divisi ber-kuota-satuan punya entri TASK_CATALOG', () => {
    const tanpaKatalog = division
      .kuotaSatuanNames()
      .filter((nama) => TASK_CATALOG[nama] === undefined);
    expect(tanpaKatalog).toEqual([]);
  });

  it('setiap entri TASK_CATALOG milik divisi ber-kuota-satuan', () => {
    // Arah sebaliknya: entri katalog untuk divisi yang tidak ber-kuota adalah
    // konfigurasi mati yang menyesatkan pembaca berikutnya.
    const kuota = new Set(division.kuotaSatuanNames());
    const yatim = Object.keys(TASK_CATALOG).filter((nama) => !kuota.has(nama));
    expect(yatim).toEqual([]);
  });

  it('ALLOWED_DIVISIONS adalah himpunan bagian BRIEF_ASSIGNABLE_DIVISIONS', () => {
    // Keduanya sengaja berbeda (Account/Ops bisa menerima Brief tapi tidak
    // punya kuota satuan) — yang tidak boleh adalah divisi ber-kuota yang
    // ternyata tidak boleh menerima Brief sama sekali.
    const assignable = new Set(BRIEF_ASSIGNABLE_DIVISIONS);
    const bocor = ALLOWED_DIVISIONS.filter((d) => !assignable.has(d));
    expect(bocor).toEqual([]);
  });

  it('DISPATCH_DIVISIONS adalah himpunan bagian BRIEF_ASSIGNABLE_DIVISIONS', () => {
    const assignable = new Set(BRIEF_ASSIGNABLE_DIVISIONS);
    const bocor = DISPATCH_DIVISIONS.filter((d) => !assignable.has(d));
    expect(bocor).toEqual([]);
  });

  it('divisi baru M16/M17/M18 terdaftar, bisa menerima Brief, dan punya kuota satuan', () => {
    // Store Operation ikut ber-kuota sejak M18 — sebelumnya sengaja tidak,
    // karena `wrr_aggregate` belum punya apa pun untuk dihitung dan rekap
    // mingguan akan melaporkan produksi 0 untuk divisi yang bekerja.
    // Pipeline tahapannya (LT-2) masih terbuka dan memang TIDAK dituntut oleh
    // flag mana pun di sini — dua hal berbeda yang mudah tertukar.
    expect(BRIEF_ASSIGNABLE_DIVISIONS).toContain('AI Optimizer');
    expect(BRIEF_ASSIGNABLE_DIVISIONS).toContain('Store Operation');
    expect(ALLOWED_DIVISIONS).toContain('AI Optimizer');
    expect(ALLOWED_DIVISIONS).toContain('Store Operation');
  });
});

/**
 * Jembatan katalog komitmen (Strategi) ↔ katalog baris kerja (Plan P-C).
 *
 * `PLAN_TASK_CATALOG` memakai `jenis` yang SAMA dengan `TASK_CATALOG` supaya
 * kuota yang dijanjikan di Strategi dan baris yang benar-benar direncanakan di
 * Plan bisa dijoin per `jenis` tanpa tabel pemetaan. Arahnya SATU: tiap jenis
 * komitmen harus punya rumah di Plan (kalau tidak, kuota itu tak bisa
 * direncanakan sama sekali) — tapi tidak sebaliknya, karena Plan sengaja
 * menawarkan lebih (`jam_live` dari M6A F-4, dan tiga pekerjaan Store Operation
 * yang belum punya pipeline `stage_definition`, DECISIONS.md LT-2).
 */
describe('TASK_CATALOG ↔ PLAN_TASK_CATALOG (jembatan `jenis`)', () => {
  it('setiap jenis komitmen Strategi bisa direncanakan sebagai baris Plan', () => {
    const hilang: string[] = [];
    for (const [nama, list] of Object.entries(TASK_CATALOG)) {
      const planJenis = new Set(plantask.jenisFor(nama).map((j) => j.jenis));
      for (const t of list) if (!planJenis.has(t.jenis)) hilang.push(`${nama}/${t.jenis}`);
    }
    expect(hilang).toEqual([]);
  });

  it('flag `money` sepakat di kedua katalog untuk jenis yang sama', () => {
    // Kalau hanya satu katalog menandainya Rupiah, satu form merender input
    // hitungan untuk angka miliaran dan yang lain input IDR.
    const beda: string[] = [];
    for (const [nama, list] of Object.entries(TASK_CATALOG)) {
      for (const t of list) {
        const p = plantask.jenisFor(nama).find((j) => j.jenis === t.jenis);
        if (p && (p.money === true) !== (t.money === true)) beda.push(`${nama}/${t.jenis}`);
      }
    }
    expect(beda).toEqual([]);
  });

  it('Store Operation kini punya KEDUA katalog, dan `jenis`-nya identik (M18)', () => {
    // Sampai M18 divisi ini sengaja hanya punya katalog Plan: `punyaKuotaSatuan`
    // menuntut entri TASK_CATALOG **dan** cabang `wrr_aggregate`, dan yang
    // terakhir mustahil sebelum ada tabel yang bisa dihitung (`store_ops_skus`).
    // Sekarang ketiganya terpasang, jadi yang dijaga di sini adalah bahwa kedua
    // katalog mengeja tiga `jenis` yang SAMA: kuota yang dijanjikan di Strategi
    // dijoin ke baris Plan lewat `jenis`, tanpa tabel pemetaan, jadi satu huruf
    // beda memutus join itu diam-diam.
    expect(plantask.punyaKatalog('Store Operation')).toBe(true);
    expect(ALLOWED_DIVISIONS).toContain('Store Operation');
    expect(TASK_CATALOG['Store Operation'].map((t) => t.jenis).sort()).toEqual(
      plantask.jenisFor('Store Operation').map((j) => j.jenis).sort(),
    );
    // Nol yang bertanda Rupiah: ketiganya hitungan (kasus/promo/konten), bukan
    // nominal seperti `ads_spent`.
    expect(TASK_CATALOG['Store Operation'].every((t) => t.money !== true)).toBe(true);
  });

  it('`punyaKuotaSatuan` tidak pernah menyala tanpa entri TASK_CATALOG-nya', () => {
    // Invariant, bukan pemeriksaan satu divisi: inilah kombinasi yang
    // meng-crash comparator `normalizeTasks` di `undefined`, dan ia akan
    // terulang pada divisi BERIKUTNYA kalau yang dijaga cuma Store Operation.
    const tanpaKatalog = ALLOWED_DIVISIONS.filter((d) => TASK_CATALOG[d] === undefined);
    expect(tanpaKatalog).toEqual([]);
  });
});
