/**
 * GET /api/v1/strategi/{id}/copilot — **DIPENSIUNKAN** (410 Gone).
 *
 * Route ini dulu menyajikan usulan pilar Section E dari mesin aturan AM
 * Co-Pilot, dihitung server-side dari `riset_awal_analisa.payload` (B4).
 * Ketokan pemilik 2026-09-21 mencabut AM Co-Pilot & AM Baseline seluruhnya;
 * pengisi Section E sekarang adalah **editor pilar manual**, yang membaca
 * katalog lewat `GET /api/v1/strategi/katalog-pilar` dan tidak butuh Riset Awal
 * sama sekali.
 *
 * Alasan 410 (bukan menghapus berkasnya) ada di `@/lib/retired-amtools`.
 */
import { copilotPensiun } from '@/lib/retired-amtools';

export function GET(): Response {
  return copilotPensiun();
}
