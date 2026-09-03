/**
 * Shopee report engine — payload → standalone HTML (tool `reportBodyHTML`).
 *
 * Reuses TikTok's `../render.ts` design system wholesale (`kpi`, `grid`,
 * `tabel`, `td`, `kosong`, `rekCard`, `kartuInternal`, `gauge`, `KUADRAN_META`,
 * `quadBubble`, `jsonForScript`, `rpPendek`) rather than building a second one
 * — the plan is explicit about this ("bukan sistem desain kedua"). The only
 * genuinely NEW visual piece is the score/attention banner (`seksiPerhatian`),
 * because Shopee's `perhatian_utama` is derived from numbers on the payload,
 * not narrative text (see `insight.ts` file header for why it isn't a 7th
 * insight field).
 *
 * Same two house rules as TikTok's renderer:
 *  - `mode: 'internal'` blocks are OMITTED from the string in `klien` mode,
 *    never hidden with CSS.
 *  - money/percent/number formatting is the house formatter (`baseline/angka.ts`),
 *    never the tool's own `fmtRp`/`fmtPct`.
 */
import { dec, esc, num, pct, rp } from '../../baseline/angka';
import {
  gauge, grid, jsonForScript, kartuInternal, kosong, kpi, KUADRAN_META, quadBubble, rekCard, rpPendek, tabel, td,
  type RenderMode,
} from '../render';
import type { ShopeePayloadInsight, ShopeeReportPayload } from './payload';

export type { RenderMode };

const DASH = '—';

/** Shopee's quadrant palette = TikTok's + the one bucket TikTok never needed (`no_data`: traffic exists but conversion status is unreadable). */
const KUADRAN_META_SHOPEE: Record<string, [string, string, string]> = {
  ...KUADRAN_META,
  no_data: ['No Data', '#E2E8F0', 'Traffic ada tapi status pesanan tidak terbaca dari data'],
};

type ProdukQ = { nama: string | null; kode: string; gmv: number | null; traffic: number | null; cr: number | null };
type Bucket = { jumlah: number; gmv: number | null; produk: ProdukQ[] };

/**
 * Adapter into TikTok's `quadBubble`, which expects `{nama,gmv,klik,cvr}` —
 * `klik`/`cvr` there just mean "x axis"/"y axis", not literally TikTok's own
 * click/CVR vocabulary. Shopee's payload keeps its OWN honest field names
 * (`traffic`, `cr`); this relabels them purely to satisfy the reused chart
 * helper's parameter shape, so it does not need a second bubble-chart
 * implementation for what is geometrically the identical chart.
 */
function toBubbleShape(b: Record<string, Bucket>): Record<string, { produk: { nama: string; gmv: number | null; klik: number | null; cvr: number | null }[] }> {
  return Object.fromEntries(Object.entries(b).map(([q, v]) => [q, { produk: v.produk.map((p) => ({ nama: p.nama ?? '', gmv: p.gmv, klik: p.traffic, cvr: p.cr })) }]));
}

export function chartData(p: ShopeeReportPayload): Record<string, unknown> {
  const h = p.kpi.harian;
  const adsAgg = (items: { omzet: number | null; biaya: number | null }[]) =>
    items.reduce((a, i) => ({ o: a.o + (i.omzet ?? 0), b: a.b + (i.biaya ?? 0) }), { o: 0, b: 0 });
  const isSGM = (nama: string) => nama.toLowerCase().includes('shop gmv max');
  const sgm = adsAgg(p.ads.produk.filter((i) => isSGM(i.nama)));
  const pa = adsAgg(p.ads.produk.filter((i) => !isSGM(i.nama)));
  const tk = adsAgg(p.ads.toko);
  const lv = adsAgg(p.ads.live);
  const bn = adsAgg(p.ads.banner);
  const adsLabels = ['Shop GMV Max', 'Product Ads', 'Iklan Toko', 'Iklan Live', 'Search Brand Ads'];
  const adsOmzet = [sgm.o, pa.o, tk.o, lv.o, bn.o], adsBiaya = [sgm.b, pa.b, tk.b, lv.b, bn.b];
  if (p.meta?.spend) { adsLabels.push('Meta CPAS'); adsOmzet.push(p.meta.purchase_value ?? 0); adsBiaya.push(p.meta.spend ?? 0); }
  return {
    harian: { labels: h.map((d) => (d.tanggal ?? '').slice(0, 5)), gmv: h.map((d) => d.gmv ?? 0), pesanan: h.map((d) => d.pesanan ?? 0) },
    kanal: { labels: p.kanal.items.map((x) => x.nama.replace(/_/g, ' ')), values: p.kanal.items.map((x) => x.nilai ?? 0) },
    ads: { labels: adsLabels, omzet: adsOmzet, biaya: adsBiaya },
    quadRel: p.produk ? quadBubble(toBubbleShape(p.produk.relatif), { klik_tinggi: p.produk.ambang.relatif.traffic_tinggi, cvr_tinggi: p.produk.ambang.relatif.cr_tinggi }) : null,
    quadBench: p.produk ? quadBubble(toBubbleShape(p.produk.benchmark), { klik_tinggi: p.produk.ambang.benchmark.traffic_tinggi, cvr_tinggi: p.produk.ambang.benchmark.cr_tinggi }) : null,
    video: p.video && p.video.sumber.length ? { labels: p.video.sumber.filter((s) => (s.ditonton ?? 0) > 0).map((s) => s.label), ditonton: p.video.sumber.filter((s) => (s.ditonton ?? 0) > 0).map((s) => s.ditonton ?? 0) } : null,
  };
}

