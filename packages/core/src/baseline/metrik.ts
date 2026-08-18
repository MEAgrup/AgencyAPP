/**
 * Baseline engine — metric modules C.* (RAB-02).
 * Ported from the tool `C.toko/tp/video/live/aff/prod/ads` (lines 610-761).
 *
 * ⛔ JANGAN ubah rumusnya. Yang ditambahkan HANYA fix #2 (handoff §2.2):
 *   - Kolom WAJIB yang absen ⇒ `requireCols` gagal keras dengan pesan `[...]`
 *     menyebut kolomnya (bukan diam-diam dibaca 0).
 *   - Kolom OPSIONAL yang absen ⇒ `null` (bukan 0), supaya kolom TikTok yang
 *     berganti nama tak memicu temuan "GMV Rp. 0,00" palsu. `null` merambat ke
 *     payload sebagai `null` dan ke meter sebagai "tak dirender".
 *   Sel yang ADA tapi kosong tetap 0 (itu tugas `n()`), tak berubah.
 */
import { div, median, n } from './angka';
import { BaselineError, requireCols } from './errors';
import { periode2key } from './sheet';
import type { Sheet } from './types';

/** The full per-run metric bundle (tool `M`). Each slot null when its file is absent. */
export interface Metrics {
  toko: TokoMetric | null;
  tp: TpMetric | null;
  vT: VideoMetric | null;
  vA: VideoMetric | null;
  lT: LiveMetric | null;
  lA: LiveMetric | null;
  aff: AffMetric | null;
  prod: ProdMetric | null;
  ads: AdsMetric | null;
}

const has = (d: Sheet, c: string): boolean => d.cols.includes(c);
const lab0 = (r: Record<string, unknown>): string => String(r['__c0'] == null ? '' : r['__c0']).trim();

/** max of the non-null operands; null when all are null. */
const maxN = (...xs: (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x != null);
  return ok.length ? Math.max(...ok) : null;
};

// ── C.toko (Analitik Toko — TikTok) ─────────────────────────────────────────
export interface TokoMetric {
  gmv: number; refund: number; gmvNet: number; gmvBase: number;
  pesanan: number; pembeli: number | null; terjual: number | null; bruto: number | null;
  pv: number | null; visitor: number; cr: number; impresi: number | null; klik: number | null; aov: number | null;
  refundRate: number | null;
  chGmv: number | null; chVisitor: number | null; chOrder: number | null; chRefund: number | null;
  liveAff: number; liveToko: number | null; vidAff: number | null; vidToko: number | null; other: number | null;
  daily: { t: string; g: number; o: number }[];
  hariAktif: number; hariTotal: number; peakDay: number; peakShare: number | null;
  periode?: string;
}

