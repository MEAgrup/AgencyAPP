/**
 * PDT (Pusat Data Toko) — validasi & normalisasi draf "insight" hasil sunting
 * AM (G2-01-INSIGHT-EDIT, lanjutan bagian laporan "insight" di `laporan.ts`).
 *
 * KONTEKS. Keputusan pemilik via `AskUserQuestion` (`docs/DECISIONS.md`
 * 2026-09-16 "insight") menolak replika penuh `client_report_insight`/
 * `client_report_publikasi` (tabel revisi append-only + gerbang publikasi)
 * mesin lama — PDT-21 "snapshot beku HANYA saat dikirim" tetap satu aksi
 * atomik, nol state machine baru. Sebagai gantinya: AM menyunting insight di
 * layar pratinjau SEBELUM klik "Kirim ke Klien" (`kirimLaporanPdt`, Flow B
 * langkah 4), dan draf itu divalidasi DI SINI sebelum menggantikan
 * `insight` mesin pada payload yang dibekukan. Nol tabel/kolom baru — draf
 * yang gagal validasi tidak pernah sampai menyentuh `pdt_laporan_kiriman`.
 *
 * Field SAMA seperti `PdtLaporanInsight` (`laporan.ts`) MINUS apa pun terkait
 * "tahap" — beda dari mesin lama, bagian "tahap" PDT sudah tampil sebagai
 * data terstruktur (funnel+blok+metrik), bukan narasi bebas per tahap, jadi
 * tidak ada apa pun untuk disunting AM di sana.
 *
 * Batas karakter/daftar dan pesan BI SENGAJA DISALIN persis dari
 * `report/insight-edit.ts` (fitur identik, sudah disetujui pemilik) — BUKAN
 * diimpor: `pdt/` tidak boleh bergantung pada `report/` (mesin lama sedang
 * di-strangle PDT-17, dua modul yang boleh berevolusi independen).
 */
import type { PdtLaporanInsight, PdtLaporanRekomendasi } from './laporan';

/** Per-field character ceilings — sama persis `report/insight-edit.ts` `INSIGHT_MAX`. */
export const PDT_INSIGHT_MAX = {
  ringkasan: 1200,
  poin: 400,
  outlook: 1200,
  rekJudul: 120,
  rekTarget: 240,
  rekDampak: 300,
  rekTimeline: 60,
  indNama: 80,
  indTarget: 120,
} as const;

export const PDT_INSIGHT_MAX_POIN = 15;
export const PDT_INSIGHT_MAX_REK = 8;
export const PDT_INSIGHT_MAX_INDIKATOR = 8;

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5) — sama kata-kata persis `report/insight-edit.ts`.
// ---------------------------------------------------------------------------
export const MSG_PDT_INSIGHT_RINGKASAN_WAJIB = '[ringkasan eksekutif wajib diisi]';
export const MSG_PDT_INSIGHT_OUTLOOK_WAJIB = '[outlook periode berikutnya wajib diisi]';
export const MSG_PDT_INSIGHT_POIN_KOSONG = '[isi minimal satu poin key insight]';
export const MSG_PDT_INSIGHT_POIN_TERLALU_BANYAK = `[maksimal ${PDT_INSIGHT_MAX_POIN} poin key insight]`;
export const MSG_PDT_INSIGHT_REK_TERLALU_BANYAK = `[maksimal ${PDT_INSIGHT_MAX_REK} rekomendasi per prioritas]`;
export const MSG_PDT_INSIGHT_INDIKATOR_TERLALU_BANYAK = `[maksimal ${PDT_INSIGHT_MAX_INDIKATOR} indikator]`;
export const MSG_PDT_INSIGHT_REK_TAK_LENGKAP = '[setiap rekomendasi wajib punya judul, target, dampak, dan timeline]';
export const MSG_PDT_INSIGHT_INDIKATOR_TAK_LENGKAP = '[setiap indikator wajib punya nama dan target]';
export const MSG_PDT_INSIGHT_ADA_MARKUP =
  '[teks insight tidak boleh memuat tag HTML seperti <b> atau <script> — tanda pembanding < dan > boleh dipakai]';

/** `[teks "…" melebihi N karakter]` — names the offending field, not just "too long". */
export function msgPdtInsightTerlaluPanjang(label: string, max: number): string {
  return `[teks ${label} melebihi ${max} karakter]`;
}

/**
 * Bentuk wire/UI draf — tiap field opsional dan longgar tipenya karena
 * datang dari form/HTTP body: validasi adalah tugas modul ini, bukan
 * pemanggil, dan kunci yang hilang menghasilkan pesan `[...]`, bukan
 * TypeError. Nama field snake_case (bentuk wire) SENGAJA — pola sama
 * `report.InsightDraft`, satu-satunya pengecualian house rule "wire↔domain
 * hanya di wire.ts": fungsi INI yang jadi gerbang keluarnya, bukan
 * `apps/api/src/lib/wire.ts` (lihat `toPdtInsightDraft`, pass-through murni).
 */
export interface PdtInsightDraft {
  ringkasan?: unknown;
  poin?: unknown;
  rekomendasi_tinggi?: unknown;
  rekomendasi_sedang?: unknown;
  outlook?: unknown;
  indikator?: unknown;
}

