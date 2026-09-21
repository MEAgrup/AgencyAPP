/**
 * Geometri chart — fungsi MURNI, nol React, nol DOM (2026-09-21).
 *
 * ## Kenapa SVG sendiri, bukan pustaka chart
 *
 * Mesin laporan HTML lama (`MEA-Shopee-Report-Engine-v2.html`,
 * `MEA-TikTok-Report-Engine.html`) memakai Chart.js dari CDN. Di CDPS itu tiga
 * masalah sekaligus: (1) `web-internal` hari ini nol dependensi grafik dan
 * menambahnya untuk satu halaman adalah biaya rawat permanen; (2) laporan ini
 * dicetak/di-PDF-kan untuk klien, dan `<canvas>` tidak ikut tercetak setajam
 * vektor; (3) chart dari `<canvas>` tidak bisa diuji — sementara SELURUH angka
 * di laporan PDT wajib bisa dihitung ulang (aturan rumah #4). SVG inline
 * menyelesaikan ketiganya: nol dependensi, vektor saat dicetak, dan geometrinya
 * — berkas ini — adalah fungsi murni yang bisa diuji tanpa merender apa pun.
 *
 * ## Yang TIDAK dilakukan berkas ini
 *
 * Nol pembulatan angka bisnis. Semua fungsi di sini menerima angka yang SUDAH
 * final dari payload laporan dan hanya memetakannya ke koordinat piksel.
 * `null` diteruskan sebagai `null` (jeda di grafik), TIDAK PERNAH jadi 0 —
 * Rule 12: "hari yang berkasnya tidak memuat data" tidak boleh menyamar jadi
 * "hari yang penjualannya nol".
 */

/** Satu titik seri: `y === null` = nilai TIDAK DIKETAHUI (jeda), bukan nol. */
export interface TitikSeri {
  x: number;
  y: number | null;
}

/** Skala linear satu dimensi. `domain` boleh terbalik (`[max, min]`) untuk sumbu Y layar. */
export function skalaLinear(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): (v: number) => number {
  const rentang = domainMax - domainMin;
  // Domain nol-lebar (semua nilai sama) ⇒ seluruh titik mendarat di TENGAH
  // rentang, bukan di tepi: satu garis datar di tengah kanvas terbaca sebagai
  // "nilainya konstan", garis yang menempel di dasar terbaca sebagai "nol".
  if (rentang === 0) {
    const tengah = (rangeMin + rangeMax) / 2;
    return () => tengah;
  }
  return (v: number) => rangeMin + ((v - domainMin) / rentang) * (rangeMax - rangeMin);
}

/**
 * Batas atas sumbu yang "bulat enak dibaca" (1/2/2,5/5 × 10^n) tepat di atas
 * `maks`. Sumbu yang berhenti di 8.437.219 memaksa pembaca menghitung; yang
 * berhenti di 10 juta tidak.
 */
export function batasAtasBulat(maks: number): number {
  if (!isFinite(maks) || maks <= 0) return 1;
  const pangkat = Math.pow(10, Math.floor(Math.log10(maks)));
  const sisa = maks / pangkat;
  const pengali = sisa <= 1 ? 1 : sisa <= 2 ? 2 : sisa <= 2.5 ? 2.5 : sisa <= 5 ? 5 : 10;
  return pengali * pangkat;
}

/** `jumlah + 1` nilai tick merata dari 0 sampai `batasAtasBulat(maks)`, inklusif kedua ujung. */
export function tickSumbu(maks: number, jumlah = 4): number[] {
  const atas = batasAtasBulat(maks);
  const out: number[] = [];
  for (let i = 0; i <= jumlah; i++) out.push((atas / jumlah) * i);
  return out;
}

/**
 * Path SVG untuk garis, dengan JEDA di setiap `y === null` (sub-path baru
 * lewat `M`, bukan garis lurus yang melompati lubang). Grafik yang menyambung
 * dua sisi lubang dengan garis lurus BERBOHONG: ia menggambar hari-hari yang
 * datanya tidak ada seolah tren mulus di antaranya.
 *
 * Titik terisi yang berdiri SENDIRIAN di antara dua lubang tetap diberi
 * sub-path `M`-nya sendiri — tidak terlihat sebagai garis, tapi penanda
 * titiknya (digambar terpisah oleh komponen) tetap mendarat di sana.
 */
export function jalurGaris(titik: readonly TitikSeri[], sx: (v: number) => number, sy: (v: number) => number): string {
  const bagian: string[] = [];
  let menyambung = false;
  for (const t of titik) {
    if (t.y == null) {
      menyambung = false;
      continue;
    }
    const perintah = menyambung ? 'L' : 'M';
    bagian.push(`${perintah}${sx(t.x).toFixed(2)},${sy(t.y).toFixed(2)}`);
    menyambung = true;
  }
  return bagian.join(' ');
}

/** Satu potongan donat, sudah jadi koordinat siap pakai. */
export interface PotonganDonat {
  /** `d` untuk `<path>` — cincin (busur luar + busur dalam), bukan juring penuh. */
  d: string;
  /** Titik tengah potongan di radius tengah cincin — tempat label boleh ditaruh. */
  labelX: number;
  labelY: number;
  fraksi: number;
}

