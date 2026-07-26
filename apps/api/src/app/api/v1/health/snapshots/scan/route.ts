/** POST /api/v1/health/snapshots/scan — the monthly Client Health snapshot sweep (M13 §5.2). */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { healthScanResultToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    return json(healthScanResultToWire(await health.runScan(db(), actor, new Date())));
  });
}
