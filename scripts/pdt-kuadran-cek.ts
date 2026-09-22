#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Pemeriksa kuadran produk PDT — jalankan mesin laporan langsung di atas satu
 * berkas ekspor platform, TANPA database, TANPA unggah, TANPA server.
 *
 * ## Kenapa ini ada
 *
 * Menguji laporan PDT lewat jalur normal berarti: bangun DB lokal → seed →
 * mint JWT → nyalakan dua server → unggah ZIP → commit batch → buka halaman.
 * Tujuh langkah sebelum satu angka bisa dilihat. Kalau yang ingin dijawab cuma
 * *"apakah kuadran produk toko ini keluar sama dengan mesin HTML lama?"*,
 * seluruh rantai itu adalah biaya tanpa hasil tambahan — dan lebih buruk: bila
 * angkanya beda, tujuh langkah itu tidak memberi tahu langkah MANA yang salah.
 *
 * Skrip ini memotongnya jadi satu perintah dan satu berkas, memanggil FUNGSI
 * YANG SAMA dengan yang dipakai pipeline sungguhan (`@cdps/core` `pdt/*`), lalu
 * MEMBANDINGKANNYA dengan mesin HTML lama (`@cdps/core` `report/*`) di berkas
 * yang sama. Jadi keluarannya bukan "ini angka PDT" tapi "ini angka PDT DAN
 * angka mesin lama, identik/tidak".
 *
 * Yang TIDAK diuji di sini, dan sengaja: penulisan fakta ke DB, RLS, izin,
 * rekonsiliasi antar-modul, dan render FE. Skrip ini hanya lapisan hitung.
 * Kalau angka di sini benar tapi di halaman salah, salahnya ADA di antara
 * keduanya — dan itu justru informasi yang berguna.
 *
 * ## Pakai
 *
 *   npx tsx scripts/pdt-kuadran-cek.ts <berkas.xlsx> [berkas lain…]
 *   npx tsx scripts/pdt-kuadran-cek.ts <folder>        # seluruh xlsx di dalamnya, rekursif
 *
 * Berkas yang dikenali (deteksi berbasis ISI, Rule 6 — nama berkas tidak
 * dipakai sama sekali, jadi ekspor yang sudah di-rename tim tetap terbaca):
 *   - `shopee_parent_sku`      → kuadran Shopee (sumbu pengunjung produk)
 *   - `tt_product_analytics`   → kuadran TikTok (sumbu klik produk)
 *   - `shopee_shop_stats`      → kedalaman jelajah toko (basis `siap_dikirim`)
 *   - `tt_shop_analytics`      → kedalaman jelajah toko (basis `net`)
 * Modul lain dilaporkan terdeteksi lalu dilewati — bukan error.
 */
import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import * as XLSX from 'xlsx';
import { pdt, baseline, report, reportShopee } from '@cdps/core';

// ---------------------------------------------------------------------------
// argumen
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('pakai: npx tsx scripts/pdt-kuadran-cek.ts <berkas.xlsx|folder> [...]');
  process.exit(2);
}

function kumpulkanBerkas(p: string): string[] {
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) {
    console.error(`  ! tidak ada: ${p}`);
    return [];
  }
  if (st.isFile()) return ['.xlsx', '.xls', '.csv'].includes(extname(p).toLowerCase()) ? [p] : [];
  return readdirSync(p)
    .filter((n) => !n.startsWith('.') && !n.startsWith('~$')) // ~$ = berkas kunci Excel
    .flatMap((n) => kumpulkanBerkas(join(p, n)));
}

