/**
 * GET /api/v1/assets/mine — the caller's personal Asset queue (M7 §3 Rule 2):
 * every Asset assigned to them, across all Briefs/clients, sorted by due date.
 *
 * Runs on the service-role client (db()), NOT readAsActor: the read is hard-scoped
 * to `assigned_pic = actor.employeeId` inside the domain, so it can only ever
 * return the caller's own rows, and service-role avoids the O52 client-join row
 * erasure RLS would inflict on a Creative staffer reading their own work (see the
 * listMyAssets section header in creative.ts). Same pattern as recap.getRecapDetail.
 */
import { creative } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { myAssetQueueItemToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await creative.listMyAssets(db(), actor);
    return json({ data: rows.map(myAssetQueueItemToWire) });
  });
}
