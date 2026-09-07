/**
 * Usulan baris Plan P-C dari satu pilar Strategi Section E — **cermin manual**
 * `packages/core/src/planpillar.ts`.
 *
 * KENAPA CERMIN, BUKAN IMPORT. `web-internal` adalah aplikasi Next berdiri
 * sendiri tanpa dependency `@cdps/*` (lihat `web-internal/package.json`); ia
 * bicara ke `apps/api` lewat HTTP, bukan lewat import. Pola dan alasannya sama
 * persis dengan `divisions.ts` dan `riset-awal.ts`. **Sumber kebenarannya tetap
 * `packages/core/src/planpillar.ts`** — kalau tabel pilar→divisi atau parser
 * angkanya berubah di sana, berkas ini ikut diubah, dan sebaliknya jangan
 * pernah mengubah aturannya di sini saja.
 *
 * QA (2026-08-26): on `/account/plan/{id}`, picking a Strategi pillar (PC-3)
 * for a new Plan row only recorded the link — the pillar's own `aksi`/`target`
 * (e.g. "30 video, jembatan Video bertayangan / bulan" from AM Co-Pilot, or
 * free text the AM typed straight into Section E) never reached the row, so
 * the AM re-typed exactly what Section E already had. This is a pure
 * suggestion adapter (RAB-19 usulan→konfirmasi pattern, same shape as
 * `strategi-video-factory.ts`/`strategi-baseline-inherit.ts`): the caller
 * only applies a suggested field when the AM's own field is still empty, and
 * divisi PIC is set from a closed, unambiguous subset of pillar jenis — `sku`
 * / `harga` / `retensi` have no single owning division and are left for the
 * AM to pick (owner decision 2026-09-06: AI Optimizer or Store Operation, AM
 * chooses).
 */
import type { PlanRow } from './plan';
import type { StrategiPillar } from './strategi';

/** Cermin `planpillar.PILAR_TO_DIVISI`. */
export const PILAR_TO_DIVISI: Record<string, string> = {
  konten: 'Creative',
  iklan: 'Ads',
  affiliate: 'KOL',
  live: 'Live Stream',
  operasional: 'Ops',
};

/** Cermin `planpillar.PILAR_PILIH_DIVISI` — divisinya dipilih AM, bukan ditebak. */
export const PILAR_PILIH_DIVISI: readonly string[] = ['sku', 'harga', 'retensi'];

/**
 * Cermin `planpillar.KANDIDAT_DIDAHULUKAN` — dua divisi yang pemilik sebut
 * namanya untuk pilar SKU/harga (2026-09-06); sisa divisi tetap ditawarkan.
 */
export const KANDIDAT_DIDAHULUKAN: readonly string[] = ['AI Optimizer', 'Store Operation'];

/** Cermin `planpillar.ALASAN_LABEL`. */
export const ALASAN_LABEL: Record<string, string> = {
  bukan_pilar_kerja: 'bukan pekerjaan (pilar ditandai tidak dikerjakan)',
  butuh_divisi: 'pilih divisi PIC',
  butuh_kuota: 'isi kuota + satuan',
  butuh_channel: 'pilih channel',
};

/**
 * Cermin `planpillar.parseAngkaTarget` — konvensi angka Indonesia: **titik =
 * ribuan, koma = desimal**. `null` untuk apa pun yang bukan persis salah satu
 * bentuk itu; parser lama membaca `15.000.000` sebagai **15**.
 */
export function parseAngkaTarget(run: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(run);
  if (m === null) return null;
  const bulat = m[1].replace(/\./g, '');
  const pecahan = m[2] ?? '';
  const n = Number(pecahan === '' ? bulat : `${bulat}.${pecahan}`);
  return Number.isFinite(n) ? n : null;
}

/** Cermin `planpillar.parseTargetKuota`. Angka harus di DEPAN teks target. */
export function parseTargetKuota(
  target: string | null | undefined,
): { kuota: number; satuan: string } | null {
  const m = /^(\d[\d.,]*\d|\d)\s*([^\s,]+)?/.exec((target ?? '').trim());
  if (m === null) return null;
  const kuota = parseAngkaTarget(m[1]);
  if (kuota === null) return null;
  return { kuota, satuan: m[2] ?? '' };
}

/**
 * Cermin `planpillar.angleVideoDariDetail` — `detail.angle_video` (ditulis AM
 * Co-Pilot, `strategi-copilot.ts`) jadi satu baris `instruksi_brief`, yang
 * `brief-inherit` sambung ke `instructions` Brief Creative. Sampai UAT
 * Gelombang B §10 butir 7 (2026-09-07) kunci itu ditulis dan tak pernah dibaca:
 * angle-nya berhenti di Section E. `null` = kolomnya tetap kosong.
 */
