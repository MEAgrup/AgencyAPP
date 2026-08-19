/**
 * Report engine — the stored payload `cdps.report.tiktok.v1`.
 *
 * This object IS the report. The HTML is a rendering of it, the score the Health
 * module consumes is read from it, and it is what makes house rule #4 hold: every
 * derived number on a client's page can be recomputed from the payload plus the
 * benchmark version it records. Identity and `generated_at` are injected by the
 * caller (CDPS + the server's WIB clock), never taken from a browser.
 */
import { fx } from '../baseline/angka';
import { ALL_FILE_TYPES } from '../baseline/types';
import type { Insights } from './insight';
import type { ProdukRec, ReportMetrics } from './metrik';
import { ALL_KUADRAN } from './metrik';
import type { Skor } from './skor';
import { ALL_TTAM_TYPES, type PeriodeTipe, type ReportBench, type ReportFileType, type Rentang } from './types';

/** The current report-engine version, stamped on every stored report (#4). */
export const ENGINE_VERSI = 'cdps-report-v1';

export interface KlienIdentitas {
  nama: string | null;
  toko: string | null;
  platform: string;
  kategori: string | null;
  account_manager: string | null;
  store_link: string | null;
}

export interface PayloadOptions {
  klien: KlienIdentitas;
  /** ISO-8601 from the server (modul tz WIB), NOT a client clock. */
  generatedAt: string;
  periodeTipe: PeriodeTipe;
  rentang: Rentang;
  /** False when the range was not readable from the export and the nominal length was used. */
  rentangDariBerkas: boolean;
  net: boolean;
  /** The pro-rated benchmark the score actually used. */
  bench: ReportBench;
  /** The unscaled monthly benchmark it was derived from. */
  benchDasar: ReportBench;
  benchmarkVersi: number | null;
  slots: Partial<Record<ReportFileType, boolean>>;
}

const r = (v: number | null | undefined): number | null =>
  v == null || typeof v !== 'number' || !isFinite(v) ? null : Math.round(v);

const produkRingkas = (p: ProdukRec) => ({ nama: p.nama, id: p.id || null, gmv: r(p.gmv), klik: r(p.klik), cvr: fx(p.cvr, 5) });

const kuadranRingkas = (b: Record<string, ProdukRec[]>) =>
  Object.fromEntries(ALL_KUADRAN.map((q) => [q, {
    jumlah: (b[q] ?? []).length,
    gmv: r((b[q] ?? []).reduce((a, p) => a + p.gmv, 0)),
    produk: (b[q] ?? []).slice(0, 10).map(produkRingkas),
  }]));

