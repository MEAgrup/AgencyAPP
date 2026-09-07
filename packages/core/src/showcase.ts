/**
 * Showcase Klien Terbaik — mesin pemilihnya (Gelombang C).
 *
 * APA YANG MODUL INI ADALAH. Satu fungsi murni yang menerima ringkasan laporan
 * klien dan menjawab dua hal: **siapa yang layak dipamerkan**, dan — kalau tidak
 * ada seorang pun — **kenapa**. Bagian kedua sama pentingnya dengan yang
 * pertama, dan itulah alasan modul ini ada alih-alih sebuah `WHERE skor >= 7`
 * di dalam kueri.
 *
 * KENAPA "KENAPA" ITU PENTING. Keputusan pemilik C-2 (2026-09-07) memerintahkan
 * halaman ini dibangun sekarang justru dengan mengetahui ia akan kosong berbulan
 * -bulan: hari keputusan diketok, live punya **1 laporan klien, ber-skor 4,5
 * (KRITIS)**. Halaman kosong yang tidak mengatakan sebabnya akan dibaca tim
 * sebagai "fiturnya rusak", lalu dilaporkan sebagai bug, lalu didiagnosa ulang
 * oleh orang yang tidak tahu keputusan ini pernah ada. Itu kelas kekeliruan yang
 * sama dengan `0` vs `null` yang seluruh Gelombang B dibangun untuk mencegah:
 * **ketiadaan yang diam tidak bisa dibedakan dari kerusakan**. Maka setiap klien
 * yang TIDAK lolos membawa alasannya sendiri, dan halaman menampilkannya.
 *
 * AMBANGNYA KONSTANTA BERNAMA, DAN HALAMAN MENYEBUTKANNYA (C-4, diketok
 * 2026-09-07 oleh Yohan/Director): **skor ≥ 8,0 dan minimal 3 periode laporan**.
 * Dua angka itu bukan selera:
 *
 *   * **8,0** adalah batas bawah label `SEHAT` di mesin laporan klien —
 *     `report/skor.ts:114` dan `report/shopee/skor.ts:129` memakai ambang yang
 *     sama persis (`>= 8` SEHAT, `>= 6` PERLU PERHATIAN, sisanya KRITIS). Jadi
 *     "klien terbaik" berarti "klien yang mesin laporannya SENDIRI sebut sehat",
 *     bukan ambang kedua yang dikarang di sini dan bisa menyimpang dari yang
 *     pertama. Angka pertama yang diketok adalah 7,0, atas dasar klaim (keliru)
 *     bahwa 7,0 batas SEHAT; begitu pitanya diperiksa di kode, pemilik menggeser
 *     ke 8,0 — dicatat di sini supaya siapa pun yang menurunkannya lagi tahu
 *     bahwa 8,0 bukan angka bulat sembarangan.
 *   * **3 periode** menjawab pertanyaan yang C-4 ajukan apa adanya: satu bulan
 *     bagus bisa kebetulan, dan materi pitch yang dibangun di atas kebetulan
 *     adalah materi pitch yang gugur saat calon klien bertanya "lalu bulan
 *     berikutnya?".
 *
 * IZIN ADALAH GERBANG, BUKAN KOLOM TAMBAHAN. C-3 memutuskan angka klien hanya
 * boleh masuk materi pitch untuk klien yang izinnya sudah ada, dan C-1 membuka
 * halaman ini ke divisi Sales. Modul ini karena itu memisahkan dua pertanyaan
 * yang mudah tertukar: **layak** (ambang performa) dan **boleh** (izin). Seorang
 * klien bisa layak tapi belum boleh — dan yang Sales lihat hanya irisan
 * keduanya. Pemisahan itu ada di TIPE (`lolosAmbang` vs `berizin`), supaya
 * penelepon yang lupa menyaring salah satunya ditolak kompiler, bukan ditemukan
 * belakangan sebagai angka klien di tangan divisi yang tidak memilikinya.
 */

import { SKOR_SEHAT_MIN } from './report/skor';

