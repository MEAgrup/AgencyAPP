/**
 * Pemetaan **pilar Strategi Section E → baris kerja Plan P-C** (M6B §6 Flow
 * langkah 1: *"a skeleton of rows from E + F (channel × pillar × quota)"*).
 *
 * KENAPA ADA. Sampai B5, langkah 1 itu sengaja TIDAK dijalankan —
 * `generatePlanPeriods` menuliskannya sendiri: *"No row skeleton yet … auto-
 * assigning a division per pillar would be invented data"*. Alasannya benar
 * untuk `sku`/`harga`/`retensi`, yang memang tak punya satu divisi pemilik,
 * tapi terlalu luas untuk lima jenis sisanya: `konten` selalu Creative,
 * `iklan` selalu Ads, `affiliate` selalu KOL, `live` selalu Live Stream,
 * `operasional` selalu Ops. Akibat dari melebarkan alasan itu ke semua pilar
 * adalah rantai yang `docs/DECISIONS.md` 2026-09-02 catat sendiri: baris Plan
 * lahir `di_luar_strategi` semua, dan metrik deviasi PG-1 (`<15%` pekerjaan di
 * luar Strategi) kehilangan daya bedanya karena penyebutnya 100%.
 *
 * SUMBER KEBENARAN, DUA RUMAH. Logika di berkas ini dipakai DUA arah:
 *   1. **Server** — `plan.generatePlanPeriods` menyemai baris periode 1 saat
 *      Strategi disetujui (satu transaksi dengan approval).
 *   2. **Frontend** — `web-internal/src/lib/plan-row-suggest.ts` adalah cermin
 *      MANUAL berkas ini (web-internal tidak punya dependency `@cdps/*`, lihat
 *      `web-internal/src/lib/divisions.ts` untuk preseden pola yang sama).
 *      Kalau tabel atau parser di sini berubah, cermin itu ikut diubah.
 *
 * YANG SENGAJA TIDAK DILAKUKAN. Menebak divisi untuk `sku`/`harga`/`retensi`
 * (pemilik menetapkan 2026-09-06 bahwa pilar SKU/harga diberikan ke **AI
 * Optimizer atau Store Operation dan AM yang memilih**), dan menyemai baris
 * dengan `kuota = 0` saat target tak menyebut angka. Baris ber-kuota nol adalah
 * baris mati: `brief-inherit.ts` melewatinya dengan alasan `kuota_nol`, jadi ia
 * hanya menambah baris kosong yang tak pernah jadi Brief. Keduanya keluar lewat
 * `seedRowFromPillar` sebagai ALASAN, bukan sebagai baris — supaya halaman Plan
 * bisa menampilkannya ke AM alih-alih menghilangkannya diam-diam.
 */
import * as division from './division';
import * as plantask from './plantask';

/**
 * Lima jenis pilar yang punya SATU divisi pemilik tanpa ambiguitas. Nilai
 * kunci = `ck_strpil_jenis`, nilai isi = `division.Division.nama` (label yang
 * benar-benar tersimpan di `plan_row.divisi_pic`).
 */
export const PILAR_TO_DIVISI: Readonly<Record<string, string>> = {
  konten: 'Creative',
  iklan: 'Ads',
  affiliate: 'KOL',
  live: 'Live Stream',
  operasional: 'Ops',
};

/**
 * Tiga jenis pilar yang divisinya DIPILIH AM, bukan diturunkan. Bukan daftar
 * "belum sempat dipetakan": `sku` dan `harga` diketok pemilik 2026-09-06 jadi
 * pilihan AM antara AI Optimizer dan Store Operation, dan `retensi` (E-9
 * follow-up chat / broadcast) belum diketok sama sekali — menebaknya melanggar
 * keputusan yang sama.
 */
export const PILAR_PILIH_DIVISI: readonly string[] = ['sku', 'harga', 'retensi'];

/**
 * Kosakata pilar baris kerja (cermin `ck_plan_row_pilar` — delapan pilar
 * Strategi tanpa `tidak_dikerjakan`, yang adalah STATUS pilar, bukan pekerjaan).
 */
export const PILAR_BARIS: readonly string[] = [
  ...Object.keys(PILAR_TO_DIVISI),
  ...PILAR_PILIH_DIVISI,
].sort();

