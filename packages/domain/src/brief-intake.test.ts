/**
 * BRIEF-KEMBALI-SIKLUS (Improvement Req Account butir 1–3, pemilik 2026-09-30).
 *
 *  1. AM merevisi & mengirim ulang brief yang dikembalikan — termasuk divisi
 *     TANPA pipeline (Ads), yang sebelumnya buntu total.
 *  2. Brief yang dikembalikan = HOLD: `intakeState='dikembalikan'`, divisi
 *     tidak bisa start/submit.
 *  3. Brief yang DITERIMA divisi pindah `[To Do] → [In Progress]` (+ Service
 *     `[Briefed] → [In Execution]`) di transaksi yang sama.
 *
 * Integration only (skipped unless DATABASE_URL is set).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { createBrief, getBrief, MSG_INVALID_PRIORITY, type BriefInput } from './account';
import * as briefIntake from './brief-intake';
import { getStageOverview, reviewBrief, type Actor } from './stage';
import { MSG_BRIEF_DITAHAN, startTask, submitTask } from './task';

const ads = (id = 'ZZ-BI-ADS'): Actor => ({
  employeeId: id, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }),
});
const creative = (id = 'ZZ-BI-CRE'): Actor => ({
  employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }),
});
const am = (id = 'ZZ-BI-AM'): Actor => ({
  employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }),
});

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

let seq = 0;
const uniq = (): string => `${Date.now() % 100000}-${seq++}`;

async function registerEmployee(id: string, divisi: string, jabatan: string): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${'ZZ ' + id}, ${id + '@mea.test'}, ${divisi}, ${jabatan}, true, 'ZZ-TEST')
    on conflict (employee_id) do nothing`;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values (${divisi}, ${jabatan}, ${divisi}, 'staff', 'ZZ-TEST')
    on conflict (divisi, jabatan) do nothing`;
}

async function fixture(): Promise<{ svcId: string; amId: string }> {
  const clientId = `CLI-ZZBI-${uniq()}`;
  const svcId = `SVC-ZZBI-${uniq()}`;
  const amId = 'ZZ-BI-AM';
  await registerEmployee(amId, 'Account', 'ZZ-BI-AM-JAB');
  await registerEmployee('ZZ-BI-ADS', 'Ads', 'ZZ-BI-ADS-JAB');
  await registerEmployee('ZZ-BI-CRE', 'Creative', 'ZZ-BI-CRE-JAB');
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'PIC', ${'Toko ' + clientId}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BI-BUDI', 'ZZ-BI-BUDI', ${amId}, now(), 'ZZ-TEST')`;
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${svcId}, ${clientId}, 'MSV-X', 1, 'Ads Management', '10000000.00', 'rule',
      '[Awaiting Onboarding]', false, 'ZZ-TEST')`;
  return { svcId, amId };
}

const adsBrief = (): BriefInput => ({
  title: 'Setting Iklan', assignedDivision: 'Ads', deliverableType: 'Ads spent (Rp)',
  quantityTarget: 1, dueDate: '2026-10-15', priority: 'Medium', instructions: 'awal',
});
const creativeBrief = (): BriefInput => ({
  title: 'Konten Promo', assignedDivision: 'Creative', deliverableType: 'Video',
  quantityTarget: 3, dueDate: '2026-10-15', priority: 'High',
});

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from brief_kirim_ulang where brief_id in (select id from briefs where created_by like 'ZZ-BI%')`;
  await sql`delete from brief_review where brief_id in (select id from briefs where created_by like 'ZZ-BI%')`;
  await sql`delete from briefs where created_by like 'ZZ-BI%'`;
  await sql`delete from services where id like 'SVC-ZZBI-%'`;
  await sql`delete from clients where id like 'CLI-ZZBI-%'`;
  await sql`delete from employees where employee_id like 'ZZ-BI-%'`;
  await sql`delete from role_mappings where jabatan like 'ZZ-BI-%'`;
});

describeDb('butir 2 — brief yang dikembalikan = HOLD', () => {
  it('Ads (tanpa pipeline): dikembalikan ⇒ intakeState dikembalikan, divisi tidak bisa start', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, am(amId), svcId, adsBrief());
    expect(b.intakeState).toBe('menunggu');

    await briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Dikembalikan', alasanKode: 'Brief kurang jelas', catatan: 'budget belum jelas' });
    const held = await getBrief(sql, am(amId), b.id);
    expect(held.intakeState).toBe('dikembalikan');
    expect(held.status).toBe('[To Do]'); // status mesin tidak disentuh — Hold adalah turunan
    await expect(startTask(sql, ads(), b.id)).rejects.toThrow(MSG_BRIEF_DITAHAN);

    const notif = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${b.id} and event_type = 'm16.brief.dikembalikan'`;
    expect(notif.map((n) => n.recipient_employee_id)).toContain(amId);
  });

  it('Brief yang sudah In Progress lalu dikembalikan juga ditahan — submit ditolak', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, am(amId), svcId, adsBrief());
    await startTask(sql, ads(), b.id);
    await briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Dikembalikan', alasanKode: 'Brief kurang jelas' });
    await expect(submitTask(sql, ads(), b.id)).rejects.toThrow(MSG_BRIEF_DITAHAN);
  });
});

describeDb('butir 1 — AM merevisi & mengirim ulang', () => {
  it('Ads: revisi isi + catatan ⇒ baris kirim ulang, audit, notif divisi, putaran baru terbuka', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, am(amId), svcId, adsBrief());
    await briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Dikembalikan', alasanKode: 'Brief kurang jelas' });

    const res = await briefIntake.kirimUlangBrief(sql, am(amId), b.id, {
      catatan: 'budget & KPI dilengkapi',
      perubahan: { instructions: 'budget 5jt, ROAS 4x', dueDate: '2026-10-20', priority: 'High', title: 'Setting Iklan' },
    });
    expect(res.putaran).toBe(1);
    // `title` tidak berubah ⇒ tidak masuk diff.
    expect(Object.keys(res.perubahan).sort()).toEqual(['due_date', 'instructions', 'priority']);

    const after = await getBrief(sql, am(amId), b.id);
    expect(after.instructions).toBe('budget 5jt, ROAS 4x');
    expect(after.dueDate).toBe('2026-10-20');
    expect(after.priority).toBe('High');
    expect(after.intakeState).toBe('menunggu');

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'brief' and entity_id = ${b.id} and action = 'brief_dikirim_ulang'`;
    expect(audit).toHaveLength(1);
    const notif = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${b.id} and event_type = 'm16.brief.dikirim_ulang'`;
    expect(notif.map((n) => n.recipient_employee_id)).toContain('ZZ-BI-ADS');

    // Divisi menilai ulang — putaran 2 — dan kali ini menerima.
    await briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Diterima' });
    const ov = await getStageOverview(sql, am(amId), b.id);
    expect(ov.reviews.map((r) => [r.putaran, r.keputusan])).toEqual([[1, 'Dikembalikan'], [2, 'Diterima']]);
    expect(ov.kirimUlang).toHaveLength(1);
    expect(ov.intakeState).toBe('diterima');
  });

  it('gerbang & validasi: catatan wajib, hanya brief yang dikembalikan, field divalidasi, gagal = nol tulis', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, am(amId), svcId, adsBrief());
    await expect(briefIntake.kirimUlangBrief(sql, am(amId), b.id, { catatan: 'x' }))
      .rejects.toThrow(briefIntake.MSG_BRIEF_TIDAK_DIKEMBALIKAN);

    await briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Dikembalikan', alasanKode: 'Brief kurang jelas' });
    await expect(briefIntake.kirimUlangBrief(sql, am(amId), b.id, { catatan: '  ' }))
      .rejects.toThrow(briefIntake.MSG_CATATAN_REVISI_WAJIB);
    await expect(briefIntake.kirimUlangBrief(sql, am(amId), b.id, { catatan: 'x', perubahan: { priority: 'Urgent' } }))
      .rejects.toThrow(MSG_INVALID_PRIORITY);
    await expect(briefIntake.kirimUlangBrief(sql, am(amId), b.id, { catatan: 'x', perubahan: { quantityTarget: 0 } }))
      .rejects.toThrow('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    // Divisi pelaksana bukan pemilik gerbangnya.
    await expect(briefIntake.kirimUlangBrief(sql, ads(), b.id, { catatan: 'x' }))
      .rejects.toBeInstanceOf(briefIntake.ForbiddenError);

    const rows = await sql`select 1 from brief_kirim_ulang where brief_id = ${b.id}`;
    expect(rows).toHaveLength(0);
    expect((await getBrief(sql, am(amId), b.id)).intakeState).toBe('dikembalikan');
    // Divisi juga tidak bisa memutus ulang sebelum AM mengirim ulang.
    await expect(briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Diterima' })).rejects.toThrow('[brief ini sudah pernah direview]');
  });
});

describeDb('butir 3 — brief yang diterima divisi otomatis In Progress', () => {
  it('Ads: Diterima ⇒ [To Do] → [In Progress] dan Service [Briefed] → [In Execution]', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, am(amId), svcId, adsBrief());
    expect(b.status).toBe('[To Do]');
    await briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Diterima' });
    const after = await getBrief(sql, am(amId), b.id);
    expect(after.status).toBe('[In Progress]');
    expect(after.intakeState).toBe('diterima');
    const svc = await sql<{ status: string }[]>`select status from services where id = ${svcId}`;
    expect(svc[0].status).toBe('[In Execution]');
  });

  it('Creative (ber-pipeline): Diterima menggerakkan tahapan DAN status sekaligus', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, am(amId), svcId, creativeBrief());
    await briefIntake.reviewIntake(sql, creative(), b.id, { keputusan: 'Diterima' });
    const after = await getBrief(sql, am(amId), b.id);
    expect(after.productionStage).toBe('Script');
    expect(after.status).toBe('[In Progress]');
  });

  it('Brief yang sudah dimulai divisi tidak disentuh (nol transisi ganda)', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, am(amId), svcId, adsBrief());
    await startTask(sql, ads(), b.id);
    await briefIntake.reviewIntake(sql, ads(), b.id, { keputusan: 'Diterima' });
    const n = await sql<{ n: string }[]>`
      select count(*) as n from audit_log
       where entity_type = 'brief' and entity_id = ${b.id} and action = 'transition:[To Do]->[In Progress]'`;
    expect(Number(n[0].n)).toBe(1);
  });

  it('stage.reviewBrief lama (tanpa auto-start) tetap berfungsi untuk pemanggil lain', async () => {
    const { svcId, amId } = await fixture();
    const b = await createBrief(sql, am(amId), svcId, adsBrief());
    await reviewBrief(sql, ads(), b.id, { keputusan: 'Diterima' });
    expect((await getBrief(sql, am(amId), b.id)).status).toBe('[To Do]');
  });
});
