/**
 * Lengan Sales-lead & Finance pada `client_sales_allocations_select`,
 * `contracts_select`, `services_select`.
 * Migrasi `20261001010000_rls_kinerja_sales_lead_finance.sql` dan
 * `20261002010000_rls_services_sales_lead.sql` (lengan Sales-lead pada
 * `services_select`, PR-3 — lihat tes "Head Sales melihat ketiganya").
 *
 * ## KENAPA TES INI ADA
 *
 * Ia menjaga perbaikan sebuah bug yang **hidup di produksi tanpa terlihat**.
 *
 * Kinerja Sales menghitung kolom klien & uang dari `client_sales_allocations`,
 * dibaca lewat `readAsActor` — jadi tunduk RLS. Ketiga lengan baseline policy
 * itu semuanya PER-ORANG (`created_by`, `jwt_owns_client`), nol lengan divisi.
 * Akibatnya seorang **Head Sales melihat kolom klien dan omzet SELURUH TIM-nya
 * berisi 0.00** — bukan galat, bukan halaman kosong, hanya angka nol yang
 * terlihat sah. Baris orangnya tetap muncul, karena roster datang dari
 * `private.employee_roster()` yang SECURITY DEFINER; jadi tabelnya tampak
 * normal DAN salah.
 *
 * Dua alasan ia bertahan, dan keduanya penting untuk tidak diulang:
 *
 *  1. **Director dan OD lolos lewat `jwt_can_read_all()`** dan selalu melihat
 *     angka yang benar. Satu-satunya peran yang melihat bug ini adalah peran
 *     yang tidak dipakai untuk memeriksa.
 *  2. **Suite domain tidak bisa menangkap kelasnya**: koneksinya BYPASSRLS,
 *     jadi ia membuktikan `salesperf.scopeFor` benar dan tidak pernah
 *     menanyakan apakah barisnya terlihat. `scopeFor` memang SUDAH benar sejak
 *     awal ("Sales lead/SPV = seluruh divisi") — policy-nya lah yang
 *     membantahnya.
 *
 * Karena itu yang di-assert di sini adalah **himpunan baris yang benar-benar
 * dikembalikan RLS** per peran, lewat `withClaims` (`SET LOCAL ROLE
 * authenticated` + klaim JWT sungguhan) — pola sama `brief-scope.rls.test.ts`.
 *
 * Batas ATAS dijaga sama ketatnya: Sales STAFF tetap tidak boleh melihat
 * alokasi orang lain (`scopeFor` mengunci mereka ke baris sendiri), divisi lain
 * tetap nol, dan Finance sengaja TIDAK diberi corong prospek.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZSP-`.
 */
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

/** Sales staff yang MEMILIKI klien-nya. */
const SALES_PEMILIK = 'EMP-ZSP-SALES';
/** Sales staff LAIN — batas atas: ia tidak boleh melihat deal orang pertama. */
const SALES_LAIN = 'EMP-ZSP-SALES2';

const CLI = 'CLI-ZSP-1';
const CTR = 'CTR-ZSP-1';
const SVC = 'SVC-ZSP-1';

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

/**
 * Berapa baris dari KETIGA tabel uang yang terlihat oleh satu claim set.
 *
 * Ketiganya dihitung bersama karena laporan penjualan men-join ketiganya: satu
 * saja yang mati membuat angkanya nol dengan cara yang sama diam-diamnya.
 */
async function terlihat(claim: Claim): Promise<{ alokasi: number; kontrak: number; layanan: number }> {
  return withClaims(sql, claims(claim), async (tx) => {
    const a = await tx<{ n: number }[]>`select count(*)::int as n from client_sales_allocations where client_id = ${CLI}`;
    const k = await tx<{ n: number }[]>`select count(*)::int as n from contracts where id = ${CTR}`;
    const l = await tx<{ n: number }[]>`select count(*)::int as n from services where id = ${SVC}`;
    return { alokasi: a[0].n, kontrak: k[0].n, layanan: l[0].n };
  });
}

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                         sales_pic_id, commission_payment_pic_id, created_by)
    values (${CLI}, 'PIC', 'Toko ZSP', 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
            ${SALES_PEMILIK}, ${SALES_PEMILIK}, ${SALES_PEMILIK})
    on conflict (id) do nothing`;
  await sql`
    insert into contracts (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, jenis, created_by)
    values (${CTR}, ${CLI}, 12, '2026-09-01', '2027-09-01', 'baru', ${SALES_PEMILIK})
    on conflict (id) do nothing`;
  await sql`
    insert into services (id, client_id, contract_id, master_service_id, master_version_no, name,
                          standard_price, commission_rule, status, created_by)
    values (${SVC}, ${CLI}, ${CTR}, 'MS-ZSP', 1, 'Jasa ZSP', 1000000, 'flat Rp 0',
            '[Awaiting Onboarding]', ${SALES_PEMILIK})
    on conflict (id) do nothing`;
  await sql`
    insert into client_sales_allocations (client_id, salesperson_id, basis_points, created_by)
    select ${CLI}, ${SALES_PEMILIK}, 10000, ${SALES_PEMILIK}
     where not exists (select 1 from client_sales_allocations where client_id = ${CLI})`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from client_sales_allocations where client_id = ${CLI}`;
  await sql`delete from services where id = ${SVC}`;
  await sql`delete from contracts where id = ${CTR}`;
  await sql`delete from clients where id = ${CLI}`;
  await sql.end();
});

