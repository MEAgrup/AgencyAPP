/**
 * Report engine — validation & normalisation of a HUMAN-EDITED insight.
 *
 * The report's numbers are immutable (`client_reports.payload`, frozen trigger,
 * house rule #3/#4). Its NARRATIVE is not: the AM rewrites the executive
 * summary, the key insights, the recommendations and the outlook before the
 * client reads them. This module is the gate that edited prose passes through.
 *
 * Why it lives in core and not in the route handler:
 *  - the same limits must hold for the API, for a future import, and for any
 *    test — one copy, not three;
 *  - it is pure, so every boundary and every `[...]` message is unit-testable
 *    without a database.
 *
 * What it deliberately does NOT do:
 *  - it never invents text. An empty required field is a `[...]` refusal, not a
 *    silent fallback to the engine's sentence — a client must never be shown a
 *    generated line the AM believed they had replaced.
 *  - it never strips or rewrites the author's words beyond trimming. Escaping is
 *    the renderer's job (`esc()` on every interpolation); this is the second
 *    layer that refuses angle brackets outright, so a stored revision can never
 *    carry markup even if a future renderer forgets to escape.
 */
import type { PayloadInsight } from './payload';
import { isTahapKey, TAHAP_LABEL, type TahapNarasi } from './tahap';
import type { Rekomendasi } from './types';

/** Per-field character ceilings. Generous for prose, hard enough to bound a row. */
export const INSIGHT_MAX = {
  ringkasan: 1200,
  poin: 400,
  outlook: 1200,
  rekJudul: 120,
  rekTarget: 240,
  rekDampak: 300,
  rekTimeline: 60,
  indNama: 80,
  indTarget: 120,
  tahapJudul: 120,
  tahapTeks: 2000,
} as const;

/** List-length ceilings. A report with 40 "key" insights has none. */
export const INSIGHT_MAX_POIN = 15;
export const INSIGHT_MAX_REK = 8;
export const INSIGHT_MAX_INDIKATOR = 8;
/**
 * One paragraph per stage, and only the three stages exist — so the ceiling is
 * the stage count itself. A fourth row is not "too many", it is a row whose
 * `tahap` key the renderer has nowhere to put; `MSG_TAHAP_TAK_DIKENAL` catches
 * that case with a message that says which value was wrong.
 */
export const INSIGHT_MAX_TAHAP = 3;

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5)
// ---------------------------------------------------------------------------
export const MSG_RINGKASAN_WAJIB = '[ringkasan eksekutif wajib diisi]';
export const MSG_OUTLOOK_WAJIB = '[outlook periode berikutnya wajib diisi]';
export const MSG_POIN_KOSONG = '[isi minimal satu poin key insight]';
export const MSG_POIN_TERLALU_BANYAK = `[maksimal ${INSIGHT_MAX_POIN} poin key insight]`;
export const MSG_REK_TERLALU_BANYAK = `[maksimal ${INSIGHT_MAX_REK} rekomendasi per prioritas]`;
export const MSG_INDIKATOR_TERLALU_BANYAK = `[maksimal ${INSIGHT_MAX_INDIKATOR} indikator]`;
export const MSG_REK_TAK_LENGKAP =
  '[setiap rekomendasi wajib punya judul, target, dampak, dan timeline]';
export const MSG_INDIKATOR_TAK_LENGKAP = '[setiap indikator wajib punya nama dan target]';
export const MSG_ADA_MARKUP =
  '[teks insight tidak boleh memuat tanda < atau > — tulis sebagai teks biasa]';
export const MSG_TAHAP_TAK_DIKENAL = '[tahap tidak dikenal — pilih Awareness, Consideration, atau Conversion]';
export const MSG_TAHAP_GANDA = '[setiap tahap hanya boleh punya satu narasi]';
export const MSG_TAHAP_TAK_LENGKAP = '[narasi tahap wajib punya judul dan teks]';

/** `[teks "…" melebihi N karakter]` — names the offending field, not just "too long". */
export function msgTerlaluPanjang(label: string, max: number): string {
  return `[teks ${label} melebihi ${max} karakter]`;
}

/**
 * The wire/UI shape of an insight draft. Every field optional and loosely typed
 * because it arrives from a form: validation is this module's job, not the
 * caller's, and a missing key must produce a `[...]` message rather than a
 * TypeError.
 */
export interface InsightDraft {
  ringkasan?: unknown;
  poin?: unknown;
  rekomendasi_tinggi?: unknown;
  rekomendasi_sedang?: unknown;
  outlook?: unknown;
  indikator?: unknown;
  tahap_narasi?: unknown;
}

/** Thrown with a BI `[...]` message; the API maps it to 400. */
export class InsightDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsightDraftError';
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function noMarkup(v: string): string {
  if (v.includes('<') || v.includes('>')) throw new InsightDraftError(MSG_ADA_MARKUP);
  return v;
}

