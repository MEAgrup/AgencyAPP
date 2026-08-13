/**
 * D-04 — the M6D manual fallback + `—` + text-note paths under REAL RLS +
 * CHECK. Complements `recap.reals.test.ts` (D-03 auto-block invariant): D-03
 * proved an AM cannot touch an `otomatis` figure; D-04 proves the AM CAN complete
 * the RM-C fallback, and that the evidence rule bites.
 *
 * §4 / §9 · RM-C3/C4/C5 ("W (isi atau `—`)") / RM-C7 (manual evidence) / RM-C9
 * (text notepad). Driven through `withClaims` so the RLS `WITH CHECK`, the
 * `guard_wrr_metrik_no_manual_auto` trigger, and the `ck_wrr_metrik_manual_bukti`
 * CHECK all actually run:
 *
 *   1. a manual figure WITH file_bukti + tanggal_ambil is accepted (isi);
 *   2. a manual figure WITHOUT evidence is refused (RM-C7 CHECK) — the gap D-04
 *      closes; and a partial (file, no date) is refused too;
 *   3. the AM can affirmatively mark `—` (`tidak_tersedia`, nilai NULL, no
 *      evidence) — the "atau `—`" half D-03's braces did not admit;
 *   4. `otomatis` is STILL refused from the widened INSERT (invariant intact);
 *   5. RM-C9 `catatan_metrik_tambahan` stores free text on wrr_catatan.
 *
 * Skipped unless DATABASE_URL is set. Rows are namespaced `ZZM-` and removed in
 * afterEach. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, withClaims, type Sql } from '@cdps/db';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const OWNER_AM = 'ZZM-AM';
const CLI = 'ZZM-CLI-0001';
const RECAP = 'ZZM-WRR-0001';

/** Serializes the claim envelope exactly as apps/api `actorClaims` does. */
const claims = (o: { employeeId: string; division?: string; level?: string }): string =>
  JSON.stringify({
    app_metadata: {
      employee_id: o.employeeId,
      division: o.division ?? '',
      level: o.level ?? '',
      od: false,
      director: false,
    },
  });

const amClaims = claims({ employeeId: OWNER_AM, division: 'Account', level: 'staff' });

async function seed(): Promise<void> {
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${CLI}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZM-SALES', 'ZZM-SALES', ${OWNER_AM}, now(), ${OWNER_AM})
    on conflict (id) do nothing`;
  await sql`
    insert into weekly_result_recap
      (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
    values (${RECAP}, ${CLI}, null, 2026, 36, '2026-08-31', '2026-09-06', 'Terbuka', 'SYSTEM')
    on conflict (id) do nothing`;
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from wrr_metrik where recap_id = ${RECAP}`;
  await sql`delete from wrr_catatan where recap_id = ${RECAP}`;
  await sql`delete from weekly_result_recap where id = ${RECAP}`;
  await sql`delete from clients where id = ${CLI}`;
});

afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('M6D manual fallback + `—` + text (D-04)', () => {
  it('accepts a manual fallback WITH evidence (RM-C7 satisfied — isi)', async () => {
    await seed();
    await withClaims(sql, amClaims, (tx) =>
      tx`insert into wrr_metrik (recap_id, metrik, sumber, nilai, file_bukti, tanggal_ambil, created_by)
         values (${RECAP}, 'ctr', 'manual', 1.8, 'ctr-export.pdf', '2026-09-07', ${OWNER_AM})`,
    );
    const rows = await sql<{ nilai: string; sumber: string }[]>`
      select nilai, sumber from wrr_metrik where recap_id = ${RECAP} and metrik = 'ctr'`;
    expect(Number(rows[0].nilai)).toBe(1.8);
    expect(rows[0].sumber).toBe('manual');
  });

  it('refuses a manual fallback with NO evidence (RM-C7 CHECK — the D-04 gap)', async () => {
    await seed();
    await expect(
      withClaims(sql, amClaims, (tx) =>
        tx`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
           values (${RECAP}, 'cvr', 'manual', 0.9, ${OWNER_AM})`,
      ),
    ).rejects.toThrow();
    const rows = await sql`select 1 from wrr_metrik where recap_id = ${RECAP} and metrik = 'cvr'`;
    expect(rows.length).toBe(0);
  });

  it('refuses a manual fallback with a file but no capture date (RM-C7 partial)', async () => {
    await seed();
    await expect(
      withClaims(sql, amClaims, (tx) =>
        tx`insert into wrr_metrik (recap_id, metrik, sumber, nilai, file_bukti, created_by)
           values (${RECAP}, 'total_view', 'manual', 92000, 'view-export.pdf', ${OWNER_AM})`,
      ),
    ).rejects.toThrow();
  });

  it('lets the AM mark `—` (tidak_tersedia, no evidence) — the "atau `—`" half', async () => {
    await seed();
    await withClaims(sql, amClaims, (tx) =>
      tx`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
         values (${RECAP}, 'ctr', 'tidak_tersedia', null, ${OWNER_AM})`,
    );
    const rows = await sql<{ nilai: string | null; sumber: string }[]>`
      select nilai, sumber from wrr_metrik where recap_id = ${RECAP} and metrik = 'ctr'`;
    expect(rows[0].nilai).toBeNull();
    expect(rows[0].sumber).toBe('tidak_tersedia');
  });

  it('STILL refuses the AM from inserting an `otomatis` figure (invariant intact)', async () => {
    await seed();
    await expect(
      withClaims(sql, amClaims, (tx) =>
        tx`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
           values (${RECAP}, 'ctr', 'otomatis', 1.8, ${OWNER_AM})`,
      ),
    ).rejects.toThrow();
  });

  it('stores RM-C9 catatan_metrik_tambahan as free text (not a metric)', async () => {
    await seed();
    // wrr_catatan authenticated write is D-09; the column exists from D-04 and the
    // system/service-role path (no JWT actor) can persist it. Content is prose —
    // no delta/rollup/score ever reads it (RM-4/RM-7/RM-11).
    await sql`
      insert into wrr_catatan (recap_id, catatan_metrik_tambahan, created_by)
      values (${RECAP}, 'CPL ~Rp. 12.000/lead, impressions 340rb (dashboard Meta 06/09)', 'SYSTEM')`;
    const rows = await sql<{ catatan_metrik_tambahan: string | null }[]>`
      select catatan_metrik_tambahan from wrr_catatan where recap_id = ${RECAP}`;
    expect(rows[0].catatan_metrik_tambahan).toContain('CPL');
  });
});
