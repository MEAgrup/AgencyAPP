/**
 * M15-C2 Client Portal — client-contact account realm tests.
 *
 * - Unit: the per-record permission predicate (`canManageOneClientContact`) —
 *   the one real difference from `vendor.canManageVendor`'s flat gate.
 * - Integration (skipped without DATABASE_URL): provisioning/list/status/
 *   admin-reset gates, and the self-service surface (getClientContactMe,
 *   clearClientContactMustChangePassword). CI/local Postgres has no `auth`
 *   schema, so the actual GoTrue-user-minting half of
 *   `provisionClientContact` cannot run here (same limitation
 *   `vendor.test.ts`'s "Vendor accounts" section documents) — every guard
 *   BEFORE that point (gate, validation, not-found, per-Client scoping) is
 *   fully covered, and one test documents that the plain-Postgres stack
 *   fails loudly rather than reporting false success.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ForbiddenError, NotFoundError } from './account';
import {
  MSG_CLIENT_NOT_FOUND,
  MSG_CONTACT_FORBIDDEN,
  MSG_CONTACT_NOT_FOUND,
  MSG_INCOMPLETE,
  adminResetClientContactPassword,
  canManageAllClientContacts,
  canManageOneClientContact,
  canReadAllClientContacts,
  clearClientContactMustChangePassword,
  findClientContactByEmailForReset,
  getClientContactMe,
  listClientContacts,
  provisionClientContact,
  setClientContactStatus,
} from './client-portal-auth';

const am = (id = 'ZZ-AM') => ({
  employeeId: id,
  role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const spv = () => ({
  employeeId: 'ZZ-SPV',
  role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const creativeLead = () => ({
  employeeId: 'ZZ-CRV',
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
const contactActor = (clientContactId: string, clientId: string) => ({
  employeeId: clientContactId,
  clientContactId,
  clientId,
  role: permission.makeRole({}),
});

describe('canManageOneClientContact — per-record, not flat like canManageVendor', () => {
  it('Director/Account-lead may manage ANY Client, own-AM-assignment irrelevant', () => {
    expect(canManageOneClientContact(director(), null)).toBe(true);
    expect(canManageOneClientContact(director(), 'SOMEONE-ELSE')).toBe(true);
    expect(canManageOneClientContact(spv(), 'SOMEONE-ELSE')).toBe(true);
  });

  it('a plain AM may manage only a Client assigned to them', () => {
    expect(canManageOneClientContact(am('ZZ-AM'), 'ZZ-AM')).toBe(true);
    expect(canManageOneClientContact(am('ZZ-AM'), 'ZZ-OTHER-AM')).toBe(false);
    expect(canManageOneClientContact(am('ZZ-AM'), null)).toBe(false);
  });

  it('a non-Account lead with no AM assignment on the Client may not manage it', () => {
    expect(canManageOneClientContact(creativeLead(), 'ZZ-AM')).toBe(false);
  });

  it('canManageAllClientContacts / canReadAllClientContacts: OD reads but never manages', () => {
    expect(canManageAllClientContacts(od())).toBe(false);
    expect(canReadAllClientContacts(od())).toBe(true);
    expect(canManageAllClientContacts(am())).toBe(false);
    expect(canReadAllClientContacts(am())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration
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
  await sql`delete from client_contacts where created_by like 'ZZ-%'`;
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

/** Inserts a client_contacts row directly (bypassing GoTrue minting — see suite header). */
async function fakeContact(
  clientId: string,
  opts: { nama?: string; email?: string; statusAktif?: boolean; mustChangePassword?: boolean } = {},
): Promise<string> {
  const rows = await sql<{ auth_user_id: string }[]>`
    insert into client_contacts (auth_user_id, client_id, nama, email, status_aktif, must_change_password, created_by)
    values (gen_random_uuid(), ${clientId}, ${opts.nama ?? 'Rani PIC'}, ${opts.email ?? 'rani@example.test'},
            ${opts.statusAktif ?? true}, ${opts.mustChangePassword ?? true}, 'ZZ-AM')
    returning auth_user_id`;
  return rows[0].auth_user_id;
}

