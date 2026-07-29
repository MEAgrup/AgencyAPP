/**
 * /api/v1/admin/layered-roles — list layered OD/Director assignments (GET) and
 * enable/disable one (POST). Ports Go's handleListLayeredRoles /
 * handleSetLayeredRole.
 *
 * These are the two most powerful roles in CDPS, so writes are Director-only and
 * always audited with their before-state. POST disables rather than deletes:
 * absence of a row is itself meaningful (`employee_claims()` treats an unmapped
 * employee as pure OD/Director), so a delete would change a different thing.
 *
 * The GET uses the privileged client for the same reason as `/role-mappings`:
 * `employee_layered_roles` is default-deny (rls_baseline §5), so the Director/OD
 * gate is enforced here rather than by RLS.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { layeredRoleToWire } from '@/lib/wire';

interface LayeredRoleBody {
  employee_id?: string;
  role?: string;
  enabled?: boolean;
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!admin.canReadAdmin(actor)) {
      return json({ error: admin.MSG_ADMIN_READ_DENIED }, 403);
    }
    const rows = await admin.listLayeredRoles(db());
    return json({ data: rows.map(layeredRoleToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<LayeredRoleBody>(request);
    await admin.setLayeredRole(
      db(),
      actor,
      body.employee_id ?? '',
      body.role ?? '',
      body.enabled === true,
    );
    return json({ status: 'ok' });
  });
}
