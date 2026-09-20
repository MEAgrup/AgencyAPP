/**
 * Tautan-dalam Upload PDT — aturan yang gagalnya SENYAP.
 *
 * Yang diuji di sini bukan pembentukan string URL-nya (itu sepele), melainkan
 * dua pertanyaan yang, kalau dijawab salah, membuat halaman Upload PDT
 * menyiapkan unggahan untuk toko/klien yang BUKAN yang tertulis di tautan,
 * tanpa satu pun pesan di layar:
 *
 *  1. Apakah klien yang diminta punya `<option>` yang cocok? (kalau tidak,
 *     `<select>` menampilkan "— pilih klien —" sementara state memegang ID-nya)
 *  2. Apakah toko yang diminta benar-benar ada di daftar toko PDT klien itu?
 *     (kalau tidak, ia harus DIBUANG — bukan diberi opsi bayangan, karena
 *     server akan menolaknya setelah ZIP terlanjur diunggah)
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PARAM_KLIEN,
  PARAM_PLATFORM,
  PDT_UPLOAD_PATH,
  bacaParamKlien,
  bacaParamPlatform,
  butuhOpsiBayanganKlien,
  labelKlienPdt,
  opsiKlienPdt,
  pdtUploadHref,
  jalurKembaliAman,
  bacaParamKembali,
  platformDipakai,
  type PdtClientRow,
} from './pdt-deeplink';

const KLIEN: PdtClientRow[] = [
  { id: 'CLI-202609-0020', toko: 'Toko Uji PDT' },
  { id: 'CLI-202609-0017', toko: 'Salad Hut' },
];

/** Bungkus `URLSearchParams` jadi bentuk yang `bacaParam*` terima (`useSearchParams().get`). */
const getter = (qs: string) => {
  const sp = new URLSearchParams(qs);
  return (k: string) => sp.get(k);
};

describe('pdtUploadHref', () => {
  it('menulis klien, dan toko bila diketahui', () => {
    expect(pdtUploadHref('CLI-202609-0020', 56)).toBe(
      `${PDT_UPLOAD_PATH}?${PARAM_KLIEN}=CLI-202609-0020&${PARAM_PLATFORM}=56`,
    );
  });

  it('tanpa toko tetap tautan yang sah — pemanggil sering hanya tahu kliennya', () => {
    expect(pdtUploadHref('CLI-202609-0020')).toBe(`${PDT_UPLOAD_PATH}?${PARAM_KLIEN}=CLI-202609-0020`);
    expect(pdtUploadHref('CLI-202609-0020', null)).toBe(`${PDT_UPLOAD_PATH}?${PARAM_KLIEN}=CLI-202609-0020`);
  });

  it('id toko yang tidak masuk akal tidak ikut ditulis', () => {
    for (const buruk of [0, -3, 1.5, Number.NaN]) {
      expect(pdtUploadHref('CLI-202609-0020', buruk)).toBe(`${PDT_UPLOAD_PATH}?${PARAM_KLIEN}=CLI-202609-0020`);
    }
  });

  it('klien kosong ⇒ halaman polos, bukan `?client=`', () => {
    expect(pdtUploadHref('')).toBe(PDT_UPLOAD_PATH);
    expect(pdtUploadHref('   ')).toBe(PDT_UPLOAD_PATH);
  });

  it('bolak-balik: apa yang ditulis, terbaca kembali', () => {
    const href = pdtUploadHref('CLI-202609-0020', 56);
    const get = getter(href.split('?')[1]);
    expect(bacaParamKlien(get)).toBe('CLI-202609-0020');
    expect(bacaParamPlatform(get)).toBe(56);
  });
});

describe('bacaParamPlatform', () => {
  it('menerima bilangan bulat positif', () => {
    expect(bacaParamPlatform(getter('platform=56'))).toBe(56);
    expect(bacaParamPlatform(getter('platform= 56 '))).toBe(56);
  });

  it('menolak yang bukan angka, nol, negatif, dan pecahan', () => {
    // `Number('')` = 0 dan `Number('12abc')` = NaN — keduanya HARUS jatuh ke
    // null, bukan ke angka yang lolos ke `riwayatBatchPdt`.
    for (const qs of ['platform=', 'platform=0', 'platform=-3', 'platform=1.5', 'platform=abc', 'platform=12abc', '']) {
      expect(bacaParamPlatform(getter(qs)), qs).toBeNull();
    }
  });
});

describe('bacaParamKlien', () => {
  it('kosong bila tidak ada parameternya', () => {
    expect(bacaParamKlien(getter(''))).toBe('');
    expect(bacaParamKlien(getter('client=   '))).toBe('');
  });
});

