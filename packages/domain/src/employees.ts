/**
 * Employee importer (Fase 1 langkah 3, OQ-4).
 *
 * Ports Go's `internal/hris` sync + credential provisioning to the Supabase
 * stack, behind an `EmployeeSource` port (HTTP is production; CSV is the dev /
 * contingency fallback — Build Plan R1). Consumers depend only on the interface,
 * so swapping the source requires zero consumer changes.
 *
 * The importer NEVER raw-INSERTs a status column and NEVER writes a password to
 * the audit log. It:
 *   1. upserts `employees` (idempotent) and, on a deactivation/reactivation,
 *      routes through `set_employee_banned()` so GoTrue access follows HRIS
 *      status (deactivated in HRIS ⇒ CDPS access revoked — CLAUDE.md §Integration);
 *   2. provisions a bcrypt credential (must_change_password=true) into
 *      `employee_credentials` for any active employee that has none yet
 *      (existing credentials are never clobbered — a re-import can't reset a
 *      real user's password);
 *   3. calls `import_employee_credentials()` to mint the GoTrue `auth.users`
 *      rows (OQ-3 direct-bcrypt import), guarded so it is a no-op on a plain
 *      Postgres (CI) that has no `auth` schema.
 *
 * All three steps run in ONE transaction (see importEmployees): a failed link
 * step rolls back the sync and provisioning too.
 *
 * Reference: archive/backend-go/internal/hris/{source,sync}.go, archive/backend-go/internal/auth/local.go
 * (SetPassword), supabase/migrations/20260723071013_supabase_auth.sql.
 */

