import { describe, expect, it } from 'vitest';
import {
  MSG_PDT_INSIGHT_ADA_MARKUP,
  MSG_PDT_INSIGHT_INDIKATOR_TAK_LENGKAP,
  MSG_PDT_INSIGHT_INDIKATOR_TERLALU_BANYAK,
  MSG_PDT_INSIGHT_OUTLOOK_WAJIB,
  MSG_PDT_INSIGHT_POIN_KOSONG,
  MSG_PDT_INSIGHT_POIN_TERLALU_BANYAK,
  MSG_PDT_INSIGHT_REK_TAK_LENGKAP,
  MSG_PDT_INSIGHT_REK_TERLALU_BANYAK,
  MSG_PDT_INSIGHT_RINGKASAN_WAJIB,
  msgPdtInsightTerlaluPanjang,
  normalizePdtInsightDraft,
  PdtInsightDraftError,
  PDT_INSIGHT_MAX,
  type PdtInsightDraft,
} from './insight-edit';

const VALID: PdtInsightDraft = {
  ringkasan: '  GMV naik 12% bulan ini.  ',
  poin: ['Poin pertama.', '  ', 'Poin kedua.'],
  rekomendasi_tinggi: [{ judul: 'Audit iklan', target: 'ROAS ≥5x', dampak: 'Hemat budget', timeline: '1 minggu' }],
  rekomendasi_sedang: [],
  outlook: 'Target bulan depan naik 20%.',
  indikator: [{ nama: 'Target CVR', target: '2%' }],
};

describe('normalizePdtInsightDraft (G2-01-INSIGHT-EDIT)', () => {
  it('draf valid ⇒ trim + baris kosong dibuang, urutan dipertahankan', () => {
    expect(normalizePdtInsightDraft(VALID)).toEqual({
      ringkasan: 'GMV naik 12% bulan ini.',
      poin: ['Poin pertama.', 'Poin kedua.'],
      rekomendasiTinggi: [{ judul: 'Audit iklan', target: 'ROAS ≥5x', dampak: 'Hemat budget', timeline: '1 minggu' }],
      rekomendasiSedang: [],
      outlook: 'Target bulan depan naik 20%.',
      indikator: [{ nama: 'Target CVR', target: '2%' }],
    });
  });

  it('ringkasan kosong/hanya spasi ⇒ ditolak', () => {
    expect(() => normalizePdtInsightDraft({ ...VALID, ringkasan: '   ' })).toThrow(MSG_PDT_INSIGHT_RINGKASAN_WAJIB);
    expect(() => normalizePdtInsightDraft({ ...VALID, ringkasan: undefined })).toThrow(PdtInsightDraftError);
  });

  it('outlook kosong ⇒ ditolak', () => {
    expect(() => normalizePdtInsightDraft({ ...VALID, outlook: '' })).toThrow(MSG_PDT_INSIGHT_OUTLOOK_WAJIB);
  });

  it('poin seluruhnya kosong/hilang ⇒ ditolak (minimal satu)', () => {
    expect(() => normalizePdtInsightDraft({ ...VALID, poin: ['', '  '] })).toThrow(MSG_PDT_INSIGHT_POIN_KOSONG);
    expect(() => normalizePdtInsightDraft({ ...VALID, poin: undefined })).toThrow(MSG_PDT_INSIGHT_POIN_KOSONG);
  });

  it('poin lebih dari 15 ⇒ ditolak', () => {
    const poin = Array.from({ length: 16 }, (_, i) => `Poin ${i}`);
    expect(() => normalizePdtInsightDraft({ ...VALID, poin })).toThrow(MSG_PDT_INSIGHT_POIN_TERLALU_BANYAK);
  });

  it('rekomendasi kosong sepenuhnya (baris cadangan) ⇒ dibuang, bukan ditolak', () => {
    const hasil = normalizePdtInsightDraft({
      ...VALID,
      rekomendasi_tinggi: [{ judul: '', target: '', dampak: '', timeline: '' }],
    });
    expect(hasil.rekomendasiTinggi).toEqual([]);
  });

  it('rekomendasi terisi sebagian ⇒ ditolak (tidak actionable)', () => {
    expect(() => normalizePdtInsightDraft({
      ...VALID,
      rekomendasi_tinggi: [{ judul: 'Audit iklan', target: '', dampak: 'Hemat budget', timeline: '1 minggu' }],
    })).toThrow(MSG_PDT_INSIGHT_REK_TAK_LENGKAP);
  });

  it('rekomendasi lebih dari 8 per prioritas ⇒ ditolak', () => {
    const rek = Array.from({ length: 9 }, (_, i) => ({ judul: `J${i}`, target: 'T', dampak: 'D', timeline: '1 minggu' }));
    expect(() => normalizePdtInsightDraft({ ...VALID, rekomendasi_tinggi: rek })).toThrow(MSG_PDT_INSIGHT_REK_TERLALU_BANYAK);
  });

  it('indikator terisi sebagian ⇒ ditolak', () => {
    expect(() => normalizePdtInsightDraft({ ...VALID, indikator: [{ nama: 'X', target: '' }] })).toThrow(MSG_PDT_INSIGHT_INDIKATOR_TAK_LENGKAP);
  });

  it('indikator kosong sepenuhnya ⇒ dibuang', () => {
    const hasil = normalizePdtInsightDraft({ ...VALID, indikator: [{ nama: '', target: '' }] });
    expect(hasil.indikator).toEqual([]);
  });

  it('indikator lebih dari 8 ⇒ ditolak', () => {
    const ind = Array.from({ length: 9 }, (_, i) => ({ nama: `N${i}`, target: 'T' }));
    expect(() => normalizePdtInsightDraft({ ...VALID, indikator: ind })).toThrow(MSG_PDT_INSIGHT_INDIKATOR_TERLALU_BANYAK);
  });

  it('tag HTML sungguhan di teks mana pun ⇒ ditolak', () => {
    expect(() => normalizePdtInsightDraft({ ...VALID, ringkasan: 'GMV <script>naik</script>' })).toThrow(MSG_PDT_INSIGHT_ADA_MARKUP);
    expect(() => normalizePdtInsightDraft({ ...VALID, poin: ['Poin <b>tebal</b>'] })).toThrow(MSG_PDT_INSIGHT_ADA_MARKUP);
  });

  it('simbol pembanding polos (bukan tag) ⇒ diizinkan (docs/DECISIONS.md 2026-09-25 "PDT-INSIGHT-BANDING-VS-TAG")', () => {
    const hasil = normalizePdtInsightDraft({
      ...VALID,
      ringkasan: 'ROAS > 4 dan cancel rate < 5% periode ini.',
      poin: ['CVR turun, 1 < 2'],
    });
    expect(hasil.ringkasan).toBe('ROAS > 4 dan cancel rate < 5% periode ini.');
    expect(hasil.poin).toEqual(['CVR turun, 1 < 2']);
  });

  it('teks melebihi batas karakter ⇒ ditolak dengan pesan menyebut label+batas', () => {
    const panjang = 'x'.repeat(PDT_INSIGHT_MAX.ringkasan + 1);
    expect(() => normalizePdtInsightDraft({ ...VALID, ringkasan: panjang }))
      .toThrow(msgPdtInsightTerlaluPanjang('ringkasan eksekutif', PDT_INSIGHT_MAX.ringkasan));
  });

  it('field bukan array (mis. string tunggal) diperlakukan sebagai array kosong, bukan error tak terduga', () => {
    const hasil = normalizePdtInsightDraft({ ...VALID, indikator: 'bukan-array' });
    expect(hasil.indikator).toEqual([]);
  });
});
