import { describe, expect, it } from 'vitest';
import {
  INTERVIEW_FIELDS,
  buildAnswersPayload,
  buildScoreInput,
  draftFromDetail,
  emptyDraft,
  estimasiTanpaDasar,
  fieldsOfSection,
  minorToRupiah,
  previewKualifikasi,
  rupiahToMinor,
  toScoreWire,
  type InterviewDraft,
} from './interview-fields';
import { SUMBER_ANGKA, VERDICT } from './interview-scoring';
import type { InterviewDetail } from './interview';

/** A fully-answered draft equivalent to the core "perfect" fixture (score 100). */
function perfectDraft(): InterviewDraft {
  const d = emptyDraft();
  d['B1-4'] = { raw: 'produsen' };
  d['B1-5'] = { raw: '1000000', sumber: SUMBER_ANGKA.KlienHitung, dasar: '' }; // Rp1.000.000
  d['B2-7'] = { raw: '35', sumber: SUMBER_ANGKA.KlienHitung, dasar: '' };
  d['B2-8'] = { raw: '45' };
  d['B2-9'] = { raw: '150000', sumber: SUMBER_ANGKA.KlienHitung, dasar: '' }; // Rp150.000
  d['B2-3'] = { raw: '30', sumber: SUMBER_ANGKA.KlienHitung, dasar: '' };
  d['B2-10'] = { raw: 'pembeda_jelas' };
  d['B2-11'] = { raw: 'habis_pakai' };
  d['B2-13'] = { raw: 'sanggup' };
  d['B3-3'] = { raw: 'masih_ada_ruang' };
  d['B4-9'] = { raw: 'tim_khusus' };
  d['B6-3'] = { raw: '2000000', sumber: SUMBER_ANGKA.KlienHitung, dasar: '' }; // 2x
  d['B6-5'] = { raw: 'ge_6_bulan' };
  d['B7-3'] = { raw: 'penuh' };
  d['B7-6'] = { raw: 'satu_orang_jelas' };
  return d;
}

describe('rupiah ↔ minor units', () => {
  it('converts rupiah to minor units (×100)', () => {
    expect(rupiahToMinor('150000')).toBe(15_000_000n);
    expect(rupiahToMinor('1.000.000')).toBe(100_000_000n);
    expect(rupiahToMinor('')).toBeNull();
    expect(rupiahToMinor('abc')).toBeNull();
  });
  it('round-trips minor → rupiah', () => {
    expect(minorToRupiah(15_000_000n)).toBe('150000');
    expect(minorToRupiah('100000000.00')).toBe('1000000');
    expect(minorToRupiah(null)).toBe('');
  });
});

describe('previewKualifikasi — same scorer as submit', () => {
  it('scores a complete draft to growth_ready 100', () => {
    const r = previewKualifikasi(perfectDraft());
    expect(r.ready).toBe(true);
    expect(r.hasil?.skorTotal).toBe(100);
    expect(r.hasil?.verdict).toBe(VERDICT.GrowthReady);
    expect(r.missing).toEqual([]);
  });
  it('reports missing scored fields on an empty draft', () => {
    const r = previewKualifikasi(emptyDraft());
    expect(r.ready).toBe(false);
    expect(r.hasil).toBeNull();
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.missing.some((m) => m.fieldKey === 'B1-4')).toBe(true);
  });
  it('derives net margin from gross when B2-7 sumber = dari_margin_kotor', () => {
    const d = perfectDraft();
    d['B2-7'] = { raw: '', sumber: SUMBER_ANGKA.DariMarginKotor, dasar: '' };
    d['B2-8'] = { raw: '45' };
    d['B2-7a'] = { raw: '10' };
    d['B2-7b'] = { raw: '5' };
    const r = previewKualifikasi(d);
    expect(r.ready).toBe(true);
    // net = 45 - 10 - 5 = 30 → margin band 9 points
    expect(r.hasil?.marginBersih).toBe(30);
  });
});

describe('buildScoreInput → toScoreWire', () => {
  it('emits minor-unit money strings and canonical enum codes', () => {
    const { input } = buildScoreInput(perfectDraft());
    expect(input).not.toBeNull();
    const wire = toScoreWire(input!);
    expect(wire.aov).toBe('15000000');
    expect(wire.omzet).toBe('100000000');
    expect(wire.model_bisnis).toBe('produsen');
    expect(wire.daya_tahan_budget).toBe('ge_6_bulan');
  });
});

