/**
 * SCR-UI-1 — divisi Ads me-LIST klien, dibatasi ke klien ber-layanan Ads AKTIF.
 *
 * Keputusan pemilik 2026-09-06. Yang diuji di sini adalah **himpunan baris yang
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
const CLI_GATE = 'CLI-ZAD-GATE';   // layanan aktif, form G-B menyebut Ads
const CLI_BRIEF = 'CLI-ZAD-BRIEF'; // layanan aktif, NOL form G-B, tapi ada brief Ads
const CLI_LAIN = 'CLI-ZAD-LAIN';   // layanan aktif, form G-B TIDAK menyebut Ads
const CLI_DONE = 'CLI-ZAD-DONE';   // jejak Ads identik CLI_GATE, tapi layanannya Done
const SEMUA = [CLI_BRIEF, CLI_DONE, CLI_GATE, CLI_LAIN];

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
  await svc('SVC-ZAD-GATE', CLI_GATE, '[In Execution]');
  await svc('SVC-ZAD-BRIEF', CLI_BRIEF, '[In Execution]');
  await svc('SVC-ZAD-LAIN', CLI_LAIN, '[In Execution]');
  // Status terminal — pembeda TUNGGAL terhadap SVC-ZAD-GATE.
  await svc('SVC-ZAD-DONE', CLI_DONE, 'Done');

  const gate = async (serviceId: string, divisi: string): Promise<void> => {
    await sql`
      insert into service_plan_gate
        (service_id, tier_katalog, divisi_terlibat, deliverable, berulang,
         sequence_dependency, laporan_periodik, pemicu_keras, pemicu_lunak,
         config_version_no, rekomendasi, keputusan_am, kesesuaian,
         tanggal_tinjau_ulang, decided_by, created_by)
      values (${serviceId}, 'ditentukan_am', ${divisi}, 'd', false, false, false,
              '[]'::jsonb, '[]'::jsonb, 1, 'butuh_plan', 'butuh_plan', 'sesuai',
              current_date, ${OWNER}, ${OWNER})
      on conflict do nothing`;
  };
  // 'Creative, Ads' BER-SPASI — bentuk yang benar-benar ditulis `plangate.ts`
  // (`attrs.divisiTerlibat.join(', ')`). Predikat yang lupa membuang spasi gagal
  // di sini, bukan diam-diam di produksi.
  await gate('SVC-ZAD-GATE', 'Creative, Ads');
  await gate('SVC-ZAD-DONE', 'Creative, Ads');
  await gate('SVC-ZAD-LAIN', 'Creative');

  // Jejak kedua: brief Ads TANPA baris service_plan_gate sama sekali — kasus
  // layanan `plan_wajib` yang tidak pernah melewati form G-B.
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, created_by)
    values ('BRF-ZAD-ADS', 'SVC-ZAD-BRIEF', 'brief ads', '[Draft]', 'Ads', ${OWNER})
    on conflict (id) do nothing`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from briefs where id = 'BRF-ZAD-ADS'`;
  await sql`delete from service_plan_gate where service_id like 'SVC-ZAD-%'`;
  await sql`delete from services where id like 'SVC-ZAD-%'`;
  await sql`delete from clients where id like 'CLI-ZAD-%'`;
  await sql.end();
});

dDb('SCR-UI-1 — arm Ads di clients_select', () => {
  it('staff Ads melihat PERSIS klien ber-layanan Ads aktif — dua jejak, bukan satu', async () => {
    // Gate DAN brief. Kalau salah satu jejak dihapus dari predikat, salah satu
    // dari kedua id ini hilang dan tes menyebut yang mana.
    expect(await terlihat({ employeeId: 'EMP-ZAD-ADS', division: 'Ads', level: 'staff' }))
      .toEqual([CLI_BRIEF, CLI_GATE]);
  });

  it('lead Ads melihat himpunan yang SAMA — arm ini digerbang divisi, bukan level', async () => {
    // Sengaja tidak memakai `jwt_is_lead()`: pembatasnya himpunan klien, bukan
    // jabatan. Staff Ads yang menjalankan scan butuh daftar ini, bukan cuma Head.
    expect(await terlihat({ employeeId: 'EMP-ZAD-ADSLEAD', division: 'Ads', level: 'lead' }))
      .toEqual([CLI_BRIEF, CLI_GATE]);
  });

  it('klien yang form G-B-nya tidak menyebut Ads TIDAK terlihat', async () => {
    const v = await terlihat({ employeeId: 'EMP-ZAD-ADS', division: 'Ads', level: 'staff' });
    expect(v).not.toContain(CLI_LAIN);
  });

  it('klien yang layanan Ads-nya sudah Done TIDAK terlihat — itu arti kata "aktif"', async () => {
    // Konsekuensi yang disengaja dari keputusan pemilik. Kalau tim Ads butuh
    // membuka scan periode lalu untuk klien yang layanannya selesai, itu
    // pelebaran yang butuh ketokan tersendiri (🔶 DECISIONS 2026-09-06).
    const v = await terlihat({ employeeId: 'EMP-ZAD-ADS', division: 'Ads', level: 'staff' });
    expect(v).not.toContain(CLI_DONE);
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