/**
 * Skor minimum laporan TERAKHIR supaya seorang klien layak dipamerkan (C-4).
 *
 * Nilainya BUKAN literal di sini: ia dibaca dari `SKOR_SEHAT_MIN`, batas pita
 * label mesin laporan klien. Kalau suatu hari pita itu dikalibrasi ulang, ambang
 * Showcase ikut bergeser bersamanya — bukan ketinggalan diam-diam dan meloloskan
 * klien berlabel PERLU PERHATIAN ke materi pitch.
 */
export const AMBANG_SKOR_MIN = SKOR_SEHAT_MIN;

/**
 * Berapa periode laporan minimal supaya kenaikannya terbukti bukan kebetulan
 * (C-4). Dihitung dari laporan yang BER-SKOR — sebuah laporan tanpa skor tidak
 * bisa membuktikan tren apa pun, jadi ia tidak boleh ikut memenuhi kuota ini.
 */
export const AMBANG_MIN_PERIODE = 3;

/**
 * Provenance ambang di atas, ditampilkan halaman apa adanya (aturan rumah #4:
 * angka turunan selalu bisa ditelusuri). Kalau ambangnya berubah, kalimat ini
 * berubah bersamanya di satu tempat — bukan tersebar di JSX.
 */
export const AMBANG_SUMBER =
  'Ambang diketok pemilik 2026-09-07 (gerbang C-4): skor ≥ 8,0 pada laporan terakhir — batas bawah label SEHAT di mesin laporan klien — dan minimal 3 periode laporan ber-skor.';

/** Kalimat ambang untuk kepala halaman — satu baris, angka dari konstanta di atas. */
export const AMBANG_KALIMAT =
  `Klien terbaik = skor laporan terakhir minimal ${AMBANG_SKOR_MIN.toFixed(1).replace('.', ',')} dan sudah punya minimal ${AMBANG_MIN_PERIODE} periode laporan ber-skor.`;

/**
 * Kenapa seorang klien TIDAK muncul di Showcase. Urutannya sengaja: sebuah
 * klien tanpa laporan sama sekali bukan klien yang "skornya kurang", dan
 * membedakannya adalah selisih antara "isi laporannya" dan "kliennya memang
 * belum bagus" — dua tindakan yang sama sekali berbeda.
 */
export type AlasanTidakLolos =
  | 'belum_ada_laporan'
  | 'laporan_belum_berskor'
  | 'periode_kurang'
  | 'skor_kurang';

/** Kalimat Bahasa Indonesia per alasan, dipakai halaman apa adanya. */
export const ALASAN_KALIMAT: Readonly<Record<AlasanTidakLolos, string>> = {
  belum_ada_laporan: 'belum ada laporan klien sama sekali',
  laporan_belum_berskor: 'laporan sudah ada tapi belum ber-skor',
  periode_kurang: `baru punya kurang dari ${AMBANG_MIN_PERIODE} periode laporan ber-skor`,
  skor_kurang: `skor laporan terakhir di bawah ${AMBANG_SKOR_MIN.toFixed(1).replace('.', ',')}`,
};

/**
 * Satu laporan klien, seringkas yang pemilihan butuhkan. Ini SENGAJA bukan
 * `client_reports` utuh: modul ini tidak boleh punya pendapat tentang payload,
 * dan pemanggil di domain-lah yang memutuskan kolom mana yang dibaca.
 *
 * `skor` boleh `null` — mesin laporan memang bisa menghasilkan laporan tanpa
 * skor saat berkasnya tak lengkap — dan `null` di sini berarti "tidak dihitung",
 * BUKAN nol. Memperlakukannya sebagai 0 akan menjatuhkan klien yang laporannya
 * sekadar belum lengkap ke kelas yang sama dengan klien yang benar-benar buruk.
 */
export interface LaporanRingkas {
  /** Kunci baris laporan (`client_reports.id`), untuk penelusuran balik. */
  id: number;
  periodeMulai: string; // ISO yyyy-mm-dd
  periodeAkhir: string; // ISO yyyy-mm-dd
  periodeTipe: string; // mingguan | bulanan
  platform: string;
  skor: number | null;
  skorLabel: string | null;
  /** GMV disetarakan ke 30 hari — satuan yang sama untuk mingguan & bulanan. */
  gmvRunrateBulanan: number;
}

