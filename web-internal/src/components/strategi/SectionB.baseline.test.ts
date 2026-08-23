import { describe, expect, it } from 'vitest';
import { baselineDraftToBody, type BaselineMonthDraft } from './SectionB';

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
