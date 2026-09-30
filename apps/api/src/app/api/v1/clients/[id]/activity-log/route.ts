/**
 * GET /api/v1/clients/{id}/activity-log — Log Aktivitas Klien (Improvement Req
 * Account butir 5, pemilik 2026-09-30; DECISIONS.md "LOG-AKTIVITAS-KLIEN").
 * Seluruh jejak `audit_log` satu klien — dari closing & assign AM oleh Head of
 * Account sampai Service selesai — terbaru di atas.
 *
 * Gerbang di domain (`clientLog.canReadClientLog`: OD/Director, lead Account,
 * AM pemilik) lalu baca lewat `db()` privileged: `audit_log_select` berbasis
 * PENULIS dan akan menyembunyikan baris yang ditulis divisi lain dari AM —
 * alasannya di header `packages/domain/src/client-log.ts`.
 */
import { clientLog } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { clientLogEntryToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const entries = await clientLog.clientActivityLog(db(), actor, id);
    return json({ data: entries.map(clientLogEntryToWire) });
  });
}
