/**
 * M19 separuh SCS — cakupan BACA baris pekerjaan, ditegakkan RLS.
 *
 * ## KENAPA BERKAS SENDIRI
 *
 * `scs.test.ts` memakai koneksi service-role (BYPASSRLS), jadi hijaunya TIDAK
 * membuktikan apa pun soal visibilitas. Ia buta terhadap kombinasi "predikat TS
 * meloloskan, RLS mengosongkan" — yang di UI terbaca sebagai **"belum ada
 * datanya"**, bukan sebagai 403, dan karena itu tidak pernah dilaporkan sebagai
 * bug izin. Pola `dailyops-scope.rls.test.ts` dan `storeops-sku.rls.test.ts`.
 *
 * ## SATU BARIS YANG PERILAKUNYA KHUSUS DI SINI
 *
 * Baris "all client" (`client_id IS NULL`) harus terlihat oleh orang yang sama
 * dengan baris ber-klien. Kalau policy-nya pernah memakai
 * `private.jwt_division_owns_client(client_id)`, predikat itu mengembalikan
 * **NULL** untuk baris tanpa klien — dan NULL bukan true, sehingga baris yang
 * justru paling penting bagi SMO menghilang dari semua orang tanpa satu pun
 * galat. Tes `baris all client` di bawah memaku ketiadaan mode gagal itu.
 *
 * ## SATU LENGAN YANG SENGAJA TIDAK ADA
 *
 * NOL lengan `mendukung_divisi`. Sebuah baris SCS boleh MENDUKUNG divisi Ads,
 * dan lead Ads tetap TIDAK boleh membacanya: yang dibutuhkan divisi lain adalah
 * pekerjaannya sendiri, dan izin "boleh baca karena dibantu" tidak pernah
 * diketok siapa pun.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZSR-`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { permission } from '@cdps/core';
import { queueScsTasks, scsPicSummary, type Actor } from './scs';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const PIC = 'EMP-ZSR-PIC';
const PIC_LAIN = 'EMP-ZSR-PIC2';
const LEAD = 'EMP-ZSR-LEAD';
const AM = 'EMP-ZSR-AM';

const CLI = 'CLI-ZSR-0001';
const T_PIC = 'SCS-ZSR-0001';        // ber-klien, milik PIC
const T_LAIN = 'SCS-ZSR-0002';       // ber-klien, milik PIC_LAIN
const T_ALL = 'SCS-ZSR-0003';        // "all client" — client_id NULL, milik PIC
const SEMUA = [T_PIC, T_LAIN, T_ALL];

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
    tx<{ id: string }[]>`select id from scs_tasks where id like 'SCS-ZSR-%' order by id`,
  );
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('Creative', 'SMO ZSR', 'Creative', 'staff', 'ZSR-TEST')
    on conflict do nothing`;
  for (const [id, divisi] of [
    [PIC, 'Creative'], [PIC_LAIN, 'Creative'], [LEAD, 'Creative'], [AM, 'Account'],
  ] as const) {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${id}, ${'Nama ' + id}, ${id + '@mea.test'}, ${divisi}, 'SMO ZSR', true, 'ZSR-TEST')
      on conflict (employee_id) do nothing`;
  }
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${CLI}, 'PIC', 'Toko ZSR', 'Bandung', 'link', 'Fashion', '0', '0', '0',
      ${AM}, ${AM}, now(), ${AM}, 'ZSR-TEST')
    on conflict (id) do nothing`;
  // Ketiganya DIBUAT oleh LEAD, supaya lengan `created_by` tidak jadi
  // satu-satunya alasan sebuah baris terlihat — kalau ia satu-satunya, tes
  // "lead melihat semuanya" hijau palsu.
  //
  // Baris ketiga MENDUKUNG divisi Ads sekaligus ber-client_id NULL: ia satu
  // baris yang menguji dua mode gagal sekaligus.
  for (const [id, pic, cli, dukung] of [
    [T_PIC, PIC, CLI, null],
    [T_LAIN, PIC_LAIN, CLI, null],
    [T_ALL, PIC, null, 'ADS'],
  ] as const) {
    await sql`
      insert into scs_tasks (id, tanggal, kategori_kode, judul, client_id, mendukung_divisi,
                             assigned_pic, target_qty, created_by)
      values (${id}, '2026-09-10', 'BRIEF', ${'Baris ' + id}, ${cli}, ${dukung},
              ${pic}, 1, ${LEAD})
      on conflict (id) do nothing`;
  }
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from scs_tasks where id like 'SCS-ZSR-%'`;
  await sql`delete from clients where id like 'CLI-ZSR-%'`;
  await sql`delete from employees where employee_id like 'EMP-ZSR-%'`;
  await sql`delete from role_mappings where created_by = 'ZSR-TEST'`;
  await sql.end();
});

dDb('scs_tasks_select — cakupan baca antrean', () => {
  it('Director melihat semua', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZSR-X', director: true })).toEqual(SEMUA);
  });

  it('OD melihat semua (read-only everywhere, Phase 0 §4)', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZSR-X', od: true })).toEqual(SEMUA);
  });

  it('lead Creative melihat SELURUH divisinya — termasuk baris yang bukan miliknya', async () => {
    expect(await terlihat({ employeeId: LEAD, division: 'Creative', level: 'lead' }))
      .toEqual(SEMUA);
  });

  it('staff Creative melihat HANYA barisnya sendiri', async () => {
    expect(await terlihat({ employeeId: PIC, division: 'Creative', level: 'staff' }))
      .toEqual([T_PIC, T_ALL]);
    expect(await terlihat({ employeeId: PIC_LAIN, division: 'Creative', level: 'staff' }))
      .toEqual([T_LAIN]);
  });

  it('baris "all client" (client_id NULL) terlihat SAMA seperti baris ber-klien', async () => {
    // Mode gagal yang dicegah: `private.jwt_division_owns_client(client_id)`
    // mengembalikan NULL untuk baris tanpa klien, dan NULL bukan true — baris
    // yang paling penting bagi SMO akan hilang dari SEMUA orang, tanpa galat.
    for (const c of [
      { employeeId: 'EMP-ZSR-X', director: true },
      { employeeId: 'EMP-ZSR-X', od: true },
      { employeeId: LEAD, division: 'Creative', level: 'lead' },
      { employeeId: PIC, division: 'Creative', level: 'staff' },
    ]) {
      expect(await terlihat(c), JSON.stringify(c)).toContain(T_ALL);
    }
  });

  it('lead divisi LAIN melihat NOL — walau salah satu baris MENDUKUNG divisinya', async () => {
    // `T_ALL` ber-`mendukung_divisi = 'ADS'`. Lead Ads tetap nol: izin "boleh
    // baca karena dibantu" tidak pernah diketok siapa pun, dan yang dibutuhkan
    // divisi Ads adalah pekerjaannya sendiri.
    expect(await terlihat({ employeeId: 'EMP-ZSR-ADS', division: 'Ads', level: 'lead' }))
      .toEqual([]);
  });

  it('AM pemilik klien melihat NOL — lengan AM sengaja TIDAK ADA (PRD §13.3)', async () => {
    expect(await terlihat({ employeeId: AM, division: 'Account', level: 'staff' })).toEqual([]);
    expect(await terlihat({ employeeId: AM, division: 'Account', level: 'lead' })).toEqual([]);
  });

  it('pembuatnya melihat barisnya walau bukan PIC-nya', async () => {
    // LEAD membuat ketiganya; klaimnya DITURUNKAN ke staff supaya yang diuji
    // benar-benar lengan `created_by`, bukan lengan lead.
    expect(await terlihat({ employeeId: LEAD, division: 'Creative', level: 'staff' }))
      .toEqual(SEMUA);
  });

  it('karyawan tanpa klaim sama sekali melihat NOL', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZSR-HANTU' })).toEqual([]);
  });
});

dDb('scs_kategori_select — referensi yang memang dibaca semua orang', () => {
  it('siapa pun yang login melihat taksonomi Kategori', async () => {
    // Kalau lengan lead/divisi ditambahkan ke sini, filter Kategori di layar
    // antrean jadi KOSONG bagi orang yang berhak melihatnya — tanpa galat. Ia
    // ada di ledger O48 dengan alasan tertulis, bukan supaya tes hijau.
    const rows = await withClaims(
      sql, claims({ employeeId: PIC, division: 'Creative', level: 'staff' }),
      (tx) => tx<{ kode: string }[]>`select kode from scs_kategori order by urutan`,
    );
    expect(rows.map((r) => r.kode))
      .toEqual(['SCRIPT', 'BRIEF', 'UPLOAD_CHECKLIST', 'KOORDINASI']);
  });
});

dDb('invariant DB yang tidak bisa dibuktikan dari TS', () => {
  it('kedua tabel punya GRANT SELECT ke `authenticated`', async () => {
    // Tanpa grant ini `readAsActor` gagal "permission denied" SEBELUM satu
    // policy pun dievaluasi — halaman 500, bukan daftar kosong. Tabel yang
    // lahir sesudah `20260723064438_rls_baseline.sql` tidak tersentuh
    // grant-loop di sana, jadi ini harus eksplisit per tabel.
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.role_table_grants
       where grantee = 'authenticated' and privilege_type = 'SELECT'
         and table_schema = 'public'
         and table_name in ('scs_tasks', 'scs_kategori')
       order by table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(['scs_kategori', 'scs_tasks']);
  });

  it('`anon` tidak punya satu pun hak di kedua tabel', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select distinct table_name from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'
         and table_name in ('scs_tasks', 'scs_kategori')`;
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it('kedua tabel ber-RLS aktif, dan NOL write policy', async () => {
    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('scs_tasks', 'scs_kategori')
       order by c.relname`;
    expect(rls.map((r) => r.relrowsecurity)).toEqual([true, true]);
    // Jalur tulis CDPS berjalan service-role; sebuah write policy di sini akan
    // membuka jalur tulis KEDUA yang melewati seluruh gerbang domain.
    const tulis = await sql<{ polname: string }[]>`
      select p.polname from pg_policy p
        join pg_class c on c.oid = p.polrelid
       where c.relname in ('scs_tasks', 'scs_kategori') and p.polcmd <> 'r'`;
    expect(tulis.map((r) => r.polname)).toEqual([]);
  });

  it('audit_log baris SCS menolak UPDATE dari koneksi PALING berwenang yang ada', async () => {
    // Aturan rumah #3. Diuji dari service-role dengan sengaja: gerbang domain
    // tidak membuktikan apa pun tentang jalur tulis yang tidak melewatinya.
    await sql`
      insert into scs_tasks (id, tanggal, kategori_kode, judul, assigned_pic, target_qty, created_by)
      values ('SCS-ZSR-9001', '2026-09-10', 'BRIEF', 'Jejak', ${PIC}, 1, ${LEAD})
      on conflict (id) do nothing`;
    await sql`
      insert into audit_log (entity_type, entity_id, actor_employee_id, action, after_json, created_by)
      values ('scs_task', 'SCS-ZSR-9001', ${LEAD}, 'scs_created', '{}'::jsonb, ${LEAD})`;
    await expect(
      sql`update audit_log set action = 'diubah' where entity_id = 'SCS-ZSR-9001'`,
    ).rejects.toThrow(/append-only|immutable/i);
    await sql`delete from scs_tasks where id = 'SCS-ZSR-9001'`;
  });
});

dDb('nama klien & nama PIC — resolver, BUKAN `left join` (OBS UAT 2026-09-09)', () => {
  /**
   * Cermin `dailyops-scope.rls.test.ts`. `TASK_FROM` dulu memakai
   * `left join clients` + `left join employees`, dan di bawah `readAsActor`
   * RLS kedua tabel itu meng-NULL-kan kolom namanya untuk lead Creative —
   * layar lalu menampilkan `EMP-…`/`CLI-…`.
   *
   * ⚠️ `scs.test.ts` BYPASSRLS dan karena itu buta terhadap regresi ini.
   *
   * ⚠️ Butir kedua di bawah menjaga invariant M19 yang BERLAWANAN arah, dan ia
   * mudah dirusak justru saat "memperbaiki" yang pertama: baris "all client"
   * (`client_id` NULL) HARUS tetap ber-`clientName` kosong. `client_toko(NULL)`
   * mengembalikan NULL — kalau seseorang menggantinya dengan `coalesce(...,
   * client_id)` gaya `employee_display_name`, FE berhenti merender
   * "Semua klien" dan mulai merender sel kosong.
   */
  const leadActor = (): Actor => ({
    employeeId: LEAD,
    divisi: 'Creative',
    role: permission.makeRole({ division: 'Creative', level: 'lead' }),
  });
  const leadClaim = { employeeId: LEAD, division: 'Creative', level: 'lead' };
  const antrean = () =>
    withClaims(sql, claims(leadClaim), (tx) =>
      queueScsTasks(tx, leadActor(), {
        dariTanggal: '2026-09-10', sampaiTanggal: '2026-09-10',
        pic: null, kategoriKode: null, status: null,
      }));

  it('lead Creative mendapat NAMA klien & NAMA PIC pada baris ber-klien', async () => {
    const rows = (await antrean()).filter((r) => r.id.startsWith('SCS-ZSR-') && r.clientId !== null);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.clientName).toBe('Toko ZSR');
      expect(r.assignedPicNama).toBe('Nama ' + r.assignedPic);
      expect(r.assignedPicNama).not.toBe('');
    }
  });

  it('baris "all client" TETAP tanpa nama klien — `client_toko(NULL)` = NULL', async () => {
    const all = (await antrean()).find((r) => r.id === T_ALL);
    expect(all).toBeDefined();
    expect(all?.clientId).toBeNull();
    // `null`, BUKAN `''` — `toTaskRow` sengaja mempertahankan null di SCS
    // (`clientName: string | null`), berbeda dari dailyops yang memakai ''.
    // Null itulah yang dibaca FE sebagai "Semua klien".
    expect(all?.clientName).toBeNull();
    // PIC-nya tetap ber-nama: nol klien bukan alasan kehilangan nama orang.
    expect(all?.assignedPicNama).toBe('Nama ' + PIC);
  });

  it('rekap PIC ber-NAMA untuk lead', async () => {
    const rows = (await withClaims(sql, claims(leadClaim), (tx) =>
      scsPicSummary(tx, leadActor(), '2026-09-10', '2026-09-10')))
      .filter((r) => r.employeeId.startsWith('EMP-ZSR-'));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.nama).toBe('Nama ' + r.employeeId);
  });
});
