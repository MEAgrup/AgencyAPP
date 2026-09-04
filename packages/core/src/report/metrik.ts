/**
 * Report engine — per-section metrics (`cdps.report.tiktok.v1`).
 *
 * Ported from the tool's `build*` functions. Three rules govern every number
 * here, and they are why this is not a copy-paste of the HTML:
 *
 *  1. **Absent column ≠ zero.** The tool read every missing column as 0, so a
 *     TikTok rename turned into "Rp0" on a client-facing page. Here an optional
 *     column that is absent reads `null`, and `null` renders `—` (house rule #7).
 *     A present-but-empty CELL is still 0 — that is `n()`'s job, unchanged.
 *  2. **Division by zero is `null`, not 0 and not an error** (`div`, house rule #7).
 *  3. **The store summary is not re-derived.** `toko()` from the baseline engine
 *     is reused verbatim, so the GMV on a monthly report and the GMV on the
 *     store baseline can never disagree — one reader, one number.
 */
import { div, n } from '../baseline/angka';
import { durH, type TokoMetric } from '../baseline/metrik';
import { requireCols } from '../baseline/errors';
import type { Sheet } from '../baseline/types';
import { colIndex, hasCol } from './detect';
import type { Rentang, ReportBench, ReportSlots } from './types';

// ---------------------------------------------------------------------------
// Case-insensitive row reader
// ---------------------------------------------------------------------------
/**
 * Column access by lowercase label. Seller Center has shipped the same column
 * under different capitalisation across exports ("Klik Produk" / "Klik produk"),
 * and the tool normalised headers to lowercase for exactly that reason — so the
 * lookup key here is the lowercase label, same as the tool.
 */
export interface Reader {
  has: (label: string) => boolean;
  /** Numeric, absent column ⇒ 0. Use only for columns `requireCols` guarantees. */
  g: (r: Record<string, unknown>, label: string) => number;
  /** Numeric, absent column ⇒ null (rule 1). */
  o: (r: Record<string, unknown>, label: string) => number | null;
  /** Text, absent column ⇒ ''. */
  s: (r: Record<string, unknown>, label: string) => string;
}

export function reader(d: Sheet, raw?: boolean): Reader {
  const idx = colIndex(d);
  const key = (label: string): string | undefined => idx.get(label.trim().toLowerCase());
  return {
    has: (label) => hasCol(idx, label),
    g: (r, label) => { const k = key(label); return k === undefined ? 0 : n(r[k], raw); },
    o: (r, label) => { const k = key(label); return k === undefined ? null : n(r[k], raw); },
    s: (r, label) => { const k = key(label); return k === undefined ? '' : String(r[k] ?? '').trim(); },
  };
}

const sum = <T,>(a: T[], f: (x: T) => number | null | undefined): number =>
  a.reduce((x, y) => x + (f(y) || 0), 0);

/** Sum that stays null when NO row carried the column at all (rule 1). */
const sumOpt = <T,>(a: T[], f: (x: T) => number | null): number | null => {
  let seen = false;
  let t = 0;
  for (const x of a) { const v = f(x); if (v != null) { seen = true; t += v; } }
  return seen ? t : null;
};

// ---------------------------------------------------------------------------
// KPI + kanal (from Analitik Toko)
// ---------------------------------------------------------------------------
export interface KpiToko {
  gmv: number; gmvKotor: number; refund: number; refundRate: number | null;
  pesanan: number; pembeli: number | null; terjual: number | null;
  pengunjung: number; cvr: number; aov: number | null;
  impresi: number | null; klik: number | null;
  /** MoM change, straight from the export's "Perubahan persentase" row (never recomputed). */
  mom: { gmv: number | null; pengunjung: number | null; pesanan: number | null; refund: number | null };
  harian: { tanggal: string; gmv: number; pesanan: number }[];
}

export interface KanalItem { key: 'live' | 'video' | 'kartu'; label: string; nilai: number | null; persen: number | null }
export interface Kanal {
  gmv: number;
  items: KanalItem[];
  detail: { live_toko: number | null; live_kreator: number; video_toko: number | null; video_kreator: number | null };
}

/** Headline KPIs. `net` follows the MEA standard (GMV − pengembalian dana). */
export function kpiToko(T: TokoMetric, net: boolean): KpiToko {
  return {
    gmv: net ? T.gmvNet : T.gmv,
    gmvKotor: T.gmv,
    refund: T.refund,
    refundRate: T.refundRate,
    pesanan: T.pesanan,
    pembeli: T.pembeli,
    terjual: T.terjual,
    pengunjung: T.visitor,
    cvr: T.cr,
    aov: T.aov,
    impresi: T.impresi,
    klik: T.klik,
    mom: { gmv: T.chGmv, pengunjung: T.chVisitor, pesanan: T.chOrder, refund: T.chRefund },
    harian: T.daily.map((d) => ({ tanggal: d.t, gmv: d.g, pesanan: d.o })),
  };
}

/**
 * Where the GMV came from. Shares are taken against GROSS GMV because the mix
 * components the export reports are gross — mixing a net denominator with gross
 * numerators is how a "112% dari GMV" appears on a client's page.
 */
