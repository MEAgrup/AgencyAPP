/**
 * TikTok Ads Scanner engine — content-angle classifier, angle library,
 * account-level rollup ("ringkasan"), and health flags/verdict.
 * Mirrors tool `analyze()` steps 7-8 plus the `ANGLE_RULES`/`tagAngle`/
 * `hookOf`/`healthOf` helpers (`docs/design/TIKTOK_ADS_SCANNER.html:434-456,
 * 687-753, 991-997`).
 *
 * The 9-category regex classifier and the health-flag thresholds are
 * "genuinely new logic" per the porting brief — carried over FAITHFULLY,
 * not altered — with the null-safety/money fixes from `metrik.ts`/`skor.ts`
 * threaded through (`pctSpendKering`/`pctSpendKuat`/`videoBerGmvPct` are
 * `null`, never a misleading `0`, when their denominator is 0 — house rule
 * #7 — which in turn means every threshold check against them here is
 * explicitly null-guarded rather than relying on JS's `null > x → false`
 * coercion, both for TypeScript strictness and for a reader's sanity).
 *
 * `healthOf` (tool's per-client "vonis") is single-client-scoped — it reads
 * only this run's own `Ringkasan`+benchmark — so it is NOT part of the
 * disputed multi-client portfolio layer (`state.clients`, `localStorage`)
 * that this pass deliberately does not port; it is this report's own
 * account-health verdict, same as `../../baseline/skor.ts`'s `verdict`.
 */
import { median } from '../../baseline/angka';
import type { AdsScannerConfig, AngleRow, AngleTag, CategoryBench, OrphanSpend, Ringkasan, SkuResult, TaggedVideo, VideoKind, VideoRecord } from './types';

/** The 9 content-angle rules (tool `ANGLE_RULES`), tested in order — first match wins. */
export const ANGLE_RULES: readonly { tag: AngleTag; re: RegExp }[] = [
  { tag: 'Balas Komen', re: /membalas\s*@|balas\s*komen|reply/i },
  { tag: 'Problem–Solution', re: /flek|jerawat|kusam|rontok|bau|gatal|kering|berminyak|komedo|bruntusan|masalah|ampuh|atasi/i },
  { tag: 'Before–After', re: /sebelum|setelah|before|after|hari ke\s*\d|\d+\s*hari|progress|perubahan|hasil pemakaian/i },
  { tag: 'Review / Testimoni', re: /review|jujur|honest|testi|nyoba|coba(in)?|worth it|pengalaman|beneran/i },
  { tag: 'Edukasi / Tutorial', re: /cara|tips|tutorial|gimana|langkah|jangan sampai|kesalahan|panduan|hack/i },
  { tag: 'Unboxing / Paket', re: /unboxing|buka paket|paket datang|isi paket|hasil belanja/i },
  { tag: 'Promo / Hard-sell', re: /promo|diskon|murah|gratis|serbu|checkout|chekout|keranjang|racun|flash sale|cod|harga/i },
  { tag: 'Storytelling / POV', re: /\bpov\b|storytime|cerita|ternyata|akhirnya|kaget|nggak nyangka|gak nyangka/i },
  { tag: 'Showcase Produk', re: /warna|motif|model|varian|koleksi|ootd|outfit|style|lucu|gemas|cantik/i },
];

