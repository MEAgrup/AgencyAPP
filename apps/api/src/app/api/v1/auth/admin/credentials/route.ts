/**
 * GET /api/v1/auth/admin/credentials — credential status of the employees this
 * admin may manage (O44(c) part B1). Ports Go's handleAdminCredentials.
 *
 * This is what makes the admin reset usable rather than blind: it shows who has
 * no password yet, who is still under a forced change, and who is locked out —
 * so a Director answering "saya lupa password" can see the actual state before
 * setting a temp one.
 *
 * Director → every active employee; a division Lead → their mapped division only.
 * Privileged read with the gate in the domain layer: it joins `role_mappings` and
 * `employee_credentials`, both default-deny under RLS (rls_baseline §5).
 */
import { auth } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { credentialInfoToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await auth.listCredentials(db(), actor);
    return json({ data: rows.map(credentialInfoToWire) });
  });
}
