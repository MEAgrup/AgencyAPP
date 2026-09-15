/**
 * PDT (Pusat Data Toko) — dekode berkas + deteksi modul DI SERVER (G1-05, PRD §6.7).
 *
 * Ini pemindahan arsitektur yang PRD §6.7 minta: `XLSX.read` hari ini jalan di
 * BROWSER (`web-internal/src/lib/{riset-awal,report,skuscreener,adsscanner}.ts`,
 * pola `XLSX.read(buf, {type:'array'})` → `XLSX.utils.sheet_to_json(ws,
 * {header:1, raw:false, defval:''})`) — modul ini adalah salinan SERVER dari
 * pola dekode yang SAMA PERSIS (bukan reimplementasi baru), dipasang di atas
 * entri yang `bacaDanEkstrakPdtZip` (G1-04) sudah ekstrak ke disk sementara.
 *
 * Seluruh engine `packages/core` (deteksi, normalisasi angka) SUDAH murni/
 * DOM-free/menerima AoA sejak G1-02/G1-03 — yang pindah HANYA dekode
 * berkasnya, persis seperti yang backlog G1-05 catat. `detectPdtModule`
 * (G1-02) BENAR-BENAR dipanggil di sini untuk pertama kalinya di luar tes.
 *
 * ⚠️ **Yang BELUM dilakukan di sini (sengaja, lihat `docs/DECISIONS.md`
 * G1-05):** memetakan `kolomDipanen` ke baris tabel fakta bertipe dan
 * memanggil `parsePdtAngka` per sel. Itu butuh metadata "kolom mana angka,
 * kolom mana teks, konvensi locale mana (`raw` true/false) per modul" yang
 * TIDAK ADA di `PdtModuleDef` hari ini (`kolomDipanen` cuma whitelist nama,
 * bukan peta tipe) — menebak peta itu sekarang berarti mengarang kontrak
 * yang G1-06 (identitas dari berkas) dan G1-07 (rekonsiliasi) baru akan
 * tentukan. Modul ini menyediakan AoA + modul terdeteksi; pemanggil
 * (G1-06/07/08) yang membaca selnya lewat `parsePdtAngka`.
 *
 * Kegagalan dekode SATU entri TIDAK menjatuhkan seluruh batch (Rule 10,
 * cermin `gagalEkstrak` G1-04) — ditangkap ke `gagal`, entri lain tetap
 * diproses.
 */
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { pdt } from '@cdps/core';
import type { PdtZipEntriTerekstrak } from './pdt-zip';

type PdtModuleDef = pdt.PdtModuleDef;
const { detectPdtModuleAntarSheet } = pdt;

/** Satu entri (xlsx/xls/csv) berhasil didekode + dicocokkan terhadap registry modul. */
export interface PdtParsedFile {
  /** Nama entri di dalam ZIP (`meta.nama` — lihat `pdt-zip.ts`, TIDAK dipercaya sebagai path). */
  nama: string;
  /**
   * AoA milik modul yang terdeteksi (`modul`) — sheet `namaSheet`-nya bila
   * modul itu menentukannya (G1-09-SHEET-BUKAN-PERTAMA), atau sheet PERTAMA
   * bila `modul` null (nol/lebih dari satu cocok — nol AoA tunggal yang bisa
   * mewakili hasil begitu, sheet pertama dipakai murni untuk pratinjau).
   */
  aoa: unknown[][];
  /** Kode modul bila TEPAT satu tanda tangan cocok; `null` bila nol atau ambigu (lihat `matches`/`ambiguous`). */
  modul: string | null;
  ambiguous: boolean;
  matches: readonly string[];
  /**
   * SELURUH sheet yang relevan (workbook.SheetNames[0] ∪ tiap `namaSheet`
   * modul di registry) yang ADA di workbook file ini, dipetakan nama→AoA.
   * Dipakai `pdt.commitUploadBatch`/`pdt.reparsePdtBatch` untuk me-remap
   * `aoa` ke sheet yang BENAR saat AM meng-override modul (Rule G1-09
   * bullet 3) ke modul ber-`namaSheet` yang berbeda dari yang otomatis
   * terdeteksi (atau tidak terdeteksi sama sekali).
   */
  sheets: Map<string, unknown[][]>;
}

/** Satu entri gagal didekode (berkas rusak/kosong) — TIDAK menjatuhkan batch. */
export interface PdtParseGagal {
  nama: string;
  pesan: string;
}

export interface PdtParseBatchHasil {
  berkas: readonly PdtParsedFile[];
  gagal: readonly PdtParseGagal[];
  /** Waktu dekode + deteksi SELURUH batch (target G1-05: < 45 detik / 13 berkas). */
  durasiMs: number;
}

