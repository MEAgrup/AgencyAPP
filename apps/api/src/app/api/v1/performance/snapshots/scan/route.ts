/** POST /api/v1/performance/snapshots/scan — the monthly Team Performance snapshot sweep (M14 §5.4, Director only). */
import { performance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { perfScanResultToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    return json(perfScanResultToWire(await performance.runScan(db(), actor, new Date())));
  });
}
