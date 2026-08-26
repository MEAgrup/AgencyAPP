import { describe, expect, it } from 'vitest';
import { baselineDraftToBody, monthsWithData, type BaselineMonthDraft } from './SectionB';

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