/** Satu klien beserta seluruh laporannya, apa adanya dari DB. */
export interface KlienLaporan {
  clientId: string;
  toko: string;
  kategori: string | null;
  /** Izin C-3: status hari ini, sudah diturunkan dari ledger oleh domain. */
  berizin: boolean;
  laporan: readonly LaporanRingkas[];
}

/** Tren satu metrik antara laporan ber-skor PERTAMA dan TERAKHIR. */
export interface Tren {
  awal: number;
  akhir: number;
  /**
   * Selisih relatif (`(akhir - awal) / awal`). `null` saat `awal` nol — aturan
   * rumah #7: pembagian nol dirender `—`, tidak pernah dipaksa jadi angka.
   */
  delta: number | null;
}

/** Satu klien yang LOLOS ambang, siap dipamerkan. */
export interface ShowcaseKlien {
  clientId: string;
  toko: string;
  kategori: string | null;
  berizin: boolean;
  /** Berapa periode laporan ber-skor yang dipakai menilai. */
  periodeDinilai: number;
  periodeMulai: string;
  periodeAkhir: string;
  platform: readonly string[];
  skorTerakhir: number;
  skorLabelTerakhir: string | null;
  trenSkor: Tren;
  trenGmv: Tren;
}

/** Satu klien yang TIDAK lolos, beserta sebabnya. */
export interface ShowcaseTersisih {
  clientId: string;
  toko: string;
  alasan: AlasanTidakLolos;
  /** Berapa periode ber-skor yang sudah ada (0 kalau belum ada). */
  periodeBerskor: number;
  /** Skor laporan ber-skor terakhir, `null` kalau belum ada satu pun. */
  skorTerakhir: number | null;
}

/** Hasil pemilihan: yang lolos, yang tidak, dan ambang yang dipakai. */
export interface ShowcaseHasil {
  klien: readonly ShowcaseKlien[];
  tersisih: readonly ShowcaseTersisih[];
  ambang: {
    skorMin: number;
    minPeriode: number;
    kalimat: string;
    sumber: string;
  };
}

/** Urut laporan ber-skor dari yang paling lama ke yang paling baru. */
/**
 * Laporan yang PASTI ber-skor. Tipenya sengaja `LaporanRingkas & { skor: number }`
 * dan bukan `LaporanRingkas`: predikat penyempit di `.filter()` di bawah tidak
 * ada gunanya kalau anotasi kembalian melebarkannya lagi ke `number | null`,
 * dan yang tersisa hanyalah `!` di setiap pembacanya — yaitu tepat titik di
 * mana "laporan tanpa skor bukan laporan ber-skor nol" berhenti dijaga
 * kompiler.
 */
type LaporanBerskor = LaporanRingkas & { skor: number };

function berskorUrut(laporan: readonly LaporanRingkas[]): LaporanBerskor[] {
  return laporan
    .filter((l): l is LaporanBerskor => typeof l.skor === 'number')
    .slice()
    .sort((a, b) =>
      a.periodeAkhir === b.periodeAkhir ? a.id - b.id : a.periodeAkhir < b.periodeAkhir ? -1 : 1,
    );
}

/** Tren dari dua ujung; `delta` null saat pangkalnya nol (aturan rumah #7). */
function tren(awal: number, akhir: number): Tren {
  return { awal, akhir, delta: awal === 0 ? null : (akhir - awal) / awal };
}

/**
 * pilihKlienShowcase memutuskan siapa yang masuk Showcase dan mencatat sebab
 * setiap yang tidak.
 *
 * Ia TIDAK menyaring izin. Itu keputusan sengaja: izin (C-3) adalah gerbang
 * VISIBILITAS yang bergantung pada siapa yang melihat — Account melihat kliennya
 * sendiri berizin atau tidak (supaya ia tahu izin mana yang perlu diminta),
 * sementara Sales hanya melihat yang berizin. Menyaringnya di sini akan
 * menyembunyikan pekerjaan itu dari orang yang seharusnya melakukannya. Yang
 * menyaring adalah domain, dengan `berizin` yang setiap baris bawa.
 *
 * Urutan hasil: skor terakhir turun, lalu GMV run-rate terakhir turun, lalu
 * `clientId` naik. Tiga tingkat supaya urutannya deterministik — dua klien
 * ber-skor sama tidak boleh bertukar tempat antar-permintaan, karena materi
 * pitch yang di-export dua kali harus sama.
 */
