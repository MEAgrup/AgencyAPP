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
 * Inilah alasan registry punya TIGA flag, bukan satu: Store Operation boleh
 * menerima Brief dan jadi tujuan dispatch, tapi `punyaKuotaSatuan` sengaja
 * `false` sampai `TASK_CATALOG` punya barisnya (DECISIONS.md LT-2).
 */
import { describe, expect, it } from 'vitest';
import { division } from '@cdps/core';
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

  it('divisi baru M16/M17 terdaftar dan bisa menerima Brief', () => {
    // Store Operation sengaja TANPA kuota satuan — pipeline & daftar
    // pekerjaannya menyusul (DECISIONS.md LT-2).
    expect(BRIEF_ASSIGNABLE_DIVISIONS).toContain('AI Optimizer');
    expect(BRIEF_ASSIGNABLE_DIVISIONS).toContain('Store Operation');
    expect(ALLOWED_DIVISIONS).toContain('AI Optimizer');
    expect(ALLOWED_DIVISIONS).not.toContain('Store Operation');
  });
});
