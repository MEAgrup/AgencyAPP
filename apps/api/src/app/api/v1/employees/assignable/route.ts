/**
 * /api/v1/employees/assignable — the employee directory behind every assignment
 * dropdown (M6 §3 AM, M6 §5 Brief PIC, M12 §5.3 Task PIC, M7 §2 Asset PIC,
 * M9 §3 Booking Coordinator).
 *
 * A SEPARATE endpoint from `GET /admin/employees`, not a query parameter on it,
 * for the same reason `/marketing/campaigns/selectable` is separate from
 * `/marketing/campaigns`: different question, different scope, different
 * projection. The admin roster is Director/OD-only and carries email +
 * flagged-for-review + sync staleness + inactive rows; this answers "who can be
 * assigned to this work", which the SPV/Head Account (neither Director nor OD)
 * needs in order to appoint an AM at all.
 *
 * Query: `?division=Creative&level=staff` — both optional, both applied in the
 * domain. The doors all validate `division + level='staff'`, so the caller asks
 * for exactly what its door will accept.
 *
 * Read through `readAsActor` like every other read (O37): the rows come from
 * `private.employee_assignable()` (SECURITY DEFINER, migration 20260805030000),
 * which is why `employees_select` can stay own-row for a normal employee and
 * `role_mappings` can stay default-deny.
 */
import { directory } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { assignableEmployeeToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;
    const list = await readAsActor(actor, (sql) =>
      directory.listAssignableEmployees(sql, actor, {
        division: params.get('division') ?? '',
        level: params.get('level') ?? '',
      }),
    );
    return json({ data: list.map(assignableEmployeeToWire) });
  });
}
