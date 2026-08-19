/**
 * Mesin Laporan Klien (C1) — the DB half of the engine, asserted against the TS half.
 *
 * Two things can silently rot between `report_benchmark` versi 1 and
 * `REPORT_BENCH_V1` in `packages/core/src/report/bench.ts`: a threshold edited on
 * one side only, or a key added on one side only. Either produces reports that
 * cannot be recomputed from the version they claim to have used — the exact
 * failure house rule #4 exists to prevent, and one a row COUNT would never see.
 * So the assertion here is by NAME and by VALUE.
 *
 * The immutability triggers are asserted the same way: by trying the mutation and
 * requiring it to fail, not by reading `information_schema` and trusting that a
 * trigger with the right name does the right thing.
 *
 * Skipped unless DATABASE_URL is set (same convention as the other *.reals suites).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { report } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

describeDb('C1 — mesin laporan: skema DB dan TypeScript sepakat', () => {
  afterAll(async () => {
    if (sql) await sql.end();
  });

  it('report_benchmark versi 1 is value-equal to REPORT_BENCH_V1, key for key', async () => {
    const rows = await sql<{ nilai: Record<string, { good: number; warn: number }> }[]>`
      select nilai from report_benchmark where versi = 1`;
    expect(rows).toHaveLength(1);
    const db = rows[0].nilai;
    // Set-equal on keys first: an extra key on either side is a real divergence,
    // not something to be forgiven by iterating over only one side's keys.
    expect(Object.keys(db).sort()).toEqual(report.ALL_BENCH_KEYS.slice().sort());
    for (const k of report.ALL_BENCH_KEYS) {
      expect(db[k], `benchmark ${k}`).toEqual(report.REPORT_BENCH_V1[k]);
    }
  });

  it('report_benchmark is append-only — a published calibration cannot be edited or dropped', async () => {
    await expect(sql`update report_benchmark set aktif = false where versi = 1`).rejects.toThrow(/append-only/);
    await expect(sql`delete from report_benchmark where versi = 1`).rejects.toThrow(/append-only/);
  });

  it('client_reports rejects a period type outside mingguan|bulanan', async () => {
    await expect(sql`
      insert into client_reports (client_id, client_platform_id, platform, periode_tipe,
        periode_mulai, periode_akhir, hari_periode, payload, gmv_net, gmv_kotor,
        gmv_runrate_bulanan, benchmark_versi, engine_versi, created_by)
      values ('CLI-NOPE-0001', 1, 'TikTok Shop', 'harian', '2026-08-01', '2026-08-31', 31,
        '{}'::jsonb, 0, 0, 0, 1, ${report.ENGINE_VERSI}, 'SYSTEM')
    `).rejects.toThrow();
  });

  it('client_reports refuses a zero run-rate when GMV is not zero (the unit total_sales reads)', async () => {
    // ck_report_runrate: a non-zero GMV that produced a zero run-rate means the
    // pro-rating divided wrong, and `clients.total_sales` would inherit the lie.
    await expect(sql`
      insert into client_reports (client_id, client_platform_id, platform, periode_tipe,
        periode_mulai, periode_akhir, hari_periode, payload, gmv_net, gmv_kotor,
        gmv_runrate_bulanan, benchmark_versi, engine_versi, created_by)
      values ('CLI-NOPE-0001', 1, 'TikTok Shop', 'bulanan', '2026-08-01', '2026-08-31', 31,
        '{}'::jsonb, 100, 100, 0, 1, ${report.ENGINE_VERSI}, 'SYSTEM')
    `).rejects.toThrow();
  });

  it('every report table carries RLS, and report_benchmark is default-deny', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean; n: number }[]>`
      select c.relname, c.relrowsecurity,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname)::int as n
        from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public'
         and c.relname in ('client_reports', 'client_report_berkas', 'report_benchmark')
       order by c.relname`;
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.relrowsecurity, `${r.relname} RLS`).toBe(true);
    // Thresholds are read only through the service role while scoring — giving
    // `authenticated` a policy would let them be reverse-engineered.
    expect(rows.find((r) => r.relname === 'report_benchmark')!.n).toBe(0);
    expect(rows.find((r) => r.relname === 'client_reports')!.n).toBeGreaterThan(0);
    expect(rows.find((r) => r.relname === 'client_report_berkas')!.n).toBeGreaterThan(0);
  });
});