const titikLingkaran = (cx: number, cy: number, r: number, sudut: number): [number, number] =>
  [cx + r * Math.cos(sudut), cy + r * Math.sin(sudut)];

/**
 * Potongan donat untuk deret `nilai` (yang ≤ 0 atau non-finite DILEWATI —
 * sebuah potongan "negatif" tidak punya arti visual). Mulai dari jam 12,
 * searah jarum jam. Total nol ⇒ array kosong (pemanggil menggambar keadaan
 * kosong, bukan cincin hampa yang terlihat seperti data).
 */
export function potonganDonat(
  nilai: readonly number[],
  cx: number,
  cy: number,
  rLuar: number,
  rDalam: number,
): PotonganDonat[] {
  const bersih = nilai.map((v) => (isFinite(v) && v > 0 ? v : 0));
  const total = bersih.reduce((a, v) => a + v, 0);
  if (total <= 0) return [];

  const out: PotonganDonat[] = [];
  let sudut = -Math.PI / 2; // jam 12
  for (const v of bersih) {
    if (v <= 0) continue;
    const fraksi = v / total;
    const lebar = fraksi * Math.PI * 2;
    // Potongan yang MENDEKATI lingkaran penuh: satu path busur tidak bisa
    // menggambar 360° (titik awal = titik akhir ⇒ SVG tidak menggambar apa
    // pun), jadi disisakan celah sangat tipis. Terlihat sebagai cincin penuh.
    const akhir = sudut + Math.min(lebar, Math.PI * 2 - 1e-6);
    const besar = lebar > Math.PI ? 1 : 0;
    const [x1, y1] = titikLingkaran(cx, cy, rLuar, sudut);
    const [x2, y2] = titikLingkaran(cx, cy, rLuar, akhir);
    const [x3, y3] = titikLingkaran(cx, cy, rDalam, akhir);
    const [x4, y4] = titikLingkaran(cx, cy, rDalam, sudut);
    out.push({
      d:
        `M${x1.toFixed(2)},${y1.toFixed(2)} ` +
        `A${rLuar},${rLuar} 0 ${besar} 1 ${x2.toFixed(2)},${y2.toFixed(2)} ` +
        `L${x3.toFixed(2)},${y3.toFixed(2)} ` +
        `A${rDalam},${rDalam} 0 ${besar} 0 ${x4.toFixed(2)},${y4.toFixed(2)} Z`,
      ...(() => {
        const [lx, ly] = titikLingkaran(cx, cy, (rLuar + rDalam) / 2, sudut + lebar / 2);
        return { labelX: lx, labelY: ly };
      })(),
      fraksi,
    });
    sudut = akhir;
  }
  return out;
}

/**
 * Angka ringkas untuk LABEL SUMBU saja — "1,2 jt", "850 rb", "2,4 M".
 * SENGAJA bukan `formatIDR`: sumbu yang setiap ticknya berbunyi
 * "Rp. 2.500.000,00" tidak terbaca. Angka yang dibaca orang untuk keputusan
 * tetap tampil penuh di kartu KPI dan tabel, tidak pernah hanya di sini.
 */
export function angkaRingkas(v: number): string {
  if (!isFinite(v)) return '—';
  const neg = v < 0 ? '-' : '';
  const n = Math.abs(v);
  if (n === 0) return '0';
  const satu = (x: number): string => {
    const dibulatkan = Math.round(x * 10) / 10;
    // Satu desimal HANYA bila ia membawa informasi: "1,0 jt" cuma bising.
    return Number.isInteger(dibulatkan) ? String(dibulatkan) : String(dibulatkan).replace('.', ',');
  };
  if (n >= 1e12) return `${neg}${satu(n / 1e12)} T`;
  if (n >= 1e9) return `${neg}${satu(n / 1e9)} M`;
  if (n >= 1e6) return `${neg}${satu(n / 1e6)} jt`;
  if (n >= 1e3) return `${neg}${satu(n / 1e3)} rb`;
  return `${neg}${satu(n)}`;
}

/** `YYYY-MM-DD` → nomor hari ("07"→"7") untuk label sumbu X yang rapat. Bukan tanggal — string apa pun yang tidak cocok dikembalikan apa adanya. */
export function labelHari(tanggal: string): string {
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(tanggal);
  return m ? String(Number(m[1])) : tanggal;
}

/**
 * Palet kategori laporan PDT. Urutannya stabil — kanal/sumber yang sama dapat
 * warna yang sama di setiap laporan dan setiap bulan, supaya klien yang
 * membandingkan dua bulan tidak salah baca gara-gara warnanya bertukar.
 */
export const WARNA_SERI: readonly string[] = [
  '#0f766e', // teal
  '#b45309', // amber tua
  '#1d4ed8', // biru
  '#9333ea', // ungu
  '#be123c', // merah tua
  '#4d7c0f', // hijau zaitun
  '#0e7490', // sian
  '#7c2d12', // cokelat
];

/** Warna deret ke-`i`, memutar bila serinya lebih panjang dari palet. */
export const warnaSeri = (i: number): string => WARNA_SERI[((i % WARNA_SERI.length) + WARNA_SERI.length) % WARNA_SERI.length];
