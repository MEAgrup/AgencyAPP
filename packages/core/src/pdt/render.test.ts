import { describe, expect, it } from 'vitest';
import {
  bangunLaporanShopee,
  bangunLaporanTiktok,
  type PdtLaporanShopee,
  type PdtLaporanShopeeOptions,
  type PdtLaporanTiktok,
  type PdtLaporanTiktokOptions,
} from './laporan';
import { namaBerkasLaporan, renderLaporanHtml, type RenderMode } from './render';
import { computeSkorShopee, computeSkorTiktok, type PdtBenchmarkTiktok, type PdtSkorInputShopee, type PdtSkorInputTiktok } from './skor';

// ---------------------------------------------------------------------------
// Fixtures — built through the REAL payload builders (`bangunLaporanTiktok`/
// `bangunLaporanShopee`), not hand-rolled `as any` stubs, so the renderer is
// exercised against realistic shapes the same way `laporan.test.ts` builds them.
// ---------------------------------------------------------------------------

const BENCH: PdtBenchmarkTiktok = {
  roi_gmvmax: { good: 8, warn: 4 },
  cpa_ratio: { good: 0.1, warn: 0.2 },
  gmv_per_jam_live: { good: 300_000, warn: 150_000 },
  sesi_live: { good: 20, warn: 12 },
  gpm_video: { good: 30_000, warn: 10_000 },
  pct_video_sales: { good: 0.05, warn: 0.02 },
  cvr_toko: { good: 0.015, warn: 0.008 },
  pct_kreator_produktif: { good: 0.2, warn: 0.1 },
};

// `produk: null` on purpose — this is the "excluded dimension" the internal-only
// per-dimension note (`labelTampil`) test below reads.
const SKOR_INPUT_TIKTOK_PENUH: PdtSkorInputTiktok = {
  ads: { biaya: 2_000_000, gmv: 10_000_000, pesanan: 100, burnSpend: 100_000, biayaProduk: 1_500_000 },
  live: { gmv: 5_000_000, jamTotal: 20, sesi: 10, sesiNol: 1 },
  video: { total: 30, adaPenjualan: 10, gmv: 3_000_000, vv: 100_000 },
  kartu: { gmvKartu: 4_000_000, gmvTotal: 20_000_000, cvr: 0.02 },
  affiliate: { produktif: 5, total: 10, gmv: 2_000_000, gmvKotorToko: 20_000_000 },
  produk: null,
};

const SKOR_INPUT_TIKTOK_KOSONG: PdtSkorInputTiktok = { ads: null, live: null, video: null, kartu: null, affiliate: null, produk: null };

const SKOR_INPUT_SHOPEE_PENUH: PdtSkorInputShopee = {
  ads: { spend: 1_000_000, omzet: 5_000_000, ctr: 0.02 },
  dibuat: { cr: 0.03, repeatRate: 0.2, cancelRate: 0.05 },
  produk: null,
  live: { diunggah: true, sesi: 8 },
  kesehatan: { poinTotal: 0 },
};

