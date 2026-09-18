/**
 * G4-03 Tahap 1 — mesin verdict Shopee (`evaluasiVerdictShopee`).
 *
 * DB nyata (di-skip tanpa `DATABASE_URL`, pola sama `pdt-prefill.test.ts`).
 * Benchmark `pdt_benchmark` platform='shopee' versi 1 dipakai APA ADANYA dari
 * seed migrasi `20261114010000` (roas_good=4, acos_good=0.25) — modul ini
 * murni pembaca benchmark, bukan penulisnya, jadi tes tidak menyisipkan versi
 * sendiri. Prefix `ZPDTVD-`/`ZZPDTVD-TEST` supaya `afterEach` di sini tidak
 * bentrok fixture berkas lain.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { evaluasiVerdictShopee } from './pdt-verdict';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const nextClientId = (): string => `CLI-ZPDTVD-${Date.now() % 100000}-${seq++}`;
const OWNER_AM = 'ZPDTVD-AM';

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${OWNER_AM}, 'AM Uji Verdict', 'zpdtvd-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = ${OWNER_AM}`;
  await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_usulan where batch_id in (select id from pdt_upload_batch where client_id like 'CLI-ZPDTVD-%')`;
  await sql`delete from pdt_fact_ads where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTVD-TEST')`;
  await sql`delete from pdt_fact_creator_period where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTVD-TEST')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-ZPDTVD-%'`;
  await sql`delete from client_platforms where created_by = 'ZZPDTVD-TEST'`;
  await sql`delete from clients where created_by = 'ZZPDTVD-TEST'`;
});

async function insertClient(id: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${OWNER_AM}, 'ZZPDTVD-TEST')`;
}

async function insertClientPlatform(clientId: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, active, created_by)
    values (${clientId}, 'Shopee', true, 'ZZPDTVD-TEST')
    returning id`;
  return rows[0].id;
}

async function insertBatch(clientId: string, clientPlatformId: number, periodeMulai: string, periodeSelesai: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into pdt_upload_batch (client_id, client_platform_id, platform, periode_mulai, periode_selesai,
      status, parser_versi, retensi_sampai, dibuat_oleh)
    values (${clientId}, ${clientPlatformId}, 'shopee', ${periodeMulai}::date, ${periodeSelesai}::date,
      'verified', 1, '2099-01-01', ${OWNER_AM})
    returning id`;
  return rows[0].id;
}

async function insertAds(clientPlatformId: number, batchId: number, periode: string, gmv: number, biaya: number): Promise<void> {
  await sql`
    insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv)
    values (${clientPlatformId}, 'shopee_ads_cpc', 'KAMP-1', ${periode}::date, ${batchId}, 1, ${biaya}, ${gmv})`;
}

async function insertCreator(clientPlatformId: number, batchId: number, periode: string, creatorHandle: string, gmv: number): Promise<void> {
  await sql`
    insert into pdt_fact_creator_period (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv)
    values (${clientPlatformId}, ${creatorHandle}, ${periode}::date, ${batchId}, 1, ${gmv})`;
}

async function usulanUntukBatch(batchId: number): Promise<{ kode_aksi: string; nilai_sekarang: string; target_nilai: string; realisasi_nilai: string | null; verdict: string | null }[]> {
  return sql<{ kode_aksi: string; nilai_sekarang: string; target_nilai: string; realisasi_nilai: string | null; verdict: string | null }[]>`
    select kode_aksi, nilai_sekarang, target_nilai, realisasi_nilai, verdict from pdt_usulan
     where batch_id = ${batchId} order by kode_aksi`;
}

describeDb('evaluasiVerdictShopee (G4-03 Tahap 1)', () => {
  it('ROAS+ACoS di bawah standar ⇒ dua usulan dibuka, target = ambang _good', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId);
    const batchId = await insertBatch(clientId, cpId, '2026-08-01', '2026-08-31');
    await insertAds(cpId, batchId, '2026-08-01', 6_000_000, 3_000_000); // ROAS 2, ACoS 0.5 — keduanya buruk
    await insertCreator(cpId, batchId, '2026-08-01', 'kreator1', 1_000_000); // 1 kreator aktif — SHP-KREATOR-AKTIF tidak ikut menyala di tes ini

    await evaluasiVerdictShopee(sql, batchId, cpId, '2026-08-01');

    const usulan = await usulanUntukBatch(batchId);
    expect(usulan).toEqual([
      { kode_aksi: 'SHP-ACOS', nilai_sekarang: '0.500', target_nilai: '0.250', realisasi_nilai: null, verdict: null },
      { kode_aksi: 'SHP-ROAS', nilai_sekarang: '2.000', target_nilai: '4.000', realisasi_nilai: null, verdict: null },
    ]);
  });

  it('ROAS+ACoS sehat ⇒ nol usulan dibuka', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId);
    const batchId = await insertBatch(clientId, cpId, '2026-08-01', '2026-08-31');
    await insertAds(cpId, batchId, '2026-08-01', 20_000_000, 4_000_000); // ROAS 5, ACoS 0.2 — keduanya sehat
    await insertCreator(cpId, batchId, '2026-08-01', 'kreator1', 1_000_000); // 1 kreator aktif

    await evaluasiVerdictShopee(sql, batchId, cpId, '2026-08-01');

    expect(await usulanUntukBatch(batchId)).toEqual([]);
  });

  it('reparse (panggilan kedua batch yang sama) tidak menggandakan baris usulan', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId);
    const batchId = await insertBatch(clientId, cpId, '2026-08-01', '2026-08-31');
    await insertAds(cpId, batchId, '2026-08-01', 6_000_000, 3_000_000);
    await insertCreator(cpId, batchId, '2026-08-01', 'kreator1', 1_000_000);

    await evaluasiVerdictShopee(sql, batchId, cpId, '2026-08-01');
    await evaluasiVerdictShopee(sql, batchId, cpId, '2026-08-01'); // reparse — SQL sama, fakta sama

    expect(await usulanUntukBatch(batchId)).toHaveLength(2);
  });

  it('Rule 31 loop: batch periode berikutnya mengisi realisasi_nilai + verdict usulan lama (plan_ref NULL ⇒ tidak_dikerjakan, walau target numerik tercapai)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId);

    const batchAgustus = await insertBatch(clientId, cpId, '2026-08-01', '2026-08-31');
    await insertAds(cpId, batchAgustus, '2026-08-01', 6_000_000, 3_000_000); // ROAS 2 (buruk) ⇒ usulan SHP-ROAS dibuka
    await insertCreator(cpId, batchAgustus, '2026-08-01', 'kreator1', 1_000_000);
    await evaluasiVerdictShopee(sql, batchAgustus, cpId, '2026-08-01');

    const batchSeptember = await insertBatch(clientId, cpId, '2026-09-01', '2026-09-30');
    await insertAds(cpId, batchSeptember, '2026-09-01', 20_000_000, 2_000_000); // ROAS 10 bulan berikutnya — target numerik tercapai
    await insertCreator(cpId, batchSeptember, '2026-09-01', 'kreator1', 1_000_000);
    await evaluasiVerdictShopee(sql, batchSeptember, cpId, '2026-09-01');

    const lama = await usulanUntukBatch(batchAgustus);
    const roasLama = lama.find((u) => u.kode_aksi === 'SHP-ROAS');
    const acosLama = lama.find((u) => u.kode_aksi === 'SHP-ACOS');
    expect(roasLama?.realisasi_nilai).toBe('10.000');
    expect(acosLama?.realisasi_nilai).toBe('0.100');
    // plan_ref belum pernah diisi apa pun (jembatan Plan/Brief belum dibangun Tahap 1) ⇒
    // selalu tidak_dikerjakan, walau realisasi tercapai secara numerik untuk keduanya
    // (ROAS 10 >= target 4; ACoS 0.1 <= target 0.25).
    expect(roasLama?.verdict).toBe('tidak_dikerjakan');
    expect(acosLama?.verdict).toBe('tidak_dikerjakan');

    // Batch September sendiri sehat (ROAS 10, ACoS 0.1) ⇒ nol usulan BARU dibuka untuknya.
    expect(await usulanUntukBatch(batchSeptember)).toEqual([]);
  });

  it('aksi 6: nol kreator aktif ⇒ usulan SHP-KREATOR-AKTIF dibuka, target = 1', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId);
    const batchId = await insertBatch(clientId, cpId, '2026-08-01', '2026-08-31');
    // nol pdt_fact_ads dan nol pdt_fact_creator_period ⇒ ROAS/ACoS null (Rule 7), hanya aksi 6 yang menyala

    await evaluasiVerdictShopee(sql, batchId, cpId, '2026-08-01');

    expect(await usulanUntukBatch(batchId)).toEqual([
      { kode_aksi: 'SHP-KREATOR-AKTIF', nilai_sekarang: '0.000', target_nilai: '1.000', realisasi_nilai: null, verdict: null },
    ]);
  });

  it('aksi 6: minimal satu kreator aktif (gmv > 0) ⇒ nol usulan SHP-KREATOR-AKTIF', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId);
    const batchId = await insertBatch(clientId, cpId, '2026-08-01', '2026-08-31');
    await insertCreator(cpId, batchId, '2026-08-01', 'kreator1', 500_000);
    await insertCreator(cpId, batchId, '2026-08-01', 'kreator2', 0); // gmv=0 ⇒ tidak dihitung aktif

    await evaluasiVerdictShopee(sql, batchId, cpId, '2026-08-01');

    expect(await usulanUntukBatch(batchId)).toEqual([]);
  });

  it('aksi 6, Rule 31 loop: batch berikutnya dapat kreator aktif ⇒ realisasi_nilai terisi, verdict tidak_dikerjakan (plan_ref NULL walau target tercapai)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId);

    const batchAgustus = await insertBatch(clientId, cpId, '2026-08-01', '2026-08-31');
    await evaluasiVerdictShopee(sql, batchAgustus, cpId, '2026-08-01'); // nol kreator ⇒ usulan dibuka

    const batchSeptember = await insertBatch(clientId, cpId, '2026-09-01', '2026-09-30');
    await insertCreator(cpId, batchSeptember, '2026-09-01', 'kreator1', 500_000);
    await insertCreator(cpId, batchSeptember, '2026-09-01', 'kreator2', 500_000);
    await evaluasiVerdictShopee(sql, batchSeptember, cpId, '2026-09-01'); // 2 kreator aktif bulan berikutnya

    const lama = await usulanUntukBatch(batchAgustus);
    const kreatorAktifLama = lama.find((u) => u.kode_aksi === 'SHP-KREATOR-AKTIF');
    expect(kreatorAktifLama?.realisasi_nilai).toBe('2.000');
    expect(kreatorAktifLama?.verdict).toBe('tidak_dikerjakan'); // plan_ref belum pernah diisi (sama seperti ROAS/ACoS Tahap 1)

    // Batch September sendiri punya kreator aktif ⇒ nol usulan BARU untuk aksi ini.
    expect(await usulanUntukBatch(batchSeptember)).toEqual([]);
  });
});