describeDb('provisionClientContact', () => {
  it('refuses an AM not assigned to the Client', async () => {
    const clientId = await seedClient('ZZ-OTHER-AM');
    await expect(
      provisionClientContact(sql, am(), { clientId, nama: 'Rani', email: 'x@example.test' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows the assigned AM up to the GoTrue-minting step', async () => {
    const clientId = await seedClient('ZZ-AM');
    await expect(
      provisionClientContact(sql, am(), { clientId, nama: 'Rani', email: 'x@example.test' }),
    ).rejects.toThrow(/auth\.users/);
  });

  it('allows Account lead/Director for ANY Client', async () => {
    const clientId = await seedClient('ZZ-SOME-OTHER-AM');
    await expect(
      provisionClientContact(sql, spv(), { clientId, nama: 'Rani', email: 'x@example.test' }),
    ).rejects.toThrow(/auth\.users/);
    await expect(
      provisionClientContact(sql, director(), { clientId, nama: 'Rani', email: 'y@example.test' }),
    ).rejects.toThrow(/auth\.users/);
  });

  it('rejects blank client id, nama, or email', async () => {
    await expect(
      provisionClientContact(sql, director(), { clientId: '', nama: 'Rani', email: 'x@example.test' }),
    ).rejects.toThrow(MSG_INCOMPLETE);
    const clientId = await seedClient();
    await expect(
      provisionClientContact(sql, director(), { clientId, nama: '  ', email: 'x@example.test' }),
    ).rejects.toThrow(MSG_INCOMPLETE);
    await expect(
      provisionClientContact(sql, director(), { clientId, nama: 'Rani', email: '  ' }),
    ).rejects.toThrow(MSG_INCOMPLETE);
  });

  it('rejects an unknown client id', async () => {
    await expect(
      provisionClientContact(sql, director(), {
        clientId: 'ZZ-CLI-DOES-NOT-EXIST',
        nama: 'Rani',
        email: 'x@example.test',
      }),
    ).rejects.toThrow(MSG_CLIENT_NOT_FOUND);
  });

  it('fails loudly (not silently) on a stack with no auth schema', async () => {
    const clientId = await seedClient();
    await expect(
      provisionClientContact(sql, director(), { clientId, nama: 'Rani', email: 'new@example.test' }),
    ).rejects.toThrow(/auth\.users/);
  });
});

describeDb('setClientContactStatus', () => {
  it('refuses an AM not assigned to the Client', async () => {
    const clientId = await seedClient('ZZ-OTHER-AM');
    const uid = await fakeContact(clientId);
    await expect(setClientContactStatus(sql, am(), uid, false)).rejects.toThrow(MSG_CONTACT_FORBIDDEN);
  });

  it('rejects a blank auth_user_id', async () => {
    await expect(setClientContactStatus(sql, director(), '', false)).rejects.toThrow(MSG_INCOMPLETE);
  });

  it('refuses an unknown contact', async () => {
    await expect(
      setClientContactStatus(sql, director(), '11111111-1111-1111-1111-111111111111', false),
    ).rejects.toThrow(MSG_CONTACT_NOT_FOUND);
  });

  it('deactivates then reactivates, writing one audit row per move', async () => {
    const clientId = await seedClient();
    const uid = await fakeContact(clientId, { statusAktif: true });

    await setClientContactStatus(sql, am(), uid, false);
    let row = await sql<{ status_aktif: boolean }[]>`
      select status_aktif from client_contacts where auth_user_id = ${uid}::uuid`;
    expect(row[0].status_aktif).toBe(false);

    await setClientContactStatus(sql, am(), uid, true);
    row = await sql<{ status_aktif: boolean }[]>`
      select status_aktif from client_contacts where auth_user_id = ${uid}::uuid`;
    expect(row[0].status_aktif).toBe(true);

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'client_contact' and entity_id = ${uid}
       order by id asc`;
    expect(audit.map((a) => a.action)).toEqual(['deactivate', 'reactivate']);
  });
});

describeDb('listClientContacts', () => {
  it('scopes a plain AM to their own assigned Clients only — never throws Forbidden', async () => {
    const own = await seedClient('ZZ-AM');
    const other = await seedClient('ZZ-OTHER-AM');
    const ownUid = await fakeContact(own, { email: 'own@example.test' });
    await fakeContact(other, { email: 'other@example.test' });

    const rows = await listClientContacts(sql, am());
    expect(rows.some((r) => r.authUserId === ownUid)).toBe(true);
    expect(rows.every((r) => r.clientId !== other)).toBe(true);
  });

  it('Director/Account-lead/OD see every contact', async () => {
    const clientId = await seedClient('ZZ-SOME-AM');
    const uid = await fakeContact(clientId);
    for (const actor of [director(), spv(), od()]) {
      const rows = await listClientContacts(sql, actor);
      expect(rows.some((r) => r.authUserId === uid)).toBe(true);
    }
  });
});

describeDb('adminResetClientContactPassword', () => {
  it('refuses an AM not assigned to the Client', async () => {
    const clientId = await seedClient('ZZ-OTHER-AM');
    const uid = await fakeContact(clientId);
    await expect(
      adminResetClientContactPassword(sql, am(), uid, 'temp12345'),
    ).rejects.toThrow(MSG_CONTACT_FORBIDDEN);
  });

  it('refuses an unknown contact', async () => {
    await expect(
      adminResetClientContactPassword(sql, director(), '11111111-1111-1111-1111-111111111111', 'temp12345'),
    ).rejects.toThrow(MSG_CONTACT_NOT_FOUND);
  });

  it('rejects a too-short temp password', async () => {
    const clientId = await seedClient();
    const uid = await fakeContact(clientId);
    await expect(adminResetClientContactPassword(sql, am(), uid, 'short')).rejects.toThrow(/password/);
  });

  it('sets must_change_password=true and writes an audit row with NO password/hash in it', async () => {
    const clientId = await seedClient();
    const uid = await fakeContact(clientId, { mustChangePassword: false });

    await adminResetClientContactPassword(sql, am(), uid, 'newtemp12345');

    const row = await sql<{ must_change_password: boolean }[]>`
      select must_change_password from client_contacts where auth_user_id = ${uid}::uuid`;
    expect(row[0].must_change_password).toBe(true);

    const audit = await sql<{ action: string; after_json: unknown }[]>`
      select action, after_json from audit_log
       where entity_type = 'client_contact' and entity_id = ${uid} and action = 'admin_reset_password'`;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].after_json)).not.toMatch(/newtemp12345/);
  });
});

describeDb('getClientContactMe / clearClientContactMustChangePassword', () => {
  it('getClientContactMe returns the contact’s own profile + Client name', async () => {
    const clientId = await seedClient();
    const uid = await fakeContact(clientId, { nama: 'Budi', email: 'budi@example.test' });

    const me = await getClientContactMe(sql, contactActor(uid, clientId));
    expect(me.nama).toBe('Budi');
    expect(me.email).toBe('budi@example.test');
    expect(me.client_id).toBe(clientId);
    expect(me.nama_klien).toBe('Alpha Digital');
  });

  it('getClientContactMe throws NotFoundError for a deactivated contact', async () => {
    const clientId = await seedClient();
    const uid = await fakeContact(clientId, { statusAktif: false });
    await expect(getClientContactMe(sql, contactActor(uid, clientId))).rejects.toThrow(NotFoundError);
  });

  it('clearClientContactMustChangePassword flips the gate and writes an audit row', async () => {
    const clientId = await seedClient();
    const uid = await fakeContact(clientId, { mustChangePassword: true });

    await clearClientContactMustChangePassword(sql, contactActor(uid, clientId));

    const row = await sql<{ must_change_password: boolean; password_changed_at: Date | null }[]>`
      select must_change_password, password_changed_at from client_contacts where auth_user_id = ${uid}::uuid`;
    expect(row[0].must_change_password).toBe(false);
    expect(row[0].password_changed_at).not.toBeNull();

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'client_contact' and entity_id = ${uid} and action = 'change_password'`;
    expect(audit).toHaveLength(1);
  });
});

describeDb('findClientContactByEmailForReset', () => {
  it('returns null on a stack with no auth schema (email match needs auth.users — see suite header)', async () => {
    const clientId = await seedClient();
    await fakeContact(clientId, { email: 'findme@example.test' });
    // Documents the plain-Postgres limitation rather than asserting a false
    // positive: the real join lives in client_contact_auth_user_by_email(),
    // which itself returns NULL when auth.users does not exist.
    await expect(findClientContactByEmailForReset(sql, 'findme@example.test')).resolves.toBeNull();
  });

  it('returns null for a blank email without querying', async () => {
    await expect(findClientContactByEmailForReset(sql, '  ')).resolves.toBeNull();
  });
});
