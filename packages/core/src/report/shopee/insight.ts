/**
 * Shopee report engine — narrative insights, recommendations and outlook
 * (tool `ruleBasedInsights`).
 *
 * Reuses TikTok's `Insights` shape (`../insight.ts`) verbatim — same six
 * fields, same house money/percent formatting (`rp`/`pct`/`num` from
 * `baseline/angka.ts`, never the tool's own `fmtRp`/`fmtPct`). Keeping the
 * shape identical is what makes Wave 1's insight-editable layer and Client
 * Portal need ZERO changes for Shopee (plan §5).
 *
 * One deliberate DROP from the tool's own output, flagged rather than
 * silently folded in: the HTML returns a SEVENTH string, `perhatian_utama` (a
 * banner combining the score label + an active-penalty warning + a cancel-rate
 * warning + a live-streaming warning). Every one of those four facts is
 * ALREADY a field on the payload (`skor.total`/`label`, `kesehatan_toko.poin_total`,
 * the cancel rate, `zero_activity`) — it is not narrative judgement, it is a
 * banner computed FROM numbers already stored, so it is rendered straight
 * from the payload in `render.ts` (`seksiSkor`) instead of being invented here
 * as an eighth free-typed insight field that would break parity with
 * TikTok's `PayloadInsight` and need its own portal-side editor support.
 */
import { dec, num, pct, rp } from '../../baseline/angka';
import type { Insights } from '../insight';
import type { ShopeeMetrics } from './metrik';
import type { Skor } from './skor';

