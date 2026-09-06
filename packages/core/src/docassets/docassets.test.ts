/**
 * CR-12 — aset dokumen laporan.
 *
 * Tes paling penting di berkas ini adalah yang TERAKHIR: "nol permintaan
 * keluar". Seluruh tiket ini beralasan hanya kalau klaim itu benar, dan klaim
 * itu harus dibuktikan **dari keluaran renderer**, bukan dipercaya dari niat
 * penulisnya. Sebuah `<link>` yang lolos masuk lagi enam bulan lagi tidak akan
 * memerahkan tes lain mana pun.
 *
 * Paritas KELAS CSS ada di berkas terpisah, `css-parity.test.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ATRIBUSI_IKON, CHART_JS, CHART_JS_SHA256, CHART_JS_VERSI, DOC_CSS, FONT_JUDUL, FONT_TUBUH, ICON_NAMES, ICON_SVG, ikon } from './index';
import { renderReportHtml as renderTt } from '../report/render';
import { renderReportHtml as renderSh } from '../report/shopee/render';
import { renderReportHtml as renderAs } from '../adsscanner/tiktok/render';
import {
  payloadAdsScanner, payloadShopeeMinimal, payloadShopeePenuh, payloadTiktokMinimal, payloadTiktokPenuh,
} from './parity-fixtures';

const SUMBER_RENDERER = ['../report/render.ts', '../report/shopee/render.ts', '../adsscanner/tiktok/render.ts'];
const bacaSumber = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ── ikon ────────────────────────────────────────────────────────────────────
describe('icons — SVG ditempel', () => {
  it('setiap nama ikon yang DIPAKAI renderer terdaftar di ICON_SVG', () => {
    // Daftarnya diturunkan dari SUMBER, bukan disalin ke dalam tes. Daftar yang
    // diketik ulang akan jadi basi diam-diam begitu ada ikon baru dipakai —
    // persis kegagalan yang tes ini ada untuk mencegahnya.
    const dipakai = new Set<string>();
    for (const rel of SUMBER_RENDERER) {
      for (const m of bacaSumber(rel).matchAll(/'(fa-[a-z0-9-]+)'/g)) dipakai.add(m[1]);
    }
    expect(dipakai.size, 'renderer harus menyebut setidaknya belasan ikon').toBeGreaterThan(15);
    const takTerdaftar = [...dipakai].filter((n) => !(n in ICON_SVG)).sort();
    expect(takTerdaftar, 'ikon dipakai renderer tapi tidak ada di ICON_SVG').toEqual([]);
  });

  it('setiap entri punya path dan viewBox dengan lebar aslinya', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(27);
    for (const n of ICON_NAMES) {
      const svg = ICON_SVG[n];
      expect(svg, n).toMatch(/^<svg class="fa-ico" viewBox="0 0 \d+ 512"/);
      expect(svg, n).toContain('fill="currentColor"');
      expect(svg, n).toMatch(/<path d="[^"]{40,}"\/><\/svg>$/);
    }
  });

  it('lebar viewBox TIDAK diseragamkan — Font Awesome memang bervariasi', () => {
    const lebar = new Set(ICON_NAMES.map((n) => ICON_SVG[n].match(/viewBox="0 0 (\d+) 512"/)![1]));
    // Kalau ini menyusut jadi satu nilai, seseorang memaksa `0 0 512 512` dan
    // `fa-users` (640) sekarang terpotong di setiap laporan.
    expect(lebar.size).toBeGreaterThan(1);
    expect([...lebar]).toContain('640');
    expect([...lebar]).toContain('384');
  });

  it('ikon tak dikenal MELEMPAR — tidak merender kotak kosong diam-diam', () => {
    expect(() => ikon('fa-tidak-ada' as never)).toThrow(/tidak terdaftar di ICON_SVG/);
  });

  it('kelas tambahan disisipkan ke atribut class, bukan menimpanya', () => {
    expect(ikon('fa-store', 'mr-1 text-teal-600')).toContain('class="fa-ico mr-1 text-teal-600"');
    expect(ikon('fa-store')).toContain('class="fa-ico"');
  });

  it('atribusi CC BY 4.0 menyebut Font Awesome dan lisensinya', () => {
    expect(ATRIBUSI_IKON).toMatch(/Font Awesome/);
    expect(ATRIBUSI_IKON).toMatch(/CC BY 4\.0/);
  });
});

// ── Chart.js ────────────────────────────────────────────────────────────────
describe('chartjs — pustaka ditempel', () => {
  it('berisi Chart.js dengan banner versi yang dikunci', () => {
    expect(CHART_JS.length).toBeGreaterThan(150_000);
    expect(CHART_JS_VERSI).toBe('4.4.0');
    expect(CHART_JS).toContain(`Chart.js v${CHART_JS_VERSI}`);
    expect(CHART_JS).toContain('Released under the MIT License');
  });

  it('sha256-nya cocok dengan yang tercatat — berkas GENERATED tidak disunting', () => {
    // Ini yang mengubah "seseorang menyunting berkas generated" jadi tes merah,
    // bukan misteri chart yang berperilaku aneh berbulan-bulan kemudian.
    expect(createHash('sha256').update(CHART_JS, 'utf8').digest('hex')).toBe(CHART_JS_SHA256);
  });

  it('tidak bisa menutup tag <script> yang membungkusnya', () => {
    expect(CHART_JS.toLowerCase()).not.toContain('</script');
  });

  it('acuan sourceMappingURL yang menggantung sudah dibuang', () => {
    expect(CHART_JS).not.toContain('sourceMappingURL');
  });
});

// ── font ────────────────────────────────────────────────────────────────────
describe('css — font sistem, bukan Google Fonts', () => {
  it('tumpukan font tidak menyebut Inter/Poppins', () => {
    expect(FONT_TUBUH).not.toMatch(/Inter|Poppins/);
    expect(FONT_JUDUL).not.toMatch(/Inter|Poppins/);
    expect(FONT_TUBUH).toContain('system-ui');
  });

  it('DOC_CSS memasang aturan cetak yang mempertahankan warna', () => {
    // Tanpa ini seluruh warna kartu, badge, dan cincin skor hilang di PDF.
    expect(DOC_CSS).toContain('print-color-adjust:exact');
    expect(DOC_CSS).toContain('@media print');
    expect(DOC_CSS).toMatch(/\.no-print\{display:none!important\}/);
    expect(DOC_CSS).toContain('break-inside:avoid');
  });
});

// ── inti CR-12 ──────────────────────────────────────────────────────────────
const DOKUMEN: [string, () => string][] = [
  ['tiktok penuh — klien', () => renderTt(payloadTiktokPenuh(), 'klien')],
  ['tiktok penuh — internal', () => renderTt(payloadTiktokPenuh(), 'internal')],
  ['tiktok minimal — klien', () => renderTt(payloadTiktokMinimal(), 'klien')],
  ['tiktok minimal — internal', () => renderTt(payloadTiktokMinimal(), 'internal')],
  ['shopee penuh — klien', () => renderSh(payloadShopeePenuh(), 'klien')],
  ['shopee penuh — internal', () => renderSh(payloadShopeePenuh(), 'internal')],
  ['shopee minimal — klien', () => renderSh(payloadShopeeMinimal(), 'klien')],
  ['shopee minimal — internal', () => renderSh(payloadShopeeMinimal(), 'internal')],
  ['adsscanner', () => renderAs(payloadAdsScanner())],
];

describe('NOL PERMINTAAN KELUAR — inti CR-12', () => {
  for (const [label, render] of DOKUMEN) {
    describe(label, () => {
      const html = render();

      it('nol atribut sumber daya yang menunjuk ke jaringan', () => {
        // `src=`/`href=` adalah satu-satunya cara HTML memuat sumber daya luar,
        // dan `//host` (protocol-relative) ikut dihitung.
        const jahat = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)]
          .map((m) => m[1])
          .filter((v) => /^(https?:)?\/\//i.test(v));
        expect(jahat, `atribut yang menarik dari jaringan (${label})`).toEqual([]);
      });

      it('nol @import dan nol url(http…) di CSS', () => {
        expect(html).not.toContain('@import');
        expect(html).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//i);
      });

      it('nol jejak kelima CDN yang dipakai sebelum CR-12', () => {
        for (const host of ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com']) {
          expect(html.includes(host), `${host} masih dirujuk (${label})`).toBe(false);
        }
      });

      it('nol sisa pustaka html2pdf', () => {
        expect(html).not.toContain('html2pdf');
      });

      it('nol <i class="fa-…"> — semua ikon sudah jadi SVG inline', () => {
        expect(html).not.toMatch(/<i\s[^>]*class="[^"]*fa-/);
      });
    });
  }

  it('renderer TikTok & Shopee benar-benar menempelkan Chart.js dan stylesheet-nya', () => {
    for (const html of [renderTt(payloadTiktokPenuh(), 'klien'), renderSh(payloadShopeePenuh(), 'klien')]) {
      expect(html).toContain('Chart.js v4.4.0');
      expect(html).toContain('.badge-int{');
      // Bootstrap chart tetap dijalankan setelah pustakanya ada.
      expect(html).toContain('window.CHART_DATA=');
    }
  });

  it('adsscanner menempelkan stylesheet tapi TIDAK menempelkan Chart.js', () => {
    // Nol chart di renderer ini — menempelkan 200KB pustaka yang tidak dipakai
    // adalah ongkos murni.
    const html = renderAs(payloadAdsScanner());
    expect(html).toContain('.badge-int{');
    expect(html).not.toContain('Chart.js v4.4.0');
  });

  it('tombol PDF memakai Print browser dan tidak bisa menghilang sendiri', () => {
    const html = renderTt(payloadTiktokPenuh(), 'klien');
    expect(html).toContain('Unduh PDF (Ctrl+P)');
    expect(html).toContain('window.print()');
    // `PDF_BOOT` menyembunyikan tombolnya saat pustakanya gagal termuat; itulah
    // mode gagal yang CR-12 hapus.
    expect(html).not.toContain("b.style.display='none'");
  });

  it('nama berkas PDF tetap dipakai, termasuk penanda internal', () => {
    expect(renderTt(payloadTiktokPenuh(), 'klien')).toContain('REPORT_PDF_NAME');
    expect(renderTt(payloadTiktokPenuh(), 'internal')).toContain('-INTERNAL');
    expect(renderTt(payloadTiktokPenuh(), 'klien')).not.toContain('-INTERNAL');
  });

  it('atribusi ikon ikut DIRENDER di dokumen, bukan cuma ada di repo', () => {
    // CC BY 4.0 menuntut atribusi pada karya yang diedarkan.
    for (const html of [renderTt(payloadTiktokPenuh(), 'klien'), renderSh(payloadShopeePenuh(), 'klien')]) {
      expect(html).toContain('Font Awesome');
      expect(html).toContain('CC BY 4.0');
    }
  });

  it('nol URL http di SUMBER ketiga renderer', () => {
    // Jaring terakhir: sebuah tag CDN baru yang ditambahkan besok tertangkap di
    // sini bahkan kalau fixture-nya kebetulan tidak melewatinya.
    for (const rel of SUMBER_RENDERER) {
      const src = bacaSumber(rel);
      expect(src, `${rel} memuat URL http`).not.toMatch(/https?:\/\//);
    }
  });
});
