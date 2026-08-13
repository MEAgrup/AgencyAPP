/**
 * D-06 — the M6D scheduled job (`wrr_monday_job` + `wrr_reminder_tick`) under the
 * real DB. Complements recap.test.ts (D-02 machine), recap.close.test.ts (D-05
 * close gate), recap.aggregate.test.ts (D-03 aggregation).
 *
 * §6 flow 1/3 · §9 "Scheduled jobs" (a)(b)(c) · RM-2 active-client filter · RM-5
 * N=2 working-day force-close · RM-8 catatan_divisi_belum_diisi at close.
 *
 * The job is a SQL function taking `p_now` (idempotency tested without a wall
 * clock — the interview_*_tick precedent). It runs system-side (no withClaims),
 * so its wrr_aggregate + otomatis writes pass the D-03 belt (JWT actor NULL).
 *
 *   1. opens a recap for an active client (Terjadwal→Terbuka), links the Aktif
 *      Plan period, and is idempotent (a second run creates no duplicate);
 *   2. skips a client whose services are all terminal (Done/Cancelled) — not
 *      "active" (RM-2 implementable half);
 *   3. force-closes a prior-week recap still Terbuka past N=2 working days
 *      (→ Ditutup Otomatis, pernah_ditutup_otomatis=true) and spares a recent one;
 *   4. at force-close, emits catatan_divisi_belum_diisi for a division that owes a
 *      note (has a wrr_divisi row, no wrr_catatan_divisi);
 *   5. emits rekap_mingguan_terbuka to the owning AM on open;
 *   6. wrr_reminder_tick emits rekap_mingguan_belum_dikonfirmasi once (idempotent
 *      via the belum_dikonfirmasi_terkirim marker).
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZJ-`; job-created recaps
 * are cleaned by client_id. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

// A Monday 00:00 WIB instant: 2026-08-24 (ISO week 35). 08-23 = the Sunday before.
const MON = '2026-08-24T01:00:00+07:00';

async function seedClient(opts: { am?: string; serviceStatus?: string | null } = {}): Promise<string> {
  seq += 1;
  const clientId = `ZZJ-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZJ-SALES', 'ZZJ-SALES', ${opts.am ?? 'ZZJ-AM'}, now(), 'ZZJ-AM')`;
  if (opts.serviceStatus) {
    seq += 1;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
                            standard_price, commission_rule, status, created_by)
      values (${`ZZJ-SVC-${RUN}-${seq}`}, ${clientId}, 'MSV-ZZJ', 1, 'Full Management',
              0, 'rule', ${opts.serviceStatus}, 'ZZJ-AM')`;
  }
  return clientId;
}

/** Seed one recap directly (a prior week), as the D-05 harness does. */
async function seedRecap(
  clientId: string,
  opts: { status?: string; mulai: string; akhir: string; isoWeek: number },
): Promise<string> {
  seq += 1;
  const id = `ZZJ-WRR-${RUN}-${seq}`;
  await sql`
    insert into weekly_result_recap
      (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
    values (${id}, ${clientId}, null, 2026, ${opts.isoWeek}, ${opts.mulai}, ${opts.akhir},
            ${opts.status ?? 'Terbuka'}, 'SISTEM')`;
  return id;
}

function mondayJob(now = MON) {
  return sql<{ r: { iso_year: number; iso_week: number; dibuka: number; ditutup_otomatis: number } }[]>`
    select wrr_monday_job(${now}) as r`;
}
function reminderTick(now = MON) {
  return sql<{ r: number }[]>`select wrr_reminder_tick(${now}) as r`;
}

