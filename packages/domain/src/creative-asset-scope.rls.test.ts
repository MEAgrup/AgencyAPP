/**
 * B-4/B-5 — arm baru `assets_select`: AM pemilik klien, Account lead, divisi Ads.
 * Migrasi `20260922200100_b45_assets_select_am_ads.sql`.
 *
 * KENAPA TES INI ADA, dan kenapa ia bukan tes predikat TS.
 *
 * Seluruh suite `creative.test.ts` hijau — 47 tes — sementara halaman AM 404.
 * Sebabnya: tes domain memakai `createClient(DATABASE_URL)` yang BYPASSRLS,
 * jadi ia membuktikan `creative.canSeeAsset` benar dan tidak pernah menanyakan
 * apakah barisnya terlihat. Kombinasi "predikat TS meloloskan, RLS
 * mengosongkan" tidak menghasilkan 403 yang bisa dibaca — ia menghasilkan
 * **404 / daftar kosong**, yang di UI terbaca sebagai "belum ada datanya".
 *
 * Jadi yang di-assert di sini adalah **himpunan baris yang benar-benar
 * dikembalikan RLS** per peran, lewat `withClaims` (`SET LOCAL ROLE
 * authenticated` + klaim JWT sungguhan) — pola sama `ads-client-scope.rls.test.ts`
 * dan `interview.rls.test.ts`.
 *
 * Batas atas yang dijaga sama pentingnya dengan batas bawah: divisi Ads mendapat
 * arm BACA, dan tes terakhir memastikan itu tidak ikut membuka aset ke divisi
 * lain (KOL) maupun ke AM yang bukan pemilik kliennya.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZAS-` dan
 * di-COMMIT (RLS berjalan di transaksinya sendiri), dibersihkan di afterAll.
 */
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

/** AM pemilik klien — satu-satunya peran yang boleh approve aset (K-1). */
const AM_PEMILIK = 'EMP-ZAS-AM';
/** AM lain, klien lain: pembeda bahwa arm-nya kepemilikan, bukan "divisi Account". */
const AM_LAIN = 'EMP-ZAS-AM2';
const PIC = 'EMP-ZAS-PIC';

const CLI = 'CLI-ZAS-0001';
const SVC = 'SVC-ZAS-0001';
const BRF = 'BRF-ZAS-0001';
/** Dua aset: satu ber-PIC, satu tanpa PIC (queue umum) — arm PIC tidak boleh
 *  jadi satu-satunya alasan sebuah baris terlihat. */
const AST_PIC = 'AST-ZAS-0001';
const AST_TANPA_PIC = 'AST-ZAS-0002';
const SEMUA = [AST_PIC, AST_TANPA_PIC];

/** Aset milik klien AM_LAIN — batas atasnya. */
const CLI_LAIN = 'CLI-ZAS-0009';
const AST_LAIN = 'AST-ZAS-0009';

const claims = (o: {
  employeeId: string; division?: string; level?: string; od?: boolean; director?: boolean;
}): string =>
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

/** Aset `ZAS-` yang terlihat oleh sebuah claim set, terurut — kontraknya. */
async function terlihat(claim: Claim): Promise<string[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tx<{ id: string }[]>`select id from assets where id like 'AST-ZAS-%' order by id`,
  );
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  if (!sql) return;
  const klien = async (id: string, amId: string): Promise<void> => {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline,
                           target_gmv, sales_pic_id, commission_payment_pic_id,
                           released_to_account_at, assigned_am_id, created_by)
      values (${id}, 'PIC', ${'Toko ' + id}, 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
              'EMP-ZAS-SALES', 'EMP-ZAS-SALES', now(), ${amId}, 'EMP-ZAS-SEED')
      on conflict (id) do nothing`;
  };
  const layanan = async (id: string, clientId: string): Promise<void> => {
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
                            standard_price, commission_rule, status, created_by)
      values (${id}, ${clientId}, 'MS-ZAS', 1, 'Jasa', 0, 'none', '[Briefed]', 'EMP-ZAS-SEED')
      on conflict (id) do nothing`;
  };
  const brief = async (id: string, serviceId: string): Promise<void> => {
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
                          quantity_target, priority, recurring, created_by)
      values (${id}, ${serviceId}, 'brief', '[To Do]', 'Creative', 'Product Video', 2, 'High',
              false, 'EMP-ZAS-SEED')
      on conflict (id) do nothing`;
  };
  const aset = async (id: string, briefId: string, seq: number, pic: string | null): Promise<void> => {
    await sql`
      insert into assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
      values (${id}, ${briefId}, 'Product Video', ${seq}, ${pic}, '[Submitted]', 'EMP-ZAS-SEED')
      on conflict (id) do nothing`;
  };

  await klien(CLI, AM_PEMILIK);
  await layanan(SVC, CLI);
  await brief(BRF, SVC);
  await aset(AST_PIC, BRF, 1, PIC);
  await aset(AST_TANPA_PIC, BRF, 2, null);

  await klien(CLI_LAIN, AM_LAIN);
  await layanan('SVC-ZAS-0009', CLI_LAIN);
  await brief('BRF-ZAS-0009', 'SVC-ZAS-0009');
  await aset(AST_LAIN, 'BRF-ZAS-0009', 1, null);
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from assets where id like 'AST-ZAS-%'`;
  await sql`delete from briefs where id like 'BRF-ZAS-%'`;
  await sql`delete from services where id like 'SVC-ZAS-%'`;
  await sql`delete from clients where id like 'CLI-ZAS-%'`;
  await sql.end();
});

