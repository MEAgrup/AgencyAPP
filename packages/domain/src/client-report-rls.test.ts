/**
 * Klaster laporan klien — RLS-nya DIJALANKAN, bukan sekadar didaftarkan.
 *
 * ⚠️ BERKAS INI ADA KARENA SEBUAH BUG PRODUKSI, DAN BENTUKNYA ADALAH
 * PELAJARANNYA. Baca sebelum menyunting.
 *
 * Pada 2026-09-05/06, setiap pembacaan `client_reports`,
 * `client_report_insight`, dan `client_report_publikasi` lewat `readAsActor`
 * gagal di produksi dengan `42P17 infinite recursion detected in policy`.
 * Insight Editor dan daftar laporan klien 500 untuk SEMUA peran — AM, Account
 * lead, OD, Director, dan kontak Client Portal.
 *
 * Seluruh suite hijau saat itu. Penyebabnya bukan tesnya kurang banyak,
 * melainkan tidak ada satu pun tes yang benar-benar **MEMBACA** tabel-tabel itu
 * sebagai `authenticated`:
 *
 *   * `rls_checks.sql` hanya MENDAFTARKAN nama policy-nya ke ledger §44 —
 *     memeriksa policy-nya ADA, bukan bisa DIJALANKAN;
 *   * tes domain klaster ini memakai jalur `db()` service-role, yang
 *     melewati RLS sepenuhnya.
 *
 * Rekursi policy adalah galat WAKTU JALAN. Ia tidak bisa dilihat oleh
 * pemindai teks policy, tidak bisa dilihat typecheck, dan tidak bisa dilihat
 * tes yang tidak pernah menyentuh RLS. Satu-satunya yang menangkapnya adalah
 * `SELECT` sungguhan di bawah klaim sungguhan — itulah yang dilakukan berkas
 * ini.
 *
 * ⛔ JANGAN ganti pembacaan di sini dengan `db()` service-role "supaya lebih
 * sederhana". Justru service-role itulah yang membuat bug ini lolos.
 *
 * Berpasangan dengan migrasi `20260914010000_fix_client_report_rls_recursion`.
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZCR-` dan
 * dibersihkan di afterAll.
 */
import { createClient, withClaims, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const AM = 'EMP-ZCR-AM';
const CLI_A = 'CLI-ZCR-A';
const CLI_B = 'CLI-ZCR-B';

/** id laporan diisi beforeAll — kolomnya GENERATED ALWAYS AS IDENTITY. */
let reportA = 0;
let reportB = 0;

const claims = (o: {
  employeeId?: string; division?: string; level?: string;
  od?: boolean; director?: boolean; clientId?: string;
}): string =>
  JSON.stringify({
    app_metadata: {
      employee_id: o.employeeId ?? '',
      division: o.division ?? '',
      level: o.level ?? '',
      od: o.od ?? false,
      director: o.director ?? false,
      ...(o.clientId ? { client_id: o.clientId } : {}),
    },
  });

type Claim = Parameters<typeof claims>[0];

/** Baca satu tabel klaster di bawah sebuah klaim. Melempar kalau RLS-nya galat. */
async function bacaIds(claim: Claim, tabel: 'client_reports'): Promise<number[]>;
async function bacaIds(claim: Claim, tabel: 'client_report_publikasi' | 'client_report_insight'): Promise<number[]>;
async function bacaIds(claim: Claim, tabel: string): Promise<number[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tabel === 'client_reports'
      ? tx<{ rid: number }[]>`select id as rid from client_reports where id in (${reportA}, ${reportB}) order by id`
      : tabel === 'client_report_publikasi'
        ? tx<{ rid: number }[]>`select report_id as rid from client_report_publikasi where report_id in (${reportA}, ${reportB}) order by report_id`
        : tx<{ rid: number }[]>`select report_id as rid from client_report_insight where report_id in (${reportA}, ${reportB}) order by report_id, revisi`,
  );
  return rows.map((r) => Number(r.rid));
}