export function kanal(T: TokoMetric): Kanal {
  const gmv = T.gmv;
  const live = T.liveToko == null ? null : T.liveToko + T.liveAff;
  const video = T.vidToko == null || T.vidAff == null ? null : T.vidToko + T.vidAff;
  const kartu = T.other;
  const item = (key: KanalItem['key'], label: string, nilai: number | null): KanalItem => ({
    key, label, nilai, persen: nilai == null ? null : div(nilai, gmv),
  });
  return {
    gmv,
    items: [
      item('live', 'LIVE', live),
      item('video', 'Video', video),
      item('kartu', 'Kartu Produk / Shop Tab', kartu),
    ],
    detail: { live_toko: T.liveToko, live_kreator: T.liveAff, video_toko: T.vidToko, video_kreator: T.vidAff },
  };
}

// ---------------------------------------------------------------------------
// Ads (GMV Max LIVE + Product)
// ---------------------------------------------------------------------------
export interface AdsCampaign { kampanye: string; biaya: number; rev: number; pesanan: number; impresi: number; klik: number; roi: number | null; cpa: number | null; ctr: number | null; cvr: number | null }
export interface AdsJenis { jenis: string; n: number; biaya: number; rev: number; pesanan: number; roi: number | null; ctr: number | null }
export interface AdsKreatif { judul: string; akun: string; jenis: string; biaya: number; rev: number; pesanan: number; ctr: number | null; cvr: number | null }
export interface AdsSesiLive { nama: string; waktu: string; biaya: number; rev: number; pesanan: number; roi: number | null; tayangan: number | null }
export interface AdsReport {
  live: { biaya: number; rev: number; pesanan: number; sesi: number; roi: number | null; cpa: number | null; aov: number | null; tayangan: number | null; tayangan10s: number | null; hold10s: number | null };
  product: { biaya: number; rev: number; pesanan: number; baris: number; roi: number | null; cpa: number | null; aov: number | null; impresi: number | null; klik: number | null; ctr: number | null; cvr: number | null };
  total: { biaya: number; rev: number; pesanan: number; roi: number | null; cpa: number | null; aov: number | null; cpaRatio: number | null };
  campaigns: AdsCampaign[];
  jenisMateri: AdsJenis[];
  topKreatif: AdsKreatif[];
  topLive: AdsSesiLive[];
  /** Creatives that spent money and produced zero revenue — the budget-burn ledger (internal). */
  burners: { n: number; spend: number; pctSpend: number | null };
  liveNoSale: { n: number; spend: number };
}

