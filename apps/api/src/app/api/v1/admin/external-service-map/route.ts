/**
 * /api/v1/admin/external-service-map — list (GET) and upsert (POST) the
 * MSDPS `external_service_type` → CDPS Master Service List mapping. Write =
 * Director only (`permission.canManageAdmin`, mirrors `admin.upsertRoleMapping`).
 * GET uses the privileged client like `admin/role-mappings`: RLS on this
 * table is `USING (true)` (pure catalog, O48 ledger) so there is nothing for
 * `readAsActor` to scope — a plain `db()` read is not a widening here.
 */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { externalServiceMapToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    requireActor(request);
    const rows = await bridge.listServiceMap(db());
    return json({ data: rows.map(externalServiceMapToWire) });
  });
}

interface Body {
  external_service_type?: string;
  master_service_id?: string;
  aktif?: boolean;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<Body>(request);
    const row = await bridge.upsertServiceMap(db(), actor, {
      externalServiceType: body.external_service_type ?? '',
      masterServiceId: body.master_service_id ?? '',
      aktif: body.aktif !== false,
    });
    return json(externalServiceMapToWire(row));
  });
}
