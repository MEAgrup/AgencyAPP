/**
 * PDT (Pusat Data Toko) — payload "laporan" v1 → standalone HTML (B-01/B-02).
 *
 * `laporan.ts` builds the structured payload; this fills the gap it left —
 * PDT never had an HTML renderer of its own. Pure string building, mirroring
 * `report/render.ts`'s structure (`kpi`/`grid`/`tabel`/`kartuInternal`/`gauge`
 * are REUSED from there rather than forked — same "one design system" call
 * `report/shopee/render.ts` already made) and `docassets` for CSS/Chart.js/
 * print boot/icons. Nol DOM, nol jam sendiri, nol I/O.
 *
 * **ONE renderer for both platforms** — branches on `laporan.platform`
 * internally and on which optional sections the payload carries (`iklan`,
 * `live`, `produk`, `tahap` TikTok-only, `promo`/`layanan` Shopee-only, …).
 * That is the whole advantage of the PDT payload over M14: one unified
 * shape means one renderer, not `report/render.ts` + `report/shopee/render.ts`.
 *
 * Two modes, same house rule as `report/render.ts`:
 *
 *  - `klien`    — what the client receives. Any metric whose value is `null`
 *    is OMITTED (never shown as `—`/placeholder), and a section whose core
 *    data is `null` is skipped entirely. Section numbers are computed from
 *    what actually rendered THIS mode, never a shared static list — two
 *    modes of the same payload can (and usually do) have different counts.
 *  - `internal` — adds AM-only content: the `kelengkapan` block (M20 R2,
 *    caveats-as-data), the excluded-dimension note on the skor cards, and
 *    `benchmarkVersi` (TikTok only — Shopee's payload never carries the
 *    field, see `bangunLaporanShopee`). These strings are NEVER built in
 *    `klien` mode (not hidden with CSS) — every internal-only chunk below
 *    sits behind a `mode === 'internal' ? … : ''` ternary, so the `klien`
 *    branch never evaluates the template literal that would contain them.
 *
 * `insight` (ringkasan/poin/rekomendasi/outlook/indikator) renders AS-IS in
 * BOTH modes — it has been caveat-free prose since A-01, and mirrors M14's
 * own Outlook section which is likewise mode-agnostic.
 *
 * Not carried here because the payload itself does not carry it (checked,
 * not guessed — see the B-01/B-02 handoff report): per-dimension score
 * *notes* (M14's `d.catatan`; PDT's `PdtDimensiSkorHasil` has no such field,
 * only `labelTampil` for excluded dimensions, which IS rendered internal-only
 * below), the `tahap` funnel's healthy-range/benchmark band column (M14's
 * `f.band`; PDT's `PdtLaporanFunnelLangkah` never carries one — deliberate,
 * see `laporan.ts`'s `PdtLaporanTahap` docblock), and the AM's own
 * excluded-accounts list (M14's `afiliasi.akun_sendiri_dikecualikan`; PDT's
 * `PdtLaporanAfiliasi` has no such field).
 */
import { DASH, dec, esc, num, pct, rp } from '../baseline/angka';
import { ATRIBUSI_IKON, CHART_JS, DOC_CSS, ikon as ikonSvg, PRINT_BOOT, type IconName } from '../docassets';
import { gauge, grid, jsonForScript, kartuInternal, kosong, kpi, rekCard, rpPendek, tabel, td } from '../report/render';
import type { PdtKelengkapanBagian, PdtLaporanInsight, PdtLaporanShopee, PdtLaporanTahap, PdtLaporanTahapBlok, PdtLaporanTiktok, PdtTahapKey } from './laporan';
import type { PdtKuadranSku } from './kuadran';

export type RenderMode = 'klien' | 'internal';

type Laporan = PdtLaporanTiktok | PdtLaporanShopee;

// ---------------------------------------------------------------------------
// Null-omission helpers — the mechanism behind R2.3 ("any metric whose value
// is null is OMITTED from klien mode, not rendered as — or a placeholder").
// `internal` mode always renders (the formatter itself already turns null
// into `—`, house rule #7 — `rp`/`num`/`pct`/`dec` from `baseline/angka`).
// ---------------------------------------------------------------------------

/** One KPI tile. Omitted (empty string) in `klien` mode when the raw value is `null`. */
function kartuOpsional(mode: RenderMode, nilaiMentah: unknown, judul: string, terformat: string, sub = ''): string {
  if (mode === 'klien' && nilaiMentah == null) return '';
  return kpi(judul, terformat, sub);
}

/** One table cell's content. `klien` + null ⇒ blank cell (not `—`) — the row's other cells (an entity's name, say) still carry real data. */
function selCell(mode: RenderMode, nilaiMentah: unknown, terformat: string): string {
  return mode === 'klien' && nilaiMentah == null ? '' : terformat;
}

const KEDALAMAN_LABEL: Record<'dalam' | 'sedang' | 'dangkal', string> = {
  dalam: 'penjelajahan dalam', sedang: 'penjelajahan sedang', dangkal: 'penjelajahan dangkal',
};

// ---------------------------------------------------------------------------
// Ringkasan Eksekutif
// ---------------------------------------------------------------------------
function catatanBenchmarkVersi(p: Laporan, mode: RenderMode): string {
  if (mode !== 'internal' || p.platform !== 'tiktok') return '';
  return `<p class="text-xs text-slate-400 mt-2"><span class="badge-int">INTERNAL</span> Mesin skor PDT • benchmark versi ${num(p.benchmarkVersi)}.</p>`;
}

