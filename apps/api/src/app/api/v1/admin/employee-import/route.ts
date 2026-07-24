/**
 * /api/v1/admin/employee-import — bulk-import employees from a CSV (POST).
 *
 * Director-only (employee/role management is Director scope — CLAUDE.md §6,
 * mirror of Go's admin endpoints). Runs the whole import in one transaction:
 * sync `employees`, provision missing credentials, link GoTrue users
 * (no-op off Supabase). Body: { csv: string, full?: boolean }.
 *
 * NOTE: the GoTrue link step (`import_employee_credentials`) is a documented
 * human gate for real data on Supabase (verify GoTrue column versions first —
 * HANDOFF_FASE1_SESI4 §5); off Supabase it reports linked: 0.
 */
import { permission } from '@cdps/core';
import { employees } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json, readJson } from '@/lib/http';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    if (!permission.canManageAdmin(actor)) {
      // 403 — authenticated but not a Director.
      return json({ error: 'forbidden: Director role required' }, 403);
    }
    const body = await readJson<{ csv?: string; full?: boolean }>(request);
    if (typeof body.csv !== 'string' || body.csv.trim() === '') {
      throw new BadRequestError('field "csv" (string) is required');
    }
    const source = new employees.CsvEmployeeSource(body.csv, 'upload');
    const result = await employees.importEmployees(db(), source, actor.employeeId, {
      full: body.full === true,
    });
    return json({ result });
  });
}
