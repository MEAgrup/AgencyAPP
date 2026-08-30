/**
 * GET /api/v1/vendor/briefs — LT-61 FE: every open Live Stream Brief the
 * calling vendor may create a new Session under via the existing
 * `POST /briefs/{id}/sessions`.
 *
 * Closes a discovery gap noted in
 * docs/handoff/HANDOFF_LT61_CORE_SELESAI_FE_VENDOR_20260830.md §3.2: LT-61
 * core shipped `GET /vendor/sessions` (a vendor's own Sessions) but nothing
 * that lets a vendor with no Session yet learn which Brief id to create one
 * under. An employee caller gets an empty list (mirrors `listVendorSessions`'s
 * no-op-for-employees precedent), not a 403 — there is simply nothing "mine"
 * to list.
 *
 * Reads via `db()`, NOT `readAsActor` — same precedent as `recap.ts`'s route
 * layer (DECISIONS.md 2026-08-14, M6D D-09b): `listVendorBriefs` joins
 * `briefs`/`services`/`clients` and reads `strategi`/`strategi_pillar`
 * (`resolveLiveVendorId`), and every SELECT policy on those tables keys off an
 * EMPLOYEE claim (`jwt_employee_id()`/`jwt_division()`/`jwt_is_lead()`) — a
 * vendor JWT carries only `vendor_id`, so under RLS every one of those
 * policies evaluates false and the query would spuriously come back empty for
 * every vendor, including one that legitimately owns the Brief. The function
 * already gates fully in TS (it only returns a row after re-resolving
 * `resolveLiveVendorId` and matching it against `actor.vendorId`), so `db()`
 * costs no authorization — it is the same "gate in TS, read as service role"
 * shape as `sm_transition`/other privileged RPCs, just applied to a read.
 */
import { livestream } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { vendorBriefToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const data = await livestream.listVendorBriefs(db(), actor);
    return json({ data: data.map(vendorBriefToWire) });
  });
}
