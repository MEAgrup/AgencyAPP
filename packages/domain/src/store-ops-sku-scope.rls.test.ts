/**
 * M18 Store Operation — lingkup baca baris SKU di bawah RLS.
 * Policy `sku_optimizations_select`, migrasi `20260924010000_w3_store_ops_sku.sql`.
 *
 * ## Kenapa tes ini ada, dan kenapa ia bukan tes predikat TS
 *
 * Kelas cacat yang paling mahal di dua sesi terakhir: predikat TS meloloskan,
 * RLS mengosongkan barisnya, halaman menjawab **404 — bukan 403**, dan seluruh
 * suite tetap hijau karena koneksi tes domain BYPASSRLS. Tiga kali dalam satu
 * sesi. Jadi jalur baca lintas-tabel yang baru ditulis dengan `withClaims` +
 * `SET LOCAL ROLE authenticated`, bukan dengan tes domain biasa.
 *
 * Yang di-assert: **himpunan baris yang benar-benar dikembalikan** per peran.
 * Batas ATAS sama pentingnya dengan batas bawah — arm divisi yang ditulis
 * longgar membuka pekerjaan Store Ops ke seluruh agensi tanpa satu pun galat.
 *
 * Satu jebakan yang tes ini juga jaga: arm AM memakai pintu
 * `private.brief_owner_am` SECURITY DEFINER, **bukan** join `briefs`/`services`/
 * `clients` di dalam predikat. Join itu perangkap O52 — ia dievaluasi di bawah
 * policy PEMBACANYA, jadi AM yang tidak boleh membaca `services` akan kehilangan
 * baris SKU-nya sendiri.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZSR-`.
 */
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

/** AM pemilik klien — yang menetapkan cakupan + target (ketokan 2026-09-08). */
const AM_PEMILIK = 'EMP-ZSR-AM';
/** AM lain, klien lain: pembeda bahwa arm-nya KEPEMILIKAN, bukan "divisi Account". */
const AM_LAIN = 'EMP-ZSR-AM2';
const PIC = 'EMP-ZSR-PIC';
/** Staff Store Ops kedua, tanpa baris apa pun — batas arm PIC. */
const PIC_LAIN = 'EMP-ZSR-PIC2';
const LEAD = 'EMP-ZSR-LEAD';

const CLI = 'CLI-ZSR-0001';
const SVC = 'SVC-ZSR-0001';
const BRF = 'BRF-ZSR-0001';
/** Dua baris: satu ber-PIC, satu belum ditugaskan — arm PIC tidak boleh jadi
 *  satu-satunya alasan sebuah baris terlihat oleh AM/lead. */
const SKU_PIC = 'SKU-ZSR-0001';
const SKU_TANPA_PIC = 'SKU-ZSR-0002';
const SEMUA = [SKU_PIC, SKU_TANPA_PIC];

/** Baris milik klien AM_LAIN — batas atasnya. */
const CLI_LAIN = 'CLI-ZSR-0009';
const SKU_LAIN = 'SKU-ZSR-0009';

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

