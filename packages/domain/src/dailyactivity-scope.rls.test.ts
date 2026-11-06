/**
 * F-6 — `daily_activities_select` lewat klaim JWT sungguhan (`withClaims`:
 * `SET LOCAL ROLE authenticated`), pola `storeops-sku.rls.test.ts`. Tes domain
 * biasa (`dailyactivity.test.ts`) memakai koneksi BYPASSRLS, jadi buta terhadap
 * gejala yang dilaporkan: halaman 200, tapi barisnya tidak pernah datang.
 *
 * Gejala (Yulianti, Head of Account, 2026-10-30): Riwayat Head of Account hanya
 * memuat AM dan CRO (divisi `Account`); Advertiser jatuh ke lead Ads, KOL ke
 * lead KOL, AI Optimizer ke lead AI Optimizer, Store Operation ke siapa pun
 * tidak. Keputusan pemilik (Yohan, 2026-11-06): divisi di bawah Head of Account
 * = Account (AM + CRO), Ads, KOL, AI Optimizer, Store Operation.
 *
 * Kontrak yang dikunci di sini:
 *   - Head of Account (lead `Account`) melihat kelima divisi itu;
 *   - lead divisi lain TETAP hanya divisinya sendiri (tidak ikut melebar);
 *   - staff Account (AM biasa) TETAP hanya miliknya sendiri;
 *   - divisi di LUAR daftar (Creative, Sales) tidak terlihat Head of Account.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZDSC-`.
 */
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { list } from './dailyactivity';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

/** divisi → pemilik baris + id baris. Satu baris per divisi. */
const BARIS: Record<string, { emp: string; id: string }> = {
  Account:           { emp: 'ZDSC-AM',    id: 'DACT-ZDSC-01' },
  Ads:               { emp: 'ZDSC-ADV',   id: 'DACT-ZDSC-02' },
  KOL:               { emp: 'ZDSC-KOL',   id: 'DACT-ZDSC-03' },
  'AI Optimizer':    { emp: 'ZDSC-AIO',   id: 'DACT-ZDSC-04' },
  'Store Operation': { emp: 'ZDSC-SOP',   id: 'DACT-ZDSC-05' },
  Creative:          { emp: 'ZDSC-CRE',   id: 'DACT-ZDSC-06' },
  Sales:             { emp: 'ZDSC-SLS',   id: 'DACT-ZDSC-07' },
};
const id = (divisi: string): string => BARIS[divisi].id;

const claims = (o: { employeeId: string; division: string; level: string }): string =>
  JSON.stringify({
    app_metadata: { employee_id: o.employeeId, division: o.division, level: o.level, od: false, director: false },
  });

async function terlihat(o: { employeeId: string; division: string; level: string }): Promise<string[]> {
  const rows = await withClaims(sql, claims(o), (tx) =>
    tx<{ id: string }[]>`select id from daily_activities where id like 'DACT-ZDSC-%' order by id`,
  );
  return rows.map((r) => r.id);
}

async function bersihkan(): Promise<void> {
  await sql`alter table daily_activities disable trigger daily_activities_no_delete`;
  try {
    await sql`delete from daily_activities where id like 'DACT-ZDSC-%'`;
  } finally {
    await sql`alter table daily_activities enable trigger daily_activities_no_delete`;
  }
}

beforeAll(async () => {
  if (!sql) return;
  await bersihkan();
  for (const [divisi, b] of Object.entries(BARIS)) {
    await sql`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values ('ZDSC', ${`JABATAN ${divisi}`}, ${divisi}, 'staff', 'ZDSC-TEST')
      on conflict (divisi, jabatan) do nothing`;
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${b.emp}, ${b.emp}, ${`${b.emp}@zdsc.test`}, 'ZDSC', ${`JABATAN ${divisi}`}, true, 'ZDSC-TEST')
      on conflict (employee_id) do nothing`;
    await sql`
      insert into daily_activities
        (id, employee_id, divisi, activity_type, activity_date, jam_mulai, keterangan, created_by)
      values (${b.id}, ${b.emp}, ${divisi}, 'Input Data', '2026-10-30', '09:00', ${`aktivitas ${divisi}`}, ${b.emp})`;
  }
});

afterAll(async () => {
  if (!sql) return;
  await bersihkan();
  await sql`delete from employees where employee_id like 'ZDSC-%'`;
  await sql`delete from role_mappings where divisi = 'ZDSC'`;
  await sql.end();
});

dDb('daily_activities_select — Head of Account melihat divisi bawahannya', () => {
  it('Head of Account (lead Account) melihat Account, Ads, KOL, AI Optimizer, Store Operation — bukan Creative/Sales', async () => {
    const got = await terlihat({ employeeId: 'ZDSC-HOA', division: 'Account', level: 'lead' });
    expect(got).toEqual(
      ['Account', 'Ads', 'KOL', 'AI Optimizer', 'Store Operation'].map(id).sort(),
    );
  });

  it('lead divisi lain tetap hanya divisinya sendiri (tidak ikut melebar)', async () => {
    expect(await terlihat({ employeeId: 'ZDSC-LADS', division: 'Ads', level: 'lead' })).toEqual([id('Ads')]);
    expect(await terlihat({ employeeId: 'ZDSC-LKOL', division: 'KOL', level: 'lead' })).toEqual([id('KOL')]);
    expect(await terlihat({ employeeId: 'ZDSC-LAIO', division: 'AI Optimizer', level: 'lead' })).toEqual([id('AI Optimizer')]);
    expect(await terlihat({ employeeId: 'ZDSC-LSOP', division: 'Store Operation', level: 'lead' })).toEqual([id('Store Operation')]);
    expect(await terlihat({ employeeId: 'ZDSC-LCRE', division: 'Creative', level: 'lead' })).toEqual([id('Creative')]);
  });

  it('staff Account (AM biasa) dan staff divisi bawahan tetap hanya miliknya sendiri', async () => {
    expect(await terlihat({ employeeId: 'ZDSC-AM', division: 'Account', level: 'staff' })).toEqual([id('Account')]);
    expect(await terlihat({ employeeId: 'ZDSC-AM2', division: 'Account', level: 'staff' })).toEqual([]);
    expect(await terlihat({ employeeId: 'ZDSC-ADV', division: 'Ads', level: 'staff' })).toEqual([id('Ads')]);
  });

  it('list() lewat RLS membawa jabatan pelaku (bahan filter Jabatan di Riwayat)', async () => {
    const rows = await withClaims(
      sql,
      claims({ employeeId: 'ZDSC-HOA', division: 'Account', level: 'lead' }),
      (tx) => list(tx),
    );
    const mine = rows.filter((r) => r.id.startsWith('DACT-ZDSC-'));
    expect(mine.find((r) => r.id === id('Ads'))?.employeeJabatan).toBe('JABATAN Ads');
    expect(mine.find((r) => r.id === id('Store Operation'))?.employeeJabatan).toBe('JABATAN Store Operation');
  });
});
