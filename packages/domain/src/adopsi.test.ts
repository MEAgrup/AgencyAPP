/**
 * Adopsi Sistem (adopsi.ts) — pemilik 2026-09-10, Bagian 1.
 *
 * - Unit MURNI (tanpa DB): `sessionize` (satu-satunya aturan yang pemilik
 *   nyatakan eksplisit — "gap > 30 menit memulai sesi baru"), `normalizePath`,
 *   dan kedua gerbangnya.
 * - Integrasi (dilewati tanpa `DATABASE_URL`): perekaman + laporan, termasuk
 *   yang tidak bisa dilihat dari unit — bahwa `employee_id` datang dari AKTOR
 *   dan tidak pernah dari input, dan bahwa baris log immutable.
 *
 * Baris di-namespace `ZZAD-`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  adopsiReport,
  canRecordPageView,
  canViewAdopsi,
  MSG_FORBIDDEN,
  normalizePath,
  recordPageView,
  SESSION_GAP_MINUTES,
  sessionize,
  type Actor,
} from './adopsi';

const staff = (id: string, division = 'Sales'): Actor => ({ employeeId: id, role: permission.makeRole({ division, level: 'staff' }) });
const lead = (id: string, division = 'Sales'): Actor => ({ employeeId: id, role: permission.makeRole({ division, level: 'lead' }) });
const od = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Management', level: 'staff', od: true }) });
const director = (id: string): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Management', level: 'staff', director: true }) });

// ===========================================================================
// Unit.
// ===========================================================================

describe('canViewAdopsi — sempit dengan sengaja', () => {
  it('OD dan Director saja; lead divisi TIDAK', () => {
    expect(canViewAdopsi(od('O'))).toBe(true);
    expect(canViewAdopsi(director('D'))).toBe(true);
    // INI assertion-nya, bukan kelalaian. Pemilik: "indikator adaptasi tim ke
    // sistem baru — BUKAN komponen reward". Memberi lead akses ke jam
    // pemakaian anak buahnya menjadikannya alat pengawasan, yaitu hal yang ia
    // katakan ini bukan. Kalau baris ini suatu hari dibalik, kalimat pemilik
    // itulah yang harus dibantah lebih dulu — dan perluasannya tidak bisa
    // ditarik kembali, karena datanya sudah dilihat.
    expect(canViewAdopsi(lead('L'))).toBe(false);
    expect(canViewAdopsi(lead('LH', 'HR'))).toBe(false);
    expect(canViewAdopsi(staff('S'))).toBe(false);
  });
});

describe('canRecordPageView', () => {
  it('setiap aktor KARYAWAN mencatat jejaknya sendiri', () => {
    expect(canRecordPageView(staff('S'))).toBe(true);
    expect(canRecordPageView(lead('L', 'Creative'))).toBe(true);
    expect(canRecordPageView(director('D'))).toBe(true);
  });

  it('realm non-karyawan ditolak — barisnya akan mencemari roster dengan id yang bukan karyawan', () => {
    const vendor = { vendorId: 'VND-0001' } as unknown as Actor;
    const kontak = { clientContactId: 'CCT-0001', clientId: 'CLI-0001' } as unknown as Actor;
    expect(canRecordPageView(vendor)).toBe(false);
    expect(canRecordPageView(kontak)).toBe(false);
  });
});

describe('normalizePath', () => {
  it('membuang query string — ia memuat isi filter, dan log adopsi tidak butuh satu pun', () => {
    // Kalau ini memerah, CDPS diam-diam punya log pencarian per-orang.
    expect(normalizePath('/leads?q=Budi+Santoso&status=active')).toBe('/leads');
    expect(normalizePath('/clients/CLI-0001?tab=uang')).toBe('/clients/CLI-0001');
  });

  it('membuang fragment, dan rute kosong jadi "/"', () => {
    expect(normalizePath('/portal#kartu')).toBe('/portal');
    expect(normalizePath('')).toBe('/');
  });

  it('memotong, tidak menolak — rute panjang tidak boleh membuat halaman menyalak', () => {
    const panjang = `/${'x'.repeat(400)}`;
    expect(normalizePath(panjang)).toHaveLength(255);
  });
});

describe('sessionize — "gap > 30 menit memulai sesi baru" (angka pemilik)', () => {
  const t = (menit: number): Date => new Date(Date.UTC(2026, 8, 10, 0, menit, 0));

  it('kosong = nol sesi, nol jam', () => {
    expect(sessionize([])).toEqual({ sessions: 0, ms: 0 });
  });

  it('satu page-view = SATU sesi berdurasi NOL — sengaja, bukan bug', () => {
    // Tidak ada sumber di CDPS yang tahu berapa lama halaman terakhir dibaca.
    // Menebaknya akan menghasilkan angka yang tidak bisa dihitung ulang dari
    // log (aturan rumah #4), lalu angka karangan itu akan dikutip di rapat.
    expect(sessionize([t(0)])).toEqual({ sessions: 1, ms: 0 });
  });

  it('jeda TEPAT 30 menit masih satu sesi; 30 menit + 1 detik memulai sesi baru', () => {
    // Batasnya "> 30", bukan ">= 30" — dan satu detik di sisi yang salah
    // mengubah setiap angka di laporan ini.
    const tepat = [new Date(0), new Date(SESSION_GAP_MINUTES * 60_000)];
    expect(sessionize(tepat)).toEqual({ sessions: 1, ms: SESSION_GAP_MINUTES * 60_000 });
    const lewat = [new Date(0), new Date(SESSION_GAP_MINUTES * 60_000 + 1000)];
    expect(sessionize(lewat)).toEqual({ sessions: 2, ms: 0 });
  });

  it('dua sesi: durasinya dijumlahkan, jeda di antaranya TIDAK ikut', () => {
    // 0,10,20 (sesi 20 menit) — jeda 60 menit — 80,95 (sesi 15 menit).
    const r = sessionize([t(0), t(10), t(20), t(80), t(95)]);
    expect(r.sessions).toBe(2);
    expect(r.ms).toBe(35 * 60_000);
  });

  it('input tidak urut menghasilkan jawaban yang SAMA', () => {
    const urut = sessionize([t(0), t(10), t(20), t(80), t(95)]);
    const acak = sessionize([t(95), t(20), t(0), t(80), t(10)]);
    expect(acak).toEqual(urut);
  });
});

// ===========================================================================
// Integrasi.
// ===========================================================================

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const EMP = 'EMP-0001'; // ada di seed Alpha Digital, jadi roster-nya terisi
const EMP2 = 'EMP-0002';

describeDb('recordPageView + adopsiReport', () => {
  beforeAll(async () => {
    if (!sql) return;
    await sql`delete from page_views where employee_id in (${EMP}, ${EMP2})`.catch(() => undefined);
  });

  afterAll(async () => {
    if (!sql) return;
    // `page_views` append-only (forbid_mutation) — nonaktifkan trigger untuk
    // membersihkan fixture, pola yang sama dengan `activity.test.ts`.
    await sql`alter table page_views disable trigger trg_page_views_no_delete`;
    try {
      await sql`delete from page_views`;
    } finally {
      await sql`alter table page_views enable trigger trg_page_views_no_delete`;
    }
    await sql.end();
  });

  it('employee_id datang dari AKTOR, bukan dari input — tidak ada bentuk permintaan yang menulis atas nama orang lain', async () => {
    await recordPageView(sql, staff(EMP), { path: '/sales?filter=rahasia', navHref: '/sales', navTotal: 12 });
    const rows = await sql<{ employee_id: string; path: string; nav_href: string | null; nav_total: number }[]>`
      select employee_id, path, nav_href, nav_total from page_views order by id desc limit 1`;
    expect(rows[0].employee_id).toBe(EMP);
    expect(rows[0].path).toBe('/sales'); // query string dibuang
    expect(rows[0].nav_href).toBe('/sales');
    expect(rows[0].nav_total).toBe(12);
  });

  it('barisnya immutable — nol jalur UPDATE/DELETE (aturan rumah #3)', async () => {
    await expect(sql`update page_views set path = '/diubah' where employee_id = ${EMP}`).rejects.toThrow();
    await expect(sql`delete from page_views where employee_id = ${EMP}`).rejects.toThrow();
  });

  it('navTotal negatif dijepit ke 0, path panjang dipotong — log tidak pernah menolak sebuah rute', async () => {
    await recordPageView(sql, staff(EMP), { path: `/${'y'.repeat(400)}`, navHref: null, navTotal: -5 });
    const rows = await sql<{ path: string; nav_total: number }[]>`
      select path, nav_total from page_views order by id desc limit 1`;
    expect(rows[0].path).toHaveLength(255);
    expect(rows[0].nav_total).toBe(0);
  });

  it('realm non-karyawan ditolak dengan pesan BI', async () => {
    const vendor = { vendorId: 'VND-ZZAD' } as unknown as Actor;
    await expect(recordPageView(sql, vendor, { path: '/x', navHref: null, navTotal: 1 }))
      .rejects.toThrow(MSG_FORBIDDEN);
  });

  it('laporan: hanya OD/Director; lead dan staff ditolak', async () => {
    const f = { from: null, to: null };
    await expect(adopsiReport(sql, lead('ZZAD-LEAD'), f)).rejects.toThrow(MSG_FORBIDDEN);
    await expect(adopsiReport(sql, staff('ZZAD-STAFF'), f)).rejects.toThrow(MSG_FORBIDDEN);
    const r = await adopsiReport(sql, od('ZZAD-OD'), f);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('laporan: sesi, jam, page view, dan cakupan fitur dihitung per (bulan, anggota)', async () => {
    // Fixture ber-stempel waktu sendiri, supaya bucket bulannya pasti.
    // Dua sesi pada 2026-07: (0,10,25 menit) lalu jeda 90 menit, (115,120).
    // Jam = (25-0) + (120-115) = 30 menit = 0,50 jam. Tiga menu berbeda.
    const at = (menit: number): string => new Date(Date.UTC(2026, 6, 15, 1, menit, 0)).toISOString();
    await sql`
      insert into page_views (employee_id, path, nav_href, nav_total, occurred_at) values
        (${EMP2}, '/', '/', 10, ${at(0)}),
        (${EMP2}, '/leads', '/leads', 10, ${at(10)}),
        (${EMP2}, '/leads/LEAD-1', null, 10, ${at(25)}),
        (${EMP2}, '/sales', '/sales', 10, ${at(115)}),
        (${EMP2}, '/sales', '/sales', 10, ${at(120)})`;

    const r = await adopsiReport(sql, director('ZZAD-DIR'), { from: '2026-07', to: '2026-07' });
    const row = r.rows.find((x) => x.employeeId === EMP2);
    expect(row).toBeDefined();
    expect(row!.period).toBe('202607');
    expect(row!.sesi).toBe(2);
    expect(row!.jam).toBe('0.50');
    expect(row!.pageView).toBe(5);
    // `/leads/LEAD-1` ber-nav_href NULL: rute dalam, bukan entri menu — jadi
    // ia dihitung sebagai page view tapi BUKAN sebagai fitur.
    expect(row!.fiturDibuka).toBe(3);
    expect(row!.fiturTersedia).toBe(10);
    expect(row!.cakupanFiturPct).toBe(30);
    // Roster HISTORIS: namanya terisi dari `private.employee_roster()`.
    expect(row!.nama).not.toBe(EMP2);
    expect(row!.role).toContain('·');
  });

  it('filter bulan mempersempit, dan `mulaiTercatat` TETAP menunjuk baris paling awal yang ada', async () => {
    // `mulaiTercatat` sengaja TIDAK ikut difilter: gunanya justru menyatakan
    // sejak kapan pencatatan ADA, supaya bulan kosong tidak terbaca sebagai
    // "tidak ada yang memakai sistem".
    const r = await adopsiReport(sql, director('ZZAD-DIR'), { from: '2026-07', to: '2026-07' });
    expect(r.rows.every((x) => x.period === '202607')).toBe(true);
    expect(r.mulaiTercatat).not.toBeNull();
    const kosong = await adopsiReport(sql, director('ZZAD-DIR'), { from: '2020-01', to: '2020-01' });
    expect(kosong.rows).toEqual([]);
    expect(kosong.mulaiTercatat).toBe(r.mulaiTercatat);
  });

  it('cakupan fitur memakai penyebut TERBESAR bulan itu — menu yang hanya ada separuh bulan tetap menu', async () => {
    const at = (hari: number): string => new Date(Date.UTC(2026, 4, hari, 3, 0, 0)).toISOString();
    await sql`
      insert into page_views (employee_id, path, nav_href, nav_total, occurred_at) values
        (${EMP2}, '/a', '/a', 4, ${at(3)}),
        (${EMP2}, '/b', '/b', 8, ${at(20)})`;
    const r = await adopsiReport(sql, director('ZZAD-DIR'), { from: '2026-05', to: '2026-05' });
    const row = r.rows.find((x) => x.employeeId === EMP2)!;
    expect(row.fiturTersedia).toBe(8); // bukan 4, dan bukan "yang terakhir"
    expect(row.fiturDibuka).toBe(2);
    expect(row.cakupanFiturPct).toBe(25);
  });

  it('dihitung ulang dua kali menghasilkan hasil yang byte-identik (aturan rumah #4)', async () => {
    const f = { from: null, to: null };
    const a = await adopsiReport(sql, director('ZZAD-DIR'), f);
    const b = await adopsiReport(sql, director('ZZAD-DIR'), f);
    expect(b).toEqual(a);
  });
});
