/**
 * Report engine — narrative insights, recommendations and outlook (tool `buildInsights`).
 *
 * Every string here is Bahasa Indonesia and client-facing. Two departures from
 * the tool:
 *  - money uses the house format `Rp. 1.234.567,00` (house rule #7) and a null
 *    renders `—`, never "Rp0" — an unknown number must not read as a zero one;
 *  - the period words are parameterised ("bulan lalu"/"minggu lalu"), because the
 *    same engine now writes both the weekly and the monthly report and hardcoded
 *    "bulan" on a weekly report is a lie the client would catch first.
 */
import { dec, pct, rp } from '../baseline/angka';
import type { ReportMetrics } from './metrik';
import type { Skor } from './skor';
import { ALL_TAHAP, TAHAP_LABEL, type TahapNarasi, type TahapReport } from './tahap';
import type { PeriodeTipe, Rekomendasi, ReportBench } from './types';

export interface Insights {
  ringkasan: string;
  poin: string[];
  rekomendasiTinggi: Rekomendasi[];
  rekomendasiSedang: Rekomendasi[];
  outlook: string;
  indikator: { nama: string; target: string }[];
  /** R3 — one paragraph per buyer-journey stage. Always three entries, in order. */
  tahapNarasi: TahapNarasi[];
}

interface Kata { lalu: string; depan: string; ini: string }

/** The period vocabulary — the only thing that differs between weekly and monthly prose. */
export function kataPeriode(tipe: PeriodeTipe): Kata {
  return tipe === 'mingguan'
    ? { lalu: 'minggu lalu', depan: 'minggu depan', ini: 'minggu ini' }
    : { lalu: 'bulan lalu', depan: 'bulan depan', ini: 'bulan ini' };
}

const num = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('id-ID');