beforeAll(async () => {
  if (!sql) return;
  for (const [id, am] of [[CLI_A, AM], [CLI_B, 'EMP-0001']] as [string, string][]) {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline,
                           target_gmv, sales_pic_id, commission_payment_pic_id, created_by, assigned_am_id)
      values (${id}, 'PIC', ${'Toko ' + id}, 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
              'EMP-0001', 'EMP-0001', 'EMP-0001', ${am})
      on conflict (id) do nothing`;
  }

  const buatLaporan = async (clientId: string): Promise<number> => {
    // PAKAI-ULANG kalau sudah ada. Lihat catatan afterAll: baris klaster ini
    // TIDAK BISA dihapus (append-only by design), jadi fixture yang membuat
    // baris baru tiap dijalankan akan menumpuk selamanya di DB pengembangan.
    const [ada] = await sql<{ id: number }[]>`
      select id from client_reports where client_id = ${clientId} order by id limit 1`;
    if (ada) return Number(ada.id);
    const [cp] = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, created_by)
      values (${clientId}, 'TikTok Shop', 'EMP-0001') returning id`;
    const [r] = await sql<{ id: number }[]>`
      insert into client_reports (client_id, client_platform_id, platform, periode_tipe,
                                  periode_mulai, periode_akhir, hari_periode, payload,
                                  gmv_net, gmv_kotor, gmv_runrate_bulanan, engine_versi, created_by,
                                  benchmark_versi)
      values (${clientId}, ${cp.id}, 'TikTok Shop', 'bulanan',
              '2026-08-01', '2026-08-31', 31, '{}'::jsonb, 0, 0, 0, 'cdps.report.tiktok.v1', 'EMP-0001',
              (select max(versi) from report_benchmark))
      returning id`;
    return Number(r.id);
  };
  reportA = await buatLaporan(CLI_A);
  reportB = await buatLaporan(CLI_B);

  const insight = async (rid: number, revisi: number): Promise<void> => {
    const [ada] = await sql<{ n: number }[]>`
      select 1 as n from client_report_insight where report_id = ${rid} and revisi = ${revisi}`;
    if (ada) return;
    await sql`
      insert into client_report_insight (report_id, revisi, sumber, ringkasan, poin,
                                         rekomendasi_tinggi, rekomendasi_sedang, outlook,
                                         indikator, created_by)
      values (${rid}, ${revisi}, 'manual', ${'ringkasan r' + revisi}, '[]'::jsonb,
              '[]'::jsonb, '[]'::jsonb, 'outlook', '[]'::jsonb, 'EMP-0001')`;
  };
  // Dua revisi pada laporan A: hanya revisi 1 yang nanti DIPAKU publikasi.
  await insight(reportA, 1);
  await insight(reportA, 2);
  await insight(reportB, 1);

  // Laporan A TERBIT memaku revisi 1; laporan B tetap draf.
  // `ck_crp_terbit_lengkap`: status [Terbit] WAJIB berpasangan dengan
  // insight_revisi + diterbitkan_pada + diterbitkan_oleh. Constraint itu yang
  // membuat "terbit" tidak bisa setengah jadi — jangan diakali di fixture.
  await sql`
    insert into client_report_publikasi (report_id, status, insight_revisi,
                                         diterbitkan_pada, diterbitkan_oleh, created_by)
    values (${reportA}, '[Terbit]', 1, now(), 'EMP-0001', 'EMP-0001')
    on conflict (report_id) do update
       set status = '[Terbit]', insight_revisi = 1,
           diterbitkan_pada = now(), diterbitkan_oleh = 'EMP-0001'`;
  await sql`
    insert into client_report_publikasi (report_id, status, created_by)
    values (${reportB}, '[Draf]', 'EMP-0001')
    on conflict (report_id) do update set status = '[Draf]'`;
});