import bcrypt from 'bcryptjs';
import { auditExecutor, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** The employee record CDPS consumes from a source (mirror of Go's hris.Employee). */
export interface Employee {
  employeeId: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  statusAktif: boolean;
  /**
   * Temporary credential from the source (CSV `password` column only). Consumed
   * by provisioning; NEVER written to `employees`. Empty => DEFAULT_TEMP_PASSWORD.
   */
  password?: string;
}

/**
 * EmployeeSource abstracts where employee data comes from. Mirror of Go's
 * `hris.EmployeeSource`. A source returns a full set (the CSV fallback has no
 * incremental cursor — a full CSV is always a full sync).
 */
export interface EmployeeSource {
  fetch(): Promise<Employee[]>;
  /** Identifies the source in logs/audit (e.g. "csv:employees.csv"). */
  name(): string;
}

/**
 * The default temporary password used when a source row omits one, matching the
 * Go CSV fallback. It is only ever stored as a bcrypt hash with
 * must_change_password=true, so the employee is forced to change it on first
 * login — but it is still a shared default: prefer per-row passwords for real
 * imports.
 */
export const DEFAULT_TEMP_PASSWORD = 'rahasia123';

/** bcrypt cost, matching Go's bcrypt.DefaultCost (10). */
export const BCRYPT_COST = 10;

/**
 * parseEmployeeCsv parses the employee CSV format (header row required):
 *   employee_id,nama,email,divisi,jabatan,status_aktif[,password]
 * status_aktif is truthy for "1"/"true"/"yes"/"y"/"t" (case-insensitive).
 * A password column is optional; blank => DEFAULT_TEMP_PASSWORD at provision time.
 *
 * DATA-QUALITY GATE (ported from Go's `hris.Convert`, which retired with
 * `cmd/hrisconvert` — see DECISIONS 2026-07-29 "Fase 3"). A dirty file is
 * rejected WHOLE, before a single row is returned; nothing is dropped silently:
 *
 *   - a blank `employee_id`, `nama`, `divisi` or `jabatan` is fatal;
 *   - a DUPLICATE `employee_id` is fatal, and EVERY line carrying it is named,
 *     not just the second one.
 *
 * Both had to move here rather than stay in a converter. `syncEmployees` upserts
 * by `employee_id`, so a duplicate NIK silently means "last row wins" — one
 * employee's department quietly overwritten by another's, with no error anywhere.
 * A blank NIK is worse: it would upsert a row keyed on ''. The admin UI pastes
 * this CSV straight in, so this parser IS the gate on the production path.
 *
 * A blank `email` stays permitted (it is what Go permitted too, with a warning):
 * CDPS logs in by email, so such an employee simply cannot log in yet — real,
 * common, and not a reason to reject the whole roster.
 */
export function parseEmployeeCsv(text: string): Employee[] {
  const rows = tokenizeCsv(text);
  if (rows.length === 0) {
    return [];
  }
  // Drop the header row.
  const body = rows.slice(1);
  const out: Employee[] = [];
  const problems: string[] = [];
  /** employee_id -> every 1-based file line that carried it. */
  const seen = new Map<string, number[]>();

  for (const [i, row] of body.entries()) {
    const line = i + 2; // +1 for the dropped header, +1 for 1-based counting
    // A trailing blank line tokenizes to a single empty field — skip it.
    if (row.length === 1 && row[0].trim() === '') {
      continue;
    }
    if (row.length < 6) {
      throw new Error(`hris csv: expected >=6 columns, got ${row.length}`);
    }
    const password = row.length >= 7 ? row[6].trim() : '';
    const emp: Employee = {
      employeeId: row[0].trim(),
      nama: row[1].trim(),
      email: row[2].trim(),
      divisi: row[3].trim(),
      jabatan: row[4].trim(),
      statusAktif: parseBool(row[5]),
      password: password === '' ? undefined : password,
    };

    for (const [field, value] of [
      ['employee_id', emp.employeeId], ['nama', emp.nama],
      ['divisi', emp.divisi], ['jabatan', emp.jabatan],
    ] as const) {
      if (value === '') {
        problems.push(`baris ${line}: ${field} kosong`);
      }
    }
    if (emp.employeeId !== '') {
      seen.set(emp.employeeId, [...(seen.get(emp.employeeId) ?? []), line]);
    }
    out.push(emp);
  }

  for (const [id, lines] of seen) {
    if (lines.length > 1) {
      problems.push(`employee_id ${id} duplikat di baris ${lines.join(', ')}`);
    }
  }
  if (problems.length > 0) {
    // Reject the whole file: a partial import of a roster is harder to reason
    // about than no import, and `syncEmployees` full-mode would then flag the
    // rows that never made it as if HR had off-boarded them.
    throw new Error(`hris csv: ${problems.length} masalah kualitas data — ${problems.join('; ')}`);
  }
  return out;
}

function parseBool(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 't' || v === 'yes' || v === 'y';
}

/**
 * Minimal RFC 4180-ish CSV tokenizer: supports quoted fields containing commas,
 * newlines and doubled-quote escapes. Returns rows of raw string fields.
 */
function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      // Normalize CRLF / lone CR to a single row break.
      if (text[i + 1] === '\n') {
        i++;
      }
      pushRow();
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the final field/row unless the input ended exactly on a row break.
  if (field !== '' || row.length > 0) {
    pushRow();
  }
  return rows;
}

/** A CSV-backed EmployeeSource over already-read text (fs stays in the caller). */
export class CsvEmployeeSource implements EmployeeSource {
  constructor(
    private readonly text: string,
    private readonly label = 'inline',
  ) {}

  name(): string {
    return `csv:${this.label}`;
  }

  async fetch(): Promise<Employee[]> {
    return parseEmployeeCsv(this.text);
  }
}

/** Per-run counts from a sync (mirror of Go's hris.SyncResult, plus reactivated). */
export interface SyncResult {
  synced: number;
  deactivated: number;
  reactivated: number;
  flagged: number;
}

/**
 * syncEmployees upserts employees into `employees` (idempotent) within the
 * caller's transaction. Deactivations and reactivations route through
 * `set_employee_banned()` so GoTrue access tracks HRIS status; on a full sync,
 * employees present in CDPS but absent from the source are flagged_for_review
 * (never deleted — audit trail preserved). Every status change is audited.
 *
 * `actor` is the employee id that triggered the sync (or "SYSTEM" for scheduled).
 */
export async function syncEmployees(
  tx: Queryable,
  emps: Employee[],
  actor: string,
  opts: { full: boolean },
): Promise<SyncResult> {
  const audit = auditExecutor(tx);
  const res: SyncResult = { synced: 0, deactivated: 0, reactivated: 0, flagged: 0 };
  const present = new Set<string>();
  const now = new Date();

  for (const e of emps) {
    present.add(e.employeeId);

    const prior = await tx<{ status_aktif: boolean }[]>`
      select status_aktif from employees where employee_id = ${e.employeeId}`;
    const priorActive: boolean | null = prior.length > 0 ? prior[0].status_aktif : null;

    await tx`
      insert into employees
        (employee_id, nama, email, divisi, jabatan, status_aktif, flagged_for_review, synced_at, created_by)
      values
        (${e.employeeId}, ${e.nama}, ${e.email}, ${e.divisi}, ${e.jabatan}, ${e.statusAktif}, false, ${now}, ${actor})
      on conflict (employee_id) do update set
        nama = excluded.nama, email = excluded.email, divisi = excluded.divisi,
        jabatan = excluded.jabatan, status_aktif = excluded.status_aktif,
        flagged_for_review = false, synced_at = excluded.synced_at`;
    res.synced++;

    if (!e.statusAktif) {
      // Deactivated in the source => ban in GoTrue (no-op on plain PG). Count a
      // deactivation only on a transition from active/unknown to inactive.
      await tx`select set_employee_banned(${e.employeeId}, true)`;
      if (priorActive === null || priorActive === true) {
        res.deactivated++;
        await audit.insertAudit({
          entityType: 'employee', entityId: e.employeeId, actorEmployeeId: actor,
          action: 'hris_sync:deactivated', beforeJson: null,
          afterJson: { status_aktif: false }, createdBy: actor,
        });
      }
    } else if (priorActive === false) {
      // Reactivated => lift the ban and audit it.
      await tx`select set_employee_banned(${e.employeeId}, false)`;
      res.reactivated++;
      await audit.insertAudit({
        entityType: 'employee', entityId: e.employeeId, actorEmployeeId: actor,
        action: 'hris_sync:reactivated', beforeJson: null,
        afterJson: { status_aktif: true }, createdBy: actor,
      });
    }
  }

  if (opts.full) {
    const rows = await tx<{ employee_id: string }[]>`
      select employee_id from employees where flagged_for_review = false`;
    for (const r of rows) {
      if (present.has(r.employee_id)) {
        continue;
      }
      await tx`update employees set flagged_for_review = true where employee_id = ${r.employee_id}`;
      res.flagged++;
      await audit.insertAudit({
        entityType: 'employee', entityId: r.employee_id, actorEmployeeId: actor,
        action: 'hris_sync:flagged_absent', beforeJson: null,
        afterJson: { flagged_for_review: true }, createdBy: actor,
      });
    }
  }

  return res;
}

/**
 * provisionCredentials writes a bcrypt credential (must_change_password=true)
 * for every ACTIVE employee in `emps` that has no credential row yet, within the
 * caller's transaction. Existing credentials are left untouched (idempotent — a
 * re-import never resets a real password). Returns the number provisioned.
 * The plaintext temp password is bcrypt-hashed here and never audited.
 */
export async function provisionCredentials(
  tx: Queryable,
  emps: Employee[],
  actor: string,
): Promise<number> {
  const audit = auditExecutor(tx);
  let provisioned = 0;
  for (const e of emps) {
    if (!e.statusAktif) {
      continue; // inactive employees are never given login credentials
    }
    const temp = e.password && e.password.length > 0 ? e.password : DEFAULT_TEMP_PASSWORD;
    const hash = bcrypt.hashSync(temp, BCRYPT_COST);
    const inserted = await tx<{ employee_id: string }[]>`
      insert into employee_credentials
        (employee_id, password_hash, must_change_password, failed_attempts, locked_until, created_by)
      values
        (${e.employeeId}, ${hash}, true, 0, null, ${actor})
      on conflict (employee_id) do nothing
      returning employee_id`;
    if (inserted.length === 0) {
      continue; // already provisioned
    }
    provisioned++;
    await audit.insertAudit({
      entityType: 'employee_credential', entityId: e.employeeId, actorEmployeeId: actor,
      action: 'password_set_admin', beforeJson: null,
      afterJson: { must_change_password: true }, createdBy: actor,
    });
  }
  return provisioned;
}

/**
 * linkAuthUsers runs `import_employee_credentials()` to mint GoTrue rows for
 * newly-provisioned active employees, returning the count linked. It is guarded:
 * on a plain Postgres without an `auth` schema (CI/local) the SQL function would
 * RAISE, so we skip it and return 0. On Supabase it runs (service-role required).
 */
export async function linkAuthUsers(tx: Queryable): Promise<number> {
  const probe = await tx<{ has: boolean }[]>`select to_regclass('auth.users') is not null as has`;
  if (!probe[0]?.has) {
    return 0;
  }
  const rows = await tx<{ n: number }[]>`select import_employee_credentials() as n`;
  return Number(rows[0].n);
}

/** Full result of an import run. */
export interface ImportResult {
  source: string;
  sync: SyncResult;
  provisioned: number;
  linked: number;
}

/**
 * importEmployees runs the whole employee import in ONE transaction: fetch from
 * the source, sync `employees`, provision missing credentials, then link GoTrue
 * users. Any failure rolls the whole thing back.
 *
 * Write connection must be service-role/privileged (the SQL functions it calls —
 * set_employee_banned / import_employee_credentials — are SECURITY DEFINER and
 * granted to service_role only; RLS is the read safety net, writes go via RPC).
 */
export async function importEmployees(
  sql: Sql,
  source: EmployeeSource,
  actor: string,
  opts: { full: boolean },
): Promise<ImportResult> {
  const emps = await source.fetch();
  return withTransaction(sql, async (tx) => {
    const sync = await syncEmployees(tx, emps, actor, opts);
    const provisioned = await provisionCredentials(tx, emps, actor);
    const linked = await linkAuthUsers(tx);
    return { source: source.name(), sync, provisioned, linked };
  });
}