dDb('B-4 — arm AM pemilik klien di assets_select', () => {
  it('AM pemilik melihat SEMUA aset kliennya, termasuk yang tanpa PIC', async () => {
    // Ini yang gagal sebelum migrasi: nol baris. `GET /assets/{id}` menjawab
    // 404 dan panel "Review & Approve Massal" AM kosong — padahal AM adalah
    // satu-satunya peran yang boleh menyetujui aset (K-1).
    expect(await terlihat({ employeeId: AM_PEMILIK, division: 'Account', level: 'staff' }))
      .toEqual(SEMUA);
  });

  it('arm-nya KEPEMILIKAN, bukan "divisi Account": AM klien lain tidak ikut', async () => {
    // Kalau arm-nya ditulis sebagai `jwt_division() = 'Account'`, tes ini merah —
    // dan setiap AM akan membaca aset seluruh klien agensi.
    const v = await terlihat({ employeeId: AM_LAIN, division: 'Account', level: 'staff' });
    expect(v).toEqual([AST_LAIN]);
    expect(v).not.toContain(AST_PIC);
  });

  it('Account lead melihat keduanya — division-wide (Phase 0 §4 Role Matrix)', async () => {
    const v = await terlihat({ employeeId: 'EMP-ZAS-ALEAD', division: 'Account', level: 'lead' });
    expect(v).toEqual([...SEMUA, AST_LAIN]);
  });

  it('arm lead divisi pelaksana (O48 Grup B) masih utuh', async () => {
    // Migrasi ini menulis ulang seluruh policy, jadi arm yang SUDAH ada harus
    // ikut di-assert — kalau tidak, kehilangannya senyap.
    expect(await terlihat({ employeeId: 'EMP-ZAS-CLEAD', division: 'Creative', level: 'lead' }))
      .toEqual([...SEMUA, AST_LAIN]);
  });

  it('PIC hanya melihat asetnya sendiri — arm lama tidak melebar', async () => {
    expect(await terlihat({ employeeId: PIC, division: 'Creative', level: 'staff' }))
      .toEqual([AST_PIC]);
  });
});

dDb('B-5/K-3 — arm baca divisi Ads di assets_select', () => {
  it('staff Ads melihat aset — tanpa ini picker menautkan ke halaman yang 404', async () => {
    // Daftar pickernya sendiri berjalan service-role, jadi ia sudah jalan tanpa
    // arm ini. Yang rusak adalah TAUTANNYA: `GET /assets/{id}` lewat
    // `readAsActor`, dan `canSeeAsset` yang meloloskan + RLS yang mengosongkan
    // barisnya menghasilkan 404, bukan 403.
    expect(await terlihat({ employeeId: 'EMP-ZAS-ADS', division: 'Ads', level: 'staff' }))
      .toEqual([...SEMUA, AST_LAIN]);
  });

  it('lead Ads sama — arm ini digerbang DIVISI, bukan level', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZAS-ADSLEAD', division: 'Ads', level: 'lead' }))
      .toEqual([...SEMUA, AST_LAIN]);
  });

  it('batas atasnya: divisi lain (KOL) tetap NOL aset', async () => {
    // Yang paling mudah salah saat menambah arm divisi adalah menuliskannya
    // longgar sehingga setiap divisi ikut terbuka. Cermin TS-nya
    // (`canSeeAsset`) juga menolak KOL, dan keduanya harus setuju.
    expect(await terlihat({ employeeId: 'EMP-ZAS-KOL', division: 'KOL', level: 'staff' }))
      .toEqual([]);
    expect(await terlihat({ employeeId: 'EMP-ZAS-KOLLEAD', division: 'KOL', level: 'lead' }))
      .toEqual([]);
  });

  it('klaim tanpa employee_id tidak dibukakan apa pun oleh arm Ads', async () => {
    // Arm-nya menyertakan `jwt_employee_id() <> ''` justru untuk ini: sebuah
    // token yang divisinya 'Ads' tapi tidak resolve ke karyawan mana pun bukan
    // aktor CDPS (lihat `permission.actorFromClaims`).
    expect(await terlihat({ employeeId: '', division: 'Ads', level: 'staff' })).toEqual([]);
  });
});

dDb('assets_select — nol arm TULIS ditambahkan', () => {
  it('policy tulis `assets` tidak ikut melebar: Ads tidak bisa menyisipkan aset', async () => {
    // Migrasi B-4/B-5 hanya menyentuh `FOR SELECT`. Kalau suatu saat seseorang
    // menyalin arm-nya ke policy insert/update, tes ini yang merah lebih dulu.
    await expect(
      withClaims(sql, claims({ employeeId: 'EMP-ZAS-ADS', division: 'Ads', level: 'staff' }), (tx) =>
        tx`insert into assets (id, brief_id, asset_type, sequence_no, status, created_by)
           values ('AST-ZAS-BOOM', ${BRF}, 'Product Video', 9, '[To Do]', 'EMP-ZAS-ADS')`,
      ),
    ).rejects.toThrow();
    const sisa = await sql<{ n: string }[]>`select count(*) as n from assets where id = 'AST-ZAS-BOOM'`;
    expect(sisa[0].n).toBe('0');
  });
});
