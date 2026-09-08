/**
 * POST /api/v1/strategies/{id}/submit — **DIPENSIUNKAN 2026-09-08.**
 *
 * Jalur `STR-` sudah tidak kanonik; `STRG-` (M6A) yang membuka gerbang Brief.
 * Alasan lengkap + kenapa 410 dan bukan penghapusan: `@/lib/retired-str`.
 */
import { handle } from '@/lib/http';
import { strPensiun } from '@/lib/retired-str';

export async function POST(): Promise<Response> {
  return handle(async () => strPensiun());
}
