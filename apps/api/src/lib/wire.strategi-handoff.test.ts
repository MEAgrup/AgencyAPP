/**
 * M6A langkah 8 — the Interview → Strategi handoff wire contract.
 *
 * The bug this guards against was concrete: `POST /services/{id}/strategi`
 * accepted a body but `strategiHeaderFromWire` never read `interview_id`, so the
 * FE's handoff field was silently dropped — the page got a 200 and a Strategi
 * with no link, no flags, no prefill. This asserts the key is now carried
 * through to the domain input, and that its absence still means "manual".
 *
 * The row shape below is what `web-internal/src/lib/strategi.ts` builds for the
 * "Buka Strategi" button — copied deliberately (web-internal is outside this
 * workspace), so a rename on either side surfaces here.
 */
import { describe, expect, it } from 'vitest';
import { strategiHeaderFromWire } from './wire';

const HEADER_BODY = {
  durasi_kontrak_bulan: 6,
  tanggal_mulai_kontrak: '2026-08-12',
  tanggal_akhir_kontrak: '2027-02-11',
  tanggal_mulai_siklus: '2026-08-12',
};

describe('strategiHeaderFromWire — interview_id (M6A langkah 8)', () => {
  it('carries interview_id from the wire body to the domain input', () => {
    const input = strategiHeaderFromWire({ ...HEADER_BODY, interview_id: 'ITV-202608-0007' });
    expect(input.interviewId).toBe('ITV-202608-0007');
  });

  it('a body without interview_id is a manual create (interviewId null)', () => {
    expect(strategiHeaderFromWire(HEADER_BODY).interviewId).toBeNull();
  });

  it('treats an empty-string / null interview_id as manual, not as a lookup for ""', () => {
    expect(strategiHeaderFromWire({ ...HEADER_BODY, interview_id: '' }).interviewId).toBeNull();
    expect(strategiHeaderFromWire({ ...HEADER_BODY, interview_id: null }).interviewId).toBeNull();
  });

  it('still parses the contract window alongside the handoff id', () => {
    const input = strategiHeaderFromWire({ ...HEADER_BODY, interview_id: 'ITV-202608-0007' });
    expect(input.durasiKontrakBulan).toBe(6);
    expect(input.tanggalMulaiKontrak).toBe('2026-08-12');
    expect(input.tanggalAkhirKontrak).toBe('2027-02-11');
  });
});
