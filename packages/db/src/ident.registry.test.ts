/**
 * M6A §7 — the prefix collision-proofing CI check.
 *
 * The PRD asks for two mechanisms rather than trusting the choice of `STRG` over
 * `STR`: (1) the `entity_prefix` table, whose PK makes a duplicate impossible;
 * (2) "a CI test that scans the codebase for ID-generating call sites and fails
 * the build if any prefix is absent from `entity_prefix` or if two entities
 * resolve to the same prefix". This file is (2).
 *
 * It earned its keep on the first run: three prefixes were minting IDs in
 * production while registered nowhere in TS — `ACT` (prospect activity), `LDR`
 * (lead delete request) and `DEMO` (demo task) all called the untyped executor
 * `ex.ident.identNext('…')` directly instead of the `nextId` wrapper that checks
 * `isRegisteredPrefix`, so the guard never ran. Meanwhile `DBR` sat in
 * `PREFIXES` used by no call site at all. A registry nobody is forced to consult
 * is just a comment; the scan is the part that makes it a registry.
 *
 * Lives in `@cdps/db` rather than `@cdps/core` because it needs both halves:
 * the TS registry (core) and a Postgres connection (db). `core` deliberately has
 * no `postgres` or `@types/node` dependency.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ident } from '@cdps/core';
import { createClient, type Sql } from './client';

// Repo root from packages/db/src.
const ROOT = resolve(__dirname, '..', '..', '..');
const SCAN_DIRS = ['packages', 'apps'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every way a prefix literal can reach `ident_next`:
 *   - `ident.nextId(ex.ident, 'CLI', now)` — the typed wrapper;
 *   - `ex.ident.identNext('CLI', now)`     — the raw executor;
 *   - `select ident_next('CLI', …)`        — SQL called inline from TS.
 * A spelling this regex misses is a hole in the check, so it anchors on the call
 * NAME rather than on a particular receiver expression.
 */
const CALL_SITE_RE =
  /(?:nextId\s*\([^,)]*,\s*|identNext\s*\(\s*|ident_next\s*\(\s*)['"]([A-Z][A-Z0-9]{1,15})['"]/g;

interface CallSite {
  prefix: string;
  file: string;
}

function scanCallSites(): CallSite[] {
  const found: CallSite[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(CALL_SITE_RE)) {
        found.push({ prefix: m[1], file: file.slice(ROOT.length + 1) });
      }
    }
  }
  return found;
}

describe('M6A §7 prefix registry — source scan', () => {
  const sites = scanCallSites();

  it('finds ID-generating call sites at all (guards against a dead regex)', () => {
    // A rename of the minting helpers would make this file pass by scanning
    // nothing, which is worse than failing — so anchor on a floor.
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it('every prefix at an ID-generating call site is registered in PREFIXES', () => {
    const unregistered = sites
      .filter((s) => !ident.isRegisteredPrefix(s.prefix))
      .map((s) => `${s.prefix} (${s.file})`)
      .sort();
    expect(unregistered).toEqual([]);
  });

  it('no two entities resolve to the same prefix', () => {
    // Prefix uniqueness itself is a language guarantee (object keys), so the
    // failure mode worth catching is the reverse: one entity registered under
    // two prefixes, which would give it two independent ID spaces.
    const byEntity = new Map<string, string[]>();
    for (const [prefix, info] of Object.entries(ident.PREFIXES)) {
      byEntity.set(info.entity, [...(byEntity.get(info.entity) ?? []), prefix]);
    }
    const duplicated = [...byEntity.entries()]
      .filter(([, prefixes]) => prefixes.length > 1)
      .map(([entity, prefixes]) => `${entity} → ${prefixes.join(', ')}`);
    expect(duplicated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The DB half: `entity_prefix` must match `PREFIXES` exactly, both directions.
// A prefix present in one and absent from the other is the divergence M6A §7
// exists to prevent — the same "TS predicate and DB check must not diverge"
// shape as the frozen invariants elsewhere in CDPS.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('M6A §7 prefix registry — entity_prefix table', () => {
  it('contains exactly the prefixes in PREFIXES', async () => {
    const rows = await sql<{ prefix: string }[]>`select prefix from entity_prefix order by prefix`;
    const inDb = rows.map((r) => r.prefix).sort();
    const inTs = Object.keys(ident.PREFIXES).sort();
    expect(inDb).toEqual(inTs);
  });

  it('registers STRG / PLAN / VND so M6A/6B/6C can mint ids', async () => {
    const rows = await sql<{ prefix: string; module: string }[]>`
      select prefix, module from entity_prefix
       where prefix in ('STRG', 'PLAN', 'VND') order by prefix`;
    expect(rows).toEqual([
      { prefix: 'PLAN', module: 'M6B' },
      { prefix: 'STRG', module: 'M6A' },
      { prefix: 'VND', module: 'M6A' },
    ]);
  });

  it('cannot register a duplicate prefix (the PK is the real guarantee)', async () => {
    await expect(
      sql`insert into entity_prefix (prefix, entity_name, module) values ('STRG', 'dobel', 'ZZ')`,
    ).rejects.toThrow();
  });
});
