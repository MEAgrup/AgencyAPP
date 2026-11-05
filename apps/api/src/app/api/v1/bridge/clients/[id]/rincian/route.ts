/**
 * GET /api/v1/bridge/clients/{id}/rincian — daftar kerja order MSDPS yang sudah
 * diterima untuk satu klien (jenis + catatan per baris) plus layanan bridge
 * MEAGO-nya dengan link Google Drive (keputusan pemilik 2026-11-05). Row scope
 * = RLS (`external_orders_select`, `services_select`) lewat `readAsActor`.
 */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { rincianOrderKlienToWire } from '@/lib/wire';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const r = await readAsActor(actor, (sql) => bridge.rincianOrderKlien(sql, id));
    return json(rincianOrderKlienToWire(r));
  });
}
