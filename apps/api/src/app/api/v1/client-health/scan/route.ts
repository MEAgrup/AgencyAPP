/**
 * POST /api/v1/client-health/scan — M13 §5.2: run the monthly Client Health
 * snapshot sweep (score every Client for the most-recently CLOSED WIB month and
 * write one immutable CHR- snapshot each, firing EvClientBandDrop on a band drop).
 * Idempotent. Gated to Account (any level) or Director; a read-only OD is rejected
 * (403). Ports Go's RunScan.
 */
import { health } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { scanResultToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const res = await health.runScan(db(), actor);
    return json(scanResultToWire(res));
  });
}
