/**
 * Pure helpers for "Perlu Persetujuan Saya" (`/persetujuan`).
 *
 * The page's job is no longer "here is a list, go somewhere else to decide" —
 * it decides in place. That only works if the approver can see WHAT they are
 * approving without leaving the row, and for the two money queues (negosiasi
 * sales, renewal/cross-sell) the fact the decision actually turns on is the one
 * nobody was showing: **dari harga berapa jadi berapa**.
 *
 * M0 §6 states it outright — "the Negotiation Detail Page shows lead info,
 * version number, **proposed vs. standard values per service**, and notes" —
 * so this is the PRD's own comparison, moved to where the decision is made.
 *
 * Standard price is NOT a stored property of the proposal: it lives in the
 * Master Service List snapshot (Qualified form) or the live MSL catalog. These
 * helpers only join and subtract; nothing here is authoritative. Money that
 * matters (commission, transaction totals) is still the server's.
 */

export interface PriceDelta {
  /** Harga standar (MSL / snapshot Qualified). null = tidak diketahui. */
  standard: number | null;
  /** Harga yang diajukan. null = tidak diketahui. */
  proposed: number | null;
  /** proposed − standard. Negatif = diskon, positif = markup. null bila salah satu sisi tidak diketahui. */
  delta: number | null;
  /** delta / standard × 100. null bila standard 0 atau tidak diketahui (house convention #7: bagi-nol = '—'). */
  percent: number | null;
  direction: 'diskon' | 'markup' | 'sama' | 'unknown';
}

/** Backend mengirim DECIMAL sebagai string ("9000000.00"); '' / null = tidak diketahui. */
function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

export function priceDelta(
  standard: string | number | null | undefined,
  proposed: string | number | null | undefined,
): PriceDelta {
  const s = toNumber(standard);
  const p = toNumber(proposed);
  if (s === null || p === null) {
    return { standard: s, proposed: p, delta: null, percent: null, direction: 'unknown' };
  }
  const delta = p - s;
  // Bagi nol tidak pernah melempar dan tidak pernah tampil sebagai angka (CLAUDE.md #7).
  const percent = s === 0 ? null : (delta / s) * 100;
  const direction = delta === 0 ? 'sama' : delta < 0 ? 'diskon' : 'markup';
  return { standard: s, proposed: p, delta, percent, direction };
}

/** "−12,5%" / "+8%" / "—". Persen negatif memakai tanda minus biasa agar mudah disalin. */
export function formatDeltaPercent(d: PriceDelta): string {
  if (d.percent === null) return '—';
  const rounded = Math.round(d.percent * 10) / 10;
  if (rounded === 0) return '0%';
  const sign = rounded > 0 ? '+' : '-';
  return `${sign}${Math.abs(rounded).toString().replace('.', ',')}%`;
}

/** Label ringkas untuk badge arah harga. */
export function deltaLabel(d: PriceDelta): string {
  switch (d.direction) {
    case 'diskon':
      return 'Diskon';
    case 'markup':
      return 'Markup';
    case 'sama':
      return 'Harga standar';
    default:
      return '—';
  }
}

/** Satu baris jasa yang diajukan, apa pun sumbernya (proposal sales / renewal). */
export interface ProposedLine {
  masterServiceId: string;
  /** Nama jasa bila sudah ikut di payload; kalau '' akan dicari di katalog. */
  name?: string;
  proposedPrice: string | number | null | undefined;
  /** Harga standar bila payload-nya sudah membawanya (snapshot Qualified). */
  standardPrice?: string | number | null | undefined;
  commissionRule?: string | null;
  paymentTerms?: string | null;
  quantity?: string | number | null;
}

/** Baris katalog seminimal yang dibutuhkan untuk melengkapi nama + harga standar. */
export interface CatalogEntry {
  id: string;
  name: string;
  standard_price: string;
}

export interface ComparedLine {
  masterServiceId: string;
  name: string;
  commissionRule: string;
  paymentTerms: string;
  /** Kuantitas dari snapshot Qualified; '' bila baris ini tidak membawanya. */
  quantity: string;
  delta: PriceDelta;
}

export interface Comparison {
  lines: ComparedLine[];
  totalStandard: number | null;
  totalProposed: number | null;
  /** totalProposed − totalStandard; null bila ada satu saja sisi standar yang tidak diketahui. */
  totalDelta: number | null;
  totalPercent: number | null;
}

/**
 * Gabungkan baris proposal dengan katalog menjadi tabel "standar → diajukan".
 *
 * Harga standar diambil dari baris proposal lebih dulu (snapshot yang MEMANG
 * berlaku saat penawaran dibuat) dan baru jatuh ke katalog hidup kalau snapshot
 * tidak ada — urutan sebaliknya akan menampilkan harga MSL hari ini sebagai
 * pembanding penawaran bulan lalu, yang membuat selisihnya bohong.
 *
 * Total standar sengaja `null` begitu SATU baris pun harga standarnya tidak
 * diketahui: total separuh terisi terbaca sebagai diskon besar yang tidak nyata.
 */
export function buildComparison(lines: ProposedLine[], catalog: CatalogEntry[]): Comparison {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const compared: ComparedLine[] = lines.map((l) => {
    const cat = byId.get(l.masterServiceId);
    const standard = l.standardPrice ?? cat?.standard_price ?? null;
    return {
      masterServiceId: l.masterServiceId,
      name: l.name || cat?.name || l.masterServiceId,
      commissionRule: l.commissionRule ?? '',
      paymentTerms: l.paymentTerms ?? '',
      quantity: l.quantity === null || l.quantity === undefined ? '' : String(l.quantity),
      delta: priceDelta(standard, l.proposedPrice),
    };
  });

  let totalStandard: number | null = 0;
  let totalProposed: number | null = 0;
  for (const c of compared) {
    if (c.delta.standard === null) totalStandard = null;
    else if (totalStandard !== null) totalStandard += c.delta.standard;
    if (c.delta.proposed === null) totalProposed = null;
    else if (totalProposed !== null) totalProposed += c.delta.proposed;
  }

  const total = priceDelta(totalStandard, totalProposed);
  return {
    lines: compared,
    totalStandard,
    totalProposed,
    totalDelta: total.delta,
    totalPercent: total.percent,
  };
}
