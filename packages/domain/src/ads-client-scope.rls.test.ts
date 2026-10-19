/**
 * Lingkup baca klien divisi Ads + cermin `client_platforms_select`.
 *
 * Riwayat: SCR-UI-1 (keputusan pemilik 2026-09-06) membatasi Ads ke klien yang
 * punya BRIEF ADS. PDT-ADS-SEMUA-KLIEN (keputusan pemilik 2026-10-19, migrasi
 * 20261218010000) MENCABUT batas itu: divisi Ads — staff maupun lead — melihat
 * SELURUH klien, sama dengan Lead Account. Pemicunya klien yang tercatat dua
 * kali (brief Ads di satu record, toko Shopee aktif di record lain), sehingga
 * tim Ads tidak bisa memilih toko yang benar di halaman PDT.
 *
 * Yang diuji di sini adalah **himpunan baris yang benar-benar dikembalikan
 * RLS** per peran, bukan sebuah predikat TS. Jalur bacanya `GET /api/v1/clients`
 * → `readAsActor` → `client.listClients`, yang scope-nya murni RLS.
 *
 * Plus satu invarian yang lahir dari butir 6 feedback yang sama: **toko sebuah
 * klien terlihat ⇔ kliennya terlihat**. Sebelum migrasi itu, Head Account
 * melihat klien (arm lead Account di `clients_select`) tetapi NOL toko (arm itu
 * hilang dari `client_platforms_select`), dan picker toko PDT terkunci.
 *
 * Berpasangan dengan `supabase/tests/rls_checks.sql` §45.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZAD-`/`CLI-ZAD-`
 * dan di-COMMIT (RLS berjalan di transaksinya sendiri), dibersihkan di afterAll.
 */
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER = 'EMP-0001';
/** Empat klien yang membedakan keempat kasus batas. */
const CLI_AKTIF = 'CLI-ZAD-AKTIF'; // brief Ads, layanan berjalan
const CLI_DONE = 'CLI-ZAD-DONE';   // brief Ads, layanan sudah Done — WAJIB tetap terbaca
const CLI_LAIN = 'CLI-ZAD-LAIN';   // brief-nya milik divisi lain
const CLI_NOL = 'CLI-ZAD-NOL';     // punya layanan, NOL brief sama sekali
const SEMUA = [CLI_AKTIF, CLI_DONE, CLI_LAIN, CLI_NOL];

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

type Claim = Parameters<typeof claims>[0];

/** Klien `ZAD-` yang terlihat oleh sebuah claim set, terurut — kontraknya. */
async function terlihat(claim: Claim): Promise<string[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tx<{ id: string }[]>`select id from clients where id like 'CLI-ZAD-%' order by id`,
  );
  return rows.map((r) => r.id);
}

/** Klien `ZAD-` yang TOKO-nya terlihat oleh sebuah claim set, terurut. */
async function tokoTerlihat(claim: Claim): Promise<string[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tx<{ client_id: string }[]>`
      select distinct client_id from client_platforms where client_id like 'CLI-ZAD-%' order by client_id`,
  );
  return rows.map((r) => r.client_id);
}

beforeAll(async () => {
  if (!sql) return;
  // Semua klien dimiliki OWNER, bukan aktor Ads — supaya satu-satunya jalan
  // aktor Ads melihatnya adalah arm baru, bukan arm kepemilikan yang lama.
  for (const id of SEMUA) {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline,
                           target_gmv, sales_pic_id, commission_payment_pic_id, created_by)
      values (${id}, 'PIC', ${'Toko ' + id}, 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
              ${OWNER}, ${OWNER}, ${OWNER})
      on conflict (id) do nothing`;
  }
  const svc = async (id: string, clientId: string, status: string): Promise<void> => {
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
                            standard_price, commission_rule, status, created_by)
      values (${id}, ${clientId}, 'MS-ZAD', 1, 'Jasa', 0, 'none', ${status}, ${OWNER})
      on conflict (id) do nothing`;
  };
  await svc('SVC-ZAD-AKTIF', CLI_AKTIF, '[In Execution]');
  await svc('SVC-ZAD-LAIN', CLI_LAIN, '[In Execution]');
  await svc('SVC-ZAD-NOL', CLI_NOL, '[In Execution]');
  // Status terminal — pembeda TUNGGAL terhadap SVC-ZAD-AKTIF; brief Ads-nya identik.
  await svc('SVC-ZAD-DONE', CLI_DONE, 'Done');

  const brief = async (id: string, serviceId: string, divisi: string): Promise<void> => {
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, created_by)
      values (${id}, ${serviceId}, 'brief', '[Draft]', ${divisi}, ${OWNER})
      on conflict (id) do nothing`;
  };
  await brief('BRF-ZAD-ADS1', 'SVC-ZAD-AKTIF', 'Ads');
  await brief('BRF-ZAD-ADS2', 'SVC-ZAD-DONE', 'Ads');
  // Brief milik divisi LAIN — klien ini tidak boleh ikut terbawa.
  await brief('BRF-ZAD-CRE', 'SVC-ZAD-LAIN', 'Creative');
  // CLI_NOL sengaja nol brief.

  // Satu toko per klien, dibuat OWNER — supaya arm `created_by` tidak pernah
  // menjadi jalan aktor uji melihatnya.
  for (const id of SEMUA) {
    await sql`
      insert into client_platforms (client_id, platform, active, created_by)
      select ${id}, 'Shopee', true, ${OWNER}
       where not exists (select 1 from client_platforms where client_id = ${id})`;
  }
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from client_platforms where client_id like 'CLI-ZAD-%'`;
  await sql`delete from briefs where id like 'BRF-ZAD-%'`;
  await sql`delete from services where id like 'SVC-ZAD-%'`;
  await sql`delete from clients where id like 'CLI-ZAD-%'`;
  await sql.end();
});

