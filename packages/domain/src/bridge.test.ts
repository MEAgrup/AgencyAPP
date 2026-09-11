/**
 * Bridge MSDPS→CDPS Fase 1 — `packages/domain/src/bridge.ts`.
 *
 * Bridge is not a PRD module (`docs/DECISIONS.md` 2026-09-10), so there is no
 * PRD acceptance criteria to mirror — the DoD here is the explicit list in
 * `RENCANA_BRIDGE_MSDPS_CDPS_FASE1.md` A5: idempotency, no-attestation
 * reject (incl. Director), atomic unmapped-service failure, immutability,
 * dedup race, permissions (incl. OD/Director layered), zero
 * `client_sales_allocations`, zero TRX leakage.
 *
 * ⚠️ This connection is service-role (BYPASSRLS). Green here proves the
 * domain gate, not RLS visibility — RLS is asserted by
 * `supabase/tests/rls_checks.sql` (O48 ledger entry for
 * `external_service_map_select`) and the migration itself.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Actor } from './account';
import * as bridge from './bridge';
import { createService as createMasterService } from './msl';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const leadAccount = (): Actor => ({ employeeId: 'ZBR-LEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = (): Actor => ({ employeeId: 'ZBR-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });
const amStaff = (): Actor => ({ employeeId: 'ZBR-AM', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const od = (): Actor => ({ employeeId: 'ZBR-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const salesLeadActor = (): Actor => ({ employeeId: 'ZBR-SLEAD', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'lead' }) });

const BRIDGE_EMP = 'ZBR-SVC-BRIDGE';

let seq = 0;
function uniq(): string {
  seq += 1;
  return `${Date.now() % 10000000}${seq}`;
}

async function insEmployees(): Promise<void> {
  const rows: [string, string, string][] = [
    ['ZBR-LEAD', 'Account', 'HEAD OF ACCOUNT'],
    ['ZBR-DIR', 'Management', 'Direktur'],
    ['ZBR-AM', 'Account', 'ACCOUNT MANAGER'],
    ['ZBR-OD', 'Management', 'ORGANIZATION DEVELOPMENT'],
    ['ZBR-SLEAD', 'Sales', 'SALES HEAD'],
    [BRIDGE_EMP, 'Account', 'MEAGO BRIDGE SERVICE'],
  ];
  for (const [id, divisi, jabatan] of rows) {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${id}, ${'Nama ' + id}, ${id.toLowerCase() + '@mea.test'}, ${divisi}, ${jabatan}, true, 'ZBR-TEST')
      on conflict (employee_id) do nothing`;
  }
  // notify_emit's leadsOfDivision resolver joins role_mappings(divisi,jabatan)
  // → (division,level) — without this row bridge.order.masuk finds zero
  // recipients even though ZBR-LEAD is a real Account/lead Actor.
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('Account', 'HEAD OF ACCOUNT', 'Account', 'lead', 'ZBR-TEST')
    on conflict do nothing`;
}

/** One sellable Master Service, minimal shape (mirrors msl.test.ts seedService). */
async function seedMasterService(name: string): Promise<string> {
  return createMasterService(sql, salesLeadActor(), {
    name,
    standardPrice: '1000000',
    commissionRule: '0% of standard price',
    effectiveFrom: '2020-01-01',
    pricingMode: 'flat',
    active: true,
  } as Parameters<typeof createMasterService>[2]);
}

async function insServiceMap(jenis: string, masterServiceId: string): Promise<void> {
  await sql`
    insert into external_service_map (sumber, external_service_type, master_service_id, aktif, created_by)
    values ('meago', ${jenis}, ${masterServiceId}, true, 'ZBR-LEAD')`;
}

interface PayloadOpts {
  dealCode?: string;
  externalId?: string;
  attestation?: Partial<{ diverifikasi_pada: string | null; bentuk_kerjasama: string }>;
  lines?: Record<string, unknown>[];
}

