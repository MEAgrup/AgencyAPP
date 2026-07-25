/**
 * GET /api/v1/account/intake — the Unassigned Intake Queue (M6 §3 Rule 1):
 * every Finance-released, not-yet-assigned, non-dormant client, oldest release
 * first. Read gate (SPV/Head Account + OD/Director) is enforced in the domain.
 * Ports Go's handleAccountIntake.
 */
import { account } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { intakeClientToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await account.intakeQueue(db(), actor);
    return json({ data: rows.map(intakeClientToWire) });
  });
}
