/**
 * /api/v1/admin/client-contacts — M15-C2: the admin screen for provisioning a
 * Client Portal contact's login. Mirrors `/admin/vendor-accounts` exactly in
 * shape; the one real difference is the gate, which is per-Client rather than
 * a single actor-wide check — `clientPortalAuth.listClientContacts` already
 * does the per-row scoping (AM sees only their assigned Clients' contacts),
 * and `provisionClientContact` does the per-record check internally (spec
 * §3.2: AM own-Client / Account lead / Director any-Client), so this route
 * never gates up front the way `/admin/vendor-accounts` does.
 *
 * Both handlers take the privileged client: `client_contacts` is default-deny
 * internal data (like `vendor_accounts`/`role_mappings`), and provisioning
 * writes GoTrue `auth.users` through a SECURITY DEFINER RPC — neither is
 * RLS-scoped.
 */
import { clientPortalAuth } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { clientContactAccountToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await clientPortalAuth.listClientContacts(db(), actor);
    return json({ data: rows.map(clientContactAccountToWire) });
  });
}

interface ProvisionBody {
  client_id?: string;
  nama?: string;
  email?: string;
  temp_password?: string;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<ProvisionBody>(request);
    const row = await clientPortalAuth.provisionClientContact(db(), actor, {
      clientId: body.client_id ?? '',
      nama: body.nama ?? '',
      email: body.email ?? '',
      tempPassword: body.temp_password ?? '',
    });
    return json({ data: clientContactAccountToWire(row) });
  });
}