// Pembersihan fixture — dan kenapa bentuknya begini.
//
// `client_reports` hanya beku untuk UPDATE (`trg_client_reports_frozen` adalah
// BEFORE UPDATE), dan `client_report_publikasi` ikut terhapus lewat
// `ON DELETE CASCADE`. Yang menghalangi hanya `client_report_insight`:
// `trg_cri_no_delete` melarang DELETE, dan FK-nya TANPA cascade — jadi selama
// baris insight ada, laporannya tidak bisa dihapus, dan selama laporannya ada,
// kliennya juga tidak.
//
// Membiarkan baris fixture tertinggal BUKAN pilihan: tes `portal.test.ts`
// (management dashboard Rule 11) menghitung seluruh klien, jadi dua klien
// nyasar membuatnya merah — dibuktikan, bukan diduga. Norma repo ini memang
// buat-lalu-hapus; lihat `ads-client-scope.rls.test.ts`.
//
// Karena itu penghapusannya mematikan trigger HANYA di dalam transaksi ini
// lewat `session_replication_role = replica`, dengan `set local` sehingga
// lingkupnya mati begitu transaksinya selesai.
//
// ⛔ Ini jalur TES, bukan pola yang boleh menyeberang ke kode produksi.
// Invariant append-only-nya TIDAK dilubangi: trigger-nya tetap terpasang, dan
// `immutability_checks` di `db-rebuild.sh` tetap membuktikannya berlaku untuk
// jalur normal. Yang dilakukan di sini adalah hak superuser di DB tes, bukan
// pelonggaran aturan.
afterAll(async () => {
  if (!sql) return;
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from client_report_insight where report_id in (${reportA}, ${reportB})`;
    await tx`delete from client_reports where id in (${reportA}, ${reportB})`;
  });
  await sql`delete from client_platforms where client_id like 'CLI-ZCR-%'`;
  await sql`delete from clients where id like 'CLI-ZCR-%'`;
  await sql.end();
});

dDb('klaster laporan klien — policy-nya BISA DIJALANKAN (regresi 42P17)', () => {
  // ── Bagian 1: tidak ada yang meledak ──────────────────────────────────────
  //
  // Ini bagian yang menangkap bug aslinya. Sebelum migrasi 20260914010000,
  // SETIAP kasus di bawah melempar `42P17 infinite recursion detected in
  // policy` — bukan mengembalikan himpunan yang salah, melainkan GAGAL TOTAL.
  // Assert-nya sengaja lemah (tidak melempar) karena yang diuji di sini
  // memang cuma satu hal: query-nya selesai.
  const semuaPeran: [string, Claim][] = [
    ['AM pemilik', { employeeId: AM, division: 'Account', level: 'staff' }],
    ['AM lain', { employeeId: 'EMP-0001', division: 'Account', level: 'staff' }],
    ['lead Account', { employeeId: 'EMP-ZCR-LEAD', division: 'Account', level: 'lead' }],
    ['OD', { employeeId: 'EMP-ZCR-OD', od: true }],
    ['Director', { employeeId: 'EMP-ZCR-DIR', director: true }],
    ['kontak portal A', { clientId: CLI_A }],
    ['kontak portal B', { clientId: CLI_B }],
    ['klaim kosong', {}],
  ];

  it.each(semuaPeran)('%s bisa membaca client_reports tanpa rekursi', async (_n, claim) => {
    await expect(bacaIds(claim, 'client_reports')).resolves.toBeInstanceOf(Array);
  });

  it.each(semuaPeran)('%s bisa membaca client_report_publikasi tanpa rekursi', async (_n, claim) => {
    await expect(bacaIds(claim, 'client_report_publikasi')).resolves.toBeInstanceOf(Array);
  });

  it.each(semuaPeran)('%s bisa membaca client_report_insight tanpa rekursi', async (_n, claim) => {
    await expect(bacaIds(claim, 'client_report_insight')).resolves.toBeInstanceOf(Array);
  });

  // ── Bagian 2: himpunannya benar ───────────────────────────────────────────
  //
  // Memutus rekursi itu mudah kalau boleh melonggarkan aturannya. Bagian ini
  // memaku bahwa TIDAK ada yang dilonggarkan: perbaikannya memindahkan
  // subquery ke fungsi DEFINER, bukan menghapus syaratnya.
  it('AM pemilik hanya melihat laporan kliennya sendiri', async () => {
    expect(await bacaIds({ employeeId: AM, division: 'Account', level: 'staff' }, 'client_reports'))
      .toEqual([reportA]);
  });

  it('AM lain tidak melihat laporan klien yang bukan miliknya', async () => {
    const v = await bacaIds({ employeeId: 'EMP-ZCR-ASING', division: 'Account', level: 'staff' }, 'client_reports');
    expect(v).toEqual([]);
  });

  it('lead Account, OD, dan Director melihat keduanya', async () => {
    for (const claim of [
      { employeeId: 'EMP-ZCR-LEAD', division: 'Account', level: 'lead' },
      { employeeId: 'EMP-ZCR-OD', od: true },
      { employeeId: 'EMP-ZCR-DIR', director: true },
    ]) {
      expect(await bacaIds(claim, 'client_reports')).toEqual([reportA, reportB]);
    }
  });

  it('klaim kosong tetap default-deny di ketiga tabel', async () => {
    expect(await bacaIds({}, 'client_reports')).toEqual([]);
    expect(await bacaIds({}, 'client_report_publikasi')).toEqual([]);
    expect(await bacaIds({}, 'client_report_insight')).toEqual([]);
  });

  // ── Bagian 3: gerbang portal — bagian yang paling mahal kalau bocor ───────
  it('kontak portal hanya melihat laporannya sendiri, dan hanya yang TERBIT', async () => {
    expect(await bacaIds({ clientId: CLI_A }, 'client_reports')).toEqual([reportA]);
  });

  it('kontak portal TIDAK melihat laporan yang masih draf — bahkan miliknya sendiri', async () => {
    // Laporan B milik CLI_B dan publikasinya `[Draf]`. Kalau ini bocor, klien
    // membaca laporan yang belum disetujui AM untuk dikirim.
    expect(await bacaIds({ clientId: CLI_B }, 'client_reports')).toEqual([]);
  });

  it('kontak portal tidak melihat laporan klien LAIN', async () => {
    const v = await bacaIds({ clientId: CLI_B }, 'client_reports');
    expect(v).not.toContain(reportA);
  });

  it('portal hanya membaca revisi insight YANG DIPAKU publikasi terbit', async () => {
    // Laporan A punya revisi 1 dan 2; publikasinya memaku revisi 1. Revisi 2
    // adalah draf yang masih disunting AM — klien tidak boleh melihatnya.
    // Ini syarat yang paling mudah hilang saat memutus rekursi, karena
    // menghapusnya tetap membuat semua tes "tidak meledak" hijau.
    const rows = await withClaims(sql, claims({ clientId: CLI_A }), (tx) =>
      tx<{ revisi: number }[]>`
        select revisi from client_report_insight
         where report_id = ${reportA} order by revisi`,
    );
    expect(rows.map((r) => Number(r.revisi))).toEqual([1]);
  });

  it('AM pemilik TETAP melihat kedua revisi — gerbang ketat itu milik portal saja', async () => {
    const rows = await withClaims(sql, claims({ employeeId: AM, division: 'Account', level: 'staff' }), (tx) =>
      tx<{ revisi: number }[]>`
        select revisi from client_report_insight
         where report_id = ${reportA} order by revisi`,
    );
    expect(rows.map((r) => Number(r.revisi))).toEqual([1, 2]);
  });
});
