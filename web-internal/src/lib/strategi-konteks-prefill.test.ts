/**
 * A-2 (model bisnis) + A-3 (margin kotor) dari Interview — QA pemilik
 * 2026-09-20 pada CLI-202609-0021: "A-2/A-4 SEHARUSNYA SUDAH TERISI DARI
 * INTERVIEW (case klien test 2 saya isi manual)".
 *
 * A-4 sengaja TIDAK ada di sini: Interview tidak punya sumbernya sama sekali
 * (lihat komentar di `PREFILL_MAPPING`), jadi ia tetap manual.
 */
import { describe, expect, it } from 'vitest';
import {
  konteksPrefillTerisi,
  mergeKonteksPrefill,
  type StrategiPrefill,
} from './strategi';

function prefill(items: { strategi_field: string; nilai: string }[]): StrategiPrefill {
  return {
    interview_id: 'IVW-202609-0001',
    verdict: 'lolos',
    unlocked: true,
    flags: [],
    copy_prasyarat_ke_c7: false,
    wajib_catatan_mitigasi: false,
    items: items.map((i) => ({ interview_field: 'B?', catatan: null, ...i })),
  };
}

const kosong = { model_bisnis: '', margin_kotor_persen: '' };

describe('mergeKonteksPrefill', () => {
  it('mengisi A-2 dan A-3 saat draft kosong', () => {
    const out = mergeKonteksPrefill(kosong, prefill([
      { strategi_field: 'A-2', nilai: 'distributor_resmi' },
      { strategi_field: 'A-3', nilai: '32.5' },
    ]));
    expect(out.model_bisnis).toBe('distributor_resmi');
    expect(out.margin_kotor_persen).toBe('32.5');
  });

  it('menerima keenam nilai kosakata Interview apa adanya (A2-MODEL-BISNIS-6)', () => {
    for (const v of [
      'produsen',
      'brand_owner',
      'importir_langsung',
      'distributor_resmi',
      'reseller',
      'dropship',
    ]) {
      const out = mergeKonteksPrefill(kosong, prefill([{ strategi_field: 'A-2', nilai: v }]));
      expect(out.model_bisnis).toBe(v);
    }
  });

  it('TIDAK pernah menimpa nilai yang sudah diketik AM', () => {
    const diketik = { model_bisnis: 'reseller', margin_kotor_persen: '11' };
    const out = mergeKonteksPrefill(diketik, prefill([
      { strategi_field: 'A-2', nilai: 'produsen' },
      { strategi_field: 'A-3', nilai: '99' },
    ]));
    expect(out).toEqual(diketik);
  });

  it('melewati nilai A-2 di luar kosakata, bukan menulisnya', () => {
    const out = mergeKonteksPrefill(kosong, prefill([
      { strategi_field: 'A-2', nilai: 'franchise_baru' },
    ]));
    expect(out.model_bisnis).toBe('');
  });

  it('melewati A-3 non-numerik', () => {
    const out = mergeKonteksPrefill(kosong, prefill([
      { strategi_field: 'A-3', nilai: 'sekitar 30an' },
    ]));
    expect(out.margin_kotor_persen).toBe('');
  });

  it('melewati item kosong / hanya spasi', () => {
    const out = mergeKonteksPrefill(kosong, prefill([
      { strategi_field: 'A-2', nilai: '   ' },
      { strategi_field: 'A-3', nilai: '' },
    ]));
    expect(out).toEqual(kosong);
  });

  it('mengembalikan objek yang SAMA bila tidak ada yang berubah', () => {
    expect(mergeKonteksPrefill(kosong, null)).toBe(kosong);
    expect(mergeKonteksPrefill(kosong, prefill([]))).toBe(kosong);
  });

  it('mengisi satu field walau field lain tidak punya usulan', () => {
    const out = mergeKonteksPrefill(kosong, prefill([{ strategi_field: 'A-3', nilai: '40' }]));
    expect(out.model_bisnis).toBe('');
    expect(out.margin_kotor_persen).toBe('40');
  });

  it('A-3 nol adalah angka sah, bukan "kosong"', () => {
    const out = mergeKonteksPrefill(kosong, prefill([{ strategi_field: 'A-3', nilai: '0' }]));
    expect(out.margin_kotor_persen).toBe('0');
  });
});

describe('konteksPrefillTerisi', () => {
  it('menandai field yang nilainya memang dari Interview', () => {
    const p = prefill([
      { strategi_field: 'A-2', nilai: 'produsen' },
      { strategi_field: 'A-3', nilai: '32.5' },
    ]);
    expect(konteksPrefillTerisi(mergeKonteksPrefill(kosong, p), p)).toEqual({ a2: true, a3: true });
  });

  it('tidak menandai field yang sudah diubah AM menjauh dari usulan', () => {
    const p = prefill([{ strategi_field: 'A-2', nilai: 'produsen' }]);
    const diubah = { model_bisnis: 'reseller', margin_kotor_persen: '' };
    expect(konteksPrefillTerisi(diubah, p)).toEqual({ a2: false, a3: false });
  });

  it('tidak menandai apa pun tanpa prefill', () => {
    expect(konteksPrefillTerisi({ model_bisnis: 'produsen', margin_kotor_persen: '5' }, null))
      .toEqual({ a2: false, a3: false });
  });

  it('tidak menandai field kosong walau usulannya ada', () => {
    const p = prefill([{ strategi_field: 'A-2', nilai: 'produsen' }]);
    expect(konteksPrefillTerisi(kosong, p)).toEqual({ a2: false, a3: false });
  });
});