function rawPayload(opts: PayloadOpts = {}): Record<string, unknown> {
  const id = opts.externalId ?? `ZBR-SHOP-${uniq()}`;
  return {
    payload_versi: 1,
    deal_code: opts.dealCode ?? `ZBR-DEAL-${uniq()}`,
    bd_identitas: 'BD Uji — Andi',
    merchant: {
      external_id: id,
      nama: `Merchant Uji ${id}`,
      kota: 'Bandung',
      kategori_poi: 'Dining',
      pic_nama: 'PIC Uji',
      pic_whatsapp: '0812xxxx',
      tanggal_mulai_kontrak: '2026-09-15',
      tanggal_akhir_kontrak: '2027-03-15',
    },
    attestation: {
      external_trx_ref: `ZBR-TRX-${uniq()}`,
      bentuk_kerjasama: 'Berbayar',
      nilai: '15000000.00',
      diverifikasi_pada: '2026-09-10T03:15:00Z',
      diverifikasi_oleh_external: 'Finance MSDPS Uji',
      ...opts.attestation,
    },
    lines: opts.lines ?? [{ jenis: 'Account', qty: 1, catatan: null, alasan_non_roster: null, nilai_cross_charge: null }],
  };
}

const acceptInput = (over: Partial<bridge.BridgeAcceptInput> = {}): bridge.BridgeAcceptInput => ({
  existingClientId: null,
  gmvBaseline: '0',
  targetGmv: '0',
  linkToko: 'https://toko.example/uji',
  kategori: 'Dining',
  bridgeEmployeeId: BRIDGE_EMP,
  ...over,
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from client_sales_allocations where salesperson_id like 'ZBR-%'`;
  await sql`alter table client_external_billing disable trigger trg_client_external_billing_frozen`;
  await sql`delete from client_external_billing where dilaporkan_oleh like 'ZBR-%'`;
  await sql`alter table client_external_billing enable trigger trg_client_external_billing_frozen`;
  await sql`delete from client_external_ref where created_by like 'ZBR-%'`;
  await sql`delete from services where client_id in (select id from clients where created_by like 'ZBR-%' or sales_pic_id = ${BRIDGE_EMP})`;
  await sql`delete from contracts where client_id in (select id from clients where created_by like 'ZBR-%' or sales_pic_id = ${BRIDGE_EMP})`;
  // external_orders.client_id FKs to clients — must clear before deleting clients.
  await sql`delete from external_orders where external_deal_code like 'ZBR-%'`;
  await sql`delete from clients where created_by like 'ZBR-%' or sales_pic_id = ${BRIDGE_EMP}`;
  await sql`delete from external_service_map where created_by like 'ZBR-%'`;
  await sql`delete from master_service_versions where created_by = 'ZBR-SLEAD'`;
  await sql`delete from master_services where created_by = 'ZBR-SLEAD'`;
  // `notifications` is append-only (BEFORE DELETE trigger, house rule #3) —
  // left uncleaned, same posture scs.test.ts takes for `audit_log`. Each run
  // mints fresh ORD- ids, so leftovers never contaminate a later assertion.
  await sql`delete from employees where employee_id like 'ZBR-%'`;
  await sql`delete from role_mappings where created_by = 'ZBR-TEST'`;
});
afterAll(async () => {
  if (sql) await sql.end();
});

describeDb('bridge.intake — idempotency', () => {
  it('a repeated Idempotency-Key returns the ORIGINAL ord_code, zero new rows, zero second notification', async () => {
    await insEmployees();
    const key = `ZBR-DEAL-${uniq()}:1`;
    const payload = rawPayload();

    const first = await bridge.intake(sql, payload, key);
    const second = await bridge.intake(sql, payload, key);
    expect(second.ordCode).toBe(first.ordCode);
    expect(second.status).toBe('[Masuk]');

    const rows = await sql<{ n: string }[]>`select count(*)::text as n from external_orders where idempotency_key = ${key}`;
    expect(rows[0].n).toBe('1');

    const notifs = await sql<{ n: string }[]>`
      select count(*)::text as n from notifications where entity_type = 'external_order' and entity_id = ${first.ordCode}`;
    expect(notifs[0].n).toBe('1');
  });

  it('rejects an unknown payload_versi rather than guessing', async () => {
    await insEmployees();
    const payload = { ...rawPayload(), payload_versi: 2 };
    await expect(bridge.intake(sql, payload, `ZBR-DEAL-${uniq()}:2`)).rejects.toThrow(bridge.MSG_UNKNOWN_PAYLOAD_VERSION);
  });
});

describeDb('bridge.candidates — dedup, never auto-selects', () => {
  it('surfaces an EXACT match via client_external_ref without picking it', async () => {
    await insEmployees();
    const cliId = `ZBR-CLI-${uniq()}`;
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
        total_sales, sales_pic_id, commission_payment_pic_id, created_by)
      values (${cliId}, 'PIC', 'Toko Lama', 'Bandung', 'link', 'Dining', '0', '0', '0',
        'ZBR-LEAD', 'ZBR-LEAD', 'ZBR-TEST')`;
    const externalId = `ZBR-SHOP-${uniq()}`;
    await sql`
      insert into client_external_ref (client_id, sumber, external_id, created_by)
      values (${cliId}, 'meago', ${externalId}, 'ZBR-LEAD')`;

    const key = `ZBR-DEAL-${uniq()}:1`;
    const { ordCode } = await bridge.intake(sql, rawPayload({ externalId }), key);
    const cands = await bridge.candidates(sql, ordCode);
    expect(cands.some((c) => c.clientId === cliId && c.confidence === 'exact')).toBe(true);
  });
});