/**
 * Dekode satu berkas (`.xlsx`/`.xls`/`.csv` — satu-satunya ekstensi yang lolos
 * pagar `evaluatePdtZipPagar`, Rule 41) jadi array-of-arrays. `XLSX.read`
 * mengendus format lewat ISI berkas, bukan ekstensi (pola SAMA dengan
 * `web-internal`'s `parseExportFile`, yang juga tidak pernah memeriksa
 * ekstensi sebelum memanggil `XLSX.read`) — jadi satu fungsi menangani
 * ketiganya.
 */
export function decodePdtAoa(bytes: Buffer): unknown[][] {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const namaSheet = wb.SheetNames[0];
  if (!namaSheet) throw new Error('berkas tidak berisi sheet apa pun');
  return decodeSheetAoa(wb, namaSheet);
}

function decodeSheetAoa(wb: XLSX.WorkBook, namaSheet: string): unknown[][] {
  const ws = wb.Sheets[namaSheet];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
}

/**
 * Dekode SELURUH sheet yang mungkin dibutuhkan modul manapun di `modules`
 * (G1-09-SHEET-BUKAN-PERTAMA) — sheet PERTAMA workbook (fallback lama) SELALU
 * ikut, ditambah tiap `namaSheet` DAN `sheetTambahan` (sesi 34) yang benar-
 * benar ADA di workbook INI (sheet yang tidak ada di berkas ini dilewati,
 * bukan error — kebanyakan berkas hanya bawa sebagian kecil dari seluruh
 * sheet yang registry sebut). `sheetTambahan` murni menambah cakupan
 * ekstraksi, TIDAK ikut proses deteksi (`detectPdtModuleAntarSheet` hanya
 * membaca `namaSheet`).
 */
function decodeSheetsRelevan(wb: XLSX.WorkBook, modules: readonly PdtModuleDef[]): Map<string, unknown[][]> {
  const namaDibutuhkan = new Set<string>();
  if (wb.SheetNames[0]) namaDibutuhkan.add(wb.SheetNames[0]);
  for (const m of modules) {
    if (m.namaSheet) namaDibutuhkan.add(m.namaSheet);
    // `sheetTambahan` (sesi 34, G1-09-2BII-SHOPDAILY-SHOPEE): sheet EKSTRA
    // yang modul ini butuh selain `namaSheet` — murni supaya ikut masuk
    // `input.sheets`, bukan sinyal deteksi (lihat `PdtModuleDef.sheetTambahan`).
    for (const nama of m.sheetTambahan ?? []) namaDibutuhkan.add(nama);
  }

  const sheets = new Map<string, unknown[][]>();
  for (const nama of namaDibutuhkan) {
    if (!wb.SheetNames.includes(nama)) continue;
    sheets.set(nama, decodeSheetAoa(wb, nama));
  }
  return sheets;
}

/**
 * Dekode + deteksi modul untuk SELURUH entri yang `bacaDanEkstrakPdtZip`
 * (G1-04) ekstrak ke disk sementara (`diekstrak`, sudah difilter keputusan
 * `diproses` oleh pagar — modul ini tidak mengulang keputusan Rule 41/42).
 *
 * G1-09-SHEET-BUKAN-PERTAMA (`docs/DECISIONS.md`): tiap modul dicocokkan
 * terhadap SHEET-NYA SENDIRI (`PdtModuleDef.namaSheet`, default sheet
 * pertama) — bukan satu sheet pertama dipaksakan untuk seluruh modul seperti
 * sebelumnya (bug yang membuat `shopee_live`/`shopee_shop_stats` menjadi kode
 * mati untuk berkas asli multi-sheet).
 */
export async function parsePdtZipEntries(
  diekstrak: readonly PdtZipEntriTerekstrak[],
  modules: readonly PdtModuleDef[],
): Promise<PdtParseBatchHasil> {
  const mulai = Date.now();
  const berkas: PdtParsedFile[] = [];
  const gagal: PdtParseGagal[] = [];

  for (const entri of diekstrak) {
    try {
      const bytes = await readFile(entri.pathSementara);
      const wb = XLSX.read(bytes, { type: 'buffer' });
      if (!wb.SheetNames[0]) throw new Error('berkas tidak berisi sheet apa pun');
      const sheets = decodeSheetsRelevan(wb, modules);
      const deteksi = detectPdtModuleAntarSheet(sheets, wb.SheetNames, modules);
      // Nol/lebih dari satu modul cocok ⇒ nol AoA tunggal yang benar untuk
      // mewakilinya — sheet PERTAMA dipakai murni untuk pratinjau AM (Rule 7
      // baris/kolom yang ditampilkan tetap harus ada isinya), sama seperti
      // perilaku SEBELUM perbaikan ini.
      const aoa = (deteksi.aoa ?? sheets.get(wb.SheetNames[0]) ?? []) as unknown[][];
      berkas.push({ nama: entri.meta.nama, aoa, sheets, modul: deteksi.kode, ambiguous: deteksi.ambiguous, matches: deteksi.matches });
    } catch (err) {
      gagal.push({ nama: entri.meta.nama, pesan: err instanceof Error ? err.message : String(err) });
    }
  }

  return { berkas, gagal, durasiMs: Date.now() - mulai };
}
