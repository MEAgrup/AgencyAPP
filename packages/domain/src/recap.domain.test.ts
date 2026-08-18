/**
 * D-09 — the M6D domain layer: reads (scope), AM writes (pembuka, narasi, manual
 * metric, Sengketa), division note (RM-D6), close (metric-completeness belt),
 * reopen. Complements the D-02/D-05/D-06/D-08 suites.
 *
 * Writes run as the owning superuser `sql` (RLS bypassed) — exactly the API's
 * db() service-role path (DECISIONS O37): the TS canWrite* gate is the primary
 * wall, the DB belt/gate the second. Pure gate unit tests need no DB.
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZD-`. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  addRecapCatatanDivisi,
  canReadRecap,
  canWriteRecapDivisiNote,
  closeRecap,
  fileRecapSengketaMetrik,
  getRecapDetail,
  recordRecapMetrikManual,
  reopenRecap,
  saveRecapNarasi,
  saveRecapPembuka,
} from './recap';

// ---------------------------------------------------------------------------
// Pure gate unit tests (no DB)
// ---------------------------------------------------------------------------
const am = (id = 'ZZD-AM') => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = () => ({ employeeId: 'ZZD-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const creativeLead = () => ({ employeeId: 'ZZD-CRE', role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
const adsLead = () => ({ employeeId: 'ZZD-ADS', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const director = () => ({ employeeId: 'ZZD-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = () => ({ employeeId: 'ZZD-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });

describe('canReadRecap', () => {
  it('the owning AM reads their own client recap', () => {
    expect(canReadRecap(am('ZZD-AM'), 'ZZD-AM', [])).toBe(true);
  });
  it('an Account lead / OD / Director read any recap', () => {
    expect(canReadRecap(accountLead(), 'ZZD-AM', [])).toBe(true);
    expect(canReadRecap(od(), 'ZZD-AM', [])).toBe(true);
    expect(canReadRecap(director(), 'ZZD-AM', [])).toBe(true);
  });
  it('a division lead reads a recap their division touched (O48 arm)', () => {
    expect(canReadRecap(creativeLead(), 'ZZD-AM', ['Creative', 'Ads'])).toBe(true);
  });
  it('a division lead may NOT read a recap their division did not touch', () => {
    expect(canReadRecap(creativeLead(), 'ZZD-AM', ['Ads', 'KOL'])).toBe(false);
  });
  it('a stray AM cannot read a recap they do not own', () => {
    expect(canReadRecap(am('ZZD-OTHER'), 'ZZD-AM', [])).toBe(false);
  });
});

describe('canWriteRecapDivisiNote', () => {
  it("the division's lead may write their own note", () => {
    expect(canWriteRecapDivisiNote(creativeLead(), 'Creative')).toBe(true);
  });
  it('a lead may not write another division note', () => {
    expect(canWriteRecapDivisiNote(creativeLead(), 'Ads')).toBe(false);
  });
  it('an Account lead / Director may override', () => {
    expect(canWriteRecapDivisiNote(accountLead(), 'Creative')).toBe(true);
    expect(canWriteRecapDivisiNote(director(), 'KOL')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DB integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER = 'ZZD-AM';
const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

async function seedOpenRecap(): Promise<{ recap: string; client: string }> {
  seq += 1;
  const client = `ZZD-CLI-${RUN}-${seq}`;
  const recap = `ZZD-WRR-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${client}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZD-SALES', 'ZZD-SALES', ${OWNER}, now(), ${OWNER})`;
  await sql`
    insert into weekly_result_recap
      (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, status, created_by)
    values (${recap}, ${client}, null, 2026, ${33 + seq}, '2026-08-10', '2026-08-16', 'Terbuka', 'SISTEM')`;
  return { recap, client };
}
async function makeCloseable(recap: string): Promise<void> {
  await sql`update weekly_result_recap set catatan_pembuka = 'fokus minggu ini' where id = ${recap}`;
  await sql`insert into wrr_catatan (recap_id, yang_bergerak, fokus_minggu_depan, created_by)
            values (${recap}, 'ROAS bertahan 4,6', 'kejar sisa video', 'SISTEM')`;
  for (const m of ['total_view', 'ctr', 'cvr']) {
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${recap}, ${m}, 'tidak_tersedia', null, 'SISTEM')`;
  }
}
const actorAm = { employeeId: OWNER, role: permission.makeRole({ division: 'Account', level: 'staff' }) };
const actorCreativeLead = { employeeId: 'ZZD-CRE', role: permission.makeRole({ division: 'Creative', level: 'lead' }) };
const actorHead = { employeeId: 'ZZD-HEAD', role: permission.makeRole({ division: 'Account', level: 'lead' }) };

afterEach(async () => {
  if (!sql) return;
  await sql`truncate wrr_catatan_divisi`;
  await sql`delete from wrr_metrik where recap_id in (select id from weekly_result_recap where client_id like 'ZZD-CLI-%')`;
  await sql`delete from wrr_divisi where recap_id in (select id from weekly_result_recap where client_id like 'ZZD-CLI-%')`;
  await sql`delete from wrr_catatan where recap_id in (select id from weekly_result_recap where client_id like 'ZZD-CLI-%')`;
  await sql`delete from weekly_result_recap where client_id like 'ZZD-CLI-%'`;
  // C7 children (FK to clients) — must go before the client delete.
  await sql`delete from complaints where client_id like 'ZZD-CLI-%'`;
  await sql`delete from briefs where service_id in (select id from services where client_id like 'ZZD-CLI-%')`;
  await sql`delete from services where client_id like 'ZZD-CLI-%'`;
  await sql`delete from clients where id like 'ZZD-CLI-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

describeDb('reads (D-09)', () => {
  it('getRecapDetail returns the bundle for the owner and refuses a stray AM', async () => {
    const { recap } = await seedOpenRecap();
    const d = await getRecapDetail(sql, actorAm, recap);
    expect(d.recap.id).toBe(recap);
    expect(d.recap.status).toBe('Terbuka');
    const stray = { employeeId: 'ZZD-NOBODY', role: permission.makeRole({ division: 'Account', level: 'staff' }) };
    await expect(getRecapDetail(sql, stray, recap)).rejects.toThrow(/akses/);
  });
  it('a Creative lead reads a recap Creative touched (O48 arm)', async () => {
    const { recap } = await seedOpenRecap();
    await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
              values (${recap}, 'Creative', 4, '{}'::jsonb, 'SISTEM')`;
    const d = await getRecapDetail(sql, actorCreativeLead, recap);
    expect(d.divisi.map((x) => x.divisi)).toContain('Creative');
  });
});

describeDb('RM-A5 Service Aktif + RM-D4 Keluhan Terkait (C7)', () => {
  // The seeded recap window is [2026-08-10, 2026-08-16]. Local id counter — must
  // NOT touch the module-level `seq` (it feeds iso_week = 33 + seq, capped at 53).
  let c7seq = 0;
  async function seedService(client: string, name: string): Promise<string> {
    c7seq += 1;
    const svc = `ZZD-SVC-${RUN}-${c7seq}`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
        standard_price, commission_rule, status, requires_strategy_plan, created_by)
      values (${svc}, ${client}, 'MSV-X', 1, ${name}, 0, 'rule', '[Briefed]', false, 'SISTEM')`;
    return svc;
  }
  async function seedBrief(svc: string, division: string, createdAt: string): Promise<string> {
    c7seq += 1;
    const brief = `ZZD-BRF-${RUN}-${c7seq}`;
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
        quantity_target, priority, recurring, created_at, created_by)
      values (${brief}, ${svc}, 'B', '[To Do]', ${division}, 'Video', 1, 'High', false, ${createdAt}, 'SISTEM')`;
    return brief;
  }
  async function seedTransition(entityType: string, entityId: string, to: string, at: string): Promise<void> {
    await sql`insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
              values (${entityType}, ${entityId}, 'SISTEM', ${`transition:[X]->${to}`}, ${at}, 'SISTEM')`;
  }
  async function seedComplaint(client: string, status: string, createdAt: string): Promise<string> {
    c7seq += 1;
    const cpl = `ZZD-CPL-${RUN}-${c7seq}`;
    await sql`
      insert into complaints (id, client_id, source, description, severity, status, created_at, created_by)
      values (${cpl}, ${client}, 'WhatsApp (AM-logged)', 'keluhan', 'High', ${status}, ${createdAt}, 'SISTEM')`;
    return cpl;
  }

  it('RM-A5: lists services with a Brief created in — or transitioned within — the week, with divisions', async () => {
    const { recap, client } = await seedOpenRecap();
    // S1: two Briefs created inside the window → listed once with both divisions (sorted).
    const s1 = await seedService(client, 'Paket Konten');
    await seedBrief(s1, 'KOL', '2026-08-12T03:00:00Z');
    await seedBrief(s1, 'Creative', '2026-08-11T03:00:00Z');
    // S2: only a Brief created BEFORE the window, no transition this week → excluded.
    const s2 = await seedService(client, 'Paket Lama');
    await seedBrief(s2, 'Ads', '2026-07-01T03:00:00Z');
    // S3: Brief created before the window BUT with a transition inside it → included (audit arm).
    const s3 = await seedService(client, 'Paket Aktif');
    const b3 = await seedBrief(s3, 'Live Stream', '2026-07-01T03:00:00Z');
    await seedTransition('brief', b3, '[Submitted]', '2026-08-13T03:00:00Z');

    const d = await getRecapDetail(sql, actorAm, recap);
    const byId = Object.fromEntries(d.serviceAktif.map((s) => [s.serviceId, s]));
    expect(Object.keys(byId).sort()).toEqual([s1, s3].sort());
    expect(byId[s1].divisions).toEqual(['Creative', 'KOL']);
    expect(byId[s1].serviceName).toBe('Paket Konten');
    expect(byId[s3].divisions).toEqual(['Live Stream']);
    expect(byId[s2]).toBeUndefined();
  });

  it('RM-D4: lists complaints active during the week with their current status; excludes pre-week-closed and future', async () => {
    const { recap, client } = await seedOpenRecap();
    // A: created inside window, [Open] → included.
    const a = await seedComplaint(client, '[Open]', '2026-08-12T03:00:00Z');
    // B: created before window, still [In Progress] → included (active during week).
    const b = await seedComplaint(client, '[In Progress]', '2026-08-01T03:00:00Z');
    // C: created before window, closed BEFORE week start → excluded.
    const c = await seedComplaint(client, '[Closed]', '2026-08-01T03:00:00Z');
    await seedTransition('complaint', c, '[Closed]', '2026-08-05T03:00:00Z');
    // D: created AFTER the window → excluded.
    await seedComplaint(client, '[Open]', '2026-08-20T03:00:00Z');
    // E: created before window, closed DURING the week → included (was active at week start).
    const e = await seedComplaint(client, '[Closed]', '2026-08-01T03:00:00Z');
    await seedTransition('complaint', e, '[Closed]', '2026-08-14T03:00:00Z');

    const d = await getRecapDetail(sql, actorAm, recap);
    const byId = Object.fromEntries(d.keluhanTerkait.map((k) => [k.id, k]));
    expect(Object.keys(byId).sort()).toEqual([a, b, e].sort());
    expect(byId[a].status).toBe('[Open]');
    expect(byId[b].status).toBe('[In Progress]');
    expect(byId[e].status).toBe('[Closed]'); // current status shown even though included
    expect(byId[a].severity).toBe('High');
    expect(byId[a].source).toBe('WhatsApp (AM-logged)');
  });
});

describeDb('AM writes (D-09)', () => {
  it('saveRecapPembuka + saveRecapNarasi persist and require Terbuka', async () => {
    const { recap } = await seedOpenRecap();
    await saveRecapPembuka(sql, actorAm, recap, '  dorong konten hero  ');
    await saveRecapNarasi(sql, actorAm, recap, { yangBergerak: 'ROAS naik', fokusMingguDepan: 'kejar video' });
    const d = await getRecapDetail(sql, actorAm, recap);
    expect(d.recap.catatanPembuka).toBe('dorong konten hero');
    expect(d.catatan?.yangBergerak).toBe('ROAS naik');
  });

  it('recordRecapMetrikManual writes a sourced manual figure and the `—` mark', async () => {
    const { recap } = await seedOpenRecap();
    await recordRecapMetrikManual(sql, actorAm, recap, 'ctr', { nilai: 1.8, fileBukti: 'ctr.pdf', tanggalAmbil: '2026-08-16' });
    await recordRecapMetrikManual(sql, actorAm, recap, 'total_view', { nilai: null });
    const d = await getRecapDetail(sql, actorAm, recap);
    const byKey = Object.fromEntries(d.metrik.map((m) => [m.metrik, m]));
    expect(byKey.ctr.sumber).toBe('manual');
    expect(byKey.ctr.nilai).toBe(1.8);
    expect(byKey.total_view.sumber).toBe('tidak_tersedia');
    expect(byKey.total_view.nilai).toBeNull();
  });

  it('rejects a manual figure with no evidence, and an auto-only / auto-existing metric', async () => {
    const { recap } = await seedOpenRecap();
    await expect(recordRecapMetrikManual(sql, actorAm, recap, 'ctr', { nilai: 1.8 })).rejects.toThrow(/lampiran/);
    await expect(recordRecapMetrikManual(sql, actorAm, recap, 'gmv_interim', { nilai: 1 })).rejects.toThrow(/tidak dapat diisi manual/);
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${recap}, 'total_view', 'otomatis', 92000, 'SISTEM')`;
    await expect(recordRecapMetrikManual(sql, actorAm, recap, 'total_view', { nilai: 1 })).rejects.toThrow(/Sengketa Angka/);
  });

  it('T-4a: view_organik is manual-eligible (platform figure) and kept separate from paid total_view', async () => {
    const { recap } = await seedOpenRecap();
    // Paid total_view auto-written by the aggregator (M10 live viewers).
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${recap}, 'total_view', 'otomatis', 20000, 'SISTEM')`;
    // Organic view is the AM's manual platform figure — needs evidence.
    await recordRecapMetrikManual(sql, actorAm, recap, 'view_organik',
      { nilai: 5000, fileBukti: 'organik.pdf', tanggalAmbil: '2026-08-16' });
    const d = await getRecapDetail(sql, actorAm, recap);
    const byKey = Object.fromEntries(d.metrik.map((m) => [m.metrik, m]));
    // Two separate rows — paid and organic never merged into one figure.
    expect(byKey.total_view.sumber).toBe('otomatis');
    expect(byKey.total_view.nilai).toBe(20000);
    expect(byKey.view_organik.sumber).toBe('manual');
    expect(byKey.view_organik.nilai).toBe(5000);
    // Organic entered without evidence is refused (same bukti gate as ctr/cvr).
    await expect(recordRecapMetrikManual(sql, actorAm, recap, 'view_organik', { nilai: 100 }))
      .rejects.toThrow(/lampiran/);
  });

  it('fileRecapSengketaMetrik sets the dispute on an otomatis figure and never mutates it', async () => {
    const { recap } = await seedOpenRecap();
    await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
              values (${recap}, 'roas_ads', 'otomatis', 4.6, 'SISTEM')`;
    await fileRecapSengketaMetrik(sql, actorAm, recap, 'roas_ads', 'angka tak cocok dashboard');
    const rows = await sql<{ nilai: string; sengketa: string | null }[]>`
      select nilai, sengketa from wrr_metrik where recap_id = ${recap} and metrik = 'roas_ads'`;
    expect(Number(rows[0].nilai)).toBe(4.6);
    expect(rows[0].sengketa).toContain('tak cocok');
    // A sengketa on a metric with no auto row is refused.
    await expect(fileRecapSengketaMetrik(sql, actorAm, recap, 'ctr', 'x')).rejects.toThrow(/otomatis/);
  });
});

describeDb('division note RM-D6 (D-09)', () => {
  it('the Creative lead adds a note for a division that touched, refused otherwise', async () => {
    const { recap } = await seedOpenRecap();
    await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
              values (${recap}, 'Creative', 4, '{}'::jsonb, 'SISTEM')`;
    const note = await addRecapCatatanDivisi(sql, actorCreativeLead, recap, 'Creative', '4 video approved minggu ini.');
    expect(note.catatan).toContain('4 video');
    // Ads lead cannot write a Creative note; and a division that did not touch is refused.
    const adsLeadActor = { employeeId: 'ZZD-ADS', role: permission.makeRole({ division: 'Ads', level: 'lead' }) };
    await expect(addRecapCatatanDivisi(sql, adsLeadActor, recap, 'Creative', 'x')).rejects.toThrow(/akses/);
    await expect(addRecapCatatanDivisi(sql, adsLeadActor, recap, 'Ads', 'x')).rejects.toThrow(/tidak menyentuh/);
  });
});

describeDb('close + reopen (D-09)', () => {
  it('blocks close on missing pembuka / narrative / a required metric, then succeeds when complete', async () => {
    const { recap } = await seedOpenRecap();
    await expect(closeRecap(sql, actorAm, recap)).rejects.toThrow(/Catatan Pembuka/);
    await sql`update weekly_result_recap set catatan_pembuka = 'fokus' where id = ${recap}`;
    await expect(closeRecap(sql, actorAm, recap)).rejects.toThrow(/narasi/);
    await sql`insert into wrr_catatan (recap_id, yang_bergerak, fokus_minggu_depan, created_by)
              values (${recap}, 'ROAS naik', 'kejar video', 'SISTEM')`;
    await expect(closeRecap(sql, actorAm, recap)).rejects.toThrow(/tidak tersedia/);
    for (const m of ['total_view', 'ctr', 'cvr']) {
      await sql`insert into wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
                values (${recap}, ${m}, 'tidak_tersedia', null, 'SISTEM')`;
    }
    const closed = await closeRecap(sql, actorAm, recap);
    expect(closed.status).toBe('Ditutup');
    expect(closed.ditutupOleh).toBe(OWNER);
  });

  it('close fires catatan_divisi_belum_diisi for a division owing an unfiled note', async () => {
    const { recap } = await seedOpenRecap();
    await makeCloseable(recap);
    await sql`insert into wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
              values (${recap}, 'Creative', 4, '{}'::jsonb, 'SISTEM')`;
    // Close as the Head (override) so the owning AM is a real recipient (an actor
    // is never notified of their own action).
    await closeRecap(sql, actorHead, recap);
    const who = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${recap} and event_type = 'catatan_divisi_belum_diisi'`;
    expect(who.map((w) => w.recipient_employee_id)).toContain(OWNER);
  });

  it('reopen is Head-only, requires a reason, and never clears pernah_ditutup_otomatis', async () => {
    const { recap } = await seedOpenRecap();
    await sql`update weekly_result_recap set status = 'Ditutup Otomatis', pernah_ditutup_otomatis = true where id = ${recap}`;
    await expect(reopenRecap(sql, actorAm, recap, 'x')).rejects.toThrow(/akses/); // AM cannot reopen
    await expect(reopenRecap(sql, actorHead, recap, '')).rejects.toThrow(/alasan/);
    const re = await reopenRecap(sql, actorHead, recap, 'data live penting untuk plan');
    expect(re.status).toBe('Terbuka');
    expect(re.pernahDitutupOtomatis).toBe(true); // permanent
  });
});