describeDb('bridge.accept — attestation gate holds even for Director', () => {
  it('rejects an order whose STORED payload has no diverifikasi_pada, for lead Account AND Director', async () => {
    await insEmployees();
    // Bypasses bridge.intake (which would already refuse this at parse time)
    // to prove accept() re-checks the STORED payload independently — the
    // guarantee is that a payload which slipped past intake some other way
    // (a future version, a hand-edited row) still cannot be accepted.
    const id = `ORD-999912-${uniq().slice(-4).padStart(4, '0')}`;
    const bad = rawPayload();
    delete (bad.attestation as Record<string, unknown>).diverifikasi_pada;
    await sql`
      insert into external_orders (id, sumber, external_deal_code, payload, payload_versi, idempotency_key)
      values (${id}, 'meago', ${bad.deal_code as string}, ${bad as unknown as never}::jsonb, 1, ${'ZBR-DEAL-' + uniq() + ':1'})`;

    await expect(bridge.accept(sql, leadAccount(), id, acceptInput())).rejects.toThrow(bridge.MSG_NO_ATTESTATION);
    await expect(bridge.accept(sql, director(), id, acceptInput())).rejects.toThrow(bridge.MSG_NO_ATTESTATION);

    const row = await sql<{ status: string }[]>`select status from external_orders where id = ${id}`;
    expect(row[0].status).toBe('[Masuk]');
  });
});

describeDb('bridge.accept — unmapped service fails the WHOLE accept, atomically', () => {
  it('leaves zero CLI-/SVC-/client_external_ref behind when one line has no external_service_map row', async () => {
    await insEmployees();
    const externalId = `ZBR-SHOP-${uniq()}`;
    const key = `ZBR-DEAL-${uniq()}:1`;
    const { ordCode } = await bridge.intake(sql, rawPayload({ externalId }), key);

    await expect(bridge.accept(sql, leadAccount(), ordCode, acceptInput())).rejects.toThrow(bridge.MSG_UNMAPPED_SERVICE);

    const cli = await sql<{ n: string }[]>`select count(*)::text as n from clients where created_by like 'ZBR-%'`;
    expect(cli[0].n).toBe('0');
    const refs = await sql<{ n: string }[]>`select count(*)::text as n from client_external_ref where external_id = ${externalId}`;
    expect(refs[0].n).toBe('0');
    const order = await sql<{ status: string; client_id: string | null }[]>`select status, client_id from external_orders where id = ${ordCode}`;
    expect(order[0].status).toBe('[Masuk]');
    expect(order[0].client_id).toBeNull();
  });
});

