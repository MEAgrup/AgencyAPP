/**
 * RAB-01 — Riset Awal Baseline schema: RLS read-scope + immutability + CHECK.
 *
 * Three DoD surfaces (docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md RAB-01):
 *
 *   1. RLS — the three riset-awal children (analisa / sumber_berkas / isian)
 *      carry the client's store baseline (hard-internal Account, class of Blok B),
 *      so their scope must track `canReadInterview` (Account only). In particular
 *      the closing salesperson sees the VERDICT but NOT the baseline — exactly the
 *      split `interview_riset_awal` already draws.
 *   2. Immutability — `payload` (analisa) and `nilai_usulan` (isian) have no
 *      UPDATE/DELETE path (house rule #3). A parser bug must not be able to shift
 *      a recorded proposal without a human confirming (keputusan 1).
 *   3. CHECK bites in the DB — `metode_baseline='manual'` forces
 *      `kondisi_toko='belum_dapat_diukur'` AND `skor IS NULL`, and a score is only
 *      valid from `analisa_penuh` carrying a benchmark+parser version (house rule #4).
 *
 * Skipped unless DATABASE_URL is set. Rows are namespaced `ZZR-`/`CLI-ZZR-` and
 * committed (RLS runs in its own transaction), then removed in afterAll.
 */
import { permission } from '@cdps/core';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as interview from './interview';
import type { Actor } from './account';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER_AM = 'EMP-0001';
const SALES_CLOSING = 'EMP-0006';
const CLI = 'CLI-ZZR-0001';
const ITV = 'ITV-ZZR-0001';
let platformId: number;
let probePlatformId: number;

const claims = (o: { employeeId: string; division?: string; level?: string; od?: boolean; director?: boolean }): string =>
  JSON.stringify({
    app_metadata: {
      employee_id: o.employeeId,
      division: o.division ?? '',
      level: o.level ?? '',
      od: o.od ?? false,
      director: o.director ?? false,
    },
  });

const actor = (o: { employeeId: string; division?: string; level?: string; od?: boolean; director?: boolean }): Actor => ({
  employeeId: o.employeeId,
  divisi: o.division ?? '',
  role: permission.makeRole({ division: o.division ?? '', level: o.level ?? '', od: o.od, director: o.director }),
});

/** The seven roles, each with the claim envelope RLS reads and the matching Actor. */
const ROLES: { name: string; claim: Parameters<typeof actor>[0] }[] = [
  { name: 'assigned AM (owner)', claim: { employeeId: OWNER_AM, division: 'Account', level: 'staff' } },
  { name: 'Account lead/SPV', claim: { employeeId: 'EMP-0003', division: 'Account', level: 'lead' } },
  { name: 'OD (read-all)', claim: { employeeId: 'EMP-0004', od: true } },
  { name: 'Director (read-all)', claim: { employeeId: 'EMP-0005', director: true } },
  { name: 'non-owner AM', claim: { employeeId: 'EMP-0002', division: 'Account', level: 'staff' } },
  { name: 'Sales closing', claim: { employeeId: SALES_CLOSING, division: 'Sales', level: 'staff' } },
  { name: 'other division (Creative)', claim: { employeeId: 'EMP-0008', division: 'Creative', level: 'staff' } },
];

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                         sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
    values (${CLI}, 'PIC', 'Toko', 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
            ${SALES_CLOSING}, ${SALES_CLOSING}, ${OWNER_AM}, ${OWNER_AM})
    on conflict (id) do nothing`;
  await sql`
    insert into interview (id, client_id, am_pengisi_id, sales_closing_id, status, created_by)
    values (${ITV}, ${CLI}, ${OWNER_AM}, ${SALES_CLOSING}, 'Selesai', ${OWNER_AM})
    on conflict (id) do nothing`;
  await sql`
    insert into interview_kualifikasi
      (interview_id, skor_kualifikasi, skor_per_blok, verdict_kualifikasi, hambatan_mendasar,
       margin_bersih_basis, kualitas_data, config_snapshot, dihitung_oleh)
    values (${ITV}, 60, '{"A":20,"B":15,"C":14,"D":6,"E":5}'::jsonb, 'bersyarat', '[]'::jsonb,
            'bersih_klien', 'terverifikasi', '{}'::jsonb, 'SYSTEM')
    on conflict (interview_id) do nothing`;
  await sql`
    insert into interview_riset_awal (interview_id, dimulai_oleh)
    values (${ITV}, ${OWNER_AM})
    on conflict (interview_id) do nothing`;

  const plat = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${CLI}, 'Shopee', 'https://shopee.example', true, ${OWNER_AM})
    returning id`;
  platformId = Number(plat[0].id);

  // An extra active platform with NO analisa row — used by the CHECK-rejection
  // tests so the constraint under test is the only reason an insert can fail
  // (the seeded platform above is already occupied, so its UNIQUE key would mask
  // the CHECK).
  const probe = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${CLI}, 'Lazada', 'https://lazada.example', true, ${OWNER_AM})
    returning id`;
  probePlatformId = Number(probe[0].id);

  // Manual baseline (Shopee — no analysis engine): belum_dapat_diukur, no score.
  // payload carries the minimal manual entry (keputusan 5), not an engine parse.
  await sql`
    insert into riset_awal_analisa
      (interview_id, client_platform_id, platform, metode_baseline, kondisi_toko, payload, created_by)
    values (${ITV}, ${platformId}, 'Shopee', 'manual', 'belum_dapat_diukur',
            '{"manual":{"gmv_bulan":5000000,"order":120,"aov":41666}}'::jsonb, ${OWNER_AM})
    on conflict (interview_id, client_platform_id) do nothing`;

  await sql`
    insert into riset_awal_sumber_berkas
      (interview_id, platform, nama_berkas, sha256, ukuran_bytes, tipe_terdeteksi, created_by)
    values (${ITV}, 'Shopee', 'export.xlsx', ${'a'.repeat(64)}, 1024, 'shop_tt', ${OWNER_AM})
    on conflict do nothing`;

  await sql`
    insert into interview_riset_awal_isian
      (interview_id, section, field_key, nilai_uang, sumber, nilai_usulan, dikonfirmasi, updated_by)
    values (${ITV}, 'B2', 'B2-9', 150000, 'analisa', '150000'::jsonb, false, ${OWNER_AM})
    on conflict (interview_id, section, field_key) do nothing`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from interview where id = ${ITV}`;
  await sql`delete from client_platforms where client_id = ${CLI}`;
  await sql`delete from clients where id = ${CLI}`;
  await sql.end();
});