const TIKTOK_FULL_BASE: PdtLaporanTiktokOptions = {
  clientPlatformId: 101,
  periodeAwalBulan: '2026-08-01',
  generatedAt: '2026-09-01T00:00:00.000Z',
  // `produkDiklik: null` deliberately — `barangPerPengunjung`/`kedalaman` stay
  // null while `gmv`/`pesanan`/`pengunjung`/`cvr` are known: exactly the
  // "one null metric inside an otherwise-populated section" case R2.3 covers.
  kpi: { gmv: 20_000_000, pesanan: 400, pengunjung: 20_000, produkDiklik: null },
  harian: [
    { tanggal: '2026-08-01', gmv: 1_000_000, pesanan: 20, pengunjung: 1_000 },
    { tanggal: '2026-08-02', gmv: 800_000, pesanan: 15, pengunjung: 900 },
  ],
  kanal: { gmvTotal: 20_000_000, live: 8_000_000, video: 5_000_000 },
  iklan: { product: { biaya: 1_000_000, gmv: 4_000_000 }, live: { biaya: 1_000_000, gmv: 6_000_000 } },
  live: { sesi: 10, gmv: 5_000_000, vv: 100_000, jam: 20 },
  video: { total: 30, gmv: 3_000_000, vv: 100_000, likes: 5_000, dibagikan: 1_000, klikProduk: 2_000 },
  produk: [
    { kuadran: 'bintang', namaProduk: 'Produk A', platformProductId: 'P1', gmv: 3_000_000, klik: 500, traffic: 500, impresi: 10_000, cvr: 0.1 },
    { kuadran: 'bocor_traffic', namaProduk: 'Produk B', platformProductId: 'P2', gmv: 1_000_000, klik: 800, traffic: 800, impresi: 20_000, cvr: 0.01 },
    { kuadran: 'tidur', namaProduk: 'Produk C', platformProductId: 'P3', gmv: 10_000, klik: 3, traffic: 3, impresi: 100, cvr: null },
  ],
  afiliasi: { totalKreator: 10, produktif: 5, gmv: 2_000_000, pesanan: 40, jumlahLive: 3, jumlahVideo: 8 },
  kreator: [
    { handle: '@kreator1', gmv: 1_200_000, gmvLive: 800_000, gmvVideo: 400_000, pesanan: 24, jumlahLive: 2, jumlahVideo: 5 },
    { handle: '@kreator2', gmv: 800_000, gmvLive: null, gmvVideo: 800_000, pesanan: 16, jumlahLive: null, jumlahVideo: 3 },
  ],
  sesiLive: [
    { platformContentId: 'L1', creatorHandle: null, akunToko: true, waktuPosting: '2026-08-01T20:00:00.000Z', durasiDetik: 7_200, vv: 50_000, gmv: 3_000_000, pengikutBaru: 100, klikProduk: 500 },
    { platformContentId: 'L2', creatorHandle: '@mitra', akunToko: false, waktuPosting: null, durasiDetik: null, vv: 20_000, gmv: 1_000_000, pengikutBaru: null, klikProduk: null },
  ],
  kampanye: [
    { sumber: 'tt_ads_product', kampanyeId: 'CMP-1', biaya: 500_000, gmv: 2_000_000, tayangan: 100_000, klik: 5_000, pesanan: 40 },
    { sumber: 'tt_ads_live', kampanyeId: 'CMP-2', biaya: 500_000, gmv: 0, tayangan: 50_000, klik: 2_000, pesanan: 0 },
  ],
  tahap: { tahapFokus: 'conversion', klik: 6_000, cpaInput: { biaya: 1_000_000, pesanan: 40 }, affPosting: 6, ttamFunnel: null },
  skor: computeSkorTiktok(SKOR_INPUT_TIKTOK_PENUH, BENCH),
  benchmarkVersi: 7,
  benchTiktok: BENCH,
};

function buildTiktokFull(): PdtLaporanTiktok {
  return bangunLaporanTiktok(TIKTOK_FULL_BASE);
}

/** Same store, but the optional file-backed sections were never uploaded — for the numbering test and the "whole section null" test. */
function buildTiktokSebagian(): PdtLaporanTiktok {
  return bangunLaporanTiktok({
    ...TIKTOK_FULL_BASE,
    harian: null,
    kanal: null,
    iklan: null,
    live: null,
    video: null,
    produk: null,
    afiliasi: null,
    kreator: null,
    sesiLive: null,
    kampanye: null,
    skor: computeSkorTiktok(SKOR_INPUT_TIKTOK_KOSONG, BENCH),
  });
}

const SHOPEE_FULL_BASE: PdtLaporanShopeeOptions = {
  clientPlatformId: 202,
  periodeAwalBulan: '2026-08-01',
  generatedAt: '2026-09-01T00:00:00.000Z',
  kpi: { gmv: 15_000_000, pesanan: 300, pengunjung: 15_000, produkDiklik: 18_000 },
  harian: [
    { tanggal: '2026-08-01', gmv: 500_000, pesanan: 10, pengunjung: 600 },
    { tanggal: '2026-08-02', gmv: null, pesanan: null, pengunjung: 400 },
  ],
  kanal: { gmvTotal: 15_000_000, shopeeAds: 3_000_000, affiliate: 1_500_000 },
  iklan: { cpc: { biaya: 800_000, gmv: 3_200_000 }, search: { biaya: 200_000, gmv: null }, live: null },
  live: { sesi: 8, gmv: 2_000_000, vv: 40_000, jam: null },
  video: null,
  produk: [
    { kuadran: 'bintang', namaProduk: 'Produk S1', platformProductId: 'S1', gmv: 2_000_000, klik: null, traffic: 300, impresi: 5_000, cvr: 0.1 },
  ],
  afiliasi: { totalKreator: 6, produktif: 3, gmv: 1_500_000, pesanan: 30, jumlahLive: null, jumlahVideo: null },
  kreator: [
    { handle: '@shopkreator1', gmv: 900_000, gmvLive: null, gmvVideo: null, pesanan: 18, jumlahLive: null, jumlahVideo: null },
  ],
  sesiLive: [
    { platformContentId: 'SL1', creatorHandle: null, akunToko: true, waktuPosting: '2026-08-05T19:00:00.000Z', durasiDetik: null, vv: 10_000, gmv: 2_000_000, pengikutBaru: null, klikProduk: null },
  ],
  kampanye: [
    { sumber: 'shopee_ads_cpc', kampanyeId: 'SCMP-1', biaya: 800_000, gmv: 3_200_000, tayangan: 60_000, klik: 3_000, pesanan: 30 },
  ],
  promo: [
    { jenis: 'diskon', tipePromosi: 'Semua', penjualanDibuat: 4_000_000, penjualanSiapDikirim: 3_500_000, pesananDibuat: 70, pesananSiapDikirim: 60, produkDilihat: null, produkDiklik: null },
    { jenis: 'flash_sale', tipePromosi: null, penjualanDibuat: 1_000_000, penjualanSiapDikirim: 800_000, pesananDibuat: 20, pesananSiapDikirim: 18, produkDilihat: 5_000, produkDiklik: 400 },
  ],
  layanan: {
    chat: { barisSumber: 1, pengunjung: 5_000, chatMasuk: 400, chatDibalas: 380, waktuResponDetik: 1_800, csatPersen: 92.5, totalPesanan: 60, penjualan: 12_000_000, tingkatKonversiChatDibalasPersen: 15.8 },
    penalti: [{ poin: 1, deskripsi: 'Keterlambatan kirim', durasi: '30 hari' }],
  },
  skor: computeSkorShopee(SKOR_INPUT_SHOPEE_PENUH),
};

