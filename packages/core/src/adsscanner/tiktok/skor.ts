/**
 * TikTok Ads Scanner engine — per-SKU score, content gate, decision bucket,
 * and budget-reallocation pool. Mirrors tool `analyze()` steps 5-6
 * (`docs/design/TIKTOK_ADS_SCANNER.html:588-685`).
 *
 * REQUIRED FIX (porting brief §"null handling"): the tool feeds `s.ctr`/
 * `s.ctor` straight into `pctRank()` for every SKU, including ones with
 * ZERO impressions/clicks (where `toNum()` had already silently turned
 * "no data" into `0`). Ranked against real CTR/CTOR values, a literal `0%`
 * lands at or near the bottom percentile — so a SKU nobody has shown an ad
 * to yet scored as if it were the WORST converter in the shop, dragging
 * down its "efficiency"/"CTR"/"CTOR" components (55% of the total weight)
 * for a reason that has nothing to do with performance.
 *
 * Fixed here the same way `../../baseline/skor.ts` handles a pillar with no
 * data: a component with no basis is EXCLUDED, and the SKU's score is the
 * weighted average of only the components that had data, renormalized
 * (`weightedAvg` below — the "5 scope-aware weighted pillars" pattern named
 * in the porting brief). `konten` and `gmv` are always computable (video
 * count and GMV are real zeros when a SKU has none, not "no data"), so a
 * SKU's score is NEVER fully unscoreable.
 *
 * This does NOT change bucket routing (`SCALE UP`/`BOROS`/etc.) — that
 * decision tree runs on `gate` (raw content-gate volume), `roi` (already
 * null-safe in the tool), `blockers`, and `adCost`, never on `s.skor` — so
 * the 6 routing rules are byte-for-byte the tool's own. Only `s.skor` (used
 * for in-bucket sort order and — see `realokasiPool` below — the
 * reallocation SPLIT) changes for SKUs missing traffic data.
 */
import { median } from '../../baseline/angka';
import { pctRank, type SkuBase } from './metrik';
import type { AdsScannerConfig, Bucket, CategoryBench, ContentGate, OrphanSpend, RealokasiRow, SkuResult } from './types';

export interface ScoreContext {
  ctrList: number[];
  ctorList: number[];
  gmvP70: number;
  medCtr: number;
  medCtor: number;
  bm: CategoryBench;
  cfg: AdsScannerConfig;
}

/** One weighted component: `null` value ⇒ excluded and the remaining weights renormalize (same contract as `baseline/skor.ts:Sub`). */
interface Weighted {
  v: number | null;
  w: number;
}

/**
 * Weighted average over only the non-null components (weights renormalized
 * to the AVAILABLE total, not the original 5-component total) — the exact
 * `../../baseline/skor.ts` pillar pattern (`pl.score = ok.reduce(...)/pl.w`).
 *
 * ⚠️ Do not "fix" this by also scaling the result by `haveW/totalW` — that
 * factor cancels out algebraically (`(Σv·w/haveW) · (haveW/totalW) =
 * Σv·w/totalW`), which is EXACTLY the naive "missing = 0" behaviour this
 * function exists to avoid. A missing component must be excluded from the
 * denominator too, not just from the numerator.
 */
function weightedAvg01(parts: Weighted[]): number {
  const have = parts.filter((p): p is { v: number; w: number } => p.v != null);
  if (!have.length) return 0;
  const haveW = have.reduce((a, p) => a + p.w, 0);
  return have.reduce((a, p) => a + p.v * p.w, 0) / haveW;
}

function contentGate(konten: number, cfg: Pick<AdsScannerConfig, 'gateScale' | 'gateConsider' | 'gateYellow'>): ContentGate {
  if (konten >= cfg.gateScale) return 'KUAT';
  if (konten >= cfg.gateConsider) return 'CUKUP';
  if (konten >= cfg.gateYellow) return 'TIPIS';
  return 'KERING';
}

function findBlockers(s: SkuBase, cfg: Pick<AdsScannerConfig, 'minAov' | 'blacklist'>): string[] {
  const blockers: string[] = [];
  // FIX (handoff docs/handoff/HANDOFF_LANJUT_SEMUA_BUILD_20260904.md §1.3):
  // the tool's own check was a bare `/aktif/i` substring test with no word
  // boundary, so "Nonaktif"/"Dinonaktifkan" (the NEGATED forms — they
  // contain the letters "aktif" too) read as ACTIVE and were never
  // blocked. `\b` anchors the match to the whole word "aktif" (still
  // matches "Aktif" / "Tidak Aktif"), so it stops misreading a negated
  // status without needing the full real TikTok status vocabulary
  // (still unverified against a real export — see handoff §1.2 UAT).
  if (s.status && !/\baktif\b/i.test(s.status)) blockers.push(`Produk tidak aktif (${s.status})`);
  if (cfg.minAov > 0 && s.aov != null && s.aov > 0 && s.aov < cfg.minAov) {
    blockers.push(`AOV Rp${Math.round(s.aov).toLocaleString('id-ID')} di bawah ambang Rp${cfg.minAov.toLocaleString('id-ID')}`);
  }
  if (cfg.blacklist.includes(s.pid)) blockers.push('Dikecualikan aturan klien (margin/komersial)');
  return blockers;
}