function seksiRingkasan(p: Laporan, mode: RenderMode): string {
  const k = p.kpi;
  const cards = [
    kartuOpsional(mode, k.gmv, 'GMV', rpPendek(k.gmv), k.pesanan != null ? `${num(k.pesanan)} pesanan` : ''),
    kartuOpsional(mode, k.pengunjung, 'Pengunjung', num(k.pengunjung), 'ke toko'),
    kartuOpsional(mode, k.cvr, 'CVR Toko', pct(k.cvr, 2), 'pesanan / pengunjung'),
    kartuOpsional(
      mode, k.barangPerPengunjung, 'Kedalaman Jelajah',
      k.barangPerPengunjung == null ? DASH : dec(k.barangPerPengunjung, 2),
      k.kedalaman ? KEDALAMAN_LABEL[k.kedalaman] : '',
    ),
    kartuOpsional(mode, p.skor.total, 'Skor Performa', p.skor.total == null ? DASH : `${dec(p.skor.total, 1)}/10`, p.skor.label ?? ''),
  ].filter(Boolean);
  return `${grid(cards)}
  <div class="mt-4 p-4 bg-white rounded-xl border border-slate-100 insight-card"><p class="text-sm font-medium text-slate-700">${esc(p.insight.ringkasan)}</p></div>
  ${catatanBenchmarkVersi(p, mode)}`;
}

// ---------------------------------------------------------------------------
// Tren Harian
// ---------------------------------------------------------------------------
function seksiHarian(p: Laporan, mode: RenderMode): string {
  const h = p.harian;
  if (!h) return mode === 'internal' ? kosong('Belum ada baris data harian (`pdt_fact_shop_daily`) untuk periode ini.') : '';
  const cards = [
    kartuOpsional(mode, h.gmvRataHarian, 'GMV Rata-Rata Harian', rpPendek(h.gmvRataHarian)),
    kartuOpsional(mode, h.gmvTertinggi, 'Hari GMV Tertinggi', h.gmvTertinggi ? rpPendek(h.gmvTertinggi.gmv) : DASH, h.gmvTertinggi ? esc(h.gmvTertinggi.tanggal) : ''),
    kartuOpsional(mode, h.gmvTerendah, 'Hari GMV Terendah', h.gmvTerendah ? rpPendek(h.gmvTerendah.gmv) : DASH, h.gmvTerendah ? esc(h.gmvTerendah.tanggal) : ''),
  ].filter(Boolean);
  return `${cards.length ? grid(cards, 3) : ''}
  <div class="${cards.length ? 'mt-4 ' : ''}bg-white rounded-xl border border-slate-100 p-5"><canvas id="c_harian" height="100"></canvas>
    <p class="text-xs text-slate-400 mt-2">${num(h.hariTerisi)} hari dengan data pada periode ini.</p></div>`;
}

// ---------------------------------------------------------------------------
// Perjalanan Pembeli (tahap) — TikTok-only
// ---------------------------------------------------------------------------
const TAHAP_LABEL_ID: Record<PdtTahapKey, string> = { awareness: 'Awareness', consideration: 'Consideration', conversion: 'Conversion' };
const TAHAP_IKON: Record<PdtTahapKey, IconName> = { awareness: 'fa-eye', consideration: 'fa-magnifying-glass-chart', conversion: 'fa-cart-shopping' };

function formatTahapMetrik(satuan: string, nilai: number | null): string {
  if (nilai == null) return DASH;
  if (satuan === 'rupiah') return rp(nilai);
  if (satuan === 'persen') return pct(nilai, 2);
  if (satuan === 'kali') return dec(nilai, 2) + 'x';
  return num(nilai);
}

function seksiFunnel(t: PdtLaporanTahap, mode: RenderMode): string {
  const rows = t.funnel
    .filter((f) => mode === 'internal' || f.nilai != null)
    .map((f) => {
      const catatan = mode === 'internal' && f.catatan ? `<div class="text-[0.65rem] text-slate-400">${esc(f.catatan)}</div>` : '';
      const nilai = f.nilai == null ? `${DASH}${catatan}` : `<b>${num(f.nilai)}</b>`;
      const lolos = selCell(mode, f.lolos, f.lolos == null ? DASH : pct(f.lolos, 2));
      return `<tr class="border-b last:border-0">${td(esc(f.label))}${td(nilai, true)}${td(lolos, true)}</tr>`;
    });
  return `<div class="bg-white rounded-xl border border-slate-100 p-5">${tabel(['Tahap', 'Jumlah', 'Lolos ke tahap ini'], rows, ['l', 'r', 'r'])}
  <p class="text-sm text-slate-600 mt-3">Konversi ujung ke ujung (pesanan dari pengunjung): <b>${pct(t.konversiTotal.nilai, 2)}</b></p></div>`;
}

function seksiTahapBlok(b: PdtLaporanTahapBlok, mode: RenderMode): string {
  const lencana = b.fokus
    ? '<span class="px-2 py-0.5 bg-teal-600 text-white text-[0.65rem] font-bold rounded-full">FOKUS PERIODE INI</span>' : '';
  const belanja = b.belanja == null
    ? '' : `<div class="text-xs text-slate-500 mt-1">Investasi media tahap ini <b>${rp(b.belanja)}</b>${b.belanjaPersen == null ? '' : ` • ${pct(b.belanjaPersen, 1)} dari total`}</div>`;
  const kartuMetrik = b.metrik
    .filter((m) => mode === 'internal' || m.nilai != null)
    .map((m) => `<div class="bg-white rounded-xl border border-slate-100 p-4">
      <div class="text-[0.7rem] font-semibold text-slate-500 uppercase tracking-wide">${esc(m.label)}</div>
      <div class="kpi-value mt-1 text-teal-700">${formatTahapMetrik(m.satuan, m.nilai)}</div></div>`).join('');
  return `<div class="bg-teal-50 border border-teal-100 rounded-xl p-4 mb-3">
    <div class="flex items-center gap-2 flex-wrap"><span class="text-sm font-bold text-teal-800">${esc(TAHAP_LABEL_ID[b.kode])}</span>${lencana}</div>${belanja}</div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${kartuMetrik}</div>`;
}

