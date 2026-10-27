/**
 * POST /api/v1/internal/website-leads — pintu mesin WEBSITE-LEAD
 * (docs/DECISIONS.md 2026-10-27). Bukan rute aktor JWT: plugin WordPress
 * `mea-leads` mengirim lead form website dengan tanda tangan HMAC
 * (`@/lib/website-lead-auth`), dan lead-nya masuk Pool lewat pintu import
 * Marketing yang sama (`websiteLead.intake` → `leads.poolIntake`).
 *
 * Body dibaca sebagai TEKS lebih dulu: tanda tangan dihitung atas byte persis,
 * jadi body tidak boleh di-parse ulang sebelum diverifikasi.
 *
 *   201 {"status":"dibuat","lead_id"}    lead baru / dibuka ulang ke [Pool]
 *   200 {"status":"duplikat","lead_id"}  nomor sedang diproses / sudah klien
 *   200 hasil pertama                    kunci idempotensi yang sama (kirim ulang)
 *   400 {"error":"[…]"}                  payload tidak valid
 *   401 {"error":"unauthorized"}         tanda tangan / timestamp / secret salah
 */
import { websiteLead } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { websiteLeadSignatureOk } from '@/lib/website-lead-auth';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const raw = await request.text();
    if (!websiteLeadSignatureOk(request, raw)) return json({ error: 'unauthorized' }, 401);
    const key = request.headers.get('x-mea-idempotency-key') ?? '';
    const res = await websiteLead.intake(db(), raw, key);
    const status = res.status === 'dibuat' && !res.replay ? 201 : 200;
    return json({ status: res.status, lead_id: res.leadId }, status);
  });
}
