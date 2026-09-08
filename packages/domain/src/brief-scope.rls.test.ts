/**
 * B-1/B-4 — arm STAFF divisi pelaksana pada `briefs_select`.
 * Migrasi `20260922200400_b1_briefs_select_arm_staff_divisi.sql`.
 *
 * KENAPA TES INI ADA
 *
 * Ini menjaga perbaikan sebuah REGRESI yang sempat hidup di `main`. A-5 (K-1)
 * membuat AM berhenti mengisi `briefs.assigned_pic` — dan kolom itu adalah
 * satu-satunya jalan baca staff divisi di `briefs_select`. Akibatnya seorang PIC
 * Aset tidak bisa membuka Brief induk pekerjaannya sendiri, dan karena
 * `creative.assetSelect` masih `join briefs`, `GET /assets/{id}` menjawab
 * **404 kepada PIC-nya sendiri**.
 *
 * Suite domain tidak bisa menangkap kelas ini: koneksinya BYPASSRLS, jadi ia
 * membuktikan `account.canSeeBrief` benar dan tidak pernah menanyakan apakah
 * barisnya terlihat. Yang di-assert di sini adalah **himpunan baris yang
 * benar-benar dikembalikan RLS** per peran, lewat `withClaims` (`SET LOCAL ROLE
 * authenticated` + klaim JWT sungguhan) — pola sama `ads-client-scope.rls.test.ts`
 * dan `creative-asset-scope.rls.test.ts`.
 *
 * Batas ATAS dijaga sama ketatnya dengan batas bawah: arm-nya digerbang divisi,
 * jadi divisi LAIN tetap nol, dan klaim tanpa `employee_id` tetap nol.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZBS-` dan
 * di-COMMIT (RLS berjalan di transaksinya sendiri), dibersihkan di afterAll.
 */
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const AM = 'EMP-ZBS-AM';
const AM_LAIN = 'EMP-ZBS-AM2';

/** Brief Creative yang lahir TANPA PIC — keadaan normal sesudah A-5. */
const BRF_CREATIVE = 'BRF-ZBS-CRE';
/** Brief KOL milik klien yang sama, juga tanpa PIC. */
const BRF_KOL = 'BRF-ZBS-KOL';
/** Brief Creative milik klien AM LAIN — batas atas kepemilikan. */
const BRF_LAIN = 'BRF-ZBS-LAIN';

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

/** Brief `ZBS-` yang terlihat oleh sebuah claim set, terurut — kontraknya. */
async function terlihat(claim: Claim): Promise<string[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tx<{ id: string }[]>`select id from briefs where id like 'BRF-ZBS-%' order by id`,
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
              'EMP-ZBS-SALES', 'EMP-ZBS-SALES', now(), ${amId}, 'EMP-ZBS-SEED')
      on conflict (id) do nothing`;
  };
  const layanan = async (id: string, clientId: string): Promise<void> => {
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
                            standard_price, commission_rule, status, created_by)
      values (${id}, ${clientId}, 'MS-ZBS', 1, 'Jasa', 0, 'none', '[Briefed]', 'EMP-ZBS-SEED')
      on conflict (id) do nothing`;
  };
  /** `assigned_pic` DIBIARKAN NULL — itu inti kasusnya sesudah A-5. */
  const brief = async (id: string, serviceId: string, divisi: string): Promise<void> => {
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
                          quantity_target, priority, recurring, created_by)
      values (${id}, ${serviceId}, 'brief', '[To Do]', ${divisi}, 'Product Video', 2, 'High',
              false, 'EMP-ZBS-SEED')
      on conflict (id) do nothing`;
  };

  await klien('CLI-ZBS-1', AM);
  await layanan('SVC-ZBS-1', 'CLI-ZBS-1');
  await brief(BRF_CREATIVE, 'SVC-ZBS-1', 'Creative');
  await brief(BRF_KOL, 'SVC-ZBS-1', 'KOL');

  await klien('CLI-ZBS-9', AM_LAIN);
  await layanan('SVC-ZBS-9', 'CLI-ZBS-9');
  await brief(BRF_LAIN, 'SVC-ZBS-9', 'Creative');
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from briefs where id like 'BRF-ZBS-%'`;
  await sql`delete from services where id like 'SVC-ZBS-%'`;
  await sql`delete from clients where id like 'CLI-ZBS-%'`;
  await sql.end();
});