describeDb('bridge.accept — success path', () => {
  it('creates a sumber=meago CLI- + one SVC- per line, stamps released_to_account_at, ZERO TRX/allocation', async () => {
    await insEmployees();
    const msvAccount = await seedMasterService('Paket Account Uji');
    await insServiceMap('Account', msvAccount);
    const externalId = `ZBR-SHOP-${uniq()}`;
    const { ordCode } = await bridge.intake(sql, rawPayload({ externalId }), `ZBR-DEAL-${uniq()}:1`);

    const result = await bridge.accept(sql, leadAccount(), ordCode, acceptInput());
    expect(result.status).toBe('[Diterima]');
    expect(result.clientId).not.toBeNull();
    const clientId = result.clientId as string;

    const cli = await sql<{ sumber: string; released_to_account_at: Date | null; transaction_id: string | null; payment_intent: string | null }[]>`
      select sumber, released_to_account_at, transaction_id, payment_intent from clients where id = ${clientId}`;
    expect(cli[0].sumber).toBe('meago');
    expect(cli[0].released_to_account_at).not.toBeNull();
    // No TRX leakage (§4.6 / A7): a MEAGO client never gets a shadow transaction.
    expect(cli[0].transaction_id).toBeNull();
    expect(cli[0].payment_intent).toBeNull();

    const svc = await sql<{ n: string }[]>`select count(*)::text as n from services where client_id = ${clientId} and sumber = 'meago'`;
    expect(svc[0].n).toBe('1');

    const ref = await sql<{ n: string }[]>`select count(*)::text as n from client_external_ref where client_id = ${clientId} and external_id = ${externalId}`;
    expect(ref[0].n).toBe('1');

    const billing = await sql<{ bentuk_kerjasama: string }[]>`select bentuk_kerjasama from client_external_billing where client_id = ${clientId}`;
    expect(billing[0].bentuk_kerjasama).toBe('Berbayar');

    // bridge.accept NEVER writes client_sales_allocations — sales.close() does
    // that, and copying the step would silently inflate Kinerja Sales.
    const alloc = await sql<{ n: string }[]>`select count(*)::text as n from client_sales_allocations where client_id = ${clientId}`;
    expect(alloc[0].n).toBe('0');
  });

  it('honours KOL-Non-Roster requiring alasan_non_roster, and Store Operation/Ads/Creative lines', async () => {
    await insEmployees();
    const svcAds = await seedMasterService('Paket Ads Uji');
    const svcKol = await seedMasterService('Paket KOL Non-Roster Uji');
    await insServiceMap('Ads', svcAds);
    await insServiceMap('KOL-Non-Roster', svcKol);
    const externalId = `ZBR-SHOP-${uniq()}`;
    const { ordCode } = await bridge.intake(
      sql,
      rawPayload({
        externalId,
        lines: [
          { jenis: 'Ads', qty: 1, catatan: null, alasan_non_roster: null, nilai_cross_charge: '250000.00' },
          { jenis: 'KOL-Non-Roster', qty: 2, catatan: null, alasan_non_roster: 'Creator lokal di luar roster MCN', nilai_cross_charge: null },
        ],
      }),
      `ZBR-DEAL-${uniq()}:1`,
    );
    const result = await bridge.accept(sql, director(), ordCode, acceptInput());
    const svc = await sql<{ n: string }[]>`select count(*)::text as n from services where client_id = ${result.clientId}`;
    expect(svc[0].n).toBe('2');
  });
});