export function adsReport(dp: Sheet | null, dl: Sheet | null): AdsReport | null {
  if (!dp && !dl) return null;
  if (dp) requireCols(['Nama kampanye', 'Biaya', 'Pendapatan kotor'], dp.cols, 'Ads Manager — Produk/GMV Max');
  if (dl) requireCols(['Nama LIVE', 'Biaya', 'Pendapatan kotor'], dl.cols, 'Ads Manager — LIVE');

  // Ads Manager sends plain floats ("335164.77" = dot is a DECIMAL point), unlike
  // Seller Center's "Rp10.945.407" — hence raw=true (see angka.ts, ⛔).
  const P: AdsKreatif[] = [];
  const impresiP: (number | null)[] = [];
  const klikP: (number | null)[] = [];
  const rp = dp ? reader(dp, true) : null;
  const rowsP: Record<string, unknown>[] = [];
  if (dp && rp) {
    const r = rp;
    for (const row of dp.rows) {
      const kampanye = r.s(row, 'Nama kampanye');
      if (!kampanye) continue;
      rowsP.push(row);
      P.push({
        judul: r.s(row, 'Judul video') || '(tanpa judul)',
        akun: r.s(row, 'Akun TikTok'),
        jenis: r.s(row, 'Jenis materi iklan') || 'Lainnya',
        biaya: r.g(row, 'Biaya'),
        rev: r.g(row, 'Pendapatan kotor'),
        pesanan: r.g(row, 'Pesanan SKU'),
        ctr: r.o(row, 'Tingkat klik iklan produk'),
        cvr: r.o(row, 'Rasio konversi iklan'),
      });
      impresiP.push(r.o(row, 'Impresi iklan produk'));
      klikP.push(r.o(row, 'Jumlah klik iklan produk'));
    }
  }

  const L: AdsSesiLive[] = [];
  const tayangan: (number | null)[] = [];
  const tayangan10: (number | null)[] = [];
  if (dl) {
    const r = reader(dl, true);
    for (const row of dl.rows) {
      const nama = r.s(row, 'Nama LIVE');
      if (!nama) continue;
      L.push({
        nama, waktu: r.s(row, 'Waktu peluncuran'),
        biaya: r.g(row, 'Biaya'), rev: r.g(row, 'Pendapatan kotor'), pesanan: r.g(row, 'Pesanan SKU'),
        roi: div(r.g(row, 'Pendapatan kotor'), r.g(row, 'Biaya')),
        tayangan: r.o(row, 'Tayangan LIVE'),
      });
      tayangan.push(r.o(row, 'Tayangan LIVE'));
      tayangan10.push(r.o(row, 'Tayangan LIVE 10 detik'));
    }
  }

  const biayaL = sum(L, (x) => x.biaya), revL = sum(L, (x) => x.rev), pesananL = sum(L, (x) => x.pesanan);
  const tayTot = sumOpt(tayangan, (x) => x), tay10Tot = sumOpt(tayangan10, (x) => x);
  const live = {
    biaya: biayaL, rev: revL, pesanan: pesananL, sesi: L.length,
    roi: div(revL, biayaL), cpa: div(biayaL, pesananL), aov: div(revL, pesananL),
    tayangan: tayTot, tayangan10s: tay10Tot,
    hold10s: tayTot == null || tay10Tot == null ? null : div(tay10Tot, tayTot),
  };

  const biayaP = sum(P, (x) => x.biaya), revP = sum(P, (x) => x.rev), pesananP = sum(P, (x) => x.pesanan);
  const impTot = sumOpt(impresiP, (x) => x), klikTot = sumOpt(klikP, (x) => x);
  const product = {
    biaya: biayaP, rev: revP, pesanan: pesananP, baris: P.length,
    roi: div(revP, biayaP), cpa: div(biayaP, pesananP), aov: div(revP, pesananP),
    impresi: impTot, klik: klikTot,
    ctr: impTot == null || klikTot == null ? null : div(klikTot, impTot),
    cvr: klikTot == null ? null : div(pesananP, klikTot),
  };

  const biaya = biayaL + biayaP, rev = revL + revP, pesanan = pesananL + pesananP;
  const cpa = div(biaya, pesanan), aov = div(rev, pesanan);
  const total = { biaya, rev, pesanan, roi: div(rev, biaya), cpa, aov, cpaRatio: cpa == null || aov == null ? null : div(cpa, aov) };

  const byC = new Map<string, AdsCampaign>();
  if (rp) {
    const r = rp;
    rowsP.forEach((row) => {
      const k = r.s(row, 'Nama kampanye') || '(tanpa nama)';
      const c = byC.get(k) ?? { kampanye: k, biaya: 0, rev: 0, pesanan: 0, impresi: 0, klik: 0, roi: null, cpa: null, ctr: null, cvr: null };
      c.biaya += r.g(row, 'Biaya'); c.rev += r.g(row, 'Pendapatan kotor'); c.pesanan += r.g(row, 'Pesanan SKU');
      c.impresi += r.o(row, 'Impresi iklan produk') ?? 0; c.klik += r.o(row, 'Jumlah klik iklan produk') ?? 0;
      byC.set(k, c);
    });
  }
  const campaigns = [...byC.values()]
    .map((c) => ({ ...c, roi: div(c.rev, c.biaya), cpa: div(c.biaya, c.pesanan), ctr: div(c.klik, c.impresi), cvr: div(c.pesanan, c.klik) }))
    .sort((a, b) => b.rev - a.rev);

  const byJ = new Map<string, AdsJenis>();
  P.forEach((x) => {
    const j = byJ.get(x.jenis) ?? { jenis: x.jenis, n: 0, biaya: 0, rev: 0, pesanan: 0, roi: null, ctr: null };
    j.n++; j.biaya += x.biaya; j.rev += x.rev; j.pesanan += x.pesanan;
    byJ.set(x.jenis, j);
  });
  const jenisMateri = [...byJ.values()].map((j) => ({ ...j, roi: div(j.rev, j.biaya), ctr: null })).sort((a, b) => b.rev - a.rev);

  const burners = P.filter((x) => x.biaya > 0 && !(x.rev > 0));
  const burnSpend = sum(burners, (x) => x.biaya);
  const liveNo = L.filter((x) => x.biaya > 0 && !(x.rev > 0));

  return {
    live, product, total, campaigns, jenisMateri,
    topKreatif: P.filter((x) => x.rev > 0).sort((a, b) => b.rev - a.rev).slice(0, 12),
    topLive: [...L].sort((a, b) => b.rev - a.rev).slice(0, 10),
    burners: { n: burners.length, spend: burnSpend, pctSpend: div(burnSpend, biayaP) },
    liveNoSale: { n: liveNo.length, spend: sum(liveNo, (x) => x.biaya) },
  };
}

// ---------------------------------------------------------------------------
// LIVE (toko sendiri)
// ---------------------------------------------------------------------------
export const HARI_NAMA = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;

export interface LiveSesi { waktu: string; kreator: string; jam: number; gmv: number; penonton: number | null; gmvPerJam: number | null; hari: number | null; jamKe: number | null }
export interface LiveHari { hari: number; label: string; sesi: number; jam: number; gmv: number; penonton: number | null; gmvPerJam: number | null; gmvPerSesi: number | null }
export interface LiveReport {
  sesi: number; jam: number; gmv: number;
  gmvPerJam: number | null; gmvPerSesi: number | null; durasiRata: number | null;
  penonton: number | null; tayangan: number | null; produkDilihat: number | null; klikProduk: number | null;
  komentar: number | null; suka: number | null; followerBaru: number | null; ctr: number | null;
  top: LiveSesi[];
  /** Broadcast hours that produced nothing — host + operations cost with no return (internal). */
  nol: { n: number; jam: number; pct: number | null };
  perHari: LiveHari[];
}

/** `2026/08/03 19:30` → Date. Returns null when the cell carries no parseable stamp. */
export function parseWaktuLive(w: string): { hari: number; jamKe: number } | null {
  const m = w.match(/(\d{4})[/-](\d{2})[/-](\d{2})[\s/]+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isNaN(d.getTime())) return null;
  return { hari: d.getUTCDay(), jamKe: +m[4] };
}