/** Baris `ZSR-` yang terlihat oleh sebuah claim set, terurut — kontraknya. */
async function terlihat(claim: Claim): Promise<string[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tx<{ id: string }[]>`
      select id from sku_optimizations where id like 'SKU-ZSR-%' order by id`,
  );
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  if (!sql) return;
  const karyawan = async (id: string, divisi: string): Promise<void> => {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${id}, ${id}, ${id + '@zsr.example'}, ${divisi}, 'Staff', true, ${id})
      on conflict (employee_id) do nothing`;
  };
  for (const [id, div] of [
    [AM_PEMILIK, 'Account'], [AM_LAIN, 'Account'],
    [PIC, 'Store Operation'], [PIC_LAIN, 'Store Operation'], [LEAD, 'Store Operation'],
  ] as const) {
    await karyawan(id, div);
  }

  const klien = async (id: string, amId: string): Promise<void> => {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline,
                           target_gmv, sales_pic_id, commission_payment_pic_id,
                           released_to_account_at, assigned_am_id, created_by)
      values (${id}, 'PIC', ${'Toko ' + id}, 'Bandung', 'https://t.example', 'Fashion', 0, 0,
              ${amId}, ${amId}, now(), ${amId}, ${amId})
      on conflict (id) do nothing`;
  };
  const layanan = async (id: string, clientId: string, amId: string): Promise<void> => {
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
                            standard_price, commission_rule, status, created_by)
      values (${id}, ${clientId}, 'MS-ZSR', 1, 'Jasa', 0, 'none', '[Briefed]', ${amId})
      on conflict (id) do nothing`;
  };
  const brief = async (id: string, serviceId: string, amId: string): Promise<void> => {
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
                          quantity_target, priority, recurring, created_by)
      values (${id}, ${serviceId}, 'brief', '[To Do]', 'Store Operation', 'Optimasi SKU',
              3, 'High', false, ${amId})
      on conflict (id) do nothing`;
  };
  const baris = async (
    id: string, briefId: string, seq: number, pic: string | null, amId: string,
  ): Promise<void> => {
    await sql`
      insert into sku_optimizations
        (id, brief_id, sequence_no, request_type, jenis_gambar, nama_produk, link_sku,
         total_req_picture, expected_done, target_ctr, target_cvr, assigned_pic, created_by)
      values (${id}, ${briefId}, ${seq}, 'Shopee New', 'Cover Only', 'Produk',
              'https://shopee.example/p', 2, current_date + 7, 2.5, 1.2, ${pic}, ${amId})
      on conflict (id) do nothing`;
  };

  await klien(CLI, AM_PEMILIK);
  await layanan(SVC, CLI, AM_PEMILIK);
  await brief(BRF, SVC, AM_PEMILIK);
  await baris(SKU_PIC, BRF, 1, PIC, AM_PEMILIK);
  await baris(SKU_TANPA_PIC, BRF, 2, null, AM_PEMILIK);

  await klien(CLI_LAIN, AM_LAIN);
  await layanan('SVC-ZSR-0009', CLI_LAIN, AM_LAIN);
  await brief('BRF-ZSR-0009', 'SVC-ZSR-0009', AM_LAIN);
  await baris(SKU_LAIN, 'BRF-ZSR-0009', 1, null, AM_LAIN);
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from sku_optimizations where id like 'SKU-ZSR-%'`;
  await sql`delete from briefs where id like 'BRF-ZSR-%'`;
  await sql`delete from services where id like 'SVC-ZSR-%'`;
  await sql`delete from clients where id like 'CLI-ZSR-%'`;
  await sql`delete from employees where employee_id like 'EMP-ZSR-%'`;
  await sql.end();
});

dDb('M18 — arm AM pemilik klien', () => {
  it('AM pemilik melihat SEMUA baris SKU Brief-nya, termasuk yang belum ber-PIC', async () => {
    // AM adalah yang menetapkan cakupan + target (ketokan 2026-09-08). Kalau
    // arm ini hilang, halaman AM menjawab 404 dan ia tidak bisa melihat daftar
    // yang ia sendiri tulis.
    expect(await terlihat({ employeeId: AM_PEMILIK, division: 'Account', level: 'staff' }))
      .toEqual(SEMUA);
  });

  it('arm-nya KEPEMILIKAN, bukan "divisi Account": AM klien lain tidak ikut', async () => {
    // Kalau arm-nya ditulis `jwt_division() = 'Account'`, tes ini merah — dan
    // setiap AM membaca pekerjaan Store Ops seluruh klien agensi.
    const v = await terlihat({ employeeId: AM_LAIN, division: 'Account', level: 'staff' });
    expect(v).toEqual([SKU_LAIN]);
    expect(v).not.toContain(SKU_PIC);
  });

  it('arm AM lewat pintu SECURITY DEFINER, bukan join — pembuktian O52', async () => {
    // AM staf TIDAK punya arm baca di `services` untuk klien yang bukan miliknya,
    // dan bahkan untuk miliknya jalur itu lewat helper. Kalau predikat policy
    // men-join `briefs`→`services`→`clients`, join itu dievaluasi di bawah
    // policy PEMBACANYA dan barisnya DIBUANG — 404, bukan 403, tanpa galat.
    // Tes ini membuktikan barisnya tetap kembali walau AM membacanya sebagai
    // `authenticated` biasa.
    const v = await withClaims(sql, claims({ employeeId: AM_PEMILIK, division: 'Account', level: 'staff' }),
      (tx) => tx<{ id: string }[]>`
        select id from sku_optimizations where brief_id = ${BRF} order by id`);
    expect(v.map((r) => r.id)).toEqual(SEMUA);
  });
});

dDb('M18 — arm divisi Store Operation', () => {
  it('lead Store Ops melihat SELURUH divisinya, lintas klien', async () => {
    // Division-wide, Phase 0 §4 Role Matrix. Lead-lah yang menugaskan PIC
    // (K-1/A-5), jadi ia harus melihat baris yang belum ditugaskan.
    expect(await terlihat({ employeeId: LEAD, division: 'Store Operation', level: 'lead' }))
      .toEqual([...SEMUA, SKU_LAIN]);
  });

  it('staff Store Ops hanya melihat baris yang DITUGASKAN padanya', async () => {
    expect(await terlihat({ employeeId: PIC, division: 'Store Operation', level: 'staff' }))
      .toEqual([SKU_PIC]);
  });

  it('staff Store Ops lain: NOL — arm-nya PIC, bukan divisi', async () => {
    // Batas yang paling mudah salah: menulis arm staff sebagai `jwt_division()
    // = 'Store Operation'` membuat setiap staff membaca pekerjaan semua rekannya.
    expect(await terlihat({ employeeId: PIC_LAIN, division: 'Store Operation', level: 'staff' }))
      .toEqual([]);
  });
});