describe('opsi klien', () => {
  it('klien di luar daftar mendapat opsi bayangan — tanpa itu pilihannya senyap hilang', () => {
    expect(butuhOpsiBayanganKlien('CLI-202601-0001', KLIEN)).toBe(true);
    const opsi = opsiKlienPdt('CLI-202601-0001', KLIEN, { loading: false });
    expect(opsi.map((o) => o.value)).toContain('CLI-202601-0001');
    expect(opsi[1].label).toContain('di luar daftar');
  });

  it('klien yang ada di daftar tidak digandakan', () => {
    expect(butuhOpsiBayanganKlien('CLI-202609-0020', KLIEN)).toBe(false);
    const opsi = opsiKlienPdt('CLI-202609-0020', KLIEN, { loading: false });
    expect(opsi.filter((o) => o.value === 'CLI-202609-0020')).toHaveLength(1);
    expect(opsi.map((o) => o.label)).toContain(labelKlienPdt(KLIEN[0]));
  });

  it('"belum memilih" bukan kasus bayangan', () => {
    expect(butuhOpsiBayanganKlien('', KLIEN)).toBe(false);
    expect(opsiKlienPdt('', KLIEN, { loading: false })[0].label).toBe('— pilih klien —');
    expect(opsiKlienPdt('', [], { loading: true })[0].label).toBe('Memuat klien…');
  });
});

describe('platformDipakai', () => {
  const OPSI = [{ client_platform_id: 56 }, { client_platform_id: 57 }];

  it('memakai toko yang memang ada di daftar', () => {
    expect(platformDipakai(56, OPSI)).toBe(56);
  });

  it('MEMBUANG toko di luar daftar — tidak ada opsi bayangan untuk toko', () => {
    // Toko tidak aktif / bukan platform PDT / milik klien lain. Menerimanya di
    // sini hanya memindahkan penolakan server ke setelah ZIP diunggah.
    expect(platformDipakai(99, OPSI)).toBeNull();
    expect(platformDipakai(56, [])).toBeNull();
  });

  it('tanpa parameter tetap tanpa pilihan', () => {
    expect(platformDipakai(null, OPSI)).toBeNull();
  });
});

/**
 * Pemasangannya, bukan cuma aturannya.
 *
 * Kedua ujung tautan ini bisa dicabut tanpa satu pun tes lain memerah:
 * halaman Upload PDT berhenti membaca parameternya, atau Section B berhenti
 * merender panelnya — dan yang tersisa cuma halaman yang tampak baik-baik
 * saja. Itu persis bentuk kegagalan O78 (dua paruh yang benar, kontrak yang
 * tidak terpasang), jadi ia di-assert seperti di sana.
 */
describe('tautan STRG → Upload PDT benar-benar terpasang di kedua ujung', () => {
  const ROOT = resolve(__dirname, '..', '..');
  const baca = (...bagian: string[]) => readFileSync(join(ROOT, 'src', ...bagian), 'utf8');

  it('panelnya dirender di SECTION A, bersama sumber-sumber lain — bukan di Section B', () => {
    const src = baca('app', '(shell)', 'account', 'strategi', '[id]', 'page.tsx');
    expect(src).toContain('<PdtUploadPanel');

    // Section A adalah rumah semua SUMBER yang mengisi Strategi (Interview,
    // Video Factory). Panel PDT sempat mendarat di Section B karena di situlah
    // field-nya; pemilik menolaknya 2026-09-19 — AM baru menemukan PDT sesudah
    // terlanjur mengetik baseline dengan tangan, dan PDT butuh unggah + batch
    // verified + muat ulang, jadi "terlambat" di sini berarti pekerjaan
    // terbuang. Posisinya dijaga di sini karena memindahkannya balik tidak
    // memerahkan satu pun tes lain.
    // Penanda blok RENDER-nya, bukan `active === 'A'` telanjang — string itu
    // muncul lebih dulu di dispatcher penyimpanan, dan mengambil kecocokan
    // pertama membuat tes ini mengukur bagian file yang salah.
    const iA = src.indexOf("{active === 'A' && (");
    const iB = src.indexOf("{active === 'B' && (");
    expect(iA, "blok render Section A tidak ditemukan").toBeGreaterThan(-1);
    expect(iB, "blok render Section B tidak ditemukan").toBeGreaterThan(iA);

    const blokA = src.slice(iA, iB);
    expect(blokA, 'PdtUploadPanel tidak ada di blok render Section A').toContain('<PdtUploadPanel');
    // Tetangganya, dan alasan posisinya: keduanya sumber, keduanya di Section A.
    expect(blokA).toContain('<VideoFactoryImportPanel');
    expect(src.slice(iB), 'PdtUploadPanel masih tertinggal di Section B').not.toContain('<PdtUploadPanel');

    // `{baselinePrefill && <PdtUploadPanel …>}` akan menyembunyikan panel tepat
    // pada klien yang paling butuh tautannya (belum punya riset awal/PDT).
    expect(src).not.toMatch(/baselinePrefill\s*&&\s*<PdtUploadPanel/);
  });

  it('panelnya menautkan ke halaman Upload PDT lewat pembangun tautan, bukan string tangan', () => {
    const src = baca('components', 'strategi', 'PdtUploadPanel.tsx');
    expect(src).toContain('pdtUploadHref');
    expect(src).not.toContain("'/account/pdt/upload'");
  });

  it('halaman Upload PDT membaca kedua parameter dan memvalidasi tokonya', () => {
    const src = baca('app', '(shell)', 'account', 'pdt', 'upload', 'page.tsx');
    expect(src).toContain('bacaParamKlien');
    expect(src).toContain('bacaParamPlatform');
    // Tanpa `platformDipakai`, `?platform=` di luar daftar akan masuk ke state
    // diam-diam: layar menunjukkan "— pilih platform —", `siapkanUploadBatchPdt`
    // memakai ID-nya.
    expect(src).toContain('platformDipakai');
    // Tanpa opsi bayangan, `?client=` di luar scope hilang dari layar tapi
    // tetap dipegang state.
    expect(src).toContain('opsiKlienPdt');
    // `useSearchParams` menuntut batas <Suspense> saat prerender.
    expect(src).toContain('<Suspense');
  });
});

