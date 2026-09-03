/**
 * TikTok Ads Scanner engine — SKU universe + video/ads aggregation.
 * Mirrors tool `analyze()` steps 1-4 (`docs/design/TIKTOK_ADS_SCANNER.html:481-586`).
 *
 * REQUIRED FIX applied here (porting brief §"null handling"): the tool reads
 * `ctr`/`ctor`/`aov` straight off `toNum()`, which returns 0 for a blank
 * cell — so a SKU with ZERO impressions (no traffic at all, not "0% CTR")
 * looked identical to one that genuinely converts nobody. That is exactly
 * the class of bug house rule #7 exists for ("division by zero renders `—`,
 * never an error" — the same principle extends to "no basis to measure"
 * generally). Here `ctr`/`ctor`/`aov` stay `null` when their denominator
 * (impresi/klik/pesanan) is 0, so `skor.ts` can exclude them from the score
 * (renormalizing the remaining weight, the same pattern as
 * `../../baseline/skor.ts`'s Pillar/Sub) instead of silently scoring them
 * as a worst-case zero, and `render.ts` shows `—` instead of `0,0%`.
 *
 * `adslive` is accepted here (tool `input.adslive`) purely for parity with
 * the tool's own file-slot contract — the tool NEVER reads it anywhere
 * inside `analyze()` either. This is carried over as-is (a faithful port of
 * dead-but-harmless input, not invented), flagged in the porting report for
 * a human call on whether Ads Live should eventually feed a score component.
 */
import { median } from '../../baseline/angka';
import { normId, pidFromProduk } from './id';
import { toNum } from './angka';
import type { AdsScannerConfig, OrphanSpend, Row, SkuResult, VideoKind, VideoRecord } from './types';

/** SKU fields available BEFORE scoring (tool `analyze()` steps 1-3) — the fields step 5 (`skor.ts`) still has to compute are omitted. `crGpmList` is metrik-only scratch, replaced by the computed `crGpm` median in the final `SkuResult`. */
export type SkuBase = Omit<
  SkuResult,
  'konten' | 'roi' | 'cpa' | 'crGpm' | 'gmvKreatorPct' | 'gate' | 'blockers' | 'skor' | 'skorRinci' | 'diagnosa' | 'bucket' | 'aksi' | 'budgetHarian' | 'scaleStep' | 'subMasalah' | 'bucketAudit'
> & { crGpmList: number[] };

export interface AdsScannerInput {
  analitik: Row[];
  ads: Row[];
  /** Accepted for parity with the tool's slot contract; not read by scoring — see module doc. */
  adslive: Row[];
  videos: { rows: Row[]; kind: VideoKind }[];
}

export interface Metrik {
  sku: SkuBase[];
  videos: VideoRecord[];
  orphan: OrphanSpend[];
  /** Median CTR among SKUs that actually had impressions (tool `medCtr`). */
  medCtr: number;
  /** Median CTOR among SKUs that actually had clicks (tool `medCtor`). */
  medCtor: number;
  /** 70th percentile GMV among SKUs with positive GMV — the "healthy SKU" reference (tool `gmvP70`). */
  gmvP70: number;
}

/** Step 1 — build the SKU universe from Analitik Produk. */
function buildSkuBase(analitik: Row[]): Map<string, SkuBase> {
  const sku = new Map<string, SkuBase>();
  for (const r of analitik) {
    const pid = normId(r['ID Produk']);
    if (!pid) continue;
    const gmv = toNum(r['GMV']);
    const impresi = toNum(r['Impresi produk']);
    const klik = toNum(r['Klik produk']);
    const pesanan = toNum(r['Pesanan SKU']);
    sku.set(pid, {
      pid,
      pidFull: String(r['ID Produk'] ?? '').trim(),
      nama: String(r['Nama'] ?? '').trim(),
      status: String(r['Status daftar produk'] ?? '').trim(),
      gmv,
      gmvKreator: toNum(r['GMV dari kreator']),
      gmvVideoToko: toNum(r['GMV dari video penjual']),
      gmvLiveToko: toNum(r['GMV dari LIVE penjual']),
      pesanan,
      aov: pesanan > 0 ? toNum(r['AOV (pesanan SKU)']) : null,
      ctr: impresi > 0 ? toNum(r['CTR']) : null,
      ctor: klik > 0 ? toNum(r['CTOR (pesanan SKU)']) : null,
      atc: toNum(r['Persentase tambahkan ke keranjang']),
      impresi,
      klik,
      crVid: 0,
      crUniq: 0,
      crVv: 0,
      crGmv: 0,
      crGpmList: [],
      shopVid: 0,
      shopVv: 0,
      shopGmv: 0,
      adCost: 0,
      adRev: 0,
      adOrders: 0,
      adCreatives: 0,
    });
  }
  return sku;
}

