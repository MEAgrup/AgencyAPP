/**
 * LOG-AKTIVITAS-KLIEN (Improvement Req Account butir 5, 2026-09-30).
 * Integration only (skipped unless DATABASE_URL is set).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { assignAM, createBrief } from './account';
import * as briefIntake from './brief-intake';
import { canReadClientLog, clientActivityLog, ForbiddenError, NotFoundError, type Actor } from './client-log';

const am = (id = 'ZZ-CL-AM'): Actor => ({
  employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const head = (): Actor => ({
  employeeId: 'ZZ-CL-HEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const ads = (): Actor => ({
  employeeId: 'ZZ-CL-ADS', divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }),
});
const od = (): Actor => ({ employeeId: 'ZZ-CL-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });

describe('canReadClientLog', () => {
  it('OD/Director, lead Account, dan AM pemilik — bukan AM lain atau divisi eksekusi', () => {
    expect(canReadClientLog(od(), 'X')).toBe(true);
    expect(canReadClientLog(head(), 'X')).toBe(true);
    expect(canReadClientLog(am('X'), 'X')).toBe(true);
    expect(canReadClientLog(am('Y'), 'X')).toBe(false);
    expect(canReadClientLog(am('Y'), '')).toBe(false);
    expect(canReadClientLog(ads(), 'X')).toBe(false);
  });
});

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

async function registerEmployee(id: string, divisi: string, jabatan: string, level = 'staff'): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${'Nama ' + id}, ${id + '@mea.test'}, ${divisi}, ${jabatan}, true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${divisi}, ${level}, 'ZZ-TEST')
    on conflict (divisi, jabatan) do nothing`;
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from brief_review where brief_id in (select id from briefs where created_by like 'ZZ-CL%')`;
  await sql`delete from briefs where created_by like 'ZZ-CL%'`;
  await sql`delete from services where id like 'SVC-ZZCL-%'`;
  await sql`delete from clients where id like 'CLI-ZZCL-%'`;
  await sql`delete from employees where employee_id like 'ZZ-CL-%'`;
  await sql`delete from role_mappings where jabatan like 'ZZ-CL-%'`;
});

describeDb('clientActivityLog', () => {
  it('mengumpulkan jejak lintas entitas & lintas penulis: assign AM oleh Head, brief, keputusan divisi', async () => {
    const clientId = `CLI-ZZCL-${Date.now() % 100000}`;
    const svcId = `SVC-ZZCL-${Date.now() % 100000}`;
    await registerEmployee('ZZ-CL-AM', 'Account', 'ZZ-CL-AM-JAB');
    await registerEmployee('ZZ-CL-HEAD', 'Account', 'ZZ-CL-HEAD-JAB', 'lead');
    await registerEmployee('ZZ-CL-ADS', 'Ads', 'ZZ-CL-ADS-JAB');
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
        total_sales, sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
      values (${clientId}, 'PIC', 'Toko', 'Bandung', 'link', 'Fashion', '1.00', '2.00', '0.00',
        'ZZ-CL-S', 'ZZ-CL-S', null, now(), 'ZZ-TEST')`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
        standard_price, commission_rule, status, requires_strategy_plan, created_by)
      values (${svcId}, ${clientId}, 'MSV-X', 1, 'Ads Management', '1.00', 'rule', '[Awaiting Onboarding]', false, 'ZZ-TEST')`;

    await assignAM(sql, head(), clientId, 'ZZ-CL-AM');
    const b = await createBrief(sql, am(), svcId, {
      title: 'Iklan', assignedDivision: 'Ads', deliverableType: 'Ads spent (Rp)', quantityTarget: 1,
      dueDate: '2026-10-15', priority: 'Medium',
    });
    await briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Diterima' });

    const log = await clientActivityLog(sql, am(), clientId);
    const actions = log.map((e) => `${e.entityType}:${e.action}`);
    expect(actions).toContain('client:am_assigned'); // ditulis Head — tetap terbaca AM
    expect(actions).toContain('brief:create');
    expect(actions).toContain('service:transition:[Awaiting Onboarding]->[Briefed]');
    expect(actions).toContain('brief:transition:[To Do]->[In Progress]'); // ditulis divisi Ads
    expect(actions).toContain('service:transition:[Briefed]->[In Execution]');
    // Terbaru di atas.
    const times = log.map((e) => e.createdAt.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    // Nama aktor lewat private.employee_display_name.
    expect(log.find((e) => e.action === 'am_assigned')?.actorNama).toBe('Nama ZZ-CL-HEAD');

    await expect(clientActivityLog(sql, head(), clientId)).resolves.toBeDefined();
    await expect(clientActivityLog(sql, am('ZZ-CL-AM2'), clientId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clientActivityLog(sql, ads(), clientId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clientActivityLog(sql, od(), 'CLI-TIDAK-ADA')).rejects.toBeInstanceOf(NotFoundError);
  });
});
