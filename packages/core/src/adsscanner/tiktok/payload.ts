/**
 * TikTok Ads Scanner engine — payload `cdps.adsscanner.tiktok.v1`.
 *
 * Perbedaan dari tool (semua sadar, mirrors `../../baseline/payload.ts` /
 * `../../report/payload.ts` doc convention):
 *  - client identity + `generated_at` are INJECTED by the caller (CDPS +
 *    modul tz WIB server), never the tool's own `new Date()` — required fix
 *    §4. The tool has no `generated_at` at all (it is a browser tool with no
 *    server storage); this field is new, added to match the house payload
 *    contract the other two engines already follow.
 *  - benchmark = the VERSIONED table + the specific category row used, with
 *    `benchmark_versi` recorded (required fix §1) — a re-run against the
 *    same `benchmark_versi` must reproduce the same score/bucket/realokasi.
 *  - the full `SkuResult[]` is stored (not the tool's own storage-trimmed
 *    `trimSku` subset) — this payload lives in Postgres, not
 *    size-constrained `localStorage`, so there is no reason to drop fields
 *    an auditor or a future insight might need.
 *  - `weekStart`/`periodeLabel` are still PURE date math over an
 *    AM-ENTERED ISO date (`opts.periode.weekStart`, "which week's export is
 *    this" — a real data-entry field, not a clock read) — ported faithfully
 *    from tool `weekStartMonday`/`formatPeriode`, just never calling
 *    `new Date()` with no argument.
 */
import type {
  AdsScannerBench, AdsScannerConfig, AdsScannerFileType, AngleRow, OrphanSpend, RealokasiRow, Ringkasan, SkuResult, TaggedVideo,
} from './types';
import type { VonisLabel } from './insight';

export const ADSSCANNER_PAYLOAD_SCHEMA = 'cdps.adsscanner.tiktok.v1' as const;

export interface KlienIdentitas {
  nama: string | null;
  /** Advertiser / AM who ran this scan (tool `state.advertiser` / `r.meta.pic`). */
  account_manager: string | null;
}

const IDMON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;

const isoOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday-align an AM-entered ISO date (tool `weekStartMonday`) — pure date math, no system clock. */
export function weekStartMonday(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const off = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - off);
  return d;
}

/** "6–12 Jan 2026" style label for the Monday-aligned week (tool `formatPeriode`). */
export function formatPeriode(iso: string | null | undefined): string | null {
  const s = weekStartMonday(iso);
  if (!s) return null;
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  const sd = s.getDate(), ed = e.getDate(), sm = IDMON[s.getMonth()], em = IDMON[e.getMonth()], sy = s.getFullYear(), ey = e.getFullYear();
  if (sy !== ey) return `${sd} ${sm} ${sy} – ${ed} ${em} ${ey}`;
  if (s.getMonth() !== e.getMonth()) return `${sd} ${sm} – ${ed} ${em} ${sy}`;
  return `${sd}–${ed} ${sm} ${sy}`;
}

export interface PeriodeOptions {
  /** AM-entered ISO date "somewhere in the data week" (tool `#periodeStart`). Null when not supplied. */
  weekStart: string | null;
}

export interface PayloadOptions {
  klien: KlienIdentitas;
  /** ISO-8601 from the server clock (modul tz WIB) — never a client `new Date()`. */
  generatedAt: string;
  cfg: AdsScannerConfig;
  /** The full versioned table this run scored against (recorded for audit — the category row actually used is `bench[cfg.category]`). */
  bench: AdsScannerBench;
  benchmarkVersi: number | null;
  periode: PeriodeOptions;
  /** Which of the 4 file slots were supplied for this run (tool `kelengkapan_file` equivalent). */
  slots: Partial<Record<AdsScannerFileType, boolean>>;
}

/** Flatten the per-SKU winner map to rows (tool `flattenWinners` — the tool's OWN storage layer already does this; ported here as-is). */
function flattenWinners(map: Map<string, TaggedVideo[]>): Array<{ pid: string; kind: TaggedVideo['kind']; kreator: string; angle: TaggedVideo['angle']; caption: string; url: string; gpm: number | null; vv: number; gmv: number; finish: number }> {
  const out: ReturnType<typeof flattenWinners> = [];
  for (const [pid, list] of map) {
    for (const v of list) {
      out.push({ pid, kind: v.kind, kreator: v.kreator, angle: v.angle, caption: v.caption, url: v.url, gpm: v.gpm, vv: v.vv, gmv: v.gmv, finish: v.finish });
    }
  }
  return out;
}

export interface AdsScannerPayload {
  schema: typeof ADSSCANNER_PAYLOAD_SCHEMA;
  generated_at: string;
  sumber: string;
  klien: KlienIdentitas & {
    kategori: string;
    periode_minggu: string | null;
    minggu_mulai: string | null;
  };
  konfigurasi: AdsScannerConfig;
  benchmark_versi: number | null;
  benchmark_kategori: { roi: number | null; tr: number | null; gpm: number | null };
  gpm_benchmark_rupiah: number;
  ringkasan: Ringkasan;
  flags: string[];
  vonis: { label: VonisLabel; cls: string };
  sku: SkuResult[];
  orphan: OrphanSpend[];
  realokasi: { pool: number; rows: RealokasiRow[] };
  angles: { kreator: AngleRow[]; toko: AngleRow[] };
  winners: ReturnType<typeof flattenWinners>;
  kelengkapan_file: Partial<Record<AdsScannerFileType, boolean>>;
}

export interface BuildPayloadInput {
  ringkasan: Ringkasan;
  flags: string[];
  vonis: { label: VonisLabel; cls: string };
  sku: SkuResult[];
  orphan: OrphanSpend[];
  realokasiPool: number;
  realokasi: RealokasiRow[];
  anglesKreator: AngleRow[];
  anglesToko: AngleRow[];
  perSkuWinners: Map<string, TaggedVideo[]>;
  gpmBm: number;
}

export function buildAdsScannerPayload(data: BuildPayloadInput, opts: PayloadOptions): AdsScannerPayload {
  const benchKat = opts.bench[opts.cfg.category] ?? { roi: null, tr: null, gpm: null };
  return {
    schema: ADSSCANNER_PAYLOAD_SCHEMA,
    generated_at: opts.generatedAt,
    sumber: 'MEA CDPS TikTok Ads Scanner — export TikTok Shop Seller Center (Analitik Produk, Ads Produk, Video Kreator/Toko, Ads Live)',
    klien: {
      nama: opts.klien.nama,
      account_manager: opts.klien.account_manager,
      kategori: opts.cfg.category,
      periode_minggu: formatPeriode(opts.periode.weekStart),
      minggu_mulai: (() => {
        const d = weekStartMonday(opts.periode.weekStart);
        return d ? isoOf(d) : null;
      })(),
    },
    konfigurasi: opts.cfg,
    benchmark_versi: opts.benchmarkVersi,
    benchmark_kategori: benchKat,
    gpm_benchmark_rupiah: data.gpmBm,
    ringkasan: data.ringkasan,
    flags: data.flags,
    vonis: data.vonis,
    sku: data.sku,
    orphan: data.orphan,
    realokasi: { pool: data.realokasiPool, rows: data.realokasi },
    angles: { kreator: data.anglesKreator, toko: data.anglesToko },
    winners: flattenWinners(data.perSkuWinners),
    kelengkapan_file: opts.slots,
  };
}
