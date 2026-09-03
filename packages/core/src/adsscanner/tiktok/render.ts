/**
 * TikTok Ads Scanner engine — payload → HTML.
 *
 * REQUIRED FIX (porting brief §"money format"): the tool's own `rp()` was
 * `'Rp'+Math.round(n||0).toLocaleString('id-ID')` — no house `Rp. `/`,00`
 * suffix, and a `||0` that would print `Rp0` for a genuinely-missing value
 * instead of `—`. This reuses the house formatter (`../../baseline/angka.ts`
 * — the SAME one `../../report/render.ts` uses), so this is not a fourth
 * money formatter: `rp`, `pct`, `num`, `esc` all come from there, and every
 * null in the payload (an intentional "no basis" per `metrik.ts`/`skor.ts`)
 * renders `—` instead of a misleading zero.
 *
 * Scope note: unlike `../../report/render.ts`, there is no `klien`/
 * `internal` mode split here — this tool has never been client-facing (it
 * is the advertiser's own decision-support view, like the SKU Screener),
 * so there is no "internal-only" block to omit. If a future decision routes
 * this payload into `client_reports` for client viewing, that split would
 * need to be added then — not assumed here.
 *
 * Pure string building, no DOM — lives in core next to the numbers it
 * renders, same as the other two engines.
 */
import { dec, esc, num, pct, rp } from '../../baseline/angka';
import { ALL_BUCKETS } from './types';
import type { AdsScannerPayload } from './payload';
import type { Bucket, SkuResult } from './types';

const BUCKET_META: Record<Bucket, { cls: string; desc: string }> = {
  'SCALE UP': { cls: 'text-emerald-700 bg-emerald-50 border-emerald-100', desc: 'ROI di atas benchmark & stok konten memadai. Naikkan budget bertahap.' },
  'PERLU OPTIMASI': { cls: 'text-amber-700 bg-amber-50 border-amber-100', desc: 'Sudah dibelanjakan tapi ROI di bawah benchmark. Perbaiki sesuai diagnosa, jangan tambah budget.' },
  'STOK VIDEO CUKUP': { cls: 'text-emerald-700 bg-emerald-50 border-emerald-100', desc: 'Konten cukup tapi belum diiklankan. Prioritas tes tertinggi — bahan iklan sudah ada.' },
  'BANGUN KONTEN': { cls: 'text-red-700 bg-red-50 border-red-100', desc: 'Belum layak diiklankan. Brief MCN/creative dulu sampai lolos gerbang konten.' },
  BOROS: { cls: 'text-red-700 bg-red-50 border-red-100', desc: 'Budget ke SKU konten kering. Pola klien gagal — hentikan & pindahkan.' },
  DIBLOKIR: { cls: 'text-red-700 bg-red-50 border-red-100', desc: 'Kena aturan komersial atau produk nonaktif. Catat di laporan klien.' },
};

const GATE_CLS: Record<SkuResult['gate'], string> = {
  KUAT: 'bg-emerald-50 text-emerald-700',
  CUKUP: 'bg-emerald-50 text-emerald-700',
  TIPIS: 'bg-amber-50 text-amber-700',
  KERING: 'bg-red-50 text-red-700',
};

function kpi(judul: string, nilai: string, sub = ''): string {
  return `<div class="bg-white rounded-xl border border-slate-100 p-4">
  <div class="text-[0.7rem] font-semibold text-slate-500 uppercase tracking-wide">${esc(judul)}</div>
  <div class="text-2xl font-bold text-teal-700 mt-1">${esc(nilai)}</div>
  <div class="text-xs text-slate-500 mt-1">${esc(sub)}</div></div>`;
}

const grid = (cards: string[], cols = 4): string => `<div class="grid grid-cols-2 md:grid-cols-${cols} gap-3">${cards.join('')}</div>`;

const kosong = (teks: string): string => `<div class="bg-white rounded-xl border border-slate-100 p-6 text-sm text-slate-500">${esc(teks)}</div>`;