export function angleVideoDariDetail(detail: unknown): string | null {
  if (detail === null || typeof detail !== 'object') return null;
  const raw = (detail as Record<string, unknown>).angle_video;
  if (!Array.isArray(raw)) return null;
  const angle = raw.map((a) => (typeof a === 'string' ? a.trim() : '')).filter((a) => a !== '');
  if (angle.length === 0) return null;
  return `Angle video yang sudah perform (Section E): ${angle.join(' | ')}`;
}

export interface PlanRowSuggestion {
  aksi: string;
  kuota: string;
  satuan: string;
  divisiPic: string | null;
  /** PC-5 — the pillar's own SKU (E-3/E-4), when it names exactly one. */
  skuSasaran: string[];
  /** PC-11 — the pillar's target text, verbatim (`planpillar` seeds the same). */
  hasilDiharapkan: string;
  /** Bukan kolom PC — angle video Section E, '' kalau pilar ini tak punya. */
  instruksiBrief: string;
}

export function suggestRowFromPillar(p: StrategiPillar): PlanRowSuggestion {
  const q = parseTargetKuota(p.target);
  const sku = (p.sku ?? '').trim();
  return {
    aksi: (p.aksi ?? '').trim(),
    kuota: q === null ? '' : String(q.kuota),
    satuan: q?.satuan ?? '',
    divisiPic: PILAR_TO_DIVISI[p.jenis] ?? null,
    skuSasaran: sku ? [sku] : [],
    hasilDiharapkan: (p.target ?? '').trim(),
    instruksiBrief: angleVideoDariDetail(p.detail) ?? '',
  };
}

/**
 * Kandidat divisi PIC untuk pilar tanpa divisi bawaan — cermin
 * `planpillar.kandidatDivisi()`, di atas `DIVISI_KERJA` (cermin
 * `briefAssignableNames()`).
 */
export function kandidatDivisi(semuaDivisi: readonly string[]): string[] {
  const depan = KANDIDAT_DIDAHULUKAN.filter((n) => semuaDivisi.includes(n));
  return [...depan, ...semuaDivisi.filter((n) => !depan.includes(n))];
}

/** Label BI pilar — sama dengan Section E dan halaman Plan. */
export const PILAR_LABEL: Record<string, string> = {
  sku: 'SKU',
  harga: 'Harga',
  iklan: 'Iklan',
  konten: 'Konten',
  affiliate: 'Affiliate',
  live: 'Live',
  retensi: 'Retensi',
  operasional: 'Operasional',
};

/** Cermin `planpillar.PILAR_BARIS` = `ck_plan_row_pilar` (tanpa `tidak_dikerjakan`). */
export const PILAR_BARIS: readonly string[] = Object.keys(PILAR_LABEL).sort();

/** Satu pilar Section E yang belum jadi baris P-C, plus apa yang kurang darinya. */
export interface KekuranganPilar {
  pillar: StrategiPillar;
  /** Kunci `ALASAN_LABEL`, dikumpulkan SEMUA — bukan berhenti di yang pertama. */
  alasan: string[];
  divisiPic: string | null;
  channel: string | null;
  kuota: number | null;
  satuan: string;
}

/**
 * Pilar Section E mana yang belum punya baris di periode ini, dan apa yang
 * kurang dari masing-masing — cermin `planpillar.seedRowFromPillar` dari sisi
 * pembaca: server sudah menyemai yang bisa disemai, jadi yang tersisa di sini
 * pasti punya minimal satu alasan.
 *
 * Pilar yang SUDAH punya baris dilewati lewat `strategi_pillar_id`, jadi panel
 * tidak menawarkan baris kedua untuk pilar yang sama. Pilar tanpa alasan
 * apa pun juga dilewati: itu pilar yang server memang sudah semai dan barisnya
 * dihapus AM dengan sengaja — menawarkannya lagi berarti melawan keputusan AM.
 */
export function kekuranganPilar(
  pillars: StrategiPillar[],
  rows: PlanRow[],
  channelStrategi: string[],
): KekuranganPilar[] {
  const sudah = new Set(
    rows.map((r) => r.strategi_pillar_id).filter((v): v is number => v !== null),
  );
  const out: KekuranganPilar[] = [];
  for (const p of pillars) {
    if (!PILAR_BARIS.includes(p.jenis)) continue; // `tidak_dikerjakan` bukan pekerjaan
    if (sudah.has(p.id)) continue;
    const alasan: string[] = [];
    const divisiPic = PILAR_TO_DIVISI[p.jenis] ?? null;
    if (divisiPic === null) alasan.push('butuh_divisi');
    const pilarChannel = (p.channel ?? '').trim();
    const channel =
      pilarChannel !== ''
        ? pilarChannel
        : channelStrategi.length === 1
          ? channelStrategi[0]
          : null;
    if (channel === null) alasan.push('butuh_channel');
    const q = parseTargetKuota(p.target);
    const kuota = q !== null && q.kuota > 0 ? q.kuota : null;
    if (kuota === null) alasan.push('butuh_kuota');
    if (alasan.length === 0) continue;
    out.push({ pillar: p, alasan, divisiPic, channel, kuota, satuan: q?.satuan ?? '' });
  }
  return out;
}
