/**
 * M6D / backlog D-02 — machine #18 (`weekly_result_recap`) and its gates.
 *
 * D-02 has no write path yet (the Monday job D-06 presses the system edges, the
 * close/reopen operations land in D-09), so the DB assertions insert recaps
 * directly as the owning superuser — exactly what those callers will do — and
 * prove the SHAPE holds:
 *
 *   1. the machine is registered with the right initial + single terminal state;
 *   2. it carries exactly the four §15 edges, with only the Head reopen lead-gated;
 *   3. a recap actually moves Terjadwal → Terbuka → Ditutup through sm_transition,
 *      and an illegal edge is blocked (not silently applied);
 *   4. the reopen edge (Ditutup Otomatis → Terbuka) is refused to a non-lead and
 *      allowed to a lead — the engine half of the RM-5 Head gate;
 *   5. `pernah_ditutup_otomatis` is frozen ON by the DB: true→false is rejected,
 *      false→true (force-close) is allowed.
 *
 * Plus pure unit tests for the person-level gates (no DB).
 *
 * Skipped without DATABASE_URL. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  canCloseRecap,
  canReopenRecap,
  WRR_DITUTUP,
} from './recap';

// ---------------------------------------------------------------------------
// Pure gate unit tests (no DB)
// ---------------------------------------------------------------------------

const am = (id = 'ZZ-AM') => ({
  employeeId: id,
  role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const accountLead = () => ({
  employeeId: 'ZZ-SPV',
  role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const otherDivLead = () => ({
  employeeId: 'ZZ-CRE-LEAD',
  role: permission.makeRole({ division: 'Creative', level: 'lead' }),
});
const director = () => ({
  employeeId: 'ZZ-DIR',
  role: permission.makeRole({ division: 'Account', level: 'staff', director: true }),
});
const od = () => ({
  employeeId: 'ZZ-OD',
  role: permission.makeRole({ division: 'Account', level: 'staff', od: true }),
});

describe('canCloseRecap (Terbuka → Ditutup)', () => {
  it('the owning AM may close their own client recap', () => {
    expect(canCloseRecap(am('ZZ-AM'), 'ZZ-AM')).toBe(true);
  });
  it('a different AM may not close a recap they do not own', () => {
    expect(canCloseRecap(am('ZZ-AM2'), 'ZZ-AM')).toBe(false);
  });
  it('an Account lead/Head may override-close', () => {
    expect(canCloseRecap(accountLead(), 'ZZ-AM')).toBe(true);
  });
  it('a Director may always close', () => {
    expect(canCloseRecap(director(), 'ZZ-AM')).toBe(true);
  });
  it('a lead of another division may not', () => {
    expect(canCloseRecap(otherDivLead(), 'ZZ-AM')).toBe(false);
  });
  it('a pure-OD (read-only) may not close', () => {
    expect(canCloseRecap(od(), 'ZZ-AM')).toBe(false);
  });
  it('a null owner (unassigned client) does not grant a stray AM', () => {
    expect(canCloseRecap(am('ZZ-AM'), null)).toBe(false);
  });
});

describe('canReopenRecap (Ditutup Otomatis → Terbuka — RM-5 Head only)', () => {
  it('the Head of Account may reopen', () => {
    expect(canReopenRecap(accountLead())).toBe(true);
  });
  it('a Director may reopen', () => {
    expect(canReopenRecap(director())).toBe(true);
  });
  it('the owning AM may NOT reopen their own force-close (RM-5: Head, not the AM)', () => {
    expect(canReopenRecap(am('ZZ-AM'))).toBe(false);
  });
  it('a lead of another division may not reopen', () => {
    expect(canReopenRecap(otherDivLead())).toBe(false);
  });
  it('a pure-OD may not reopen', () => {
    expect(canReopenRecap(od())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB: machine #18
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

afterEach(async () => {
  if (!sql) return;
  await sql`delete from weekly_result_recap where created_by like 'ZZ-%' or client_id like 'ZZ-CLI-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

async function seedClient(amId = 'ZZ-AM'): Promise<string> {
  seq += 1;
  const clientId = `ZZ-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZ-SALES', 'ZZ-SALES', ${amId}, now(), 'ZZ-AM')`;
  return clientId;
}

/** Insert one recap directly — what the D-06 Monday job will do (minus the job). */
async function seedRecap(
  opts: { status?: string; isoWeek?: number; pernah?: boolean } = {},
): Promise<string> {
  const clientId = await seedClient();
  seq += 1;
  const id = `ZZ-WRR-${RUN}-${seq}`;
  await sql`
    insert into weekly_result_recap
      (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir,
       status, pernah_ditutup_otomatis, created_by)
    values (${id}, ${clientId}, null, 2026, ${opts.isoWeek ?? 33}, '2026-08-10', '2026-08-16',
            ${opts.status ?? 'Terjadwal'}, ${opts.pernah ?? false}, 'ZZ-AM')`;
  return id;
}

