/**
 * FE mirror types for Modul Interview ("Kelola Klien" tab 1) — the snake_case
 * shapes the API serves (apps/api `wire.ts` interviewToWire / …DetailToWire /
 * …VerdictToWire). These are the O43 contract the shape-parity gate checks the
 * wire mappers against; the "Kelola Klien" UI (langkah 7) renders from them.
 *
 * Keep in lock-step with `apps/api/src/lib/wire.ts` — a key here that the wire
 * mapper does not emit (or vice-versa) is exactly the blank-page class of bug
 * the parity gate exists to catch.
 */

/** The interview record. */
export interface Interview {
  id: string;
  client_id: string;
  contract_id: string | null;
  service_id: string | null;
  am_pengisi_id: string;
  acting_for_am_id: string | null;
  sales_closing_id: string | null;
  status: string;
  versi_no: number;
  interview_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  interview_profile: string;
  retroaktif: boolean;
  alasan_kekosongan: string | null;
  alasan_pembatalan: string | null;
  created_at: string;
  created_by: string;
}

/** Blok A schedule. */
export interface InterviewJadwal {
  tanggal_waktu: string | null;
  durasi_menit: number | null;
  format: string | null;
  lokasi_link: string | null;
  peserta_klien: unknown;
  peserta_mea: unknown;
  catatan_persiapan: string | null;
  data_diminta: unknown;
}

/** Blok C qualification output (internal — never shown client-side). */
export interface InterviewKualifikasi {
  skor_kualifikasi: number;
  skor_per_blok: unknown;
  verdict_kualifikasi: string;
  hambatan_mendasar: unknown;
  prasyarat_status: string;
  margin_bersih: number | null;
  margin_bersih_basis: string;
  margin_kotor: number | null;
  margin_derivasi_input: unknown;
  kualitas_data: string;
  bep_roas: number | null;
  rasio_target: number | null;
  dihitung_pada: string;
}

/** One Blok B answer (row per section/field). */
export interface InterviewAnswer {
  section: string;
  field_key: string;
  nilai_teks: string | null;
  nilai_angka: number | null;
  nilai_uang: string | null;
  nilai_bool: boolean | null;
  nilai_enum: string | null;
  nilai_jsonb: unknown;
  sumber_angka: string | null;
  dasar_estimasi: string | null;
}

/** The full record the internal detail page loads at once. */
export interface InterviewDetail {
  interview: Interview;
  jadwal: InterviewJadwal | null;
  kualifikasi: InterviewKualifikasi | null;
  answers: InterviewAnswer[];
}

/** verdict + prasyarat ONLY — the Sales-facing surface. */
export interface InterviewVerdict {
  interview_id: string;
  verdict: string;
  prasyarat_status: string;
}