export function liveReport(d: Sheet | null): LiveReport | null {
  if (!d) return null;
  requireCols(['Waktu Live', 'GMV dari LIVE (Rp)', 'Durasi'], d.cols, 'LIVE');
  const r = reader(d);
  const rows: LiveSesi[] = [];
  const penonton: (number | null)[] = [], tayangan: (number | null)[] = [], dilihat: (number | null)[] = [];
  const klik: (number | null)[] = [], komentar: (number | null)[] = [], suka: (number | null)[] = [], follow: (number | null)[] = [];
  for (const row of d.rows) {
    const waktu = r.s(row, 'Waktu Live');
    if (!waktu) continue;
    const jam = durH(r.s(row, 'Durasi'));
    const gmv = r.g(row, 'GMV dari LIVE (Rp)');
    const t = parseWaktuLive(waktu);
    const p = r.o(row, 'Penonton');
    rows.push({
      waktu, kreator: r.s(row, 'Kreator') || r.s(row, 'Nama panggilan'),
      jam, gmv, penonton: p, gmvPerJam: div(gmv, jam),
      hari: t ? t.hari : null, jamKe: t ? t.jamKe : null,
    });
    penonton.push(p);
    tayangan.push(r.o(row, 'Live Stream Dilihat'));
    dilihat.push(r.o(row, 'Produk dilihat'));
    klik.push(r.o(row, 'Klik Produk'));
    komentar.push(r.o(row, 'Komentar'));
    suka.push(r.o(row, 'Suka pada LIVE'));
    follow.push(r.o(row, 'Pengikut baru (Video kreator)'));
  }
  if (!rows.length) return null;

  const jam = sum(rows, (x) => x.jam), gmv = sum(rows, (x) => x.gmv);
  const dilihatTot = sumOpt(dilihat, (x) => x), klikTot = sumOpt(klik, (x) => x);
  const nol = rows.filter((x) => !(x.gmv > 0));

  const byH = new Map<number, LiveHari>();
  for (const x of rows) {
    if (x.hari == null) continue;
    const b = byH.get(x.hari) ?? { hari: x.hari, label: HARI_NAMA[x.hari], sesi: 0, jam: 0, gmv: 0, penonton: 0, gmvPerJam: null, gmvPerSesi: null };
    b.sesi++; b.jam += x.jam; b.gmv += x.gmv; b.penonton = (b.penonton ?? 0) + (x.penonton ?? 0);
    byH.set(x.hari, b);
  }
  const perHari = [...byH.values()]
    .map((b) => ({ ...b, gmvPerJam: div(b.gmv, b.jam), gmvPerSesi: div(b.gmv, b.sesi) }))
    .sort((a, b) => a.hari - b.hari);

  return {
    sesi: rows.length, jam, gmv,
    gmvPerJam: div(gmv, jam), gmvPerSesi: div(gmv, rows.length), durasiRata: div(jam, rows.length),
    penonton: sumOpt(penonton, (x) => x), tayangan: sumOpt(tayangan, (x) => x),
    produkDilihat: dilihatTot, klikProduk: klikTot,
    komentar: sumOpt(komentar, (x) => x), suka: sumOpt(suka, (x) => x), followerBaru: sumOpt(follow, (x) => x),
    ctr: dilihatTot == null || klikTot == null ? null : div(klikTot, dilihatTot),
    top: [...rows].sort((a, b) => b.gmv - a.gmv).slice(0, 10),
    nol: { n: nol.length, jam: sum(nol, (x) => x.jam), pct: div(nol.length, rows.length) },
    perHari,
  };
}

// ---------------------------------------------------------------------------
// Video (toko + afiliasi digabung)
// ---------------------------------------------------------------------------
export interface VideoItem { judul: string; kreator: string; waktu: string; gmv: number; gpm: number; vv: number; ctor: number | null; afiliasi: boolean }
export interface VideoReport {
  total: number; toko: number; afiliasi: number; adaPenjualan: number; salesRate: number | null;
  gmv: number; gmvToko: number; gmvAfiliasi: number; vv: number;
  likes: number | null; komentar: number | null; dibagikan: number | null;
  klikProduk: number | null; produkDilihat: number | null; klikKeLive: number | null; followerBaru: number | null;
  /** Aggregate GPM = total GMV per 1.000 total views. */
  gpm: number | null;
  /** Mean of the per-video GPM column — the figure TikTok's own "Avg GPM" tile shows. */
  gpmPerVideo: number | null;
  vvPerVideo: number | null; ctr: number | null;
  topPenjualan: VideoItem[]; topViews: VideoItem[];
}

