/**
 * Shopee report engine — the stored payload `cdps.report.shopee.v1`.
 *
 * Same contract as TikTok's `../payload.ts`: this object IS the report, every
 * derived number is recomputable from it plus `benchmark_versi`, and identity
 * + `generated_at` are injected by the caller (server WIB clock), never a
 * browser. `insight` is byte-for-byte the same SHAPE as TikTok's
 * `PayloadInsight` (see `../payload.ts`) — that identity is what lets Wave 1's
 * insight-editable layer and Client Portal render a Shopee report with zero
 * extra code.
 */
import { fx } from '../../baseline/angka';
import type { Insights } from '../insight';
import type { AdsItem, AdsLiveItem, AffItem, KesehatanToko, ProdukKuadranRec, ShopeeMetrics, VideoSumber } from './metrik';
import { ALL_KUADRAN_SHOPEE } from './metrik';
import type { Skor } from './skor';
import { ALL_SHOPEE_MODULES, type ShopeeBench, type ShopeeModule } from './types';

export const ENGINE_VERSI = 'cdps-report-shopee-v1';

export interface KlienIdentitasShopee {
  nama: string | null;
  toko: string | null;
  platform: string;
  kategori: string | null;
  account_manager: string | null;
  store_link: string | null;
}

export interface PayloadOptionsShopee {
  klien: KlienIdentitasShopee;
  /** ISO-8601 from the server (modul tz WIB), NOT a client clock. */
  generatedAt: string;
  /** Free-text period label (tool `periodName`, e.g. "Juni 2026") — Shopee's
   *  exports carry no machine-readable date range the way TikTok's do. */
  periode: string;
  bench: ShopeeBench;
  benchmarkVersi: number | null;
  slots: Partial<Record<ShopeeModule, boolean>>;
  /** Files rejected for carrying a different store identity (tool guardrail). */
  filesRejected: string[];
}

const r = (v: number | null | undefined): number | null =>
  v == null || typeof v !== 'number' || !isFinite(v) ? null : Math.round(v);

const produkRingkas = (p: ProdukKuadranRec) => ({ nama: p.nama_produk, kode: p.kode_produk, gmv: r(p.penjualan_dibuat), traffic: r(p.pengunjung_produk), cr: fx(p.cr_dipakai, 5) });

const kuadranRingkas = (b: Record<string, ProdukKuadranRec[]>) =>
  Object.fromEntries(ALL_KUADRAN_SHOPEE.map((q) => [q, {
    jumlah: (b[q] ?? []).length,
    gmv: r((b[q] ?? []).reduce((a, p) => a + (p.penjualan_dibuat ?? 0), 0)),
    produk: (b[q] ?? []).slice(0, 10).map(produkRingkas),
  }]));

const adsItemRingkas = (x: AdsItem) => ({ nama: x.nama, status: x.status, dilihat: r(x.dilihat), klik: r(x.klik), ctr: fx(x.ctr, 5), omzet: r(x.omzet), biaya: r(x.biaya), roas: fx(x.roas, 2), acos: fx(x.acos, 4), pesanan: r(x.pesanan), produk_terjual: r(x.produk_terjual) });
const adsLiveRingkas = (x: AdsLiveItem) => ({ nama: x.nama, status: x.status, penonton: r(x.penonton), pesanan: r(x.pesanan), cr: fx(x.cr, 5), omzet: r(x.omzet), biaya: r(x.biaya), roas: fx(x.roas, 2) });
const affRingkas = (x: AffItem) => ({ nama: x.nama, omzet: r(x.omzet), produk_terjual: r(x.produk_terjual), pesanan: r(x.pesanan), komisi: r(x.komisi), roi: fx(x.roi, 2) });
const videoSumberRingkas = (x: VideoSumber) => ({ label: x.label, ditonton: r(x.ditonton), penonton: r(x.penonton), penonton_efektif: r(x.penonton_efektif) });
const penaltiRingkas = (x: KesehatanToko['penalti'][number]) => ({ poin: x.poin, deskripsi: x.deskripsi, durasi: x.durasi });

