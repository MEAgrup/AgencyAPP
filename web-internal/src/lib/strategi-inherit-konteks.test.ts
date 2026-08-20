import { describe, expect, it } from 'vitest';
import { INHERITED_KONTEKS_FIELDS, inheritedKonteksOf, type StrategiPrefill } from './strategi';

/** A prefill carrying the six §3.A items plus one unrelated suggestion. */
function prefill(items: StrategiPrefill['items']): StrategiPrefill {
  return {
    interview_id: 'ITV-202608-0001',
    verdict: 'growth_ready',
    unlocked: true,
    flags: [],
    copy_prasyarat_ke_c7: false,
    wajib_catatan_mitigasi: false,
    items,
  };
}

const item = (interview_field: string, strategi_field: string, nilai: string) => ({
  interview_field,
  strategi_field,
  nilai,
  catatan: null,
});

describe('inheritedKonteksOf (QA §3.A read-only Section A)', () => {
  it('maps each moved field, splitting A-1 into brand (B2-1) and client kategori', () => {
    const p = prefill([
      item('B2-1', 'A-1', 'AlphaGlow'),
      item('klien.kategori', 'A-1', 'Home Living'),
      item('B3-1', 'A-5', 'awet\ngaransi\nharga jujur'),
      item('B1-8', 'A-8', 'Bandung'),
      item('B1-9', 'A-10', 'agensi lama gagal di listing'),
      item('B7-5', 'A-12', 'Owner (Rani)'),
      item('B2-8', 'A-3', '55'), // unrelated — must be ignored
    ]);
    const k = inheritedKonteksOf(p);
    expect(k.namaBrand).toBe('AlphaGlow');
    expect(k.kategori).toBe('Home Living');
    expect(k.usp).toContain('garansi');
    expect(k.titikKirim).toBe('Bandung');
    expect(k.riwayatAgensi).toContain('listing');
    expect(k.decisionMaker).toBe('Owner (Rani)');
  });

  it('returns all-null for a null prefill (client has no scored interview)', () => {
    const k = inheritedKonteksOf(null);
    expect(k).toEqual({
      namaBrand: null,
      kategori: null,
      usp: null,
      titikKirim: null,
      riwayatAgensi: null,
      decisionMaker: null,
    });
  });

  it('takes kategori from the client even when brand (B2-1) is absent', () => {
    const k = inheritedKonteksOf(prefill([item('klien.kategori', 'A-1', 'Home Living')]));
    expect(k.namaBrand).toBeNull();
    expect(k.kategori).toBe('Home Living');
  });

  it('lists exactly the five fields that became read-only', () => {
    expect([...INHERITED_KONTEKS_FIELDS]).toEqual(['A-1', 'A-5', 'A-8', 'A-10', 'A-12']);
  });
});
