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
 *
 * POST adds ONE employee manually (the "bukan lewat sheets" path) — same end
 * state as a one-row CSV import (upsert + credential provision + GoTrue link +
 * audit), gated Director OR HR-division Lead. Privileged client, gate in domain.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
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

interface NewEmployeeBody {
  employee_id?: string;
  nama?: string;
  email?: string;
  divisi?: string;
  jabatan?: string;
  status_aktif?: boolean;
  temp_password?: string;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<NewEmployeeBody>(request);
    const result = await admin.addEmployeeManually(db(), actor, {
      employeeId: body.employee_id ?? '',
      nama: body.nama ?? '',
      email: body.email ?? '',
      divisi: body.divisi ?? '',
      jabatan: body.jabatan ?? '',
      statusAktif: body.status_aktif ?? true,
      tempPassword: body.temp_password ?? '',
    });
    return json({ result });
  });
}