// ---------------------------------------------------------------------------
// Score + attention banner (derived from PAYLOAD numbers, not insight prose —
// see file header and `insight.ts`)
// ---------------------------------------------------------------------------
function seksiSkor(p: ShopeeReportPayload, mode: RenderMode): string {
  const warna = (s: number): string => (s >= 8 ? 'emerald' : s >= 6 ? 'amber' : 'red');
  const dims = p.skor.dimensi.map((d) => `<div class="bg-${warna(d.skor)}-50 border border-${warna(d.skor)}-100 rounded-lg p-3">
    <div class="text-[0.7rem] font-semibold text-slate-500 uppercase tracking-wide">${esc(d.label)}</div>
    <div class="text-2xl font-bold text-${warna(d.skor)}-700 mt-1">${dec(d.skor, 1)}</div>
    <div class="text-[0.7rem] text-slate-500">${Math.round(d.bobot * 100)}% • kontrib ${dec(d.skor * d.bobot, 2)}</div>
    ${mode === 'internal' ? `<div class="text-[0.7rem] text-slate-600 mt-1">${esc(d.catatan)}</div>` : ''}</div>`).join('');

  // The banner the tool called `perhatian_utama` — entirely re-derivable from
  // fields already on the payload, so it lives here rather than in `insight.ts`.
  const cancel = (p.kpi.pesanan ?? 0) > 0 ? (p.kpi.batal_pesanan ?? 0) / (p.kpi.pesanan as number) : null;
  const bits: string[] = [`Skor performa keseluruhan ${dec(p.skor.total, 1)}/10 — ${esc(p.skor.label)}.`];
  if (p.kesehatan_toko && p.kesehatan_toko.poin_total > 0) bits.push(`⚠️ Penalti aktif ${p.kesehatan_toko.poin_total} poin — prioritas #1 bulan ini.`);
  if (cancel != null && cancel > 0.08) bits.push(`Cancel rate ${pct(cancel, 1)} adalah isu paling mendesak.`);
  if (p.zero_activity.includes('bisnis_live')) bits.push('Live streaming tidak aktif — potensi kanal besar terlewat.');

  return `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 md:p-6 mb-8">
  <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
    <div><h2 class="font-display text-lg md:text-xl font-bold text-slate-900">Skor Performa Keseluruhan</h2>
      <p class="text-sm text-slate-500">Bobot standar MEA untuk Shopee</p></div>
    <div class="flex items-center gap-4">${gauge(p.skor.total)}
      <div class="text-right"><div class="text-sm font-semibold text-${warna(p.skor.total)}-700">${esc(p.skor.label)}</div>
        <div class="text-xs text-slate-500 mt-0.5">${p.skor.dimensi.length} dimensi berbobot</div></div></div></div>
  <div class="grid grid-cols-2 md:grid-cols-6 gap-3">${dims}</div>
  <div class="mt-4 p-3 bg-teal-50 rounded-lg text-sm text-slate-700"><i class="fa-solid fa-circle-info text-teal-600 mr-1"></i> ${bits.map(esc).join(' ')}</div></div>`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function seksiRingkasan(p: ShopeeReportPayload, I: ShopeePayloadInsight): string {
  const k = p.kpi;
  const cancel = (k.pesanan ?? 0) > 0 ? (k.batal_pesanan ?? 0) / (k.pesanan as number) : null;
  // SHP-1 — kotor and bersih side by side, with the gap named rather than left
  // for the reader to subtract. When the export has no paid section the card
  // says so instead of repeating the gross figure under a "bersih" label.
  const bersih = k.dibayar;
  const gap = bersih != null && k.gmv != null && bersih.gmv != null ? k.gmv - bersih.gmv : null;
  const cards = [
    kpi('GMV Kotor (Pesanan Dibuat)', rpPendek(k.gmv), `${num(k.pesanan)} pesanan • ${num(k.pembeli)} pembeli`),
    bersih == null
      ? kpi('GMV Bersih (Pesanan Dibayar)', DASH, 'export tidak memuat bagian Pesanan Dibayar')
      : kpi(
          'GMV Bersih (Pesanan Dibayar)',
          rpPendek(bersih.gmv),
          `${num(bersih.pesanan)} pesanan • selisih ${rpPendek(gap)} dari kotor`,
        ),
    kpi('GMV Siap Kirim', rpPendek(k.siap_kirim.gmv), `${num(k.siap_kirim.pesanan)} pesanan • CR ${pct(k.siap_kirim.cvr)}`),
    kpi('ROAS Ads Shopee', p.kesehatan.ads?.roas == null ? DASH : dec(p.kesehatan.ads.roas, 2) + 'x', `spend ${rpPendek(p.kesehatan.ads?.spend)}`),
    kpi('Pengunjung Toko', num(k.pengunjung), `CR ${pct(k.cvr)}`),
    kpi('Pembeli Baru', num(k.pembeli_baru), `${pct(k.pembeli ? (k.pembeli_baru ?? 0) / k.pembeli : null)} dari total`),
    kpi('Repeat Rate', pct(k.repeat_rate), '% pembelian ulang'),
    kpi('Cancel Rate', pct(cancel), `${num(k.batal_pesanan)} pesanan • rugi ${rp(k.batal_nilai)}`),
    kpi('AOV', rpPendek(k.aov), 'average order value'),
  ];
  return `${grid(cards)}
  <div class="mt-4 p-4 bg-white rounded-xl border border-slate-100 insight-card"><p class="text-sm font-medium text-slate-700">${esc(I.ringkasan)}</p></div>`;
}

function seksiKanal(p: ShopeeReportPayload): string {
  if (!p.kanal.items.length) return kosong('GMV belum tersedia untuk menghitung kontribusi kanal.');
  const rows = [...p.kanal.items].sort((a, b) => (b.nilai ?? -1) - (a.nilai ?? -1))
    .map((c) => `<tr class="border-b last:border-0">${td(esc(c.nama.replace(/_/g, ' ')))}${td(`<b>${rp(c.nilai)}</b>`, true)}${td(pct(c.persen, 1), true)}</tr>`);
  return `<div class="grid md:grid-cols-2 gap-4">
  <div class="bg-white rounded-xl border border-slate-100 p-5"><canvas id="c_kanal" height="220"></canvas></div>
  <div class="bg-white rounded-xl border border-slate-100 p-5">${tabel(['Sumber GMV', 'GMV', 'Kontribusi'], rows, ['l', 'r', 'r'])}
    <p class="text-xs text-slate-500 mt-3"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Angka antar kanal saling overlap — satu transaksi bisa tercatat di ads + affiliate + voucher.</p></div></div>`;
}

function seksiAds(p: ShopeeReportPayload, mode: RenderMode): string {
  const a = p.kesehatan.ads;
  if (!a && !p.ads.toko.length && !p.ads.produk.length && !p.ads.live.length && !p.ads.banner.length) return kosong('Berkas iklan tidak diunggah.');
  const isSGM = (nama: string) => nama.toLowerCase().includes('shop gmv max');
  const aggR = (items: { omzet: number | null; biaya: number | null; klik?: number | null; dilihat?: number | null }[]) =>
    items.reduce((acc, i) => ({ o: acc.o + (i.omzet ?? 0), b: acc.b + (i.biaya ?? 0), k: acc.k + (i.klik ?? 0), v: acc.v + (i.dilihat ?? 0) }), { o: 0, b: 0, k: 0, v: 0 });
  const sgm = aggR(p.ads.produk.filter((i) => isSGM(i.nama))), pa = aggR(p.ads.produk.filter((i) => !isSGM(i.nama))), tk = aggR(p.ads.toko), bn = aggR(p.ads.banner);
  const lv = p.ads.live.reduce((acc, i) => ({ o: acc.o + (i.omzet ?? 0), b: acc.b + (i.biaya ?? 0), p: acc.p + (i.penonton ?? 0), ps: acc.ps + (i.pesanan ?? 0) }), { o: 0, b: 0, p: 0, ps: 0 });
  const row = (label: string, x: { o: number; b: number; k?: number; p?: number; ps?: number }, kind: 'ads' | 'live'): string => {
    const roas = x.b ? x.o / x.b : 0, acos = x.o ? x.b / x.o : 0;
    const detail = kind === 'ads'
      ? `<span>Omzet: ${rp(x.o)}</span><span>Biaya: ${rp(x.b)}</span><span>Klik: ${num(x.k)}</span><span>ACOS: ${pct(acos)}</span>`
      : `<span>Omzet: ${rp(x.o)}</span><span>Biaya: ${rp(x.b)}</span><span>Penonton: ${num(x.p)}</span><span>Pesanan: ${num(x.ps)}</span>`;
    return `<div class="border-b py-2 last:border-0"><div class="flex justify-between items-center"><span class="font-semibold text-sm">${esc(label)}</span><span class="text-lg font-bold text-teal-700">${dec(roas, 2)}x</span></div><div class="text-xs text-slate-500 grid grid-cols-2 gap-1 mt-1">${detail}</div></div>`;
  };
  let adsBreak = '<h3 class="font-semibold text-sm text-slate-600 mb-3">Rincian per Sumber</h3>'
    + row('Iklan Otomatis (Shop GMV Max)', sgm, 'ads') + row('Iklan Individu & Grup (Product Ads)', pa, 'ads') + row('Iklan Toko', tk, 'ads');
  if (p.ads.live.length) adsBreak += row('Iklan Live', lv, 'live');
  if (p.ads.banner.length) adsBreak += row('Search Brand Ads (Banner)', bn, 'ads');
  if (p.meta?.spend) adsBreak += row('Meta CPAS', { o: p.meta.purchase_value ?? 0, b: p.meta.spend ?? 0, k: p.meta.clicks ?? 0 }, 'ads');
  const summary = grid([
    kpi('Total Omzet Ads', rpPendek(a?.omzet), `ROAS ${a?.roas == null ? DASH : dec(a.roas, 2) + 'x'}`),
    kpi('Total Biaya', rpPendek(a?.spend), `ACOS ${pct(a?.acos ?? null)}`),
    kpi('Total Klik', num(sgm.k + pa.k + tk.k + bn.k), `CTR ${pct(a?.ctr ?? null)}`),
    kpi('Total Impresi', num(sgm.v + pa.v + tk.v + bn.v), ''),
  ]);
  const internal = mode !== 'internal' ? '' : kartuInternal('Rincian per Sumber (internal)', 'Rincian biaya/omzet per sumber di atas dihitung dari data tersimpan di payload — bisa dihitung ulang kapan pun dari `benchmark_versi` yang sama.', 'slate', 'fa-magnifying-glass-chart');
  return `${summary}<div class="grid md:grid-cols-2 gap-4 mt-4"><div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Omzet vs Biaya per Sumber</h3><canvas id="c_ads" height="200"></canvas></div><div class="bg-white rounded-xl border border-slate-100 p-5">${adsBreak}</div></div>${internal ? `<div class="mt-4">${internal}</div>` : ''}`;
}

function seksiProduk(p: ShopeeReportPayload): string {
  const Q = p.produk;
  if (!Q) return kosong('Berkas Analitik Produk tidak diunggah.');
  const dist = (b: Record<string, { jumlah: number; gmv: number | null }>): string => {
    const tot = Object.values(b).reduce((a, v) => a + v.jumlah, 0) || 1;
    return Object.entries(KUADRAN_META_SHOPEE).map(([q, [label, warna]]) => {
      const n = b[q]?.jumlah ?? 0;
      if (!n && (q === 'tidur' || q === 'tidak_tayang' || q === 'no_data')) return '';
      return `<div><div class="flex justify-between text-xs mb-0.5"><span>${esc(label)}</span><span class="font-semibold">${n}</span></div>
        <div class="w-full bg-slate-100 rounded-full h-1.5"><div style="width:${((n / tot) * 100).toFixed(0)}%;background:${warna}" class="h-1.5 rounded-full"></div></div></div>`;
    }).join('');
  };
  const panel = (judul: string, sub: string, b: Record<string, Bucket>, amb: { traffic_tinggi: number | null; cr_tinggi: number | null }): string =>
    `<div class="bg-white rounded-xl border border-slate-100 p-5">
      <div class="flex items-center justify-between mb-2"><h3 class="font-semibold text-slate-700">${esc(judul)}</h3><span class="text-xs px-2 py-1 bg-teal-50 text-teal-700 rounded-full">${esc(sub)}</span></div>
      <p class="text-xs text-slate-500 mb-3">Ambang: pengunjung ≥${num(amb.traffic_tinggi)} = traffic tinggi • CR ≥${pct(amb.cr_tinggi, 2)} = closing tinggi.</p>
      <div class="space-y-1.5">${dist(b)}</div></div>`;
  const legenda = Object.entries(KUADRAN_META_SHOPEE).filter(([q]) => !['tidur', 'tidak_tayang', 'no_data'].includes(q))
    .map(([, [label, warna, ket]]) => `<div class="mt-1"><span style="color:${warna}">●</span> <b>${esc(label)}</b> — ${esc(ket)}</div>`).join('');
  const allRecs = new Map<string, ProdukQ>();
  for (const b of [Q.relatif, Q.benchmark]) for (const q of Object.values(b)) for (const pr of q.produk) allRecs.set(pr.kode, pr);
  const top = [...allRecs.values()].sort((a, b) => (b.gmv ?? 0) - (a.gmv ?? 0)).slice(0, 10);
  const findQ = (b: Record<string, Bucket>, kode: string): string => { for (const q in b) if (b[q].produk.some((x) => x.kode === kode)) return q; return ''; };
  const topRows = top.map((pr, i) => {
    const qr = findQ(Q.relatif, pr.kode), qa = findQ(Q.benchmark, pr.kode);
    const [lr, cr] = KUADRAN_META_SHOPEE[qr] ?? ['—', '#94A3B8']; const [la, ca] = KUADRAN_META_SHOPEE[qa] ?? ['—', '#94A3B8'];
    return `<tr class="border-b last:border-0">${td(String(i + 1))}${td(esc((pr.nama ?? '').slice(0, 55)))}${td(num(pr.traffic), true)}${td(`<b>${rp(pr.gmv)}</b>`, true)}${td(pct(pr.cr), true)}${td(`<span class="text-xs px-2 py-1 rounded-full" style="background:${cr}22;color:${cr}">${esc(lr)}</span>`)}${td(`<span class="text-xs px-2 py-1 rounded-full" style="background:${ca}22;color:${ca}">${esc(la)}</span>`)}</tr>`;
  });
  return `<p class="text-sm text-slate-500 mb-4">Dua sudut pandang: <b>Relatif</b> (performa antar produk toko ini) & <b>Benchmark</b> (vs target ideal).</p>
  <div class="grid md:grid-cols-2 gap-4">
    ${panel('Mode Relatif', 'adaptif per toko', Q.relatif, Q.ambang.relatif)}
    ${panel('Mode Benchmark', 'vs target ideal', Q.benchmark, Q.ambang.benchmark)}</div>
  <div class="grid md:grid-cols-2 gap-4 mt-4">
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Sebaran Produk — Mode Relatif</h3><canvas id="c_quad_rel" height="260"></canvas></div>
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Sebaran Produk — vs Benchmark</h3><canvas id="c_quad_bench" height="260"></canvas></div></div>
  <div class="mt-3 p-3 bg-slate-50 rounded-lg text-xs text-slate-600"><b>Cara baca:</b> traffic = pengunjung produk, closing = pesanan/pengunjung.${legenda}</div>
  <div class="mt-4 bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-slate-700 mb-3">Top Produk by GMV</h3>${tabel(['#', 'Produk', 'Pengunjung', 'GMV', 'CR', 'Relatif', 'Benchmark'], topRows, ['l', 'l', 'r', 'r', 'r', 'l', 'l'])}</div>`;
}

function seksiVideo(p: ShopeeReportPayload): string {
  const V = p.video;
  if (!V || !V.has_activity) return kosong(V ? 'Tidak ada aktivitas Shopee Video di periode ini — kanal traffic gratis yang belum dimanfaatkan.' : 'Berkas Shopee Video tidak diunggah.');
  const interaksi = (V.suka ?? 0) + (V.share ?? 0) + (V.komentar ?? 0);
  const cards = grid([
    kpi('GMV Video (Dibuat)', rpPendek(V.gmv_dibuat), `${num(V.pesanan_dibuat)} pesanan`),
    kpi('GMV Siap Kirim', rpPendek(V.gmv_siap), `${num(V.pesanan_siap)} pesanan`),
    kpi('Ditonton', num(V.ditonton), `${num(V.penonton)} penonton unik`),
    kpi('Penonton Efektif', num(V.penonton_efektif), V.penonton ? `>3 detik • ${pct(V.penonton_efektif != null && V.penonton ? V.penonton_efektif / V.penonton : null)} dari penonton` : '>3 detik'),
    kpi('CTR Video', pct(V.ctr), `${num(V.klik_produk)} klik produk`),
    kpi('Add to Cart', num(V.atc), ''),
    kpi('Interaksi', num(interaksi), `${num(V.suka)} suka • ${num(V.share)} share • ${num(V.komentar)} komentar`),
    kpi('Follower Baru', num(V.follower_baru), `completion ${pct(V.completion)}`),
  ]);
  const rows = V.sumber.filter((s) => (s.ditonton ?? 0) > 0).sort((a, b) => (b.ditonton ?? 0) - (a.ditonton ?? 0))
    .map((s) => `<tr class="border-b last:border-0">${td(esc(s.label))}${td(num(s.ditonton), true)}${td(num(s.penonton), true)}${td(num(s.penonton_efektif), true)}</tr>`);
  return `${cards}<div class="grid md:grid-cols-2 gap-4 mt-4">
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Sumber Penonton (berdasarkan Ditonton)</h3><canvas id="c_video_sumber" height="220"></canvas></div>
    <div class="bg-white rounded-xl border border-slate-100 p-5">${tabel(['Sumber', 'Ditonton', 'Penonton', 'Efektif (>3s)'], rows, ['l', 'r', 'r', 'r'])}</div></div>`;
}

function seksiAfiliasi(p: ShopeeReportPayload): string {
  const A = p.affiliasi;
  if (!A.total_creators && !A.total_products) return kosong('Berkas affiliate tidak diunggah.');
  const cards = grid([
    kpi('Total GMV Affiliate', rpPendek(A.total_omzet), ''),
    kpi('Total Komisi', rpPendek(A.total_komisi), A.total_komisi ? `ROI ${dec(A.total_omzet != null ? A.total_omzet / A.total_komisi : 0, 1)}x` : ''),
    kpi('Total Affiliate', num(A.total_creators), `${num(A.total_creators)} creator • top 10 di bawah`),
    kpi('Kontribusi Affiliate', p.kpi.gmv ? pct(A.total_omzet != null ? A.total_omzet / p.kpi.gmv : null) : DASH, '% dari GMV toko'),
  ]);
  const rows = A.top_creators.slice(0, 10).map((c, i) => `<tr class="border-b last:border-0">${td(String(i + 1))}${td(esc(c.nama))}${td(`<b>${rp(c.omzet)}</b>`, true)}${td(num(c.pesanan), true)}${td(rp(c.komisi), true)}</tr>`);
  return `${cards}<div class="mt-4">${tabel(['#', 'Creator', 'GMV', 'Pesanan', 'Komisi'], rows, ['l', 'l', 'r', 'r', 'r'])}</div>`;
}

function seksiVoucher(p: ShopeeReportPayload): string {
  const v = p.voucher;
  if (!v) return kosong('Berkas Voucher tidak diunggah.');
  return grid([
    kpi('GMV Voucher', rpPendek(v.gmv), ''),
    kpi('Biaya Voucher', rpPendek(v.biaya), ''),
    kpi('Klaim', num(v.klaim), `pesanan ${num(v.pesanan)}`),
    kpi('Usage Rate', pct(v.usage_rate), 'pesanan/klaim'),
  ]);
}

function seksiLayanan(p: ShopeeReportPayload): string {
  const chat = p.kesehatan.chat;
  const rows: string[] = [];
  const st = (flg: string, txt: string): string => {
    const cls = flg === 'hijau' ? 'green' : flg === 'kuning' ? 'yellow' : flg === 'merah' ? 'red' : 'gray';
    const dot = flg === 'hijau' ? '🟢' : flg === 'kuning' ? '🟡' : flg === 'merah' ? '🔴' : '⚪';
    return `<span class="px-2 py-1 rounded-full text-xs status-${cls}">${dot} ${esc(txt)}</span>`;
  };
  if (chat) {
    rows.push(`<tr class="border-b">${td('Tingkat Chat Direspon')}${td(pct(chat.response_rate), true)}${td('&gt;95%', true)}${td(st(chat.flag_response_rate, 'direspon'))}</tr>`);
    const detOc = chat.order_conversion_penanya ? `${num(chat.order_conversion_pembeli)} pembeli / ${num(chat.order_conversion_penanya)} penanya` : '';
    rows.push(`<tr class="border-b">${td(`Konversi Order dari Chat<div class="text-xs text-slate-400">${detOc}</div>`)}${td(pct(chat.order_conversion), true)}${td('&gt;20%', true)}${td(st(chat.flag_order_conversion, 'order'))}</tr>`);
    rows.push(`<tr class="border-b">${td('CSAT Chat')}${td(pct(chat.csat), true)}${td('&gt;85%', true)}${td(st(chat.flag_csat, 'CSAT'))}</tr>`);
    const rs = chat.respon_detik ?? 0, hh = Math.floor(rs / 3600), mm = Math.floor((rs % 3600) / 60);
    rows.push(`<tr class="border-b">${td('Waktu Respon Chat')}${td(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, true)}${td('&lt;1 jam', true)}${td(st(chat.flag_respon, ''))}</tr>`);
  }
  const cancel = (p.kpi.pesanan ?? 0) > 0 ? (p.kpi.batal_pesanan ?? 0) / (p.kpi.pesanan as number) : null;
  const cf = cancel == null ? 'kosong' : cancel < 0.05 ? 'hijau' : cancel < 0.10 ? 'kuning' : 'merah';
  rows.push(`<tr class="border-b">${td(`Cancel Rate<div class="text-xs text-slate-400">${num(p.kpi.batal_pesanan)} pesanan • ${rp(p.kpi.batal_nilai)}</div>`)}${td(pct(cancel), true)}${td('&lt;5%', true)}${td(st(cf, 'cancel'))}</tr>`);
  rows.push(`<tr class="border-b">${td('Retur')}${td(`${num(p.kpi.retur_pesanan)} pesanan (${rp(p.kpi.retur_nilai)})`, true)}${td('&lt;1%', true)}${td(st((p.kpi.retur_pesanan ?? 0) < 5 ? 'hijau' : 'kuning', 'retur'))}</tr>`);
  if (p.zero_activity.includes('bisnis_live')) rows.push(`<tr class="border-b">${td('Live Streaming')}${td('0 sesi', true)}${td('≥3 sesi/mg', true)}${td(st('merah', 'tidak aktif'))}</tr>`);
  if (p.zero_activity.includes('layanan_broadcast')) rows.push(`<tr class="border-b">${td('Chat Broadcast')}${td('0 broadcast', true)}${td('rutin', true)}${td(st('merah', 'tidak aktif'))}</tr>`);
  if (p.zero_activity.includes('bisnis_video')) rows.push(`<tr class="border-b">${td('Shopee Video')}${td('0 aktivitas', true)}${td('aktif', true)}${td(st('merah', 'tidak aktif'))}</tr>`);
  if (p.kesehatan_toko) rows.push(`<tr class="border-b">${td('Poin Penalti')}${td(`${num(p.kesehatan_toko.poin_total)} poin`, true)}${td('0 poin', true)}${td(st(p.kesehatan_toko.poin_total > 0 ? 'merah' : 'hijau', p.kesehatan_toko.poin_total > 0 ? 'penalti aktif' : 'bersih'))}</tr>`);

  let penaltiHTML = '';
  const kt = p.kesehatan_toko;
  if (kt && kt.poin_total > 0) {
    const list = kt.penalti.map((x) => `<div class="flex justify-between items-start gap-3 py-2 border-b border-red-100 last:border-0"><div><div class="font-semibold text-sm text-red-800">${esc(x.deskripsi)}</div><div class="text-xs text-red-600">${esc(x.durasi)}</div></div><div class="text-lg font-bold text-red-700 whitespace-nowrap">${num(x.poin)} poin</div></div>`).join('');
    penaltiHTML = `<div class="mb-4 bg-red-50 border border-red-200 rounded-xl p-5"><h3 class="font-semibold text-red-800 mb-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Penalti Aktif — ${num(kt.poin_total)} Poin</h3><p class="text-xs text-red-700 mb-2">Poin penalti menekan traffic organik dan membatasi akses promosi Shopee selama masa penalti berjalan.</p>${list}</div>`;
  } else if (kt) {
    penaltiHTML = `<div class="mb-4 bg-teal-50 border border-teal-100 rounded-xl p-4 text-sm text-slate-700"><i class="fa-solid fa-shield-halved text-teal-600 mr-1"></i> <b>0 poin penalti</b> — kesehatan toko bersih.</div>`;
  }
  return `${penaltiHTML}<div class="bg-white rounded-xl border border-slate-100 p-5">${tabel(['Metrik', 'Nilai', 'Target', 'Status'], rows, ['l', 'r', 'r', 'l'])}</div>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------
const CHART_BOOT = `
(function(){
 var C=window.CHART_DATA||{},T='#0F766E',TL='rgba(15,118,110,.15)',O='#EA580C';
 function el(id){return document.getElementById(id);}
 if(typeof Chart==='undefined')return;
 if(el('c_harian')&&C.harian) new Chart(el('c_harian'),{type:'line',data:{labels:C.harian.labels,datasets:[
  {label:'GMV',data:C.harian.gmv,borderColor:T,backgroundColor:TL,fill:true,tension:.3,borderWidth:2,pointRadius:2},
  {label:'Pesanan',data:C.harian.pesanan,borderColor:O,fill:false,tension:.3,borderWidth:2,pointRadius:2,yAxisID:'y1'}]},
  options:{responsive:true,interaction:{intersect:false,mode:'index'},scales:{y1:{type:'linear',position:'right',grid:{drawOnChartArea:false}}}}});
 if(el('c_kanal')&&C.kanal) new Chart(el('c_kanal'),{type:'doughnut',data:{labels:C.kanal.labels,datasets:[{data:C.kanal.values,backgroundColor:[T,'#059669','#F59E0B','#3B82F6','#8B5CF6','#EC4899']}]},
  options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}}}}});
 if(el('c_ads')&&C.ads) new Chart(el('c_ads'),{type:'bar',data:{labels:C.ads.labels,datasets:[
  {label:'Omzet',data:C.ads.omzet,backgroundColor:T},{label:'Biaya',data:C.ads.biaya,backgroundColor:O}]},options:{scales:{y:{ticks:{callback:function(v){return 'Rp'+(v/1e6).toFixed(1)+'jt';}}}}}});
 function quad(id,Q){
  var c=el(id); if(!c||!Q||!Q.sets||!Q.sets.length) return;
  var lines=[];
  if(Q.klikTinggi) lines.push({type:'line',data:[{x:Q.klikTinggi,y:0},{x:Q.klikTinggi,y:100}],borderColor:'rgba(100,116,139,.45)',borderWidth:1,borderDash:[4,4],pointRadius:0,showLine:true,fill:false,label:'ambang traffic'});
  if(Q.cvrTinggi) lines.push({type:'line',data:[{x:1,y:Q.cvrTinggi},{x:1e7,y:Q.cvrTinggi}],borderColor:'rgba(100,116,139,.45)',borderWidth:1,borderDash:[4,4],pointRadius:0,showLine:true,fill:false,label:'ambang CR'});
  var maxY=0; Q.sets.forEach(function(s){s.data.forEach(function(d){if(d.y>maxY)maxY=d.y;});});
  new Chart(c,{type:'bubble',data:{datasets:Q.sets.map(function(s){return {label:s.label,data:s.data,backgroundColor:s.warna+'B3',borderColor:s.warna};}).concat(lines)},
   options:{plugins:{legend:{position:'bottom',labels:{boxWidth:8,font:{size:10},filter:function(i){return i.text.indexOf('ambang')!==0;}}},
     tooltip:{callbacks:{label:function(ctx){var d=ctx.raw||{};return (d.nama||'')+' — '+(d.x||0)+' pengunjung, CR '+(d.y||0).toFixed(2)+'%';}}}},
    scales:{x:{type:'logarithmic',title:{display:true,text:'Pengunjung produk'}},y:{title:{display:true,text:'CR (%)'},min:0,suggestedMax:Math.max(1,maxY*1.15)}}}});
 }
 quad('c_quad_rel',C.quadRel); quad('c_quad_bench',C.quadBench);
 if(el('c_video_sumber')&&C.video&&C.video.labels.length) new Chart(el('c_video_sumber'),{type:'doughnut',data:{labels:C.video.labels,datasets:[{data:C.video.ditonton,backgroundColor:['#0F766E','#EA580C','#F59E0B','#3B82F6','#8B5CF6','#EC4899','#64748B','#94A3B8']}]},options:{plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:10}}}}}});
})();`;

const PDF_BOOT = `
(function(){
 var b=document.getElementById('btnPdf'); if(!b) return;
 if(typeof html2pdf==='undefined'){b.style.display='none';return;}
 b.addEventListener('click',function(){
  var el=document.getElementById('reportBody'); if(!el) return;
  var old=b.innerHTML; b.disabled=true;
  b.innerHTML='<i class="fa-solid fa-spinner fa-spin mr-1"></i> Membuat PDF...';
  html2pdf().set({margin:[8,8,8,8],filename:(window.REPORT_PDF_NAME||'laporan')+'.pdf',
   image:{type:'jpeg',quality:0.95},html2canvas:{scale:2,useCORS:true,logging:false},
   jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},
   pagebreak:{mode:['avoid-all','css','legacy']}})
   .from(el).save()
   .then(function(){b.innerHTML=old;b.disabled=false;})
   .catch(function(){b.innerHTML=old;b.disabled=false;});
 });
})();`;

function pdfName(p: ShopeeReportPayload, mode: RenderMode): string {
  const toko = (p.klien.toko || p.klien.nama || 'klien').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return `Laporan-Shopee-${toko}-${p.periode.label.replace(/\s+/g, '-')}${mode === 'internal' ? '-INTERNAL' : ''}`;
}

const STYLE = `body{font-family:'Inter',system-ui,sans-serif;background:#f8fafc;color:#0f172a}
.font-display{font-family:'Poppins',system-ui,sans-serif}
.kpi-value{font-size:1.6rem;line-height:1.15;font-weight:700}
.insight-card{border-left:4px solid #0F766E}
.badge-int{background:#EEF2FF;color:#4338CA;font-size:.65rem;padding:1px 6px;border-radius:99px;font-weight:700}
.status-green{background:#D1FAE5;color:#065F46}.status-yellow{background:#FEF3C7;color:#92400E}
.status-red{background:#FEE2E2;color:#991B1B}.status-gray{background:#F1F5F9;color:#475569}
table{border-collapse:collapse}
.sec-ico{display:inline-flex;align-items:center;justify-content:center;width:1.6em;height:1.6em;flex:0 0 1.6em;border-radius:.5em;background:#CCFBF1;color:#0F766E;font-size:.62em}
.gauge{position:relative;width:104px;height:104px;flex:0 0 104px;border-radius:50%}
.gauge::after{content:'';position:absolute;inset:9px;border-radius:50%;background:#fff}
.gauge-val{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:1;line-height:1}
.gauge-num{font-size:1.55rem;font-weight:800;letter-spacing:-.02em}
.gauge-max{font-size:.62rem;color:#64748B;margin-top:1px}
@media print{.no-print{display:none!important}}`;

/** The report body (no `<html>` wrapper) — what an embedding page drops in. */
export function renderBody(p: ShopeeReportPayload, mode: RenderMode, insight?: ShopeePayloadInsight): string {
  // One resolution point, exactly like TikTok's renderer: never a per-section choice.
  const I: ShopeePayloadInsight = insight ?? p.insight;
  const seksi: [string, string, string][] = [];
  const add = (judul: string, html: string, ikon = 'fa-circle-dot'): void => { if (html) seksi.push([judul, html, ikon]); };

  add('Ringkasan Eksekutif', seksiRingkasan(p, I), 'fa-chart-line');
  if (p.kpi.harian.length) add('Tren GMV Harian', '<div class="bg-white rounded-xl border border-slate-100 p-5"><canvas id="c_harian" height="100"></canvas></div>', 'fa-arrow-trend-up');
  add('Kontribusi per Channel', seksiKanal(p), 'fa-diagram-project');
  add('Paid Ads Performance', seksiAds(p, mode), 'fa-bullseye');
  add('Matriks Produk 4 Kuadran', seksiProduk(p), 'fa-table-cells-large');
  add('Shopee Video Performance', seksiVideo(p), 'fa-film');
  add('Affiliate Performance', seksiAfiliasi(p), 'fa-users');
  add('Voucher & Promo', seksiVoucher(p), 'fa-ticket');
  add('Layanan & Kesehatan Toko', seksiLayanan(p), 'fa-shield-heart');
  add('Key Insights & Findings', `<div class="bg-white rounded-xl border border-slate-100 p-5 md:p-6"><ol class="space-y-3">${I.poin.map((t, i) => `<li class="flex gap-3"><span class="flex-shrink-0 w-6 h-6 bg-teal-100 text-teal-700 rounded-full flex items-center justify-center text-xs font-bold">${i + 1}</span><span class="text-sm">${esc(t)}</span></li>`).join('')}</ol></div>`, 'fa-lightbulb');
  add('Rekomendasi & Action Plan', `<div class="mb-4"><h3 class="text-sm font-bold text-red-700 mb-2">Prioritas Tinggi</h3>
    <div class="grid md:grid-cols-2 gap-3">${I.rekomendasi_tinggi.map((r) => rekCard(r, 'tinggi')).join('') || '<div class="text-sm text-slate-500">Tidak ada rekomendasi prioritas tinggi.</div>'}</div></div>
    <div><h3 class="text-sm font-bold text-amber-700 mb-2">Prioritas Sedang</h3>
    <div class="grid md:grid-cols-2 gap-3">${I.rekomendasi_sedang.map((r) => rekCard(r, 'sedang')).join('') || '<div class="text-sm text-slate-500">—</div>'}</div></div>`, 'fa-list-check');
  add('Next Month Outlook', `<div class="bg-teal-50 border border-teal-100 rounded-xl p-5 md:p-6"><p class="text-slate-700 mb-4 text-sm">${esc(I.outlook)}</p>${grid(I.indikator.map((m) => kpi(m.nama, m.target)))}</div>`, 'fa-flag-checkered');

  const body = seksi.map(([judul, html, ikon], i) =>
    `<section class="mb-8"><h2 class="font-display text-xl md:text-2xl font-bold text-slate-900 mb-4 flex items-center gap-3">
      <span class="sec-ico"><i class="fa-solid ${esc(ikon)}"></i></span>${i + 1}. ${esc(judul)}</h2>${html}</section>`).join('');

  const head = `<div class="flex items-end justify-between mb-6 flex-wrap gap-4">
    <div><div class="flex items-center gap-3 flex-wrap"><h1 class="font-display text-2xl md:text-4xl font-bold tracking-tight text-slate-900">Monthly Report</h1>
      <div class="px-3 py-1 bg-slate-900 text-white text-xs font-bold rounded-full">${esc(p.periode.label)}</div>
      ${mode === 'internal' ? '<div class="px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full">VERSI INTERNAL</div>' : ''}</div>
    <p class="text-base md:text-lg text-slate-600 mt-1">${esc(p.klien.toko || p.klien.nama || '')} • ${esc(p.klien.platform)} — Performance &amp; Strategic Analysis</p></div></div>`;

  const kaki = `<div class="text-center text-xs text-slate-500 mt-8 pt-6 border-t border-slate-200">
    <p>Dibuat oleh <span class="font-semibold">MEA CDPS Report Engine</span> • ${esc(p.periode.label)}</p>
    <p class="mt-1">${esc(p.klien.toko || p.klien.nama || '')} • ${esc(p.klien.platform)}</p></div>`;

  return head + seksiSkor(p, mode) + body + kaki;
}

/** A complete, self-contained HTML document — what the AM downloads or forwards. */
export function renderReportHtml(p: ShopeeReportPayload, mode: RenderMode, insight?: ShopeePayloadInsight): string {
  const judul = `Monthly Report — ${p.klien.toko || p.klien.nama || ''} ${p.periode.label}`;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(judul)}${mode === 'internal' ? ' — Internal' : ''}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Poppins:wght@600;700&display=swap">
<style>${STYLE}</style></head>
<body data-mode="${mode}"><div class="max-w-screen-xl mx-auto px-4 md:px-6 py-8">
<div class="no-print flex justify-end mb-2">
  <button id="btnPdf" type="button" class="text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-100 rounded-full px-3 py-1.5">
    <i class="fa-solid fa-file-pdf mr-1"></i> Unduh PDF
  </button>
</div>
<div id="reportBody">${renderBody(p, mode, insight)}</div></div>
<script>window.CHART_DATA=${jsonForScript(chartData(p))};</script>
<script>window.REPORT_PDF_NAME=${jsonForScript(pdfName(p, mode))};</script>
<script>${CHART_BOOT}</script>
<script>${PDF_BOOT}</script></body></html>`;
}
