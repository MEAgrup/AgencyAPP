/**
 * CR-12 §3.8 — CSP dokumen laporan portal klien tidak boleh menyebut satu pun
 * host eksternal.
 *
 * Kenapa ini tes tersendiri, bukan catatan di review: sebelum CR-12 kebijakan
 * ini meng-allow-list empat host CDN karena dokumennya memang menariknya.
 * Setelah CR-12 dokumennya tidak menarik apa pun. Kalau allow-list-nya
 * ditinggalkan, CSP-nya BERBOHONG tentang kebutuhan dokumen ini — dan celahnya
 * tetap terbuka, jadi sebuah tag CDN yang lolos masuk lagi besok akan tetap
 * berfungsi diam-diam alih-alih diblokir.
 *
 * Dua sisi yang diperiksa di sini:
 *   (a) kebijakan yang BENAR-BENAR dikirim route ini tidak memuat host mana pun;
 *   (b) aset yang ditempel ke dokumen memang tidak meminta apa pun dari jaringan.
 *
 * Bukti sisi keluaran yang lengkap — HTML jadi, tiga renderer, dua mode — ada di
 * `packages/core/src/docassets/docassets.test.ts`, tempat rendering-nya tinggal.
 */
import { describe, expect, it } from 'vitest';
import { docassets } from '@cdps/core';
import { REPORT_CSP_HEADER } from './route';

const ARAHAN = (): Map<string, string[]> => new Map(
  REPORT_CSP_HEADER.split(';').map((d) => {
    const [nama, ...nilai] = d.trim().split(/\s+/);
    return [nama, nilai] as [string, string[]];
  }),
);

describe('CSP dokumen laporan — nol host eksternal', () => {
  it('tidak memuat skema atau host apa pun', () => {
    expect(REPORT_CSP_HEADER).not.toMatch(/https?:/);
    expect(REPORT_CSP_HEADER).not.toMatch(/\/\//);
  });

  it('tidak menyebut satu pun dari empat CDN yang dipakai sebelum CR-12', () => {
    for (const host of ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
      expect(REPORT_CSP_HEADER.includes(host), `${host} masih di allow-list`).toBe(false);
    }
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
    // Halaman Portal membingkai endpoint ini di origin yang sama; pihak ketiga
    // tidak boleh.
    expect(d.get('frame-ancestors')).toEqual(["'self'"]);
    // Inline diperlukan justru KARENA aset-asetnya ditempel.
    expect(d.get('script-src')).toEqual(["'unsafe-inline'"]);
    expect(d.get('style-src')).toEqual(["'unsafe-inline'"]);
    // Font eksternal sudah tidak ada, jadi arahan `font-src` pun tidak perlu.
    expect(d.has('font-src')).toBe(false);
  });
});

describe('aset yang ditempel memang tidak meminta apa pun dari jaringan', () => {
  it('DOC_CSS nol @import dan nol url(http…)', () => {
    expect(docassets.DOC_CSS).not.toContain('@import');
    expect(docassets.DOC_CSS).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//i);
    // Nama font Google yang lama tidak boleh tertinggal: tanpa `<link>`-nya ia
    // hanya nama yang tidak berarti apa-apa, dan menyamarkan bahwa fallback-nya
    // yang sebenarnya dipakai.
    expect(docassets.DOC_CSS).not.toMatch(/Inter|Poppins/);
  });

  it('Chart.js yang ditempel tidak memuat sumber daya lain saat dijalankan', () => {
    // Banner lisensinya memang menyebut chartjs.org — itu komentar, bukan
    // pengambilan. Yang dilarang adalah pemuat sungguhan.
    expect(docassets.CHART_JS).not.toMatch(/importScripts|document\.createElement\(['"]script/);
    expect(docassets.CHART_JS).not.toContain('sourceMappingURL');
  });

  it('setiap ikon adalah SVG mandiri — nol <image>, nol href eksternal', () => {
    for (const nama of docassets.ICON_NAMES) {
      const svg = docassets.ICON_SVG[nama];
      expect(svg, nama).not.toMatch(/https?:/);
      expect(svg, nama).not.toMatch(/<image|xlink:href/);
    }
  });
});