/**
 * Divisi yang ditawarkan lebih dulu saat AM memilih PIC untuk pilar
 * `sku`/`harga`/`retensi` — dua divisi yang pemilik sebut namanya 2026-09-06.
 * Sisa `briefAssignableNames()` tetap ditawarkan di bawahnya: mendahulukan
 * bukan membatasi.
 */
export const KANDIDAT_DIDAHULUKAN: readonly string[] = ['AI Optimizer', 'Store Operation'];

/** Kandidat divisi PIC untuk pilar tanpa divisi bawaan, yang didahulukan di depan. */
export function kandidatDivisi(): string[] {
  const semua = division.briefAssignableNames();
  const depan = KANDIDAT_DIDAHULUKAN.filter((n) => semua.includes(n));
  return [...depan, ...semua.filter((n) => !depan.includes(n))];
}

/**
 * Angka pembuka teks target E-10, dibaca menurut konvensi penulisan angka
 * Indonesia yang sudah jadi aturan rumah (CLAUDE.md #7 `Rp. X.XXX.XXX,00`):
 * **titik = pemisah ribuan, koma = desimal**.
 *
 * `null` untuk apa pun yang tidak persis salah satu bentuk itu — termasuk
 * `1.5` (titik dengan satu digit di belakang bukan ribuan DAN bukan desimal
 * menurut konvensi ini). Ini disengaja: parser sebelumnya membaca `15.000.000`
 * sebagai **15** karena hanya melihat `\d+(?:[.,]\d+)?`, dan di jalur semai
 * server-side angka salah 1000× akan masuk DB tanpa ada AM yang melihatnya
 * dulu. Lebih baik AM mengetik ulang satu angka daripada satu baris kerja
 * menyimpan angka yang tak pernah ia tulis.
 */
export function parseAngkaTarget(run: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(run);
  if (m === null) return null;
  const bulat = m[1].replace(/\./g, '');
  const pecahan = m[2] ?? '';
  const n = Number(pecahan === '' ? bulat : `${bulat}.${pecahan}`);
  return Number.isFinite(n) ? n : null;
}

/** Hasil baca `"30 video, jembatan …"` → angka + kata benda unitnya. */
export interface TargetKuota {
  kuota: number;
  satuan: string;
}

/**
 * Baca `kuota` + `satuan` dari kepala teks target sebuah pilar. Angka harus
 * berada DI DEPAN (`"30 video"`, bukan `"video sebanyak 30"`) — bentuk yang
 * AM Co-Pilot hasilkan dan yang PC-6 contohkan ("40 video, 7 listing, 36 jam
 * live"). `null` kalau tak ada angka pembuka yang terbaca pasti.
 */
export function parseTargetKuota(target: string | null | undefined): TargetKuota | null {
  const m = /^(\d[\d.,]*\d|\d)\s*([^\s,]+)?/.exec((target ?? '').trim());
  if (m === null) return null;
  const kuota = parseAngkaTarget(m[1]);
  if (kuota === null) return null;
  return { kuota, satuan: m[2] ?? '' };
}

/**
 * Rapikan satuan hasil baca ke ejaan katalog `plantask` bila divisinya mengenal
 * satuan itu (`"Video"` → `"video"`), supaya laporan yang menjumlahkan per
 * satuan tidak memecah satu deliverable jadi dua ejaan — persis masalah yang
 * `plantask.ts` dibuat untuk menghentikan. Satuan yang tak dikenal katalog
 * diteruskan apa adanya: `plan_row.satuan` memang mengizinkan teks bebas
 * (jalur "Lainnya"), dan mengarang ejaan lain justru menambah varian ketiga.
 */
export function satuanKanonik(divisiPic: string, satuan: string): string {
  return plantask.jenisBySatuan(divisiPic, satuan)?.satuan ?? satuan.trim();
}

/** Bentuk pilar Section E yang dibaca berkas ini — struktural, bukan baris DB utuh. */
export interface PillarSeedInput {
  id: number;
  jenis: string;
  channel: string | null;
  aksi: string | null;
  target: string | null;
  sku: string | null;
}

/** Baris P-C siap ditulis, seluruh kolomnya turunan dari pilar — nol invensi. */
export interface SeededPlanRow {
  strategiPillarId: number;
  channel: string; // PC-1
  pilar: string; // PC-2
  aksi: string; // PC-4
  skuSasaran: string[]; // PC-5
  kuota: number; // PC-6
  satuan: string; // PC-6 unit
  divisiPic: string; // PC-8
  hasilDiharapkan: string; // PC-11
}