describe('jalurKembaliAman (G1-KEMBALI — gerbang open-redirect)', () => {
  it('menerima jalur internal absolut', () => {
    expect(jalurKembaliAman('/account')).toBe('/account');
    expect(jalurKembaliAman('/account/strategi/STRG-202609-0008')).toBe(
      '/account/strategi/STRG-202609-0008',
    );
  });

  it('menerima jalur internal dengan query dan fragment', () => {
    expect(jalurKembaliAman('/account/strategi/STRG-1?tab=B#b1')).toBe(
      '/account/strategi/STRG-1?tab=B#b1',
    );
  });

  it('memangkas spasi di tepi sebelum memutuskan', () => {
    expect(jalurKembaliAman('  /account  ')).toBe('/account');
  });

  it('menolak kosong / null / undefined', () => {
    expect(jalurKembaliAman('')).toBeNull();
    expect(jalurKembaliAman('   ')).toBeNull();
    expect(jalurKembaliAman(null)).toBeNull();
    expect(jalurKembaliAman(undefined)).toBeNull();
  });

  it('menolak protocol-relative — browser membacanya sebagai host lain', () => {
    expect(jalurKembaliAman('//evil.test/x')).toBeNull();
  });

  it('menolak backslash yang menyamar jadi protocol-relative', () => {
    expect(jalurKembaliAman('/\\evil.test')).toBeNull();
  });

  it('menolak URL absolut apa pun skemanya', () => {
    expect(jalurKembaliAman('https://evil.test')).toBeNull();
    expect(jalurKembaliAman('javascript:alert(1)')).toBeNull();
  });

  it('menolak jalur relatif (tidak diawali garis miring)', () => {
    expect(jalurKembaliAman('account')).toBeNull();
    expect(jalurKembaliAman('../account')).toBeNull();
  });

  it('menolak karakter kontrol dan spasi di tengah', () => {
    expect(jalurKembaliAman('/account\nSet-Cookie: x=1')).toBeNull();
    expect(jalurKembaliAman('/account /x')).toBeNull();
  });
});

describe('pdtUploadHref — parameter dari', () => {
  it('menyertakan dari bila jalurnya aman', () => {
    expect(pdtUploadHref('CLI-202609-0021', 59, '/account/strategi/STRG-1')).toBe(
      '/account/pdt/upload?client=CLI-202609-0021&platform=59&dari=%2Faccount%2Fstrategi%2FSTRG-1',
    );
  });

  it('membuang dari yang tidak aman, bukan meneruskannya', () => {
    expect(pdtUploadHref('CLI-202609-0021', null, '//evil.test')).toBe(
      '/account/pdt/upload?client=CLI-202609-0021',
    );
  });

  it('tanpa argumen dari, tautannya sama persis seperti sebelumnya', () => {
    expect(pdtUploadHref('CLI-202609-0021', 59)).toBe(
      '/account/pdt/upload?client=CLI-202609-0021&platform=59',
    );
  });
});

describe('bacaParamKembali', () => {
  it('membaca lewat gerbang yang sama', () => {
    const q = new URLSearchParams({ dari: '/account' });
    expect(bacaParamKembali((k) => q.get(k))).toBe('/account');
  });

  it('null bila parameternya tidak aman', () => {
    const q = new URLSearchParams({ dari: 'https://evil.test' });
    expect(bacaParamKembali((k) => q.get(k))).toBeNull();
  });

  it('null bila parameternya tidak ada', () => {
    expect(bacaParamKembali(() => null)).toBeNull();
  });
});
