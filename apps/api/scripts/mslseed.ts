/**
 * mslseed — load the MSL v2 calculator canonical seed
 * (`supabase/seed/msl_kalkulator.csv`, 32 services) into the Master Service List
 * on the Supabase stack.
 *
 * Port of Go's `backend/cmd/mslseed` (C-04, `docs/backlog/CUTOVER_BACKLOG.md`
 * §C-04 item 4: `master_services` is still 0 rows on live, and NOTHING can be
 * closed until the MSL is populated). Writes go through
 * `msl.createService`/`msl.updateService` ONLY, so every row is validated,
 * versioned and audited by exactly the code path the admin UI (`/master-services`)
 * uses — the CLI adds no privileged shortcut of its own.
 *
 * Usage (dry-run FIRST — importer convention):
 *
 *   DATABASE_URL=postgres://... npm run msl:seed -w @cdps/api -- --actor EMP-0006
 *   DATABASE_URL=postgres://... npm run msl:seed -w @cdps/api -- --actor EMP-0006 --apply
 *
 * --actor must be an employee_id that passes `msl.canEditMasterServices` — Sales
 * Head/SPV (division=Sales, level=lead) or a layered Director. A plain
 * salesperson is denied with the exact BI message
 * `[anda tidak memiliki akses untuk mengubah master service list]`.
 *
 * Idempotent by service NAME at each row's `effective_from`: none found ->
 * create; found but a seeded field differs -> NEW version; identical -> skip.
 * Rerunning the same CSV is therefore a no-op (32 skipped).
 *
 * Env:
 *   DATABASE_URL           required — Supabase pooler URL (or a local Postgres).
 *   CDPS_MSL_SEED_CSV      optional — override the seed CSV path.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { msl } from '@cdps/domain';
import { parseCsv } from './mslseed/csv';
import { execute } from './mslseed/engine';

interface Options {
  actor: string;
  csv: string;
  apply: boolean;
}

/** Default seed path, resolved from this file rather than the cwd. */
function defaultCsvPath(): string {
  return process.env.CDPS_MSL_SEED_CSV ??
    fileURLToPath(new URL('../../../supabase/seed/msl_kalkulator.csv', import.meta.url));
}

const USAGE = `usage: mslseed --actor <employee_id> [--csv path] [--apply]

  --actor <employee_id>  pelaksana (wajib: Sales Head/SPV Sales atau Director)
  --csv <path>           path CSV MSL kalkulator (default: supabase/seed/msl_kalkulator.csv)
  --apply                tulis ke DB (default: dry-run, WAJIB dry-run dulu)

env: DATABASE_URL (wajib), CDPS_MSL_SEED_CSV (opsional)`;

/** parseArgs reads argv; returns null when usage should be printed. */
function parseArgs(argv: string[]): Options | null {
  const opts: Options = { actor: '', csv: defaultCsvPath(), apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') {
      opts.apply = true;
    } else if (a === '--actor') {
      opts.actor = argv[++i] ?? '';
    } else if (a.startsWith('--actor=')) {
      opts.actor = a.slice('--actor='.length);
    } else if (a === '--csv') {
      opts.csv = argv[++i] ?? '';
    } else if (a.startsWith('--csv=')) {
      opts.csv = a.slice('--csv='.length);
    } else if (a === '--help' || a === '-h') {
      return null;
    } else {
      process.stderr.write(`mslseed: argumen tidak dikenal: ${a}\n`);
      return null;
    }
  }
  if (opts.actor === '') {
    process.stderr.write('mslseed: --actor wajib diisi\n');
    return null;
  }
  if (opts.csv === '') {
    process.stderr.write('mslseed: --csv kosong\n');
    return null;
  }
  return opts;
}

/**
 * resolveActor builds the Actor for an employee_id using the SAME resolver the
 * Access Token Hook and RLS use — the SQL `employee_claims(employee_id)` function
 * (migration 20260102000004, itself a mirror of Go's `auth.ResolveActor`) piped
 * through `permission.actorFromClaims`. Re-deriving the role in TypeScript here
 * would be a fourth copy of the mapping, free to drift; this way the CLI cannot
 * grant itself a role the JWT path would not.
 *
 * This is an operator CLI, not a request path: there is no token to verify.
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
    process.stderr.write('mslseed: DATABASE_URL belum di-set\n');
    return 2;
  }

  let text: string;
  try {
    text = await readFile(opts.csv, 'utf8');
  } catch (e) {
    process.stderr.write(`mslseed: buka csv ${opts.csv}: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  let rows;
  try {
    rows = parseCsv(text);
  } catch (e) {
    process.stderr.write(`mslseed: parse csv ${opts.csv}: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const sql = createClient(url);
  try {
    let actor: permission.Actor;
    try {
      actor = await resolveActor(sql, opts.actor);
    } catch (e) {
      process.stderr.write(`mslseed: resolve actor ${opts.actor}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }

    const out = (line: string): void => {
      process.stdout.write(`${line}\n`);
    };
    out(opts.apply
      ? 'mslseed: APPLY — menulis ke DB'
      : 'mslseed: DRY-RUN (tidak menulis; pakai --apply untuk menulis)');
    out(`mslseed: ${rows.length} baris dari ${opts.csv}, actor=${actor.employeeId} ` +
        `(${actor.role.division || '-'}/${actor.role.level || '-'}${actor.role.director ? '+director' : ''})`);

    try {
      await execute(sql, actor, rows, opts.apply, out);
    } catch (e) {
      process.stderr.write(`mslseed: ${e instanceof Error ? e.message : String(e)}\n`);
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
    process.stderr.write(`mslseed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(1);
  },
);