const ADS_STAFF: Claim = { employeeId: 'EMP-ZAD-ADS', division: 'Ads', level: 'staff' };
const ADS_LEAD: Claim = { employeeId: 'EMP-ZAD-ADSLEAD', division: 'Ads', level: 'lead' };

dDb('PDT-ADS-SEMUA-KLIEN — arm Ads di clients_select', () => {
  it('staff Ads melihat SELURUH klien — termasuk yang tanpa brief Ads atau brief-nya milik divisi lain', async () => {
    expect(await terlihat(ADS_STAFF)).toEqual(SEMUA);
  });

  it('lead Ads melihat himpunan yang SAMA — arm ini digerbang divisi, bukan level', async () => {
    expect(await terlihat(ADS_LEAD)).toEqual(SEMUA);
  });

  it('daftar klien Ads SAMA dengan daftar Head Account (butir 1 feedback 2026-10-19)', async () => {
    const headAccount = await terlihat({ employeeId: 'EMP-ZAD-ACCLEAD', division: 'Account', level: 'lead' });
    expect(await terlihat(ADS_STAFF)).toEqual(headAccount);
  });

  it.each([
    ['staff Creative', { employeeId: 'EMP-ZAD-CRE', division: 'Creative', level: 'staff' }],
    ['lead Creative', { employeeId: 'EMP-ZAD-CRE2', division: 'Creative', level: 'lead' }],
    ['staff KOL', { employeeId: 'EMP-ZAD-KOL', division: 'KOL', level: 'staff' }],
    ['staff Account bukan pemilik', { employeeId: 'EMP-ZAD-ACC', division: 'Account', level: 'staff' }],
  ] as [string, Claim][])('%s tidak ikut kebagian arm Ads', async (_n, claim) => {
    expect(await terlihat(claim)).toEqual([]);
  });

  it('OD dan Director tetap membaca keempatnya', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZAD-OD', od: true })).toEqual(SEMUA);
    expect(await terlihat({ employeeId: 'EMP-ZAD-DIR', director: true })).toEqual(SEMUA);
  });

  it('klaim kosong tetap default-deny', async () => {
    expect(await terlihat({ employeeId: '' })).toEqual([]);
  });

  it('arm lama tidak tergerus: AM pemilik tetap melihat kliennya sendiri', async () => {
    // Migrasi ini menyalin ulang seluruh policy, jadi arm lama yang hilang
    // adalah mode gagal yang nyata — dan senyap, karena tes Ads tetap hijau.
    const v = await terlihat({ employeeId: OWNER, division: 'Account', level: 'staff' });
    expect(v).toEqual(SEMUA);
  });
});

dDb('PDT-ADS-SEMUA-KLIEN — client_platforms_select cermin clients_select', () => {
  // Butir 6 feedback 2026-10-19: Head Account melihat klien tapi NOL toko, jadi
  // picker toko PDT terkunci. Invariannya diuji per peran, bukan per arm, supaya
  // arm yang kelak ditambah ke salah satu policy saja langsung tertangkap.
  it.each([
    ['Head Account', { employeeId: 'EMP-ZAD-ACCLEAD', division: 'Account', level: 'lead' }],
    ['Head Sales', { employeeId: 'EMP-ZAD-SLSLEAD', division: 'Sales', level: 'lead' }],
    ['staff Finance', { employeeId: 'EMP-ZAD-FIN', division: 'Finance', level: 'staff' }],
    ['staff Ads', ADS_STAFF],
    ['lead Ads', ADS_LEAD],
    ['AM pemilik', { employeeId: OWNER, division: 'Account', level: 'staff' }],
    ['OD', { employeeId: 'EMP-ZAD-OD', od: true }],
    ['staff Creative', { employeeId: 'EMP-ZAD-CRE', division: 'Creative', level: 'staff' }],
    ['staff Account bukan pemilik', { employeeId: 'EMP-ZAD-ACC', division: 'Account', level: 'staff' }],
    ['klaim kosong', { employeeId: '' }],
  ] as [string, Claim][])('%s: toko terlihat ⇔ kliennya terlihat', async (_n, claim) => {
    expect(await tokoTerlihat(claim)).toEqual(await terlihat(claim));
  });

  it('Head Account benar-benar melihat toko (bukan cuma setara-kosong)', async () => {
    expect(await tokoTerlihat({ employeeId: 'EMP-ZAD-ACCLEAD', division: 'Account', level: 'lead' })).toEqual(SEMUA);
  });
});
