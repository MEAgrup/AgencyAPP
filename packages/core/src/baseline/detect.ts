/**
 * Baseline engine — file-type registry (12 signatures) + detect() (RAB-02).
 * Ported from the tool `TYPES` + `detect` (lines 423-498).
 *
 * ⛔ JANGAN ubah string nama kolom pada signature — itu satu-satunya cara file
 * dikenali.
 *
 * FIX #3 (handoff §2.2): pemisahan toko-vs-afiliasi TIDAK lagi memakai ambang
 * ajaib `u.size<=2`. Ia memakai daftar akun tertaut yang tercatat CDPS: file
 * "toko sendiri" hanya memuat akun milik klien; file "afiliasi" memuat kreator
 * luar. Bila CDPS tak punya daftar itu, jatuh ke heuristik lama TAPI ditandai
 * `ambiguous` supaya AM mengkonfirmasi (bukan ditebak diam-diam).
 */
import type { FileType, Sheet } from './types';

const has = (d: Pick<Sheet, 'cols'>, c: string): boolean => d.cols.includes(c);

interface TypeSpec {
  l: string;
  /** 1 = inti (wajib untuk baseline penuh), 0 = opsional. */
  req: 0 | 1;
  sig: (d: Sheet) => boolean;
}

export const TYPES: Record<FileType, TypeSpec> = {
  shop_tt: { l: 'Analitik Toko — TikTok', req: 1, sig: (d) => has(d, 'GMV') && has(d, 'GMV dari LIVE kreator') && has(d, 'Pengunjung') && !has(d, 'ID Produk') && !has(d, 'ID') },
  shop_tp: { l: 'Analitik Toko — Tokopedia', req: 0, sig: (d) => has(d, 'GMV') && has(d, 'Pendapatan bruto') && has(d, 'Pengunjung') && !has(d, 'GMV dari LIVE kreator') && !has(d, 'ID Produk') },
  prod_tt: { l: 'Analitik Produk — TikTok', req: 1, sig: (d) => has(d, 'ID Produk') && has(d, 'GMV dari kreator') && has(d, 'Klik produk') },
  prod_tp: { l: 'Analitik Produk — Tokopedia', req: 0, sig: (d) => has(d, 'GMV tab Toko') && has(d, 'GMV dari kartu produk') && has(d, 'Produk') },
  vid_toko: { l: 'Video — Toko Sendiri', req: 1, sig: (d) => has(d, 'Informasi Video') && has(d, 'GPM (Rp)') },
  vid_aff: { l: 'Video — Kreator Afiliasi', req: 1, sig: (d) => has(d, 'Informasi Video') && has(d, 'GPM (Rp)') },
  live_toko: { l: 'LIVE — Toko Sendiri', req: 1, sig: (d) => has(d, 'GMV dari LIVE (Rp)') && has(d, 'Waktu Live') },
  live_aff: { l: 'LIVE — Kreator Afiliasi', req: 1, sig: (d) => has(d, 'GMV dari LIVE (Rp)') && has(d, 'Waktu Live') },
  aff_kr: { l: 'Afiliasi — Daftar Kreator', req: 1, sig: (d) => has(d, 'Creator name') && has(d, 'GMV dari kreator') },
  aff_pr: { l: 'Afiliasi — Daftar Produk', req: 0, sig: (d) => has(d, 'Product name') && has(d, 'Video dengan penjualan') },
  ads_prod: { l: 'Ads Manager — Produk/GMV Max', req: 0, sig: (d) => has(d, 'Jenis materi iklan') && has(d, 'Nama kampanye') },
  ads_live: { l: 'Ads Manager — LIVE', req: 0, sig: (d) => has(d, 'Nama LIVE') && has(d, 'Tayangan LIVE') },
};

/** Recognised-but-not-yet-scored types (badge "diterima, belum dipakai"). */
export const UNUSED: FileType[] = ['prod_tp', 'aff_pr'];

export interface DetectOptions {
  /**
   * The client's OWN linked TikTok account names, from CDPS
   * (`client_platforms` / `qualified_forms`). A video/live file whose creators
   * are all own accounts is "toko sendiri"; external creators ⇒ "afiliasi".
   */
  linkedAccounts?: string[];
}

export interface DetectResult {
  type: FileType | null;
  /** True when own-vs-affiliate could not be decided from CDPS data — AM confirms. */
  ambiguous: boolean;
}

const uniqueCreators = (d: Sheet, col: string, alt?: string): Set<string> =>
  new Set(d.rows.map((r) => String((r[col] ?? (alt ? r[alt] : '')) || '').trim()).filter(Boolean));

/** Own-vs-affiliate from CDPS linked accounts (fix #3); falls back flagged-ambiguous. */
function ownVsAff(u: Set<string>, opts?: DetectOptions): { own: boolean; ambiguous: boolean } {
  const linked = opts?.linkedAccounts;
  if (linked && linked.length) {
    const linkedSet = new Set(linked.map((x) => x.trim()).filter(Boolean));
    const names = [...u];
    if (names.length === 0) return { own: true, ambiguous: true }; // no creators named → assume own, flag
    const allOwn = names.every((nm) => linkedSet.has(nm));
    const noneOwn = names.every((nm) => !linkedSet.has(nm));
    if (allOwn) return { own: true, ambiguous: false };
    if (noneOwn) return { own: false, ambiguous: false };
    return { own: false, ambiguous: true }; // mixed → treat as affiliate but ask AM
  }
  // No CDPS linked-account data: fall back to the old count heuristic, flagged.
  return { own: u.size <= 2, ambiguous: true };
}

/**
 * Classify a parsed sheet. vid_toko/vid_aff and live_toko/live_aff share a
 * signature; own-vs-affiliate is decided by `ownVsAff` (fix #3).
 */
export function detect(d: Sheet, opts?: DetectOptions): DetectResult {
  const cand = (Object.keys(TYPES) as FileType[]).filter((k) => TYPES[k].sig(d));
  if (!cand.length) return { type: null, ambiguous: false };
  if (cand.includes('vid_toko')) {
    const r = ownVsAff(uniqueCreators(d, 'Nama Kreator'), opts);
    return { type: r.own ? 'vid_toko' : 'vid_aff', ambiguous: r.ambiguous };
  }
  if (cand.includes('live_toko')) {
    const r = ownVsAff(uniqueCreators(d, 'Kreator', 'Nama panggilan'), opts);
    return { type: r.own ? 'live_toko' : 'live_aff', ambiguous: r.ambiguous };
  }
  return { type: cand[0], ambiguous: false };
}