dDb('B-1/B-4 — arm staff divisi pada briefs_select', () => {
  it('premisnya dulu: Brief-nya memang lahir TANPA PIC (keadaan normal sesudah A-5)', async () => {
    // Kalau ini gagal, seluruh tes di bawah menguji hal yang salah: arm
    // `assigned_pic` yang lama akan menutupinya dan arm baru tidak terbukti.
    const rows = await sql<{ assigned_pic: string | null }[]>`
      select assigned_pic from briefs where id like 'BRF-ZBS-%'`;
    expect(rows.every((r) => r.assigned_pic === null)).toBe(true);
  });

  it('staff Creative melihat Brief Creative divisinya — INI yang putus sebelum migrasi', async () => {
    // Sebelum arm ini: 0 baris, dan karena `creative.assetSelect` join `briefs`,
    // `GET /assets/{id}` 404 kepada PIC Aset-nya sendiri.
    const v = await terlihat({ employeeId: 'EMP-ZBS-CRE', division: 'Creative', level: 'staff' });
    expect(v).toEqual([BRF_CREATIVE, BRF_LAIN]);
  });

  it('staff KOL melihat Brief KOL, dan TIDAK melihat Brief Creative', async () => {
    // Arm-nya digerbang DIVISI. Ini batas atasnya: membuka "semua staff" akan
    // membuat tes ini merah.
    const v = await terlihat({ employeeId: 'EMP-ZBS-KOL', division: 'KOL', level: 'staff' });
    expect(v).toEqual([BRF_KOL]);
  });

  it('divisi yang tidak punya Brief sama sekali tetap NOL', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZBS-FIN', division: 'Finance', level: 'staff' })).toEqual([]);
  });

  it('klaim tanpa employee_id tidak dibukakan apa pun oleh arm ini', async () => {
    // Syarat `jwt_employee_id() <> ''` ada justru untuk ini: token yang
    // divisinya terisi tapi tidak resolve ke karyawan bukan aktor CDPS.
    expect(await terlihat({ employeeId: '', division: 'Creative', level: 'staff' })).toEqual([]);
  });

  it('arm lead, AM pemilik, dan Account lead TIDAK hilang — policy ditulis ulang seluruhnya', async () => {
    // Migrasi ini me-DROP lalu CREATE policy-nya, jadi arm yang sudah ada wajib
    // ikut di-assert; arm yang lenyap tanpa jejak adalah cara paling rapi
    // menghidupkan lagi cacat yang ia jaga.
    expect(await terlihat({ employeeId: 'EMP-ZBS-CLEAD', division: 'Creative', level: 'lead' }))
      .toEqual([BRF_CREATIVE, BRF_LAIN]);
    // AM pemilik: hanya Brief kliennya sendiri, LEWAT jalur kepemilikan layanan.
    expect(await terlihat({ employeeId: AM, division: 'Account', level: 'staff' }))
      .toEqual([BRF_CREATIVE, BRF_KOL]);
    expect(await terlihat({ employeeId: AM_LAIN, division: 'Account', level: 'staff' }))
      .toEqual([BRF_LAIN]);
    // Account lead: division-wide (keputusan Nerissa 2026-07-12).
    expect(await terlihat({ employeeId: 'EMP-ZBS-ALEAD', division: 'Account', level: 'lead' }))
      .toEqual([BRF_CREATIVE, BRF_KOL, BRF_LAIN]);
    // OD & Director: baca semua.
    expect(await terlihat({ employeeId: 'EMP-ZBS-OD', od: true }))
      .toEqual([BRF_CREATIVE, BRF_KOL, BRF_LAIN]);
    expect(await terlihat({ employeeId: 'EMP-ZBS-DIR', director: true }))
      .toEqual([BRF_CREATIVE, BRF_KOL, BRF_LAIN]);
  });

  it('nol arm TULIS ditambahkan: staff divisi tidak bisa menyisipkan Brief', async () => {
    // Migrasi ini hanya menyentuh `FOR SELECT`. Kalau suatu saat arm-nya disalin
    // ke policy insert/update, tes ini yang merah lebih dulu.
    await expect(
      withClaims(sql, claims({ employeeId: 'EMP-ZBS-CRE', division: 'Creative', level: 'staff' }), (tx) =>
        tx`insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
                               quantity_target, priority, recurring, created_by)
           values ('BRF-ZBS-BOOM', 'SVC-ZBS-1', 'x', '[To Do]', 'Creative', 'Product Video', 1,
                   'Low', false, 'EMP-ZBS-CRE')`,
      ),
    ).rejects.toThrow();
    const sisa = await sql<{ n: string }[]>`select count(*) as n from briefs where id = 'BRF-ZBS-BOOM'`;
    expect(sisa[0].n).toBe('0');
  });
});