export function toko(d: Sheet, opts?: { net?: boolean }): TokoMetric {
  const label = 'Analitik Toko — TikTok';
  requireCols(['GMV', 'Pengunjung', 'Pesanan', 'Persentase konversi', 'Pengembalian dana', 'GMV dari LIVE kreator'], d.cols, label);
  const tot = d.rows.find((r) => /^Total nilai/i.test(lab0(r)));
  if (!tot) throw new BaselineError(`[baris "Total nilai" tidak ditemukan di file ${label} — pastikan export belum diedit atau difilter]`);
  const chg = d.rows.find((r) => /^Perubahan/i.test(lab0(r))) || {};
  const g = (c: string): number => n(tot[c]);
  const gopt = (c: string): number | null => (has(d, c) ? n(tot[c]) : null);
  const ch = (c: string): number | null => (chg[c] == null || chg[c] === '-' ? null : n(chg[c]));
  const gmv = g('GMV'), refund = g('Pengembalian dana');
  const daily = d.rows
    .filter((r) => /^\d{2}\/\d{2}\/\d{4}$/.test(lab0(r)))
    .map((r) => ({ t: lab0(r), g: n(r['GMV']), o: n(r['Pesanan']) }));
  const dg = daily.map((x) => x.g), peak = Math.max(0, ...dg);
  const liveAff = g('GMV dari LIVE kreator');
  // null-aware mix (fix #2): a renamed/absent component is null, never 0.
  const altLiveToko = gopt('GMV LIVE penjual') == null && gopt('GMV tidak langsung dari LIVE penjual') == null
    ? null
    : n(tot['GMV LIVE penjual']) + n(tot['GMV tidak langsung dari LIVE penjual']);
  const liveToko = maxN(gopt('GMV dari LIVE akun tertaut'), altLiveToko);
  const vidAff = gopt('GMV dari video afiliasi'), vidToko = gopt('GMV dari video akun tertaut');
  const other = liveToko == null || vidAff == null || vidToko == null
    ? null
    : Math.max(0, gmv - liveAff - liveToko - vidAff - vidToko);
  return {
    gmv, refund, gmvNet: gmv - refund, gmvBase: opts?.net ? gmv - refund : gmv,
    pesanan: g('Pesanan'), pembeli: gopt('Pembeli'), terjual: gopt('Produk terjual'), bruto: gopt('Pendapatan bruto'),
    pv: gopt('Tayangan halaman'), visitor: g('Pengunjung'), cr: g('Persentase konversi'),
    impresi: gopt('Impresi produk'), klik: gopt('Klik produk'), aov: gopt('AOV'),
    refundRate: div(refund, gmv),
    chGmv: ch('GMV'), chVisitor: ch('Pengunjung'), chOrder: ch('Pesanan'), chRefund: ch('Pengembalian dana'),
    liveAff, liveToko, vidAff, vidToko, other,
    daily, hariAktif: daily.filter((x) => x.g > 0).length, hariTotal: daily.length,
    peakDay: peak, peakShare: div(peak, gmv), periode: d.periode,
  };
}

// ── C.tp (Analitik Toko — Tokopedia, tipis) ─────────────────────────────────
export interface TpMetric { gmv: number; pesanan: number; visitor: number; cr: number }
export function tp(d: Sheet): TpMetric {
  requireCols(['GMV', 'Pesanan', 'Pengunjung', 'Persentase konversi'], d.cols, 'Analitik Toko — Tokopedia');
  const tot = d.rows.find((r) => /^Total nilai/i.test(lab0(r))) || {};
  return { gmv: n(tot['GMV']), pesanan: n(tot['Pesanan']), visitor: n(tot['Pengunjung']), cr: n(tot['Persentase konversi']) };
}

