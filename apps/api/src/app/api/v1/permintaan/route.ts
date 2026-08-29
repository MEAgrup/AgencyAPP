/**
 * /api/v1/permintaan — Permintaan (`REQ-`, M16 §5.5), divisi request TERKAIT
 * KLIEN (Top-up Saldo / Contract Creator / Creator Payment Approval).
 *
 * GET:  the antrian for one destination division. Query: ?divisi= (required —
 *       Account / Finance). Gated to a lead/staff of that division or Director.
 * POST: submit one request — the jenis's owning division (Ads for Top-up
 *       Saldo, KOL for the other two) or Director.
 */
import { req } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { permintaanToWire, toPermintaanInput } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const divisi = new URL(request.url).searchParams.get('divisi') ?? '';
    const rows = await readAsActor(actor, (sql) => req.listPermintaanQueue(sql, actor, divisi));
    return json({ data: rows.map(permintaanToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<Parameters<typeof toPermintaanInput>[0]>(request);
    const p = await req.createPermintaan(db(), actor, toPermintaanInput(b));
    return json(permintaanToWire(p), 201);
  });
}