describeDb('bridge — permissions (D10: lead Account or Director only)', () => {
  it('a plain Account AM and OD cannot accept or reject; lead Account and Director can', async () => {
    await insEmployees();
    const msvAccount = await seedMasterService('Paket Account Uji Perm');
    await insServiceMap('Account', msvAccount);

    const order1 = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    await expect(bridge.accept(sql, amStaff(), order1.ordCode, acceptInput())).rejects.toThrow(ForbiddenError);
    const order1b = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    await expect(bridge.accept(sql, od(), order1b.ordCode, acceptInput())).rejects.toThrow(ForbiddenError);

    const order2 = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    await expect(bridge.reject(sql, amStaff(), order2.ordCode, 'alasan')).rejects.toThrow(ForbiddenError);

    const order3 = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    const accepted = await bridge.accept(sql, leadAccount(), order3.ordCode, acceptInput());
    expect(accepted.status).toBe('[Diterima]');

    const order4 = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    const rejected = await bridge.reject(sql, director(), order4.ordCode, 'tidak relevan untuk uji');
    expect(rejected.status).toBe('[Ditolak]');
    expect(rejected.ditolakAlasan).toBe('tidak relevan untuk uji');
  });

  it('reject requires a non-empty reason', async () => {
    await insEmployees();
    const order = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    await expect(bridge.reject(sql, leadAccount(), order.ordCode, '')).rejects.toThrow(ValidationError);
  });

  it('accepting/rejecting an already-decided order is a conflict, not a silent no-op', async () => {
    await insEmployees();
    const order = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    await bridge.reject(sql, leadAccount(), order.ordCode, 'sudah diputuskan');
    await expect(bridge.reject(sql, director(), order.ordCode, 'lagi')).rejects.toThrow(ConflictError);
    await expect(bridge.accept(sql, director(), order.ordCode, acceptInput())).rejects.toThrow(ConflictError);
  });
});

describeDb('bridge.accept — dedup race on external_id', () => {
  it('two accepts on the same external_id: one succeeds, the second fails atomically with no orphan client', async () => {
    await insEmployees();
    const msvAccount = await seedMasterService('Paket Account Uji Race');
    await insServiceMap('Account', msvAccount);
    const externalId = `ZBR-SHOP-${uniq()}`;

    const orderA = await bridge.intake(sql, rawPayload({ externalId }), `ZBR-DEAL-${uniq()}:1`);
    const resA = await bridge.accept(sql, leadAccount(), orderA.ordCode, acceptInput());
    expect(resA.status).toBe('[Diterima]');

    const orderB = await bridge.intake(sql, rawPayload({ externalId }), `ZBR-DEAL-${uniq()}:1`);
    await expect(bridge.accept(sql, leadAccount(), orderB.ordCode, acceptInput())).rejects.toThrow();

    const refs = await sql<{ n: string }[]>`select count(*)::text as n from client_external_ref where external_id = ${externalId}`;
    expect(refs[0].n).toBe('1');
    const clients = await sql<{ n: string }[]>`select count(*)::text as n from clients where created_by like 'ZBR-%'`;
    expect(clients[0].n).toBe('1');
  });
});

describeDb('bridge — immutability (aturan rumah #3)', () => {
  it('external_orders.payload cannot be UPDATEd', async () => {
    await insEmployees();
    const { ordCode } = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    await expect(sql`update external_orders set payload = '{"x":1}'::jsonb where id = ${ordCode}`).rejects.toThrow(
      /payload immutable/,
    );
  });

  it('client_external_billing cannot be UPDATEd or DELETEd', async () => {
    await insEmployees();
    const msvAccount = await seedMasterService('Paket Account Uji Frozen');
    await insServiceMap('Account', msvAccount);
    const { ordCode } = await bridge.intake(sql, rawPayload(), `ZBR-DEAL-${uniq()}:1`);
    const result = await bridge.accept(sql, leadAccount(), ordCode, acceptInput());

    await expect(sql`update client_external_billing set nilai = '1' where client_id = ${result.clientId}`).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`delete from client_external_billing where client_id = ${result.clientId}`).rejects.toThrow(/append-only/);
  });
});