// ---------------------------------------------------------------------------
// Sumber GMV (kanal)
// ---------------------------------------------------------------------------
function seksiKanal(p: Laporan, mode: RenderMode): string {
  const kn = p.kanal;
  if (kn.gmvTotal == null || kn.items.length === 0) return mode === 'internal' ? kosong('Belum ada data kanal untuk periode ini.') : '';
  const rows = kn.items
    .filter((it) => mode === 'internal' || it.gmv != null)
    .sort((a, b) => (b.gmv ?? -1) - (a.gmv ?? -1))
    .map((it) => `<tr class="border-b last:border-0">${td(esc(it.label))}${td(it.gmv == null ? DASH : `<b>${rp(it.gmv)}</b>`, true)}${td(it.persen == null ? DASH : pct(it.persen, 1), true)}</tr>`);
  if (rows.length === 0) return mode === 'internal' ? kosong('Belum ada data kanal untuk periode ini.') : '';
  return `<div class="grid md:grid-cols-2 gap-4">
  <div class="bg-white rounded-xl border border-slate-100 p-5"><canvas id="c_kanal" height="220"></canvas></div>
  <div class="bg-white rounded-xl border border-slate-100 p-5">${tabel(['Sumber GMV', 'GMV', 'Kontribusi'], rows, ['l', 'r', 'r'])}</div></div>`;
}

// ---------------------------------------------------------------------------
// Tokopedia (F-01, M20 R8) — TikTok-only, `p.tokopedia` `null` = berkas
// belum pernah diunggah untuk toko ini (bukan toko tanpa Tokopedia sama
// sekali — PDT tidak tahu bedanya, sama semua bagian opsional lain).
// ---------------------------------------------------------------------------
function seksiTokopedia(p: Laporan, mode: RenderMode): string {
  if (p.platform !== 'tiktok' || !p.tokopedia) {
    return mode === 'internal' ? kosong('Berkas Tokopedia (Analitik Toko) tidak diunggah / nol baris periode ini.') : '';
  }
  const t = p.tokopedia;
  const cards = [
    kpi('GMV', rpPendek(t.gmv), `${num(t.pesanan)} pesanan`),
    kpi('Pengunjung', num(t.pengunjung)),
    kartuOpsional(mode, t.cvr, 'CVR', t.cvr == null ? DASH : pct(t.cvr, 2)),
    kartuOpsional(mode, t.produkTerjual, 'Produk Terjual', t.produkTerjual == null ? DASH : num(t.produkTerjual)),
    kartuOpsional(mode, t.pembeli, 'Pembeli', t.pembeli == null ? DASH : num(t.pembeli)),
  ].filter(Boolean);
  const pr = t.perubahan;
  const formatDelta = (v: number | null): string => (v == null ? DASH : `${v >= 0 ? '+' : ''}${pct(v, 1)}`);
  const rows = [
    ['GMV', pr.gmv], ['Pesanan', pr.pesanan], ['Pengunjung', pr.pengunjung],
    ['Produk Terjual', pr.produkTerjual], ['Pembeli', pr.pembeli],
  ].filter(([, v]) => mode === 'internal' || v != null)
    .map(([label, v]) => `<tr class="border-b last:border-0">${td(esc(label as string))}${td(formatDelta(v as number | null), true)}</tr>`);
  const tabelPerubahan = rows.length === 0 ? '' : `<div class="mt-4 bg-white rounded-xl border border-slate-100 p-5">
    <h3 class="font-semibold text-sm text-slate-600 mb-3">Perubahan vs Periode Sebelumnya</h3>${tabel(['Metrik', 'Perubahan'], rows, ['l', 'r'])}</div>`;
  return `${grid(cards)}${tabelPerubahan}`;
}

// ---------------------------------------------------------------------------
// Iklan (+ rincian kampanye)
// ---------------------------------------------------------------------------
function seksiIklan(p: Laporan, mode: RenderMode): string {
  const a = p.iklan;
  if (!a) return mode === 'internal' ? kosong('Berkas iklan tidak diunggah / nol baris iklan periode ini.') : '';
  const cards = [
    kartuOpsional(mode, a.biaya, 'Total Belanja Iklan', rpPendek(a.biaya)),
    kartuOpsional(mode, a.gmv, 'GMV dari Iklan', rpPendek(a.gmv)),
    kartuOpsional(mode, a.roas, 'ROAS', a.roas == null ? DASH : dec(a.roas, 2) + 'x'),
  ].filter(Boolean);
  const rows = a.items
    .filter((it) => mode === 'internal' || it.biaya != null || it.gmv != null)
    .map((it) => `<tr class="border-b last:border-0">${td(esc(it.label))}${td(selCell(mode, it.biaya, it.biaya == null ? DASH : rp(it.biaya)), true)}${td(selCell(mode, it.gmv, it.gmv == null ? DASH : rp(it.gmv)), true)}${td(selCell(mode, it.roas, it.roas == null ? DASH : dec(it.roas, 2) + 'x'), true)}</tr>`);
  return `${grid(cards)}
  <div class="mt-4 bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Per Sumber</h3>${tabel(['Sumber', 'Biaya', 'GMV', 'ROAS'], rows, ['l', 'r', 'r', 'r'])}</div>`;
}