function tabel(head: string[], baris: string[], align: ('l' | 'r')[] = []): string {
  const th = head.map((h, i) => `<th class="pb-2 ${align[i] === 'r' ? 'text-right' : 'text-left'}">${esc(h)}</th>`).join('');
  return `<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="border-b">${th}</tr></thead><tbody>${
    baris.join('') || `<tr><td colspan="${head.length}" class="py-3 text-slate-400">Tidak ada data pada kategori ini.</td></tr>`
  }</tbody></table></div>`;
}

function seksiVerdict(p: AdsScannerPayload): string {
  const R = p.ringkasan, bm = p.benchmark_kategori;
  const cards = [
    kpi('SKU lolos gerbang konten', `${R.skuSiap} / ${R.skuTotal}`, `${R.skuKering} SKU masih kering`),
    kpi('ROI gabungan iklan', R.blendedRoi == null ? '—' : dec(R.blendedRoi, 2), `benchmark kategori ${bm.roi ?? '—'}`),
    kpi('Budget ke SKU kering', pct(R.pctSpendKering, 1), 'klien menang biasanya <10%'),
    kpi('Bisa dipindahkan minggu ini', rp(R.poolRealokasi), 'dari SKU boros, diblokir & mati'),
  ];
  const flagRows = p.flags.length
    ? p.flags.map((f) => `<div class="border-l-4 border-amber-400 bg-amber-50 rounded-r-lg px-3 py-2 text-sm text-amber-900 mb-2">${esc(f)}</div>`).join('')
    : `<div class="border-l-4 border-emerald-400 bg-emerald-50 rounded-r-lg px-3 py-2 text-sm text-emerald-900">Tidak ada masalah alokasi besar. Lanjut ke keputusan per SKU.</div>`;
  const vonisBadgeCls = p.vonis.cls === 't-go' ? 'bg-emerald-100 text-emerald-700' : p.vonis.cls === 't-hold' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return `<div class="mb-3 flex items-center gap-2">
    <span class="px-2 py-0.5 rounded-full text-xs font-bold ${vonisBadgeCls}">${esc(p.vonis.label)}</span>
    <span class="text-xs text-slate-500">${esc(p.klien.kategori)} · ${esc(p.klien.periode_minggu ?? 'periode belum diisi')}</span>
  </div>${grid(cards)}<div class="mt-4">${flagRows}</div>`;
}

