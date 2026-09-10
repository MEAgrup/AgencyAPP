/**
 * M19 — cakupan BACA slot produksi & ketidaktersediaan PIC, ditegakkan RLS.
 *
 * ## KENAPA BERKAS SENDIRI
 *
 * `dailyops.test.ts` memakai koneksi service-role (BYPASSRLS), jadi hijaunya
 * TIDAK membuktikan apa pun soal visibilitas. Ia buta terhadap kombinasi
 * "predikat TS meloloskan, RLS mengosongkan" — yang di UI terbaca sebagai
 * **"belum ada datanya"**, bukan sebagai 403, dan karena itu tidak pernah
 * dilaporkan sebagai bug izin. Pola `creative-asset-scope.rls.test.ts` dan
 * `storeops-sku.rls.test.ts`.
 *
 * Yang diuji: `prod_slots_select` dan `pic_unavailability_select` lewat
 * `withClaims` (`SET LOCAL ROLE authenticated` + klaim JWT sungguhan), plus
 * dua invariant DB yang tidak bisa dibuktikan dari TS:
 *   (a) `GRANT SELECT ... TO authenticated` benar-benar ada — tanpanya
 *       `readAsActor` gagal "permission denied" SEBELUM satu policy pun
 *       dievaluasi (bug yang dulu kena `client_milestones`);
 *   (b) `pic_unavailability` menolak UPDATE dari koneksi PALING berwenang yang
 *       ada, bukan cuma dari jalur domain.
 *
 * ## SATU LENGAN YANG SENGAJA TIDAK ADA
 *
 * NOL lengan AM. PRD §5.6 tidak memberi AM akses ke jadwal produksi, dan
 * `private.jwt_division_owns_client` (yang terlihat cocok) justru SALAH di sini:
 * ia true bila salah satu PIC KLIEN sedivisi dengan aktor — orang Sales/Account
 * — jadi untuk lead Creative ia selalu false. Tes `AM pemilik klien` di bawah
 * memaku ketiadaan lengan itu supaya ia tidak "ditambahkan karena kelihatannya
 * berguna" tanpa ketokan.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZDR-`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, withClaims, type Sql } from '@cdps/db';
import { permission } from '@cdps/core';
import { daySchedule, sameDaySummary, type Actor } from './dailyops';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const PIC = 'EMP-ZDR-PIC';
const PIC_LAIN = 'EMP-ZDR-PIC2';
const LEAD = 'EMP-ZDR-LEAD';
const AM = 'EMP-ZDR-AM';

const CLI = 'CLI-ZDR-0001';
const SLOT_PIC = 'SLOT-ZDR-0001';
const SLOT_LAIN = 'SLOT-ZDR-0002';
const SEMUA = [SLOT_PIC, SLOT_LAIN];

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

/** Slot `ZDR-` yang terlihat oleh sebuah claim set, terurut — kontraknya. */
async function slotTerlihat(claim: Claim): Promise<string[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tx<{ id: string }[]>`select id from prod_slots where id like 'SLOT-ZDR-%' order by id`,
  );
  return rows.map((r) => r.id);
}

