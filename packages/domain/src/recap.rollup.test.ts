/**
 * D-08 — the M6D rollup-to-Plan surface (`wrr_plan_rollup`) under the real DB.
 * RM-E / §4 Rule 6 / §6 flow 4.
 *
 * RM-E is "(auto, read-only)": the rollup CONSOLIDATES a period's closed recaps
 * into week-by-week + cumulative evidence — it NEVER writes plan_actual. These
 * tests prove the read aggregation and the two guardrails:
 *
 *   1. aggregates only Ditutup / Ditutup Otomatis recaps linked to the period,
 *      per-week + cumulative (# video / # creator / # live / jam_live / gmv
 *      interim / ad_spend), and takes the latest week's ROAS;
 *   2. an OPEN (Terbuka) recap in the period is NOT counted (only closed evidence);
 *   3. the rollup writes NOTHING into plan_actual (GMV single-source; recap never
 *      writes PE-1, and no per-channel PE-3 row is fabricated);
 *   4. an empty / no-recap period returns zeros, never an error.
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZR-`. "N skip" is not "N pass".
 */
import { afterEach, afterAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

async function seedPlanAndClient(): Promise<{ cli: string; plan: string }> {
  seq += 1;
  const cli = `ZZR-CLI-${RUN}-${seq}`;
  const plan = `ZZR-PLAN-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${cli}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZR-SALES', 'ZZR-SALES', 'ZZR-AM', now(), 'ZZR-AM')`;
  await sql`
    insert into plan (id, client_id, contract_id, lingkup, status, periode_no,
                      tanggal_mulai, tanggal_akhir, jumlah_minggu, created_by)
    values (${plan}, ${cli}, null, 'klien', 'Aktif', 1, '2026-08-01', '2026-08-31', 4, 'ZZR-AM')`;
  return { cli, plan };
}

/** Seed a closed recap linked to the plan, with production + metric rows. */
async function seedClosedRecap(
  cli: string,
  plan: string | null,
  o: { isoWeek: number; mulai: string; akhir: string; status?: string;
       video?: number; creator?: number; live?: number; jamLive?: number;
       gmv?: number; spend?: number; roas?: number },
): Promise<string> {
  seq += 1;
  const id = `ZZR-WRR-${RUN}-${seq}`;
  await sql`
    insert into weekly_result_recap
      (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
    values (${id}, ${cli}, ${plan}, 2026, ${o.isoWeek}, ${o.mulai}, ${o.akhir},
            ${o.status ?? 'Ditutup'}, 'SISTEM')`;
  if (o.video !== undefined)
    await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
              values (${id}, 'Creative', ${o.video}, '{}'::jsonb, 'SISTEM')`;
  if (o.creator !== undefined)
    await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
              values (${id}, 'KOL', ${o.creator}, '{}'::jsonb, 'SISTEM')`;
  if (o.live !== undefined)
    await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
              values (${id}, 'Live Stream', ${o.live},
                      ${sql.json({ durasi_jam: o.jamLive ?? 0 })}, 'SISTEM')`;
  if (o.gmv !== undefined)
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${id}, 'gmv_interim', 'otomatis', ${o.gmv}, 'SISTEM')`;
  if (o.spend !== undefined)
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${id}, 'ad_spend', 'otomatis', ${o.spend}, 'SISTEM')`;
  if (o.roas !== undefined)
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${id}, 'roas_ads', 'otomatis', ${o.roas}, 'SISTEM')`;
  return id;
}

function rollup(planId: string) {
  return sql<{ r: {
    plan_id: string; rekap_count: number;
    kumulatif: { video: number; creator: number; live: number; jam_live: string; gmv_interim: string; ad_spend: string };
    roas_terakhir: string | null;
    minggu: { recap_id: string; iso_week: number }[];
  } }[]>`select wrr_plan_rollup(${planId}) as r`;
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from wrr_metrik where recap_id in (select id from weekly_result_recap where client_id like 'ZZR-CLI-%')`;
  await sql`delete from wrr_divisi where recap_id in (select id from weekly_result_recap where client_id like 'ZZR-CLI-%')`;
  await sql`delete from weekly_result_recap where client_id like 'ZZR-CLI-%'`;
  await sql`delete from plan where client_id like 'ZZR-CLI-%'`;
  await sql`delete from clients where id like 'ZZR-CLI-%'`;
});

afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('wrr_plan_rollup — RM-E read-only rollup (D-08)', () => {
  it('aggregates closed recaps per-week + cumulative, latest ROAS', async () => {
    const { cli, plan } = await seedPlanAndClient();
    await seedClosedRecap(cli, plan, {
      isoWeek: 32, mulai: '2026-08-03', akhir: '2026-08-09',
      video: 4, creator: 6, live: 2, jamLive: 5.5, gmv: 41000000, spend: 6100000, roas: 4.6,
    });
    await seedClosedRecap(cli, plan, {
      isoWeek: 33, mulai: '2026-08-10', akhir: '2026-08-16',
      video: 3, creator: 2, live: 1, jamLive: 3, gmv: 20000000, spend: 5000000, roas: 4.0,
    });
    const r = (await rollup(plan))[0].r;
    expect(r.rekap_count).toBe(2);
    expect(r.kumulatif.video).toBe(7);
    expect(r.kumulatif.creator).toBe(8);
    expect(r.kumulatif.live).toBe(3);
    expect(Number(r.kumulatif.jam_live)).toBe(8.5);
    expect(Number(r.kumulatif.gmv_interim)).toBe(61000000);
    expect(Number(r.kumulatif.ad_spend)).toBe(11100000);
    // Latest week (33) ROAS, not summed.
    expect(Number(r.roas_terakhir)).toBe(4.0);
    expect(r.minggu.map((m) => m.iso_week)).toEqual([32, 33]);
  });

  it('does not count an OPEN (Terbuka) recap in the period', async () => {
    const { cli, plan } = await seedPlanAndClient();
    await seedClosedRecap(cli, plan, { isoWeek: 32, mulai: '2026-08-03', akhir: '2026-08-09', video: 4 });
    await seedClosedRecap(cli, plan, {
      isoWeek: 33, mulai: '2026-08-10', akhir: '2026-08-16', status: 'Terbuka', video: 99,
    });
    const r = (await rollup(plan))[0].r;
    expect(r.rekap_count).toBe(1);
    expect(r.kumulatif.video).toBe(4); // the Terbuka week's 99 is excluded
  });

  it('writes NOTHING into plan_actual (GMV single-source; no PE-3 fabrication)', async () => {
    const { cli, plan } = await seedPlanAndClient();
    await seedClosedRecap(cli, plan, {
      isoWeek: 32, mulai: '2026-08-03', akhir: '2026-08-09', video: 4, gmv: 41000000,
    });
    await rollup(plan);
    const rows = await sql<{ n: string }[]>`select count(*) as n from plan_actual where plan_id = ${plan}`;
    expect(Number(rows[0].n)).toBe(0);
  });

  it('returns zeros for a period with no closed recaps, never an error', async () => {
    const { plan } = await seedPlanAndClient();
    const r = (await rollup(plan))[0].r;
    expect(r.rekap_count).toBe(0);
    expect(r.kumulatif.video).toBe(0);
    expect(Number(r.kumulatif.gmv_interim)).toBe(0);
    expect(r.roas_terakhir).toBeNull();
    expect(r.minggu).toEqual([]);
  });
});