dDb('M18 — batas atas', () => {
  it('divisi lain NOL baris — Creative, Ads, KOL', async () => {
    for (const divisi of ['Creative', 'Ads', 'KOL']) {
      expect(await terlihat({ employeeId: 'EMP-ZSR-X', division: divisi, level: 'staff' }))
        .toEqual([]);
      expect(await terlihat({ employeeId: 'EMP-ZSR-XL', division: divisi, level: 'lead' }))
        .toEqual([]);
    }
  });

  it('lead divisi lain tidak menembus lewat arm lead', async () => {
    // `jwt_is_lead()` sendirian tidak cukup — arm-nya dipasangkan dengan
    // `jwt_division() = 'Store Operation'`. Kalau pasangannya lepas, setiap lead
    // divisi mana pun membaca seluruh pekerjaan Store Ops.
    expect(await terlihat({ employeeId: 'EMP-ZSR-CLEAD', division: 'Creative', level: 'lead' }))
      .toEqual([]);
  });

  it('klaim tanpa employee_id tidak dibukakan apa pun', async () => {
    expect(await terlihat({ employeeId: '', division: 'Store Operation', level: 'staff' }))
      .toEqual([]);
  });

  it('anon ditolak di level tabel, bukan di level baris', async () => {
    // `REVOKE ALL ... FROM anon` — kunci sebelum policy. Baris SKU membawa link
    // toko klien dan angka performanya; tidak ada realm luar yang berkepentingan.
    await expect(
      withClaims(sql, claims({ employeeId: AM_PEMILIK }), async (tx) => {
        await tx`set local role anon`;
        return tx`select id from sku_optimizations where id like 'SKU-ZSR-%'`;
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

dDb('M18 — OD & Director', () => {
  it('OD membaca semua (read-only everywhere, Phase 0 §4)', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZSR-OD', division: 'Account', level: 'staff', od: true }))
      .toEqual([...SEMUA, SKU_LAIN]);
  });

  it('Director membaca semua', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZSR-DIR', division: '', level: '', director: true }))
      .toEqual([...SEMUA, SKU_LAIN]);
  });
});

dDb('M18 — nol arm TULIS ditambahkan', () => {
  it('policy ini `FOR SELECT` saja: `authenticated` tidak bisa menyisipkan baris', async () => {
    // Tulis tetap lewat service-role + gerbang domain. Kalau suatu saat
    // seseorang menambahkan policy INSERT/UPDATE ke tabel ini, tes ini merah
    // dan keputusannya dipaksa eksplisit — bukan mendarat sebagai efek samping.
    await expect(
      withClaims(sql, claims({ employeeId: LEAD, division: 'Store Operation', level: 'lead' }), (tx) =>
        tx`insert into sku_optimizations
             (id, brief_id, sequence_no, request_type, jenis_gambar, nama_produk, link_sku,
              total_req_picture, expected_done, target_ctr, target_cvr, created_by)
           values ('SKU-ZSR-0099', ${BRF}, 99, 'Shopee New', 'Cover Only', 'X',
                   'https://x.example', 1, current_date, 1.0, 1.0, ${AM_PEMILIK})`),
    ).rejects.toThrow(/permission denied|violates row-level security/);
  });
});