export function buildInsights(M: ReportMetrics, sk: Skor, B: ReportBench, tipe: PeriodeTipe, T: TahapReport): Insights {
  const K = kataPeriode(tipe);
  const poin: string[] = [];
  const tinggi: Rekomendasi[] = [];
  const sedang: Rekomendasi[] = [];
  const k = M.kpi;

  // ── Toko ──────────────────────────────────────────────────────────────────
  if (k.mom.gmv != null) {
    poin.push(`GMV ${rp(k.gmv)} — ${k.mom.gmv >= 0 ? 'naik' : 'turun'} ${pct(Math.abs(k.mom.gmv), 1)} vs ${K.lalu}, dari ${num(k.pesanan)} pesanan (AOV ${rp(k.aov)}).`);
  } else {
    poin.push(`GMV ${rp(k.gmv)} dari ${num(k.pesanan)} pesanan (AOV ${rp(k.aov)}).`);
  }
  if (k.mom.pengunjung != null && k.mom.gmv != null && k.mom.pengunjung < 0 && k.mom.gmv > 0) {
    poin.push(`Pengunjung turun ${pct(Math.abs(k.mom.pengunjung), 1)} tapi GMV tetap naik — pertumbuhan ditopang konversi & AOV, bukan traffic baru. Ini rapuh: begitu konversi normalisasi, GMV ikut turun.`);
  }

  // ── Kanal ─────────────────────────────────────────────────────────────────
  const kanalTerukur = M.kanal.items.filter((x) => x.nilai != null);
  if (kanalTerukur.length) {
    const top = [...kanalTerukur].sort((a, b) => (b.nilai as number) - (a.nilai as number))[0];
    poin.push(`${top.label} jadi kanal terbesar: ${rp(top.nilai)} (${pct(top.persen, 1)} dari GMV).`);
    const kartu = M.kanal.items.find((x) => x.key === 'kartu');
    if (kartu && kartu.persen != null && kartu.persen > 0.25) {
      poin.push(`Kartu Produk & Shop Tab menyumbang ${pct(kartu.persen, 1)} GMV — traffic gratis yang sudah terbukti closing.`);
    }
  }

  // ── Iklan ─────────────────────────────────────────────────────────────────
  if (M.ads) {
    const A = M.ads, roi = A.total.roi ?? 0;
    poin.push(`GMV Max: belanja ${rp(A.total.biaya)} → pendapatan ${rp(A.total.rev)} (ROI ${dec(roi, 2)}x, CPA ${rp(A.total.cpa)} = ${pct(A.total.cpaRatio, 1)} dari AOV).`);
    if (A.burners.pctSpend != null && A.burners.pctSpend > 0.3) {
      poin.push(`${pct(A.burners.pctSpend, 0)} belanja product ads (${rp(A.burners.spend)}) habis di ${A.burners.n} materi yang nol pesanan.`);
      tinggi.push({
        judul: 'Matikan materi iklan nol pesanan',
        target: `Pangkas ${A.burners.n} materi tanpa pesanan`,
        dampak: `Hemat sampai ${rp(A.burners.spend)}/${tipe === 'mingguan' ? 'minggu' : 'bulan'} untuk dialihkan ke materi yang closing`,
        timeline: '2–3 hari',
      });
    }
    if (A.jenisMateri.length > 1) {
      const best = [...A.jenisMateri].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0))[0];
      poin.push(`Materi iklan paling efisien: ${best.jenis} (ROI ${dec(best.roi, 2)}x dari ${rp(best.biaya)} belanja).`);
    }
    if (roi < B.roi_gmvmax.warn) {
      tinggi.push({
        judul: 'Audit kampanye GMV Max',
        target: `ROI ≥${B.roi_gmvmax.good}x (saat ini ${dec(roi, 2)}x)`,
        dampak: 'Hentikan pendarahan budget, alihkan ke kampanye dengan ROI tertinggi',
        timeline: '1 minggu',
      });
    } else if (roi >= B.roi_gmvmax.good) {
      sedang.push({
        judul: 'Scaling budget bertahap',
        target: `Naikkan budget 20–30%/minggu selama ROI tetap ≥${B.roi_gmvmax.good}x`,
        dampak: `ROI ${dec(roi, 2)}x masih di atas ambang — ruang scale masih terbuka`,
        timeline: 'Mulai minggu 1',
      });
    }
  }

  // ── LIVE ──────────────────────────────────────────────────────────────────
  if (M.live) {
    const L = M.live;
    poin.push(`LIVE: ${L.sesi} sesi / ${dec(L.jam, 1)} jam → ${rp(L.gmv)} (${rp(L.gmvPerJam)}/jam, ${rp(L.gmvPerSesi)}/sesi).`);
    if (L.nol.pct != null && L.nol.pct > 0.4) {
      poin.push(`${L.nol.n} dari ${L.sesi} sesi LIVE (${pct(L.nol.pct, 0)}) nol penjualan — ${dec(L.nol.jam, 0)} jam siaran tanpa hasil.`);
    }
    const terukur = L.perHari.filter((d) => d.gmvPerJam != null);
    const best = [...terukur].sort((a, b) => (b.gmvPerJam as number) - (a.gmvPerJam as number))[0];
    const worst = [...terukur].filter((d) => d.sesi >= 3).sort((a, b) => (a.gmvPerJam as number) - (b.gmvPerJam as number))[0];
    if (best) {
      poin.push(`Hari LIVE terbaik: ${best.label} (${rp(best.gmvPerJam)}/jam dari ${best.sesi} sesi)${worst && worst.label !== best.label ? `, terlemah ${worst.label} (${rp(worst.gmvPerJam)}/jam)` : ''}.`);
    }
    if (L.gmvPerJam != null && L.gmvPerJam < B.gmv_per_jam_live.warn) {
      tinggi.push({
        judul: 'Naikkan produktivitas jam LIVE',
        target: `≥${rp(B.gmv_per_jam_live.warn)}/jam (saat ini ${rp(L.gmvPerJam)})`,
        dampak: 'Bukan tambah jam — perbaiki host, script closing, dan urutan produk unggulan',
        timeline: '2–4 minggu',
      });
    }
    if (L.nol.pct != null && L.nol.pct > 0.4 && best) {
      tinggi.push({
        judul: 'Realokasi jadwal LIVE',
        target: `Geser sesi dari hari terlemah ke ${best.label} & jam performa terbaik`,
        dampak: `${dec(L.nol.jam, 0)} jam ${K.ini} nol hasil — realokasi tanpa menambah biaya`,
        timeline: 'Mulai minggu 1',
      });
    }
  }

  // ── Video ─────────────────────────────────────────────────────────────────
  if (M.video) {
    const V = M.video;
    poin.push(`Video: ${V.adaPenjualan} dari ${V.total} video menghasilkan penjualan (${pct(V.salesRate, 1)}), total ${rp(V.gmv)} dari ${num(V.vv)} views.`);
    if (V.salesRate != null && V.salesRate < B.pct_video_sales.warn) {
      tinggi.push({
        judul: 'Perbaiki konversi konten video',
        target: `≥${pct(B.pct_video_sales.warn, 0)} video ada penjualan (saat ini ${pct(V.salesRate, 1)})`,
        dampak: 'Volume video sudah banyak tapi belum menjual — perbaiki hook, demo produk, dan tag produk di tiap video',
        timeline: '1 bulan',
      });
    }
    if (V.topPenjualan.length) {
      sedang.push({
        judul: 'Replikasi video yang terbukti jual',
        target: `Bedah ${Math.min(5, V.topPenjualan.length)} video ber-GMV tertinggi, buat 3–5 varian tiap minggu`,
        dampak: 'Pola yang sudah terbukti closing lebih murah direplikasi daripada mencari format baru',
        timeline: 'Mulai minggu 1',
      });
    }
  }

  // ── Produk ────────────────────────────────────────────────────────────────
  if (M.kuadran) {
    const b = M.kuadran.benchmark;
    poin.push(`Portofolio produk (vs benchmark): ${b.bintang.length} bintang, ${b.hidden_gem.length} hidden gem, ${b.bocor_traffic.length} bocor traffic, ${b.evaluasi.length} evaluasi, ${b.tidur.length} tidur.`);
    if (b.bocor_traffic.length) {
      const g = b.bocor_traffic.reduce((a, p) => a + p.gmv, 0);
      tinggi.push({
        judul: 'Benahi produk "Bocor Traffic"',
        target: `${b.bocor_traffic.length} produk ramai diklik tapi CVR di bawah ${pct(B.quad_cvr.good, 1)}`,
        dampak: `Produk ini sudah menghasilkan ${rp(g)} — tiap +0,5% CVR di sini langsung jadi GMV tambahan tanpa biaya traffic baru`,
        timeline: '2–3 minggu',
      });
    }
    if (b.hidden_gem.length) {
      sedang.push({
        judul: 'Dorong exposure "Hidden Gem"',
        target: `${b.hidden_gem.length} produk closing bagus tapi klik minim`,
        dampak: 'CVR sudah terbukti — tinggal disuntik traffic lewat iklan, LIVE, atau kreator',
        timeline: '1–2 minggu',
      });
    }
    if (!b.bintang.length) {
      poin.push('Belum ada produk "Bintang" — tidak ada SKU yang traffic tinggi DAN closing tinggi sekaligus. Prioritas: naikkan CVR produk high-traffic.');
    }
  }

  // ── Affiliate ─────────────────────────────────────────────────────────────
  if (M.affiliate) {
    const A = M.affiliate;
    poin.push(`Affiliate: ${A.produktif} dari ${A.total} kreator menghasilkan penjualan (${pct(A.pctProduktif, 1)}), GMV ${rp(A.gmv)}${A.netGmv != null && A.refund ? ` (bersih ${rp(A.netGmv)} setelah refund)` : ''}.`);
    if (A.refundRate != null && A.refundRate > 0.3) {
      poin.push(`${pct(A.refundRate, 0)} GMV affiliate (${rp(A.refund)}) berakhir refund — GMV bersih hanya ${rp(A.netGmv)}. Cek kualitas closing kreator & ekspektasi produk.`);
    }
    if (A.nempel) {
      poin.push(`${A.nempel} kreator posting konten tapi nol penjualan; ${A.pasif} kreator terdaftar tapi tidak pernah posting.`);
    }
    if (A.affLive && A.affLive.sesi > 0 && !(A.affLive.gmv > 0)) {
      poin.push(`Affiliate LIVE: ${A.affLive.sesi} sesi / ${dec(A.affLive.jam, 1)} jam menghasilkan ${rp(0)} — sementara LIVE toko sendiri ${rp(M.live ? M.live.gmvPerJam : null)}/jam.`);
    }
    if (A.pctProduktif != null && A.pctProduktif < B.pct_kreator_produktif.warn) {
      tinggi.push({
        judul: 'Bersihkan & aktifkan pool kreator',
        target: `≥${pct(B.pct_kreator_produktif.good, 0)} kreator produktif (saat ini ${pct(A.pctProduktif, 1)})`,
        dampak: `${A.pasif} kreator pasif hanya jadi angka — fokuskan sampel & komisi ke kreator yang terbukti closing`,
        timeline: '1 bulan',
      });
    }
    if (A.sampel.terkirim > 0) {
      sedang.push({
        judul: 'Kunci ROI sampel',
        target: `${A.sampel.terkirim} sampel terkirim → ${rp(A.sampel.gmvPerSampel)} GMV per sampel`,
        dampak: 'Hentikan sampel ke kreator tanpa hasil, alihkan ke tier yang terbukti',
        timeline: '1 bulan',
      });
    }
  }

  const gmv = k.gmv;
  const outlook = `Target GMV ${K.depan}: ${rp(gmv * 1.15)}–${rp(gmv * 1.3)} (+15–30%). Fokus: eksekusi rekomendasi prioritas tinggi, jaga ROI GMV Max ≥${B.roi_gmvmax.good}x, dan naikkan CVR toko ke ${pct(B.cvr_toko.good, 1)}.`;

  const indikator = [
    { nama: 'Target CVR Toko', target: `${pct(Math.max(B.cvr_toko.warn, (k.cvr || 0) + 0.003), 2)} (kini ${pct(k.cvr, 2)})` },
    { nama: 'Target GMV/jam LIVE', target: `${rp(B.gmv_per_jam_live.warn)}+ (kini ${rp(M.live ? M.live.gmvPerJam : null)})` },
    { nama: 'Target % Video Jual', target: `${pct(B.pct_video_sales.warn, 0)}+ (kini ${pct(M.video ? M.video.salesRate : null, 1)})` },
    { nama: 'Target ROI GMV Max', target: `≥${B.roi_gmvmax.good}x (kini ${M.ads ? dec(M.ads.total.roi ?? 0, 2) + 'x' : '—'})` },
  ];

  const delta = k.mom.gmv != null ? ` (${k.mom.gmv >= 0 ? '+' : ''}${pct(k.mom.gmv, 2)} vs ${K.lalu})` : '';
  const ringkasan = `GMV ${rp(k.gmv)} dari ${num(k.pesanan)} pesanan dan ${num(k.pembeli)} pembeli${delta}. Skor performa ${dec(sk.total, 1)}/10 — ${sk.label}.`;

  return { ringkasan, poin, rekomendasiTinggi: tinggi, rekomendasiSedang: sedang, outlook, indikator, tahapNarasi: narasiTahap(T, K) };
}

