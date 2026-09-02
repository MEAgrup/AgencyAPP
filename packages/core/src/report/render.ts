/**
 * Report engine — payload → standalone HTML.
 *
 * Pure string building (no DOM), so it lives in core next to the numbers it
 * renders and is unit-testable. Two modes:
 *
 *  - `klien`    — what the client receives.
 *  - `internal` — the same page plus the audit blocks MEA keeps to itself
 *                 (budget burn, dead broadcast hours, creators to drop, the
 *                 per-dimension score notes).
 *
 * ⚠️ The internal blocks are OMITTED from the client HTML, not hidden with CSS.
 * The owner's tool hid them with `display:none`, which left every internal
 * remark sitting in the source of a file the client can forward and read with
 * View Source. Here the string is simply never built.
 *
 * Section numbers are assigned at render time. A client with no Tokopedia store
 * and no Ads Manager files must not receive a report that jumps from 8 to 10.
 */
import { dec, esc, num, pct, rp } from '../baseline/angka';
import type { PayloadInsight, ReportPayload } from './payload';

export type RenderMode = 'klien' | 'internal';

const DASH = '—';

/** Compact rupiah for KPI tiles — `Rp1,2jt`. Null stays `—` (house rule #7). */
export function rpPendek(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e9) return 'Rp' + (v / 1e9).toFixed(2).replace('.', ',') + 'M';
  if (a >= 1e6) return 'Rp' + (v / 1e6).toFixed(1).replace('.', ',') + 'jt';
  if (a >= 1e3) return 'Rp' + Math.round(v / 1e3).toLocaleString('id-ID') + 'rb';
  return 'Rp' + Math.round(v).toLocaleString('id-ID');
}

const badge = (v: number | null | undefined): string => {
  if (v == null) return '';
  const naik = v >= 0;
  return `<span class="${naik ? 'text-emerald-600' : 'text-red-600'} text-xs font-semibold">${naik ? '▲' : '▼'} ${dec(Math.abs(v) * 100, 1)}%</span>`;
};

function kpi(judul: string, nilai: string, sub = '', delta?: number | null): string {
  return `<div class="kpi-card bg-white rounded-xl border border-slate-100 p-4">
  <div class="text-[0.7rem] font-semibold text-slate-500 uppercase tracking-wide">${esc(judul)}</div>
  <div class="kpi-value text-teal-700 mt-1">${esc(nilai)}</div>
  <div class="text-xs text-slate-500 mt-1">${esc(sub)} ${delta === undefined ? '' : badge(delta)}</div></div>`;
}

const grid = (cards: string[], cols = 4): string =>
  `<div class="grid grid-cols-2 md:grid-cols-${cols} gap-3">${cards.join('')}</div>`;

const kosong = (teks: string): string =>
  `<div class="bg-white rounded-xl border border-slate-100 p-6 text-sm text-slate-500">${esc(teks)}</div>`;

function tabel(head: string[], baris: string[], align: ('l' | 'r')[] = []): string {
  const th = head.map((h, i) => `<th class="pb-2 ${align[i] === 'r' ? 'text-right' : 'text-left'}">${esc(h)}</th>`).join('');
  return `<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="border-b">${th}</tr></thead><tbody>${baris.join('') || `<tr><td colspan="${head.length}" class="py-3 text-slate-400">Tidak ada data pada periode ini.</td></tr>`}</tbody></table></div>`;
}

const td = (v: string, r = false): string => `<td class="py-2 ${r ? 'text-right' : ''}">${v}</td>`;

const kartuInternal = (judul: string, isi: string, warna = 'slate'): string =>
  `<div class="bg-${warna}-50 border border-${warna}-200 rounded-xl p-4 text-sm">
  <div class="font-semibold text-${warna}-800 mb-1">${esc(judul)} <span class="badge-int">INTERNAL</span></div>
  <p class="text-${warna}-700 text-xs">${isi}</p></div>`;

function rekCard(r: { judul: string; target: string; dampak: string; timeline: string }, tone: 'tinggi' | 'sedang'): string {
  return `<div class="bg-white rounded-xl border-l-4 ${tone === 'tinggi' ? 'border-red-500' : 'border-amber-500'} shadow-sm p-4">
  <h4 class="font-semibold text-slate-900 text-sm">${esc(r.judul)}</h4>
  <p class="text-xs text-slate-500 mt-1"><span class="font-semibold">Target:</span> ${esc(r.target)}</p>
  <p class="text-xs text-slate-500"><span class="font-semibold">Dampak:</span> ${esc(r.dampak)}</p>
  <p class="text-xs text-slate-500"><span class="font-semibold">Timeline:</span> ${esc(r.timeline)}</p></div>`;
}

const KUADRAN_META: Record<string, [string, string, string]> = {
  bintang: ['Produk Bintang', '#059669', 'Traffic tinggi + closing tinggi — jaga stok, naikkan budget'],
  hidden_gem: ['Hidden Gem', '#3B82F6', 'Closing bagus tapi traffic kecil — dorong exposure (iklan/LIVE/kreator)'],
  bocor_traffic: ['Bocor Traffic', '#EA580C', 'Ramai diklik tapi gagal closing — benahi harga/foto/deskripsi/ulasan'],
  evaluasi: ['Evaluasi', '#DC2626', 'Sepi & tidak closing — turunkan prioritas'],
  tidur: ['Produk Tidur', '#94A3B8', 'Klik terlalu sedikit — belum diuji dengan adil'],
  tidak_tayang: ['Tidak Tayang', '#CBD5E1', 'Nol klik di periode ini'],
};

