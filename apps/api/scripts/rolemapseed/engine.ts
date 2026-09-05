/**
 * The DB-touching half of `rolemapseed` — port of Go's
 * `archive/backend-go/cmd/rolemapseed/engine.go`.
 *
 * Two phases, in this order, and the order is the point:
 *
 *   1. VALIDATE everything — row format (already done by `csv.ts`) plus every
 *      layered-role `employee_id` against the `employees` table. Nothing is
 *      written while anything is still unknown.
 *   2. Only then, iff `apply`, write through `admin.upsertRoleMapping` /
 *      `admin.setLayeredRole`.
 *
 * Phase 1 exists because a layered role is the most powerful grant in CDPS. A
 * typo'd NIK in the layered CSV must abort the WHOLE run, not land 22 role
 * mappings and then fail — a half-seeded permission table is the one state
 * nobody can reason about afterwards.
 *
 * There is no "create vs update" distinction to report (unlike mslseed's MSL
 * versions): both domain calls are plain idempotent upserts that write their own
 * audit rows, so every valid row is simply "mapped"/"layered" whether this is the
 * first run or the tenth.
 */

import { type Sql } from '@cdps/db';
import { admin } from '@cdps/domain';
import { permission } from '@cdps/core';
import type { LayeredRoleRow, RoleMappingRow } from './csv';

/** Tally of one Execute run (dry-run or apply). */
export interface Report {
  roleMappings: number;
  layeredRoles: number;
}

/**
 * execute validates then (iff apply) writes. Throws on an unknown layered-role
 * employee_id or any write failure; the caller maps that to a non-zero exit.
 */
export async function execute(
  sql: Sql,
  actor: permission.Actor,
  roleRows: RoleMappingRow[],
  layeredRows: LayeredRoleRow[],
  apply: boolean,
  out: (line: string) => void,
): Promise<Report> {
  // --- Phase 1: every layered-role employee must already exist -------------
  const unknown: string[] = [];
  for (const row of layeredRows) {
    const found = await sql<{ employee_id: string }[]>`
      select employee_id from employees where employee_id = ${row.employeeId}`;
    if (found.length === 0) {
      unknown.push(`baris ${row.line}: employee_id ${row.employeeId} tidak ada di tabel employees`);
    }
  }
  if (unknown.length > 0) {
    // Employees are synced BEFORE role mappings (the bootstrap runbook order);
    // an unknown NIK here almost always means that step was skipped.
    throw new Error(
      `${unknown.length} layered role menunjuk karyawan yang tidak ada — sync employees dulu. ` +
      unknown.join('; '),
    );
  }

  // --- Phase 2: write (or just report the plan) ----------------------------
  const report: Report = { roleMappings: 0, layeredRoles: 0 };

  for (const row of roleRows) {
    if (apply) {
      await admin.upsertRoleMapping(sql, actor, {
        divisi: row.divisi, jabatan: row.jabatan, division: row.division, level: row.level,
      });
    }
    out(`${apply ? 'MAP  ' : 'PLAN '} ${row.divisi} / ${row.jabatan} -> ${row.division} / ${row.level}`);
    report.roleMappings++;
  }

  for (const row of layeredRows) {
    if (apply) {
      await admin.setLayeredRole(sql, actor, row.employeeId, row.role, true);
    }
    out(`${apply ? 'LAYER' : 'PLAN '} ${row.employeeId} -> ${row.role}`);
    report.layeredRoles++;
  }

  return report;
}