export function buildReportPayload(M: ReportMetrics, sk: Skor, I: Insights, opts: PayloadOptions) {
  const k = M.kpi;
  return {
    schema: 'cdps.report.tiktok.v1' as const,
    engine_versi: ENGINE_VERSI,
    generated_at: opts.generatedAt,
    sumber: 'MEA CDPS Report Engine v1 — export TikTok Shop Seller Center & Ads Manager',
    klien: { ...opts.klien },
    periode: {
      tipe: opts.periodeTipe,
      mulai: opts.rentang.mulai,
      akhir: opts.rentang.akhir,
      hari: opts.rentang.hari,
      rentang_dari_berkas: opts.rentangDariBerkas,
      definisi_gmv: opts.net ? 'net' : 'gross',
    },
    kpi: {
      gmv: r(k.gmv), gmv_kotor: r(k.gmvKotor), refund: r(k.refund), refund_rate: fx(k.refundRate, 4),
      pesanan: r(k.pesanan), pembeli: r(k.pembeli), produk_terjual: r(k.terjual),
      pengunjung: r(k.pengunjung), cvr: fx(k.cvr, 5), aov: r(k.aov),
      impresi: r(k.impresi), klik: r(k.klik),
      perubahan: { gmv: k.mom.gmv, pengunjung: k.mom.pengunjung, pesanan: k.mom.pesanan, refund: k.mom.refund },
      harian: k.harian.map((d) => ({ tanggal: d.tanggal, gmv: r(d.gmv), pesanan: r(d.pesanan) })),
    },
    kanal: {
      gmv: r(M.kanal.gmv),
      items: M.kanal.items.map((x) => ({ key: x.key, label: x.label, nilai: r(x.nilai), persen: fx(x.persen, 4) })),
      detail: {
        live_toko: r(M.kanal.detail.live_toko), live_kreator: r(M.kanal.detail.live_kreator),
        video_toko: r(M.kanal.detail.video_toko), video_kreator: r(M.kanal.detail.video_kreator),
      },
    },
    iklan: M.ads
      ? {
          total: { biaya: r(M.ads.total.biaya), pendapatan: r(M.ads.total.rev), pesanan: r(M.ads.total.pesanan), roi: fx(M.ads.total.roi, 2), cpa: r(M.ads.total.cpa), aov: r(M.ads.total.aov), cpa_ratio: fx(M.ads.total.cpaRatio, 4) },
          live: { biaya: r(M.ads.live.biaya), pendapatan: r(M.ads.live.rev), pesanan: r(M.ads.live.pesanan), sesi: M.ads.live.sesi, roi: fx(M.ads.live.roi, 2), tayangan: r(M.ads.live.tayangan), tayangan_10s: r(M.ads.live.tayangan10s), hold_10s: fx(M.ads.live.hold10s, 4) },
          product: { biaya: r(M.ads.product.biaya), pendapatan: r(M.ads.product.rev), pesanan: r(M.ads.product.pesanan), materi: M.ads.product.baris, roi: fx(M.ads.product.roi, 2), impresi: r(M.ads.product.impresi), klik: r(M.ads.product.klik), ctr: fx(M.ads.product.ctr, 5), cvr: fx(M.ads.product.cvr, 5) },
          kampanye: M.ads.campaigns.map((c) => ({ kampanye: c.kampanye, biaya: r(c.biaya), pendapatan: r(c.rev), pesanan: r(c.pesanan), roi: fx(c.roi, 2), ctr: fx(c.ctr, 5), cvr: fx(c.cvr, 5) })),
          jenis_materi: M.ads.jenisMateri.map((j) => ({ jenis: j.jenis, materi: j.n, biaya: r(j.biaya), pendapatan: r(j.rev), pesanan: r(j.pesanan), roi: fx(j.roi, 2) })),
          top_kreatif: M.ads.topKreatif.map((x) => ({ judul: x.judul, akun: x.akun, jenis: x.jenis, biaya: r(x.biaya), pendapatan: r(x.rev), pesanan: r(x.pesanan), ctr: fx(x.ctr, 5), cvr: fx(x.cvr, 5) })),
          top_live: M.ads.topLive.map((x) => ({ nama: x.nama, waktu: x.waktu, biaya: r(x.biaya), pendapatan: r(x.rev), roi: fx(x.roi, 2), tayangan: r(x.tayangan) })),
          budget_terbakar: { materi: M.ads.burners.n, belanja: r(M.ads.burners.spend), persen_belanja: fx(M.ads.burners.pctSpend, 4) },
          live_tanpa_penjualan: { sesi: M.ads.liveNoSale.n, belanja: r(M.ads.liveNoSale.spend) },
        }
      : null,
    live: M.live
      ? {
          sesi: M.live.sesi, jam: fx(M.live.jam, 2), gmv: r(M.live.gmv),
          gmv_per_jam: r(M.live.gmvPerJam), gmv_per_sesi: r(M.live.gmvPerSesi), durasi_rata: fx(M.live.durasiRata, 2),
          penonton: r(M.live.penonton), tayangan: r(M.live.tayangan), klik_produk: r(M.live.klikProduk),
          produk_dilihat: r(M.live.produkDilihat), komentar: r(M.live.komentar), suka: r(M.live.suka),
          follower_baru: r(M.live.followerBaru), ctr: fx(M.live.ctr, 5),
          tanpa_penjualan: { sesi: M.live.nol.n, jam: fx(M.live.nol.jam, 2), persen: fx(M.live.nol.pct, 4) },
          per_hari: M.live.perHari.map((d) => ({ hari: d.hari, label: d.label, sesi: d.sesi, jam: fx(d.jam, 2), gmv: r(d.gmv), gmv_per_jam: r(d.gmvPerJam), gmv_per_sesi: r(d.gmvPerSesi) })),
          top_sesi: M.live.top.map((s) => ({ waktu: s.waktu, kreator: s.kreator, jam: fx(s.jam, 2), gmv: r(s.gmv), gmv_per_jam: r(s.gmvPerJam), penonton: r(s.penonton) })),
        }
      : null,
    video: M.video
      ? {
          total: M.video.total, toko: M.video.toko, afiliasi: M.video.afiliasi,
          ada_penjualan: M.video.adaPenjualan, sales_rate: fx(M.video.salesRate, 4),
          gmv: r(M.video.gmv), gmv_toko: r(M.video.gmvToko), gmv_afiliasi: r(M.video.gmvAfiliasi),
          vv: r(M.video.vv), vv_per_video: r(M.video.vvPerVideo),
          gpm: r(M.video.gpm), gpm_per_video: r(M.video.gpmPerVideo),
          likes: r(M.video.likes), komentar: r(M.video.komentar), dibagikan: r(M.video.dibagikan),
          klik_produk: r(M.video.klikProduk), klik_ke_live: r(M.video.klikKeLive),
          follower_baru: r(M.video.followerBaru), ctr: fx(M.video.ctr, 5),
          top_penjualan: M.video.topPenjualan.map((v) => ({ judul: v.judul, kreator: v.kreator, waktu: v.waktu, gmv: r(v.gmv), gpm: r(v.gpm), vv: r(v.vv), ctor: fx(v.ctor, 5), afiliasi: v.afiliasi })),
        }
      : null,
    produk: M.kuadran
      ? {
          relatif: kuadranRingkas(M.kuadran.relatif as unknown as Record<string, ProdukRec[]>),
          benchmark: kuadranRingkas(M.kuadran.benchmark as unknown as Record<string, ProdukRec[]>),
          ambang: {
            relatif: { klik_rendah: r(M.kuadran.ambang.relatif.klikRendah), klik_tinggi: r(M.kuadran.ambang.relatif.klikTinggi), cvr_rendah: fx(M.kuadran.ambang.relatif.cvrRendah, 5), cvr_tinggi: fx(M.kuadran.ambang.relatif.cvrTinggi, 5), produk_dinilai: M.kuadran.ambang.relatif.n },
            benchmark: { klik_rendah: r(M.kuadran.ambang.benchmark.klikRendah), klik_tinggi: r(M.kuadran.ambang.benchmark.klikTinggi), cvr_rendah: fx(M.kuadran.ambang.benchmark.cvrRendah, 5), cvr_tinggi: fx(M.kuadran.ambang.benchmark.cvrTinggi, 5), produk_dinilai: M.kuadran.ambang.benchmark.n },
          },
        }
      : null,
    afiliasi: M.affiliate
      ? {
          kreator_total: M.affiliate.total, kreator_produktif: M.affiliate.produktif, persen_produktif: fx(M.affiliate.pctProduktif, 4),
          kreator_posting: M.affiliate.posting, posting_tanpa_hasil: M.affiliate.nempel, pasif: M.affiliate.pasif,
          gmv: r(M.affiliate.gmv), refund: r(M.affiliate.refund), gmv_bersih: r(M.affiliate.netGmv), refund_rate: fx(M.affiliate.refundRate, 4),
          komisi: r(M.affiliate.komisi), roi_komisi: fx(M.affiliate.roiKomisi, 2),
          akun_sendiri_dikecualikan: M.affiliate.dikecualikan,
          top_kreator: M.affiliate.top.map((c) => ({ nama: c.nama, gmv: r(c.gmv), konten: r(c.konten), pesanan: r(c.pesanan) })),
          posting_tanpa_hasil_list: M.affiliate.nempelList.map((c) => ({ nama: c.nama, konten: r(c.konten), tayangan: r(c.tayangan) })),
          sampel: { kreator: M.affiliate.sampel.kreator, terkirim: r(M.affiliate.sampel.terkirim), gmv: r(M.affiliate.sampel.gmv), gmv_per_sampel: r(M.affiliate.sampel.gmvPerSampel) },
          live: M.affiliate.affLive ? { sesi: M.affiliate.affLive.sesi, jam: fx(M.affiliate.affLive.jam, 2), gmv: r(M.affiliate.affLive.gmv), gmv_per_jam: r(M.affiliate.affLive.gmvPerJam) } : null,
        }
      : null,
    tokopedia: M.tokped
      ? { gmv: r(M.tokped.gmv), pesanan: r(M.tokped.pesanan), pengunjung: r(M.tokped.pengunjung), cvr: fx(M.tokped.cvr, 5), produk_terjual: r(M.tokped.terjual), pembeli: r(M.tokped.pembeli), perubahan: M.tokped.mom }
      : null,
    ads_manager: M.ttam
      ? {
          berkas: M.ttam.berkas, total_belanja: r(M.ttam.totalSpend),
          consideration: M.ttam.consideration ? { ad_group: M.ttam.consideration.n, belanja: r(M.ttam.consideration.spend), impresi: r(M.ttam.consideration.impresi), reach: r(M.ttam.consideration.reach), klik: r(M.ttam.consideration.klik), audiens: r(M.ttam.consideration.size), biaya_per_audiens: r(M.ttam.consideration.costPer), rate: fx(M.ttam.consideration.rate, 5) } : null,
          follows: M.ttam.follows ? { ad_group: M.ttam.follows.n, belanja: r(M.ttam.follows.spend), impresi: r(M.ttam.follows.impresi), klik: r(M.ttam.follows.klik), follower: r(M.ttam.follows.follows), kunjungan_profil: r(M.ttam.follows.visits), biaya_per_follower: r(M.ttam.follows.costPer) } : null,
          showcase: M.ttam.showcase ? { ad_group: M.ttam.showcase.n, belanja: r(M.ttam.showcase.spend), impresi: r(M.ttam.showcase.impresi), reach: r(M.ttam.showcase.reach), klik: r(M.ttam.showcase.klik), video_views: r(M.ttam.showcase.videoViews), atc: r(M.ttam.showcase.atc), checkout: r(M.ttam.showcase.checkout), nilai_checkout: r(M.ttam.showcase.checkoutValue), ctr: fx(M.ttam.showcase.ctr, 5), biaya_per_checkout: r(M.ttam.showcase.costPerCheckout), biaya_per_atc: r(M.ttam.showcase.costPerAtc), nilai_per_belanja: fx(M.ttam.showcase.valuePerSpend, 2) } : null,
          videoviews: M.ttam.videoviews ? { materi: M.ttam.videoviews.n, belanja: r(M.ttam.videoviews.spend), impresi: r(M.ttam.videoviews.impresi), reach: r(M.ttam.videoviews.reach), views: r(M.ttam.videoviews.views), cpm: r(M.ttam.videoviews.cpm), biaya_per_1k_views: r(M.ttam.videoviews.costPer1k), view_rate: fx(M.ttam.videoviews.viewRate, 4), per_sumber: M.ttam.videoviews.perSumber.map((b) => ({ sumber: b.sumber, materi: b.n, belanja: r(b.spend), views: r(b.views), biaya_per_1k: r(b.costPer1k) })) } : null,
          // Guardrail: upper-funnel spend is optimised to reach/checkout, NOT to
          // completed orders. Folding it into the GMV Max ROI would make the
          // selling campaigns look worse than they are.
          catatan: 'belanja Ads Manager tidak dimasukkan ke perhitungan ROI GMV Max — kampanye ini dioptimasi ke jangkauan/checkout, bukan pesanan',
        }
      : null,
    skor: { total: sk.total, label: sk.label, dimensi: sk.dimensi.map((d) => ({ key: d.key, label: d.label, bobot: d.bobot, skor: d.skor, catatan: d.catatan })) },
    insight: {
      ringkasan: I.ringkasan,
      poin: I.poin,
      rekomendasi_tinggi: I.rekomendasiTinggi,
      rekomendasi_sedang: I.rekomendasiSedang,
      outlook: I.outlook,
      indikator: I.indikator,
    },
    benchmark_versi: opts.benchmarkVersi,
    benchmark_dipakai: { ...opts.bench },
    benchmark_dasar_bulanan: { ...opts.benchDasar },
    kelengkapan_file: Object.fromEntries(
      [...ALL_FILE_TYPES, ...ALL_TTAM_TYPES].map((t) => [t, !!opts.slots[t]]),
    ),
  };
}

export type ReportPayload = ReturnType<typeof buildReportPayload>;
