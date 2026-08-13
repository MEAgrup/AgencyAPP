/**
 * Modul Interview — the read-scope parity gate: the TS permission predicate must
 * agree, role-for-role, with what RLS actually returns. Two surfaces:
 *
 *   - `interview` (full record): Account scope only — the table's RLS default-
 *     denies Sales and other divisions.
 *   - `interview_verdict` (the additive view): verdict + prasyarat, Account scope
 *     PLUS Sales (closing salesperson or a Sales lead).
 *
 * For each of the seven roles we compute the TS predicate AND run the query under
 * `withClaims` (the identical role-switch + claim injection apps/api's
 * `readAsActor` performs), then assert the two agree. A divergence is exactly the
 * class of bug this file exists to catch: a TS check that lets a row through RLS
 * hides, or hides a row RLS would return.
 *
 * Skipped unless DATABASE_URL is set. Rows are namespaced `ZZV-`/`CLI-ZZV-` and
 * committed (RLS runs in its own transaction), then removed in afterAll.
 */
import { permission } from '@cdps/core';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as interview from './interview';
import type { Actor } from './account';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER_AM = 'EMP-0001';
const SALES_CLOSING = 'EMP-0006';
const CLI = 'CLI-ZZV-0001';
const ITV = 'ITV-ZZV-0001';

const claims = (o: { employeeId: string; division?: string; level?: string; od?: boolean; director?: boolean }): string =>
  JSON.stringify({
    app_metadata: {
      employee_id: o.employeeId,
      division: o.division ?? '',
      level: o.level ?? '',
      od: o.od ?? false,
      director: o.director ?? false,
    },
  });

const actor = (o: { employeeId: string; division?: string; level?: string; od?: boolean; director?: boolean }): Actor => ({
  employeeId: o.employeeId,
  divisi: o.division ?? '',
  role: permission.makeRole({ division: o.division ?? '', level: o.level ?? '', od: o.od, director: o.director }),
});

/** The seven roles, each with the claim envelope RLS reads and the matching Actor. */
const ROLES: { name: string; claim: Parameters<typeof actor>[0] }[] = [
  { name: 'assigned AM (owner)', claim: { employeeId: OWNER_AM, division: 'Account', level: 'staff' } },
  { name: 'Account lead/SPV', claim: { employeeId: 'EMP-0003', division: 'Account', level: 'lead' } },
  { name: 'OD (read-all)', claim: { employeeId: 'EMP-0004', od: true } },
  { name: 'Director (read-all)', claim: { employeeId: 'EMP-0005', director: true } },
  { name: 'non-owner AM', claim: { employeeId: 'EMP-0002', division: 'Account', level: 'staff' } },
  { name: 'Sales closing', claim: { employeeId: SALES_CLOSING, division: 'Sales', level: 'staff' } },
  { name: 'other division (Creative)', claim: { employeeId: 'EMP-0008', division: 'Creative', level: 'staff' } },
];

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                         sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
    values (${CLI}, 'PIC', 'Toko', 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
            ${SALES_CLOSING}, ${SALES_CLOSING}, ${OWNER_AM}, ${OWNER_AM})
    on conflict (id) do nothing`;
  await sql`
    insert into interview (id, client_id, am_pengisi_id, sales_closing_id, status, created_by)
    values (${ITV}, ${CLI}, ${OWNER_AM}, ${SALES_CLOSING}, 'Selesai', ${OWNER_AM})
    on conflict (id) do nothing`;
  await sql`
    insert into interview_kualifikasi
      (interview_id, skor_kualifikasi, skor_per_blok, verdict_kualifikasi, hambatan_mendasar,
       margin_bersih_basis, kualitas_data, config_snapshot, dihitung_oleh)
    values (${ITV}, 60, '{"A":20,"B":15,"C":14,"D":6,"E":5}'::jsonb, 'bersyarat', '[]'::jsonb,
            'bersih_klien', 'terverifikasi', '{}'::jsonb, 'SYSTEM')
    on conflict (interview_id) do nothing`;
  await sql`
    insert into interview_riset_awal (interview_id, dimulai_oleh)
    values (${ITV}, ${OWNER_AM})
    on conflict (interview_id) do nothing`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from interview where id = ${ITV}`;
  await sql`delete from clients where id = ${CLI}`;
  await sql.end();
});

dDb('interview full-record scope: TS predicate == RLS', () => {
  it.each(ROLES)('$name', async ({ claim }) => {
    const tsAllows = interview.canReadInterview(actor(claim), OWNER_AM);
    const rlsRows = await withClaims(sql, claims(claim), (tx) => tx<{ id: string }[]>`select id from interview where id = ${ITV}`);
    expect(rlsRows.length > 0).toBe(tsAllows);
  });
});

dDb('interview_verdict view scope: TS predicate == RLS', () => {
  it.each(ROLES)('$name', async ({ claim }) => {
    const tsAllows = interview.canReadVerdict(actor(claim), OWNER_AM, SALES_CLOSING);
    const rlsRows = await withClaims(sql, claims(claim), (tx) =>
      tx<{ interview_id: string }[]>`select interview_id from interview_verdict where interview_id = ${ITV}`,
    );
    expect(rlsRows.length > 0).toBe(tsAllows);
  });

  it('the view exposes ONLY verdict + prasyarat (no score/breakdown/answers columns)', async () => {
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'interview_verdict' order by column_name`;
    const names = cols.map((c) => c.column_name).sort();
    expect(names).toEqual(['client_id', 'contract_id', 'interview_id', 'prasyarat_status', 'sales_closing_id', 'verdict_kualifikasi']);
    // The score/breakdown/margin columns must NOT be reachable through this view.
    for (const forbidden of ['skor_kualifikasi', 'skor_per_blok', 'margin_bersih', 'hambatan_mendasar']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

/**
 * Riset Awal carries the client's store baseline — the same hard-internal class
 * as Blok B, NOT the verdict surface. Its policy must therefore track
 * `canReadInterview` (Account scope), which in particular means the closing
 * salesperson does NOT see it even though they do see the verdict.
 */
dDb('interview_riset_awal scope: TS predicate == RLS (Account-only, never Sales)', () => {
  it.each(ROLES)('$name', async ({ claim }) => {
    const tsAllows = interview.canReadInterview(actor(claim), OWNER_AM);
    const rlsRows = await withClaims(sql, claims(claim), (tx) =>
      tx<{ interview_id: string }[]>`select interview_id from interview_riset_awal where interview_id = ${ITV}`,
    );
    expect(rlsRows.length > 0).toBe(tsAllows);
  });

  it('is invisible to the closing salesperson, who can still read the verdict', async () => {
    const salesClaim = { employeeId: SALES_CLOSING, division: 'Sales', level: 'staff' };
    const riset = await withClaims(sql, claims(salesClaim), (tx) =>
      tx<{ interview_id: string }[]>`select interview_id from interview_riset_awal where interview_id = ${ITV}`,
    );
    const verdict = await withClaims(sql, claims(salesClaim), (tx) =>
      tx<{ interview_id: string }[]>`select interview_id from interview_verdict where interview_id = ${ITV}`,
    );
    expect(riset.length).toBe(0);
    expect(verdict.length).toBe(1);
  });
});
