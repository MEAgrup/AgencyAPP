/**
 * GET /api/v1/account/workload — each AM's active-client count (M6 §3 Rule 5),
 * highest first. A soft signal for the SPV dashboard, no hard cap (M6-OA-2).
 * Same read gate as the intake queue (SPV/Head Account + OD/Director). Ports
 * Go's handleAccountWorkload.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { amWorkloadToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await account.workload(db(), actor);
    return json({ data: rows.map(amWorkloadToWire) });
  });
}