/** One of the 4 relative-diagnosis buckets (tool inline `diagnosa`/`subMasalah` logic), null-safe: a SKU with no CTR or CTOR data gets an explicit "no data" diagnosis rather than being silently classified as "SKU lemah". */
export type Diagnosa = 'ctr_sehat_konversi_bocor' | 'konversi_sehat_traffic_kurang' | 'sku_lemah' | 'sehat' | 'tanpa_data';

function diagnosaKey(ctr: number | null, ctor: number | null, medCtr: number, medCtor: number): Diagnosa {
  if (ctr == null && ctor == null) return 'tanpa_data';
  const ctrHi = ctr != null && ctr >= medCtr;
  const ctorHi = ctor != null && ctor >= medCtor;
  if (ctrHi && !ctorHi) return 'ctr_sehat_konversi_bocor';
  if (!ctrHi && ctorHi) return 'konversi_sehat_traffic_kurang';
  if (!ctrHi && !ctorHi) return 'sku_lemah';
  return 'sehat';
}

const DIAGNOSA_TEXT: Record<Diagnosa, string> = {
  ctr_sehat_konversi_bocor: 'CTR sehat, konversi bocor — cek harga, review, foto & deskripsi halaman produk',
  konversi_sehat_traffic_kurang: 'Konversi sehat, traffic kurang — kreatif/hook lemah, butuh angle baru',
  sku_lemah: 'CTR & konversi dua-duanya di bawah median toko — SKU lemah',
  sehat: 'CTR & konversi dua-duanya di atas median toko',
  tanpa_data: 'Belum ada data impresi/klik untuk SKU ini — belum bisa didiagnosis',
};

/** Score + gate + blockers + bucket/aksi/budgetHarian for one SKU (tool `analyze()` step 5, per-SKU body). */
export function scoreSku(s: SkuBase, ctx: ScoreContext): SkuResult {
  const { ctrList, ctorList, gmvP70, medCtr, medCtor, bm, cfg } = ctx;
  const konten = s.crVid + s.shopVid;
  const roi = s.adCost > 0 ? s.adRev / s.adCost : null;
  const cpa = s.adOrders > 0 ? s.adCost / s.adOrders : null;
  const crGpm = median(s.crGpmList);
  // Tool: `s.gmv > 0 ? s.gmvKreator / s.gmv : 0` — kept POSITIVE-strict (not just
  // non-zero) to match exactly; fix is null instead of 0 (house rule #7).
  const gmvKreatorPct = s.gmv > 0 ? s.gmvKreator / s.gmv : null;

  const gate = contentGate(konten, cfg);
  const blockers = findBlockers(s, cfg);

  // --- 5-component score (35/25/20/10/10), renormalized over available data ---
  const kontenScore = Math.min(1, Math.log10(1 + konten) / Math.log10(1 + cfg.gateScale));
  const gmvScore = gmvP70 > 0 ? Math.min(1, s.gmv / gmvP70) : null;
  const ctorPctRank = s.ctor == null ? null : pctRank(ctorList, s.ctor);
  const effScore = roi != null && bm.roi ? Math.min(1, roi / bm.roi) : ctorPctRank;
  const ctrScore = s.ctr == null ? null : pctRank(ctrList, s.ctr);
  const ctorScore = ctorPctRank;

  const skorFrac = weightedAvg01([
    { v: kontenScore, w: 0.35 },
    { v: gmvScore, w: 0.25 },
    { v: effScore, w: 0.2 },
    { v: ctrScore, w: 0.1 },
    { v: ctorScore, w: 0.1 },
  ]);
  const skor = Math.round(100 * skorFrac);
  const skorRinci = {
    konten: Math.round(35 * kontenScore),
    gmv: Math.round(25 * (gmvScore ?? 0)),
    efisiensi: Math.round(20 * (effScore ?? 0)),
    ctr: Math.round(10 * (ctrScore ?? 0)),
    ctor: Math.round(10 * (ctorScore ?? 0)),
  };

  const diagnosa = DIAGNOSA_TEXT[diagnosaKey(s.ctr, s.ctor, medCtr, medCtor)];

  const roiOk = roi != null && bm.roi ? roi >= bm.roi : null;
  let bucket: Bucket;
  let aksi: string;
  let budgetHarian: number;
  let scaleStep: number | undefined;
  let subMasalah: SkuResult['subMasalah'];

  if (blockers.length) {
    bucket = 'DIBLOKIR';
    aksi = 'Jangan pasang budget. Catat di laporan klien: ' + blockers.join('; ');
    budgetHarian = 0;
  } else if (gate === 'KERING' && s.adCost > 0) {
    bucket = 'BOROS';
    aksi = `Turunkan/stop. Hanya ${konten} konten (butuh min ${cfg.gateYellow}). Brief MCN/creative dulu; cek komisi vs benchmark ${bm.tr ? (bm.tr * 100).toFixed(0) + '%' : 'kategori'}.`;
    budgetHarian = 0;
  } else if (gate === 'KERING') {
    bucket = 'BANGUN KONTEN';
    aksi = `Belum layak diiklankan (${konten} konten). Target ${cfg.gateYellow}+ konten. Brief MCN/creative; naikkan komisi mendekati ${bm.tr ? (bm.tr * 100).toFixed(0) + '%' : 'benchmark'}.`;
    budgetHarian = 0;
  } else if (s.adCost <= 0) {
    bucket = 'STOK VIDEO CUKUP';
    aksi = `Sleeper — stok konten ${konten}, belum diiklankan. Mulai tes Rp${Math.round(cfg.testBudgetDaily).toLocaleString('id-ID')}/hari.`;
    budgetHarian = cfg.testBudgetDaily;
  } else if (roiOk) {
    const step = gate === 'KUAT' ? cfg.scaleStepPct : gate === 'CUKUP' ? cfg.scaleStepPct * 0.6 : cfg.scaleStepPct * 0.3;
    bucket = 'SCALE UP';
    scaleStep = step;
    const currentDaily = s.adCost / 7;
    budgetHarian = Math.max(cfg.testBudgetDaily, Math.round((currentDaily * (1 + step)) / 10000) * 10000);
    aksi = `ROI ${(roi as number).toFixed(2)} vs benchmark ${bm.roi}. Naikkan budget +${Math.round(step * 100)}% bertahap, evaluasi 3 hari.`
      + (gate === 'TIPIS' ? ` Stok konten baru ${konten} (kuning) — push konten paralel, jangan scale agresif.`
        : gate === 'CUKUP' ? ` Stok konten ${konten} cukup; jaga suplai konten agar tidak jenuh.` : '');
  } else {
    bucket = 'PERLU OPTIMASI';
    const diag = diagnosaKey(s.ctr, s.ctor, medCtr, medCtor);
    subMasalah = diag === 'ctr_sehat_konversi_bocor' ? 'Konversi bocor'
      : diag === 'konversi_sehat_traffic_kurang' ? 'Kreatif lemah'
        : diag === 'sku_lemah' ? 'SKU lemah'
          : 'Efisiensi bidding';
    aksi = `ROI ${roi == null ? '-' : roi.toFixed(2)} di bawah benchmark ${bm.roi ?? '-'}. ${diagnosa}.`;
    budgetHarian = Math.max(0, Math.round(s.adCost / 7 / 10000) * 10000);
  }

  const result: SkuResult = {
    ...s,
    konten,
    roi,
    cpa,
    crGpm,
    gmvKreatorPct,
    gate,
    blockers,
    skor,
    skorRinci,
    diagnosa,
    bucket,
    aksi,
    budgetHarian,
    scaleStep,
    subMasalah,
  };
  if (cfg.mode === 'newclient') {
    result.bucketAudit = gate === 'KERING' ? 'BELUM SIAP' : gate === 'TIPIS' ? 'HAMPIR SIAP' : 'SIAP DIIKLANKAN';
  }
  return result;
}

