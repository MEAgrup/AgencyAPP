/**
 * O57 / backlog B-00 — the `CTR-` Contract entity.
 *
 * The assertions are organised around what the owner decision actually bought,
 * because the refactor is easy to land in a shape that compiles and still means
 * the old thing:
 *
 *   1. a Contract can cover MORE THAN ONE Service — otherwise it is `services`
 *      with a new name and O57 changed nothing;
 *   2. Rule 2 counts per AGREEMENT — two Services in one contract share the one
 *      `Aktif` slot, they do not get one each. This is the single assertion that
 *      distinguishes "done" from "renamed the column";
 *   3. the contract window has exactly ONE storage location — editing it through
 *      the Strategi header writes `contracts`, and M6B cannot find two answers
 *      to "how many months";
 *   4. `sumber_floor` records the APPROVAL PATH (item (b)), the AM cannot write
 *      it, and once a Head has approved, the floor is frozen BY THE DATABASE —
 *      not by a TS branch a service-role call would walk straight past.
 *
 * Skipped without DATABASE_URL. "82 skip" is not "82 pass" (HANDOFF_M6ABC_SESI5
 * §9) — these are meaningless unless they actually reach Postgres.
 */
// Rule 7 / item (b) — the floor approval path is asserted in `strategi.test.ts`,
// where the fixture that can actually reach `Aktif` already lives.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ident, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './account';
import {
  MSG_CLIENT_MISMATCH,
  MSG_CONTRACT_FORBIDDEN,
  MSG_CONTRACT_NOT_FOUND,
  MSG_INCOMPLETE,
  MSG_SERVICE_ALREADY_CONTRACTED,
  MSG_WINDOW_LOCKED,
  MSG_WINDOW_MISMATCH,
  attachService,
  canReadContract,
  canWriteContract,
  createContract,
  detachService,
  getContract,
  listContractsForClient,
  listServicesOfContract,
  updateContract,
} from './contract';
import {
  MSG_STRATEGI_EXISTS,
  createStrategi,
  listStrategiForService,
  updateHeader,
} from './strategi';

const am = (id = 'ZZ-AM') => ({
  employeeId: id,
  role: permission.makeRole({ division: 'Account', level: 'staff' }),
});
const otherAm = () => am('ZZ-AM2');
const spv = () => ({
  employeeId: 'ZZ-SPV',
  role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const director = () => ({
  employeeId: 'ZZ-DIR',
  role: permission.makeRole({ division: 'Account', level: 'staff', director: true }),
});
const od = () => ({
  employeeId: 'ZZ-OD',
  role: permission.makeRole({ division: 'Account', level: 'staff', od: true }),
});

describe('permission predicates', () => {
  it('lets the owning AM, the Account lead and a Director write', () => {
    expect(canWriteContract(am(), 'ZZ-AM')).toBe(true);
    expect(canWriteContract(otherAm(), 'ZZ-AM')).toBe(false);
    // Wider than `canWriteStrategi` on purpose: an agreement is a shared client
    // document, and the Account lead owns the client's commercial relationship.
    expect(canWriteContract(spv(), 'ZZ-AM')).toBe(true);
    expect(canWriteContract(director(), 'ZZ-AM')).toBe(true);
    expect(canWriteContract(am(), null)).toBe(false);
  });

  it('adds the read-everywhere roles on the read side only', () => {
    expect(canReadContract(od(), 'ZZ-AM')).toBe(true);
    expect(canWriteContract(od(), 'ZZ-AM')).toBe(false);
    expect(canReadContract(otherAm(), 'ZZ-AM')).toBe(false);
  });
});

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
  await sql`truncate strategi_version`;
  await sql`delete from strategi where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
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

/** One plan-gated Service under an existing client. */
async function seedService(clientId: string, tier = 'plan_wajib'): Promise<string> {
  seq += 1;
  const serviceId = `ZZ-SVC-${RUN}-${seq}`;
  const msv = await sql<{ service_id: string; version_no: number }[]>`
    select service_id, version_no from master_service_versions
     where name = 'Ads Management' order by version_no desc limit 1`;
  await sql`
    insert into services
      (id, client_id, master_service_id, master_version_no, name, standard_price,
       commission_rule, status, requires_strategy_plan, plan_tier, created_by)
    values (${serviceId}, ${clientId}, ${msv[0].service_id}, ${msv[0].version_no},
            'Full Store Management', '40000000.00', '10%', '[Awaiting Onboarding]',
            ${tier === 'plan_wajib'}, ${tier}, 'ZZ-AM')`;
  return serviceId;
}

const WINDOW = {
  durasiBulan: 6,
  tanggalMulai: '2026-08-12',
  tanggalAkhir: '2027-02-11',
};

const HEADER = {
  durasiKontrakBulan: 6,
  tanggalMulaiKontrak: '2026-08-12',
  tanggalAkhirKontrak: '2027-02-11',
  tanggalMulaiSiklus: '2026-08-12',
};

describeDb('the entity itself', () => {
  it('mints a house-format CTR- id and reads back what was written', async () => {
    const clientId = await seedClient();
    const c = await createContract(sql, am(), clientId, { ...WINDOW, catatan: 'kesepakatan 6 bulan' });
    expect(c.id).toMatch(/^CTR-\d{6}-\d{4}$/);
    expect(ident.isRegisteredPrefix('CTR')).toBe(true);
    expect(c.durasiBulan).toBe(6);
    expect(c.tanggalMulai).toBe('2026-08-12');
    expect(c.catatan).toBe('kesepakatan 6 bulan');

    const again = await getContract(sql, am(), c.id);
    expect(again).toEqual(c);
    expect(await listContractsForClient(sql, am(), clientId)).toHaveLength(1);
  });

  it('registers CTR in the DB half of the registry too (M6A §7)', async () => {
    // Two mechanisms, and the test that proves they agree. The typed PREFIXES
    // half is asserted by ident.registry.test.ts; this is the row.
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from entity_prefix where prefix = 'CTR'`;
    expect(rows[0].n).toBe(1);
  });

  it('refuses an incoherent window with the BI message, and a stranger with a 403', async () => {
    const clientId = await seedClient();
    await expect(
      createContract(sql, am(), clientId, { ...WINDOW, tanggalAkhir: '2026-08-11' }),
    ).rejects.toThrow(new ValidationError(MSG_INCOMPLETE));
    await expect(
      createContract(sql, am(), clientId, { ...WINDOW, durasiBulan: 0 }),
    ).rejects.toThrow(new ValidationError(MSG_INCOMPLETE));
    await expect(createContract(sql, otherAm(), clientId, WINDOW)).rejects.toThrow(
      new ForbiddenError(MSG_CONTRACT_FORBIDDEN),
    );
    await expect(getContract(sql, am(), 'CTR-209901-0001')).rejects.toThrow(
      new NotFoundError(MSG_CONTRACT_NOT_FOUND),
    );
  });
});