export function pilihKlienShowcase(klien: readonly KlienLaporan[]): ShowcaseHasil {
  const lolos: ShowcaseKlien[] = [];
  const tersisih: ShowcaseTersisih[] = [];

  for (const k of klien) {
    const berskor = berskorUrut(k.laporan);
    const terakhir = berskor[berskor.length - 1];

    if (k.laporan.length === 0) {
      tersisih.push({ clientId: k.clientId, toko: k.toko, alasan: 'belum_ada_laporan', periodeBerskor: 0, skorTerakhir: null });
      continue;
    }
    if (berskor.length === 0) {
      tersisih.push({ clientId: k.clientId, toko: k.toko, alasan: 'laporan_belum_berskor', periodeBerskor: 0, skorTerakhir: null });
      continue;
    }
    if (berskor.length < AMBANG_MIN_PERIODE) {
      tersisih.push({ clientId: k.clientId, toko: k.toko, alasan: 'periode_kurang', periodeBerskor: berskor.length, skorTerakhir: terakhir.skor });
      continue;
    }
    if (terakhir.skor < AMBANG_SKOR_MIN) {
      tersisih.push({ clientId: k.clientId, toko: k.toko, alasan: 'skor_kurang', periodeBerskor: berskor.length, skorTerakhir: terakhir.skor });
      continue;
    }

    const awal = berskor[0];
    lolos.push({
      clientId: k.clientId,
      toko: k.toko,
      kategori: k.kategori,
      berizin: k.berizin,
      periodeDinilai: berskor.length,
      periodeMulai: awal.periodeMulai,
      periodeAkhir: terakhir.periodeAkhir,
      platform: [...new Set(berskor.map((l) => l.platform))].sort(),
      skorTerakhir: terakhir.skor,
      skorLabelTerakhir: terakhir.skorLabel,
      trenSkor: tren(awal.skor, terakhir.skor),
      trenGmv: tren(awal.gmvRunrateBulanan, terakhir.gmvRunrateBulanan),
    });
  }

  lolos.sort((a, b) =>
    b.skorTerakhir !== a.skorTerakhir
      ? b.skorTerakhir - a.skorTerakhir
      : b.trenGmv.akhir !== a.trenGmv.akhir
        ? b.trenGmv.akhir - a.trenGmv.akhir
        : a.clientId < b.clientId
          ? -1
          : a.clientId > b.clientId
            ? 1
            : 0,
  );
  tersisih.sort((a, b) => (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));

  return {
    klien: lolos,
    tersisih,
    ambang: { skorMin: AMBANG_SKOR_MIN, minPeriode: AMBANG_MIN_PERIODE, kalimat: AMBANG_KALIMAT, sumber: AMBANG_SUMBER },
  };
}

// ---------------------------------------------------------------------------
// Materi pitch — dokumen yang MENINGGALKAN gedung
// ---------------------------------------------------------------------------
/**
 * Kenapa ada dokumen, padahal Sales sudah punya akses halaman (C-1).
 *
 * Yang dikirim ke calon klien adalah berkas, bukan tautan ke sistem internal:
 * calon klien tidak punya akun CDPS, dan memberi mereka satu hanya untuk melihat
 * satu tabel adalah permukaan akses baru yang tidak seorang pun minta. Dokumen
 * ini karena itu berdiri sendiri — satu berkas HTML tanpa aset eksternal, bisa
 * dilampirkan ke email dan dibuka di mana saja.
 *
 * ⚠️ **Dokumen ini hanya boleh memuat klien BER-IZIN, tanpa kecuali** — termasuk
 * saat yang meng-export adalah Director. Halaman Showcase punya dua pandangan
 * (Account melihat klien belum-berizin supaya tahu izin mana yang perlu
 * diminta); dokumen TIDAK punya dua pandangan, karena begitu ia terkirim tidak
 * ada lagi yang bisa menariknya kembali. Penyaringannya ditegakkan di domain
 * (`materiPitch`), bukan di sini — fungsi ini merender apa yang diberikan.
 */