function seksiKampanye(p: Laporan, mode: RenderMode): string {
  const k = p.kampanye;
  if (!k) return mode === 'internal' ? kosong('Belum ada rincian iklan per kampanye periode ini.') : '';
  const rows = k.top.map((it) => `<tr class="border-b last:border-0">${td(esc(it.sumber))}${td(esc(it.kampanyeId))}${td(`<b>${rp(it.biaya)}</b>`, true)}${td(selCell(mode, it.gmv, it.gmv == null ? DASH : rp(it.gmv)), true)}${td(selCell(mode, it.roas, it.roas == null ? DASH : dec(it.roas, 2) + 'x'), true)}${td(selCell(mode, it.ctr, it.ctr == null ? DASH : pct(it.ctr, 2)), true)}</tr>`);
  const nihil = mode === 'internal' && k.tanpaHasil > 0
    ? `<div class="mt-4">${kartuInternal('Kampanye Tanpa Hasil', `${num(k.tanpaHasil)} dari ${num(k.totalKampanye)} kampanye membakar ${rp(k.biayaTanpaHasil)} tanpa GMV di periode ini.`, 'red', 'fa-fire-flame-curved')}</div>` : '';
  return `<div class="bg-white rounded-xl border border-slate-100 p-5">${tabel(['Sumber', 'Kampanye', 'Biaya', 'GMV', 'ROAS', 'CTR'], rows, ['l', 'l', 'r', 'r', 'r', 'r'])}</div>${nihil}`;
}

// ---------------------------------------------------------------------------
// LIVE (+ rincian sesi)
// ---------------------------------------------------------------------------
function seksiLive(p: Laporan, mode: RenderMode): string {
  const L = p.live;
  if (!L) return mode === 'internal' ? kosong('Berkas LIVE tidak diunggah / nol sesi periode ini.') : '';
  const cards = [
    kpi('Sesi LIVE', num(L.sesi)),
    kartuOpsional(mode, L.gmv, 'GMV LIVE', rpPendek(L.gmv)),
    kartuOpsional(mode, L.jam, 'Jam Siaran', L.jam == null ? DASH : dec(L.jam, 1) + 'j'),
    kartuOpsional(mode, L.gmvPerJam, 'GMV / Jam', rpPendek(L.gmvPerJam)),
  ].filter(Boolean);
  return grid(cards);
}