/** Baris ketidaktersediaan `ZDR-` yang terlihat, terurut per employee_id. */
async function unavTerlihat(claim: Claim): Promise<string[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tx<{ employee_id: string }[]>`
      select employee_id from pic_unavailability
       where employee_id like 'EMP-ZDR-%' order by employee_id`,
  );
  return rows.map((r) => r.employee_id);
}

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('Creative', 'Videografer ZDR', 'Creative', 'staff', 'ZDR-TEST')
    on conflict do nothing`;
  for (const [id, divisi, jabatan] of [
    [PIC, 'Creative', 'Videografer ZDR'],
    [PIC_LAIN, 'Creative', 'Videografer ZDR'],
    [LEAD, 'Creative', 'Videografer ZDR'],
    [AM, 'Account', 'Videografer ZDR'],
  ] as const) {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${id}, ${'Nama ' + id}, ${id + '@mea.test'}, ${divisi}, ${jabatan}, true, 'ZDR-TEST')
      on conflict (employee_id) do nothing`;
  }
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${CLI}, 'PIC', 'Toko ZDR', 'Bandung', 'link', 'Fashion', '0', '0', '0',
      ${AM}, ${AM}, now(), ${AM}, 'ZDR-TEST')
    on conflict (id) do nothing`;
  // Dua slot: satu milik PIC, satu milik PIC_LAIN. Keduanya DIBUAT oleh LEAD,
  // supaya lengan `created_by` tidak jadi satu-satunya alasan sebuah baris
  // terlihat — kalau ia satu-satunya, tes "lead melihat keduanya" hijau palsu.
  for (const [id, pic] of [[SLOT_PIC, PIC], [SLOT_LAIN, PIC_LAIN]] as const) {
    await sql`
      insert into prod_slots (id, tanggal, client_id, studio_code, waktu_mulai, waktu_selesai,
                              assigned_pic, task_type, target_qty, created_by)
      values (${id}, '2026-09-10', ${CLI}, 'KASUARI', '09:00', '12:00', ${pic}, 'Shoot', 10, ${LEAD})
      on conflict (id) do nothing`;
  }
  for (const pic of [PIC, PIC_LAIN]) {
    await sql`
      insert into pic_unavailability (employee_id, tanggal_mulai, tanggal_selesai, alasan, dicatat_oleh)
      values (${pic}, '2026-09-10', '2026-09-10', 'Cuti', ${LEAD})`;
  }
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from prod_slots where id like 'SLOT-ZDR-%'`;
  await sql`delete from pic_unavailability where employee_id like 'EMP-ZDR-%'`;
  await sql`delete from clients where id like 'CLI-ZDR-%'`;
  await sql`delete from employees where employee_id like 'EMP-ZDR-%'`;
  await sql`delete from role_mappings where created_by = 'ZDR-TEST'`;
  await sql.end();
});

dDb('prod_slots_select — cakupan baca jadwal produksi', () => {
  it('Director melihat semua', async () => {
    expect(await slotTerlihat({ employeeId: 'EMP-ZDR-X', director: true })).toEqual(SEMUA);
  });

  it('OD melihat semua (read-only everywhere, Phase 0 §4)', async () => {
    expect(await slotTerlihat({ employeeId: 'EMP-ZDR-X', od: true })).toEqual(SEMUA);
  });

  it('lead Creative melihat SELURUH divisinya — termasuk slot yang bukan miliknya', async () => {
    // Ini lengan yang paling mudah salah: `private.jwt_division_owns_client`
    // akan mengosongkan daftar ini SEPENUHNYA (ia mencocokkan PIC klien, yang
    // orang Sales/Account), jadi Leader Video tidak melihat jadwalnya sendiri.
    expect(await slotTerlihat({ employeeId: LEAD, division: 'Creative', level: 'lead' }))
      .toEqual(SEMUA);
  });

  it('staff Creative melihat HANYA barisnya sendiri', async () => {
    expect(await slotTerlihat({ employeeId: PIC, division: 'Creative', level: 'staff' }))
      .toEqual([SLOT_PIC]);
    expect(await slotTerlihat({ employeeId: PIC_LAIN, division: 'Creative', level: 'staff' }))
      .toEqual([SLOT_LAIN]);
  });

  it('lead divisi LAIN melihat NOL — jadwal produksi Creative bukan urusannya', async () => {
    expect(await slotTerlihat({ employeeId: 'EMP-ZDR-ADS', division: 'Ads', level: 'lead' }))
      .toEqual([]);
  });

  it('AM pemilik klien melihat NOL — lengan AM sengaja TIDAK ADA (PRD §5.6)', async () => {
    // Kedua slot ini milik kliennya, dan ia AM-nya. Tetap nol, dan itu memang
    // ketokannya: menambahkan lengan AM "karena kelihatannya berguna" adalah
    // menciptakan izin yang tidak pernah diketok siapa pun.
    expect(await slotTerlihat({ employeeId: AM, division: 'Account', level: 'staff' })).toEqual([]);
    expect(await slotTerlihat({ employeeId: AM, division: 'Account', level: 'lead' })).toEqual([]);
  });

  it('pembuatnya melihat barisnya walau bukan PIC-nya', async () => {
    // LEAD membuat keduanya; di sini klaimnya DITURUNKAN ke staff supaya yang
    // diuji benar-benar lengan `created_by`, bukan lengan lead.
    expect(await slotTerlihat({ employeeId: LEAD, division: 'Creative', level: 'staff' }))
      .toEqual(SEMUA);
  });

  it('karyawan tanpa klaim sama sekali melihat NOL', async () => {
    expect(await slotTerlihat({ employeeId: 'EMP-ZDR-HANTU' })).toEqual([]);
  });
});