function skuRow(s: SkuResult, bm: AdsScannerPayload['benchmark_kategori']): string {
  const roiOk = bm.roi != null && s.roi != null ? s.roi >= bm.roi : null;
  const roiCls = roiOk == null ? 'text-slate-500' : roiOk ? 'text-emerald-700' : 'text-red-700';
  return `<tr class="border-b border-slate-50">
    <td class="py-2 pr-3 max-w-[260px]"><div class="font-medium">${esc(s.nama).slice(0, 72)}</div><div class="text-[10px] text-slate-400 font-mono">${esc(s.pidFull)}</div></td>
    <td class="py-2 pr-3 text-right font-mono">${s.skor}</td>
    <td class="py-2 pr-3"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${GATE_CLS[s.gate]}">${esc(s.gate)}</span></td>
    <td class="py-2 pr-3 text-right font-mono">${num(s.konten)}</td>
    <td class="py-2 pr-3 text-right font-mono">${rp(s.gmv)}</td>
    <td class="py-2 pr-3 text-right font-mono ${roiCls}">${s.roi == null ? '—' : dec(s.roi, 2)}</td>
    <td class="py-2 pr-3 text-right font-mono">${pct(s.ctr, 1)}</td>
    <td class="py-2 pr-3 text-right font-mono">${pct(s.ctor, 1)}</td>
    <td class="py-2 pr-3 text-right font-mono">${s.budgetHarian ? rp(s.budgetHarian) : '—'}</td>
    <td class="py-2 text-slate-600 max-w-[320px]">${esc(s.aksi)}${s.subMasalah ? `<div class="mt-1"><span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">${esc(s.subMasalah)}</span></div>` : ''}</td>
  </tr>`;
}

function seksiBucket(p: AdsScannerPayload, bucket: Bucket): string {
  const meta = BUCKET_META[bucket];
  const rows = p.sku.filter((s) => s.bucket === bucket).sort((a, b) => b.skor - a.skor);
  const head = ['SKU', 'Skor', 'Gerbang', 'Konten', 'GMV', 'ROI', 'CTR', 'CTOR', 'Budget/hari', 'Aksi'];
  const align: ('l' | 'r')[] = ['l', 'r', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'l'];
  const banner = `<div class="border-l-4 px-3 py-2 text-sm rounded-r-lg mb-3 ${meta.cls}">${esc(meta.desc)}</div>`;
  return banner + tabel(head, rows.map((s) => skuRow(s, p.benchmark_kategori)), align);
}

function seksiSkuMati(p: AdsScannerPayload): string {
  if (!p.orphan.length) return kosong('Tidak ada belanja ke SKU di luar Analitik Produk. Bagus.');
  const head = ['ID produk', 'Belanja', 'Pendapatan', 'Materi', 'Kampanye'];
  const rows = p.orphan.map((o) => `<tr class="border-b border-slate-50">
    <td class="py-2 pr-3 font-mono text-[11px]">${esc(o.pid)}</td>
    <td class="py-2 pr-3 text-right font-mono">${rp(o.cost)}</td>
    <td class="py-2 pr-3 text-right font-mono">${rp(o.rev)}</td>
    <td class="py-2 pr-3 text-right font-mono">${o.creatives}</td>
    <td class="py-2 text-slate-600">${esc(o.kampanye.join(' | ')).slice(0, 90)}</td>
  </tr>`);
  return tabel(head, rows, ['l', 'r', 'r', 'r', 'l']);
}

function seksiRealokasi(p: AdsScannerPayload): string {
  const sumber = p.sku.filter((s) => s.bucket === 'BOROS' || s.bucket === 'DIBLOKIR').sort((a, b) => b.adCost - a.adCost).slice(0, 25);
  const ambil = tabel(
    ['SKU', 'Konten', 'Belanja'],
    [
      ...sumber.map((s) => `<tr class="border-b border-slate-50"><td class="py-2 pr-3">${esc(s.nama).slice(0, 52)}<div class="text-[10px] text-slate-400">${esc(s.bucket)}</div></td><td class="py-2 pr-3 text-right font-mono">${num(s.konten)}</td><td class="py-2 text-right font-mono">${rp(s.adCost)}</td></tr>`),
      ...(p.ringkasan.orphanSpend > 0 ? [`<tr class="border-b border-slate-50"><td class="py-2 pr-3">SKU mati / di luar Analitik<div class="text-[10px] text-slate-400">${p.ringkasan.orphanSku} SKU</div></td><td class="py-2 pr-3 text-right">—</td><td class="py-2 text-right font-mono">${rp(p.ringkasan.orphanSpend)}</td></tr>`] : []),
    ],
    ['l', 'r', 'r'],
  );
  const pindah = tabel(
    ['SKU', 'Skor', 'Tambahan'],
    p.realokasi.rows.slice(0, 25).map((t) => `<tr class="border-b border-slate-50"><td class="py-2 pr-3">${esc(t.nama).slice(0, 52)}<div class="text-[10px] text-slate-400">${esc(t.bucket)}</div></td><td class="py-2 pr-3 text-right font-mono">${t.skor}</td><td class="py-2 text-right font-mono text-emerald-700">+${rp(t.tambahan)}</td></tr>`),
    ['l', 'r', 'r'],
  );
  return `<p class="text-sm text-slate-600 mb-3">Ambil ${rp(p.realokasi.pool)} dari SKU tak layak, taruh ke SKU yang sudah punya bahan.</p>
  <div class="grid md:grid-cols-2 gap-4">
    <div><div class="text-xs font-semibold text-slate-500 uppercase mb-2">Ambil dari sini</div>${ambil}</div>
    <div><div class="text-xs font-semibold text-slate-500 uppercase mb-2">Pindahkan ke sini</div>${pindah}</div>
  </div>`;
}

function seksiAngle(p: AdsScannerPayload): string {
  const table = (rows: AdsScannerPayload['angles']['kreator'], judul: string): string => {
    if (!rows.length) return `<div class="text-sm text-slate-500 mb-4">Tidak ada data konten ${esc(judul)}.</div>`;
    const head = ['Angle', 'Video', 'Menang', 'Tingkat menang', 'GPM median', 'GMV'];
    const baris = rows.map((a) => `<tr class="border-b border-slate-50">
      <td class="py-2 pr-3 font-medium">${esc(a.angle)}</td>
      <td class="py-2 pr-3 text-right font-mono">${num(a.jumlah)}</td>
      <td class="py-2 pr-3 text-right font-mono">${a.menang}</td>
      <td class="py-2 pr-3 text-right font-mono">${pct(a.winRate, 1)}</td>
      <td class="py-2 pr-3 text-right font-mono">${rp(a.gpmMedian)}</td>
      <td class="py-2 text-right font-mono">${rp(a.gmv)}</td>
    </tr>`);
    return `<div class="text-xs font-semibold text-slate-500 uppercase mb-2 mt-4">${esc(judul)}</div>${tabel(head, baris, ['l', 'r', 'r', 'r', 'r', 'r'])}`;
  };
  return `<p class="text-sm text-slate-600 mb-1">Video menang bila GMV &gt; 0 dan GPM ≥ ${rp(p.gpm_benchmark_rupiah)} per 1.000 views (benchmark ${esc(p.klien.kategori)}).</p>
  ${table(p.angles.kreator, 'Kreator / affiliate')}
  ${table(p.angles.toko, 'Konten toko')}`;
}

export function renderBody(p: AdsScannerPayload): string {
  const seksi: [string, string][] = [
    ['Vonis Akun', seksiVerdict(p)],
    ...ALL_BUCKETS.map((b): [string, string] => [`Keputusan SKU — ${b}`, seksiBucket(p, b)]),
    ['SKU Mati (belanja tanpa Analitik Produk)', seksiSkuMati(p)],
    ['Realokasi Budget', seksiRealokasi(p)],
    ['Angle Konten yang Menang', seksiAngle(p)],
  ];
  const body = seksi.map(([judul, html], i) => `<section class="mb-8"><h2 class="text-lg md:text-xl font-bold text-slate-900 mb-3">${i + 1}. ${esc(judul)}</h2>${html}</section>`).join('');
  const head = `<div class="mb-6"><h1 class="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">TikTok SKU Triage</h1>
    <p class="text-sm text-slate-600 mt-1">${esc(p.klien.nama || '')} · ${esc(p.klien.kategori)} — ${esc(p.klien.periode_minggu ?? 'periode belum diisi')}</p></div>`;
  const foot = `<div class="text-center text-xs text-slate-500 mt-8 pt-6 border-t border-slate-200">
    <p>Dibuat oleh <span class="font-semibold">MEA CDPS TikTok Ads Scanner</span> · benchmark v${p.benchmark_versi ?? '—'}</p>
    <p class="mt-1">ID produk dicocokkan pada 15 digit pertama karena export Ads memotong presisi ID.</p></div>`;
  return head + body + foot;
}

/** A complete, self-contained HTML document — what the AM downloads or forwards. */
export function renderReportHtml(p: AdsScannerPayload): string {
  const judul = `TikTok SKU Triage — ${p.klien.nama || ''} ${p.klien.periode_minggu ?? ''}`;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(judul)}</title>
<script src="https://cdn.tailwindcss.com"></script>
</head><body class="bg-slate-50"><div class="max-w-screen-xl mx-auto px-4 md:px-6 py-8">
${renderBody(p)}</div></body></html>`;
}