// ---------------------------------------------------------------------------
// 1. RLS — Account scope, Sales default-deny (baseline is hard-internal).
// ---------------------------------------------------------------------------
dDb('riset awal children scope: TS predicate == RLS (Account-only, never Sales)', () => {
  const TABLES = ['riset_awal_analisa', 'riset_awal_sumber_berkas', 'interview_riset_awal_isian'] as const;

  for (const table of TABLES) {
    it.each(ROLES)(`${table} — $name`, async ({ claim }) => {
      const tsAllows = interview.canReadInterview(actor(claim), OWNER_AM);
      const rows = await withClaims(sql, claims(claim), (tx) =>
        tx<{ interview_id: string }[]>`select interview_id from ${tx(table)} where interview_id = ${ITV}`,
      );
      expect(rows.length > 0).toBe(tsAllows);
    });
  }

  it('closing salesperson sees the VERDICT but NOT the baseline (analisa/isian/sumber)', async () => {
    const salesClaim = { employeeId: SALES_CLOSING, division: 'Sales', level: 'staff' };
    const verdict = await withClaims(sql, claims(salesClaim), (tx) =>
      tx<{ interview_id: string }[]>`select interview_id from interview_verdict where interview_id = ${ITV}`,
    );
    const analisa = await withClaims(sql, claims(salesClaim), (tx) =>
      tx<{ interview_id: string }[]>`select interview_id from riset_awal_analisa where interview_id = ${ITV}`,
    );
    const isian = await withClaims(sql, claims(salesClaim), (tx) =>
      tx<{ interview_id: string }[]>`select interview_id from interview_riset_awal_isian where interview_id = ${ITV}`,
    );
    const berkas = await withClaims(sql, claims(salesClaim), (tx) =>
      tx<{ interview_id: string }[]>`select interview_id from riset_awal_sumber_berkas where interview_id = ${ITV}`,
    );
    expect(verdict.length).toBe(1);
    expect(analisa.length).toBe(0);
    expect(isian.length).toBe(0);
    expect(berkas.length).toBe(0);
  });

  it('riset_awal_benchmark is default-deny to authenticated (read via service-role only)', async () => {
    // No GRANT SELECT to authenticated (like kualifikasi_config / notif_events):
    // any authenticated read is denied outright, not merely filtered to 0 rows.
    const amClaim = { employeeId: OWNER_AM, division: 'Account', level: 'staff' };
    const dirClaim = { employeeId: 'EMP-0005', director: true };
    await expect(
      withClaims(sql, claims(amClaim), (tx) => tx`select versi from riset_awal_benchmark`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withClaims(sql, claims(dirClaim), (tx) => tx`select versi from riset_awal_benchmark`),
    ).rejects.toThrow(/permission denied/i);
    // The seed row exists — it is simply unreachable except via service-role.
    const priv = await sql<{ versi: number }[]>`select versi from riset_awal_benchmark where versi = 1`;
    expect(priv.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Immutability — payload (analisa) + nilai_usulan (isian) frozen.
// ---------------------------------------------------------------------------
dDb('immutability: payload + nilai_usulan have no UPDATE/DELETE path', () => {
  it('riset_awal_analisa rejects ANY update (append-only snapshot)', async () => {
    await expect(
      sql`update riset_awal_analisa set payload = '{"x":1}'::jsonb where interview_id = ${ITV}`,
    ).rejects.toThrow(/immutable|append-only/i);
  });

  it('interview_riset_awal_isian freezes nilai_usulan but allows confirming/correcting the value', async () => {
    // Freezing the original proposal is rejected...
    await expect(
      sql`update interview_riset_awal_isian set nilai_usulan = '999'::jsonb
          where interview_id = ${ITV} and section = 'B2' and field_key = 'B2-9'`,
    ).rejects.toThrow(/nilai_usulan beku/i);
    // ...but confirming + correcting the confirmed value succeeds.
    await sql`update interview_riset_awal_isian set dikonfirmasi = true, nilai_uang = 175000
              where interview_id = ${ITV} and section = 'B2' and field_key = 'B2-9'`;
    const row = await sql<{ dikonfirmasi: boolean; nilai_uang: string }[]>`
      select dikonfirmasi, nilai_uang from interview_riset_awal_isian
       where interview_id = ${ITV} and section = 'B2' and field_key = 'B2-9'`;
    expect(row[0].dikonfirmasi).toBe(true);
    expect(Number(row[0].nilai_uang)).toBe(175000);
  });

  it('sumber (origin of the number) is frozen too', async () => {
    await expect(
      sql`update interview_riset_awal_isian set sumber = 'manual'
          where interview_id = ${ITV} and section = 'B2' and field_key = 'B2-9'`,
    ).rejects.toThrow(/sumber beku/i);
  });

  it('a published benchmark version cannot be edited or deleted', async () => {
    await expect(
      sql`update riset_awal_benchmark set nilai = '{}'::jsonb where versi = 1`,
    ).rejects.toThrow(/append-only/i);
    await expect(sql`delete from riset_awal_benchmark where versi = 1`).rejects.toThrow(/append-only/i);
  });
});

// ---------------------------------------------------------------------------
// 3. CHECK constraints bite in the DB (not just in TS).
// ---------------------------------------------------------------------------
dDb('CHECK: manual ⇒ belum_dapat_diukur + null score; score only from analisa_penuh', () => {
  // A valid payload is always supplied so the CHECK under test is what bites,
  // not the NOT NULL on payload.
  const insertAnalisa = (metode: string, kondisi: string, extra: Record<string, unknown> = {}) =>
    sql`
      insert into riset_awal_analisa
        (interview_id, client_platform_id, platform, metode_baseline, kondisi_toko,
         skor, benchmark_versi, parser_versi, payload, created_by)
      values (${ITV}, ${probePlatformId}, 'Lazada', ${metode}, ${kondisi},
              ${(extra.skor as number) ?? null}, ${(extra.benchmark_versi as number) ?? null},
              ${(extra.parser_versi as string) ?? null}, '{"x":1}'::jsonb, ${OWNER_AM})`;

  it('manual with a non-null score is rejected', async () => {
    await expect(insertAnalisa('manual', 'belum_dapat_diukur', { skor: 50 })).rejects.toThrow();
  });

  it('manual with a computed kondisi_toko is rejected', async () => {
    await expect(insertAnalisa('manual', 'mesin_jalan')).rejects.toThrow();
  });

  it('a computed verdict from a non-analisa_penuh method is rejected', async () => {
    await expect(insertAnalisa('analisa_tipis', 'mesin_jalan')).rejects.toThrow();
  });

  it('a score without a benchmark+parser version is rejected (recompute provenance)', async () => {
    await expect(insertAnalisa('analisa_penuh', 'mesin_jalan', { skor: 70 })).rejects.toThrow();
  });

  it('a valid analisa_penuh row (score + versioned benchmark + parser) is accepted', async () => {
    // Uses a second platform so it does not collide with the manual seed row.
    const p = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, active, created_by)
      values (${CLI}, 'TikTok Shop', true, ${OWNER_AM}) returning id`;
    const pid = Number(p[0].id);
    await sql`
      insert into riset_awal_analisa
        (interview_id, client_platform_id, platform, metode_baseline, kondisi_toko,
         skor, benchmark_versi, parser_versi, payload, created_by)
      values (${ITV}, ${pid}, 'TikTok Shop', 'analisa_penuh', 'mesin_jalan',
              70, 1, 'tiktok.v1', '{"gmv":1}'::jsonb, ${OWNER_AM})`;
    const row = await sql<{ skor: number }[]>`
      select skor from riset_awal_analisa where client_platform_id = ${pid}`;
    expect(Number(row[0].skor)).toBe(70);
  });
});
