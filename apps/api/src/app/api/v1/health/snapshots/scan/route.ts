/**
 * POST /api/v1/health/snapshots/scan — M13 §5.2: run the monthly Client Health
 * snapshot sweep (scores every Client for the most-recently closed month, one
 * immutable snapshot each, fire-once). Account (any level) or Director. Ports Go's
 * handleRunHealthScan.
 */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { healthScanResultToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const res = await health.runScan(db(), actor);
    return json(healthScanResultToWire(res));
  });
}