/** Classify one caption into a content angle (tool `tagAngle`). Hashtags are kept (many captions are hashtag-only) but the `#` is stripped so the words inside still match. */
export function tagAngle(caption: string | null | undefined): AngleTag {
  const s = String(caption ?? '');
  const basis = s.replace(/#/g, ' ');
  for (const r of ANGLE_RULES) if (r.re.test(basis)) return r.tag;
  return 'Belum Terklasifikasi';
}

/** Strip hashtags + collapse whitespace, for showing a caption as a "hook" (tool `hookOf`). */
export function hookOf(caption: string | null | undefined): string {
  return String(caption ?? '').replace(/#\w+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Tag every video with its content angle (`metrik.ts` deliberately leaves this undone — angle tagging is insight, not raw aggregation). */
export function tagVideos(videos: VideoRecord[]): TaggedVideo[] {
  return videos.map((v) => ({ ...v, angle: tagAngle(v.caption) }));
}

/**
 * The GMV-per-1000-views benchmark used to call a video a "winner" (tool
 * step 7 preamble). Prefers the category's own GPM benchmark (in USD,
 * converted at `cfg.usdRate`); when the category has none, falls back to
 * the `cfg.winnerPctl`-th percentile of this client's OWN videos with any
 * GMV — 0 when there is no basis at all (no videos with GMV/views).
 */
export function gpmBenchmark(videos: TaggedVideo[], bm: CategoryBench, cfg: Pick<AdsScannerConfig, 'usdRate' | 'winnerPctl'>): number {
  const vals = videos.filter((v) => v.gmv > 0 && (v.gpm ?? 0) > 0).map((v) => v.gpm as number).sort((a, b) => a - b);
  const pctl = vals.length ? vals[Math.floor(vals.length * cfg.winnerPctl)] : 0;
  return bm.gpm ? bm.gpm * cfg.usdRate : pctl;
}

/** Videos that clear the GPM benchmark (tool `winners`), best first. */
export function winnerVideos(videos: TaggedVideo[], gpmBm: number): TaggedVideo[] {
  return videos.filter((v) => v.gmv > 0 && (v.gpm ?? 0) >= gpmBm).sort((a, b) => (b.gpm ?? 0) - (a.gpm ?? 0));
}

/** Per-angle summary table for one video source (tool `angleTable`). */
export function angleTable(videos: TaggedVideo[], kind: VideoKind, gpmBm: number): AngleRow[] {
  interface Acc { angle: AngleTag; n: number; nWin: number; gmv: number; gpmList: number[]; vv: number; contoh: TaggedVideo[] }
  const map = new Map<AngleTag, Acc>();
  for (const v of videos.filter((x) => x.kind === kind)) {
    let m = map.get(v.angle);
    if (!m) {
      m = { angle: v.angle, n: 0, nWin: 0, gmv: 0, gpmList: [], vv: 0, contoh: [] };
      map.set(v.angle, m);
    }
    m.n++;
    m.gmv += v.gmv;
    m.vv += v.vv;
    if ((v.gpm ?? 0) > 0) m.gpmList.push(v.gpm as number);
    if (v.gmv > 0 && (v.gpm ?? 0) >= gpmBm) {
      m.nWin++;
      if (m.contoh.length < 3) m.contoh.push(v);
    }
  }
  return [...map.values()]
    .map((m) => ({
      angle: m.angle,
      jumlah: m.n,
      menang: m.nWin,
      winRate: m.n ? m.nWin / m.n : 0,
      gpmMedian: median(m.gpmList),
      gmv: m.gmv,
      vv: m.vv,
      lolosBenchmark: median(m.gpmList) >= gpmBm,
      contoh: m.contoh,
    }))
    .sort((a, b) => b.gmv - a.gmv);
}

/** Up to 10 winning videos per SKU, best GPM first (tool `perSkuWinners`). */
export function perSkuWinners(winners: TaggedVideo[]): Map<string, TaggedVideo[]> {
  const out = new Map<string, TaggedVideo[]>();
  for (const v of winners) {
    if (!v.pid) continue;
    const arr = out.get(v.pid) ?? [];
    if (arr.length < 10) arr.push(v);
    out.set(v.pid, arr);
  }
  return out;
}

export interface RingkasanInput {
  sku: SkuResult[];
  videos: TaggedVideo[];
  orphan: OrphanSpend[];
  bench: CategoryBench;
  category: string;
  /** From `skor.ts:realokasiPool` — computed once there, not re-derived here. */
  poolRealokasi: number;
  medCtr: number;
  medCtor: number;
}

/** Step 8 — account-level rollup (tool `ringkasan`), with the div-by-zero → `null` fix (house rule #7) applied to every ratio. */
export function buildRingkasan(input: RingkasanInput): Ringkasan {
  const { sku, videos, orphan, bench, category, poolRealokasi, medCtr, medCtor } = input;
  const orphanTotal = orphan.reduce((a, o) => a + o.cost, 0);
  const totalSpend = sku.reduce((a, s) => a + s.adCost, 0) + orphanTotal;
  const totalRev = sku.reduce((a, s) => a + s.adRev, 0) + orphan.reduce((a, o) => a + o.rev, 0);
  const spendKering = sku.filter((s) => s.gate === 'KERING').reduce((a, s) => a + s.adCost, 0) + orphanTotal;
  const spendKuat = sku.filter((s) => s.gate === 'KUAT' || s.gate === 'CUKUP').reduce((a, s) => a + s.adCost, 0);
  const kreatorVideos = videos.filter((v) => v.kind === 'kreator');
  const tokoVideos = videos.filter((v) => v.kind === 'toko');

  return {
    kategori: category,
    benchmark: bench,
    skuTotal: sku.length,
    skuAktifGmv: sku.filter((s) => s.gmv > 0).length,
    skuSiap: sku.filter((s) => s.gate === 'KUAT' || s.gate === 'CUKUP').length,
    skuKering: sku.filter((s) => s.gate === 'KERING').length,
    totalGmv: sku.reduce((a, s) => a + s.gmv, 0),
    totalSpend,
    totalRev,
    blendedRoi: totalSpend > 0 ? totalRev / totalSpend : null,
    pctSpendKering: totalSpend > 0 ? spendKering / totalSpend : null,
    pctSpendKuat: totalSpend > 0 ? spendKuat / totalSpend : null,
    orphanSpend: orphanTotal,
    orphanSku: orphan.length,
    kontenKreator: kreatorVideos.length,
    kontenToko: tokoVideos.length,
    kreatorUnik: new Set(kreatorVideos.map((v) => v.kreator)).size,
    videoBerGmvPct: videos.length ? videos.filter((v) => v.gmv > 0).length / videos.length : null,
    poolRealokasi,
    medCtr,
    medCtor,
  };
}

/** Account health flags (tool step 8 `flags` array), ported faithfully — thresholds unchanged, only the null-guards are new (the source values can now legitimately be `null`). */
export function buildFlags(r: Ringkasan, cfg: Pick<AdsScannerConfig, 'gateYellow'>): string[] {
  const flags: string[] = [];
  if (r.pctSpendKering != null && r.pctSpendKering > 0.3) {
    flags.push(`${Math.round(r.pctSpendKering * 100)}% budget mengalir ke SKU konten kering (<${cfg.gateYellow} video). Ini pola klien gagal.`);
  }
  if (r.orphanSpend > 0) {
    flags.push(`Rp${Math.round(r.orphanSpend).toLocaleString('id-ID')} spend ke ${r.orphanSku} SKU yang tidak muncul di Analitik Produk — kemungkinan SKU mati/GMV nol.`);
  }
  if (r.benchmark.roi && r.blendedRoi !== null && r.blendedRoi < r.benchmark.roi) {
    flags.push(`ROI gabungan ${r.blendedRoi.toFixed(2)} di bawah benchmark kategori ${r.benchmark.roi}.`);
  }
  if (r.skuSiap === 0) {
    flags.push('Tidak ada SKU yang lolos gerbang konten. Prioritas: produksi konten, bukan naikkan budget.');
  }
  if (r.skuSiap >= 3 && r.pctSpendKuat != null && r.pctSpendKuat < 0.5) {
    flags.push(`Ada ${r.skuSiap} SKU siap tapi hanya ${Math.round(r.pctSpendKuat * 100)}% budget ke sana. Realokasi.`);
  }
  return flags;
}

export type VonisLabel = 'KRITIS' | 'RISIKO' | 'PERBAIKI' | 'SEHAT';

/** Account-level health verdict (tool `healthOf`). Single-client-scoped — see module doc. */
export function healthOf(r: Ringkasan): { label: VonisLabel; cls: 't-stop' | 't-hold' | 't-go' } {
  if (r.skuSiap === 0) return { label: 'KRITIS', cls: 't-stop' };
  if (r.pctSpendKering != null && r.pctSpendKering > 0.3) return { label: 'RISIKO', cls: 't-stop' };
  if (r.benchmark.roi && r.blendedRoi != null && r.blendedRoi < r.benchmark.roi) return { label: 'PERBAIKI', cls: 't-hold' };
  return { label: 'SEHAT', cls: 't-go' };
}

export interface AdsScannerInsight {
  anglesKreator: AngleRow[];
  anglesToko: AngleRow[];
  perSkuWinners: Map<string, TaggedVideo[]>;
  gpmBm: number;
  ringkasan: Ringkasan;
  flags: string[];
  vonis: { label: VonisLabel; cls: 't-stop' | 't-hold' | 't-go' };
}

export interface BuildInsightOptions {
  sku: SkuResult[];
  videosRaw: VideoRecord[];
  orphan: OrphanSpend[];
  bench: CategoryBench;
  cfg: AdsScannerConfig;
  poolRealokasi: number;
  medCtr: number;
  medCtor: number;
}

/** Orchestrator — angle-tags the videos, builds the angle library + winners + ringkasan + flags/vonis. */
export function buildInsight(opts: BuildInsightOptions): AdsScannerInsight {
  const videos = tagVideos(opts.videosRaw);
  const gpmBm = gpmBenchmark(videos, opts.bench, opts.cfg);
  const winners = winnerVideos(videos, gpmBm);
  const ringkasan = buildRingkasan({
    sku: opts.sku, videos, orphan: opts.orphan, bench: opts.bench, category: opts.cfg.category,
    poolRealokasi: opts.poolRealokasi, medCtr: opts.medCtr, medCtor: opts.medCtor,
  });
  return {
    anglesKreator: angleTable(videos, 'kreator', gpmBm),
    anglesToko: angleTable(videos, 'toko', gpmBm),
    perSkuWinners: perSkuWinners(winners),
    gpmBm,
    ringkasan,
    flags: buildFlags(ringkasan, opts.cfg),
    vonis: healthOf(ringkasan),
  };
}
