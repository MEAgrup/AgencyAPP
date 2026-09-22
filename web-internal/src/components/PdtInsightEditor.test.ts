/**
 * Editor insight kiriman PDT (C-04) — logika murninya.
 *
 * Yang diuji: konversi bolak-balik `PdtLaporanInsightRow` (server) ↔
 * `PdtInsightDraft` (form), terutama `tahap_narasi` (`null` di server, string
 * kosong di textarea) — satu-satunya field yang bentuknya berbeda di dua sisi.
 */
import { describe, expect, it } from 'vitest';
import { draftFromRow, draftToPayload, type PdtInsightDraft } from './PdtInsightEditor';
import type { PdtLaporanInsightRow } from '@/lib/pdt';

const row = (over: Partial<PdtLaporanInsightRow> = {}): PdtLaporanInsightRow => ({
  kiriman_id: 1,
  revisi: 2,
  sumber: 'am',
  ringkasan: 'GMV naik 12% bulan ini.',
  poin: ['CVR membaik', 'Iklan efisien'],
  rekomendasi_tinggi: [{ judul: 'Naikkan budget live', target: '+20% GMV live', dampak: 'GMV', timeline: '2 minggu' }],
  rekomendasi_sedang: [],
  outlook: 'Bulan depan diperkirakan stabil.',
  indikator: [{ nama: 'ROAS', target: '>5x' }],
  tahap_narasi: null,
  ditulis_oleh: 'ZZ-AM',
  ditulis_pada: '2026-09-22T00:00:00Z',
  ...over,
});

describe('draftFromRow', () => {
  it('menyalin keenam field narasi apa adanya', () => {
    const r = row();
    const d = draftFromRow(r);
    expect(d.ringkasan).toBe(r.ringkasan);
    expect(d.poin).toEqual(r.poin);
    expect(d.rekomendasi_tinggi).toEqual(r.rekomendasi_tinggi);
    expect(d.rekomendasi_sedang).toEqual(r.rekomendasi_sedang);
    expect(d.outlook).toBe(r.outlook);
    expect(d.indikator).toEqual(r.indikator);
  });

  it('tahap_narasi null (server) menjadi string kosong (textarea)', () => {
    expect(draftFromRow(row({ tahap_narasi: null })).tahap_narasi).toBe('');
  });

  it('tahap_narasi terisi dibawa apa adanya', () => {
    expect(draftFromRow(row({ tahap_narasi: 'Awareness naik lewat live.' })).tahap_narasi)
      .toBe('Awareness naik lewat live.');
  });
});

describe('draftToPayload', () => {
  const draft = (over: Partial<PdtInsightDraft> = {}): PdtInsightDraft => ({
    ringkasan: 'Ringkasan',
    poin: ['A'],
    rekomendasi_tinggi: [],
    rekomendasi_sedang: [],
    outlook: 'Outlook',
    indikator: [],
    tahap_narasi: '',
    ...over,
  });

  it('membawa ketujuh field ke body PUT .../insight', () => {
    const p = draftToPayload(draft({ tahap_narasi: 'Catatan tahap.' }));
    expect(p).toEqual({
      ringkasan: 'Ringkasan',
      poin: ['A'],
      rekomendasi_tinggi: [],
      rekomendasi_sedang: [],
      outlook: 'Outlook',
      indikator: [],
      tahap_narasi: 'Catatan tahap.',
    });
  });

  it('bolak-balik draftFromRow → draftToPayload mempertahankan tahap_narasi kosong sebagai string kosong (server yang membuang, bukan FE)', () => {
    const r = row({ tahap_narasi: null });
    const p = draftToPayload(draftFromRow(r));
    expect(p.tahap_narasi).toBe('');
  });
});