describeDb('one agreement, several Services (the point of O57)', () => {
  it('covers more than one Service', async () => {
    const clientId = await seedClient();
    const a = await seedService(clientId);
    const b = await seedService(clientId);
    const c = await createContract(sql, am(), clientId, WINDOW);

    await attachService(sql, am(), a, c.id);
    await attachService(sql, am(), b, c.id);
    expect(await listServicesOfContract(sql, c.id)).toEqual([a, b].sort());
  });

  /**
   * The assertion that separates O57 from a rename. Before it, each Service had
   * its own `Aktif` slot; after it, the two Services in one agreement share one,
   * so the second Strategi is refused. If this passes with `service_id` still in
   * place, nothing was actually migrated.
   */
  it('gives the whole agreement ONE Strategi, not one per Service (Rule 2)', async () => {
    const clientId = await seedClient();
    const a = await seedService(clientId);
    const b = await seedService(clientId);
    const c = await createContract(sql, am(), clientId, WINDOW);
    await attachService(sql, am(), a, c.id);
    await attachService(sql, am(), b, c.id);

    const s = await createStrategi(sql, am(), a, HEADER);
    expect(s.contractId).toBe(c.id);

    await expect(createStrategi(sql, am(), b, HEADER)).rejects.toThrow(
      new ConflictError(MSG_STRATEGI_EXISTS),
    );

    // …and it is visible from EITHER Service, because the Service is the way in,
    // not the owner. A reader on service B must not see an empty page.
    expect((await listStrategiForService(sql, am(), b)).map((v) => v.id)).toEqual([s.id]);
  });

  it('still lets two SEPARATE agreements of one client hold a Strategi each', async () => {
    const clientId = await seedClient();
    const a = await seedService(clientId);
    const b = await seedService(clientId);
    const c1 = await createContract(sql, am(), clientId, WINDOW);
    const c2 = await createContract(sql, am(), clientId, WINDOW);
    await attachService(sql, am(), a, c1.id);
    await attachService(sql, am(), b, c2.id);

    const s1 = await createStrategi(sql, am(), a, HEADER);
    const s2 = await createStrategi(sql, am(), b, HEADER);
    expect(s1.contractId).toBe(c1.id);
    expect(s2.contractId).toBe(c2.id);
  });

  it('refuses to attach across clients, or to steal a Service from another agreement', async () => {
    const clientA = await seedClient();
    const clientB = await seedClient();
    const svcB = await seedService(clientB);
    const contractA = await createContract(sql, am(), clientA, WINDOW);
    await expect(attachService(sql, am(), svcB, contractA.id)).rejects.toThrow(
      new ValidationError(MSG_CLIENT_MISMATCH),
    );

    const contractB1 = await createContract(sql, am(), clientB, WINDOW);
    const contractB2 = await createContract(sql, am(), clientB, WINDOW);
    await attachService(sql, am(), svcB, contractB1.id);
    await expect(attachService(sql, am(), svcB, contractB2.id)).rejects.toThrow(
      new ConflictError(MSG_SERVICE_ALREADY_CONTRACTED),
    );
  });

  /**
   * The composite FK, not a trigger. A Strategi row naming client A while its
   * contract belongs to client B must be unstorable — including through the
   * service-role connection these tests use.
   */
  it('cannot store a Strategi whose client disagrees with its contract (DB-level)', async () => {
    const clientA = await seedClient();
    const clientB = await seedClient();
    const contractA = await createContract(sql, am(), clientA, WINDOW);
    await expect(
      sql`insert into strategi (id, contract_id, client_id, versi_no, status, created_by)
          values ('STRG-209901-9999', ${contractA.id}, ${clientB}, 1, 'Draft', 'ZZ-AM')`,
    ).rejects.toThrow(/fk_strategi_contract/);
  });
});