async function statusOf(id: string): Promise<{ status: string; pernah: boolean }> {
  const rows = await sql<{ status: string; pernah_ditutup_otomatis: boolean }[]>`
    select status, pernah_ditutup_otomatis from weekly_result_recap where id = ${id}`;
  return { status: rows[0].status, pernah: rows[0].pernah_ditutup_otomatis };
}
async function notifCount(recapId: string, event: string): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*) as n from notifications where entity_id = ${recapId} and event_type = ${event}`;
  return Number(rows[0].n);
}

afterEach(async () => {
  if (!sql) return;
  // notifications is append-only (no DELETE) — left in place; assertions key on
  // the unique recap id (per-run WRR / ZZJ ids), so stale rows never collide.
  await sql`truncate wrr_catatan_divisi`; // append-only — bypass its no-delete guard
  await sql`delete from wrr_metrik where recap_id in
              (select id from weekly_result_recap where client_id like 'ZZJ-CLI-%')`;
  await sql`delete from wrr_divisi where recap_id in
              (select id from weekly_result_recap where client_id like 'ZZJ-CLI-%')`;
  await sql`delete from weekly_result_recap where client_id like 'ZZJ-CLI-%'`;
  await sql`delete from services where client_id like 'ZZJ-CLI-%'`;
  await sql`delete from clients where id like 'ZZJ-CLI-%'`;
});

afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('wrr_monday_job — open (D-06 a)', () => {
  it('opens a Terbuka recap for an active client and is idempotent', async () => {
    const cli = await seedClient({ serviceStatus: '[In Execution]' });
    const r1 = await mondayJob();
    expect(r1[0].r.iso_week).toBe(35);
    expect(r1[0].r.dibuka).toBe(1);
    const rows = await sql<{ id: string; status: string; minggu_mulai: string; minggu_akhir: string }[]>`
      select id, status, minggu_mulai, minggu_akhir from weekly_result_recap where client_id = ${cli}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Terbuka');
    expect(rows[0].id).toMatch(/^WRR-202608-\d{4}$/);
    // Second run: no duplicate, nothing newly opened.
    const r2 = await mondayJob();
    expect(r2[0].r.dibuka).toBe(0);
    const again = await sql`select id from weekly_result_recap where client_id = ${cli}`;
    expect(again).toHaveLength(1);
  });

  it('links the Aktif Plan period covering the week', async () => {
    const cli = await seedClient({ serviceStatus: '[In Execution]' });
    const planId = `ZZJ-PLAN-${RUN}-${(seq += 1)}`;
    await sql`
      insert into plan (id, client_id, contract_id, lingkup, status, periode_no,
                        tanggal_mulai, tanggal_akhir, jumlah_minggu, created_by)
      values (${planId}, ${cli}, null, 'klien', 'Aktif', 1,
              '2026-08-01', '2026-08-31', 4, 'ZZJ-AM')`;
    await mondayJob();
    const rows = await sql<{ plan_id: string | null }[]>`
      select plan_id from weekly_result_recap where client_id = ${cli}`;
    expect(rows[0].plan_id).toBe(planId);
    await sql`delete from weekly_result_recap where client_id = ${cli}`;
    await sql`delete from plan where id = ${planId}`;
  });

  it('skips a client whose services are all terminal (not active, RM-2)', async () => {
    const cli = await seedClient({ serviceStatus: 'Done' });
    const r = await mondayJob();
    const rows = await sql`select id from weekly_result_recap where client_id = ${cli}`;
    expect(rows).toHaveLength(0);
    // (the run may open other seeded clients — assert only about this one)
    expect(r[0].r.iso_week).toBe(35);
  });

  it('emits rekap_mingguan_terbuka to the owning AM on open', async () => {
    const cli = await seedClient({ am: 'ZZJ-AM-NOTIF', serviceStatus: '[Briefed]' });
    await mondayJob();
    const rows = await sql<{ id: string }[]>`select id from weekly_result_recap where client_id = ${cli}`;
    expect(await notifCount(rows[0].id, 'rekap_mingguan_terbuka')).toBe(1);
    const who = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${rows[0].id} and event_type = 'rekap_mingguan_terbuka'`;
    expect(who.map((w) => w.recipient_employee_id)).toContain('ZZJ-AM-NOTIF');
  });
});

describeDb('wrr_monday_job — force-close (D-06 a/c)', () => {
  it('force-closes a prior-week recap past N=2 working days and spares a recent one', async () => {
    const cli = await seedClient(); // no service → no new week-35 recap opens
    // Old week ending 2026-08-02 (Sun), far past the 2-working-day grace.
    const old = await seedRecap(cli, { mulai: '2026-07-27', akhir: '2026-08-02', isoWeek: 31 });
    // Recent week ending yesterday 2026-08-23 (Sun) — 1 working day elapsed → spared.
    const recent = await seedRecap(cli, { mulai: '2026-08-17', akhir: '2026-08-23', isoWeek: 34 });
    const r = await mondayJob();
    expect(r[0].r.ditutup_otomatis).toBe(1);
    const so = await statusOf(old);
    expect(so.status).toBe('Ditutup Otomatis');
    expect(so.pernah).toBe(true);
    const sr = await statusOf(recent);
    expect(sr.status).toBe('Terbuka');
    expect(sr.pernah).toBe(false);
  });

  it('emits catatan_divisi_belum_diisi for a division that owes a note at force-close', async () => {
    const cli = await seedClient({ am: 'ZZJ-AM-C' });
    const old = await seedRecap(cli, { mulai: '2026-07-27', akhir: '2026-08-02', isoWeek: 31 });
    // A Creative production row (division touched the client) with NO division note.
    await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
              values (${old}, 'Creative', 4, '{"video":4}'::jsonb, 'SISTEM')`;
    await mondayJob();
    expect(await statusOf(old).then((s) => s.status)).toBe('Ditutup Otomatis');
    expect(await notifCount(old, 'catatan_divisi_belum_diisi')).toBeGreaterThanOrEqual(1);
    const who = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${old} and event_type = 'catatan_divisi_belum_diisi'`;
    expect(who.map((w) => w.recipient_employee_id)).toContain('ZZJ-AM-C');
  });

  it('does NOT emit catatan_divisi_belum_diisi when the division already filed a note', async () => {
    const cli = await seedClient();
    const old = await seedRecap(cli, { mulai: '2026-07-27', akhir: '2026-08-02', isoWeek: 31 });
    await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
              values (${old}, 'Creative', 4, '{"video":4}'::jsonb, 'SISTEM')`;
    await sql`insert into wrr_catatan_divisi (recap_id, divisi, catatan, created_by)
              values (${old}, 'Creative', 'Minggu ini 4 video approved.', 'ZZJ-CRE')`;
    await mondayJob();
    expect(await notifCount(old, 'catatan_divisi_belum_diisi')).toBe(0);
  });
});