/**
 * Kenapa sebuah pilar tidak jadi baris. Bukan galat: tiap nilai adalah satu
 * kolom yang hanya AM yang bisa mengisinya, dan halaman Plan menampilkannya
 * sebagai pekerjaan yang tersisa.
 */
export type AlasanTakDisemai =
  | 'bukan_pilar_kerja' // `tidak_dikerjakan` / jenis di luar kosakata
  | 'butuh_divisi' // `sku` / `harga` / `retensi`
  | 'butuh_kuota' // target tak menyebut angka pembuka yang terbaca
  | 'butuh_channel'; // pilar lintas channel & Strategi punya >1 channel

/** Label BI untuk tiap alasan — satu sumber, dipakai panel FE lewat cerminnya. */
export const ALASAN_LABEL: Readonly<Record<AlasanTakDisemai, string>> = {
  bukan_pilar_kerja: 'bukan pekerjaan (pilar ditandai tidak dikerjakan)',
  butuh_divisi: 'pilih divisi PIC',
  butuh_kuota: 'isi kuota + satuan',
  butuh_channel: 'pilih channel',
};

export type HasilSemai =
  | { disemai: true; row: SeededPlanRow }
  | { disemai: false; alasan: AlasanTakDisemai[]; usulan: Partial<SeededPlanRow> };

/**
 * Putuskan apakah satu pilar Section E bisa jadi baris P-C, dan kalau tidak,
 * SEBUTKAN apa yang kurang. Semua alasan dikumpulkan sekaligus (bukan berhenti
 * di yang pertama) supaya AM melihat seluruh kekurangan satu baris dalam satu
 * layar, bukan satu per satu tiap kali menyimpan.
 *
 * `channelStrategi` = channel yang benar-benar dikontrak Strategi ini. Pilar
 * lintas channel (`channel IS NULL`, "null = lintas channel" di skema) hanya
 * bisa disemai kalau Strategi-nya memang satu channel — di situ tidak ada yang
 * ditebak, karena tidak ada channel lain untuk dipilih.
 */
export function seedRowFromPillar(
  p: PillarSeedInput,
  channelStrategi: readonly string[],
): HasilSemai {
  const pilar = p.jenis;
  if (!PILAR_BARIS.includes(pilar)) {
    return { disemai: false, alasan: ['bukan_pilar_kerja'], usulan: {} };
  }

  const alasan: AlasanTakDisemai[] = [];

  const divisiPic = PILAR_TO_DIVISI[pilar] ?? null;
  if (divisiPic === null) alasan.push('butuh_divisi');

  const pilarChannel = (p.channel ?? '').trim();
  const channel =
    pilarChannel !== ''
      ? pilarChannel
      : channelStrategi.length === 1
        ? channelStrategi[0]
        : null;
  if (channel === null) alasan.push('butuh_channel');

  const kuota = parseTargetKuota(p.target);
  if (kuota === null || kuota.kuota <= 0) alasan.push('butuh_kuota');

  const sku = (p.sku ?? '').trim();
  const usulan: Partial<SeededPlanRow> = {
    strategiPillarId: p.id,
    pilar,
    aksi: (p.aksi ?? '').trim(),
    skuSasaran: sku === '' ? [] : [sku],
    hasilDiharapkan: (p.target ?? '').trim(),
  };
  if (channel !== null) usulan.channel = channel;
  if (divisiPic !== null) usulan.divisiPic = divisiPic;
  if (kuota !== null && kuota.kuota > 0) {
    usulan.kuota = kuota.kuota;
    usulan.satuan = divisiPic === null ? kuota.satuan : satuanKanonik(divisiPic, kuota.satuan);
  }

  if (alasan.length > 0) return { disemai: false, alasan, usulan };

  // Semua cabang di atas sudah membuktikan ketiganya ada; penegasan ini hanya
  // untuk penyempitan tipe.
  return {
    disemai: true,
    row: {
      strategiPillarId: p.id,
      channel: channel as string,
      pilar,
      aksi: usulan.aksi ?? '',
      skuSasaran: usulan.skuSasaran ?? [],
      kuota: usulan.kuota as number,
      satuan: usulan.satuan ?? '',
      divisiPic: divisiPic as string,
      hasilDiharapkan: usulan.hasilDiharapkan ?? '',
    },
  };
}