function videoRows(d: Sheet, afiliasi: boolean): { items: VideoItem[]; extra: Record<string, (number | null)[]> } {
  requireCols(['Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)', 'VV'], d.cols, 'Video');
  const r = reader(d);
  const items: VideoItem[] = [];
  const extra: Record<string, (number | null)[]> = { likes: [], komentar: [], dibagikan: [], klik: [], dilihat: [], keLive: [], follow: [] };
  for (const row of d.rows) {
    const judul = r.s(row, 'Informasi Video');
    const videoId = r.s(row, 'ID Video');
    // O71 (keputusan pemilik 2026-09-04, temuan UAT Avitaskin): caption KOSONG
    // bukan alasan membuang sebuah video. Caption itu JUDUL, bukan identitas —
    // `ID Video` yang identitas, dan di export asli ia terisi di 664/664 baris
    // sementara 16 baris (15 di antaranya VV > 0) tak bercaption. Membuangnya
    // mengecilkan PENYEBUT "video ada penjualan" tanpa alasan.
    // Baris tanpa keduanya (mis. baris keterangan/tooltip di bawah header
    // export Afiliasi) tetap dibuang — itulah yang filter ini sebenarnya untuk.
    // `../baseline/metrik.ts:video` sudah memakai kunci yang sama
    // (`ID Video != null || Informasi Video != null`); ini menyamakan mesin
    // laporan dengannya, bukan membuat aturan ketiga.
    if (!judul && !videoId) continue;
    items.push({
      // Placeholder, bukan string kosong — sama seperti `'(tanpa judul)'` pada
      // kreatif iklan di atas, supaya baris tetap terbaca di tabel laporan.
      judul: judul ? judul.replace(/\s+/g, ' ').trim() : '(tanpa caption)',
      kreator: r.s(row, 'Nama Kreator'),
      waktu: r.s(row, 'Waktu'),
      gmv: r.g(row, 'GMV dari video (Rp)'),
      gpm: r.g(row, 'GPM (Rp)'),
      vv: r.g(row, 'VV'),
      ctor: r.o(row, 'CTOR (pesanan SKU)'),
      afiliasi,
    });
    extra.likes.push(r.o(row, 'Likes'));
    extra.komentar.push(r.o(row, 'Komentar'));
    extra.dibagikan.push(r.o(row, 'Dibagikan'));
    extra.klik.push(r.o(row, 'Klik Produk'));
    extra.dilihat.push(r.o(row, 'Produk dilihat'));
    extra.keLive.push(r.o(row, 'Klik video ke LIVE'));
    extra.follow.push(r.o(row, 'Pengikut baru'));
  }
  return { items, extra };
}