dDb('pic_unavailability_select — cakupan baca ketidaktersediaan', () => {
  it('Director dan OD melihat semua', async () => {
    expect(await unavTerlihat({ employeeId: 'EMP-ZDR-X', director: true })).toEqual([PIC, PIC_LAIN]);
    expect(await unavTerlihat({ employeeId: 'EMP-ZDR-X', od: true })).toEqual([PIC, PIC_LAIN]);
  });

  it('lead Creative melihat seluruh divisinya', async () => {
    expect(await unavTerlihat({ employeeId: LEAD, division: 'Creative', level: 'lead' }))
      .toEqual([PIC, PIC_LAIN]);
  });

  it('staff melihat catatannya SENDIRI — bukan catatan cuti rekannya', async () => {
    // Batas privasi yang nyata: "Ramdani sakit" bukan informasi yang setiap
    // videografer perlu tahu tentang rekannya.
    expect(await unavTerlihat({ employeeId: PIC, division: 'Creative', level: 'staff' }))
      .toEqual([PIC]);
  });

  it('divisi lain melihat NOL', async () => {
    expect(await unavTerlihat({ employeeId: 'EMP-ZDR-ADS', division: 'Ads', level: 'lead' }))
      .toEqual([]);
    expect(await unavTerlihat({ employeeId: AM, division: 'Account', level: 'lead' })).toEqual([]);
  });
});

dDb('studios_select — referensi yang memang dibaca semua orang', () => {
  it('siapa pun yang login melihat keempat studio', async () => {
    // Kalau lengan lead/divisi ditambahkan ke sini, grid jadwal akan KOSONG
    // bagi orang yang berhak melihatnya — tanpa galat. Ia ada di ledger O48
    // dengan alasan tertulis, bukan supaya tes hijau.
    const rows = await withClaims(sql, claims({ employeeId: PIC, division: 'Creative', level: 'staff' }),
      (tx) => tx<{ code: string }[]>`select code from studios order by urutan`);
    expect(rows.map((r) => r.code)).toEqual(['KASUARI', 'RAJAWALI', 'CEMPAKA', 'LUAR_KANTOR']);
  });
});

dDb('invariant DB yang tidak bisa dibuktikan dari TS', () => {
  it('ketiga tabel punya GRANT SELECT ke `authenticated`', async () => {
    // Tanpa grant ini `readAsActor` gagal "permission denied" SEBELUM satu
    // policy pun dievaluasi — halaman 500, bukan daftar kosong. Tabel yang
    // lahir sesudah `20260723064438_rls_baseline.sql` tidak tersentuh
    // grant-loop di sana, jadi ini harus eksplisit per tabel.
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.role_table_grants
       where grantee = 'authenticated' and privilege_type = 'SELECT'
         and table_schema = 'public'
         and table_name in ('prod_slots', 'pic_unavailability', 'studios')
       order by table_name`;
    expect(rows.map((r) => r.table_name))
      .toEqual(['pic_unavailability', 'prod_slots', 'studios']);
  });

  it('ketiga tabel ber-RLS aktif', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('prod_slots', 'pic_unavailability', 'studios')
       order by c.relname`;
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    expect(rows.length).toBe(3);
  });

  it('NOL policy tulis — jalur tulis service-role, bukan RLS', async () => {
    const rows = await sql<{ polname: string }[]>`
      select p.polname
        from pg_policy p join pg_class c on c.oid = p.polrelid
       where c.relname in ('prod_slots', 'pic_unavailability', 'studios')
         and p.polcmd not in ('r', '*')`;
    expect(rows).toEqual([]);
  });

  it('`pic_unavailability` menolak UPDATE bahkan dari koneksi service-role', async () => {
    // Ditulis dari jalur PALING istimewa yang ada di sistem. Kalau dindingnya
    // ada di TS saja, tes ini hijau palsu.
    await expect(
      sql`update pic_unavailability set alasan = 'Sakit' where employee_id = ${PIC}`,
    ).rejects.toThrow(/append-only|immutable/i);
  });

  it('`prod_slots` menolak actual_qty > target_qty dari service-role', async () => {
    // Gerbangnya DUA kali: pesan BI dari domain, penolakan dari DB. Jalur tulis
    // kedua yang muncul belakangan tetap tertolak.
    await expect(
      sql`update prod_slots set actual_qty = 999 where id = ${SLOT_PIC}`,
    ).rejects.toThrow();
  });

  it('`prod_slots` menolak target_qty <= 0 dan rentang waktu terbalik', async () => {
    await expect(
      sql`update prod_slots set target_qty = 0 where id = ${SLOT_PIC}`,
    ).rejects.toThrow();
    await expect(
      sql`update prod_slots set waktu_selesai = '08:00' where id = ${SLOT_PIC}`,
    ).rejects.toThrow();
  });
});