function bounded(v: string, max: number, label: string): string {
  if (v.length > max) throw new InsightDraftError(msgTerlaluPanjang(label, max));
  return noMarkup(v);
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function normRekomendasi(rows: unknown[], prioritas: string): Rekomendasi[] {
  if (rows.length > INSIGHT_MAX_REK) throw new InsightDraftError(MSG_REK_TERLALU_BANYAK);
  const out: Rekomendasi[] = [];
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const judul = str(r.judul);
    const target = str(r.target);
    const dampak = str(r.dampak);
    const timeline = str(r.timeline);
    // A wholly blank card is the UI's empty row — drop it, don't refuse the save.
    if (!judul && !target && !dampak && !timeline) continue;
    // A PARTLY filled card is a mistake, not an empty row: refuse it, because a
    // recommendation without a target or a timeline is not actionable and the
    // client would read a half-written instruction.
    if (!judul || !target || !dampak || !timeline) throw new InsightDraftError(MSG_REK_TAK_LENGKAP);
    out.push({
      judul: bounded(judul, INSIGHT_MAX.rekJudul, `judul rekomendasi ${prioritas}`),
      target: bounded(target, INSIGHT_MAX.rekTarget, `target rekomendasi ${prioritas}`),
      dampak: bounded(dampak, INSIGHT_MAX.rekDampak, `dampak rekomendasi ${prioritas}`),
      timeline: bounded(timeline, INSIGHT_MAX.rekTimeline, `timeline rekomendasi ${prioritas}`),
    });
  }
  return out;
}

function normIndikator(rows: unknown[]): { nama: string; target: string }[] {
  if (rows.length > INSIGHT_MAX_INDIKATOR) throw new InsightDraftError(MSG_INDIKATOR_TERLALU_BANYAK);
  const out: { nama: string; target: string }[] = [];
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const nama = str(r.nama);
    const target = str(r.target);
    if (!nama && !target) continue;
    if (!nama || !target) throw new InsightDraftError(MSG_INDIKATOR_TAK_LENGKAP);
    out.push({
      nama: bounded(nama, INSIGHT_MAX.indNama, 'nama indikator'),
      target: bounded(target, INSIGHT_MAX.indTarget, 'target indikator'),
    });
  }
  return out;
}

/**
 * R3 — the per-stage prose.
 *
 * A blank row is dropped like every other list here, and a PARTLY filled one is
 * refused for the same reason a half-written recommendation is: a stage heading
 * with no body under it reads to the client as a section MEA forgot to finish.
 * Order is normalised to Awareness → Consideration → Conversion regardless of
 * how the form submitted it — the funnel only reads one way, and a report whose
 * stage paragraphs run backwards is a rendering bug the AM cannot see coming.
 */
function normTahapNarasi(rows: unknown[]): TahapNarasi[] {
  if (rows.length > INSIGHT_MAX_TAHAP) throw new InsightDraftError(MSG_TAHAP_GANDA);
  const out: TahapNarasi[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const judul = str(r.judul);
    const teks = str(r.teks);
    if (!judul && !teks) continue;
    if (!isTahapKey(r.tahap)) throw new InsightDraftError(MSG_TAHAP_TAK_DIKENAL);
    if (!judul || !teks) throw new InsightDraftError(MSG_TAHAP_TAK_LENGKAP);
    if (seen.has(r.tahap)) throw new InsightDraftError(MSG_TAHAP_GANDA);
    seen.add(r.tahap);
    out.push({
      tahap: r.tahap,
      judul: bounded(judul, INSIGHT_MAX.tahapJudul, `judul narasi tahap ${TAHAP_LABEL[r.tahap]}`),
      teks: bounded(teks, INSIGHT_MAX.tahapTeks, `teks narasi tahap ${TAHAP_LABEL[r.tahap]}`),
    });
  }
  const urut = Object.keys(TAHAP_LABEL);
  return out.sort((a, b) => urut.indexOf(a.tahap) - urut.indexOf(b.tahap));
}

/**
 * Validate + normalise an edited insight into the exact shape the renderer and
 * the engine both speak (`PayloadInsight`). Throws `InsightDraftError` with a
 * BI `[...]` message on the first problem; returns trimmed, bounded, markup-free
 * text otherwise.
 *
 * Blank list rows are dropped (the UI always renders one spare); blank REQUIRED
 * prose is refused. Order is preserved exactly as the author arranged it.
 */
export function normalizeInsightDraft(d: InsightDraft): PayloadInsight {
  const ringkasan = str(d.ringkasan);
  if (!ringkasan) throw new InsightDraftError(MSG_RINGKASAN_WAJIB);
  const outlook = str(d.outlook);
  if (!outlook) throw new InsightDraftError(MSG_OUTLOOK_WAJIB);

  const poinRaw = asArray(d.poin);
  if (poinRaw.length > INSIGHT_MAX_POIN) throw new InsightDraftError(MSG_POIN_TERLALU_BANYAK);
  const poin = poinRaw
    .map((x) => str(x))
    .filter((x) => x !== '')
    .map((x, i) => bounded(x, INSIGHT_MAX.poin, `poin key insight #${i + 1}`));
  if (!poin.length) throw new InsightDraftError(MSG_POIN_KOSONG);

  return {
    ringkasan: bounded(ringkasan, INSIGHT_MAX.ringkasan, 'ringkasan eksekutif'),
    poin,
    rekomendasi_tinggi: normRekomendasi(asArray(d.rekomendasi_tinggi), 'prioritas tinggi'),
    rekomendasi_sedang: normRekomendasi(asArray(d.rekomendasi_sedang), 'prioritas sedang'),
    outlook: bounded(outlook, INSIGHT_MAX.outlook, 'outlook'),
    indikator: normIndikator(asArray(d.indikator)),
    tahap_narasi: normTahapNarasi(asArray(d.tahap_narasi)),
  };
}
