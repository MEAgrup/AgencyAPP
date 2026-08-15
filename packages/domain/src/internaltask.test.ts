/**
 * Penugasan Internal (`TSK-`) — create / read scope / lifecycle / lateness,
 * under the real schema (machine `internal_task`, prefix TSK, trigger
 * `trg_internal_tasks_jangkar`, policy `internal_tasks_select`).
 *
 * The tests that matter most here are the ones about LATENESS, because lateness
 * is the whole product requirement: it must survive completion (a task finished
 * late still reads late) and it must be impossible to edit away (the anchors and
 * the due date are frozen in the DB, not merely "not exposed by the API").
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bi, permission } from '@cdps/core';
import { createClient, withClaims, type Sql } from '@cdps/db';
import {
  ConflictError,
  ForbiddenError,
  MSG_ALASAN_WAJIB,
  MSG_ASSIGNEE_INVALID,
  MSG_BUKAN_PIC,
  MSG_LINK_HASIL_WAJIB,
  NotFoundError,
  STATUS_DIBATALKAN,
  STATUS_DIKERJAKAN,
  STATUS_DITUGASKAN,
  STATUS_SELESAI,
  ValidationError,
  cancelTask,
  completeTask,
  createTask,
  disciplineSummary,
  getTask,
  listTasks,
  runReminderTick,
  startTask,
  type Actor,
} from './internaltask';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

// --- Actors (ids prefixed ZZT- so afterEach can clean up by pattern) ---
const CRE_STAFF = 'ZZT-CRE-STAFF';
const CRE_STAFF2 = 'ZZT-CRE-STAFF2';
const CRE_LEAD = 'ZZT-CRE-LEAD';
const ADS_STAFF = 'ZZT-ADS-STAFF';
const ADS_LEAD = 'ZZT-ADS-LEAD';
const DIR = 'ZZT-DIR';
const OD = 'ZZT-OD';

const creStaff = (id = CRE_STAFF): Actor => ({ employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });
const creLead = (): Actor => ({ employeeId: CRE_LEAD, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
const adsStaff = (): Actor => ({ employeeId: ADS_STAFF, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const adsLead = (): Actor => ({ employeeId: ADS_LEAD, divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const director = (): Actor => ({ employeeId: DIR, divisi: 'Management', role: permission.makeRole({ director: true }) });
const od = (): Actor => ({ employeeId: OD, divisi: 'Management', role: permission.makeRole({ od: true }) });

// A fixed "now" so every lateness assertion is deterministic. 2026-08-20 09:00
// WIB — the WIB calendar day is 2026-08-20.
const NOW = new Date('2026-08-20T02:00:00Z');
const DUE_PAST = '2026-08-18'; // 2 days before NOW
const DUE_FUTURE = '2026-09-30';

async function insEmployee(id: string, divisi: string, jabatan: string, aktif = true): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${`${id}@zzt.test`}, ${divisi}, ${jabatan}, ${aktif}, 'ZZT-TEST')
    on conflict (employee_id) do nothing`;
}

beforeAll(async () => {
  if (!sql) return;
  await insEmployee(CRE_STAFF, 'Creative', 'Creative Designer');
  await insEmployee(CRE_STAFF2, 'Creative', 'Creative Designer');
  await insEmployee(CRE_LEAD, 'Creative', 'Creative Lead');
  await insEmployee(ADS_STAFF, 'Ads', 'Ads Specialist');
  await insEmployee(ADS_LEAD, 'Ads', 'Ads Lead');
  await insEmployee(DIR, 'Management', 'Director');
  await insEmployee(OD, 'Management', 'Director');
});

// `audit_log` and `notifications` are deliberately NOT cleaned: both are
// append-only by house rule #3, and the DB refuses the DELETE. Every assertion
// about them is therefore scoped to the id of the task under test.
afterEach(async () => {
  if (!sql) return;
  await sql`delete from internal_tasks where created_by like 'ZZT-%' or assignee_id like 'ZZT-%'`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from internal_tasks where created_by like 'ZZT-%' or assignee_id like 'ZZT-%'`;
  await sql`delete from employees where employee_id like 'ZZT-%'`;
  await sql.end();
});

/** Creates a task from the Creative lead to CRE_STAFF. */
function mk(due = DUE_FUTURE, actor: Actor = creLead(), assignee = CRE_STAFF) {
  return createTask(sql, actor, { judul: 'Rekap konten mingguan', assigneeId: assignee, dueDate: due }, NOW);
}