describeDb('the window has one home', () => {
  it('mints a 1:1 agreement for a Service that has none, keeping POST /services/{id}/strategi intact', async () => {
    const clientId = await seedClient();
    const serviceId = await seedService(clientId);
    const s = await createStrategi(sql, am(), serviceId, HEADER);

    expect(s.contractId).toMatch(/^CTR-/);
    // The window the AM typed landed on the CONTRACT, and is only read back on
    // the Strategi.
    const c = await getContract(sql, am(), s.contractId);
    expect(c.durasiBulan).toBe(6);
    expect(s.durasiKontrakBulan).toBe(6);
    const svc = await sql<{ contract_id: string | null }[]>`
      select contract_id from services where id = ${serviceId}`;
    expect(svc[0].contract_id).toBe(s.contractId);
  });

  it('refuses a window that contradicts the agreement already covering the Service', async () => {
    const clientId = await seedClient();
    const serviceId = await seedService(clientId);
    const c = await createContract(sql, am(), clientId, WINDOW);
    await attachService(sql, am(), serviceId, c.id);

    await expect(
      createStrategi(sql, am(), serviceId, { ...HEADER, durasiKontrakBulan: 12 }),
    ).rejects.toThrow(new ConflictError(MSG_WINDOW_MISMATCH));
  });

  it('writes the contract when the Strategi header edits the window — no second copy', async () => {
    const clientId = await seedClient();
    const serviceId = await seedService(clientId);
    const s = await createStrategi(sql, am(), serviceId, HEADER);

    const edited = await updateHeader(sql, am(), s.id, {
      ...HEADER,
      durasiKontrakBulan: 12,
      tanggalAkhirKontrak: '2027-08-11',
    });
    expect(edited.durasiKontrakBulan).toBe(12);
    const c = await getContract(sql, am(), s.contractId);
    expect(c.durasiBulan).toBe(12);
    expect(c.tanggalAkhir).toBe('2027-08-11');
    // The column is GONE from `strategi`, so there is nothing left to diverge.
    const cols = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
       where table_name = 'strategi'
         and column_name in ('service_id', 'durasi_kontrak_bulan',
                             'tanggal_mulai_kontrak', 'tanggal_akhir_kontrak')`;
    expect(cols[0].n).toBe(0);
  });

  it('freezes the window once a Strategi hangs off the agreement', async () => {
    const clientId = await seedClient();
    const serviceId = await seedService(clientId);
    const s = await createStrategi(sql, am(), serviceId, HEADER);

    await expect(
      updateContract(sql, am(), s.contractId, { ...WINDOW, durasiBulan: 12 }),
    ).rejects.toThrow(new ConflictError(MSG_WINDOW_LOCKED));
    // …but the free-text note still moves: nothing computes from it.
    const noted = await updateContract(sql, am(), s.contractId, { ...WINDOW, catatan: 'diperpanjang lisan' });
    expect(noted.catatan).toBe('diperpanjang lisan');

    await expect(detachService(sql, am(), serviceId)).rejects.toThrow(
      new ConflictError(MSG_WINDOW_LOCKED),
    );
  });

  it('lets a Service leave while the agreement is still empty of Strategi', async () => {
    const clientId = await seedClient();
    const serviceId = await seedService(clientId);
    const c = await createContract(sql, am(), clientId, WINDOW);
    await attachService(sql, am(), serviceId, c.id);
    await detachService(sql, am(), serviceId);
    expect(await listServicesOfContract(sql, c.id)).toEqual([]);
  });
});