function seksiSesiLive(p: Laporan, mode: RenderMode): string {
  const s = p.sesiLive;
  if (!s) return mode === 'internal' ? kosong('Belum ada rincian per sesi LIVE periode ini.') : '';
  const rows = s.top.map((it) => `<tr class="border-b last:border-0">${td(esc(it.creatorHandle ?? (it.akunToko ? 'Toko' : '-')))}${td(selCell(mode, it.waktuPosting, esc((it.waktuPosting ?? '').slice(0, 16))))}${td(`<b>${it.gmv == null ? DASH : rp(it.gmv)}</b>`, true)}${td(selCell(mode, it.gmvPerJam, it.gmvPerJam == null ? DASH : rp(it.gmvPerJam)), true)}${td(selCell(mode, it.vv, it.vv == null ? DASH : num(it.vv)), true)}</tr>`);
  return `<div class="bg-white rounded-xl border border-slate-100 p-5">${tabel(['Kreator / Toko', 'Waktu', 'GMV', 'GMV / Jam', 'Views'], rows, ['l', 'l', 'r', 'r', 'r'])}
  <p class="text-xs text-slate-400 mt-2">${num(s.totalSesi)} sesi sepanjang periode ini; kontribusi ${s.top.length} sesi teratas: ${s.kontribusiTop == null ? DASH : pct(s.kontribusiTop, 1)}.</p></div>`;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------
function seksiVideo(p: Laporan, mode: RenderMode): string {
  const V = p.video;
  if (!V) return mode === 'internal' ? kosong('Berkas video tidak diunggah / nol video periode ini.') : '';
  const cards = [
    kpi('Total Video', num(V.total)),
    kartuOpsional(mode, V.gmv, 'GMV Video', rpPendek(V.gmv)),
    kartuOpsional(mode, V.vv, 'Views', num(V.vv)),
    kartuOpsional(mode, V.gmvPerVideo, 'GMV / Video', rpPendek(V.gmvPerVideo)),
  ].filter(Boolean);
  return grid(cards);
}

// ---------------------------------------------------------------------------
// Produk (kuadran) — TikTok: benchmark saja; Shopee: `top` saja, `distribusi` selalu null
// ---------------------------------------------------------------------------
const KUADRAN_META_PDT: Record<PdtKuadranSku, [string, string]> = {
  bintang: ['Produk Bintang', '#059669'],
  hidden_gem: ['Hidden Gem', '#3B82F6'],
  bocor_traffic: ['Bocor Traffic', '#EA580C'],
  evaluasi: ['Evaluasi', '#DC2626'],
  tidur: ['Produk Tidur', '#94A3B8'],
  tidak_tayang: ['Tidak Tayang', '#CBD5E1'],
  no_data: ['No Data', '#E2E8F0'],
};

function seksiProduk(p: Laporan, mode: RenderMode): string {
  const Q = p.produk;
  if (!Q) return mode === 'internal' ? kosong('Belum ada data produk (kuadran) periode ini.') : '';
  const dist = Q.distribusi;
  const distBars = dist
    ? (Object.entries(dist) as [PdtKuadranSku, { jumlah: number; gmv: number | null }][])
        .filter(([, v]) => v.jumlah > 0)
        .map(([kode, v]) => {
          const [label, warna] = KUADRAN_META_PDT[kode];
          return `<div><div class="flex justify-between text-xs mb-0.5"><span>${esc(label)}</span><span class="font-semibold">${v.jumlah}</span></div>
        <div class="w-full bg-slate-100 rounded-full h-1.5"><div style="width:100%;background:${warna}" class="h-1.5 rounded-full"></div></div></div>`;
        }).join('')
    : '';
  const topRows = Q.top
    .filter((it) => mode === 'internal' || it.gmv != null)
    .map((it) => `<tr class="border-b last:border-0">${td(esc(it.namaProduk ?? it.platformProductId ?? '-'))}${td(selCell(mode, it.traffic, it.traffic == null ? DASH : num(it.traffic)), true)}${td(selCell(mode, it.cvr, it.cvr == null ? DASH : pct(it.cvr, 2)), true)}${td(`<b>${it.gmv == null ? DASH : rp(it.gmv)}</b>`, true)}</tr>`);
  if (!dist && topRows.length === 0) return mode === 'internal' ? kosong('Belum ada data produk (kuadran) periode ini.') : '';
  return `${dist ? `<div class="bg-white rounded-xl border border-slate-100 p-5 mb-4"><h3 class="font-semibold text-sm text-slate-600 mb-3">Distribusi Kuadran</h3><div class="space-y-1.5">${distBars}</div></div>` : ''}
  <div class="bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-slate-700 mb-3">Top Produk by GMV</h3>${tabel(['Produk', 'Traffic', 'CVR', 'GMV'], topRows, ['l', 'r', 'r', 'r'])}</div>`;
}

// ---------------------------------------------------------------------------
// Affiliate (+ rincian kreator)
// ---------------------------------------------------------------------------
function seksiAfiliasi(p: Laporan, mode: RenderMode): string {
  const A = p.afiliasi;
  if (!A) return mode === 'internal' ? kosong('Belum ada data kreator afiliasi periode ini.') : '';
  const cards = [
    kpi('Total Kreator', num(A.totalKreator)),
    kpi('Kreator Produktif', num(A.produktif)),
    kartuOpsional(mode, A.gmv, 'GMV Afiliasi', rpPendek(A.gmv)),
    kartuOpsional(mode, A.aov, 'AOV Afiliasi', rpPendek(A.aov)),
  ].filter(Boolean);
  return grid(cards);
}

function seksiKreator(p: Laporan, mode: RenderMode): string {
  const K = p.kreator;
  if (!K) return mode === 'internal' ? kosong('Belum ada rincian per kreator periode ini.') : '';
  const rows = K.top.map((it) => `<tr class="border-b last:border-0">${td(esc(it.handle))}${td(`<b>${it.gmv == null ? DASH : rp(it.gmv)}</b>`, true)}${td(selCell(mode, it.pesanan, it.pesanan == null ? DASH : num(it.pesanan)), true)}${td(selCell(mode, it.aov, it.aov == null ? DASH : rp(it.aov)), true)}</tr>`);
  return `<div class="bg-white rounded-xl border border-slate-100 p-5">${tabel(['Kreator', 'GMV', 'Pesanan', 'AOV'], rows, ['l', 'r', 'r', 'r'])}
  <p class="text-xs text-slate-400 mt-2">Total kreator: ${num(K.totalKreator)} • kontribusi ${K.top.length} kreator teratas: ${K.kontribusiTop == null ? DASH : pct(K.kontribusiTop, 1)}.</p></div>`;
}

// ---------------------------------------------------------------------------
// Voucher & Promo — Shopee-only
// ---------------------------------------------------------------------------
function seksiPromo(p: PdtLaporanShopee, mode: RenderMode): string {
  const pr = p.promo;
  if (!pr) return mode === 'internal' ? kosong('Belum ada data promo (diskon/flash sale) periode ini.') : '';
  const total = pr.diskonTotal;
  const fs = pr.flashSale;
  const cards = [
    total ? kartuOpsional(mode, total.penjualanSiapDikirim, 'Penjualan dari Diskon', rp(total.penjualanSiapDikirim)) : '',
    kartuOpsional(mode, pr.kontribusiGmvDiskon, 'Kontribusi GMV (Diskon)', pr.kontribusiGmvDiskon == null ? DASH : pct(pr.kontribusiGmvDiskon, 1)),
    fs ? kartuOpsional(mode, fs.penjualanSiapDikirim, 'Penjualan Flash Sale', rp(fs.penjualanSiapDikirim)) : '',
    kartuOpsional(mode, pr.kontribusiGmvFlashSale, 'Kontribusi GMV (Flash Sale)', pr.kontribusiGmvFlashSale == null ? DASH : pct(pr.kontribusiGmvFlashSale, 1)),
  ].filter(Boolean);
  const rows = pr.diskonPerTipe.map((t) => `<tr class="border-b last:border-0">${td(esc(t.tipe))}${td(selCell(mode, t.penjualanSiapDikirim, t.penjualanSiapDikirim == null ? DASH : rp(t.penjualanSiapDikirim)), true)}${td(selCell(mode, t.pesananSiapDikirim, t.pesananSiapDikirim == null ? DASH : num(t.pesananSiapDikirim)), true)}</tr>`);
  if (cards.length === 0 && rows.length === 0) return mode === 'internal' ? kosong('Belum ada data promo (diskon/flash sale) periode ini.') : '';
  return `${cards.length ? grid(cards) : ''}${rows.length ? `<div class="mt-4 bg-white rounded-xl border border-slate-100 p-5"><h3 class="font-semibold text-sm text-slate-600 mb-3">Per Tipe Diskon</h3>${tabel(['Tipe', 'Penjualan Siap Kirim', 'Pesanan'], rows, ['l', 'r', 'r'])}</div>` : ''}`;
}

// ---------------------------------------------------------------------------
// Layanan & Kesehatan Toko — Shopee-only
// ---------------------------------------------------------------------------
function seksiLayanan(p: PdtLaporanShopee, mode: RenderMode): string {
  const L = p.layanan;
  if (!L) return mode === 'internal' ? kosong('Belum ada data layanan chat / kesehatan toko periode ini.') : '';
  const c = L.chat;
  const cards = c ? [
    kartuOpsional(mode, c.responseRate, 'Tingkat Chat Direspon', c.responseRate == null ? DASH : pct(c.responseRate, 1)),
    kartuOpsional(mode, c.csat, 'CSAT Chat', c.csat == null ? DASH : pct(c.csat, 1)),
    kartuOpsional(mode, c.konversiChatDibalas, 'Konversi dari Chat', c.konversiChatDibalas == null ? DASH : pct(c.konversiChatDibalas, 1)),
  ].filter(Boolean) : [];
  const penaltiRows = L.penalti.map((x) => `<tr class="border-b last:border-0">${td(esc(x.deskripsi))}${td(esc(x.durasi))}${td(`<b>${num(x.poin)}</b>`, true)}</tr>`);
  const penaltiBlock = L.poinPenaltiTotal == null
    ? ''
    : `<div class="mt-4 p-4 rounded-xl border text-sm ${L.poinPenaltiTotal > 0 ? 'bg-red-50 border-red-200' : 'bg-teal-50 border-teal-100'}">
        <b>${num(L.poinPenaltiTotal)} poin penalti</b> aktif periode ini.
        ${penaltiRows.length ? `<div class="mt-2">${tabel(['Pelanggaran', 'Durasi', 'Poin'], penaltiRows, ['l', 'l', 'r'])}</div>` : ''}</div>`;
  if (cards.length === 0 && !penaltiBlock) return mode === 'internal' ? kosong('Belum ada data layanan chat / kesehatan toko periode ini.') : '';
  return `${cards.length ? grid(cards) : ''}${penaltiBlock}`;
}

// ---------------------------------------------------------------------------
// Skor Performa — unnumbered, sits right after the header (mirrors `report/render.ts`)
// ---------------------------------------------------------------------------
function warnaSkor(s: number): string { return s >= 8 ? 'emerald' : s >= 6 ? 'amber' : 'red'; }

function seksiSkor(p: Laporan, mode: RenderMode): string {
  if (p.skor.total == null) {
    return mode === 'internal' ? kosong('Skor performa belum bisa dihitung — belum ada dimensi berdata periode ini.') : '';
  }
  const dims = p.skor.dimensi
    .filter((d) => mode === 'internal' || d.disertakan)
    .map((d) => {
      if (!d.disertakan) {
        // `d.labelTampil` ("data tidak tersedia") is the ONLY per-dimension note
        // the PDT payload carries (no `catatan` field — see file header). It is
        // internal-only: a client should never learn a dimension was excluded
        // from its own skor, only see a skor that already accounts for it.
        return `<div class="bg-slate-50 border border-slate-100 rounded-lg p-3">
          <div class="text-[0.7rem] font-semibold text-slate-500 uppercase tracking-wide">${esc(d.label)}</div>
          <div class="text-2xl font-bold text-slate-400 mt-1">${DASH}</div>
          <div class="text-[0.7rem] text-slate-500 mt-1"><span class="badge-int">INTERNAL</span> ${esc(d.labelTampil)}</div></div>`;
      }
      const w = warnaSkor(d.nilai as number);
      return `<div class="bg-${w}-50 border border-${w}-100 rounded-lg p-3">
        <div class="text-[0.7rem] font-semibold text-slate-500 uppercase tracking-wide">${esc(d.label)}</div>
        <div class="text-2xl font-bold text-${w}-700 mt-1">${dec(d.nilai, 1)}</div>
        <div class="text-[0.7rem] text-slate-500">${Math.round(d.bobotEfektif * 100)}% • kontrib ${dec((d.nilai as number) * d.bobotEfektif, 2)}</div></div>`;
    }).join('');
  return `<div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 md:p-6 mb-8">
  <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
    <div><h2 class="font-display text-lg md:text-xl font-bold text-slate-900">Skor Performa Keseluruhan</h2></div>
    <div class="flex items-center gap-4">${gauge(p.skor.total)}
      <div class="text-right"><div class="text-sm font-semibold text-${warnaSkor(p.skor.total)}-700">${esc(p.skor.label ?? '')}</div>
        <div class="text-xs text-slate-500 mt-0.5">${p.skor.dimensi.length} dimensi berbobot</div></div></div></div>
  <div class="grid grid-cols-2 md:grid-cols-6 gap-3">${dims}</div></div>`;
}

// ---------------------------------------------------------------------------
// Insight — SATU bentuk, KEDUA mode (R2.1: `insight` is clean prose since A-01)
// ---------------------------------------------------------------------------
function seksiInsightPoin(I: PdtLaporanInsight): string {
  if (!I.poin.length) return '';
  return `<div class="bg-white rounded-xl border border-slate-100 p-5 md:p-6"><ol class="space-y-3">${I.poin.map((t, i) => `<li class="flex gap-3"><span class="flex-shrink-0 w-6 h-6 bg-teal-100 text-teal-700 rounded-full flex items-center justify-center text-xs font-bold">${i + 1}</span><span class="text-sm">${esc(t)}</span></li>`).join('')}</ol></div>`;
}

function seksiRekomendasi(I: PdtLaporanInsight): string {
  if (!I.rekomendasiTinggi.length && !I.rekomendasiSedang.length) return '';
  return `${I.rekomendasiTinggi.length ? `<div class="mb-4"><h3 class="text-sm font-bold text-red-700 mb-2">Prioritas Tinggi</h3>
    <div class="grid md:grid-cols-2 gap-3">${I.rekomendasiTinggi.map((r) => rekCard(r, 'tinggi')).join('')}</div></div>` : ''}
  ${I.rekomendasiSedang.length ? `<div><h3 class="text-sm font-bold text-amber-700 mb-2">Prioritas Sedang</h3>
    <div class="grid md:grid-cols-2 gap-3">${I.rekomendasiSedang.map((r) => rekCard(r, 'sedang')).join('')}</div></div>` : ''}`;
}

function seksiOutlook(I: PdtLaporanInsight): string {
  return `<div class="bg-teal-50 border border-teal-100 rounded-xl p-5 md:p-6"><p class="text-slate-700 mb-4 text-sm">${esc(I.outlook)}</p>
  ${I.indikator.length ? grid(I.indikator.map((m) => kpi(m.nama, m.target))) : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Kelengkapan Data — M20 R2, `internal`-only, nol string dibangun di `klien`
// ---------------------------------------------------------------------------
const KELENGKAPAN_LABEL: Record<PdtKelengkapanBagian, string> = {
  kanal: 'Sumber GMV', iklan: 'Iklan', tahap: 'Perjalanan Pembeli',
};

function seksiKelengkapan(p: Laporan, mode: RenderMode): string {
  if (mode !== 'internal') return '';
  const K = p.kelengkapan;
  if (K.semuaLengkap) {
    return kartuInternal('Kelengkapan Data', 'Seluruh bagian laporan ini lengkap — tidak ada modul PDT yang belum menulis fakta untuk periode ini.', 'emerald', 'fa-shield-halved');
  }
  return K.baris.filter((b) => !b.lengkap).map((b) => {
    const modul = b.modulHilang.length ? `<div class="text-[0.65rem] text-slate-500 mt-1">Modul belum ada penulis fakta: ${b.modulHilang.map(esc).join(', ')}</div>` : '';
    return `<div class="mb-3">${kartuInternal(`Kelengkapan — ${KELENGKAPAN_LABEL[b.bagian]}`, `${esc(b.alasan)}${modul}`, 'amber', 'fa-triangle-exclamation')}</div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Assembly — section numbers assigned HERE, per mode (R2.4)
// ---------------------------------------------------------------------------
function bangunSeksi(p: Laporan, mode: RenderMode): [string, string, IconName][] {
  const seksi: [string, string, IconName][] = [];
  const add = (judul: string, html: string, ikon: IconName = 'fa-circle-dot'): void => { if (html) seksi.push([judul, html, ikon]); };

  add('Ringkasan Eksekutif', seksiRingkasan(p, mode), 'fa-chart-line');
  add('Tren Harian', seksiHarian(p, mode), 'fa-arrow-trend-up');

  // R3-equivalent: the buyer-journey reading comes first, TikTok-only —
  // Shopee's `tahap` is permanently `null` (see `laporan.ts`'s docblock).
  if (p.platform === 'tiktok' && p.tahap) {
    add('Perjalanan Pembeli', seksiFunnel(p.tahap, mode), 'fa-arrow-down-short-wide');
    for (const b of p.tahap.blok) {
      add(`Tahap — ${TAHAP_LABEL_ID[b.kode]}`, seksiTahapBlok(b, mode), TAHAP_IKON[b.kode]);
    }
  }

  add('Sumber GMV', seksiKanal(p, mode), 'fa-diagram-project');
  if (p.platform === 'tiktok') {
    add('Toko Tokopedia', seksiTokopedia(p, mode), 'fa-store');
  }
  add('Iklan', seksiIklan(p, mode), 'fa-bullseye');
  add('Rincian Kampanye', seksiKampanye(p, mode), 'fa-bullhorn');
  add('LIVE Performance', seksiLive(p, mode), 'fa-video');
  add('Rincian Sesi LIVE', seksiSesiLive(p, mode), 'fa-hourglass-half');
  add('Video Performance', seksiVideo(p, mode), 'fa-film');
  add('Matriks Produk', seksiProduk(p, mode), 'fa-table-cells-large');
  add('Affiliate', seksiAfiliasi(p, mode), 'fa-users');
  add('Rincian Kreator', seksiKreator(p, mode), 'fa-users');

  if (p.platform === 'shopee') {
    add('Voucher & Promo', seksiPromo(p, mode), 'fa-ticket');
    add('Layanan & Kesehatan Toko', seksiLayanan(p, mode), 'fa-shield-heart');
  }

  add('Key Insights', seksiInsightPoin(p.insight), 'fa-lightbulb');
  add('Rekomendasi & Action Plan', seksiRekomendasi(p.insight), 'fa-list-check');
  add('Outlook Periode Berikutnya', seksiOutlook(p.insight), 'fa-flag-checkered');
  add('Kelengkapan Data (Internal)', seksiKelengkapan(p, mode), 'fa-circle-info');

  return seksi;
}

const CHART_BOOT = `
(function(){
 var C=window.CHART_DATA||{},T='#0F766E',TL='rgba(15,118,110,.15)',O='#EA580C';
 function el(id){return document.getElementById(id);}
 if(typeof Chart==='undefined')return;
 if(el('c_harian')&&C.harian) new Chart(el('c_harian'),{type:'line',data:{labels:C.harian.labels,datasets:[
  {label:'GMV',data:C.harian.gmv,borderColor:T,backgroundColor:TL,fill:true,tension:.3,borderWidth:2,pointRadius:2},
  {label:'Pesanan',data:C.harian.pesanan,borderColor:O,fill:false,tension:.3,borderWidth:2,pointRadius:2,yAxisID:'y1'}]},
  options:{responsive:true,interaction:{intersect:false,mode:'index'},scales:{y1:{type:'linear',position:'right',grid:{drawOnChartArea:false}}}}});
 if(el('c_kanal')&&C.kanal) new Chart(el('c_kanal'),{type:'doughnut',data:{labels:C.kanal.labels,datasets:[{data:C.kanal.values,backgroundColor:[T,'#F59E0B','#3B82F6','#8B5CF6','#EC4899']}]},
  options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11}}}}}});
 if(el('c_iklan')&&C.iklan) new Chart(el('c_iklan'),{type:'bar',data:{labels:C.iklan.labels,datasets:[
  {label:'GMV',data:C.iklan.gmv,backgroundColor:T},{label:'Biaya',data:C.iklan.biaya,backgroundColor:O}]}});
})();`;

/** Chart bootstrap data. `null` per chart when its section has nothing to draw — mirrors `report/render.ts`'s `chartData`. */
function chartData(p: Laporan): Record<string, unknown> {
  const h = p.harian;
  const kn = p.kanal;
  const a = p.iklan;
  return {
    harian: h ? { labels: h.titik.map((t) => t.tanggal.slice(5)), gmv: h.titik.map((t) => t.gmv ?? 0), pesanan: h.titik.map((t) => t.pesanan ?? 0) } : null,
    kanal: kn.items.length ? { labels: kn.items.map((x) => x.label), values: kn.items.map((x) => x.gmv ?? 0) } : null,
    iklan: a && a.items.length ? { labels: a.items.map((x) => x.label), gmv: a.items.map((x) => x.gmv ?? 0), biaya: a.items.map((x) => x.biaya ?? 0) } : null,
  };
}

function renderBody(p: Laporan, mode: RenderMode): string {
  const seksi = bangunSeksi(p, mode);
  const body = seksi.map(([judul, html, ikon], i) =>
    `<section class="mb-8"><h2 class="font-display text-xl md:text-2xl font-bold text-slate-900 mb-4 flex items-center gap-3">
      <span class="sec-ico">${ikonSvg(ikon)}</span>${i + 1}. ${esc(judul)}</h2>${html}</section>`).join('');

  const platformLabel = p.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee';
  const head = `<div class="flex items-end justify-between mb-6 flex-wrap gap-4">
    <div><div class="flex items-center gap-3 flex-wrap"><h1 class="font-display text-2xl md:text-4xl font-bold tracking-tight text-slate-900">Monthly Report</h1>
      <div class="px-3 py-1 bg-slate-900 text-white text-xs font-bold rounded-full">${esc(p.periodeAwalBulan)}</div>
      ${mode === 'internal' ? '<div class="px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full">VERSI INTERNAL</div>' : ''}</div>
    <p class="text-base md:text-lg text-slate-600 mt-1">${esc(platformLabel)} — Performance &amp; Strategic Analysis</p></div></div>`;

  const kaki = `<div class="text-center text-xs text-slate-500 mt-8 pt-6 border-t border-slate-200">
    <p>Dibuat oleh <span class="font-semibold">MEA CDPS Report Engine (PDT)</span> • ${esc(p.periodeAwalBulan)}</p>
    <p class="mt-2 text-slate-400 text-[0.65rem]">${esc(ATRIBUSI_IKON)}</p></div>`;

  return head + seksiSkor(p, mode) + body + kaki;
}

/** A complete, self-contained HTML document — what the AM/client downloads or forwards. */
export function renderLaporanHtml(laporan: PdtLaporanTiktok | PdtLaporanShopee, mode: RenderMode): string {
  const platformLabel = laporan.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee';
  const judul = `Monthly Report — ${platformLabel} ${laporan.periodeAwalBulan}`;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(judul)}${mode === 'internal' ? ' — Internal' : ''}</title>
<style>${DOC_CSS}</style>
<script>${CHART_JS}</script></head>
<body data-mode="${mode}"><div class="max-w-screen-xl mx-auto px-4 md:px-6 py-8">
<div class="no-print flex justify-end mb-2">
  <button id="btnPdf" type="button" class="text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-100 rounded-full px-3 py-1.5">
    ${ikonSvg('fa-file-pdf', 'mr-1')} Unduh PDF (Ctrl+P)
  </button>
</div>
<div id="reportBody">${renderBody(laporan, mode)}</div></div>
<script>window.CHART_DATA=${jsonForScript(chartData(laporan))};</script>
<script>window.REPORT_PDF_NAME=${jsonForScript(namaBerkasLaporan(laporan, mode))};</script>
<script>${CHART_BOOT}</script>
<script>${PRINT_BOOT}</script></body></html>`;
}

/**
 * Download filename, derived server-side from the snapshot (B-03's future
 * caller needs this, not the client's browser). No human-readable client/store
 * name lives on `PdtLaporanTiktok`/`PdtLaporanShopee` (checked — the payload
 * carries only `clientPlatformId`, not a name field, unlike M14's
 * `payload.klien.toko`), so identity here is `clientPlatformId` + `periodeAwalBulan`
 * + `mode`, which is what the payload actually has to give.
 */
export function namaBerkasLaporan(laporan: PdtLaporanTiktok | PdtLaporanShopee, mode: RenderMode): string {
  const platform = laporan.platform === 'tiktok' ? 'TikTok' : 'Shopee';
  return `Laporan-PDT-${platform}-${laporan.clientPlatformId}-${laporan.periodeAwalBulan}-${mode}.html`;
}