describe('buildAnswersPayload', () => {
  it('sends only filled fields, money as minor units', () => {
    const rows = buildAnswersPayload(perfectDraft());
    const b19 = rows.find((r) => r.field_key === 'B2-9');
    expect(b19?.nilai_uang).toBe('15000000');
    const b14 = rows.find((r) => r.field_key === 'B1-4');
    expect(b14?.nilai_enum).toBe('produsen');
    // B7-9 (prasyarat) is blank → not sent
    expect(rows.find((r) => r.field_key === 'B7-9')).toBeUndefined();
  });
  it('holds back a baseless estimate (would 400) and reports it', () => {
    const d = emptyDraft();
    d['B1-5'] = { raw: '1000000', sumber: SUMBER_ANGKA.EstimasiAm, dasar: '' };
    const rows = buildAnswersPayload(d);
    expect(rows.find((r) => r.field_key === 'B1-5')).toBeUndefined();
    expect(estimasiTanpaDasar(d)).toContain('B1-5');
  });
  it('sends an estimate once it has a basis, with dasar_estimasi', () => {
    const d = emptyDraft();
    d['B1-5'] = { raw: '1000000', sumber: SUMBER_ANGKA.EstimasiAm, dasar: 'rata-rata 3 bulan dari screenshot' };
    const rows = buildAnswersPayload(d);
    const row = rows.find((r) => r.field_key === 'B1-5');
    expect(row?.sumber_angka).toBe('estimasi_am');
    expect(row?.dasar_estimasi).toBe('rata-rata 3 bulan dari screenshot');
  });
});

describe('draftFromDetail', () => {
  it('rebuilds the form from loaded answers (money minor → rupiah)', () => {
    const detail: InterviewDetail = {
      interview: { id: 'ITV-202608-0001', status: 'Draft Isian' } as InterviewDetail['interview'],
      riset_awal: null,
      jadwal: null,
      kualifikasi: null,
      answers: [
        { section: 'B2', field_key: 'B2-9', nilai_teks: null, nilai_angka: null, nilai_uang: '15000000', nilai_bool: null, nilai_enum: null, nilai_jsonb: null, sumber_angka: 'klien_hitung', dasar_estimasi: null },
        { section: 'B1', field_key: 'B1-4', nilai_teks: null, nilai_angka: null, nilai_uang: null, nilai_bool: null, nilai_enum: 'produsen', nilai_jsonb: null, sumber_angka: null, dasar_estimasi: null },
        { section: 'B7', field_key: 'B7-9', nilai_teks: 'kirim katalog produk', nilai_angka: null, nilai_uang: null, nilai_bool: null, nilai_enum: null, nilai_jsonb: null, sumber_angka: null, dasar_estimasi: null },
      ],
    };
    const d = draftFromDetail(detail);
    expect(d['B2-9'].raw).toBe('150000');
    expect(d['B2-9'].sumber).toBe('klien_hitung');
    expect(d['B1-4'].raw).toBe('produsen');
    expect(d['B7-9'].raw).toBe('kirim katalog produk');
  });
});

describe('Section A fields captured in the Interview form (QA §3.A 2026-08-20)', () => {
  const MOVED = [
    { key: 'B2-1', section: 'B2' }, // → A-1 brand & kategori
    { key: 'B3-1', section: 'B3' }, // → A-5 USP
    { key: 'B1-8', section: 'B1' }, // → A-8 titik kirim (fulfillment)
    { key: 'B1-9', section: 'B1' }, // → A-10 riwayat agensi
    { key: 'B7-1', section: 'B7' }, // → A-14 aset dari klien
    { key: 'B7-5', section: 'B7' }, // → A-12 decision maker
  ] as const;

  it('registers all six moved fields, in wired sections, as non-scored free text', () => {
    for (const { key, section } of MOVED) {
      const f = INTERVIEW_FIELDS.find((x) => x.fieldKey === key);
      expect(f, `missing ${key}`).toBeTruthy();
      expect(f!.section).toBe(section);
      expect(f!.scored).toBe(false); // must never enter the scorer
      expect(f!.tipe).toBe('teks');
      // Reachable from the section renderer the page uses.
      expect(fieldsOfSection(section).some((x) => x.fieldKey === key)).toBe(true);
    }
  });

  it('does not disturb the qualification score (fields are non-scored)', () => {
    // A perfect draft still scores 100 even with the new fields present in the
    // catalog: the scorer only reads SCORED_FIELD_KEYS.
    const r = previewKualifikasi(perfectDraft());
    expect(r.ready).toBe(true);
    expect(r.hasil?.skorTotal).toBe(100);
  });

  it('sends each moved field as a teks answer row', () => {
    const d = emptyDraft();
    d['B2-1'] = { raw: 'AlphaGlow · Home Living' };
    const payload = buildAnswersPayload(d);
    const row = payload.find((p) => p.field_key === 'B2-1');
    expect(row).toBeTruthy();
    expect(row!.section).toBe('B2');
    expect(row!.nilai_teks).toBe('AlphaGlow · Home Living');
    expect(row!.nilai_angka).toBeNull();
  });
});
