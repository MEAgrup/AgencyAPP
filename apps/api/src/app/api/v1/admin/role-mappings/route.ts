/**
 * /api/v1/admin/role-mappings — list mapping rules (GET) and upsert one (POST).
 * Ports Go's handleListRoleMappings / handleCreateRoleMapping.
 *
 * This is the permission root: `employee_claims()` derives division/level from
 * `role_mappings(divisi, jabatan)`, and a trigger re-syncs GoTrue app-metadata,
 * so one write here re-grades EVERY employee holding that divisi+jabatan.
 * Director-only, always audited (both gates live in the domain layer).
 *
 * The GET uses the PRIVILEGED client, not `readAsActor`, and that is deliberate:
 * `role_mappings` is default-deny with SELECT revoked from `authenticated`
 * (rls_baseline §5) because it carries the authorization rules themselves, so
 * RLS cannot scope this read — the Director/OD gate is enforced here instead,
 * mirroring Go. See the module docstring in `@cdps/domain`'s `admin`.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { roleMappingToWire } from '@/lib/wire';

interface RoleMappingBody {
  divisi?: string;
  jabatan?: string;
  division?: string;
  level?: string;
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!admin.canReadAdmin(actor)) {
      return json({ error: admin.MSG_ADMIN_READ_DENIED }, 403);
    }
    const rows = await admin.listRoleMappings(db());
    return json({ data: rows.map(roleMappingToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<RoleMappingBody>(request);
    const id = await admin.upsertRoleMapping(db(), actor, {
      divisi: body.divisi ?? '',
      jabatan: body.jabatan ?? '',
      division: body.division ?? '',
      level: body.level ?? '',
    });
    return json({ id });
  });
}
