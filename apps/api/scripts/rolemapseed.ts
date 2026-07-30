/**
 * rolemapseed — load the canonical HRIS→CDPS role mapping
 * (`supabase/seed/role_mappings_riil.csv`, 23 mappings) and the layered OD/
 * Director grants (`supabase/seed/layered_roles_riil.csv`) into a CDPS
 * deployment.
 *
 * Port of Go's `backend/cmd/rolemapseed` (DECISIONS 2026-07-29 "Fase 3"). The
 * admin UI (`/admin/role-mappings`) answers EDITING one rule; it does not answer
 * seeding 23 of them plus the layered grants on a fresh deployment, which is a
 * bootstrap step (see `docs/handoff/RUNBOOK_BOOTSTRAP_DEPLOYMENT_BARU.md`) and
 * has to be mechanical and auditable rather than 23 rounds of manual typing.
 *
 * Writes go through `admin.upsertRoleMapping` / `admin.setLayeredRole` ONLY, so
 * every row is validated, gated and audited by exactly the code path the admin UI
 * uses — this CLI adds no privileged shortcut of its own.
 *
 * Idempotent: both domain calls are upserts keyed on `(divisi, jabatan)` and
 * `(employee_id, role)`, so rerunning the same CSVs re-asserts the same state.
 *
 * Usage (dry-run FIRST — importer convention):
 *
 *   DATABASE_URL=postgres://... npm run rolemap:seed -w @cdps/api -- --actor <NIK>
 *   DATABASE_URL=postgres://... npm run rolemap:seed -w @cdps/api -- --actor <NIK> --apply
 *
 * --actor must pass `admin.canWriteAdmin` (Director). A non-Director is denied
 * with the exact BI message from the domain layer.
 *
 * Env:
 *   DATABASE_URL             required — Supabase pooler URL (or a local Postgres).
 *   CDPS_ROLE_MAP_CSV        optional — override the role-mapping CSV path.
 *   CDPS_LAYERED_ROLE_CSV    optional — override the layered-role CSV path.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { parseLayeredRoleCsv, parseRoleMappingCsv } from './rolemapseed/csv';
import { execute } from './rolemapseed/engine';

interface Options {
  actor: string;
  roleCsv: string;
  layeredCsv: string;
  apply: boolean;
}

/** Default seed paths, resolved from this file rather than the cwd. */
function defaultRoleCsv(): string {
  return process.env.CDPS_ROLE_MAP_CSV ??
    fileURLToPath(new URL('../../../supabase/seed/role_mappings_riil.csv', import.meta.url));
}
function defaultLayeredCsv(): string {
  return process.env.CDPS_LAYERED_ROLE_CSV ??
    fileURLToPath(new URL('../../../supabase/seed/layered_roles_riil.csv', import.meta.url));
}

const USAGE = `usage: rolemapseed --actor <employee_id> [--role-csv path] [--layered-csv path] [--apply]

  --actor <employee_id>   pelaksana (wajib: Director)
  --role-csv <path>       CSV role mapping (default: supabase/seed/role_mappings_riil.csv)
  --layered-csv <path>    CSV layered role (default: supabase/seed/layered_roles_riil.csv)
  --apply                 tulis ke DB (default: dry-run, WAJIB dry-run dulu)

env: DATABASE_URL (wajib), CDPS_ROLE_MAP_CSV, CDPS_LAYERED_ROLE_CSV (opsional)`;

/** parseArgs reads argv; returns null when usage should be printed. */
function parseArgs(argv: string[]): Options | null {
  const opts: Options = {
    actor: '', roleCsv: defaultRoleCsv(), layeredCsv: defaultLayeredCsv(), apply: false,
  };
  const flag = (name: string, i: number): string | null => {
    const a = argv[i];
    if (a === `--${name}`) {
      return argv[i + 1] ?? '';
    }
    if (a.startsWith(`--${name}=`)) {
      return a.slice(name.length + 3);
    }
    return null;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') {
      opts.apply = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      return null;
    }
    let matched = false;
    for (const [name, key] of [
      ['actor', 'actor'], ['role-csv', 'roleCsv'], ['layered-csv', 'layeredCsv'],
    ] as const) {
      const v = flag(name, i);
      if (v !== null) {
        opts[key] = v;
        if (argv[i] === `--${name}`) {
          i++;
        }
        matched = true;
        break;
      }
    }
    if (!matched) {
      process.stderr.write(`rolemapseed: argumen tidak dikenal: ${a}\n`);
      return null;
    }
  }
  if (opts.actor === '') {
    process.stderr.write('rolemapseed: --actor wajib diisi\n');
    return null;
  }
  if (opts.roleCsv === '' || opts.layeredCsv === '') {
    process.stderr.write('rolemapseed: path CSV kosong\n');
    return null;
  }
  return opts;
}

/**
 * resolveActor builds the Actor via the SAME resolver the Access Token Hook and
 * RLS use — the SQL `employee_claims(employee_id)` function. Re-deriving the role
 * in TypeScript would be another copy of the mapping, free to drift; this way the
 * CLI cannot grant itself a role the JWT path would not. Same rationale as
 * `mslseed.ts`.
 */
async function resolveActor(sql: Sql, employeeId: string): Promise<permission.Actor> {
  const rows = await sql<{ claims: unknown }[]>`select employee_claims(${employeeId}) as claims`;
  const claims = rows[0]?.claims;
  if (!claims) {
    throw new Error(`karyawan tidak ditemukan: ${employeeId}`);
  }
  return permission.actorFromClaims(claims);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('rolemapseed: DATABASE_URL belum di-set\n');
    return 2;
  }

  let roleRows, layeredRows;
  try {
    roleRows = parseRoleMappingCsv(await readFile(opts.roleCsv, 'utf8'));
    layeredRows = parseLayeredRoleCsv(await readFile(opts.layeredCsv, 'utf8'));
  } catch (e) {
    process.stderr.write(`rolemapseed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const sql = createClient(url);
  try {
    let actor: permission.Actor;
    try {
      actor = await resolveActor(sql, opts.actor);
    } catch (e) {
      process.stderr.write(`rolemapseed: resolve actor ${opts.actor}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }

    const out = (line: string): void => {
      process.stdout.write(`${line}\n`);
    };
    out(opts.apply
      ? 'rolemapseed: APPLY — menulis ke DB'
      : 'rolemapseed: DRY-RUN (tidak menulis; pakai --apply untuk menulis)');
    out(`rolemapseed: ${roleRows.length} role mapping + ${layeredRows.length} layered role, ` +
        `actor=${actor.employeeId} (${actor.role.division || '-'}/${actor.role.level || '-'}` +
        `${actor.role.director ? '+director' : ''})`);

    try {
      const rep = await execute(sql, actor, roleRows, layeredRows, opts.apply, out);
      out(`rolemapseed: ${rep.roleMappings} role mapping, ${rep.layeredRoles} layered role` +
          `${opts.apply ? ' ditulis' : ' direncanakan'}`);
    } catch (e) {
      process.stderr.write(`rolemapseed: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
    return 0;
  } finally {
    await sql.end();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`rolemapseed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(1);
  },
);
