/**
 * PENJAGA CR-12 — setiap kelas yang dirender harus punya definisi di `DOC_CSS`.
 *
 * Sebelum CR-12 tata letak dokumen laporan dikompilasi DI BROWSER KLIEN oleh
 * Tailwind play CDN: apa pun kelas yang dipancarkan renderer, Tailwind menyusun
 * aturannya on the fly. Setelah CR-12 stylesheet-nya statis, dan konsekuensinya
 * langsung: kelas yang tidak punya aturan di `DOC_CSS` **tidak melakukan
 * apa-apa** — nol galat, nol peringatan, hanya kartu yang kehilangan
 * bantalannya atau badge yang kehilangan warnanya, di berkas yang sudah
 * dikirim AM ke klien.
 *
 * Itu adalah bug VISUAL SENYAP. Tes ini mengubahnya jadi tes MERAH. Alasan dan
 * polanya sama persis dengan `route-parity.test.ts` dan `shape-parity.test.ts`:
 * dua sisi yang wajib cocok, dicocokkan oleh mesin, bukan oleh ingatan.
 *
 * DUA JARING, bukan satu:
 *
 *   1. **Render** seluruh fixture ketiga renderer di kedua mode, lalu tarik
 *      setiap token dari setiap `class="…"`. Ini satu-satunya cara menangkap
 *      kelas yang DISUSUN saat jalan — `bg-${warna}-50`, `text-${warna(skor)}-700`,
 *      `md:grid-cols-${cols}`, `status-${cls}`, `GATE_CLS[...]`,
 *      `BUCKET_META[...].cls`, `FLAG_WARNA[...]` — yang tidak akan pernah
 *      terlihat oleh pembacaan sumber.
 *
 *   2. **Pindai sumber** ketiga renderer untuk setiap token literal di dalam
 *      `class="…"`. Ini menangkap seksi yang KEBETULAN tidak dilewati fixture
 *      mana pun (cabang kosong, banner peringatan yang butuh data langka).
 *      Fixture bisa punya lubang; sumber tidak.
 *
 * Keduanya perlu: jaring 1 tidak lengkap terhadap kode, jaring 2 buta terhadap
 * kelas dinamis.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOC_CSS } from './css';
import { renderReportHtml as renderTt } from '../report/render';
import { renderReportHtml as renderSh } from '../report/shopee/render';
import { renderReportHtml as renderAs } from '../adsscanner/tiktok/render';
import {
  assertPadat, payloadAdsScanner, payloadShopeeBersih, payloadShopeeMinimal, payloadShopeePenuh,
  payloadTiktokMinimal, payloadTiktokPenuh, payloadTiktokPraR3,
} from './parity-fixtures';

// ── membaca DOC_CSS ─────────────────────────────────────────────────────────

/**
 * Nama kelas yang PUNYA aturan di sebuah stylesheet.
 *
 * Blok deklarasi dilewati (`{ … }` isinya bukan selektor) dan komentar dibuang
 * lebih dulu — kalau tidak, komentar yang kebetulan menyebut `.kpi-card` akan
 * terhitung sebagai definisi dan tes ini berbohong ke arah yang salah.
 *
 * Karakter yang di-escape di selektor CSS dikembalikan: `.md\:p-6` → `md:p-6`,
 * `.text-\[10px\]` → `text-[10px]`, `.mb-0\.5` → `mb-0.5`.
 */
export function kelasTerdefinisi(css: string): Set<string> {
  const tanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Kumpulkan hanya teks yang berada TEPAT sebelum `{` — itulah selektornya.
  const selektor: string[] = [];
  let buf = '';
  for (const ch of tanpaKomentar) {
    if (ch === '{') { selektor.push(buf); buf = ''; }
    else if (ch === '}') { buf = ''; }
    else buf += ch;
  }
  const out = new Set<string>();
  for (const s of selektor) {
    for (const m of s.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) {
      out.add(m[1].replace(/\\(.)/g, '$1'));
    }
  }
  return out;
}

/** Token kelas yang benar-benar dirender. `<script>`/`<style>` dibuang lebih
 *  dulu: Chart.js yang ditempel dan DOC_CSS sendiri bukan markup. */