export function buildShopeeReportPayload(M: ShopeeMetrics, sk: Skor, I: Insights, opts: PayloadOptionsShopee) {
  const k = M.kpi_utama.pesanan_dibuat;
  const s = M.kpi_utama.pesanan_siap_dikirim;
  const b = M.kpi_utama.pesanan_dibayar;
  const kanalArr = Object.entries(M.kanal.kanal).sort((a, b) => b[1].nilai - a[1].nilai);
  return {
    schema: 'cdps.report.shopee.v1' as const,
    engine_versi: ENGINE_VERSI,
    generated_at: opts.generatedAt,
    sumber: 'MEA CDPS Report Engine v1 — export Shopee Seller Centre & Ads Center',
    klien: { ...opts.klien },
    periode: {
      label: opts.periode,
      // `gross` describes `kpi.gmv` (orders CREATED) — unchanged, owner decision
      // SHP-1 keeps that as the headline. `gmv_bersih_sumber` says where the NET
      // figure came from, so a report built from an export WITHOUT the paid
      // section never silently presents gross as net.
      definisi_gmv: 'gross' as const,
      gmv_bersih_sumber: (b ? 'pesanan_dibayar' : 'tidak_tersedia') as 'pesanan_dibayar' | 'tidak_tersedia',
    },
    kpi: {
      gmv: r(k.gmv), pesanan: r(k.pesanan), aov: r(k.aov), pengunjung: r(k.pengunjung), cvr: fx(k.cr, 5),
      produk_diklik: r(k.produk_diklik), pembeli: r(k.pembeli), pembeli_baru: r(k.pembeli_baru), repeat_rate: fx(k.repeat_rate, 4),
      batal_pesanan: r(k.batal_pesanan), batal_nilai: r(k.batal_nilai), retur_pesanan: r(k.retur_pesanan), retur_nilai: r(k.retur_nilai),
      siap_kirim: { gmv: r(s.gmv), pesanan: r(s.pesanan), cvr: fx(s.cr, 5) },
      // SHP-1 — orders PAID. `null` when the export has no such section, which
      // is what `periode.gmv_bersih_sumber` reports; the renderer then says so
      // instead of printing the gross figure under a "bersih" label.
      dibayar: b ? { gmv: r(b.gmv), pesanan: r(b.pesanan), cvr: fx(b.cr, 5) } : null,
      harian: M.daily.map((d) => ({ tanggal: d.tanggal, gmv: r(d.nilai.penjualan), pesanan: r(d.nilai.pesanan) })),
    },
    kanal: { gmv: r(M.kanal.gmv_total), items: kanalArr.map(([nama, v]) => ({ nama, nilai: r(v.nilai), persen: fx(v.persen, 4) })) },
    kesehatan: {
      cr_toko: M.health.cr_toko ? { nilai: fx(M.health.cr_toko.nilai, 5), flag: M.health.cr_toko.flag } : null,
      ads: M.health.ads ? { spend: r(M.health.ads.spend), omzet: r(M.health.ads.omzet), roas: fx(M.health.ads.roas, 2), acos: fx(M.health.ads.acos, 4), ctr: fx(M.health.ads.ctr, 5), flag_roas: M.health.ads.flag_roas, flag_acos: M.health.ads.flag_acos, flag_ctr: M.health.ads.flag_ctr } : null,
      chat: M.health.chat ? {
        response_rate: fx(M.health.chat.response_rate, 4), flag_response_rate: M.health.chat.flag_response_rate,
        order_conversion: fx(M.health.chat.order_conversion, 4), order_conversion_pembeli: r(M.health.chat.order_conversion_pembeli), order_conversion_penanya: r(M.health.chat.order_conversion_penanya),
        flag_order_conversion: M.health.chat.flag_order_conversion, csat: fx(M.health.chat.csat, 4), flag_csat: M.health.chat.flag_csat,
        respon_detik: r(M.health.chat.respon_detik), flag_respon: M.health.chat.flag_respon,
      } : null,
      meta: M.health.meta ? { roas: fx(M.health.meta.roas, 2), flag_roas: M.health.meta.flag_roas } : null,
    },
    ads: {
      toko: M.ads.toko.map(adsItemRingkas), produk: M.ads.produk.map(adsItemRingkas),
      live: M.ads.live.map(adsLiveRingkas), banner: M.ads.banner.map(adsItemRingkas),
    },
    produk: M.kuadran
      ? {
          relatif: kuadranRingkas(M.kuadran.mode_relatif),
          benchmark: kuadranRingkas(M.kuadran.mode_absolute),
          ambang: {
            relatif: { traffic_rendah: r(M.kuadran.thresholds.relatif.trafficRendah), traffic_tinggi: r(M.kuadran.thresholds.relatif.trafficTinggi), cr_rendah: fx(M.kuadran.thresholds.relatif.crRendah, 5), cr_tinggi: fx(M.kuadran.thresholds.relatif.crTinggi, 5), produk_dinilai: M.kuadran.thresholds.relatif.n },
            benchmark: { traffic_rendah: r(M.kuadran.thresholds.absolute.trafficRendah), traffic_tinggi: r(M.kuadran.thresholds.absolute.trafficTinggi), cr_rendah: fx(M.kuadran.thresholds.absolute.crRendah, 5), cr_tinggi: fx(M.kuadran.thresholds.absolute.crTinggi, 5), produk_dinilai: M.kuadran.thresholds.absolute.n },
          },
        }
      : null,
    affiliasi: {
      total_omzet: r(M.affiliate.total_omzet), total_komisi: r(M.affiliate.total_komisi),
      total_creators: M.affiliate.total_creators, total_products: M.affiliate.total_products,
      top_products: M.affiliate.top_products.map(affRingkas), top_creators: M.affiliate.top_creators.map(affRingkas),
    },
    voucher: M.voucher ? { gmv: r(M.voucher.summary.penjualan_dibuat), biaya: r(M.voucher.summary.biaya_dibuat), klaim: r(M.voucher.summary.klaim), pesanan: r(M.voucher.summary.pesanan_dibuat), usage_rate: fx(M.voucher.summary.usage_dibuat, 4) } : null,
    meta: M.meta ? { roas: fx(M.meta.summary.roas as number | null, 2), spend: r(M.meta.summary.spend as number | null), purchase_value: r(M.meta.summary.purchase_value as number | null), clicks: r(M.meta.summary.clicks as number | null), impressions: r(M.meta.summary.impressions as number | null) } : null,
    video: M.video
      ? {
          has_activity: M.video.has_activity,
          gmv_dibuat: r(M.video.summary.penjualan_dibuat), gmv_siap: r(M.video.summary.penjualan_siap),
          pesanan_dibuat: r(M.video.summary.pesanan_dibuat), pesanan_siap: r(M.video.summary.pesanan_siap),
          ditonton: r(M.video.summary.ditonton), penonton: r(M.video.summary.penonton), penonton_efektif: r(M.video.summary.penonton_efektif),
          ctr: fx(M.video.summary.ctr, 5), atc: r(M.video.summary.atc), klik_produk: r(M.video.summary.klik_produk),
          suka: r(M.video.summary.suka), share: r(M.video.summary.share), komentar: r(M.video.summary.komentar),
          follower_baru: r(M.video.summary.follower_baru), completion: fx(M.video.summary.completion, 4),
          sumber: M.video.sumber.map(videoSumberRingkas),
        }
      : null,
    kesehatan_toko: M.kesehatan_toko ? { poin_total: M.kesehatan_toko.poin_total, penalti: M.kesehatan_toko.penalti.map(penaltiRingkas) } : null,
    zero_activity: M.zero_activity,
    files_rejected: opts.filesRejected,
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
    kelengkapan_file: Object.fromEntries(ALL_SHOPEE_MODULES.map((t) => [t, !!opts.slots[t]])),
  };
}

export type ShopeeReportPayload = ReturnType<typeof buildShopeeReportPayload>;

/**
 * The narrative half of the payload — same contract as TikTok's
 * `PayloadInsight` (`../payload.ts`), and structurally identical to it (both
 * are `{ ringkasan, poin, rekomendasi_tinggi, rekomendasi_sedang, outlook,
 * indikator }`). Declared as its own type rather than re-exporting TikTok's so
 * this module stays readable standalone, but the shapes must never diverge —
 * that identity is the whole point (plan §5: "insight editable Gelombang 1
 * langsung berlaku, nol pekerjaan tambahan").
 */
export type ShopeePayloadInsight = ShopeeReportPayload['insight'];
