/**
 * Daily Activity (DACT-, F-6) — pure gates run everywhere; the write door +
 * RLS-adjacent scoping need a DB and skip unless DATABASE_URL is set, exactly
 * like `activity.test.ts` (ACT-). Rows here use their own actor prefix
 * `ZDACT-` so a sibling suite's `ZZ-%` cleanup never races this one.
 *
 * What is asserted deliberately:
 *   - mandatory fields (jenis, tanggal, jam mulai, keterangan) → the specific
 *     BI message, never a silent default;
 *   - the closed activity-type taxonomy;
 *   - `divisi` is stamped from the ACTOR's own role at write time (the
 *     denormalization RLS depends on), not read back from `employees`;
 *   - IMMUTABILITY at the DB level (trigger, not merely "no edit route").
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { permission } from '@cdps/core';
import {
  ACTIVITY_TYPES,
  ConflictError,
  IncompleteError,
  NotFoundError,
  isKnownType,
  list,
  log,
  type Actor,
} from './dailyactivity';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const BUDI = 'ZDACT-BUDI';
const LEAD = 'ZDACT-LEAD';

const budi = (): Actor => ({ employeeId: BUDI, role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
const salesLead = (): Actor => ({ employeeId: LEAD, role: permission.makeRole({ division: 'Sales', level: 'lead' }) });

async function insEmployee(id: string): Promise<void> {
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${id}, ${id}, ${`${id}@zdact.test`}, 'Sales', 'Sales Executive', true, 'ZDACT-TEST')
    on conflict (employee_id) do nothing`;
}

beforeAll(async () => {
  if (!sql) return;
  await insEmployee(BUDI);
  await insEmployee(LEAD);
});

/**
 * Cleanup has to STEP AROUND the immutability trigger — `daily_activities`
 * genuinely refuses DELETE, so a test fixture cannot tidy up the way it can
 * for a mutable table. Same pattern as `activity.test.ts`'s `purgeActivities`:
 * disable → delete → re-enable, run as the owning (superuser) test role.
 */
afterEach(async () => {
  if (!sql) return;
  await sql`alter table daily_activities disable trigger daily_activities_no_delete`;
  try {
    await sql`delete from daily_activities where employee_id like 'ZDACT-%'`;
  } finally {
    await sql`alter table daily_activities enable trigger daily_activities_no_delete`;
  }
});

afterAll(async () => {
  if (sql) await sql.end();
});

describe('isKnownType', () => {
  it('accepts every closed taxonomy value and rejects anything else', () => {
    for (const t of ACTIVITY_TYPES) {
      expect(isKnownType(t)).toBe(true);
    }
    expect(isKnownType('Cuti')).toBe(false);
    expect(isKnownType('')).toBe(false);
  });
});

describeDb('log', () => {
  it('rejects missing/invalid mandatory fields with the exact BI message, before writing anything', async () => {
    await expect(log(sql, budi(), {
      activityType: '', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'x',
    })).rejects.toBeInstanceOf(IncompleteError);
    await expect(log(sql, budi(), {
      activityType: 'Cuti', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'x',
    })).rejects.toBeInstanceOf(IncompleteError);
    await expect(log(sql, budi(), {
      activityType: 'Meeting Klien', activityDate: 'not-a-date', jamMulai: '09:00', keterangan: 'x',
    })).rejects.toBeInstanceOf(IncompleteError);
    await expect(log(sql, budi(), {
      activityType: 'Meeting Klien', activityDate: '2026-09-14', jamMulai: '25:99', keterangan: 'x',
    })).rejects.toBeInstanceOf(IncompleteError);
    await expect(log(sql, budi(), {
      activityType: 'Meeting Klien', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: '   ',
    })).rejects.toBeInstanceOf(IncompleteError);
    // jam selesai < jam mulai
    await expect(log(sql, budi(), {
      activityType: 'Meeting Klien', activityDate: '2026-09-14', jamMulai: '10:00', jamSelesai: '09:00', keterangan: 'x',
    })).rejects.toBeInstanceOf(IncompleteError);

    const rows = await sql<{ n: number }[]>`select count(*)::int as n from daily_activities where employee_id = ${BUDI}`;
    expect(rows[0].n).toBe(0);
  });

  it('records the activity under the ACTOR themselves, stamping divisi from their own role', async () => {
    const a = await log(sql, budi(), {
      activityType: 'Meeting Klien', activityDate: '2026-09-14', jamMulai: '09:00', jamSelesai: '10:30',
      keterangan: 'Meeting kick-off campaign Ramadan dengan klien Alpha Digital',
      buktiPelaksanaan: 'https://drive.example/bukti-1',
    });
    expect(a.id).toMatch(/^DACT-\d{6}-\d{4}$/);
    expect(a.employeeId).toBe(BUDI);
    expect(a.divisi).toBe('Sales');
    expect(a.activityType).toBe('Meeting Klien');
    expect(a.jamSelesai).toBe('10:30');
    expect(a.buktiPelaksanaan).toBe('https://drive.example/bukti-1');

    const rows = await sql<{ divisi: string; created_by: string }[]>`
      select divisi, created_by from daily_activities where id = ${a.id}`;
    expect(rows[0].divisi).toBe('Sales');
    expect(rows[0].created_by).toBe(BUDI);
  });

  it('accepts an activity with no jam selesai / no bukti (both optional)', async () => {
    const a = await log(sql, budi(), {
      activityType: 'Input Data', activityDate: '2026-09-14', jamMulai: '14:00', keterangan: 'Update CRM',
    });
    expect(a.jamSelesai).toBeNull();
    expect(a.buktiPelaksanaan).toBeNull();
  });

  it('is append-only — UPDATE and DELETE are refused at the trigger level', async () => {
    const a = await log(sql, budi(), {
      activityType: 'Training', activityDate: '2026-09-14', jamMulai: '13:00', keterangan: 'Training onboarding',
    });
    await expect(sql`update daily_activities set keterangan = 'edited' where id = ${a.id}`).rejects.toThrow();
    await expect(sql`delete from daily_activities where id = ${a.id}`).rejects.toThrow();
  });
});