/** Call sm_transition directly, as the callers (job / route) will. */
function smTransition(id: string, to: string, actor = 'ZZ-AM', director = false, lead = false) {
  return sql<{ r: { ok: boolean; to?: string; code?: string; message?: string } }[]>`
    select sm_transition('weekly_result_recap','weekly_result_recap','weekly_result_recap',
                         'id','status', ${id}, ${to}, ${actor}, ${director}, ${lead}) as r`;
}

describeDb('machine #18 (weekly_result_recap)', () => {
  it('is registered with initial state Terjadwal and a single terminal Ditutup', async () => {
    const m = await sql<{ initial_state: string }[]>`
      select initial_state from sm_machines where name = 'weekly_result_recap'`;
    expect(m[0]?.initial_state).toBe('Terjadwal');
    const term = await sql<{ state: string }[]>`
      select state from sm_terminal_states where machine = 'weekly_result_recap' order by state`;
    // Ditutup Otomatis is quasi-terminal (Head reopen) → NOT stored as terminal.
    expect(term.map((t) => t.state)).toEqual([WRR_DITUTUP]);
  });

  it('carries exactly the four §15 edges, only the Head reopen lead-gated', async () => {
    const edges = await sql<{ from_state: string; to_state: string; require_lead: boolean }[]>`
      select from_state, to_state, require_lead from sm_edges
       where machine = 'weekly_result_recap' order by from_state, to_state`;
    expect(edges).toHaveLength(4);
    const reopen = edges.find((e) => e.from_state === 'Ditutup Otomatis' && e.to_state === 'Terbuka');
    expect(reopen?.require_lead).toBe(true);
    // The system/AM edges are not lead-gated (job + owner-gated-in-domain).
    for (const e of edges.filter((x) => !(x.from_state === 'Ditutup Otomatis'))) {
      expect(e.require_lead).toBe(false);
    }
  });

  it('moves a recap Terjadwal → Terbuka → Ditutup, and blocks a bad edge', async () => {
    const id = await seedRecap({ status: 'Terjadwal' });
    const open = await smTransition(id, 'Terbuka');
    expect(open[0].r.ok).toBe(true);
    expect(open[0].r.to).toBe('Terbuka');
    // D-05 narrative gate: RM-D1 + RM-D3 must be present before Terbuka → Ditutup.
    // (This test proves the edge; the gate itself is covered in recap.close.test.ts.)
    await sql`insert into wrr_catatan (recap_id, yang_bergerak, fokus_minggu_depan, created_by)
              values (${id}, 'ROAS bertahan 4,6', 'kejar sisa video', 'ZZ-AM')`;
    const close = await smTransition(id, 'Ditutup');
    expect(close[0].r.ok).toBe(true);
    // Terjadwal → Ditutup is not an edge.
    const id2 = await seedRecap({ status: 'Terjadwal' });
    const bad = await smTransition(id2, 'Ditutup');
    expect(bad[0].r.ok).toBe(false);
    expect(bad[0].r.code).toBe('blocked');
  });

  it('refuses the Head reopen to a non-lead and allows it to a lead', async () => {
    const id = await seedRecap({ status: 'Ditutup Otomatis', pernah: true });
    const denied = await smTransition(id, 'Terbuka', 'ZZ-AM', false, false);
    expect(denied[0].r.ok).toBe(false);
    expect(denied[0].r.code).toBe('role_denied');
    const ok = await smTransition(id, 'Terbuka', 'ZZ-SPV', false, true);
    expect(ok[0].r.ok).toBe(true);
    expect(ok[0].r.to).toBe('Terbuka');
  });
});

describeDb('pernah_ditutup_otomatis is permanent (guard trigger)', () => {
  it('rejects true → false (the flag can never be cleared)', async () => {
    const id = await seedRecap({ status: 'Ditutup Otomatis', pernah: true });
    await expect(
      sql`update weekly_result_recap set pernah_ditutup_otomatis = false where id = ${id}`,
    ).rejects.toThrow(/permanen dan tidak dapat dicabut/);
  });

  it('allows false → true (force-close sets it)', async () => {
    const id = await seedRecap({ status: 'Terbuka', pernah: false });
    await sql`update weekly_result_recap set pernah_ditutup_otomatis = true where id = ${id}`;
    const rows = await sql<{ pernah_ditutup_otomatis: boolean }[]>`
      select pernah_ditutup_otomatis from weekly_result_recap where id = ${id}`;
    expect(rows[0].pernah_ditutup_otomatis).toBe(true);
  });
});