const ESC: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** `1234567` → `Rp. 1.234.567,00` (aturan rumah #7). */
function rupiah(v: number): string {
  return `Rp. ${Math.round(v).toLocaleString('id-ID')},00`;
}

/** Persentase perubahan; `—` saat pangkalnya nol (aturan rumah #7). */
function persen(t: Tren): string {
  if (t.delta === null) return '—';
  const p = t.delta * 100;
  return `${p > 0 ? '+' : ''}${p.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
}

function angka1(v: number): string {
  return v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export interface PitchDocOptions {
  /** Nama/ID yang meng-export — tercetak di dokumen supaya salinan bisa dilacak. */
  dibuatOleh: string;
  /** `yyyy-mm-dd` waktu Jakarta; diteruskan, tidak dibaca dari jam dinding. */
  dibuatPada: string;
}

/**
 * renderPitchDoc — satu berkas HTML mandiri berisi klien ber-izin.
 *
 * Nol aset eksternal (CSS inline, nol gambar, nol skrip): berkas yang meminta
 * sesuatu dari jaringan saat dibuka calon klien adalah berkas yang tampilannya
 * bergantung pada apakah jaringan itu ada — dan, lebih buruk, yang bisa
 * memberitahu server kapan ia dibuka.
 */
export function renderPitchDoc(klien: readonly ShowcaseKlien[], opts: PitchDocOptions): string {
  const baris = klien
    .map(
      (k) => `      <tr>
        <td><strong>${esc(k.toko)}</strong><div class="sub">${esc(k.kategori ?? '—')} · ${esc(k.platform.join(', '))}</div></td>
        <td class="num">${esc(angka1(k.skorTerakhir))}<div class="sub">${esc(k.skorLabelTerakhir ?? '—')}</div></td>
        <td class="num">${esc(persen(k.trenSkor))}</td>
        <td class="num">${esc(rupiah(k.trenGmv.akhir))}<div class="sub">dari ${esc(rupiah(k.trenGmv.awal))} · ${esc(persen(k.trenGmv))}</div></td>
        <td class="num">${k.periodeDinilai}<div class="sub">${esc(k.periodeMulai)} → ${esc(k.periodeAkhir)}</div></td>
      </tr>`,
    )
    .join('\n');

  const isi =
    klien.length === 0
      ? `    <p class="kosong">Belum ada klien yang memenuhi ambang <em>dan</em> sudah memberi izin pemakaian angkanya. ${esc(AMBANG_KALIMAT)}</p>`
      : `    <table>
      <thead>
        <tr><th>Klien</th><th class="num">Skor terakhir</th><th class="num">Tren skor</th><th class="num">GMV run-rate</th><th class="num">Periode dinilai</th></tr>
      </thead>
      <tbody>
${baris}
      </tbody>
    </table>`;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Showcase Klien Terbaik — MEA Agency</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; background: #f8fafc; }
  .wrap { max-width: 940px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px 32px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .lead { margin: 0 0 20px; color: #475569; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  td.num, th.num { text-align: right; }
  .sub { color: #64748b; font-size: 12px; margin-top: 2px; }
  .kosong { color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
  footer { margin-top: 22px; padding-top: 14px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
  @media print { body { background: #fff; padding: 0; } .wrap { border: 0; border-radius: 0; padding: 0; } }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Showcase Klien Terbaik</h1>
    <p class="lead">${esc(AMBANG_KALIMAT)}</p>
${isi}
    <footer>
      Angka dihitung dari laporan performa klien MEA Agency dan tidak pernah diketik ulang.<br>
      Hanya memuat klien yang telah memberikan izin pemakaian angkanya.<br>
      Dibuat ${esc(opts.dibuatPada)} oleh ${esc(opts.dibuatOleh)}.
    </footer>
  </div>
</body>
</html>
`;
}
