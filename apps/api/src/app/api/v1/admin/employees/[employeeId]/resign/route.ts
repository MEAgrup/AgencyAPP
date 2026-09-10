/**
 * POST /api/v1/admin/employees/{employeeId}/resign — permanently revoke one
 * employee's CDPS access (owner decision 2026-09-10).
 *
 * A SEPARATE route from the `PUT` next door on purpose: a mutasi edits a field
 * and is routinely repeated, while this is a one-way door. Folding it into the
 * same handler behind a flag would make "move this person" and "end this
 * person's access" one request shape, and the two do not deserve the same
 * blast radius.
 *
 * Gate (Director OR HR-division Lead), the irreversibility, the GoTrue ban, the
 * session revocation and the audit row all live in the domain layer
 * (`admin.resignEmployee`), mirroring how the mutasi route delegates.
 *
 * Privileged client, like every other admin write: `set_employee_banned()` is
 * service-role only and the write bypasses RLS.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { resignResultToWire } from '@/lib/wire';

interface ResignBody {
  alasan?: string;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ employeeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { employeeId } = await ctx.params;
    const body = await readJson<ResignBody>(request);
    const result = await admin.resignEmployee(db(), actor, employeeId, {
      alasan: body.alasan ?? '',
    });
    return json({ data: resignResultToWire(result) });
  });
}