export function videoReport(dToko: Sheet | null, dAff: Sheet | null): VideoReport | null {
  if (!dToko && !dAff) return null;
  const a = dToko ? videoRows(dToko, false) : { items: [], extra: {} as Record<string, (number | null)[]> };
  const b = dAff ? videoRows(dAff, true) : { items: [], extra: {} as Record<string, (number | null)[]> };
  const all = [...a.items, ...b.items];
  if (!all.length) return null;
  const cat = (k: string): (number | null)[] => [...(a.extra[k] ?? []), ...(b.extra[k] ?? [])];

  const withSales = all.filter((v) => v.gmv > 0).sort((x, y) => y.gmv - x.gmv);
  const gmv = sum(all, (v) => v.gmv), vv = sum(all, (v) => v.vv);
  const dilihatTot = sumOpt(cat('dilihat'), (x) => x), klikTot = sumOpt(cat('klik'), (x) => x);

  return {
    total: all.length, toko: a.items.length, afiliasi: b.items.length,
    adaPenjualan: withSales.length, salesRate: div(withSales.length, all.length),
    gmv, gmvToko: sum(a.items, (v) => v.gmv), gmvAfiliasi: sum(b.items, (v) => v.gmv), vv,
    likes: sumOpt(cat('likes'), (x) => x), komentar: sumOpt(cat('komentar'), (x) => x),
    dibagikan: sumOpt(cat('dibagikan'), (x) => x),
    klikProduk: klikTot, produkDilihat: dilihatTot,
    klikKeLive: sumOpt(cat('keLive'), (x) => x), followerBaru: sumOpt(cat('follow'), (x) => x),
    gpm: div(gmv * 1000, vv),
    gpmPerVideo: all.length ? sum(all, (v) => v.gpm) / all.length : null,
    vvPerVideo: div(vv, all.length),
    ctr: dilihatTot == null || klikTot == null ? null : div(klikTot, dilihatTot),
    topPenjualan: withSales.slice(0, 15),
    topViews: [...all].sort((x, y) => y.vv - x.vv).slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Produk — matriks 4 kuadran
// ---------------------------------------------------------------------------
export type Kuadran = 'bintang' | 'hidden_gem' | 'bocor_traffic' | 'evaluasi' | 'tidur' | 'tidak_tayang';
export const ALL_KUADRAN: readonly Kuadran[] = ['bintang', 'hidden_gem', 'bocor_traffic', 'evaluasi', 'tidur', 'tidak_tayang'];

export interface ProdukRec { nama: string; id: string; gmv: number; klik: number; cvr: number | null; pesanan: number | null; terjual: number | null }
export interface Ambang { klikRendah: number; klikTinggi: number; cvrRendah: number; cvrTinggi: number; n: number }
export interface Kuadrans {
  relatif: Record<Kuadran, ProdukRec[]>;
  benchmark: Record<Kuadran, ProdukRec[]>;
  ambang: { relatif: Ambang; benchmark: Ambang };
}

/** Minimum clicks before a SKU has been tested fairly at all (tool `SLEEP`). */
export const KLIK_MIN_UJI = 10;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const k = p * (sorted.length - 1), f = Math.floor(k), c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

export function kuadranProduk(d: Sheet | null, B: ReportBench): Kuadrans | null {
  if (!d) return null;
  requireCols(['Nama', 'GMV', 'Klik produk'], d.cols, 'Analitik Produk — TikTok');
  const r = reader(d);
  const recs: ProdukRec[] = [];
  for (const row of d.rows) {
    const nama = r.s(row, 'Nama');
    if (!nama || nama.length > 160) continue;
    const klik = r.g(row, 'Klik produk');
    const pesanan = r.o(row, 'Pesanan SKU');
    const ctor = r.o(row, 'CTOR (pesanan SKU)');
    recs.push({
      nama, id: r.s(row, 'ID Produk'), gmv: r.g(row, 'GMV'), klik,
      cvr: ctor ?? (pesanan == null ? null : div(pesanan, klik)),
      pesanan, terjual: r.o(row, 'Produk terjual'),
    });
  }
  if (!recs.length) return null;

  const aktif = recs.filter((x) => x.klik >= KLIK_MIN_UJI && x.cvr != null);
  const klikSorted = aktif.map((x) => x.klik).sort((a, b) => a - b);
  let klikRendah = percentile(klikSorted, 0.25), klikTinggi = percentile(klikSorted, 0.75);
  // A long-tail catalogue makes the CVR distribution degenerate: when most SKUs
  // never converted, p25 and p75 both collapse to 0 and EVERY product reads as
  // "high closing". So the percentile is taken over CONVERTERS only, and falls
  // back to the benchmark when there are none.
  const cvrPos = aktif.map((x) => x.cvr as number).filter((v) => v > 0).sort((a, b) => a - b);
  let cvrRendah = percentile(cvrPos, 0.25), cvrTinggi = percentile(cvrPos, 0.75);
  if (!cvrTinggi) { cvrRendah = B.quad_cvr.warn; cvrTinggi = B.quad_cvr.good; }
  if (!klikTinggi) { klikRendah = B.quad_klik.warn; klikTinggi = B.quad_klik.good; }

  const classify = (klikHi: number, cvrHi: number): Record<Kuadran, ProdukRec[]> => {
    const b = { bintang: [], hidden_gem: [], bocor_traffic: [], evaluasi: [], tidur: [], tidak_tayang: [] } as Record<Kuadran, ProdukRec[]>;
    for (const x of recs) {
      if (!x.klik) { b.tidak_tayang.push(x); continue; }
      if (x.klik < KLIK_MIN_UJI || x.cvr == null) { b.tidur.push(x); continue; }
      const tHi = x.klik >= klikHi, cHi = (x.cvr as number) >= cvrHi;
      b[tHi && cHi ? 'bintang' : !tHi && cHi ? 'hidden_gem' : tHi ? 'bocor_traffic' : 'evaluasi'].push(x);
    }
    for (const k of ALL_KUADRAN) b[k].sort((x, y) => y.gmv - x.gmv);
    return b;
  };

  return {
    relatif: classify(klikTinggi as number, cvrTinggi as number),
    benchmark: classify(B.quad_klik.good, B.quad_cvr.good),
    ambang: {
      relatif: { klikRendah: klikRendah as number, klikTinggi: klikTinggi as number, cvrRendah: cvrRendah as number, cvrTinggi: cvrTinggi as number, n: aktif.length },
      benchmark: { klikRendah: B.quad_klik.warn, klikTinggi: B.quad_klik.good, cvrRendah: B.quad_cvr.warn, cvrTinggi: B.quad_cvr.good, n: recs.length },
    },
  };
}

// ---------------------------------------------------------------------------
// Affiliate / kreator
// ---------------------------------------------------------------------------
export interface KreatorRec { nama: string; gmv: number; konten: number; pesanan: number | null; tayangan: number | null; sampel: number; komisi: number | null; refund: number | null; produktif: boolean }
export interface AffiliateReport {
  total: number; produktif: number; pctProduktif: number | null; posting: number; nempel: number; pasif: number;
  gmv: number; refund: number | null; netGmv: number | null; refundRate: number | null;
  komisi: number | null; roiKomisi: number | null;
  /** Own shop accounts removed from the pool — counting them would flatter the ratio. */
  dikecualikan: string[];
  top: KreatorRec[]; nempelList: KreatorRec[];
  sampel: { kreator: number; terkirim: number; gmv: number; gmvPerSampel: number | null };
  affLive: { sesi: number; jam: number; gmv: number; gmvPerJam: number | null } | null;
}

export function affiliateReport(
  dKreator: Sheet | null,
  dAffLive: Sheet | null,
  akunSendiri: string[],
): AffiliateReport | null {
  if (!dKreator) return null;
  requireCols(['Creator name', 'GMV dari kreator'], dKreator.cols, 'Afiliasi — Daftar Kreator');
  const r = reader(dKreator);
  const own = new Set(akunSendiri.filter(Boolean).map((h) => h.trim().toLowerCase()));
  const all: KreatorRec[] = [];
  const dikecualikan: string[] = [];
  const refunds: (number | null)[] = [], komisis: (number | null)[] = [];
  for (const row of dKreator.rows) {
    const nama = r.s(row, 'Creator name');
    if (!nama || nama.length >= 60) continue;
    if (own.has(nama.toLowerCase())) { dikecualikan.push(nama); continue; }
    const gmv = r.g(row, 'GMV dari kreator');
    const konten = r.g(row, 'Video') + r.g(row, 'Siaran LIVE');
    const refund = r.o(row, 'Pengembalian dana'), komisi = r.o(row, 'Perkiraan komisi');
    all.push({
      nama, gmv, konten,
      pesanan: r.o(row, 'Pesanan teratribusi'), tayangan: r.o(row, 'Tayangan video'),
      sampel: r.g(row, 'Sampel terkirim'), komisi, refund, produktif: gmv > 0,
    });
    refunds.push(refund); komisis.push(komisi);
  }
  if (!all.length) return null;

  const produktif = all.filter((c) => c.produktif);
  const posting = all.filter((c) => c.konten > 0);
  const nempel = posting.filter((c) => !c.produktif);
  const pasif = all.filter((c) => c.konten === 0 && !c.produktif);
  const gmv = sum(all, (c) => c.gmv);
  const refund = sumOpt(refunds, (x) => x), komisi = sumOpt(komisis, (x) => x);
  const smp = all.filter((c) => c.sampel > 0);
  const smpGmv = sum(smp, (c) => c.gmv), smpKirim = sum(smp, (c) => c.sampel);

  let affLive: AffiliateReport['affLive'] = null;
  if (dAffLive) {
    requireCols(['Waktu Live', 'GMV dari LIVE (Rp)', 'Durasi'], dAffLive.cols, 'LIVE');
    const rl = reader(dAffLive);
    const rows = dAffLive.rows.filter((row) => rl.s(row, 'Waktu Live'));
    const jam = sum(rows, (row) => durH(rl.s(row, 'Durasi')));
    const g = sum(rows, (row) => rl.g(row, 'GMV dari LIVE (Rp)'));
    affLive = { sesi: rows.length, jam, gmv: g, gmvPerJam: div(g, jam) };
  }

  return {
    total: all.length, produktif: produktif.length, pctProduktif: div(produktif.length, all.length),
    posting: posting.length, nempel: nempel.length, pasif: pasif.length,
    gmv, refund, netGmv: refund == null ? null : gmv - refund, refundRate: refund == null ? null : div(refund, gmv),
    komisi, roiKomisi: komisi == null ? null : div(gmv, komisi),
    dikecualikan,
    // "Top Kreator by GMV" means creators WITH GMV. Listing zero-GMV names under
    // that heading reads as an accusation on a page the client forwards to them.
    top: all.filter((c) => c.gmv > 0).sort((a, b) => b.gmv - a.gmv).slice(0, 15),
    nempelList: [...nempel].sort((a, b) => b.konten - a.konten).slice(0, 15),
    sampel: { kreator: smp.length, terkirim: smpKirim, gmv: smpGmv, gmvPerSampel: div(smpGmv, smpKirim) },
    affLive,
  };
}

// ---------------------------------------------------------------------------
// Tokopedia (tipis)
// ---------------------------------------------------------------------------
export interface TokpedReport { gmv: number; pesanan: number; pengunjung: number; cvr: number; terjual: number | null; pembeli: number | null; mom: { gmv: number | null; pesanan: number | null; pengunjung: number | null } }

export function tokpedReport(d: Sheet | null): TokpedReport | null {
  if (!d) return null;
  requireCols(['GMV', 'Pesanan', 'Pengunjung', 'Persentase konversi'], d.cols, 'Analitik Toko — Tokopedia');
  const r = reader(d);
  const lab0 = (row: Record<string, unknown>): string => String(row['__c0'] ?? '').trim();
  const tot = d.rows.find((row) => /^Total nilai/i.test(lab0(row)));
  if (!tot) return null;
  const chg = d.rows.find((row) => /^Perubahan/i.test(lab0(row)));
  const ch = (label: string): number | null => (chg ? r.o(chg, label) : null);
  return {
    gmv: r.g(tot, 'GMV'), pesanan: r.g(tot, 'Pesanan'), pengunjung: r.g(tot, 'Pengunjung'),
    cvr: r.g(tot, 'Persentase konversi'), terjual: r.o(tot, 'Produk terjual'), pembeli: r.o(tot, 'Pembeli'),
    mom: { gmv: ch('GMV'), pesanan: ch('Pesanan'), pengunjung: ch('Pengunjung') },
  };
}

// ---------------------------------------------------------------------------
// TikTok Ads Manager (4 berkas opsional)
// ---------------------------------------------------------------------------
export interface TtamItem { nama: string; status: string; spend: number; impresi: number | null; reach: number | null; klik: number | null; [k: string]: unknown }
export interface TtamReport {
  berkas: string[];
  totalSpend: number;
  consideration: { n: number; spend: number; impresi: number | null; reach: number | null; klik: number | null; size: number | null; costPer: number | null; rate: number | null } | null;
  follows: { n: number; spend: number; impresi: number | null; klik: number | null; follows: number | null; visits: number | null; costPer: number | null } | null;
  showcase: { n: number; spend: number; impresi: number | null; reach: number | null; klik: number | null; videoViews: number | null; atc: number | null; checkout: number | null; checkoutValue: number | null; ctr: number | null; costPerCheckout: number | null; costPerAtc: number | null; valuePerSpend: number | null; items: TtamItem[] } | null;
  videoviews: { n: number; spend: number; impresi: number | null; reach: number | null; views: number | null; cpm: number | null; costPer1k: number | null; viewRate: number | null; perSumber: { sumber: string; n: number; spend: number; views: number; costPer1k: number | null }[] } | null;
}

function ttamItems(d: Sheet): { items: TtamItem[]; r: Reader } {
  const r = reader(d, true);
  const items: TtamItem[] = [];
  for (const row of d.rows) {
    const nama = r.s(row, 'Ad group name') || r.s(row, 'Ad name');
    if (!nama) continue;
    // The export appends its own grand-total row; totals are recomputed from the
    // data rows so a reworded total row can never be double-counted.
    if (/^total of/i.test(nama)) continue;
    items.push({
      nama, status: r.s(row, 'Primary status'), spend: r.g(row, 'Spend'),
      impresi: r.o(row, 'Impressions'), reach: r.o(row, 'Reach'), klik: r.o(row, 'Clicks (destination)'),
      _row: row,
    });
  }
  return { items, r };
}

export function ttamReport(slots: ReportSlots): TtamReport | null {
  const keys = ['ttam_consideration', 'ttam_follows', 'ttam_showcase', 'ttam_videoviews'] as const;
  const berkas = keys.filter((k) => slots[k]);
  if (!berkas.length) return null;
  const out: TtamReport = { berkas: [...berkas], totalSpend: 0, consideration: null, follows: null, showcase: null, videoviews: null };

  if (slots.ttam_consideration) {
    const { items, r } = ttamItems(slots.ttam_consideration);
    const spend = sum(items, (x) => x.spend);
    const impresi = sumOpt(items, (x) => x.impresi);
    const size = sumOpt(items, (x) => r.o(x._row as Record<string, unknown>, 'New consideration size'));
    out.consideration = {
      n: items.length, spend, impresi, reach: sumOpt(items, (x) => x.reach), klik: sumOpt(items, (x) => x.klik),
      size, costPer: size == null ? null : div(spend, size),
      rate: size == null || impresi == null ? null : div(size, impresi),
    };
  }
  if (slots.ttam_follows) {
    const { items, r } = ttamItems(slots.ttam_follows);
    const spend = sum(items, (x) => x.spend);
    const follows = sumOpt(items, (x) => r.o(x._row as Record<string, unknown>, 'Paid follows'));
    out.follows = {
      n: items.length, spend, impresi: sumOpt(items, (x) => x.impresi), klik: sumOpt(items, (x) => x.klik),
      follows, visits: sumOpt(items, (x) => r.o(x._row as Record<string, unknown>, 'Paid profile visits')),
      costPer: follows == null ? null : div(spend, follows),
    };
  }
  if (slots.ttam_showcase) {
    const { items, r } = ttamItems(slots.ttam_showcase);
    const spend = sum(items, (x) => x.spend);
    const get = (x: TtamItem, c: string): number | null => r.o(x._row as Record<string, unknown>, c);
    for (const x of items) {
      x.ctr = get(x, 'CTR (destination)'); x.checkout = get(x, 'Checkouts initiated (Shop)');
      x.checkoutValue = get(x, 'Checkout initiation value (Shop)');
    }
    const impresi = sumOpt(items, (x) => x.impresi), klik = sumOpt(items, (x) => x.klik);
    const atc = sumOpt(items, (x) => get(x, 'Adds to cart (Shop)'));
    const checkout = sumOpt(items, (x) => get(x, 'Checkouts initiated (Shop)'));
    const checkoutValue = sumOpt(items, (x) => get(x, 'Checkout initiation value (Shop)'));
    out.showcase = {
      n: items.length, spend, impresi, reach: sumOpt(items, (x) => x.reach), klik,
      videoViews: sumOpt(items, (x) => get(x, 'Video views')), atc, checkout, checkoutValue,
      ctr: impresi == null || klik == null ? null : div(klik, impresi),
      costPerCheckout: checkout == null ? null : div(spend, checkout),
      costPerAtc: atc == null ? null : div(spend, atc),
      valuePerSpend: checkoutValue == null ? null : div(checkoutValue, spend),
      items,
    };
  }
  if (slots.ttam_videoviews) {
    const { items, r } = ttamItems(slots.ttam_videoviews);
    const spend = sum(items, (x) => x.spend);
    const get = (x: TtamItem, c: string): number | null => r.o(x._row as Record<string, unknown>, c);
    const impresi = sumOpt(items, (x) => x.impresi);
    const views = sumOpt(items, (x) => get(x, 'Video views'));
    const bySrc = new Map<string, { sumber: string; n: number; spend: number; views: number; costPer1k: number | null }>();
    for (const x of items) {
      const k = r.s(x._row as Record<string, unknown>, 'Primary source') || '(tidak diketahui)';
      const b = bySrc.get(k) ?? { sumber: k, n: 0, spend: 0, views: 0, costPer1k: null };
      b.n++; b.spend += x.spend; b.views += get(x, 'Video views') ?? 0;
      bySrc.set(k, b);
    }
    out.videoviews = {
      n: items.length, spend, impresi, reach: sumOpt(items, (x) => x.reach), views,
      cpm: impresi == null ? null : div(spend * 1000, impresi),
      costPer1k: views == null ? null : div(spend * 1000, views),
      viewRate: views == null || impresi == null ? null : div(views, impresi),
      perSumber: [...bySrc.values()].map((b) => ({ ...b, costPer1k: div(b.spend * 1000, b.views) })).sort((a, b) => b.spend - a.spend),
    };
  }
  out.totalSpend = (out.consideration?.spend ?? 0) + (out.follows?.spend ?? 0) + (out.showcase?.spend ?? 0) + (out.videoviews?.spend ?? 0);
  return out;
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------
export interface ReportMetrics {
  kpi: KpiToko;
  kanal: Kanal;
  ads: AdsReport | null;
  live: LiveReport | null;
  video: VideoReport | null;
  kuadran: Kuadrans | null;
  affiliate: AffiliateReport | null;
  tokped: TokpedReport | null;
  ttam: TtamReport | null;
  rentang: Rentang;
}