// ---------------------------------------------------------------------------
// Chart data (consumed by the inline Chart.js bootstrap)
// ---------------------------------------------------------------------------
export function chartData(p: ReportPayload): Record<string, unknown> {
  const h = p.kpi.harian;
  return {
    harian: { labels: h.map((d) => d.tanggal.slice(0, 5)), gmv: h.map((d) => d.gmv ?? 0), pesanan: h.map((d) => d.pesanan ?? 0) },
    kanal: { labels: p.kanal.items.map((x) => x.label), values: p.kanal.items.map((x) => x.nilai ?? 0) },
    iklan: p.iklan ? { labels: ['GMV Max LIVE', 'GMV Max Product'], pendapatan: [p.iklan.live.pendapatan ?? 0, p.iklan.product.pendapatan ?? 0], biaya: [p.iklan.live.biaya ?? 0, p.iklan.product.biaya ?? 0] } : null,
    liveHari: p.live ? { labels: p.live.per_hari.map((d) => d.label), gmv: p.live.per_hari.map((d) => d.gmv ?? 0), gmvPerJam: p.live.per_hari.map((d) => d.gmv_per_jam ?? 0) } : null,
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function seksiRingkasan(p: ReportPayload, mode: RenderMode, I: PayloadInsight): string {
  const k = p.kpi;
  const cards = [
    kpi('GMV TikTok Shop', rpPendek(k.gmv), `${num(k.pesanan)} pesanan`, k.perubahan.gmv),
    kpi('AOV', rpPendek(k.aov), 'per pesanan'),
    kpi('Pembeli', num(k.pembeli), `${num(k.produk_terjual)} produk terjual`),
    kpi('Pengunjung', num(k.pengunjung), 'ke halaman produk', k.perubahan.pengunjung),
    kpi('CVR Toko', pct(k.cvr, 2), 'pesanan / pengunjung'),
    kpi('Klik Produk', num(k.klik), `dari ${num(k.impresi)} impresi`),
    p.iklan ? kpi('ROI GMV Max', p.iklan.total.roi == null ? DASH : dec(p.iklan.total.roi, 2) + 'x', `belanja ${rpPendek(p.iklan.total.biaya)}`) : '',
    p.live ? kpi('GMV per Jam LIVE', rpPendek(p.live.gmv_per_jam), `${p.live.sesi} sesi`) : '',
  ].filter(Boolean);
  const catatan = p.periode.rentang_dari_berkas
    ? ''
    : '<p class="text-xs text-amber-600 mt-2">Rentang tanggal tidak terbaca dari berkas export — panjang periode memakai nilai baku, sehingga ambang volume (sesi LIVE, klik produk) memakai asumsi.</p>';
  return `${grid(cards)}
  <div class="mt-4 p-4 bg-white rounded-xl border border-slate-100 insight-card"><p class="text-sm font-medium text-slate-700">${esc(I.ringkasan)}</p></div>
  <p class="text-xs text-slate-400 mt-2">Perbandingan periode diambil langsung dari baris "Perubahan persentase" pada berkas Analitik Toko TikTok.</p>${catatan}${mode === 'internal' ? `
  <p class="text-xs text-slate-400 mt-1"><span class="badge-int">INTERNAL</span> Mesin ${esc(p.engine_versi)} • benchmark versi ${p.benchmark_versi ?? DASH} • GMV ${esc(p.periode.definisi_gmv)} • ${p.periode.hari} hari.</p>` : ''}`;
}

function seksiSkor(p: ReportPayload, mode: RenderMode): string {
  const warna = (s: number): string => (s >= 8 ? 'emerald' : s >= 6 ? 'amber' : 'red');
  const dims = p.skor.dimensi.map((d) => `<div class="bg-${warna(d.skor)}-50 border border-${warna(d.skor)}-100 rounded-lg p-3">
    <div class="text-[0.7rem] font-semibold text-slate-500 uppercase tracking-wide">${esc(d.label)}</div>
    <div class="text-2xl font-bold text-${warna(d.skor)}-700 mt-1">${dec(d.skor, 1)}</div>
    <div class="text-[0.7rem] text-slate-500">${Math.round(d.bobot * 100)}% • kontrib ${dec(d.skor * d.bobot, 2)}</div>
    ${mode === 'internal' ? `<div class="text-[0.7rem] text-slate-600 mt-1">${esc(d.catatan)}</div>` : ''}</div>`).join('');
  return `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 md:p-6 mb-8">
  <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
    <div><h2 class="font-display text-lg md:text-xl font-bold text-slate-900">Skor Performa Keseluruhan</h2>
      <p class="text-sm text-slate-500">Bobot standar MEA untuk TikTok Shop</p></div>
    <div class="text-right"><div class="text-4xl md:text-5xl font-bold text-teal-700">${dec(p.skor.total, 1)} <span class="text-2xl text-slate-400">/10</span></div>
      <div class="text-sm font-semibold text-${warna(p.skor.total)}-700">${esc(p.skor.label)}</div></div></div>
  <div class="grid grid-cols-2 md:grid-cols-6 gap-3">${dims}</div></div>`;
}

function seksiKanal(p: ReportPayload, mode: RenderMode): string {
  const rows = [...p.kanal.items].sort((a, b) => (b.nilai ?? -1) - (a.nilai ?? -1)).map((c) =>
    `<tr class="border-b last:border-0">${td(esc(c.label))}${td(`<b>${rp(c.nilai)}</b>`, true)}${td(pct(c.persen, 1), true)}</tr>`);
  const d = p.kanal.detail;
  return `<div class="grid md:grid-cols-2 gap-4">
  <div class="bg-white rounded-xl border border-slate-100 p-5"><canvas id="c_kanal" height="220"></canvas></div>
  <div class="bg-white rounded-xl border border-slate-100 p-5">
    ${tabel(['Sumber GMV', 'GMV', 'Kontribusi'], rows, ['l', 'r', 'r'])}
    ${mode === 'internal' ? `<div class="mt-3 text-xs text-slate-500 space-y-1">
      <div><span class="badge-int">INTERNAL</span> LIVE toko ${rp(d.live_toko)} • LIVE kreator ${rp(d.live_kreator)}</div>
      <div>Video toko ${rp(d.video_toko)} • video kreator ${rp(d.video_kreator)}</div></div>` : ''}
  </div></div>`;
}

function seksiIklan(p: ReportPayload, mode: RenderMode): string {
  const a = p.iklan;
  if (!a) return kosong('Berkas iklan tidak diunggah.');
  const camp = a.kampanye.map((c) => `<tr class="border-b last:border-0">${td(esc(c.kampanye))}${td(`<b>${rp(c.pendapatan)}</b>`, true)}${td(rp(c.biaya), true)}${td(`<b class="text-teal-700">${c.roi == null ? DASH : dec(c.roi, 2) + 'x'}</b>`, true)}${td(num(c.pesanan), true)}${td(pct(c.ctr, 2), true)}</tr>`);
  const jenis = a.jenis_materi.map((j) => `<tr class="border-b last:border-0">${td(esc(j.jenis))}${td(num(j.materi), true)}${td(rp(j.pendapatan), true)}${td(rp(j.biaya), true)}${td(j.roi == null ? DASH : dec(j.roi, 2) + 'x', true)}</tr>`);
  if (a.live.sesi) {
    jenis.push(`<tr class="border-b last:border-0">${td('GMV Max LIVE <span class="text-[0.6rem] text-slate-400">(sesi)</span>')}${td(num(a.live.sesi), true)}${td(rp(a.live.pendapatan), true)}${td(rp(a.live.biaya), true)}${td(a.live.roi == null ? DASH : dec(a.live.roi, 2) + 'x', true)}</tr>`);
  }
  jenis.push(`<tr class="bg-slate-50 font-bold">${td('TOTAL')}${td(DASH, true)}${td(rp(a.total.pendapatan), true)}${td(rp(a.total.biaya), true)}${td(`<span class="text-teal-700">${a.total.roi == null ? DASH : dec(a.total.roi, 2) + 'x'}</span>`, true)}</tr>`);
  const live = a.top_live.slice(0, 8).map((l) => `<tr class="border-b last:border-0">${td(esc(l.waktu.slice(0, 16)))}${td(`<b>${rp(l.pendapatan)}</b>`, true)}${td(rp(l.biaya), true)}${td(l.roi == null ? DASH : dec(l.roi, 1) + 'x', true)}${td(num(l.tayangan), true)}</tr>`);

  const internal = mode !== 'internal' ? '' : `<div class="mt-4 grid md:grid-cols-2 gap-3">
    ${kartuInternal('Budget Terbakar', `${num(a.budget_terbakar.materi)} materi product ads menghabiskan <b>${rp(a.budget_terbakar.belanja)}</b> (${pct(a.budget_terbakar.persen_belanja, 0)} dari belanja product ads) tanpa satu pun pesanan.${a.live_tanpa_penjualan.sesi ? ` ${a.live_tanpa_penjualan.sesi} sesi GMV Max LIVE berbiaya ${rp(a.live_tanpa_penjualan.belanja)} juga nol penjualan.` : ''}`, 'red')}
    ${kartuInternal('Retensi Tayangan LIVE', `Hanya ${pct(a.live.hold_10s, 1)} tayangan iklan LIVE bertahan sampai 10 detik (${num(a.live.tayangan_10s)} dari ${num(a.live.tayangan)}). Indikator kekuatan hook 3 detik pertama host.`)}
  </div>`;

  return `${grid([
    kpi('Total Belanja', rpPendek(a.total.biaya), `${num(a.total.pesanan)} pesanan`),
    kpi('Total Pendapatan', rpPendek(a.total.pendapatan), `ROI ${a.total.roi == null ? DASH : dec(a.total.roi, 2) + 'x'}`),
    kpi('CPA', rpPendek(a.total.cpa), `${pct(a.total.cpa_ratio, 1)} dari AOV`),
    kpi('CTR Product Ads', pct(a.product.ctr, 2), `${num(a.product.klik)} klik`),
  ])}
  <div class="grid md:grid-cols-2 gap-4 mt-4">
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Pendapatan vs Biaya per Tipe</h3><canvas id="c_iklan" height="200"></canvas></div>
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Per Kampanye (Product Ads)</h3>${tabel(['Kampanye', 'Pendapatan', 'Biaya', 'ROI', 'Pesanan', 'CTR'], camp, ['l', 'r', 'r', 'r', 'r', 'r'])}</div></div>
  <div class="grid md:grid-cols-2 gap-4 mt-4">
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-1">Per Jenis Materi Iklan</h3>
      <p class="text-[0.7rem] text-slate-400 mb-2">Termasuk GMV Max LIVE, total cocok dengan ringkasan di atas.</p>
      ${tabel(['Jenis', 'Materi', 'Pendapatan', 'Biaya', 'ROI'], jenis, ['l', 'r', 'r', 'r', 'r'])}</div>
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Top Sesi GMV Max LIVE</h3>${tabel(['Waktu', 'Pendapatan', 'Biaya', 'ROI', 'Tayangan'], live, ['l', 'r', 'r', 'r', 'r'])}</div></div>${internal}`;
}

function seksiLive(p: ReportPayload, mode: RenderMode): string {
  const L = p.live;
  if (!L) return kosong('Berkas LIVE tidak diunggah.');
  const top = L.top_sesi.map((s, i) => `<tr class="border-b last:border-0">${td(String(i + 1))}${td(esc(s.waktu.slice(0, 16)))}${td(`<b>${rp(s.gmv)}</b>`, true)}${td(dec(s.jam, 1) + 'j', true)}${td(rp(s.gmv_per_jam), true)}${td(num(s.penonton), true)}</tr>`);
  const internal = mode !== 'internal' || !L.tanpa_penjualan.sesi ? '' :
    `<div class="mt-4">${kartuInternal('Jam Siaran Tanpa Hasil', `<b>${L.tanpa_penjualan.sesi} dari ${L.sesi} sesi</b> (${pct(L.tanpa_penjualan.persen, 0)}) nol penjualan, setara <b>${dec(L.tanpa_penjualan.jam, 0)} jam</b> siaran. Ini biaya host & operasional yang belum menghasilkan.`, 'amber')}</div>`;
  return `${grid([
    kpi('GMV LIVE', rpPendek(L.gmv), `${num(L.sesi)} sesi / ${dec(L.jam, 1)} jam`),
    kpi('GMV per Jam', rpPendek(L.gmv_per_jam), `rata-rata ${dec(L.durasi_rata, 1)} jam/sesi`),
    kpi('Penonton', num(L.penonton), `${num(L.klik_produk)} klik produk (CTR ${pct(L.ctr, 1)})`),
    kpi('Follower Baru', num(L.follower_baru), `${num(L.suka)} suka • ${num(L.komentar)} komentar`),
  ])}
  <div class="grid md:grid-cols-2 gap-4 mt-4">
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Performa per Hari</h3><canvas id="c_livehari" height="220"></canvas></div>
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Top 10 Sesi</h3>${tabel(['#', 'Waktu', 'GMV', 'Durasi', 'GMV/jam', 'Penonton'], top, ['l', 'l', 'r', 'r', 'r', 'r'])}</div></div>${internal}`;
}

function seksiVideo(p: ReportPayload, mode: RenderMode): string {
  const V = p.video;
  if (!V) return kosong('Berkas video tidak diunggah.');
  const rows = V.top_penjualan.map((v, i) => `<tr class="border-b last:border-0 align-top">${td(String(i + 1))}
    <td class="py-2"><div class="text-xs text-slate-700">${esc(v.judul.slice(0, 90))}${v.judul.length > 90 ? '…' : ''}</div>
      <div class="text-[0.65rem] text-slate-400 mt-0.5">${esc(v.kreator || '-')} • ${esc(v.waktu.slice(0, 10))}${v.afiliasi ? ' • <span class="text-indigo-500">afiliasi</span>' : ''}</div></td>
    ${td(`<b>${rp(v.gmv)}</b>`, true)}${td(rp(v.gpm), true)}${td(num(v.vv), true)}${td(pct(v.ctor, 1), true)}</tr>`);
  const internal = mode !== 'internal' ? '' :
    `<p class="text-xs text-slate-500 mt-3"><span class="badge-int">INTERNAL</span> Rata-rata GPM per video ${rp(V.gpm_per_video)} — angka ini yang tampil di tile "Avg GPM" TikTok, ditarik turun oleh mayoritas video nol penjualan. Angka agregat ${rp(V.gpm)} lebih mencerminkan performa nyata.</p>`;
  return `${grid([
    kpi('GMV Video', rpPendek(V.gmv), `toko ${rpPendek(V.gmv_toko)} • afiliasi ${rpPendek(V.gmv_afiliasi)}`),
    kpi('Video Ada Penjualan', `${num(V.ada_penjualan)} / ${num(V.total)}`, pct(V.sales_rate, 1)),
    kpi('GMV / 1.000 Views', rpPendek(V.gpm), `total ${num(V.vv)} views`),
    kpi('Views per Video', num(V.vv_per_video), `${num(V.klik_ke_live)} klik ke LIVE`),
  ])}
  <div class="bg-white rounded-xl border border-slate-100 p-5 mt-4">
    <h3 class="font-semibold text-slate-700 mb-1">Video yang Menghasilkan Penjualan</h3>
    <p class="text-xs text-slate-500 mb-3">Diurutkan berdasarkan GMV. GPM = GMV per 1.000 views video tersebut — ukuran seberapa efisien konten mengubah view jadi rupiah.</p>
    ${tabel(['#', 'Video', 'GMV', 'GPM', 'Views', 'CTOR'], rows, ['l', 'l', 'r', 'r', 'r', 'r'])}${internal}</div>`;
}

function seksiProduk(p: ReportPayload): string {
  const Q = p.produk;
  if (!Q) return kosong('Berkas Analitik Produk tidak diunggah.');
  const dist = (b: Record<string, { jumlah: number; gmv: number | null }>): string => {
    const tot = Object.values(b).reduce((a, v) => a + v.jumlah, 0) || 1;
    return Object.entries(KUADRAN_META).map(([q, [label, warna]]) => {
      const n = b[q]?.jumlah ?? 0;
      if (!n && (q === 'tidur' || q === 'tidak_tayang')) return '';
      return `<div><div class="flex justify-between text-xs mb-0.5"><span>${esc(label)}</span><span class="font-semibold">${n}</span></div>
        <div class="w-full bg-slate-100 rounded-full h-1.5"><div style="width:${((n / tot) * 100).toFixed(0)}%;background:${warna}" class="h-1.5 rounded-full"></div></div></div>`;
    }).join('');
  };
  const panel = (judul: string, sub: string, b: Record<string, { jumlah: number; gmv: number | null }>, amb: { klik_tinggi: number | null; cvr_tinggi: number | null }): string =>
    `<div class="bg-white rounded-xl border border-slate-100 p-5">
      <div class="flex items-center justify-between mb-2"><h3 class="font-semibold text-slate-700">${esc(judul)}</h3>
        <span class="text-xs px-2 py-1 bg-teal-50 text-teal-700 rounded-full">${esc(sub)}</span></div>
      <p class="text-xs text-slate-500 mb-3">Ambang: klik ≥${num(amb.klik_tinggi)} = traffic tinggi • CVR ≥${pct(amb.cvr_tinggi, 2)} = closing tinggi.</p>
      <div class="space-y-1.5">${dist(b)}</div></div>`;
  const legenda = Object.entries(KUADRAN_META).filter(([q]) => q !== 'tidur' && q !== 'tidak_tayang')
    .map(([, [label, warna, ket]]) => `<div class="mt-1"><span style="color:${warna}">●</span> <b>${esc(label)}</b> — ${esc(ket)}</div>`).join('');
  const top = (Q.benchmark.bintang.produk as { nama: string; gmv: number | null; klik: number | null; cvr: number | null }[])
    .concat(Q.benchmark.bocor_traffic.produk as never[], Q.benchmark.hidden_gem.produk as never[])
    .sort((a, b) => (b.gmv ?? 0) - (a.gmv ?? 0)).slice(0, 12)
    .map((x, i) => `<tr class="border-b last:border-0">${td(String(i + 1))}${td(esc(x.nama.slice(0, 55)))}${td(num(x.klik), true)}${td(pct(x.cvr, 2), true)}${td(`<b>${rp(x.gmv)}</b>`, true)}</tr>`);
  return `<div class="grid md:grid-cols-2 gap-4">
    ${panel('Mode Relatif', 'antar produk toko ini', Q.relatif as never, Q.ambang.relatif)}
    ${panel('Mode Benchmark', 'vs target MEA', Q.benchmark as never, Q.ambang.benchmark)}</div>
  <div class="mt-3 p-3 bg-slate-50 rounded-lg text-xs text-slate-600"><b>Cara baca:</b> traffic = klik produk, closing = CVR/CTOR.${legenda}</div>
  <div class="mt-4 bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-slate-700 mb-3">Top Produk by GMV</h3>
    ${tabel(['#', 'Produk', 'Klik', 'CVR', 'GMV'], top, ['l', 'l', 'r', 'r', 'r'])}</div>`;
}

function seksiAfiliasi(p: ReportPayload, mode: RenderMode): string {
  const A = p.afiliasi;
  if (!A) return kosong('Berkas afiliasi tidak diunggah.');
  const top = A.top_kreator.slice(0, 12).map((c, i) => `<tr class="border-b last:border-0">${td(String(i + 1))}${td(esc(c.nama))}${td(`<b>${rp(c.gmv)}</b>`, true)}${td(num(c.konten), true)}${td(num(c.pesanan), true)}</tr>`);
  const nempel = A.posting_tanpa_hasil_list.map((c) => `<tr class="border-b last:border-0">${td(esc(c.nama))}${td(num(c.konten), true)}${td(num(c.tayangan), true)}${td('<span class="text-red-600 font-semibold">Rp. 0,00</span>', true)}</tr>`);
  const refundWarn = A.refund_rate != null && A.refund_rate > 0.2
    ? `<div class="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm"><div class="font-semibold text-red-800 mb-1">Refund Affiliate Tinggi</div>
       <p class="text-red-700 text-xs">${pct(A.refund_rate, 0)} dari GMV affiliate (<b>${rp(A.refund)}</b>) berakhir refund. GMV bersih hanya <b>${rp(A.gmv_bersih)}</b>. Cek kualitas closing kreator dan kesesuaian ekspektasi produk.</p></div>` : '';
  const internalPanel = mode !== 'internal' ? '' : `<div class="bg-white rounded-xl border border-slate-100 p-5">
      <h3 class="font-semibold text-sm text-slate-600 mb-1">Posting Tanpa Hasil <span class="badge-int">INTERNAL</span></h3>
      <p class="text-xs text-slate-500 mb-3">Kreator yang aktif posting tapi nol penjualan — kandidat coaching atau dilepas.</p>
      ${tabel(['Kreator', 'Konten', 'Views', 'GMV'], nempel, ['l', 'r', 'r', 'r'])}</div>`;
  const dikecualikan = mode === 'internal' && A.akun_sendiri_dikecualikan.length
    ? `<p class="text-xs text-slate-400 mt-3"><span class="badge-int">INTERNAL</span> Akun toko sendiri (${A.akun_sendiri_dikecualikan.map(esc).join(', ')}) dikeluarkan dari hitungan kreator agar rasio produktivitas tidak bias.</p>` : '';
  return `${grid([
    kpi('GMV Affiliate', rpPendek(A.gmv), `${pct(p.kpi.gmv_kotor ? (A.gmv ?? 0) / p.kpi.gmv_kotor : null, 1)} dari GMV toko`),
    kpi('Kreator Produktif', `${num(A.kreator_produktif)} / ${num(A.kreator_total)}`, pct(A.persen_produktif, 1)),
    kpi('Kreator Posting', num(A.kreator_posting), `${num(A.pasif)} terdaftar tapi tidak posting`),
    kpi('GMV Bersih Affiliate', rpPendek(A.gmv_bersih), A.refund ? `setelah refund ${rpPendek(A.refund)}` : 'tidak ada refund'),
  ])}
  <div class="mt-4">${refundWarn}</div>
  <div class="grid md:grid-cols-2 gap-4">
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Top Kreator by GMV</h3>${tabel(['#', 'Kreator', 'GMV', 'Konten', 'Pesanan'], top, ['l', 'l', 'r', 'r', 'r'])}</div>
    ${internalPanel}</div>
  <div class="grid md:grid-cols-2 gap-4 mt-4">
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-2">Efisiensi Sampel</h3>
      <div class="text-sm text-slate-700">${A.sampel.terkirim ? `${num(A.sampel.terkirim)} sampel dikirim ke ${num(A.sampel.kreator)} kreator menghasilkan <b>${rp(A.sampel.gmv)}</b> — <b>${rp(A.sampel.gmv_per_sampel)}</b> per sampel.` : 'Tidak ada sampel terkirim di periode ini. Program sampel belum dipakai sebagai alat aktivasi kreator.'}</div></div>
    <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-2">LIVE Affiliate vs LIVE Toko</h3>
      <div class="text-sm text-slate-700">Affiliate: <b>${A.live ? num(A.live.sesi) + ' sesi' : DASH}</b>${A.live ? ` / ${dec(A.live.jam, 1)} jam → <b>${rp(A.live.gmv)}</b> (${rp(A.live.gmv_per_jam)}/jam)` : ''}.<br>
        Toko sendiri: <b>${p.live ? num(p.live.sesi) + ' sesi' : DASH}</b> → <b>${p.live ? rp(p.live.gmv_per_jam) + '/jam' : DASH}</b>.</div></div></div>${dikecualikan}`;
}

function seksiAdsManager(p: ReportPayload, mode: RenderMode): string {
  const T = p.ads_manager;
  if (!T) return '';
  const blok: string[] = [];
  if (T.showcase) {
    const S = T.showcase;
    blok.push(`<div class="bg-white rounded-xl border border-slate-100 p-5">
      <h3 class="font-semibold text-slate-700 mb-1">Showcase — Initiate Checkout</h3>
      <p class="text-xs text-slate-500 mb-3">Kampanye ini dioptimasi ke <b>checkout dimulai</b>, bukan pesanan selesai. Nilainya indikasi minat beli, bukan GMV — jangan dijumlahkan dengan GMV toko.</p>
      ${grid([kpi('Belanja', rpPendek(S.belanja), `${num(S.ad_group)} ad group`), kpi('Checkout Dimulai', num(S.checkout), `biaya/checkout ${rpPendek(S.biaya_per_checkout)}`), kpi('Add to Cart', num(S.atc), `biaya/ATC ${rpPendek(S.biaya_per_atc)}`), kpi('CTR', pct(S.ctr, 2), `${num(S.klik)} klik dari ${num(S.impresi)} impresi`)])}
      ${mode === 'internal' ? `<p class="text-xs text-slate-500 mt-2"><span class="badge-int">INTERNAL</span> Nilai checkout ${rp(S.nilai_checkout)} = ${dec(S.nilai_per_belanja, 1)}x belanja. Ini <b>bukan</b> ROAS — banyak checkout tidak selesai jadi pesanan.</p>` : ''}</div>`);
  }
  if (T.videoviews) {
    const V = T.videoviews;
    const src = V.per_sumber.map((b) => `<tr class="border-b last:border-0">${td(esc(b.sumber))}${td(num(b.materi), true)}${td(rp(b.belanja), true)}${td(num(b.views), true)}${td(`<b>${rp(b.biaya_per_1k)}</b>`, true)}</tr>`);
    blok.push(`<div class="bg-white rounded-xl border border-slate-100 p-5">
      <h3 class="font-semibold text-slate-700 mb-1">Video Views (Awareness)</h3>
      <p class="text-xs text-slate-500 mb-3">Kampanye jangkauan — tidak dioptimasi ke penjualan. Ukurannya biaya per 1.000 views.</p>
      ${grid([kpi('Belanja', rpPendek(V.belanja), `${num(V.materi)} materi`), kpi('Video Views', num(V.views), `view rate ${pct(V.view_rate, 1)}`), kpi('Biaya / 1.000 Views', rpPendek(V.biaya_per_1k_views), `CPM ${rpPendek(V.cpm)}`), kpi('Reach', num(V.reach), `${num(V.impresi)} impresi`)])}
      <div class="mt-3">${tabel(['Sumber Konten', 'Materi', 'Belanja', 'Views', 'Biaya/1.000'], src, ['l', 'r', 'r', 'r', 'r'])}</div></div>`);
  }
  if (T.consideration) {
    const C = T.consideration;
    blok.push(`<div class="bg-white rounded-xl border border-slate-100 p-5">
      <h3 class="font-semibold text-slate-700 mb-1">Brand Considerations</h3>
      <p class="text-xs text-slate-500 mb-3">Membangun audiens yang mempertimbangkan brand — bekal retargeting untuk kampanye konversi berikutnya.</p>
      ${grid([kpi('Belanja', rpPendek(C.belanja), `${num(C.ad_group)} ad group`), kpi('Audiens Baru', num(C.audiens), `consideration rate ${pct(C.rate, 2)}`), kpi('Biaya / Audiens', rpPendek(C.biaya_per_audiens), `${num(C.klik)} klik`), kpi('Reach', num(C.reach), `${num(C.impresi)} impresi`)])}</div>`);
  }
  if (T.follows) {
    const F = T.follows;
    blok.push(`<div class="bg-white rounded-xl border border-slate-100 p-5">
      <h3 class="font-semibold text-slate-700 mb-1">Paid Follows</h3>
      ${F.belanja ? '' : '<p class="text-xs text-amber-600 mb-2">Kampanye belum berjalan (belanja Rp. 0,00) — kemungkinan masih review atau baru dibuat.</p>'}
      ${grid([kpi('Belanja', rpPendek(F.belanja), `${num(F.ad_group)} ad group`), kpi('Follower Berbayar', num(F.follower), F.follower ? `biaya/follower ${rpPendek(F.biaya_per_follower)}` : 'belum ada hasil'), kpi('Kunjungan Profil', num(F.kunjungan_profil), ''), kpi('Impresi', num(F.impresi), `${num(F.klik)} klik`)])}</div>`);
  }
  const gmvMax = p.iklan ? p.iklan.total.biaya ?? 0 : 0;
  return `<div class="mb-4 bg-slate-900 text-white rounded-xl p-5">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div><div class="text-xs uppercase tracking-wide text-slate-400 font-semibold">Total Belanja Iklan Periode Ini</div>
        <div class="text-2xl font-bold mt-1">${rp(gmvMax + (T.total_belanja ?? 0))}</div></div>
      <div class="text-sm text-slate-300">GMV Max <b class="text-white">${rp(gmvMax)}</b> + Ads Manager <b class="text-white">${rp(T.total_belanja)}</b></div></div>
    <p class="text-xs text-slate-400 mt-3">${esc(T.catatan)}. Menjumlahkannya akan membuat ROI kampanye penjualan terlihat lebih buruk dari kenyataan.</p></div>
  <div class="grid gap-4">${blok.join('')}</div>`;
}

function seksiTokopedia(p: ReportPayload): string {
  const T = p.tokopedia;
  if (!T) return '';
  const warn = T.perubahan.gmv != null && T.perubahan.gmv < 0 && (T.perubahan.pesanan ?? 0) > 0
    ? `<div class="mt-3 p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-slate-700"><b>Perhatian:</b> transaksi naik ${pct(T.perubahan.pesanan, 0)} tapi GMV turun ${pct(Math.abs(T.perubahan.gmv), 1)} — AOV melemah. Indikasi pergeseran ke produk harga rendah atau diskon/voucher lebih agresif.</div>` : '';
  return `${grid([
    kpi('GMV Tokopedia', rpPendek(T.gmv), `${num(T.pesanan)} pesanan`, T.perubahan.gmv),
    kpi('Produk Terjual', num(T.produk_terjual), `${num(T.pembeli)} pembeli`),
    kpi('Pengunjung', num(T.pengunjung), 'ke halaman produk', T.perubahan.pengunjung),
    kpi('CVR', pct(T.cvr, 2), 'pesanan / pengunjung'),
  ])}${warn}`;
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
 if(el('c_kanal')&&C.kanal) new Chart(el('c_kanal'),{type:'doughnut',data:{labels:C.kanal.labels,datasets:[{data:C.kanal.values,backgroundColor:[T,'#F59E0B','#3B82F6']}]},
  options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}}}}});
 if(el('c_iklan')&&C.iklan) new Chart(el('c_iklan'),{type:'bar',data:{labels:C.iklan.labels,datasets:[
  {label:'Pendapatan',data:C.iklan.pendapatan,backgroundColor:T},{label:'Biaya',data:C.iklan.biaya,backgroundColor:O}]}});
 if(el('c_livehari')&&C.liveHari) new Chart(el('c_livehari'),{data:{labels:C.liveHari.labels,datasets:[
  {type:'bar',label:'GMV',data:C.liveHari.gmv,backgroundColor:T},
  {type:'line',label:'GMV/jam',data:C.liveHari.gmvPerJam,borderColor:O,borderWidth:2,pointRadius:3,yAxisID:'y1'}]},
  options:{scales:{y1:{type:'linear',position:'right',grid:{drawOnChartArea:false}}}}});
})();`;

const STYLE = `body{font-family:'Inter',system-ui,sans-serif;background:#f8fafc;color:#0f172a}
.font-display{font-family:'Poppins',system-ui,sans-serif}
.kpi-value{font-size:1.6rem;line-height:1.15;font-weight:700}
.insight-card{border-left:4px solid #0F766E}
.badge-int{background:#EEF2FF;color:#4338CA;font-size:.65rem;padding:1px 6px;border-radius:99px;font-weight:700}
table{border-collapse:collapse}`;

/** The report body (no `<html>` wrapper) — what an embedding page drops in. */
export function renderBody(p: ReportPayload, mode: RenderMode, insight?: PayloadInsight): string {
  // One resolution point for the whole document: an explicit override (the
  // AM's stored revision) or the engine's own narrative. Never a per-section
  // choice — a page mixing edited and generated prose reads as two authors.
  const I: PayloadInsight = insight ?? p.insight;
  const seksi: [string, string][] = [];
  const add = (judul: string, html: string): void => { if (html) seksi.push([judul, html]); };

  add('Ringkasan Eksekutif', seksiRingkasan(p, mode, I));
  if (p.kpi.harian.length) add('Tren Harian', '<div class="bg-white rounded-xl border border-slate-100 p-5"><canvas id="c_harian" height="100"></canvas></div>');
  add('Sumber GMV', seksiKanal(p, mode));
  add('GMV Max Ads', seksiIklan(p, mode));
  add('TikTok Ads Manager (Brand & Upper Funnel)', seksiAdsManager(p, mode));
  add('LIVE Performance', seksiLive(p, mode));
  add('Video Performance', seksiVideo(p, mode));
  add('Matriks Produk 4 Kuadran', seksiProduk(p));
  add('Affiliate & Kreator', seksiAfiliasi(p, mode));
  add('Tokopedia', seksiTokopedia(p));
  add('Key Insights', `<div class="bg-white rounded-xl border border-slate-100 p-5 md:p-6"><ol class="space-y-3">${I.poin.map((t, i) => `<li class="flex gap-3"><span class="flex-shrink-0 w-6 h-6 bg-teal-100 text-teal-700 rounded-full flex items-center justify-center text-xs font-bold">${i + 1}</span><span class="text-sm">${esc(t)}</span></li>`).join('')}</ol></div>`);
  add('Rekomendasi & Action Plan', `<div class="mb-4"><h3 class="text-sm font-bold text-red-700 mb-2">Prioritas Tinggi</h3>
    <div class="grid md:grid-cols-2 gap-3">${I.rekomendasi_tinggi.map((r) => rekCard(r, 'tinggi')).join('') || '<div class="text-sm text-slate-500">Tidak ada prioritas tinggi.</div>'}</div></div>
    <div><h3 class="text-sm font-bold text-amber-700 mb-2">Prioritas Sedang</h3>
    <div class="grid md:grid-cols-2 gap-3">${I.rekomendasi_sedang.map((r) => rekCard(r, 'sedang')).join('') || '<div class="text-sm text-slate-500">—</div>'}</div></div>`);
  add('Outlook Periode Berikutnya', `<div class="bg-teal-50 border border-teal-100 rounded-xl p-5 md:p-6"><p class="text-slate-700 mb-4 text-sm">${esc(I.outlook)}</p>
    ${grid(I.indikator.map((m) => kpi(m.nama, m.target)))}</div>`);

  const body = seksi.map(([judul, html], i) =>
    `<section class="mb-8"><h2 class="font-display text-xl md:text-2xl font-bold text-slate-900 mb-4">${i + 1}. ${esc(judul)}</h2>${html}</section>`).join('');

  const label = p.periode.tipe === 'mingguan' ? 'Weekly Report' : 'Monthly Report';
  const rentang = p.periode.mulai ? `${p.periode.mulai} → ${p.periode.akhir}` : `${p.periode.hari} hari`;
  const head = `<div class="flex items-end justify-between mb-6 flex-wrap gap-4">
    <div><div class="flex items-center gap-3 flex-wrap"><h1 class="font-display text-2xl md:text-4xl font-bold tracking-tight text-slate-900">${label}</h1>
      <div class="px-3 py-1 bg-slate-900 text-white text-xs font-bold rounded-full">${esc(rentang)}</div>
      ${mode === 'internal' ? '<div class="px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full">VERSI INTERNAL</div>' : ''}</div>
    <p class="text-base md:text-lg text-slate-600 mt-1">${esc(p.klien.toko || p.klien.nama || '')} • ${esc(p.klien.platform)} — Performance &amp; Strategic Analysis</p></div></div>`;

  const kaki = `<div class="text-center text-xs text-slate-500 mt-8 pt-6 border-t border-slate-200">
    <p>Dibuat oleh <span class="font-semibold">MEA CDPS Report Engine</span> • ${esc(rentang)}</p>
    <p class="mt-1">${esc(p.klien.toko || p.klien.nama || '')} • ${esc(p.klien.platform)}</p></div>`;

  return head + seksiSkor(p, mode) + body + kaki;
}

/** A complete, self-contained HTML document — what the AM downloads or forwards. */
export function renderReportHtml(p: ReportPayload, mode: RenderMode, insight?: PayloadInsight): string {
  const judul = `${p.periode.tipe === 'mingguan' ? 'Weekly' : 'Monthly'} Report — ${p.klien.toko || p.klien.nama || ''} ${p.periode.mulai || ''}`;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(judul)}${mode === 'internal' ? ' — Internal' : ''}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Poppins:wght@600;700&display=swap">
<style>${STYLE}</style></head>
<body data-mode="${mode}"><div class="max-w-screen-xl mx-auto px-4 md:px-6 py-8">${renderBody(p, mode, insight)}</div>
<script>window.CHART_DATA=${JSON.stringify(chartData(p))};</script>
<script>${CHART_BOOT}</script></body></html>`;
}