/** Dilempar dengan pesan BI `[...]`; domain (`kirimLaporanPdt`) menerjemahkannya ke `pdt.ValidationError`. */
export class PdtInsightDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdtInsightDraftError';
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Cocok `<tag`, `</tag`, `<!--`/`<!DOCTYPE`, `<?xml` — bukan bare `<`/`>` polos.
 * Keputusan pemilik `docs/DECISIONS.md` 2026-09-25 "PDT-INSIGHT-BANDING-VS-TAG":
 * AM sering menulis simbol pembanding di narasi ("ROAS > 4", "cancel rate < 5%")
 * dan versi lama menolak SEMUA `<`/`>`, memaksa AM mengedit manual untuk kalimat
 * yang sudah aman — renderer (`esc()`, `pdt/render.ts`) meng-escape `<`/`>`/`&`/`"`
 * pada SETIAP interpolasi, jadi bare `<`/`>` yang tersimpan apa adanya tidak
 * pernah jadi markup hidup. Pola tag SUNGGUH tetap ditolak sebagai lapisan kedua
 * (preseden sama, sekadar dipersempit) — SAMA PERSIS `report/insight-edit.ts`.
 */
const TAG_LIKE = /<\/?[a-zA-Z!?]/;

function noMarkup(v: string): string {
  if (TAG_LIKE.test(v)) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_ADA_MARKUP);
  return v;
}

function bounded(v: string, max: number, label: string): string {
  if (v.length > max) throw new PdtInsightDraftError(msgPdtInsightTerlaluPanjang(label, max));
  return noMarkup(v);
}

function normRekomendasi(rows: unknown[], prioritas: string): PdtLaporanRekomendasi[] {
  if (rows.length > PDT_INSIGHT_MAX_REK) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_REK_TERLALU_BANYAK);
  const out: PdtLaporanRekomendasi[] = [];
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const judul = str(r.judul);
    const target = str(r.target);
    const dampak = str(r.dampak);
    const timeline = str(r.timeline);
    // Baris kosong sepenuhnya adalah baris cadangan editor — dibuang, bukan ditolak.
    if (!judul && !target && !dampak && !timeline) continue;
    // Baris terisi SEBAGIAN adalah kesalahan, bukan baris kosong: rekomendasi tanpa
    // target/timeline tidak actionable dan klien akan membaca instruksi setengah jadi.
    if (!judul || !target || !dampak || !timeline) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_REK_TAK_LENGKAP);
    out.push({
      judul: bounded(judul, PDT_INSIGHT_MAX.rekJudul, `judul rekomendasi ${prioritas}`),
      target: bounded(target, PDT_INSIGHT_MAX.rekTarget, `target rekomendasi ${prioritas}`),
      dampak: bounded(dampak, PDT_INSIGHT_MAX.rekDampak, `dampak rekomendasi ${prioritas}`),
      timeline: bounded(timeline, PDT_INSIGHT_MAX.rekTimeline, `timeline rekomendasi ${prioritas}`),
    });
  }
  return out;
}

function normIndikator(rows: unknown[]): { nama: string; target: string }[] {
  if (rows.length > PDT_INSIGHT_MAX_INDIKATOR) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_INDIKATOR_TERLALU_BANYAK);
  const out: { nama: string; target: string }[] = [];
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const nama = str(r.nama);
    const target = str(r.target);
    if (!nama && !target) continue;
    if (!nama || !target) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_INDIKATOR_TAK_LENGKAP);
    out.push({
      nama: bounded(nama, PDT_INSIGHT_MAX.indNama, 'nama indikator'),
      target: bounded(target, PDT_INSIGHT_MAX.indTarget, 'target indikator'),
    });
  }
  return out;
}

/**
 * Validasi + normalisasi draf sunting jadi bentuk PERSIS `PdtLaporanInsight`
 * (dipakai `kirimLaporanPdt` menggantikan `insight` mesin sebelum
 * pembekuan). Melempar `PdtInsightDraftError` dengan pesan BI `[...]` pada
 * masalah pertama; sebaliknya mengembalikan teks yang sudah dipangkas,
 * dibatasi, dan bebas markup.
 *
 * Baris daftar kosong dibuang (UI selalu merender satu baris cadangan);
 * prosa WAJIB yang kosong ditolak. Urutan dipertahankan persis seperti
 * disusun penulis.
 */
export function normalizePdtInsightDraft(d: PdtInsightDraft): PdtLaporanInsight {
  const ringkasan = str(d.ringkasan);
  if (!ringkasan) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_RINGKASAN_WAJIB);
  const outlook = str(d.outlook);
  if (!outlook) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_OUTLOOK_WAJIB);

  const poinRaw = asArray(d.poin);
  if (poinRaw.length > PDT_INSIGHT_MAX_POIN) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_POIN_TERLALU_BANYAK);
  const poin = poinRaw
    .map((x) => str(x))
    .filter((x) => x !== '')
    .map((x, i) => bounded(x, PDT_INSIGHT_MAX.poin, `poin key insight #${i + 1}`));
  if (!poin.length) throw new PdtInsightDraftError(MSG_PDT_INSIGHT_POIN_KOSONG);

  return {
    ringkasan: bounded(ringkasan, PDT_INSIGHT_MAX.ringkasan, 'ringkasan eksekutif'),
    poin,
    rekomendasiTinggi: normRekomendasi(asArray(d.rekomendasi_tinggi), 'prioritas tinggi'),
    rekomendasiSedang: normRekomendasi(asArray(d.rekomendasi_sedang), 'prioritas sedang'),
    outlook: bounded(outlook, PDT_INSIGHT_MAX.outlook, 'outlook'),
    indikator: normIndikator(asArray(d.indikator)),
  };
}