describeDb('log — F-6b koreksi berantai', () => {
  it('inserts a NEW row pointing at the predecessor, never mutating it', async () => {
    const original = await log(sql, budi(), {
      activityType: 'Meeting Klien', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'Salah jam',
    });
    const koreksi = await log(sql, budi(), {
      activityType: 'Meeting Klien', activityDate: '2026-09-14', jamMulai: '10:00', keterangan: 'Jam yang benar',
      koreksiDari: original.id,
    });
    expect(koreksi.koreksiDari).toBe(original.id);
    expect(koreksi.dikoreksiOleh).toBeNull();

    const rows = await list(sql, { employeeId: BUDI });
    const orig = rows.find((r) => r.id === original.id)!;
    const kor = rows.find((r) => r.id === koreksi.id)!;
    expect(orig.dikoreksiOleh).toBe(koreksi.id);
    expect(orig.keterangan).toBe('Salah jam'); // never rewritten
    expect(kor.koreksiDari).toBe(original.id);
  });

  it('rejects correcting a row that does not exist or is not the actor\'s own', async () => {
    await expect(log(sql, budi(), {
      activityType: 'Meeting Klien', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'x',
      koreksiDari: 'DACT-999999-9999',
    })).rejects.toBeInstanceOf(NotFoundError);

    const leadEntry = await log(sql, salesLead(), {
      activityType: 'Meeting Internal', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'punya lead',
    });
    await expect(log(sql, budi(), {
      activityType: 'Meeting Internal', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'coba koreksi punya orang',
      koreksiDari: leadEntry.id,
    })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects correcting a row that has already been corrected (chain, not tree)', async () => {
    const original = await log(sql, budi(), {
      activityType: 'Training', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'v1',
    });
    await log(sql, budi(), {
      activityType: 'Training', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'v2',
      koreksiDari: original.id,
    });
    await expect(log(sql, budi(), {
      activityType: 'Training', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'v3 tapi menunjuk v1',
      koreksiDari: original.id,
    })).rejects.toBeInstanceOf(ConflictError);
  });
});

describeDb('list', () => {
  it('narrows by employeeId and date range', async () => {
    await log(sql, budi(), { activityType: 'Webinar', activityDate: '2026-09-10', jamMulai: '09:00', keterangan: 'Webinar A' });
    await log(sql, budi(), { activityType: 'Webinar', activityDate: '2026-09-14', jamMulai: '09:00', keterangan: 'Webinar B' });
    await log(sql, salesLead(), { activityType: 'Meeting Internal', activityDate: '2026-09-14', jamMulai: '10:00', keterangan: 'Sync tim' });

    const onlyBudi = await list(sql, { employeeId: BUDI });
    expect(onlyBudi.every((r) => r.employeeId === BUDI)).toBe(true);
    expect(onlyBudi.length).toBe(2);

    const fromDate = await list(sql, { employeeId: BUDI, from: '2026-09-12' });
    expect(fromDate.map((r) => r.keterangan)).toEqual(['Webinar B']);

    // newest first
    const all = await list(sql, { employeeId: BUDI });
    expect(all[0].activityDate >= all[all.length - 1].activityDate).toBe(true);
  });
});
