import { describe, expect, it } from 'vitest';
import {
  baselineDraftToBody,
  monthsWithData,
  provenanceInherited,
  type BaselineMonthDraft,
} from './SectionB';

// Regression for the Section B "isian lengkap tapi tak bisa disimpan" bug: the
// form built baseline rows with a 0-based month_index while the DB CHECK is
// `ck_strbl_month BETWEEN 1 AND 6` and `normalizeBaseline` refuses `< 1`. A
// first-month row (index 0) therefore made the whole Section B save throw
// `[data tidak lengkap …]`. The wire body must carry the 1-based index verbatim.
describe('baselineDraftToBody (month_index is 1-based on the wire)', () => {
  const row = (monthIndex: number): BaselineMonthDraft => ({
    month_index: monthIndex,
    gmv: '20000000',
    jumlah_pesanan: '1000',
    persen_batal: '4',
    ad_spend: '5000000',
    roas: '0',
    acos: '20',
  });

  it('keeps a first-month row at index 1, not 0 (DB CHECK BETWEEN 1 AND 6)', () => {
    const [body] = baselineDraftToBody([row(1)]);
    expect(body.month_index).toBe(1);
  });

  it('carries a full window through in order', () => {
    const body = baselineDraftToBody([row(1), row(2), row(3)]);
    expect(body.map((m) => m.month_index)).toEqual([1, 2, 3]);
  });

  it('treats a real 0 as an answer, not a blank', () => {
    const [body] = baselineDraftToBody([row(1)]);
    expect(body.roas).toBe(0); // ROAS 0 stays 0, never dropped or coerced to null
  });
});

// Regression for the "Baseline kosong padahal sudah diisi tools AM Copilot /
// AM Baseline" bug (STRG-202608-0001, owner report 2026-08-26): page.tsx used
// to only send a baseline month whose SIX fields were all non-blank. A
// prefill tool that can only derive part of a month — e.g. AM Baseline /
// Video Factory reading a TikTok Shop export, which has `gmv` and
// `jumlah_pesanan` but no `ad_spend`/`roas`/`acos` to offer — left the month
// short of that bar, so the whole row was silently dropped on save. D-2's
// "Hitung stretch dari Baseline" then had nothing to compute from, and the AM
// saw an empty baseline they had already filled once.
describe('monthsWithData (a month with ANY figure typed is sent, not just fully-filled ones)', () => {
  const blank = (monthIndex: number): BaselineMonthDraft => ({
    month_index: monthIndex,
    gmv: '',
    jumlah_pesanan: '',
    persen_batal: '',
    ad_spend: '',
    roas: '',
    acos: '',
  });

  it('keeps a month the AM Baseline tool only partially filled (gmv + jumlah_pesanan, rest blank)', () => {
    const partial: BaselineMonthDraft = {
      ...blank(1),
      gmv: '20000000',
      jumlah_pesanan: '1000',
    };
    expect(monthsWithData([partial])).toEqual([partial]);
  });

  it('drops a month nobody has touched at all', () => {
    expect(monthsWithData([blank(1)])).toEqual([]);
  });

  it('keeps a month where the only figure typed is a real 0', () => {
    const zeroOnly: BaselineMonthDraft = { ...blank(1), roas: '0' };
    expect(monthsWithData([zeroOnly])).toEqual([zeroOnly]);
  });

  it('a partially-filled month defaults its untouched fields to 0 on the wire', () => {
    const partial: BaselineMonthDraft = {
      ...blank(1),
      gmv: '20000000',
      jumlah_pesanan: '1000',
    };
    const [body] = baselineDraftToBody(monthsWithData([partial]));
    expect(body).toEqual({
      month_index: 1,
      gmv: '20000000',
      jumlah_pesanan: 1000,
      persen_batal: 0,
      ad_spend: '0',
      roas: 0,
      acos: 0,
    });
  });
});

// Regression for feedback B4 (AM Lela, Linda Hijab CLI-202609-0038 /
// SVC-202609-0048): B-0.6 locked BOTH provenance fields as soon as a Riset Awal
// suggestion existed. A PDT-sourced baseline carries `sumber_data: null` (no
// `riset_awal_sumber_berkas`), so "Sumber data" rendered blank AND read-only and
// the submit gate B-0.6/<channel> (MSG_BASELINE_WINDOW_REQUIRED) could never be
// met. The lock is now per field: only a field the suggestion actually fills.
describe('provenanceInherited (B-0.6 lock is per field, not per suggestion)', () => {
  it('PDT suggestion with null sumber_data: Sumber data editable, filled tanggal stays locked', () => {
    const lock = provenanceInherited({ sumber_data: null, tanggal_ambil_data: '2026-10-02' });
    expect(lock.sumber).toBe(false);
    expect(lock.tanggal).toBe(true);
  });

  it('blank / whitespace values do not lock either', () => {
    expect(provenanceInherited({ sumber_data: '  ', tanggal_ambil_data: '' })).toEqual({
      sumber: false,
      tanggal: false,
    });
  });

  it('a filled sumber_data with a null tanggal locks only Sumber data', () => {
    expect(
      provenanceInherited({ sumber_data: 'export_shopee.xlsx', tanggal_ambil_data: null }),
    ).toEqual({ sumber: true, tanggal: false });
  });

  it('both filled → both inherited read-only (RAB-19 unchanged)', () => {
    expect(
      provenanceInherited({ sumber_data: 'export_shopee.xlsx', tanggal_ambil_data: '2026-10-02' }),
    ).toEqual({ sumber: true, tanggal: true });
  });

  it('no suggestion → nothing locked', () => {
    expect(provenanceInherited(null)).toEqual({ sumber: false, tanggal: false });
  });
});
