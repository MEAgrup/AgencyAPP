/**
 * POST /api/v1/performance/snapshots/scan — M14 §3 / §5.4: run the monthly Team
 * Performance sweep, writing one immutable per-staff snapshot for the most-recently
 * closed WIB calendar month. Director only (the sweep spans every division).
 * Idempotent — a re-run finds the snapshots already present. Ports Go's
 * handleRunPerfScan.
 */
import { performance } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const res = await performance.runScan(db(), actor, new Date());
    return json({ period: res.period, snapshots_made: res.snapshotsMade });
  });
}