dDb('nama klien & nama PIC — resolver, BUKAN `left join` (OBS UAT 2026-09-09)', () => {
  /**
   * REGRESI YANG DIJAGA DI SINI, dan kenapa ia butuh `withClaims`.
   *
   * `SLOT_COLS` dulu memakai `left join clients` + `left join employees`. Di
   * bawah `readAsActor`, RLS kedua tabel itu memutuskan apakah join-nya
   * menghasilkan baris — dan lead Creative tidak memenuhi satu lengan pun
   * (`employees_select` = read-all / diri sendiri / created_by; `clients_select`
   * nol lengan Creative). `LEFT JOIN` tidak membuang barisnya, ia MENG-NULL-KAN
   * kolomnya, jadi layar jatuh ke `CLI-…`/`EMP-…` untuk peran yang justru
   * paling memakai layar jadwal.
   *
   * ⚠️ `dailyops.test.ts` TIDAK BISA menangkap ini: koneksinya BYPASSRLS, jadi
   * join mentah pun hijau di sana. Hanya jalur `withClaims` di bawah yang
   * membedakan resolver dari join.
   *
   * ⚠️ Cacatnya juga TIDAK terlihat oleh Director/OD — keduanya lolos
   * `jwt_can_read_all()`. Karena itu asersi yang menentukan adalah yang
   * memakai klaim LEAD, bukan Director.
   */
  const leadActor = (): Actor => ({
    employeeId: LEAD,
    divisi: 'Creative',
    role: permission.makeRole({ division: 'Creative', level: 'lead' }),
  });

  it('lead Creative mendapat NAMA klien & NAMA PIC, bukan id mentah', async () => {
    const hari = await withClaims(sql, claims({ employeeId: LEAD, division: 'Creative', level: 'lead' }),
      (tx) => daySchedule(tx, leadActor(), '2026-09-10'));

    const slots = hari.studios.flatMap((st) => st.slots).filter((sl) => sl.id.startsWith('SLOT-ZDR-'));
    expect(slots.length).toBe(2);
    for (const sl of slots) {
      expect(sl.clientName).toBe('Toko ZDR');
      expect(sl.assignedPicNama).toBe('Nama ' + sl.assignedPic);
      // Yang PERSIS terjadi sebelum perbaikan: string kosong, lalu FE jatuh ke id.
      expect(sl.assignedPicNama).not.toBe('');
      expect(sl.clientName).not.toBe('');
    }
  });

  it('blok "tidak tersedia" juga ber-NAMA untuk lead', async () => {
    const hari = await withClaims(sql, claims({ employeeId: LEAD, division: 'Creative', level: 'lead' }),
      (tx) => daySchedule(tx, leadActor(), '2026-09-10'));
    const kita = hari.tidakTersedia.filter((u) => u.employeeId.startsWith('EMP-ZDR-'));
    expect(kita.length).toBeGreaterThan(0);
    for (const u of kita) expect(u.employeeNama).toBe('Nama ' + u.employeeId);
  });

  it('rekap penyelesaian hari-sama ber-NAMA untuk lead', async () => {
    const rows = (await withClaims(sql, claims({ employeeId: LEAD, division: 'Creative', level: 'lead' }),
      (tx) => sameDaySummary(tx, leadActor(), '2026-09-10', '2026-09-10')))
      .filter((r) => r.employeeId.startsWith('EMP-ZDR-'));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.nama).toBe('Nama ' + r.employeeId);
  });
});
