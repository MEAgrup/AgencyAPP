/**
 * GET  /api/v1/vendors — the E-8 / F-4 vendor picker (M6A §7 / D19).
 * POST /api/v1/vendors — register a vendor. Account lead / Director only.
 *
 * The list defaults to active vendors because its primary caller is a picker:
 * offering a blacklisted vendor and rejecting the choice afterwards is worse
 * than not offering it. `include_inactive=true` is the admin view.
 *
 * Shell only — every gate (who may write, the fee-scheme pairing, the duplicate
 * name) lives in `vendor`, so the DB CHECKs and the TS predicate stay one pair.
 */
import { vendor } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { vendorInputFromWire, vendorToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    requireActor(request);
    const url = new URL(request.url);
    const jenis = url.searchParams.get('jenis_layanan');
    const vendors = await vendor.listVendors(db(), {
      jenisLayanan: (jenis as vendor.VendorService | null) ?? null,
      includeInactive: url.searchParams.get('include_inactive') === 'true',
    });
    return json(vendors.map(vendorToWire));
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<unknown>(request);
    const created = await vendor.createVendor(db(), actor, vendorInputFromWire(b));
    return json(vendorToWire(created), 201);
  });
}