/**
 * The machine's first draft of the per-stage prose — a starting point the AM
 * rewrites, not a verdict.
 *
 * It stays deliberately thin: it states what the stage's own numbers are, names
 * the one figure a reader would otherwise have to hunt for, and stops. Anything
 * richer would be the engine guessing at context it does not have (why the
 * budget was pointed where it was, what the client agreed to this period) — and
 * a confident-sounding wrong paragraph is harder for an AM to fix than an
 * obviously bare one. A stage with no numbers at all says so plainly rather
 * than filling the space.
 */
function narasiTahap(T: TahapReport, K: Kata): TahapNarasi[] {
  return ALL_TAHAP.map((key) => {
    const b = T.blok.find((x) => x.key === key);
    const terukur = (b?.metrik ?? []).filter((x) => x.nilai != null);
    const fokus = b?.fokus ? ` Tahap ini adalah fokus kerja ${K.ini}.` : '';
    const belanja = b?.belanja == null
      ? ''
      : ` Investasi media di tahap ini ${rp(b.belanja)}${b.belanjaPersen == null ? '' : ` (${pct(b.belanjaPersen, 1)} dari total)`}.`;
    const teks = terukur.length === 0
      ? `Belum ada angka yang bisa dibaca untuk tahap ini pada periode ini — berkas sumbernya belum diunggah.${fokus}`
      : `${terukur.length} metrik terbaca di tahap ini pada periode ini.${belanja}${fokus}`;
    return { tahap: key, judul: `Catatan tahap ${TAHAP_LABEL[key]}`, teks };
  });
}