dDb('Kinerja Sales — lengan Sales-lead & Finance pada tiga tabel uang', () => {
  it('premisnya dulu: Head Sales BUKAN PIC klien ini', async () => {
    // Kalau premis ini runtuh, seluruh tes di bawah menguji hal yang salah:
    // lengan `jwt_owns_client` yang lama akan menutupinya dan lengan divisi
    // tidak terbukti apa pun.
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from clients
       where id = ${CLI}
         and 'EMP-ZSP-HEAD' in (sales_pic_id, commission_payment_pic_id, created_by)`;
    expect(rows[0].n).toBe(0);
  });

  it('Head Sales melihat ketiganya — INILAH yang berisi 0.00 sebelum migrasi', async () => {
    const v = await terlihat({ employeeId: 'EMP-ZSP-HEAD', division: 'Sales', level: 'lead' });
    // `layanan` DULU 0 di sini, dan itu dicatat sebagai disengaja: rekap
    // layanan dianggap permukaan Finance saja. Pembacaan itu salah terhadap
    // permintaan pemiliknya, yang berbunyi "laporan penjualan … service list …
    // bisa diakses Finance & Head Sales" — satu laporan, dua pembaca, dan
    // `service list` ada di dalamnya. Migrasi `20261002010000` menambahkan
    // lengan Sales-lead pada `services_select`; tanpa itu bagian Rekap Layanan
    // pada laporan tampil KOSONG untuk Head Sales, tanpa galat — bentuk
    // kegagalan yang sama dengan bug yang baru saja ditutup di layar yang sama.
    expect(v).toEqual({ alokasi: 1, kontrak: 1, layanan: 1 });
  });

  it('Director melihat ketiganya lewat jwt_can_read_all — pembanding yang menyembunyikan bug ini', async () => {
    const v = await terlihat({ employeeId: 'EMP-ZSP-DIR', director: true });
    expect(v).toEqual({ alokasi: 1, kontrak: 1, layanan: 1 });
  });

  it('Finance (staff MAUPUN lead) melihat ketiga tabel uang', async () => {
    // Semua level, bukan lead saja — cermin lengan Finance pada
    // transactions_select/installments_select: pekerjaan penagihan dikerjakan
    // staf, dan policy yang hanya mengenal lead membuat antreannya kosong bagi
    // orang yang benar-benar mengerjakannya.
    const staff = await terlihat({ employeeId: 'EMP-ZSP-FIN', division: 'Finance', level: 'staff' });
    const lead = await terlihat({ employeeId: 'EMP-ZSP-FINL', division: 'Finance', level: 'lead' });
    expect(staff).toEqual({ alokasi: 1, kontrak: 1, layanan: 1 });
    expect(lead).toEqual({ alokasi: 1, kontrak: 1, layanan: 1 });
  });

  it('batas ATAS — Sales STAFF lain tetap nol di ketiganya', async () => {
    // `scopeFor` mengunci Sales staff ke baris sendiri, jadi lengan divisi
    // sengaja TIDAK diberikan ke level staff. Kalau tes ini memerah, seorang
    // sales bisa membaca deal rekannya.
    const v = await terlihat({ employeeId: SALES_LAIN, division: 'Sales', level: 'staff' });
    expect(v).toEqual({ alokasi: 0, kontrak: 0, layanan: 0 });
  });

  it('batas ATAS — lead divisi LAIN (Creative) tetap nol pada alokasi & kontrak', async () => {
    const v = await terlihat({ employeeId: 'EMP-ZSP-CRE', division: 'Creative', level: 'lead' });
    expect(v.alokasi).toBe(0);
    expect(v.kontrak).toBe(0);
  });

  it('batas ATAS — Sales STAFF tetap nol pada `services` walau lengan Sales-lead dibuka', async () => {
    // Lengan yang ditambahkan `20261002010000` berbunyi `jwt_is_lead() AND
    // jwt_division() = 'Sales'`, bukan `jwt_division() = 'Sales'`. Kalau
    // suatu hari `jwt_is_lead()` terhapus dari lengan itu, setiap sales staff
    // langsung bisa membaca rincian layanan seluruh agensi — dan tes ini yang
    // memerah lebih dulu.
    const v = await terlihat({ employeeId: SALES_LAIN, division: 'Sales', level: 'staff' });
    expect(v.layanan).toBe(0);
  });

  it('batas ATAS — Finance TIDAK diberi corong prospek', async () => {
    // Pemilik meminta laporan PENJUALAN, bukan corong prospek. Membuka
    // `leads`/`prospect_attempts` untuk Finance adalah pelebaran yang tidak
    // diminta siapa pun, jadi ia dinyatakan sebagai kontrak di sini — kalau
    // suatu hari ia terbuka, keputusannya harus disengaja dan tes ini yang
    // memaksanya terlihat.
    const n = await withClaims(sql, claims({ employeeId: 'EMP-ZSP-FIN', division: 'Finance', level: 'staff' }),
      async (tx) => {
        const l = await tx<{ n: number }[]>`select count(*)::int as n from leads`;
        const p = await tx<{ n: number }[]>`select count(*)::int as n from prospect_attempts`;
        return l[0].n + p[0].n;
      });
    expect(n).toBe(0);
  });

  it('klaim tanpa employee_id tetap nol', async () => {
    const v = await terlihat({ employeeId: '' });
    expect(v).toEqual({ alokasi: 0, kontrak: 0, layanan: 0 });
  });
});