function buildShopeeFull(): PdtLaporanShopee {
  return bangunLaporanShopee(SHOPEE_FULL_BASE);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts the `N.` prefix of every NUMBERED section header — the skor card and the KPI tiles never match this (they don't carry a `sec-ico` span). */
function extractSectionNumbers(html: string): number[] {
  const re = /<span class="sec-ico">[\s\S]*?<\/span>(\d+)\.\s/g;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) nums.push(Number(m[1]));
  return nums;
}

function renderBoth(laporan: PdtLaporanTiktok | PdtLaporanShopee): { klien: string; internal: string } {
  return { klien: renderLaporanHtml(laporan, 'klien'), internal: renderLaporanHtml(laporan, 'internal') };
}

// ---------------------------------------------------------------------------
// R1/R2 — klien mode never leaks internal-only content
// ---------------------------------------------------------------------------

describe('R1/R2 — klien HTML never contains internal-only content (real substring checks, not structural)', () => {
  it.each([
    ['tiktok', () => buildTiktokFull()],
    ['shopee', () => buildShopeeFull()],
  ] as const)('%s: zero occurrences of INTERNAL badge / dimension notes / benchmark version / kelengkapan text', (_label, build) => {
    const { klien, internal } = renderBoth(build());

    // The literal word never appears anywhere in klien output — every internal
    // block (header ribbon, kelengkapan cards, benchmark note, excluded-dimension
    // note) carries this token, so its total absence is a strong single check.
    expect(klien).not.toContain('INTERNAL');
    expect(internal).toContain('INTERNAL');

    // Per-dimension score note (`labelTampil`, the ONE per-dimension note field
    // the PDT payload carries — `produk` is deliberately excluded in the fixture).
    expect(klien).not.toContain('data tidak tersedia');
    expect(internal).toContain('data tidak tersedia');

    // Benchmark/engine version.
    expect(klien).not.toContain('benchmark versi');

    // The `kelengkapan` block entirely — heading text AND its `alasan` prose.
    expect(klien).not.toContain('Kelengkapan');
  });

  it('tiktok: kelengkapan alasan text ("belum dipanen ke fakta") is internal-only', () => {
    const { klien, internal } = renderBoth(buildTiktokFull());
    expect(klien).not.toContain('belum dipanen ke fakta');
    expect(internal).toContain('belum dipanen ke fakta');
    expect(internal).toContain('benchmark versi 7');
  });

  it('shopee: kelengkapan alasan text ("belum diproses PDT") is internal-only', () => {
    const { klien, internal } = renderBoth(buildShopeeFull());
    expect(klien).not.toContain('belum diproses PDT');
    expect(internal).toContain('belum diproses PDT');
    // Shopee's payload never carries `benchmarkVersi` at all (asimetri asli).
    expect(internal).not.toContain('Benchmark versi');
  });
});

// ---------------------------------------------------------------------------
// R2.3 — null metrics: omitted (klien) vs `—` (internal)
// ---------------------------------------------------------------------------

describe('R2.3 — a null metric inside an otherwise-populated section', () => {
  it('tiktok: "Kedalaman Jelajah" (barangPerPengunjung/kedalaman null, produkDiklik not supplied) is absent from klien, present with — in internal', () => {
    const { klien, internal } = renderBoth(buildTiktokFull());
    expect(klien).not.toContain('Kedalaman Jelajah');
    expect(internal).toContain('Kedalaman Jelajah');
  });

  it('shopee: harian day with gmv/pesanan null keeps other days\' data but never shows a bare dash in klien for that day', () => {
    const { klien } = renderBoth(buildShopeeFull());
    // The day itself is real (2026-08-02, pengunjung known) — its GMV cell is
    // simply blank in klien, never rendered as the placeholder dash.
    expect(klien).not.toMatch(/2026-08-02[\s\S]{0,40}—/);
  });
});

describe('R2.3 — a whole section whose core data is null', () => {
  it('tiktok: no iklan/kampanye uploaded ⇒ "Total Belanja Iklan"/"Rincian Kampanye" content entirely skipped in klien, shown as an empty-state note in internal', () => {
    const { klien, internal } = renderBoth(buildTiktokSebagian());
    expect(klien).not.toContain('Total Belanja Iklan');
    // iklan is null here too — internal shows the empty-state note, not the KPI tile.
    expect(internal).not.toContain('Total Belanja Iklan');
    expect(internal).toContain('Berkas iklan tidak diunggah');
    expect(klien).not.toContain('Berkas iklan tidak diunggah');
  });
});

// ---------------------------------------------------------------------------
// R2.4 — section numbers computed per mode, contiguous, no gaps
// ---------------------------------------------------------------------------

describe('R2.4 — section numbering is contiguous per mode', () => {
  it.each([
    ['tiktok penuh', () => buildTiktokFull()],
    ['tiktok sebagian', () => buildTiktokSebagian()],
    ['shopee penuh', () => buildShopeeFull()],
  ] as const)('%s: klien and internal numbering both start at 1 with no gaps', (_label, build) => {
    const { klien, internal } = renderBoth(build());
    const nKlien = extractSectionNumbers(klien);
    const nInternal = extractSectionNumbers(internal);

    expect(nKlien.length).toBeGreaterThan(0);
    expect(nKlien).toEqual(Array.from({ length: nKlien.length }, (_, i) => i + 1));
    expect(nInternal).toEqual(Array.from({ length: nInternal.length }, (_, i) => i + 1));

    // internal always carries AT LEAST the same sections as klien plus the
    // kelengkapan block (klien never builds it at all) — never fewer.
    expect(nInternal.length).toBeGreaterThanOrEqual(nKlien.length);
  });

  it('tiktok penuh has strictly more numbered sections in klien than tiktok sebagian (iklan/live/video/produk/afiliasi/… actually render)', () => {
    const nPenuh = extractSectionNumbers(renderLaporanHtml(buildTiktokFull(), 'klien'));
    const nSebagian = extractSectionNumbers(renderLaporanHtml(buildTiktokSebagian(), 'klien'));
    expect(nPenuh.length).toBeGreaterThan(nSebagian.length);
  });
});

// ---------------------------------------------------------------------------
// Structural parity — both platforms render valid, non-throwing HTML
// ---------------------------------------------------------------------------

describe('structural parity — tiktok and shopee both render through the SAME renderer', () => {
  it.each([
    ['tiktok', () => buildTiktokFull()],
    ['shopee', () => buildShopeeFull()],
  ] as const)('%s: klien and internal both produce a well-formed standalone document', (_label, build) => {
    const laporan = build();
    for (const mode of ['klien', 'internal'] as RenderMode[]) {
      const html = renderLaporanHtml(laporan, mode);
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('</html>');
      expect(html.length).toBeGreaterThan(1000);
    }
  });

  it('does not throw on the minimal/no-uploads variant either', () => {
    const laporan = buildTiktokSebagian();
    expect(() => renderLaporanHtml(laporan, 'klien')).not.toThrow();
    expect(() => renderLaporanHtml(laporan, 'internal')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// namaBerkasLaporan
// ---------------------------------------------------------------------------

describe('namaBerkasLaporan', () => {
  it('differs between klien and internal for the same payload, each carrying its own mode token', () => {
    const laporan = buildTiktokFull();
    const klien = namaBerkasLaporan(laporan, 'klien');
    const internal = namaBerkasLaporan(laporan, 'internal');
    expect(klien).not.toBe(internal);
    expect(klien).toContain('klien');
    expect(internal).toContain('internal');
    expect(klien).toContain('101');
    expect(klien).toContain('2026-08-01');
  });

  it('differs between tiktok and shopee for otherwise-identical mode', () => {
    const t = namaBerkasLaporan(buildTiktokFull(), 'klien');
    const s = namaBerkasLaporan(buildShopeeFull(), 'klien');
    expect(t).not.toBe(s);
    expect(t).toContain('TikTok');
    expect(s).toContain('Shopee');
  });
});
