/**
 * Module 6A §7 / D19 — Vendor tests.
 *
 * - Unit: the fee-scheme pairing (`bagi_hasil` is a percentage, everything else
 *   is rupiah) and the permission predicate. Both are cheap and both guard a
 *   number that ends up on the F-4 screen as money.
 * - Integration (skipped without DATABASE_URL): the ID shape, the duplicate-name
 *   guard, and the `vendor` machine — including the two things that are easy to
 *   get wrong and expensive to discover later: a staff AM must not be able to
 *   blacklist a shared master record, and a blacklist must be reversible through
 *   the engine rather than through a raw UPDATE.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ident, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ConflictError, ForbiddenError, ValidationError } from './account';
import {
  MSG_RATE_MISMATCH,
  MSG_VENDOR_EXISTS,
  VENDOR_STATUS_AKTIF,
  VENDOR_STATUS_BLACKLIST,
  VENDOR_STATUS_NONAKTIF,
  canManageVendor,
  createVendor,
  getVendor,
  listVendors,
  normalizeVendorInput,
  setVendorStatus,
  updateVendor,
  type VendorInput,
} from './vendor';

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

const base: VendorInput = {
  namaVendor: 'PT Live Kita',
  jenisLayanan: 'live_stream',
  picNama: 'Rani',
  picKontak: '08123456789',
  skemaBiaya: 'per_jam',
  tarif: '250000.00',
};

describe('normalizeVendorInput — the fee scheme and its rate travel together', () => {
  it('accepts a rupiah rate for per_jam / per_sesi / retainer', () => {
    expect(normalizeVendorInput(base).tarif).toBe('250000.00');
    expect(normalizeVendorInput({ ...base, skemaBiaya: 'retainer' }).bagiHasilPersen).toBeNull();
  });

  it('accepts a percentage for bagi_hasil', () => {
    const v = normalizeVendorInput({
      ...base,
      skemaBiaya: 'bagi_hasil',
      tarif: null,
      bagiHasilPersen: 15,
    });
    expect(v.bagiHasilPersen).toBe(15);
    expect(v.tarif).toBeNull();
  });

  it('rejects a bagi_hasil vendor priced in rupiah', () => {
    // Not a pedantic check: 15 stored where rupiah is displayed reads as Rp 15,
    // and 15.000.000 stored where a percentage is displayed reads as 15000000%.
    expect(() =>
      normalizeVendorInput({ ...base, skemaBiaya: 'bagi_hasil', tarif: '15000000.00' }),
    ).toThrow(MSG_RATE_MISMATCH);
  });

  it('rejects a per_jam vendor priced as a percentage', () => {
    expect(() => normalizeVendorInput({ ...base, tarif: null, bagiHasilPersen: 15 })).toThrow(
      ValidationError,
    );
  });

  it('rejects a percentage outside 0 < p <= 100', () => {
    expect(() =>
      normalizeVendorInput({ ...base, skemaBiaya: 'bagi_hasil', tarif: null, bagiHasilPersen: 0 }),
    ).toThrow(ValidationError);
    expect(() =>
      normalizeVendorInput({ ...base, skemaBiaya: 'bagi_hasil', tarif: null, bagiHasilPersen: 101 }),
    ).toThrow(ValidationError);
  });

  it('rejects a blank name or PIC with the house message', () => {
    expect(() => normalizeVendorInput({ ...base, namaVendor: '   ' })).toThrow(
      '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]',
    );
    expect(() => normalizeVendorInput({ ...base, picKontak: '' })).toThrow(ValidationError);
  });
});

describe('canManageVendor — a shared master record, not an AM-owned one', () => {
  it('allows the Account lead and the Director', () => {
    expect(canManageVendor(spv())).toBe(true);
    expect(canManageVendor(director())).toBe(true);
  });

  it('refuses a staff AM, another division lead, and an OD', () => {
    // The AM is the one who USES the vendor in E-8; letting them blacklist it
    // would let one AM break another AM's booked hours.
    expect(canManageVendor(am())).toBe(false);
    expect(canManageVendor(creativeLead())).toBe(false);
    expect(canManageVendor(od())).toBe(false);
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
  // audit_log is append-only and is never cleaned; every test uses a name unique
  // per RUN so its assertions cannot depend on run history.
  await sql`delete from vendors where created_by like 'ZZ-%'`;
});

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

function uniqueName(): string {
  seq += 1;
  return `ZZ Vendor ${RUN}-${seq}`;
}

describeDb('createVendor', () => {
  it('mints a house-shaped VND- id and records an audit row', async () => {
    const nama = uniqueName();
    const v = await createVendor(sql, spv(), { ...base, namaVendor: nama });

    expect(ident.parse(v.id)?.prefix).toBe('VND');
    expect(ident.isValid(v.id)).toBe(true);
    expect(v.status).toBe(VENDOR_STATUS_AKTIF);

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'vendor' and entity_id = ${v.id}`;
    expect(audit.map((a) => a.action)).toEqual(['create']);
  });

  it('refuses a staff AM', async () => {
    await expect(createVendor(sql, am(), { ...base, namaVendor: uniqueName() })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuses a duplicate name regardless of case and padding', async () => {
    const nama = uniqueName();
    await createVendor(sql, spv(), { ...base, namaVendor: nama });
    await expect(
      createVendor(sql, spv(), { ...base, namaVendor: `  ${nama.toUpperCase()} ` }),
    ).rejects.toThrow(MSG_VENDOR_EXISTS);
  });

  it('lets the DB refuse the duplicate too — the index is the real guarantee', async () => {
    const nama = uniqueName();
    await createVendor(sql, spv(), { ...base, namaVendor: nama });
    await expect(
      sql`insert into vendors (id, nama_vendor, jenis_layanan, status, pic_nama, pic_kontak,
                               skema_biaya, tarif, created_by)
          values ('VND-209901-9999', ${nama.toLowerCase()}, 'talent', 'Aktif', 'X', 'Y',
                  'per_sesi', 1, 'ZZ-SPV')`,
    ).rejects.toThrow();
  });

  it('lets the DB refuse a bagi_hasil vendor carrying a rupiah rate', async () => {
    await expect(
      sql`insert into vendors (id, nama_vendor, jenis_layanan, status, pic_nama, pic_kontak,
                               skema_biaya, tarif, bagi_hasil_persen, created_by)
          values ('VND-209901-9998', ${uniqueName()}, 'live_stream', 'Aktif', 'X', 'Y',
                  'bagi_hasil', 250000, 15, 'ZZ-SPV')`,
    ).rejects.toThrow();
  });
});

describeDb('updateVendor', () => {
  it('edits the eight fields and leaves status alone', async () => {
    const v = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });
    const updated = await updateVendor(sql, spv(), v.id, {
      ...base,
      namaVendor: v.namaVendor,
      skemaBiaya: 'bagi_hasil',
      tarif: null,
      bagiHasilPersen: 12.5,
      catatanKinerja: 'telat dua kali',
    });
    expect(updated.bagiHasilPersen).toBe(12.5);
    expect(updated.tarif).toBeNull();
    expect(updated.status).toBe(VENDOR_STATUS_AKTIF);
  });

  it('refuses a staff AM', async () => {
    const v = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });
    await expect(
      updateVendor(sql, am(), v.id, { ...base, namaVendor: v.namaVendor }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describeDb('setVendorStatus — the machine, not an UPDATE', () => {
  it('walks Aktif → Nonaktif → Aktif and writes one audit row per move', async () => {
    const v = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });

    const off = await setVendorStatus(sql, spv(), v.id, VENDOR_STATUS_NONAKTIF);
    expect(off.status).toBe(VENDOR_STATUS_NONAKTIF);
    const on = await setVendorStatus(sql, spv(), v.id, VENDOR_STATUS_AKTIF);
    expect(on.status).toBe(VENDOR_STATUS_AKTIF);

    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'vendor' and entity_id = ${v.id}
       order by id asc`;
    expect(audit.map((a) => a.action)).toEqual([
      'create',
      'transition:Aktif->Nonaktif',
      'transition:Nonaktif->Aktif',
    ]);
  });

  it('reverses a blacklist through Nonaktif — two steps, two audit rows', async () => {
    // The direct edge Blacklist → Aktif does not exist on purpose: reinstating a
    // vendor should be a decision someone made twice, and a terminal Blacklist
    // would leave a raw UPDATE as the only way to fix a mistake.
    const v = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });
    await setVendorStatus(sql, spv(), v.id, VENDOR_STATUS_BLACKLIST);

    await expect(setVendorStatus(sql, spv(), v.id, VENDOR_STATUS_AKTIF)).rejects.toThrow(
      ConflictError,
    );
    const back = await setVendorStatus(sql, spv(), v.id, VENDOR_STATUS_NONAKTIF);
    expect(back.status).toBe(VENDOR_STATUS_NONAKTIF);
    expect((await setVendorStatus(sql, spv(), v.id, VENDOR_STATUS_AKTIF)).status).toBe(
      VENDOR_STATUS_AKTIF,
    );
  });

  it('refuses a staff AM at the domain gate', async () => {
    const v = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });
    await expect(setVendorStatus(sql, am(), v.id, VENDOR_STATUS_BLACKLIST)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuses a staff AM inside sm_transition too, bypassing the domain', async () => {
    // Belt and braces: every `vendor` edge is require_lead, so a service-role
    // caller that skips the module still cannot move the status.
    const v = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });
    const res = await sql<{ r: { ok: boolean; code?: string } }[]>`
      select sm_transition('vendor', 'vendor', 'vendors', 'id', 'status',
                           ${v.id}, 'Blacklist', 'ZZ-AM', false, false) as r`;
    expect(res[0].r.ok).toBe(false);
    expect(res[0].r.code).toBe('role_denied');
  });
});

describeDb('listVendors — a picker, not an archive', () => {
  it('hides retired vendors by default and shows them on request', async () => {
    const live = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });
    const retired = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });
    await setVendorStatus(sql, spv(), retired.id, VENDOR_STATUS_BLACKLIST);

    const picker = await listVendors(sql, { jenisLayanan: 'live_stream' });
    const ids = picker.map((v) => v.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(retired.id);

    const all = await listVendors(sql, { includeInactive: true });
    expect(all.map((v) => v.id)).toContain(retired.id);
    // A retired vendor still resolves by id — Strategi rows pointing at it read
    // fine, which is the whole reason status moves instead of rows being deleted.
    expect((await getVendor(sql, retired.id)).status).toBe(VENDOR_STATUS_BLACKLIST);
  });

  it('filters by jenis_layanan', async () => {
    const talent = await createVendor(sql, spv(), {
      ...base,
      namaVendor: uniqueName(),
      jenisLayanan: 'talent',
    });
    const live = await createVendor(sql, spv(), { ...base, namaVendor: uniqueName() });
    const onlyTalent = (await listVendors(sql, { jenisLayanan: 'talent' })).map((v) => v.id);
    expect(onlyTalent).toContain(talent.id);
    expect(onlyTalent).not.toContain(live.id);
  });
});
