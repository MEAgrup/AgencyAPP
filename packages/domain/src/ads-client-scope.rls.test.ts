/**
 * SCR-UI-1 — divisi Ads me-LIST klien, dibatasi ke klien yang punya BRIEF ADS.
 *
 * Keputusan pemilik 2026-09-06, dua jawaban: penanda "layanan Ads" adalah
 * **adanya brief Ads**, dan klien yang layanan Ads-nya sudah selesai **tetap
 * boleh dibaca riwayatnya** — jadi nol filter status. Yang diuji di sini adalah **himpunan baris yang
 * benar-benar dikembalikan RLS** per peran, bukan sebuah predikat TS: untuk arm
 * ini memang TIDAK ADA cermin TS, dan itu disengaja. Jalur bacanya
 * `GET /api/v1/clients` → `readAsActor` → `client.listClients`, yang scope-nya
 * murni RLS; menuliskan ulang aturannya di TS akan menciptakan sumber kebenaran
 * KEDUA untuk aturan yang sudah ditegakkan DB — persis yang `CLAUDE.md` larang
 * ("Penegakan aturan ada di DB, bukan cuma di TS").
 *
 * Jadi kontraknya ditulis apa adanya: **peran X melihat PERSIS klien-klien ini**.
 * Itu yang bisa salah, dan salahnya mahal ke dua arah — daftar kosong yang
 * terlihat seperti bug UI, atau staff Ads membaca seluruh klien.
 *
 * Berpasangan dengan `supabase/tests/rls_checks.sql` §45, yang menguji hal yang
 * sama di lapisan SQL. Dua-duanya ada dengan alasan yang sama seperti
 * `interview.rls.test.ts`: satu berjalan di CI DB, satu di suite domain, dan
 * keduanya harus setuju.
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
/** Yang boleh dilihat divisi Ads — dan hanya ini. */
const TERLIHAT_ADS = [CLI_AKTIF, CLI_DONE];

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
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from briefs where id like 'BRF-ZAD-%'`;
  await sql`delete from services where id like 'SVC-ZAD-%'`;
  await sql`delete from clients where id like 'CLI-ZAD-%'`;
  await sql.end();
});

dDb('SCR-UI-1 — arm Ads di clients_select', () => {
  it('staff Ads melihat PERSIS klien yang punya brief Ads', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZAD-ADS', division: 'Ads', level: 'staff' }))
      .toEqual(TERLIHAT_ADS);
  });

  it('lead Ads melihat himpunan yang SAMA — arm ini digerbang divisi, bukan level', async () => {
    // Sengaja tidak memakai `jwt_is_lead()`: pembatasnya himpunan klien, bukan
    // jabatan. Staff Ads yang menjalankan scan butuh daftar ini, bukan cuma Head.
    expect(await terlihat({ employeeId: 'EMP-ZAD-ADSLEAD', division: 'Ads', level: 'lead' }))
      .toEqual(TERLIHAT_ADS);
  });

  it('klien yang brief-nya milik divisi LAIN tidak terlihat', async () => {
    const v = await terlihat({ employeeId: 'EMP-ZAD-ADS', division: 'Ads', level: 'staff' });
    expect(v).not.toContain(CLI_LAIN);
  });

  it('klien tanpa brief sama sekali tidak terlihat', async () => {
    const v = await terlihat({ employeeId: 'EMP-ZAD-ADS', division: 'Ads', level: 'staff' });
    expect(v).not.toContain(CLI_NOL);
  });

  it('klien yang layanan Ads-nya sudah Done TETAP terlihat — riwayat harus terbaca', async () => {
    // Keputusan pemilik 2026-09-06. Ini yang paling mudah hilang tanpa sadar:
    // menambahkan filter status ke predikat terasa seperti "membersihkan", dan
    // efeknya adalah riwayat Ads lenyap dari picker tanpa satu pun galat.
    const v = await terlihat({ employeeId: 'EMP-ZAD-ADS', division: 'Ads', level: 'staff' });
    expect(v).toContain(CLI_DONE);
  });

  it.each([
    ['staff Creative', { employeeId: 'EMP-ZAD-CRE', division: 'Creative', level: 'staff' }],
    ['lead Creative', { employeeId: 'EMP-ZAD-CRE2', division: 'Creative', level: 'lead' }],
    ['staff KOL', { employeeId: 'EMP-ZAD-KOL', division: 'KOL', level: 'staff' }],
  ] as [string, Claim][])('%s tidak ikut kebagian arm Ads', async (_n, claim) => {
    expect(await terlihat(claim)).toEqual([]);
  });

  it('OD dan Director tetap membaca keempatnya — arm baru tidak mempersempit siapa pun', async () => {
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