function kelasDipakai(html: string): Set<string> {
  const markup = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');
  const out = new Set<string>();
  for (const m of markup.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t) out.add(t);
  }
  return out;
}

const DEF = kelasTerdefinisi(DOC_CSS);

// ── dokumen yang diperiksa ──────────────────────────────────────────────────
const DOKUMEN: [string, () => string, number][] = [
  ['tiktok penuh — klien', () => renderTt(payloadTiktokPenuh(), 'klien'), 120],
  ['tiktok penuh — internal', () => renderTt(payloadTiktokPenuh(), 'internal'), 120],
  ['tiktok minimal — klien', () => renderTt(payloadTiktokMinimal(), 'klien'), 60],
  ['tiktok minimal — internal', () => renderTt(payloadTiktokMinimal(), 'internal'), 60],
  ['tiktok pra-R3 — klien', () => renderTt(payloadTiktokPraR3(), 'klien'), 100],
  ['shopee penuh — klien', () => renderSh(payloadShopeePenuh(), 'klien'), 90],
  ['shopee penuh — internal', () => renderSh(payloadShopeePenuh(), 'internal'), 90],
  ['shopee kesehatan bersih — klien', () => renderSh(payloadShopeeBersih(), 'klien'), 90],
  ['shopee minimal — internal', () => renderSh(payloadShopeeMinimal(), 'internal'), 50],
  ['adsscanner', () => renderAs(payloadAdsScanner()), 30],
];

describe('css-parity — jaring 1: kelas yang DIRENDER', () => {
  for (const [label, render, minToken] of DOKUMEN) {
    it(`${label}: setiap kelas punya aturan di DOC_CSS`, () => {
      const html = render();
      // Fixture yang membusuk jadi halaman kosong akan membuat tes ini hijau
      // tanpa memeriksa apa pun. Ini yang mencegahnya.
      assertPadat(html, minToken, label);
      const hilang = [...kelasDipakai(html)].filter((k) => !DEF.has(k)).sort();
      expect(hilang, `kelas tanpa aturan di DOC_CSS (${label})`).toEqual([]);
    });
  }
});

/** Penanda "di sini ada interpolasi". Bukan spasi: `bg-${warna}-50` adalah SATU
 *  token yang dinamis, dan menggantinya dengan spasi akan memecahnya jadi dua
 *  potongan palsu (`bg-` dan `-50`) yang tidak pernah jadi nama kelas apa pun. */
const TANDA = '\u0000';

/**
 * Ganti setiap `${…}` (kurung berimbang) di sebuah nilai atribut sumber TS
 * dengan `TANDA`, sisakan bagian literalnya apa adanya.
 *
 * Perlu berimbang, bukan `/\$\{[^}]*\}/`: isi interpolasi di renderer memuat
 * kurung kurawal sendiri (`${align[i] === 'r' ? 'text-right' : 'text-left'}`,
 * `${FLAG_WARNA[f.flag] ?? ''}`), jadi pencocokan non-serakah yang berhenti di
 * `}` pertama akan memuntahkan potongan kode sebagai "nama kelas".
 */
export function tandaiInterpolasi(nilai: string): string {
  let out = '';
  for (let i = 0; i < nilai.length; i++) {
    if (nilai[i] === '$' && nilai[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < nilai.length && depth > 0) {
        if (nilai[i] === '{') depth++;
        else if (nilai[i] === '}') depth--;
        i++;
      }
      i--;
      out += TANDA;
    } else out += nilai[i];
  }
  return out;
}