describeDb('wrr_reminder_tick — belum dikonfirmasi (D-06 b)', () => {
  it('emits the reminder once and is idempotent via the marker', async () => {
    const cli = await seedClient({ am: 'ZZJ-AM-R' });
    // Week ending 2026-08-02; by MON=2026-08-24 well past 2 working days, still Terbuka.
    const rec = await seedRecap(cli, { mulai: '2026-07-27', akhir: '2026-08-02', isoWeek: 31 });
    const n1 = await reminderTick();
    expect(n1[0].r).toBeGreaterThanOrEqual(1);
    expect(await notifCount(rec, 'rekap_mingguan_belum_dikonfirmasi')).toBe(1);
    const mark = await sql<{ belum_dikonfirmasi_terkirim: boolean }[]>`
      select belum_dikonfirmasi_terkirim from weekly_result_recap where id = ${rec}`;
    expect(mark[0].belum_dikonfirmasi_terkirim).toBe(true);
    // Re-run: no second notification.
    await reminderTick();
    expect(await notifCount(rec, 'rekap_mingguan_belum_dikonfirmasi')).toBe(1);
  });

  it('does not remind a recap still within the working-day grace', async () => {
    const cli = await seedClient();
    // Ends yesterday (Sun 2026-08-23): 1 working day by MON → within grace.
    const rec = await seedRecap(cli, { mulai: '2026-08-17', akhir: '2026-08-23', isoWeek: 34 });
    await reminderTick();
    expect(await notifCount(rec, 'rekap_mingguan_belum_dikonfirmasi')).toBe(0);
  });
});