// ---------------------------------------------------------------------------

describeDb('createTask — gates, validation, ID minting', () => {
  it('a lead assigns to their own division staff; TSK id + audit row + PIC notified', async () => {
    const t = await mk(DUE_FUTURE);
    expect(t.id).toMatch(/^TSK-\d{6}-\d{4,}$/);
    expect(t.status).toBe(STATUS_DITUGASKAN);
    expect(t.assigneeId).toBe(CRE_STAFF);
    // Division is FROZEN onto the row, not joined at read time.
    expect(t.assigneeDivision).toBe('Creative');
    expect(t.createdBy).toBe(CRE_LEAD);

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'internal_task' and entity_id = ${t.id}`;
    expect(audit.map((a) => a.action)).toContain('penugasan_dibuat');

    // The assignee is told — otherwise they never learn the task exists.
    const notif = await sql<{ recipient_employee_id: string; event_type: string }[]>`
      select recipient_employee_id, event_type from notifications where entity_id = ${t.id}`;
    expect(notif).toEqual([{ recipient_employee_id: CRE_STAFF, event_type: 'penugasan_ditugaskan' }]);
  });

  it('staff cannot assign; OD cannot assign (read-only everywhere); Director can, cross-division', async () => {
    await expect(createTask(sql, creStaff(), { judul: 'x', assigneeId: CRE_STAFF2, dueDate: DUE_FUTURE }, NOW))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTask(sql, od(), { judul: 'x', assigneeId: CRE_STAFF, dueDate: DUE_FUTURE }, NOW))
      .rejects.toBeInstanceOf(ForbiddenError);

    // Director reaches another division, and may task a LEAD (Director → Head).
    const t = await createTask(sql, director(), { judul: 'Laporan bulanan', assigneeId: ADS_LEAD, dueDate: DUE_FUTURE }, NOW);
    expect(t.assigneeDivision).toBe('Ads');
    expect(t.assigneeId).toBe(ADS_LEAD);
  });

  it('a lead cannot reach another division, nor a peer lead in their own', async () => {
    await expect(createTask(sql, creLead(), { judul: 'x', assigneeId: ADS_STAFF, dueDate: DUE_FUTURE }, NOW))
      .rejects.toThrow(MSG_ASSIGNEE_INVALID);
    // CRE_LEAD is a lead, not staff — not the Creative lead's to task.
    await expect(createTask(sql, creLead(), { judul: 'x', assigneeId: CRE_LEAD, dueDate: DUE_FUTURE }, NOW))
      .rejects.toThrow(MSG_ASSIGNEE_INVALID);
  });

  it('an inactive or unmapped employee is refused (picker == validator)', async () => {
    await insEmployee('ZZT-CRE-OFF', 'Creative', 'Creative Designer', false);
    await insEmployee('ZZT-NOMAP', 'Creative', 'Jabatan Tidak Dipetakan');
    await expect(createTask(sql, creLead(), { judul: 'x', assigneeId: 'ZZT-CRE-OFF', dueDate: DUE_FUTURE }, NOW))
      .rejects.toThrow(MSG_ASSIGNEE_INVALID);
    await expect(createTask(sql, creLead(), { judul: 'x', assigneeId: 'ZZT-NOMAP', dueDate: DUE_FUTURE }, NOW))
      .rejects.toThrow(MSG_ASSIGNEE_INVALID);
    await expect(createTask(sql, creLead(), { judul: 'x', assigneeId: 'ZZT-GHOST', dueDate: DUE_FUTURE }, NOW))
      .rejects.toThrow(MSG_ASSIGNEE_INVALID);
  });

  it('mandatory fields gate BEFORE the ID is minted (house rule #1)', async () => {
    // The counter itself is the witness: a rejected create must not burn a number.
    const before = await sql<{ next_n: number }[]>`select next_n from id_sequences where prefix = 'TSK'`;
    for (const bad of [
      { judul: '   ', assigneeId: CRE_STAFF, dueDate: DUE_FUTURE },
      { judul: 'x', assigneeId: '', dueDate: DUE_FUTURE },
      { judul: 'x', assigneeId: CRE_STAFF, dueDate: '' },
      { judul: 'x', assigneeId: CRE_STAFF, dueDate: '18-08-2026' }, // wrong shape
      { judul: 'x', assigneeId: CRE_STAFF, dueDate: '2026-02-31' }, // not a real date
    ]) {
      await expect(createTask(sql, creLead(), bad, NOW)).rejects.toThrow(bi.INCOMPLETE_DATA);
    }
    const after = await sql<{ next_n: number }[]>`select next_n from id_sequences where prefix = 'TSK'`;
    expect(after[0]?.next_n).toBe(before[0]?.next_n);
  });
});

describeDb('read scope — mirrors internal_tasks_select', () => {
  it('staff see own + what they created; lead sees their division; OD/Director see all', async () => {
    const mine = await mk(DUE_FUTURE, creLead(), CRE_STAFF);
    const peer = await mk(DUE_FUTURE, creLead(), CRE_STAFF2);
    const other = await createTask(sql, adsLead(), { judul: 'ads', assigneeId: ADS_STAFF, dueDate: DUE_FUTURE }, NOW);

    const staffIds = (await listTasks(sql, creStaff(), {}, NOW)).map((t) => t.id);
    expect(staffIds).toContain(mine.id);
    expect(staffIds).not.toContain(peer.id);
    expect(staffIds).not.toContain(other.id);

    const leadIds = (await listTasks(sql, creLead(), {}, NOW)).map((t) => t.id);
    expect(leadIds).toEqual(expect.arrayContaining([mine.id, peer.id]));
    expect(leadIds).not.toContain(other.id);

    for (const a of [director(), od()]) {
      const ids = (await listTasks(sql, a, {}, NOW)).map((t) => t.id);
      expect(ids).toEqual(expect.arrayContaining([mine.id, peer.id, other.id]));
    }
  });

  it('getTask separates 404 (no such row) from 403 (exists, not yours)', async () => {
    const t = await createTask(sql, adsLead(), { judul: 'ads', assigneeId: ADS_STAFF, dueDate: DUE_FUTURE }, NOW);
    await expect(getTask(sql, creStaff(), 'TSK-209901-9999', NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTask(sql, creStaff(), t.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getTask(sql, adsStaff(), t.id, NOW)).id).toBe(t.id);
  });
});

describeDb('lifecycle — only the PIC works it, only the atasan cancels it', () => {
  it('start freezes dimulai_pada; a non-PIC (even their lead) is refused', async () => {
    const t = await mk();
    await expect(startTask(sql, creLead(), t.id, NOW)).rejects.toThrow(MSG_BUKAN_PIC);
    await expect(startTask(sql, creStaff(CRE_STAFF2), t.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    const started = await startTask(sql, creStaff(), t.id, NOW);
    expect(started.status).toBe(STATUS_DIKERJAKAN);
    expect(started.dimulaiPada).not.toBeNull();
  });

  it('complete requires the deliverable link and records selesai_pada', async () => {
    const t = await mk();
    await startTask(sql, creStaff(), t.id, NOW);
    await expect(completeTask(sql, creStaff(), t.id, '   ', NOW)).rejects.toThrow(MSG_LINK_HASIL_WAJIB);

    const done = await completeTask(sql, creStaff(), t.id, 'https://drive.google.com/x', NOW);
    expect(done.status).toBe(STATUS_SELESAI);
    expect(done.linkHasil).toBe('https://drive.google.com/x');
    expect(done.selesaiPada).not.toBeNull();

    // The assigner is told it landed.
    const notif = await sql<{ recipient_employee_id: string; event_type: string }[]>`
      select recipient_employee_id, event_type from notifications
       where entity_id = ${t.id} and event_type = 'penugasan_selesai'`;
    expect(notif).toEqual([{ recipient_employee_id: CRE_LEAD, event_type: 'penugasan_selesai' }]);
  });

  it('the engine blocks [Ditugaskan] -> [Selesai] (no skipping the middle state)', async () => {
    const t = await mk();
    await expect(completeTask(sql, creStaff(), t.id, 'https://drive/x', NOW)).rejects.toBeInstanceOf(ConflictError);
    // ...and the failed attempt left no half-written anchor behind.
    expect((await getTask(sql, creStaff(), t.id, NOW)).status).toBe(STATUS_DITUGASKAN);
  });

  it('cancel needs a reason and is refused to the PIC — they cannot erase their own lateness', async () => {
    const t = await mk(DUE_PAST);
    await expect(cancelTask(sql, creLead(), t.id, '  ', NOW)).rejects.toThrow(MSG_ALASAN_WAJIB);
    await expect(cancelTask(sql, creStaff(), t.id, 'tidak jadi', NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelTask(sql, od(), t.id, 'tidak jadi', NOW)).rejects.toBeInstanceOf(ForbiddenError);

    const c = await cancelTask(sql, creLead(), t.id, 'prioritas berubah', NOW);
    expect(c.status).toBe(STATUS_DIBATALKAN);
    expect(c.alasanPembatalan).toBe('prioritas berubah');
    // A cancelled task is never reported as late: the work was withdrawn, not missed.
    expect(c.terlambatBerjalan).toBe(false);
    expect(c.selesaiTerlambat).toBe(false);
  });
});

describeDb('lateness is DERIVED and PERMANENT (the owner requirement)', () => {
  it('running-late while open; still late after being completed late', async () => {
    const t = await mk(DUE_PAST);
    expect(t.terlambatBerjalan).toBe(true);
    expect(t.hariTerlambat).toBe(2); // 2026-08-18 -> 2026-08-20

    await startTask(sql, creStaff(), t.id, NOW);
    const done = await completeTask(sql, creStaff(), t.id, 'https://drive/x', NOW);

    // THE point of the design: completing it does not launder the lateness.
    expect(done.status).toBe(STATUS_SELESAI);
    expect(done.selesaiTerlambat).toBe(true);
    expect(done.hariTerlambat).toBe(2);
    expect(done.terlambatBerjalan).toBe(false);

    // And it is still late when re-read much later — the fact is two frozen
    // dates, not a flag someone can flip.
    const later = await getTask(sql, creLead(), t.id, new Date('2027-01-01T00:00:00Z'));
    expect(later.selesaiTerlambat).toBe(true);
    expect(later.hariTerlambat).toBe(2);
  });

  it('finishing ON the due date (late WIB evening) is on time, not late', async () => {
    const t = await mk('2026-08-20');
    await startTask(sql, creStaff(), t.id, NOW);
    // 2026-08-20 23:30 WIB = 16:30Z. In UTC this is still the 20th, but the
    // point is that WIB is what is compared — a naive UTC compare of
    // 2026-08-20T16:30Z against date 2026-08-20 also passes, so use 22:00Z
    // (= 2026-08-21 05:00 WIB) for the true boundary case below.
    const done = await completeTask(sql, creStaff(), t.id, 'https://drive/x', new Date('2026-08-20T16:30:00Z'));
    expect(done.selesaiTerlambat).toBe(false);
    expect(done.hariTerlambat).toBe(0);
  });

  it('WIB, not UTC: 2026-08-20 22:00Z is already 2026-08-21 in Jakarta, so it IS late', async () => {
    const t = await mk('2026-08-20');
    await startTask(sql, creStaff(), t.id, NOW);
    const done = await completeTask(sql, creStaff(), t.id, 'https://drive/x', new Date('2026-08-20T22:00:00Z'));
    expect(done.selesaiTerlambat).toBe(true);
    expect(done.hariTerlambat).toBe(1);
  });

  it('recomputes identically from the stored anchors alone (house rule #4)', async () => {
    const t = await mk(DUE_PAST);
    await startTask(sql, creStaff(), t.id, NOW);
    const done = await completeTask(sql, creStaff(), t.id, 'https://drive/x', NOW);

    // Recompute straight from SQL, touching only frozen columns. postgres.js
    // hands a `date` column back as a Date at UTC midnight, so take its ISO day.
    const [raw] = await sql<{ due_date: Date; selesai_pada: Date }[]>`
      select due_date, selesai_pada from internal_tasks where id = ${t.id}`;
    const due = new Date(`${raw.due_date.toISOString().slice(0, 10)}T00:00:00+07:00`);
    const days = Math.round((raw.selesai_pada.getTime() - due.getTime()) / 86_400_000);
    expect(days).toBe(done.hariTerlambat);
  });
});

describeDb('immutability — the DB refuses to let lateness be edited away', () => {
  it('due_date, assignee and the anchors are frozen; a terminal task cannot reopen', async () => {
    const t = await mk(DUE_PAST);
    await startTask(sql, creStaff(), t.id, NOW);

    // Moving the goalposts is the easiest way to erase lateness — blocked in DB.
    await expect(sql`update internal_tasks set due_date = '2026-12-31' where id = ${t.id}`)
      .rejects.toThrow(/due_date beku/);
    await expect(sql`update internal_tasks set assignee_id = ${CRE_STAFF2} where id = ${t.id}`)
      .rejects.toThrow(/assignee_id beku/);
    await expect(sql`update internal_tasks set assignee_division = 'Ads' where id = ${t.id}`)
      .rejects.toThrow(/assignee_division beku/);
    await expect(sql`update internal_tasks set dimulai_pada = now() where id = ${t.id}`)
      .rejects.toThrow(/dimulai_pada beku/);
    await expect(sql`update internal_tasks set created_by = ${DIR} where id = ${t.id}`)
      .rejects.toThrow(/created_by beku/);

    await completeTask(sql, creStaff(), t.id, 'https://drive/x', NOW);
    await expect(sql`update internal_tasks set selesai_pada = now() where id = ${t.id}`)
      .rejects.toThrow(/selesai_pada beku/);
    await expect(sql`update internal_tasks set link_hasil = 'https://lain' where id = ${t.id}`)
      .rejects.toThrow(/link_hasil beku/);
    await expect(sql`update internal_tasks set status = ${STATUS_DIKERJAKAN} where id = ${t.id}`)
      .rejects.toThrow(/terminal/);
  });

  it('[Selesai] cannot exist without a deliverable link (CHECK, not just TS)', async () => {
    const t = await mk();
    await startTask(sql, creStaff(), t.id, NOW);
    await expect(sql`
      update internal_tasks set status = ${STATUS_SELESAI}, selesai_pada = now() where id = ${t.id}`)
      .rejects.toThrow(/ck_internal_tasks_selesai/);
  });

  it('audit rows for a task cannot be updated or deleted', async () => {
    const t = await mk();
    await expect(sql`update audit_log set action = 'x' where entity_id = ${t.id}`).rejects.toThrow();
    await expect(sql`delete from audit_log where entity_id = ${t.id}`).rejects.toThrow();
  });
});

describeDb('notifikasi jatuh tempo (penugasan_reminder_tick) — katalog v10', () => {
  /** Recipients of one event on one task, sorted. */
  async function recipients(taskId: string, event: string): Promise<string[]> {
    const rows = await sql<{ recipient_employee_id: string }[]>`
      select recipient_employee_id from notifications
       where entity_id = ${taskId} and event_type = ${event}
       order by recipient_employee_id`;
    return rows.map((r) => r.recipient_employee_id);
  }

  it('H-1 goes to the PIC ALONE, and only once however often the job runs', async () => {
    const t = await mk('2026-08-21'); // NOW is 2026-08-20 WIB → due tomorrow

    const first = await runReminderTick(sql, NOW);
    expect(first.h1).toBeGreaterThanOrEqual(1);
    // The PIC and nobody else: a reminder copied to the boss is a report, and
    // nothing is late yet.
    expect(await recipients(t.id, 'penugasan_mendekati_jatuh_tempo')).toEqual([CRE_STAFF]);

    // Re-running the same day (or any later day) must not re-notify — the marker
    // column is what stops a daily job from becoming daily noise.
    const second = await runReminderTick(sql, NOW);
    expect(second.h1).toBe(0);
    expect(await recipients(t.id, 'penugasan_mendekati_jatuh_tempo')).toEqual([CRE_STAFF]);
  });

  it('past due reaches PIC + pemberi tugas + lead divisi, once', async () => {
    const t = await mk(DUE_PAST);

    const first = await runReminderTick(sql, NOW);
    expect(first.jatuhTempo).toBeGreaterThanOrEqual(1);
    // explicitOrLeads: the two explicit recipients plus the Creative lead, who
    // is resolved from the row's frozen `assignee_division`.
    expect(await recipients(t.id, 'penugasan_jatuh_tempo')).toEqual([CRE_LEAD, CRE_STAFF]);

    const second = await runReminderTick(sql, NOW);
    expect(second.jatuhTempo).toBe(0);
  });

  it('a task created already overdue skips H-1 and goes straight to past-due', async () => {
    const t = await mk(DUE_PAST);
    await runReminderTick(sql, NOW);
    // Nothing to warn about regarding "tomorrow" when tomorrow was yesterday.
    expect(await recipients(t.id, 'penugasan_mendekati_jatuh_tempo')).toEqual([]);
    expect(await recipients(t.id, 'penugasan_jatuh_tempo')).not.toEqual([]);
  });

  it('finished and cancelled tasks are never chased', async () => {
    const done = await mk(DUE_PAST);
    await startTask(sql, creStaff(), done.id, NOW);
    await completeTask(sql, creStaff(), done.id, 'https://drive/x', NOW);

    const cancelled = await mk(DUE_PAST);
    await cancelTask(sql, creLead(), cancelled.id, 'ditarik', NOW);

    await runReminderTick(sql, NOW);
    expect(await recipients(done.id, 'penugasan_jatuh_tempo')).toEqual([]);
    expect(await recipients(cancelled.id, 'penugasan_jatuh_tempo')).toEqual([]);
  });

  it('the idempotency markers cannot be reset (DB, not just the job)', async () => {
    // One task per marker: an already-overdue task never gets the H-1 marker
    // set, so false→false there is a no-op and would prove nothing.
    const late = await mk(DUE_PAST);
    const soon = await mk('2026-08-21');
    await runReminderTick(sql, NOW);

    // Resetting a marker would re-send the same notice — exactly the noise the
    // marker exists to prevent, so the trigger refuses it.
    await expect(sql`update internal_tasks set jatuh_tempo_terkirim = false where id = ${late.id}`)
      .rejects.toThrow(/jatuh_tempo_terkirim searah/);
    await expect(sql`update internal_tasks set pengingat_h1_terkirim = false where id = ${soon.id}`)
      .rejects.toThrow(/pengingat_h1_terkirim searah/);
  });

  it('cancelling notifies the PIC — otherwise they keep working on withdrawn work', async () => {
    const t = await mk(DUE_FUTURE);
    await cancelTask(sql, creLead(), t.id, 'prioritas berubah', NOW);
    expect(await recipients(t.id, 'penugasan_dibatalkan')).toEqual([CRE_STAFF]);
  });
});

describeDb('the API read path (withClaims) — RLS enforced, not just the domain gate', () => {
  /** Exactly the claim envelope apps/api `actorClaims` publishes. */
  const claims = (a: Actor): string => JSON.stringify({
    app_metadata: {
      employee_id: a.employeeId, division: a.role.division, level: a.role.level,
      od: a.role.od, director: a.role.director,
    },
  });

  it('reads through the authenticated role — the GRANT is real, and the scope holds', async () => {
    const mine = await mk(DUE_FUTURE, creLead(), CRE_STAFF);
    const other = await createTask(sql, adsLead(), { judul: 'ads', assigneeId: ADS_STAFF, dueDate: DUE_FUTURE }, NOW);

    // This is the case every OTHER test in this file is blind to: the suite
    // talks to Postgres as the migration owner (BYPASSRLS), while apps/api
    // switches to `authenticated` first. A missing `GRANT SELECT ... TO
    // authenticated` fails HERE with "permission denied for table
    // internal_tasks" — before any policy is evaluated — which is how the whole
    // feature can be dead in production with a fully green domain suite.
    const seen = await withClaims(sql, claims(creStaff()), (tx) =>
      listTasks(tx, creStaff(), {}, NOW));
    expect(seen.map((t) => t.id)).toEqual([mine.id]);

    // And RLS itself is doing the narrowing, not just the TS gate: the Ads row
    // is invisible to the Creative lead through this path too.
    const leadSeen = await withClaims(sql, claims(creLead()), (tx) =>
      listTasks(tx, creLead(), {}, NOW));
    expect(leadSeen.map((t) => t.id)).toContain(mine.id);
    expect(leadSeen.map((t) => t.id)).not.toContain(other.id);
  });
});

