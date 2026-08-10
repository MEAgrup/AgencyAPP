/**
 * /api/v1/admin/employees/{employeeId} — mutate one employee's divisi/jabatan
 * (PUT). A "mutasi" (transfer): the only field-level write the Karyawan page
 * offers.
 *
 * There is no Go ancestor — the roster mutation UI is TS-only. divisi+jabatan is
 * the LEFT side of a `role_mappings` row, so this can re-derive the employee's
 * CDPS role; `trg_sync_claims_employee` re-issues their claims on the next token.
 * Gate (Director OR HR-division Lead) and audit both live in the domain layer.
 *
 * Privileged client, like the role-mapping writes: the write bypasses RLS and the
 * claim-resync trigger is service-role only. The domain enforces the gate.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { adminEmployeeToWire } from '@/lib/wire';

interface AssignmentBody {
  divisi?: string;
  jabatan?: string;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ employeeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { employeeId } = await ctx.params;
    const body = await readJson<AssignmentBody>(request);
    const row = await admin.updateEmployeeAssignment(
      db(),
      actor,
      employeeId,
      body.divisi ?? '',
      body.jabatan ?? '',
    );
    return json({ data: adminEmployeeToWire(row) });
  });
}
