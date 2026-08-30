/**
 * /api/v1/admin/vendor-accounts — LT-61 follow-up: the admin screen for
 * provisioning a vendor's own login. Reverses the "no admin UI, manual insert
 * only" call in `CDPS_Module10_Addendum_LT61_Vendor_Portal_Spec.md` §7/§8
 * (owner decision — vendor count grew past "tiny").
 *
 * Same authority as the vendor record itself (Account lead / Head of Account /
 * Director — `vendor.canManageVendor`), enforced in the domain layer. Both
 * handlers take the privileged client: `vendor_accounts` is default-deny
 * internal data (like `role_mappings`), and provisioning writes GoTrue
 * `auth.users` through a SECURITY DEFINER RPC — neither is RLS-scoped.
 */
import { vendor } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { vendorAccountToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await vendor.listVendorAccounts(db(), actor);
    return json({ data: rows.map(vendorAccountToWire) });
  });
}

interface ProvisionBody {
  vendor_id?: string;
  email?: string;
  temp_password?: string;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<ProvisionBody>(request);
    const row = await vendor.provisionVendorAccount(db(), actor, {
      vendorId: body.vendor_id ?? '',
      email: body.email ?? '',
      tempPassword: body.temp_password ?? '',
    });
    return json({ data: vendorAccountToWire(row) });
  });
}