describeDb('disciplineSummary — the report the owner asked for', () => {
  it('splits on-time / late / running-late and renders — when nothing is closed', async () => {
    // CRE_STAFF: 1 late-closed, 1 on-time-closed, 1 running-late, 1 cancelled.
    const late = await mk(DUE_PAST);
    await startTask(sql, creStaff(), late.id, NOW);
    await completeTask(sql, creStaff(), late.id, 'https://drive/late', NOW);

    const ontime = await mk(DUE_FUTURE);
    await startTask(sql, creStaff(), ontime.id, NOW);
    await completeTask(sql, creStaff(), ontime.id, 'https://drive/ok', NOW);

    await mk(DUE_PAST); // still open, past due
    const cancelled = await mk(DUE_PAST);
    await cancelTask(sql, creLead(), cancelled.id, 'dibatalkan', NOW);

    // CRE_STAFF2: one open task, nothing closed yet.
    await mk(DUE_FUTURE, creLead(), CRE_STAFF2);

    const rows = await disciplineSummary(sql, creLead(), {}, NOW);
    const a = rows.find((r) => r.assigneeId === CRE_STAFF)!;
    expect(a).toMatchObject({
      total: 4, selesaiTepatWaktu: 1, selesaiTerlambat: 1,
      terlambatBerjalan: 1, berjalan: 0, dibatalkan: 1, totalHariTerlambat: 2,
    });
    expect(a.ketepatanPct).toBe(50);
    expect(a.ketepatanDisplay).toBe('50.00%');

    // Nothing closed => no percentage. Division by zero renders "—" (house rule #7),
    // never 0% — a person with no closed task has not failed anything.
    const b = rows.find((r) => r.assigneeId === CRE_STAFF2)!;
    expect(b).toMatchObject({ total: 1, berjalan: 1, ketepatanPct: null, ketepatanDisplay: '—' });
  });

  it('is scoped exactly like the list it summarises', async () => {
    await mk(DUE_FUTURE, creLead(), CRE_STAFF);
    await createTask(sql, adsLead(), { judul: 'ads', assigneeId: ADS_STAFF, dueDate: DUE_FUTURE }, NOW);

    const creative = await disciplineSummary(sql, creLead(), {}, NOW);
    expect(creative.map((r) => r.assigneeId)).toEqual([CRE_STAFF]);

    const own = await disciplineSummary(sql, creStaff(), {}, NOW);
    expect(own.map((r) => r.assigneeId)).toEqual([CRE_STAFF]);

    const all = await disciplineSummary(sql, director(), {}, NOW);
    expect(all.map((r) => r.assigneeId)).toEqual(expect.arrayContaining([CRE_STAFF, ADS_STAFF]));
  });

  it('hanyaTerlambat filters the list to late rows only', async () => {
    const late = await mk(DUE_PAST);
    await mk(DUE_FUTURE);
    const rows = await listTasks(sql, creLead(), { hanyaTerlambat: true }, NOW);
    expect(rows.map((r) => r.id)).toEqual([late.id]);
  });
});
