/**
 * /api/v1/admin/employees — the admin employee directory (GET). Ports Go's
 * handleListEmployees.
 *
 * Unported until O44, which is why `web-internal`'s "Karyawan" page (linked in
 * the sidebar for Director/OD) was dead in production — and why O42 could only
 * be worked around with raw SQL.
 *
 * Read goes through `readAsActor`: `employees` has the `employees_select` policy
 * (Director/OD see all; an employee sees their own row), so RLS does the row
 * scoping and this handler only enforces the coarse Director/OD gate that Go's
 * handler enforced.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { adminEmployeeToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    if (!admin.canReadAdmin(actor)) {
      // 403 with the verbatim BI message Go returns.
      return json({ error: admin.MSG_ADMIN_READ_DENIED }, 403);
    }
    const rows = await readAsActor(actor, (sql) => admin.listEmployees(sql));
    return json({ data: rows.map(adminEmployeeToWire) });
  });
}
