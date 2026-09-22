/**
 * CR-12 paritas — CSP dokumen laporan PDT (mode `klien` MAUPUN `internal`)
 * tidak boleh menyebut satu pun host eksternal, cermin persis
 * `client-portal/reports/[id]/html/report-csp.test.ts`. `render.ts` menempel
 * aset `docassets` yang SAMA yang sudah dibuktikan bersih di
 * `docassets.test.ts` — tes ini hanya memeriksa kebijakan yang route ini
 * BENAR-BENAR mengirim.
 */
import { describe, expect, it } from 'vitest';
import { docassets } from '@cdps/core';
import { LAPORAN_HTML_CSP } from './route';

const ARAHAN = (): Map<string, string[]> => new Map(
  LAPORAN_HTML_CSP.split(';').map((d) => {
    const [nama, ...nilai] = d.trim().split(/\s+/);
    return [nama, nilai] as [string, string[]];
  }),
);

describe('CSP dokumen laporan PDT — nol host eksternal', () => {
  it('tidak memuat skema atau host apa pun', () => {
    expect(LAPORAN_HTML_CSP).not.toMatch(/https?:/);
    expect(LAPORAN_HTML_CSP).not.toMatch(/\/\//);
  });

  it('setiap nilai arahan adalah kata kunci berkutip atau `data:`, bukan host', () => {
    for (const [nama, nilai] of ARAHAN()) {
      for (const v of nilai) {
        expect(/^('[a-z-]+'|data:)$/.test(v), `arahan ${nama} memuat sumber non-kata-kunci: ${v}`).toBe(true);
      }
    }
  });

  it('tetap menutup permukaan yang memang harus tertutup', () => {
    const d = ARAHAN();
    expect(d.get('default-src')).toEqual(["'none'"]);
    expect(d.get('connect-src')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'none'"]);
    expect(d.get('frame-ancestors')).toEqual(["'self'"]);
    expect(d.get('script-src')).toEqual(["'unsafe-inline'"]);
    expect(d.get('style-src')).toEqual(["'unsafe-inline'"]);
    expect(d.has('font-src')).toBe(false);
  });
});