/** Score every SKU, building the CTR/CTOR reference lists once (tool step 4-5 boundary). */
export function scoreAll(sku: SkuBase[], bench: CategoryBench, cfg: AdsScannerConfig, medCtr: number, medCtor: number, gmvP70: number): SkuResult[] {
  const ctrList = sku.filter((s) => s.ctr != null).map((s) => s.ctr as number);
  const ctorList = sku.filter((s) => s.ctor != null).map((s) => s.ctor as number);
  const ctx: ScoreContext = { ctrList, ctorList, gmvP70, medCtr, medCtor, bm: bench, cfg };
  return sku.map((s) => scoreSku(s, ctx));
}

export interface RealokasiResult {
  pool: number;
  realokasi: RealokasiRow[];
}

/**
 * Step 6 — budget-reallocation pool. Take the ad spend sitting on SKUs that
 * should not be funded (`BOROS`/`DIBLOKIR`) plus spend that landed nowhere
 * recognisable ("SKU mati"), and propose splitting it across SKUs that ARE
 * ready (`SCALE UP`/`STOK VIDEO CUKUP`), weighted by their score, rounded to
 * the nearest Rp10.000. Ported verbatim (tool `analyze()` step 6).
 */
export function realokasiPool(sku: SkuResult[], orphan: OrphanSpend[]): RealokasiResult {
  const wasted = sku.filter((s) => s.bucket === 'BOROS' || s.bucket === 'DIBLOKIR').reduce((a, s) => a + s.adCost, 0);
  const orphanTotal = orphan.reduce((a, o) => a + o.cost, 0);
  const pool = wasted + orphanTotal;
  const targets = sku.filter((s) => s.bucket === 'SCALE UP' || s.bucket === 'STOK VIDEO CUKUP').sort((a, b) => b.skor - a.skor);
  const wsum = targets.reduce((a, s) => a + s.skor, 0) || 1;
  const realokasi: RealokasiRow[] = targets.map((s) => ({
    pid: s.pidFull,
    nama: s.nama,
    bucket: s.bucket,
    skor: s.skor,
    tambahan: Math.round((pool * (s.skor / wsum)) / 10000) * 10000,
  }));
  return { pool, realokasi };
}