describe('css-parity — jaring 2: kelas LITERAL di sumber renderer', () => {
  const SUMBER = ['../report/render.ts', '../report/shopee/render.ts', '../adsscanner/tiktok/render.ts'];

  it('setiap token literal di class="…" punya aturan di DOC_CSS', () => {
    const hilang = new Set<string>();
    for (const rel of SUMBER) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      for (const m of src.matchAll(/class="([^"]*)"/g)) {
        // Bagian yang diinterpolasi diserahkan ke jaring 1 — bentuk sumbernya
        // (`bg-${warna}-50`) memang bukan nama kelas.
        for (const t of tandaiInterpolasi(m[1]).split(/\s+/)) {
          // Token yang MEMUAT interpolasi bukan nama kelas — jaring 1 yang
          // memeriksa bentuk jadinya.
          if (!t || t.includes(TANDA)) continue;
          if (!DEF.has(t)) hilang.add(t);
        }
      }
    }
    expect([...hilang].sort(), 'kelas literal di sumber renderer tanpa aturan di DOC_CSS').toEqual([]);
  });

  const literalSaja = (v: string): string[] =>
    tandaiInterpolasi(v).split(/\s+/).filter((t) => t && !t.includes(TANDA));

  it('penanda interpolasi menangani kurung bersarang di dalamnya', () => {
    expect(literalSaja("bg-white ${a[i] === 'r' ? 'x' : 'y'} p-4")).toEqual(['bg-white', 'p-4']);
    expect(literalSaja("${FLAG_WARNA[f.flag] ?? ''}")).toEqual([]);
    expect(literalSaja('a ${b} c ${d} e')).toEqual(['a', 'c', 'e']);
  });

  it('token yang MEMUAT interpolasi tidak dipecah jadi potongan palsu', () => {
    // Ini yang membuat `bg-${warna}-50` tidak pernah dilaporkan sebagai dua
    // "kelas hilang" bernama `bg-` dan `-50`.
    expect(literalSaja('bg-${warna}-50 md:grid-cols-${cols} p-4')).toEqual(['p-4']);
  });
});

describe('css-parity — penjaganya sendiri terbukti MENGGIGIT', () => {
  /**
   * Sebuah tes paritas yang tidak pernah bisa merah tidak menjaga apa pun.
   * Di sini satu aturan dicabut dari salinan `DOC_CSS`, lalu pemeriksaan yang
   * PERSIS SAMA dijalankan ulang — dan harus menemukan kelas itu hilang.
   */
  it('mencabut satu aturan dari DOC_CSS membuat pemeriksaan gagal', () => {
    const aturan = '.badge-int{background:#EEF2FF;color:#4338CA;font-size:.65rem;padding:1px 6px;border-radius:99px;font-weight:700}';
    expect(DOC_CSS, 'aturan acuan harus ada persis seperti tertulis').toContain(aturan);

    const rusak = kelasTerdefinisi(DOC_CSS.replace(aturan, ''));
    expect(rusak.has('badge-int'), 'setelah dicabut, badge-int tidak boleh terdefinisi').toBe(false);
    expect(DEF.has('badge-int'), 'sebelum dicabut, badge-int terdefinisi').toBe(true);

    // Dan pemeriksaan yang sama pada dokumen nyata memang jadi merah.
    const html = renderTt(payloadTiktokPenuh(), 'internal');
    const hilang = [...kelasDipakai(html)].filter((k) => !rusak.has(k));
    expect(hilang).toContain('badge-int');
  });

  it('kelas karangan yang tidak ada di DOC_CSS memang terdeteksi hilang', () => {
    const html = '<div class="bg-white kelas-yang-tidak-pernah-ada"></div>';
    const hilang = [...kelasDipakai(html)].filter((k) => !DEF.has(k));
    expect(hilang).toEqual(['kelas-yang-tidak-pernah-ada']);
  });

  it('pembaca DOC_CSS tidak menganggap komentar sebagai definisi', () => {
    const css = '/* .kelas-di-komentar hanyalah teks */ .kelas-asli{color:red}';
    const def = kelasTerdefinisi(css);
    expect(def.has('kelas-asli')).toBe(true);
    expect(def.has('kelas-di-komentar')).toBe(false);
  });

  it('pembaca DOC_CSS tidak menganggap isi deklarasi sebagai definisi', () => {
    // `.5rem` di dalam blok deklarasi bukan nama kelas.
    const def = kelasTerdefinisi('.nyata{padding:.5rem;border-radius:.75rem}');
    expect(def.has('nyata')).toBe(true);
    expect(def.has('5rem')).toBe(false);
  });

  it('escape selektor CSS dibaca kembali jadi nama kelas aslinya', () => {
    const def = kelasTerdefinisi('.md\\:grid-cols-4{x:y}.text-\\[10px\\]{x:y}.mb-0\\.5{x:y}.last\\:border-0:last-child{x:y}');
    expect([...def].sort()).toEqual(['last:border-0', 'mb-0.5', 'md:grid-cols-4', 'text-[10px]']);
  });
});