export function buildInsights(M: ShopeeMetrics, sk: Skor): Insights {
  const k = M.kpi_utama.pesanan_dibuat;
  const adsH = M.health.ads;
  const poin: string[] = [];
  const tinggi: Insights['rekomendasiTinggi'] = [];
  const sedang: Insights['rekomendasiSedang'] = [];

  const pesanan = k.pesanan ?? 0;
  const batal = k.batal_pesanan ?? 0;
  const cancel = pesanan ? batal / pesanan : null;
  const batalNilai = k.batal_nilai;

  // ── Kanal ────────────────────────────────────────────────────────────────
  const kanalArr = Object.entries(M.kanal.kanal).sort((a, b) => b[1].nilai - a[1].nilai);
  if (kanalArr.length) {
    const [nama, v] = kanalArr[0];
    poin.push(`${nama.replace(/_/g, ' ')} adalah kanal terbesar (${rp(v.nilai)}, ${pct(v.persen, 1)} dari GMV).`);
  }

  // ── Ads ──────────────────────────────────────────────────────────────────
  if (adsH?.roas != null) {
    const r = adsH.roas;
    if (r >= 4) poin.push(`ROAS ads Shopee ${dec(r, 2)}x — di atas benchmark sehat (4x).`);
    else if (r >= 2) poin.push(`ROAS ads Shopee ${dec(r, 2)}x — masih efisien tapi ada ruang optimasi.`);
    else poin.push(`ROAS ads Shopee ${dec(r, 2)}x — DI BAWAH BENCHMARK, perlu audit kampanye.`);
  }

  // ── Cancel / repeat ──────────────────────────────────────────────────────
  if (cancel != null && batal > 0) {
    const emoji = cancel > 0.10 ? '🚨' : cancel > 0.05 ? '⚠️' : '✓';
    poin.push(`${emoji} Cancel rate ${pct(cancel, 1)} (${num(batal)} pesanan, kerugian ${rp(batalNilai)}).${cancel > 0.10 ? ' Jauh di atas benchmark 5%.' : ''}`);
  }
  if (k.repeat_rate != null) {
    const rr = k.repeat_rate;
    poin.push(`Repeat rate ${pct(rr, 1)} — ${rr > 0.25 ? 'kuat' : rr > 0.15 ? 'moderat' : 'lemah, retensi perlu diperkuat'}.`);
  }

  // ── Portofolio produk ────────────────────────────────────────────────────
  const kb = M.kuadran?.mode_absolute ?? M.kuadran?.mode_relatif ?? null;
  const nB = kb?.bintang.length ?? 0, nH = kb?.hidden_gem.length ?? 0, nBc = kb?.bocor_traffic.length ?? 0;
  const nE = kb?.evaluasi.length ?? 0, nT = kb?.tidur.length ?? 0, nA = kb?.tidak_tayang.length ?? 0;
  if (kb) poin.push(`Portofolio produk (vs benchmark): ${nB} bintang, ${nH} hidden gem, ${nBc} bocor traffic, ${nE} evaluasi, ${nT} tidur, ${nA} tidak tayang.`);

  if (cancel != null && cancel > 0.08) {
    tinggi.push({ judul: 'Turunkan cancel rate', target: `Cancel rate <7% (saat ini ${pct(cancel, 1)})`, dampak: `Recover ${rp(batalNilai == null ? null : batalNilai * 0.6)} GMV/bulan`, timeline: '2 minggu' });
  }
  if (M.zero_activity.includes('bisnis_live')) {
    tinggi.push({ judul: 'Aktifkan Live Streaming', target: 'Minimum 3 sesi/minggu, fokus produk top', dampak: 'Potensi tambahan GMV bulanan — benchmark seller sejenis', timeline: 'Mulai minggu 1' });
  }
  if (nBc >= 2) {
    tinggi.push({ judul: 'Audit produk bocor traffic', target: `Perbaiki halaman produk ${nBc} produk (traffic tinggi, CR rendah)`, dampak: 'Setiap kenaikan CR di produk high-traffic langsung menambah GMV', timeline: '1-3 minggu' });
  }

  if (adsH?.acos != null && adsH.acos > 0.20) {
    sedang.push({ judul: 'Optimasi ACOS ads', target: `ACOS <20% (saat ini ${pct(adsH.acos, 1)})`, dampak: 'Hemat biaya iklan tanpa turunkan omzet', timeline: '1-2 minggu' });
  }
  const metaRoas = M.meta?.summary.roas as number | null | undefined;
  if (metaRoas != null && metaRoas < 2) {
    sedang.push({ judul: 'Review kampanye Meta CPAS', target: `ROAS Meta >2x (saat ini ${dec(metaRoas, 2)}x)`, dampak: 'Pause kampanye di bawah 1x, alokasi ke best performer', timeline: '1 minggu' });
  }
  const csat = M.health.chat?.csat ?? null;
  if (csat != null && csat < 0.85) {
    sedang.push({ judul: 'Perbaiki CSAT chat', target: `CSAT >85% (saat ini ${pct(csat, 1)})`, dampak: 'Kepuasan pembeli naik → repeat rate naik', timeline: '1 bulan' });
  }
  if (nH >= 2) {
    sedang.push({ judul: 'Scale produk Hidden Gem', target: `Naikkan traffic ${nH} produk (CR sudah bagus, tinggal expose)`, dampak: 'Konversi tinggi × traffic baru = GMV baru cepat', timeline: '1-2 minggu' });
  }

  // ── Kesehatan toko (paling mendesak — masuk paling depan) ───────────────
  const kt = M.kesehatan_toko;
  if (kt && kt.poin_total > 0) {
    const p0 = kt.penalti[0];
    poin.unshift(`🚨 ${num(kt.poin_total)} poin penalti aktif — ${p0?.deskripsi ?? 'pelanggaran kebijakan'} (${p0?.durasi ?? ''}). Traffic organik ditekan platform & toko dibatasi ikut promosi.`);
    tinggi.unshift({
      judul: 'Pulihkan kesehatan toko (penalti aktif)',
      target: '0 poin penalti — bereskan penyebab pelanggaran & cegah pelanggaran baru',
      dampak: 'Traffic organik & akses promosi Shopee (flash sale, voucher, campaign) pulih setelah masa penalti berakhir',
      timeline: `Segera — penalti berlaku ${p0?.durasi || 's.d. akhir masa penalti'}`,
    });
  }

  // ── Shopee Video ─────────────────────────────────────────────────────────
  if (M.video?.has_activity) {
    const v = M.video.summary;
    poin.push(`Shopee Video menyumbang ${rp(v.penjualan_dibuat)} GMV dari ${num(v.pesanan_dibuat)} pesanan — ${num(v.ditonton)} tayangan, CTR ${pct(v.ctr)}, ${num(v.atc)} add-to-cart.`);
    if ((v.ditonton ?? 0) < 5000) {
      sedang.push({ judul: 'Scale produksi Shopee Video', target: 'Rutin 3-5 video/minggu dengan produk ter-tag di semua video', dampak: 'Tayangan naik → traffic gratis → GMV video naik proporsional (CR video sudah terbukti)', timeline: 'Mulai minggu 1' });
    }
  } else if (M.zero_activity.includes('bisnis_video')) {
    sedang.push({ judul: 'Aktifkan Shopee Video', target: 'Minimal 3 video/minggu dengan produk ter-tag', dampak: 'Kanal traffic gratis — benchmark seller sejenis GMV tambahan', timeline: 'Mulai minggu 1' });
  }

  // ── Ads Live / Banner ────────────────────────────────────────────────────
  if (M.ads.live.length) {
    const lo = M.ads.live.reduce((a, i) => a + (i.omzet ?? 0), 0), lb = M.ads.live.reduce((a, i) => a + (i.biaya ?? 0), 0);
    const lr = lb ? lo / lb : 0;
    poin.push(`Iklan Live: omzet ${rp(lo)} dengan biaya ${rp(lb)} (ROAS ${dec(lr, 2)}x).`);
    if (lr < 2) {
      tinggi.push({ judul: 'Evaluasi Iklan Live (ROAS rendah)', target: `ROAS Iklan Live >2x (saat ini ${dec(lr, 2)}x)`, dampak: 'Stop bakar budget — perbaiki kualitas live (host, jam tayang, produk unggulan) sebelum scale iklan', timeline: '1-2 minggu' });
    }
  }
  if (M.ads.banner.length) {
    const bo = M.ads.banner.reduce((a, i) => a + (i.omzet ?? 0), 0), bb = M.ads.banner.reduce((a, i) => a + (i.biaya ?? 0), 0);
    if (bb > 0) poin.push(`Search Brand Ads (Banner): omzet ${rp(bo)} dengan biaya ${rp(bb)} (ROAS ${dec(bb ? bo / bb : 0, 2)}x).`);
  }

  // ── Outlook + leading metrics ────────────────────────────────────────────
  const gmv = k.gmv ?? 0;
  const outlook = `Target GMV bulan depan: ${rp(gmv * 1.15)}–${rp(gmv * 1.30)} (+15–30% dari ${rp(k.gmv)}). Fokus: eksekusi rekomendasi prioritas tinggi + scale kanal terbaik. Jaga cancel rate <7% dan ROAS ads >5x.`;
  const peng = k.pengunjung ?? 0;
  const indikator = [
    { nama: 'Target Pengunjung Toko', target: `${num(Math.round(peng * 1.35))} (+35%)` },
    { nama: 'Target CR Toko', target: `${pct((k.cr ?? 0) + 0.01, 2)} (saat ini ${pct(k.cr)})` },
    { nama: 'Target ROAS Ads', target: `>${dec(Math.max(6, (adsH?.roas ?? 5) + 0.5), 1)}x` },
    { nama: 'Target Cancel Rate', target: '<7%' },
  ];

  const ringkasan = `GMV bulan ini ${rp(k.gmv)} dari ${num(k.pesanan)} pesanan (${num(k.pembeli)} pembeli, ${pct(k.repeat_rate)} repeat). Skor performa keseluruhan ${dec(sk.total, 1)}/10 — ${sk.label}.`;

  return { ringkasan, poin, rekomendasiTinggi: tinggi, rekomendasiSedang: sedang, outlook, indikator };
}