// ── C.video (Video — toko / afiliasi) ───────────────────────────────────────
const hashCount = (s: unknown): number => (String(s).match(/#[^\s#]+/g) || []).length;
const capsWords = (s: unknown): number => (String(s).replace(/#[^\s]+/g, '').match(/\b[A-Z]{3,}\b/g) || []).length;
const titleOf = (r: Record<string, unknown>): string => String(r['Informasi Video'] || '').replace(/\s+/g, ' ').trim();

export interface VideoRow {
  kreator: string; judul: string; id: string; waktu: string; gmv: number; gpm: number; vv: number;
  like: number; kom: number; share: number; klik: number; ctr: number; ctor: number; finish: number;
  toLive: number; terjual: number; len: number; tag: number; caps: number; tanya: boolean;
}
export interface VideoCohort {
  n: number; vv: number; finish: number; ctr: number; len: number; tag: number; tanya: number | null; caps: number | null;
}
export interface VideoMetric {
  rows: VideoRow[]; sales: VideoRow[]; total: number; withSales: number; rate: number | null;
  gmv: number; vv: number; like: number; kom: number; share: number; gpmMed: number | null; gmvPerVid: number | null;
  posted: number; kreator: number; mvv: number; quad: { win: number; niche: number; viral: number; dead: number };
  cohS: VideoCohort; cohN: VideoCohort; topGmv: VideoRow[]; topGpm: VideoRow[]; viralFail: VideoRow[];
}
export function video(d: Sheet, periode?: string): VideoMetric {
  requireCols(['Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)', 'VV'], d.cols, 'Video');
  const R: VideoRow[] = d.rows
    .filter((r) => r['ID Video'] != null || r['Informasi Video'] != null)
    .map((r) => {
      const t = titleOf(r);
      return {
        kreator: String(r['Nama Kreator'] || '').trim(), judul: t, id: String(r['ID Video'] || ''),
        waktu: String(r['Waktu'] || ''), gmv: n(r['GMV dari video (Rp)']), gpm: n(r['GPM (Rp)']),
        vv: n(r['VV']), like: n(r['Likes']), kom: n(r['Komentar']), share: n(r['Dibagikan']),
        klik: n(r['Klik Produk']), ctr: n(r['Rasio klik tayang (Video)']), ctor: n(r['CTOR (pesanan SKU)']),
        finish: n(r['Persentase Video yang Ditonton Hingga Selesai']), toLive: n(r['Rasio Video ke LIVE']),
        terjual: n(r['Produk yang terjual melalui video']), len: t.replace(/#[^\s]+/g, '').trim().length,
        tag: hashCount(t), caps: capsWords(t), tanya: /\?/.test(t),
      };
    });
  const S = R.filter((v) => v.gmv > 0), N = R.filter((v) => v.gmv <= 0);
  const pm = /(\d{4})[-/](\d{2})/.exec(periode2key(periode) || '') || null;
  const inPeriod = R.filter((v) => pm && v.waktu.startsWith(pm[1] + '/' + pm[2]));
  const mvv = median(R.map((v) => v.vv));
  const quad = { win: 0, niche: 0, viral: 0, dead: 0 };
  R.forEach((v) => {
    const hi = v.vv >= mvv, s = v.gmv > 0;
    if (hi && s) quad.win++;
    else if (!hi && s) quad.niche++;
    else if (hi && !s) quad.viral++;
    else quad.dead++;
  });
  const coh = (a: VideoRow[]): VideoCohort => ({
    n: a.length, vv: median(a.map((v) => v.vv)), finish: median(a.map((v) => v.finish)), ctr: median(a.map((v) => v.ctr)),
    len: median(a.map((v) => v.len)), tag: median(a.map((v) => v.tag)), tanya: div(a.filter((v) => v.tanya).length, a.length),
    caps: div(a.filter((v) => v.caps >= 2).length, a.length),
  });
  return {
    rows: R, sales: S, total: R.length, withSales: S.length, rate: div(S.length, R.length),
    gmv: R.reduce((a, v) => a + v.gmv, 0), vv: R.reduce((a, v) => a + v.vv, 0),
    like: R.reduce((a, v) => a + v.like, 0), kom: R.reduce((a, v) => a + v.kom, 0), share: R.reduce((a, v) => a + v.share, 0),
    gpmMed: S.length ? median(S.map((v) => v.gpm)) : null, gmvPerVid: div(R.reduce((a, v) => a + v.gmv, 0), R.length),
    posted: inPeriod.length, kreator: new Set(R.map((v) => v.kreator).filter(Boolean)).size,
    mvv, quad, cohS: coh(S), cohN: coh(N),
    topGmv: [...S].sort((a, b) => b.gmv - a.gmv).slice(0, 10),
    topGpm: [...S].filter((v) => v.vv >= 200).sort((a, b) => b.gpm - a.gpm).slice(0, 5),
    viralFail: [...N].sort((a, b) => b.vv - a.vv).slice(0, 5),
  };
}

// ── C.live (LIVE — toko / afiliasi) ─────────────────────────────────────────
const durH = (s: unknown): number => {
  const m = String(s).match(/(\d+)\s*h/), k = String(s).match(/(\d+)\s*min/);
  return (m ? +m[1] : 0) + (k ? +k[1] : 0) / 60;
};
export interface LiveRow {
  kreator: string; waktu: string; jam: number; gmv: number; penonton: number; views: number; avgWatch: number;
  ctor: number; ctr: number; klik: number; terjual: number; komentar: number; follow: number; hour: number;
}
export interface LiveMetric {
  rows: LiveRow[]; sesi: number; withSales: number; rate: number | null; jam: number; gmv: number;
  gmvPerJam: number | null; jamPerSesi: number | null; penonton: number; views: number; ccv: number | null;
  ctorMed: number; avgWatch: number; kreator: number; hrs: Record<number, number>; prime: number; primeShare: number | null;
  top: LiveRow[];
}
export function live(d: Sheet): LiveMetric {
  requireCols(['Waktu Live', 'GMV dari LIVE (Rp)', 'Durasi'], d.cols, 'LIVE');
  const R: LiveRow[] = d.rows
    .filter((r) => r['Waktu Live'] != null)
    .map((r) => ({
      kreator: String(r['Kreator'] || r['Nama panggilan'] || '').trim(), waktu: String(r['Waktu Live'] || ''),
      jam: durH(r['Durasi']), gmv: n(r['GMV dari LIVE (Rp)']), penonton: n(r['Penonton']),
      views: n(r['Live Stream Dilihat']), avgWatch: n(r['Durasi menonton rata-rata (Siaran LIVE)']),
      ctor: n(r['CTOR']), ctr: n(r['CTR']), klik: n(r['Klik Produk']), terjual: n(r['Produk Terjual']),
      komentar: n(r['Komentar']), follow: n(r['Pengikut baru (Video kreator)']),
      // tool: `(m||[0,-1])[1]|0` — jam dari "HH:MM"; tak ada match ⇒ -1.
      hour: Number((String(r['Waktu Live'] || '').match(/(\d{1,2}):\d{2}/) || [0, -1])[1]) | 0,
    }));
  const S = R.filter((x) => x.gmv > 0);
  const jam = R.reduce((a, x) => a + x.jam, 0), gmv = R.reduce((a, x) => a + x.gmv, 0);
  const hrs: Record<number, number> = {};
  R.forEach((x) => { if (x.hour >= 0) hrs[x.hour] = (hrs[x.hour] || 0) + 1; });
  const prime = R.filter((x) => x.hour >= 18 && x.hour <= 22).length;
  return {
    rows: R, sesi: R.length, withSales: S.length, rate: div(S.length, R.length), jam, gmv,
    gmvPerJam: div(gmv, jam), jamPerSesi: div(jam, R.length),
    penonton: R.reduce((a, x) => a + x.penonton, 0), views: R.reduce((a, x) => a + x.views, 0),
    ccv: div(R.reduce((a, x) => a + x.penonton, 0), R.length),
    ctorMed: median(R.map((x) => x.ctor)), avgWatch: median(R.map((x) => x.avgWatch)),
    kreator: new Set(R.map((x) => x.kreator).filter(Boolean)).size, hrs, prime, primeShare: div(prime, R.length),
    top: [...S].sort((a, b) => b.gmv - a.gmv).slice(0, 8),
  };
}

// ── C.aff (Afiliasi — Daftar Kreator) ───────────────────────────────────────
export interface AffRow {
  nama: string; gmv: number; live: number; vid: number; nVid: number; nLive: number; sampel: number; order: number; komisi: number;
}
export interface AffMetric {
  rows: AffRow[]; total: number; withSales: number; rate: number | null; gmv: number;
  rateAktif: number | null; postedSales: number; posted: number; nempel: number; nempelRate: number | null;
  top5Share: number | null; top1Share: number | null; top: AffRow[]; sampel: number;
  sampelKreator: number; sampelSukses: number; sampelGmv: number; komisi: number;
}
export function aff(d: Sheet): AffMetric {
  requireCols(['Creator name', 'GMV dari kreator'], d.cols, 'Afiliasi — Daftar Kreator');
  const R: AffRow[] = d.rows
    .map((r) => ({
      nama: String(r['Creator name'] || '').trim(), gmv: n(r['GMV dari kreator']),
      live: n(r['GMV dari LIVE kreator']), vid: n(r['GMV dari video afiliasi']),
      nVid: n(r['Video']), nLive: n(r['Siaran LIVE']), sampel: n(r['Sampel terkirim']),
      order: n(r['Pesanan teratribusi']), komisi: n(r['Perkiraan komisi']),
    }))
    .filter((r) => r.nama && r.nama.length < 60);
  const tot = R.reduce((a, r) => a + r.gmv, 0);
  const S = R.filter((r) => r.gmv > 0), posted = R.filter((r) => r.nVid + r.nLive > 0);
  const postedSales = posted.filter((r) => r.gmv > 0), nempel = posted.filter((r) => r.gmv <= 0);
  const top = [...S].sort((a, b) => b.gmv - a.gmv);
  const smp = R.filter((r) => r.sampel > 0);
  return {
    rows: R, total: R.length, withSales: S.length, rate: div(S.length, R.length), gmv: tot,
    rateAktif: div(postedSales.length, posted.length || 1), postedSales: postedSales.length, posted: posted.length,
    nempel: nempel.length, nempelRate: div(nempel.length, posted.length || 1),
    top5Share: div(top.slice(0, 5).reduce((a, r) => a + r.gmv, 0), tot), top1Share: div(top[0] ? top[0].gmv : 0, tot),
    top: top.slice(0, 10), sampel: R.reduce((a, r) => a + r.sampel, 0),
    sampelKreator: smp.length, sampelSukses: smp.filter((r) => r.gmv > 0).length,
    sampelGmv: smp.reduce((a, r) => a + r.gmv, 0), komisi: R.reduce((a, r) => a + r.komisi, 0),
  };
}

// ── C.prod (Analitik Produk — TikTok) ───────────────────────────────────────
export interface ProdRow {
  nama: string; gmv: number; klik: number; impresi: number; ctr: number; ctor: number; terjual: number;
  aov: number; status: string; fromAff: number; refund: number;
}
export interface ProdMetric {
  rows: ProdRow[]; total: number; withSales: number; rate: number | null; gmv: number;
  top3Share: number | null; top: ProdRow[]; mk: number; mc: number; affShare: number | null;
  quad: { star: number; traffic: number; niche: number; cold: number };
}
export function prod(d: Sheet): ProdMetric {
  requireCols(['Nama', 'GMV', 'Klik produk'], d.cols, 'Analitik Produk — TikTok');
  const R: ProdRow[] = d.rows
    .map((r) => ({
      nama: String(r['Nama'] || '').trim(), gmv: n(r['GMV']),
      klik: n(r['Klik produk']), impresi: n(r['Impresi produk']), ctr: n(r['CTR']),
      ctor: n(r['CTOR (pesanan SKU)']), terjual: n(r['Produk terjual']),
      aov: n(r['AOV (pesanan SKU)']), status: String(r['Status daftar produk'] || ''),
      fromAff: n(r['GMV dari kreator']), refund: n(r['Pengembalian dana']),
    }))
    .filter((r) => r.nama && r.nama.length < 160);
  const tot = R.reduce((a, r) => a + r.gmv, 0);
  const S = R.filter((r) => r.gmv > 0).sort((a, b) => b.gmv - a.gmv);
  const mk = median(R.map((r) => r.klik)), mc = median(S.map((r) => r.ctor));
  return {
    rows: R, total: R.length, withSales: S.length, rate: div(S.length, R.length), gmv: tot,
    top3Share: div(S.slice(0, 3).reduce((a, r) => a + r.gmv, 0), tot), top: S.slice(0, 10),
    mk, mc, affShare: div(R.reduce((a, r) => a + r.fromAff, 0), tot),
    quad: {
      star: S.filter((r) => r.klik >= mk && r.ctor >= mc).length,
      traffic: R.filter((r) => r.klik >= mk && r.ctor < mc).length,
      niche: S.filter((r) => r.klik < mk && r.ctor >= mc).length,
      cold: R.filter((r) => r.klik < mk && r.ctor < mc && r.gmv <= 0).length,
    },
  };
}

// ── C.ads (Ads Manager — Produk/GMV Max + LIVE) ─────────────────────────────
export interface AdsTopVid {
  judul: string; akun: string; spend: number; rev: number; ord: number; cvr: number; hold2: number; hold100: number;
}
export interface AdsMetric {
  ada: boolean; nCreative: number; nLive: number; spend: number; rev: number; ord: number; roas: number | null;
  spendP: number; revP: number; roasP: number | null; spendL: number; revL: number; roasL: number | null;
  byMat: Record<string, { spend: number; rev: number; ord: number; n: number }>;
  byCamp: Record<string, { spend: number; rev: number }>; topVid: AdsTopVid[]; cpo: number | null;
}
export function ads(dp: Sheet | null, dl: Sheet | null): AdsMetric {
  if (dp) requireCols(['Nama kampanye', 'Biaya', 'Pendapatan kotor'], dp.cols, 'Ads Manager — Produk/GMV Max');
  if (dl) requireCols(['Nama LIVE', 'Biaya', 'Pendapatan kotor'], dl.cols, 'Ads Manager — LIVE');
  const rowsP = dp ? dp.rows.filter((r) => r['Nama kampanye']) : [];
  const rowsL = dl ? dl.rows.filter((r) => r['Nama LIVE']) : [];
  const sum = (a: Record<string, unknown>[], c: string): number => a.reduce((x, r) => x + n(r[c], true), 0);
  const spendP = sum(rowsP, 'Biaya'), revP = sum(rowsP, 'Pendapatan kotor'), ordP = sum(rowsP, 'Pesanan SKU');
  const spendL = sum(rowsL, 'Biaya'), revL = sum(rowsL, 'Pendapatan kotor'), ordL = sum(rowsL, 'Pesanan SKU');
  const byMat: Record<string, { spend: number; rev: number; ord: number; n: number }> = {};
  rowsP.forEach((r) => {
    const k = String(r['Jenis materi iklan'] || 'Lainnya');
    byMat[k] = byMat[k] || { spend: 0, rev: 0, ord: 0, n: 0 };
    byMat[k].spend += n(r['Biaya'], true); byMat[k].rev += n(r['Pendapatan kotor'], true);
    byMat[k].ord += n(r['Pesanan SKU'], true); byMat[k].n++;
  });
  const byCamp: Record<string, { spend: number; rev: number }> = {};
  rowsP.forEach((r) => {
    const k = String(r['Nama kampanye'] || '-');
    byCamp[k] = byCamp[k] || { spend: 0, rev: 0 };
    byCamp[k].spend += n(r['Biaya'], true); byCamp[k].rev += n(r['Pendapatan kotor'], true);
  });
  const topVid: AdsTopVid[] = rowsP
    .filter((r) => String(r['Jenis materi iklan']) === 'Video' && n(r['Pendapatan kotor'], true) > 0)
    .map((r) => ({
      judul: String(r['Judul video'] || '-').replace(/\s+/g, ' ').trim(), akun: String(r['Akun TikTok'] || ''),
      spend: n(r['Biaya'], true), rev: n(r['Pendapatan kotor'], true), ord: n(r['Pesanan SKU'], true),
      cvr: n(r['Rasio konversi iklan'], true), hold2: n(r['Rasio tayang video iklan 2 detik'], true),
      hold100: n(r['Rasio tayang video iklan 100%'], true),
    }))
    .sort((a, b) => b.rev - a.rev)
    .slice(0, 10);
  return {
    ada: !!(rowsP.length || rowsL.length), nCreative: rowsP.length, nLive: rowsL.length,
    spend: spendP + spendL, rev: revP + revL, ord: ordP + ordL, roas: div(revP + revL, spendP + spendL),
    spendP, revP, roasP: div(revP, spendP), spendL, revL, roasL: div(revL, spendL),
    byMat, byCamp, topVid, cpo: div(spendP + spendL, ordP + ordL),
  };
}