/** Step 2 — attach video content (kreator + toko), building the flat video list as a side effect. */
function attachVideos(sku: Map<string, SkuBase>, videos: { rows: Row[]; kind: VideoKind }[]): VideoRecord[] {
  const out: VideoRecord[] = [];
  const creatorsBySku = new Map<string, Set<string>>();
  for (const v of videos) {
    for (const r of v.rows) {
      const pid = pidFromProduk(r['Produk']);
      const vv = toNum(r['VV']);
      const gmv = toNum(r['GMV dari video (Rp)']);
      let gpmRaw = toNum(r['GPM (Rp)']);
      if (!gpmRaw && vv > 0) gpmRaw = (gmv / vv) * 1000;
      const gpm = vv > 0 ? gpmRaw : null;
      const kreator = String(r['Nama Kreator'] ?? '').trim();
      const videoId = String(r['ID Video'] ?? '').replace(/\D/g, '');
      const rec: VideoRecord = {
        pid,
        kind: v.kind,
        kreator,
        caption: String(r['Informasi Video'] ?? '').trim(),
        videoId,
        waktu: String(r['Waktu'] ?? '').trim(),
        vv,
        gmv,
        gpm,
        ctr: toNum(r['Rasio klik tayang (Video)']),
        finish: toNum(r['Persentase Video yang Ditonton Hingga Selesai']),
        produkNama: String(r['Produk'] ?? '').replace(/\(\d{10,}\)/, '').trim(),
        url: kreator && videoId ? `https://www.tiktok.com/@${kreator}/video/${videoId}` : '',
      };
      out.push(rec);
      if (!pid) continue;
      const s = sku.get(pid);
      if (!s) continue;
      if (v.kind === 'kreator') {
        s.crVid++;
        s.crVv += vv;
        s.crGmv += gmv;
        if (gpm != null && gpm > 0) s.crGpmList.push(gpm);
        let set = creatorsBySku.get(pid);
        if (!set) {
          set = new Set();
          creatorsBySku.set(pid, set);
        }
        set.add(String(r['ID Kreator'] ?? kreator));
      } else {
        s.shopVid++;
        s.shopVv += vv;
        s.shopGmv += gmv;
      }
    }
  }
  for (const [pid, set] of creatorsBySku) {
    const s = sku.get(pid);
    if (s) s.crUniq = set.size;
  }
  return out;
}

/**
 * Step 3 — attach ad spend/revenue; ad spend landing on an unrecognised
 * product ID becomes "SKU mati" (orphan). A row whose product ID does not
 * even parse (`normId` → null) is dropped entirely, matching the tool
 * verbatim (`if (!pid) return;` before the orphan branch) — an unparseable
 * ID has no key to file the spend under, in the tool or here.
 */
function attachAds(sku: Map<string, SkuBase>, ads: Row[]): OrphanSpend[] {
  const orphan = new Map<string, OrphanSpend>();
  for (const r of ads) {
    const pid = normId(r['ID produk']);
    if (!pid) continue;
    const cost = toNum(r['Biaya']);
    const rev = toNum(r['Pendapatan kotor']);
    const ord = toNum(r['Pesanan SKU']);
    const kampanye = String(r['Nama kampanye'] ?? '').trim();
    const s = sku.get(pid);
    if (s) {
      s.adCost += cost;
      s.adRev += rev;
      s.adOrders += ord;
      if (cost > 0) s.adCreatives++;
      continue;
    }
    if (cost <= 0) continue;
    let o = orphan.get(pid);
    if (!o) {
      o = { pid, cost: 0, rev: 0, creatives: 0, kampanye: [] };
      orphan.set(pid, o);
    }
    o.cost += cost;
    o.rev += rev;
    o.creatives++;
    if (!o.kampanye.includes(kampanye)) o.kampanye.push(kampanye);
  }
  return [...orphan.values()].sort((a, b) => b.cost - a.cost);
}

/** Step 4 — client-internal distribution stats (medians/percentile), used as the "relative to this client" reference in `skor.ts`. */
function distributionStats(sku: SkuBase[]): { medCtr: number; medCtor: number; gmvP70: number } {
  const ctrList = sku.filter((s) => s.ctr != null).map((s) => s.ctr as number);
  const ctorList = sku.filter((s) => s.ctor != null).map((s) => s.ctor as number);
  const gmvSorted = sku.map((s) => s.gmv).filter((x) => x > 0).sort((a, b) => a - b);
  const gmvP70 = gmvSorted.length ? gmvSorted[Math.floor(gmvSorted.length * 0.7)] : 0;
  return { medCtr: median(ctrList), medCtor: median(ctorList), gmvP70 };
}

export function computeMetrik(input: AdsScannerInput, cfg: Pick<AdsScannerConfig, 'blacklist'>): Metrik {
  const skuMap = buildSkuBase(input.analitik ?? []);
  const videos = attachVideos(skuMap, input.videos ?? []);
  const orphan = attachAds(skuMap, input.ads ?? []);
  const sku = [...skuMap.values()];
  const dist = distributionStats(sku);
  void cfg; // blacklist is consumed downstream in skor.ts (blocker check), kept here only to document the input contract shape.
  return { sku, videos, orphan, ...dist };
}

/** Fraction of `arr` that is `<= v` (tool `pctRank`) — a same-dataset percentile rank, used as the fallback efficiency signal. Exported for reuse by `skor.ts`. */
export function pctRank(arr: number[], v: number): number {
  if (!arr.length) return 0;
  return arr.filter((x) => x <= v).length / arr.length;
}