const berkasSemua = argv.flatMap(kumpulkanBerkas).sort();
if (berkasSemua.length === 0) {
  console.error('nol berkas spreadsheet ditemukan.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------
type Aoa = readonly (readonly unknown[])[];

const KUADRAN_TIKTOK = ['bintang', 'hidden_gem', 'bocor_traffic', 'evaluasi', 'tidur', 'tidak_tayang'] as const;

function sheetsDari(file: string): { urutan: string[]; peta: Map<string, Aoa> } {
  const wb = XLSX.readFile(file, { cellDates: false });
  const peta = new Map<string, Aoa>();
  for (const nama of wb.SheetNames) {
    peta.set(nama, XLSX.utils.sheet_to_json(wb.Sheets[nama], {
      header: 1, raw: true, defval: null, blankrows: false,
    }) as Aoa);
  }
  return { urutan: [...wb.SheetNames], peta };
}

function hitung(hasil: readonly { kuadran: string }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const h of hasil) m[h.kuadran] = (m[h.kuadran] ?? 0) + 1;
  return m;
}

function baris(m: Record<string, number>, kunci: readonly string[]): string {
  return kunci.map((k) => `${k}=${String(m[k] ?? 0).padStart(4)}`).join('  ');
}

function samakan(a: Record<string, number>, b: Record<string, number>, kunci: readonly string[]): boolean {
  return kunci.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

function cetakBanding(
  judul: string,
  lama: Record<string, number>,
  baru: Record<string, number>,
  kunci: readonly string[],
): boolean {
  const identik = samakan(lama, baru, kunci);
  console.log(`    ${judul}`);
  console.log(`      mesin HTML lama : ${baris(lama, kunci)}`);
  console.log(`      PDT             : ${baris(baru, kunci)}`);
  console.log(`      ${identik ? '✓ IDENTIK' : '✗ BEDA'}`);
  return identik;
}

function persen(x: number | null): string {
  return x == null ? '—' : `${(x * 100).toFixed(2).replace('.', ',')}%`;
}

// ---------------------------------------------------------------------------
// Shopee
// ---------------------------------------------------------------------------
function periksaShopee(aoa: Aoa, modul: (typeof pdt.PDT_MODULES)[number]): boolean[] {
  const barisHeader = pdt.temukanBarisHeader(aoa, modul.kolomDipanen, modul.barisHeaderHint);
  const fakta = pdt.ekstrakBarisFaktaSkuShopeeParentSku(aoa, barisHeader);
  const untukKuadran = fakta.map((b, i) => ({ id: i, pengunjung: b.pengunjung, pesananDibuat: b.pesananDibuat }));

  // Mesin HTML lama membaca sheet yang SAMA, lewat parsernya sendiri.
  const lama = reportShopee.computeQuadrants(
    reportShopee.parseBisnisProduk(aoa as never),
    reportShopee.REPORT_BENCH_SHOPEE_V1,
  );
  const kunci = reportShopee.ALL_KUADRAN_SHOPEE;

  console.log(`    ${fakta.length} baris produk (baris header ke-${barisHeader})`);
  const ok: boolean[] = [];

  ok.push(cetakBanding(
    'mode ABSOLUT (ambang tetap 150/500 · 2%/4%)',
    Object.fromEntries(kunci.map((k) => [k, lama.mode_absolute[k].length])),
    hitung(pdt.klasifikasikanKuadranSkuShopee(untukKuadran)),
    kunci,
  ));

  const ambang = pdt.ambangRelatifKuadran(
    untukKuadran.map((b) => ({ id: b.id, traffic: b.pengunjung, cr: pdt.crKuadranShopee(b) })),
    pdt.PDT_KUADRAN_SHOPEE.pengunjungMinUji,
    false, // Shopee: percentile atas SELURUH CR aktif (beda TikTok — lihat kuadran.ts)
  );
  ok.push(cetakBanding(
    `mode RELATIF (p25/p75 katalog: traffic ${ambang.trafficRendah}/${ambang.trafficTinggi} · cr ${persen(ambang.crRendah)}/${persen(ambang.crTinggi)}, n=${ambang.n})`,
    Object.fromEntries(kunci.map((k) => [k, lama.mode_relatif[k].length])),
    hitung(pdt.klasifikasikanKuadranSkuShopee(untukKuadran, ambang)),
    kunci,
  ));

  return ok;
}

// ---------------------------------------------------------------------------
// Kedalaman jelajah — dibaca dari fakta HARIAN toko, bukan dari Σ katalog.
//
// Σ per-produk BUKAN angka toko: satu pengunjung yang membuka lima barang
// terhitung lima kali di kolom `Pengunjung Produk`. Rasio hasilnya terlihat
// mirip KPI tapi menjawab pertanyaan lain, jadi ia sengaja TIDAK dihitung di
// sini — `pdt_fact_shop_daily` (basis Rule 16 Shopee / Rule 15 TikTok) adalah
// sumber yang laporan sungguhan pakai, dan itu yang dibaca di bawah.
// ---------------------------------------------------------------------------
function cetakKedalaman(
  harian: readonly { gmv: number; pesanan: number; pengunjung: number | null; produkDiklik: number | null }[],
  labelBasis: string,
): void {
  if (harian.length === 0) return;
  const jumlah = (f: (b: (typeof harian)[number]) => number | null): number | null => {
    let ada = false;
    let t = 0;
    for (const b of harian) {
      const v = f(b);
      if (v != null) { ada = true; t += v; }
    }
    return ada ? t : null; // Rule 12: nol baris berisi ⇒ TIDAK DIKETAHUI, bukan 0
  };
  const pengunjung = jumlah((b) => b.pengunjung);
  if (pengunjung == null || pengunjung === 0) {
    console.log(`    kedalaman jelajah: — (nol pengunjung terbaca, basis ${labelBasis})`);
    return;
  }
  const kpi = pdt.bangunKpiRingkas({
    gmv: jumlah((b) => b.gmv) ?? 0,
    pesanan: jumlah((b) => b.pesanan) ?? 0,
    pengunjung,
    produkDiklik: jumlah((b) => b.produkDiklik),
  });
  const diklik = jumlah((b) => b.produkDiklik);
  console.log(`    kedalaman jelajah (${harian.length} hari, basis ${labelBasis})`);
  console.log(`      pengunjung ${pengunjung.toLocaleString('id-ID')} · barang dibuka ${diklik == null ? '—' : diklik.toLocaleString('id-ID')}`);
  console.log(
    `      barang/pengunjung ${kpi.barangPerPengunjung == null ? '—' : kpi.barangPerPengunjung.toFixed(2).replace('.', ',')}`
    + ` · kedalaman ${kpi.kedalaman ?? '—'} · CR ${persen(kpi.cvr)}`,
  );
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------
function periksaTiktok(aoa: Aoa, modul: (typeof pdt.PDT_MODULES)[number], namaBerkas: string): boolean[] {
  const barisHeader = pdt.temukanBarisHeader(aoa, modul.kolomDipanen, modul.barisHeaderHint);
  const fakta = pdt.ekstrakBarisTtProductAnalytics(aoa, barisHeader);
  const untukKuadran = fakta.map((b, i) => ({
    id: i,
    klik: b.klik,
    ctor: b.ctor,
    pesananSku: b.pesananSku,
  }));

  const sheet = baseline.readSheet(aoa as never, namaBerkas);
  const lama = sheet ? report.kuadranProduk(sheet, report.REPORT_BENCH_V1) : null;
  if (!lama) {
    console.log('    ! mesin HTML lama tidak bisa membaca sheet ini — pembandingan dilewati');
    return [];
  }

  console.log(`    ${fakta.length} baris produk (baris header ke-${barisHeader})`);
  const ok: boolean[] = [];

  ok.push(cetakBanding(
    `mode BENCHMARK (quad_klik good=${report.REPORT_BENCH_V1.quad_klik.good} · quad_cvr good=${persen(report.REPORT_BENCH_V1.quad_cvr.good)})`,
    Object.fromEntries(KUADRAN_TIKTOK.map((k) => [k, lama.benchmark[k].length])),
    hitung(pdt.klasifikasikanKuadranSkuTiktok(untukKuadran, {
      quad_klik: report.REPORT_BENCH_V1.quad_klik,
      quad_cvr: report.REPORT_BENCH_V1.quad_cvr,
    })),
    KUADRAN_TIKTOK,
  ));

  const trafficCr = untukKuadran.map((b) => ({
    id: b.id,
    traffic: b.klik,
    cr: b.ctor ?? (b.pesananSku != null && b.klik ? b.pesananSku / b.klik : null),
  }));
  const ambang = pdt.ambangRelatifKuadran(trafficCr, pdt.KLIK_MIN_UJI, true); // TikTok: CVR POSITIF saja
  ok.push(cetakBanding(
    `mode RELATIF (p25/p75 katalog: klik ${ambang.trafficRendah}/${ambang.trafficTinggi} · cvr ${persen(ambang.crRendah)}/${persen(ambang.crTinggi)}, n=${ambang.n})`,
    Object.fromEntries(KUADRAN_TIKTOK.map((k) => [k, lama.relatif[k].length])),
    hitung(pdt.klasifikasikanKuadranRelatifTiktok(trafficCr, pdt.KLIK_MIN_UJI, ambang)),
    KUADRAN_TIKTOK,
  ));
  return ok;
}

// ---------------------------------------------------------------------------
// jalan
// ---------------------------------------------------------------------------
const dasar = process.cwd();
let diperiksa = 0;
const semuaOk: boolean[] = [];

for (const file of berkasSemua) {
  let sheets: ReturnType<typeof sheetsDari>;
  try {
    sheets = sheetsDari(file);
  } catch (e) {
    console.log(`\n${relative(dasar, file)}\n    ! gagal dibaca: ${(e as Error).message}`);
    continue;
  }
  const deteksi = pdt.detectPdtModuleAntarSheet(sheets.peta, sheets.urutan, pdt.PDT_MODULES);
  const modul = pdt.PDT_MODULES.find((m) => m.kode === deteksi.kode);

  console.log(`\n${relative(dasar, file)}`);
  if (!modul) {
    console.log(`    modul: ${deteksi.ambiguous ? `AMBIGU (${deteksi.matches.join(', ')})` : 'tidak terdeteksi'} — dilewati`);
    continue;
  }
  console.log(`    modul: ${modul.kode} (${modul.namaTampilan})`);

  const aoa = deteksi.aoa;
  if (!aoa) continue;
  if (modul.kode === 'shopee_parent_sku') {
    diperiksa++;
    semuaOk.push(...periksaShopee(aoa, modul));
  } else if (modul.kode === 'tt_product_analytics') {
    diperiksa++;
    semuaOk.push(...periksaTiktok(aoa, modul, file));
  } else if (modul.kode === 'shopee_shop_stats') {
    // Basis 'Pesanan Siap Dikirim' — basis KPI Shopee (Rule 16), sheet yang sama
    // dengan yang penulis fakta pakai untuk `pdt_fact_shop_daily` basis `siap_dikirim`.
    const sheetBasis = sheets.peta.get('Pesanan Siap Dikirim');
    if (!sheetBasis) console.log("    (nol sheet 'Pesanan Siap Dikirim' — kedalaman dilewati)");
    else cetakKedalaman(pdt.ekstrakBarisShopDailyShopee(sheetBasis), 'siap_dikirim (Rule 16)');
  } else if (modul.kode === 'tt_shop_analytics') {
    cetakKedalaman(pdt.ekstrakBarisShopDailyTiktok(aoa), 'net (Rule 15)');
  } else {
    console.log('    (bukan modul kuadran produk — dilewati)');
  }
}

const gagal = semuaOk.filter((x) => !x).length;
console.log(`\n${'-'.repeat(60)}`);
console.log(`${diperiksa} berkas kuadran diperiksa · ${semuaOk.length} pembandingan · ${gagal} BEDA`);
process.exit(gagal > 0 ? 1 : 0);
