/**
 * Tes tutup buku bulanan (D-3).
 *
 * Yang diuji di sini bukan "fungsinya jalan", melainkan lima hal yang kalau
 * salah baru ketahuan sesudah ada yang menutup buku dan angkanya tidak bisa
 * diperbaiki lagi:
 *
 *   1. **Bulan tertutup DIBACA DARI ANGKA BEKU.** Buktinya bukan komentar:
 *      sesudah bulan ditutup, data mentahnya DIUBAH (satu void baru, lewat
 *      pintu sungguhan) dan laporan bulan itu harus tetap menyebut angka yang
 *      sama persis. Kalau ia menghitung ulang, tes ini merah.
 *   2. **Tidak ada jalan buka kembali** — bukan hanya "tidak ada fungsinya",
 *      tapi DB-nya menolak: `UPDATE` dan `DELETE` atas baris yang tertutup
 *      ditolak trigger, dan mesin statusnya tidak punya edge keluar.
 *   3. **Satu peran yang berwenang.** Finance staff — orang yang mengisi
 *      angkanya sehari-hari — tidak boleh menutup.
 *   4. **Koreksi hanya lewat jurnal, di bulan berjalan, atas bulan tertutup.**
 *      Ketiga arah salahnya diuji: bulan target belum tutup, bulan pencatatan
 *      sudah tutup, dan arah waktunya terbalik.
 *   5. **Angka bulan tertutup TIDAK bergerak karena koreksi.** Koreksi masuk ke
 *      total bulan BERJALAN; bulan yang dikoreksi tetap menyebut angka bekunya
 *      dan menampilkan koreksinya sebagai `dikoreksiOleh`.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { money, permission, statemachine, tz } from '@cdps/core';
import { createClient, executors, type Sql } from '@cdps/db';
import { leads, sales } from './index';
import { jadwalLayanan, nilaiBulan } from './accrual';
import { approveHold, requestHold, resumeService } from './client';
import {
  canCatatKoreksi,
  canTutupBuku,
  catatKoreksi,
  ConflictError,
  ForbiddenError,
  laporanBulan,
  MSG_BULAN_BELUM_BERAKHIR,
  MSG_KOREKSI_BULAN_SUDAH_TUTUP,
  MSG_KOREKSI_DENIED,
  MSG_KOREKSI_NILAI_NOL,
  MSG_KOREKSI_TARGET_BELUM_TUTUP,
  MSG_SUDAH_DITUTUP,
  MSG_TUTUP_DENIED,
  MSG_TUTUP_TIDAK_BERURUTAN,
  periode,
  PERIODE_DITUTUP,
  tutupBulan,
  ValidationError,
  type Actor,
} from './tutupbuku';

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const accountLead = (): Actor => ({
  employeeId: 'ZZ-ALEAD', role: permission.makeRole({ division: 'Account', level: 'lead' }),
});
const financeStaff = (): Actor => ({
  employeeId: 'ZZ-FIN', role: permission.makeRole({ division: 'Finance', level: 'staff' }),
});
const financeLead = (): Actor => ({
  employeeId: 'ZZ-FLEAD', role: permission.makeRole({ division: 'Finance', level: 'lead' }),
});
const od = (): Actor => ({ employeeId: 'ZZ-OD', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZZ-DIR', role: permission.makeRole({ director: true }) });

// ---------------------------------------------------------------------------
// Unit: gerbang peran.
// ---------------------------------------------------------------------------
describe('gerbang peran', () => {
  it('menutup buku: Head of Finance atau Director SAJA', () => {
    expect(canTutupBuku(financeLead())).toBe(true);
    expect(canTutupBuku(director())).toBe(true);
    // Finance staff mengisi angkanya; ia tidak menutupnya. Penutupan adalah
    // penulisan paling tidak bisa dibatalkan di sistem ini.
    expect(canTutupBuku(financeStaff())).toBe(false);
    // OD membaca segalanya dan menulis NOL (Role Matrix Fase 0 §4).
    expect(canTutupBuku(od())).toBe(false);
    expect(canTutupBuku(accountLead())).toBe(false);
    expect(canTutupBuku(budi())).toBe(false);
  });

  it('mencatat koreksi: Finance segala level atau Director — tetap bukan OD', () => {
    expect(canCatatKoreksi(financeStaff())).toBe(true);
    expect(canCatatKoreksi(financeLead())).toBe(true);
    expect(canCatatKoreksi(director())).toBe(true);
    expect(canCatatKoreksi(od())).toBe(false);
    expect(canCatatKoreksi(accountLead())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration (real Postgres).
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

const HARI_INI = tz.dateString(new Date());
const BULAN_INI = HARI_INI.slice(0, 7);
/** Bulan lampau yang boleh ditutup (bulan berjalan tidak boleh — belum berakhir). */
const BULAN_LALU = tz.addMonthsToDate(`${BULAN_INI}-01`, -1).slice(0, 7);
const DUA_BULAN_LALU = tz.addMonthsToDate(`${BULAN_INI}-01`, -2).slice(0, 7);

let seq = 0;
const uniquePhone = (): string => `0819${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;
const uniqueMsv = (): string => `SVC-ZZ-TB-${seq++}`;

/**
 * layananJalan menutup satu klien lewat pipeline sungguhan, menjalankan
 * layanannya ke `[In Execution]` lewat mesin status sungguhan, lalu MEMUNDURKAN
 * hari mulainya ke `mulai` dengan satu baris audit bertanggal lampau yang
 * `action`-nya dikutip dari baris yang mesin itu tulis sendiri.
 *
 * Pemunduran itu satu-satunya cara menguji bulan LAMPAU: `audit_log` menolak
 * UPDATE, dan `now()` selalu hari ini.
 */
async function layananJalan(mulai: string, durasiBulan = 6, harga = '31000000.00'): Promise<{ clientId: string; serviceId: string }> {
  const msvId = uniqueMsv();
  await sql`insert into master_services (id, created_by) values (${msvId}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from,
       pricing_mode, durasi_bulan, qty_menambah, pengakuan, created_by)
    values (${msvId}, 1, ${'Svc ' + msvId}, ${harga}, '10% of standard price', true, '2020-01-01',
       'flat', ${durasiBulan}, 'volume', 'per_periode', 'ZZ-ADMIN')`;

  const { attempt } = await leads.register(sql, budi(), { leadName: 'Alpha Digital', phoneNumber: uniquePhone() });
  await sales.markContacted(sql, budi(), attempt.id);
  await sales.submitQualifiedForm(sql, budi(), attempt.id, {
    namaPic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta', linkToko: 'https://shopee/alpha',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [{ masterServiceId: msvId, quantity: 1 }],
  });
  await sales.submitNegotiation(sql, budi(), attempt.id, [], true);
  const res = await sales.close(sql, budi(), attempt.id, {
    parties: { primarySalespersonId: 'ZZ-BUDI', allocations: [{ salespersonId: 'ZZ-BUDI', basisPoints: 10000 }] },
    paymentScheme: sales.PAYMENT_SCHEME_LUNAS,
  });
  await sql`update clients set assigned_am_id = 'ZZ-AM' where id = ${res.clientId}`;
  const svc = await sql<{ id: string }[]>`
    select id from services where client_id = ${res.clientId} order by id limit 1`;
  const serviceId = svc[0].id;

  const ex = executors(sql);
  for (const to of ['[Briefed]', '[In Execution]']) {
    const r = await statemachine.transition(ex.sm, {
      machine: 'service', entityType: 'service', table: 'services', entityId: serviceId, to, actor: accountLead(),
    });
    expect(r.ok, `transisi ke ${to} ditolak: ${JSON.stringify(r)}`).toBe(true);
  }
  await suntikTransisi(serviceId, '->[In Execution]', mulai);
  return { clientId: res.clientId, serviceId };
}

/**
 * suntikTransisi menyisipkan SATU baris audit transisi bertanggal lampau,
 * dengan `action` yang DIBACA ULANG dari baris yang mesin status tulis sendiri.
 *
 * Ia ada karena `audit_log` menolak UPDATE (jadi tanggal baris yang sudah ada
 * tidak bisa digeser) dan `now()` selalu hari ini. Karena `action`-nya dikutip
 * dari mesinnya, tes yang memakainya tetap merah kalau format string transisi
 * berubah — bukan diam-diam berhenti menguji apa pun.
 */
async function suntikTransisi(serviceId: string, akhiran: string, tanggal: string): Promise<void> {
  const rows = await sql<{ action: string }[]>`
    select action from audit_log
     where entity_type = 'service' and entity_id = ${serviceId}
       and action like ${'%' + akhiran}
     order by id asc limit 1`;
  expect(rows.length, `mesin status belum pernah menulis transisi ${akhiran}`).toBe(1);
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
    values ('service', ${serviceId}, 'ZZ-ALEAD', ${rows[0].action}, ${`${tanggal}T03:00:00Z`}, 'ZZ-ALEAD')`;
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  // Baris yang diuji berkas ini SENGAJA tidak bisa dihapus lewat jalur normal:
  // bulan tertutup menolak DELETE, dan angka beku + jurnal koreksi append-only.
  // Itu justru yang diuji di atas — jadi teardown-nya menonaktifkan trigger
  // dengan `session_replication_role = replica` DI DALAM SATU TRANSAKSI
  // (`SET LOCAL`), yang membuatnya berlaku hanya untuk koneksi ini dan hanya
  // selama transaksi ini.
  //
  // `ALTER TABLE ... DISABLE TRIGGER` sengaja TIDAK dipakai: ia mengubah skema
  // untuk SEMUA koneksi, dan vitest menjalankan berkas tes secara paralel —
  // artinya jendela beberapa milidetik di mana invariant kekekalan tabel ini
  // mati untuk seluruh suite. Sebuah teardown tidak boleh bisa membuat tes
  // orang lain hijau karena alasan yang salah.
  await sql.begin(async (tx) => {
    await tx.unsafe('set local session_replication_role = replica');
    await tx`delete from jurnal_koreksi where created_by like 'ZZ-%'`;
    await tx`delete from periode_buku_baris where created_by like 'ZZ-%'`;
    await tx`delete from periode_buku where created_by like 'ZZ-%'`;
  });

  await sql`delete from briefs where created_by like 'ZZ-%'`;
  await sql`delete from payment_verifications where created_by like 'ZZ-%'`;
  await sql`delete from installments where created_by like 'ZZ-%'`;
  await sql`delete from transactions where created_by like 'ZZ-%'`;
  await sql`delete from services where created_by like 'ZZ-%'`;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from client_sales_allocations where created_by like 'ZZ-%'`;
  await sql`delete from contracts where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposal_lines where created_by like 'ZZ-%'`;
  await sql`delete from negotiation_proposals where created_by like 'ZZ-%'`;
  await sql`delete from qualified_form_services where created_by like 'ZZ-%'`;
  await sql`delete from qualified_forms where created_by like 'ZZ-%'`;
  await sql`delete from prospect_attempts where created_by like 'ZZ-%'`;
  await sql`delete from leads where created_by like 'ZZ-%'`;
  await sql`delete from master_service_versions where created_by like 'ZZ-%'`;
  await sql`delete from master_services where created_by like 'ZZ-%'`;
});

describeDb('laporanBulan (bulan terbuka)', () => {
  it('menghitung ulang setiap kali dibaca, dan MENGATAKAN bahwa ia menghitung', async () => {
    const mulai = `${DUA_BULAN_LALU}-01`;
    const { serviceId } = await layananJalan(mulai);
    const lap = await laporanBulan(sql, financeStaff(), BULAN_LALU);
    expect(lap.sumber).toBe('dihitung');
    expect(lap.status).toBe('Terbuka');
    expect(lap.ditutupPada).toBeNull();
    const baris = lap.baris.find((b) => b.serviceId === serviceId);
    expect(baris, 'layanan yang berjalan sepanjang bulan lalu harus punya baris').toBeDefined();
    expect(money.parse(baris!.nilaiDiakui) > 0n).toBe(true);
    expect(baris!.pengakuan).toBe('per_periode');
  });

  it('bulan tanpa satu pun pengakuan MENGATAKAN sebabnya, bukan tabel kosong', async () => {
    const lap = await laporanBulan(sql, financeStaff(), '2019-01');
    expect(lap.baris).toEqual([]);
    expect(lap.alasanKosong).toMatch(/masih terbuka/);
  });

  it('menolak bulan yang bukan YYYY-MM', async () => {
    await expect(laporanBulan(sql, financeStaff(), '2026-13')).rejects.toBeInstanceOf(ValidationError);
    await expect(laporanBulan(sql, financeStaff(), '09-2026')).rejects.toBeInstanceOf(ValidationError);
  });
});

describeDb('tutupBulan', () => {
  it('membekukan angkanya, dan sesudah itu data mentah yang berubah TIDAK menggesernya', async () => {
    // Inilah tuntutan (3) DIBUKTIKAN, bukan dikomentari — dan buktinya butuh
    // dua bagian, karena versi pertama tes ini hanya punya satu dan LOLOS
    // walaupun cabang bekunya dicabut (mutasi sengaja, aturan kerja #2):
    //
    //   (a) sesudah bulan ditutup, data mentahnya diubah sedemikian sehingga
    //       ANGKANYA BENAR-BENAR BERBEDA kalau dihitung ulang — dibuktikan
    //       dengan memanggil mesin accrual langsung, yang tidak pernah membeku;
    //   (b) laporan bulan itu tetap menyebut angka yang sama persis.
    //
    // Tanpa (a), "tidak bergeser" bisa berarti "tidak ada yang menggesernya",
    // dan itu bukan yang sedang diuji.
    const mulai = `${DUA_BULAN_LALU}-01`;
    const { serviceId } = await layananJalan(mulai);
    const sebelum = await laporanBulan(sql, financeStaff(), BULAN_LALU);
    expect(sebelum.sumber).toBe('dihitung');
    expect(money.parse(sebelum.totalDiakui) > 0n).toBe(true);

    const p = await tutupBulan(sql, financeLead(), BULAN_LALU);
    expect(p.status).toBe(PERIODE_DITUTUP);
    expect(p.ditutupOleh).toBe('ZZ-FLEAD');
    // Periode di dalam id menyebut bulan yang DIWAKILINYA (nomor urutnya
    // bertambah tiap run — `id_sequences` tidak dihapus teardown, dan memang
    // tidak boleh: id tidak pernah dipakai ulang, aturan rumah #1).
    expect(p.id.slice(0, 11)).toBe(`PBK-${BULAN_LALU.replace('-', '')}-`);

    const sesudah = await laporanBulan(sql, financeStaff(), BULAN_LALU);
    expect(sesudah.sumber).toBe('beku');
    expect(sesudah.totalDiakui).toBe(sebelum.totalDiakui);

    // (a) Ubah data mentahnya: satu jendela HOLD di tengah bulan yang sudah
    // ditutup — persis risiko operasional yang ketokan D-2 sendiri sebut
    // ("hold harus diinput saat kejadian, bukan diingat belakangan"). Hari
    // hold mengurangi hari aktif bulan itu, jadi angkanya berubah kalau ada
    // yang menghitung ulang.
    //
    // Ronde hold-nya dijalankan lewat PINTU SUNGGUHAN dulu (hari ini, jadi ia
    // tidak menyentuh bulan lalu), semata supaya string transisinya lahir dari
    // mesinnya; salinan bertanggal lampau baru disisipkan sesudah itu.
    await requestHold(sql, { employeeId: 'ZZ-AM', role: permission.makeRole({ division: 'Account', level: 'staff' }) }, serviceId, 'klien minta jeda');
    await approveHold(sql, accountLead(), serviceId);
    await resumeService(sql, accountLead(), serviceId, 'lanjut');
    await suntikTransisi(serviceId, '->[On Hold]', `${BULAN_LALU}-10`);
    await suntikTransisi(serviceId, '->[In Execution]', `${BULAN_LALU}-20`);

    const jadwal = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(
      jadwal.holds.some((h) => h.mulai === `${BULAN_LALU}-10` && h.selesai === `${BULAN_LALU}-20`),
      'suntikan hold di bulan lalu harus terbaca mesin accrual',
    ).toBe(true);
    const dihitungUlang = money.decimal(nilaiBulan(jadwal, BULAN_LALU));
    expect(dihitungUlang, 'suntikan itu HARUS mengubah angka kalau dihitung ulang')
      .not.toBe(sebelum.totalDiakui);

    // (b) …dan laporan bulan tertutup itu tetap menyebut angka bekunya.
    const lagi = await laporanBulan(sql, financeStaff(), BULAN_LALU);
    expect(lagi.sumber).toBe('beku');
    expect(lagi.totalDiakui).toBe(sebelum.totalDiakui);
    expect(lagi.baris).toHaveLength(sebelum.baris.length);

    // …sementara bulan yang MASIH terbuka memang bergerak, dan itu benar.
    const bulanIni = await laporanBulan(sql, financeStaff(), BULAN_INI);
    expect(bulanIni.sumber).toBe('dihitung');
  });

  it('mencatat siapa dan kapan, plus satu baris audit ber-total', async () => {
    // Penutupnya ber-id UNIK, dan kueri auditnya menyaring dengan id itu.
    // `audit_log` menolak DELETE, jadi baris dari tes lain (dan dari run
    // sebelumnya atas DB yang sama) menumpuk di `entity_id` bulan yang sama —
    // sebuah `toHaveLength(1)` tanpa penyaring aktor akan hijau sekali lalu
    // merah selamanya, dan yang merah bukan kodenya.
    const penutup: Actor = {
      // `Date.now()` ikut, bukan hanya `seq`: `seq` mulai dari 0 setiap run,
      // jadi id yang sama muncul lagi di run berikutnya atas DB yang sama —
      // dan `audit_log` menolak DELETE.
      employeeId: `ZZ-FLEAD-${Date.now()}-${seq++}`,
      role: permission.makeRole({ division: 'Finance', level: 'lead' }),
    };
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, penutup, BULAN_LALU);
    const audit = await sql<{ after_json: { bulan: string; baris: number; total_diakui: string } }[]>`
      select after_json from audit_log
       where entity_type = 'periode_buku' and entity_id = ${BULAN_LALU}
         and action = 'tutup_buku' and actor_employee_id = ${penutup.employeeId}`;
    expect(audit).toHaveLength(1);
    expect(audit[0].after_json.bulan).toBe(BULAN_LALU);
    expect(audit[0].after_json.baris).toBeGreaterThan(0);
    expect(money.parse(audit[0].after_json.total_diakui) > 0n).toBe(true);
    // …dan transisinya sendiri juga terekam oleh mesin status.
    const trans = await sql<{ action: string }[]>`
      select action from audit_log
       where entity_type = 'periode_buku' and entity_id = ${BULAN_LALU}
         and action like 'transition:%' and actor_employee_id = ${penutup.employeeId}`;
    expect(trans.map((t) => t.action)).toEqual(['transition:Terbuka->Ditutup']);
  });

  it('menolak menutup bulan yang belum berakhir — angkanya masih bertambah', async () => {
    await expect(tutupBulan(sql, financeLead(), BULAN_INI)).rejects.toThrow(MSG_BULAN_BELUM_BERAKHIR);
    const depan = tz.addMonthsToDate(`${BULAN_INI}-01`, 1).slice(0, 7);
    await expect(tutupBulan(sql, financeLead(), depan)).rejects.toThrow(MSG_BULAN_BELUM_BERAKHIR);
  });

  it('menolak penutupan kedua atas bulan yang sama', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), BULAN_LALU);
    await expect(tutupBulan(sql, financeLead(), BULAN_LALU)).rejects.toThrow(MSG_SUDAH_DITUTUP);
  });

  it('menolak menutup di luar urutan — lubang di deret angka beku', async () => {
    // Dua bulan lalu dibuka (lewat jurnal koreksi? tidak — lewat penutupan
    // bulan yang lebih baru), lalu bulan lalu ditutup: itu meninggalkan bulan
    // lebih awal yang terbuka, dan sebuah jurnal koreksi nanti bisa menunjuk
    // bulan yang belum pernah dibekukan.
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    // Buat baris periode untuk dua bulan lalu tanpa menutupnya.
    await sql`
      insert into periode_buku (id, bulan, created_by)
      values (${`PBK-${DUA_BULAN_LALU.replace('-', '')}-9001`}, ${DUA_BULAN_LALU}, 'ZZ-FLEAD')`;
    await expect(tutupBulan(sql, financeLead(), BULAN_LALU)).rejects.toThrow(MSG_TUTUP_TIDAK_BERURUTAN);
    // Tutup berurutan: yang lebih awal dulu, lalu yang berikutnya lolos.
    await tutupBulan(sql, financeLead(), DUA_BULAN_LALU);
    await expect(tutupBulan(sql, financeLead(), BULAN_LALU)).resolves.toBeDefined();
  });

  it('Finance staff, Account lead, OD, dan Sales tidak boleh menutup', async () => {
    for (const aktor of [financeStaff(), accountLead(), od(), budi()]) {
      await expect(tutupBulan(sql, aktor, BULAN_LALU)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(tutupBulan(sql, aktor, BULAN_LALU)).rejects.toThrow(MSG_TUTUP_DENIED);
    }
  });
});

describeDb('kekekalan bulan tertutup (tuntutan 2, ditegakkan DB)', () => {
  it('DB menolak UPDATE apa pun atas baris bulan yang sudah tertutup', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), BULAN_LALU);
    // Termasuk "buka kembali sebentar" — persis mekanisme yang membuat tuntutan
    // (2) berhenti berarti apa pun.
    await expect(sql`update periode_buku set status = 'Terbuka' where bulan = ${BULAN_LALU}`)
      .rejects.toThrow(/sudah ditutup dan tidak dapat diubah/);
    // …dan bahkan mengganti stempel penutupnya.
    await expect(sql`update periode_buku set ditutup_oleh = 'ZZ-LAIN' where bulan = ${BULAN_LALU}`)
      .rejects.toThrow(/sudah ditutup dan tidak dapat diubah/);
  });

  it('DB menolak DELETE baris bulan yang sudah tertutup', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), BULAN_LALU);
    await expect(sql`delete from periode_buku where bulan = ${BULAN_LALU}`)
      .rejects.toThrow(/sudah ditutup dan tidak dapat diubah/);
  });

  it('mesin statusnya tidak punya edge keluar dari Ditutup', async () => {
    const keluar = await sql<{ n: string }[]>`
      select count(*) as n from sm_edges where machine = 'periode_buku' and from_state = 'Ditutup'`;
    expect(Number(keluar[0].n)).toBe(0);
    const terminal = await sql<{ state: string }[]>`
      select state from sm_terminal_states where machine = 'periode_buku'`;
    expect(terminal.map((t) => t.state)).toEqual(['Ditutup']);
  });

  it('angka beku itu sendiri append-only — UPDATE dan DELETE ditolak', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), BULAN_LALU);
    await expect(sql`update periode_buku_baris set nilai_diakui = '1.00' where bulan = ${BULAN_LALU}`)
      .rejects.toThrow(/append-only|immutable/i);
    await expect(sql`delete from periode_buku_baris where bulan = ${BULAN_LALU}`)
      .rejects.toThrow(/append-only|immutable/i);
  });
});

describeDb('jurnal koreksi', () => {
  it('mendarat di bulan berjalan, menaikkan totalnya, dan TIDAK menggeser bulan yang dikoreksi', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), DUA_BULAN_LALU);
    const beku = await laporanBulan(sql, financeStaff(), DUA_BULAN_LALU);

    const k = await catatKoreksi(sql, financeStaff(), {
      bulan: BULAN_INI, bulanDikoreksi: DUA_BULAN_LALU,
      nilai: '-2500000', alasan: 'hold bulan itu baru diinput sekarang',
    });
    expect(k.id).toMatch(/^JRK-\d{6}-\d{4}$/);
    expect(k.nilai).toBe('-2500000.00');

    // Bulan BERJALAN menyerap koreksinya.
    const ini = await laporanBulan(sql, financeStaff(), BULAN_INI);
    expect(ini.koreksi.map((x) => x.id)).toContain(k.id);
    expect(ini.totalKoreksi).toBe('-2500000.00');
    expect(money.parse(ini.total)).toBe(money.parse(ini.totalDiakui) + money.parse(ini.totalKoreksi));

    // Bulan yang DIKOREKSI tetap menyebut angka bekunya…
    const lagi = await laporanBulan(sql, financeStaff(), DUA_BULAN_LALU);
    expect(lagi.totalDiakui).toBe(beku.totalDiakui);
    expect(lagi.total).toBe(beku.total);
    // …dan menampilkan koreksinya, supaya ia tidak terbaca benar padahal sudah
    // diketahui keliru.
    expect(lagi.dikoreksiOleh.map((x) => x.id)).toContain(k.id);
  });

  it('koreksi kedua yang berlawanan adalah cara membatalkannya — barisnya immutable', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), DUA_BULAN_LALU);
    const a = await catatKoreksi(sql, financeStaff(), {
      bulan: BULAN_INI, bulanDikoreksi: DUA_BULAN_LALU, nilai: '-1000000', alasan: 'keliru',
    });
    await expect(sql`update jurnal_koreksi set nilai = '0.00' where id = ${a.id}`)
      .rejects.toThrow(/append-only|immutable/i);
    await expect(sql`delete from jurnal_koreksi where id = ${a.id}`)
      .rejects.toThrow(/append-only|immutable/i);
    await catatKoreksi(sql, financeStaff(), {
      bulan: BULAN_INI, bulanDikoreksi: DUA_BULAN_LALU, nilai: '1000000', alasan: 'membatalkan koreksi sebelumnya',
    });
    const ini = await laporanBulan(sql, financeStaff(), BULAN_INI);
    expect(ini.totalKoreksi).toBe('0.00');
    // Dua baris, bukan nol baris: jurnal keuangan tidak menghapus, ia menambah.
    expect(ini.koreksi).toHaveLength(2);
  });

  it('menolak koreksi atas bulan yang BELUM ditutup', async () => {
    await expect(catatKoreksi(sql, financeStaff(), {
      bulan: BULAN_INI, bulanDikoreksi: BULAN_LALU, nilai: '-1000', alasan: 'x',
    })).rejects.toThrow(MSG_KOREKSI_TARGET_BELUM_TUTUP);
  });

  it('menolak mencatat koreksi DI bulan yang sudah tertutup', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), DUA_BULAN_LALU);
    await tutupBulan(sql, financeLead(), BULAN_LALU);
    await expect(catatKoreksi(sql, financeStaff(), {
      bulan: BULAN_LALU, bulanDikoreksi: DUA_BULAN_LALU, nilai: '-1000', alasan: 'x',
    })).rejects.toThrow(MSG_KOREKSI_BULAN_SUDAH_TUTUP);
  });

  it('menolak arah waktu yang terbalik dan bulan yang sama', async () => {
    for (const [bulan, target] of [[DUA_BULAN_LALU, BULAN_INI], [BULAN_INI, BULAN_INI]]) {
      await expect(catatKoreksi(sql, financeStaff(), {
        bulan, bulanDikoreksi: target, nilai: '-1000', alasan: 'x',
      })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('menolak nilai nol, alasan kosong, dan nilai yang bukan angka', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), DUA_BULAN_LALU);
    const dasar = { bulan: BULAN_INI, bulanDikoreksi: DUA_BULAN_LALU };
    await expect(catatKoreksi(sql, financeStaff(), { ...dasar, nilai: '0', alasan: 'x' }))
      .rejects.toThrow(MSG_KOREKSI_NILAI_NOL);
    await expect(catatKoreksi(sql, financeStaff(), { ...dasar, nilai: '-1000', alasan: '   ' }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(catatKoreksi(sql, financeStaff(), { ...dasar, nilai: 'seribu', alasan: 'x' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('koreksi yang menunjuk layanan wajib menunjuk kliennya juga', async () => {
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    await tutupBulan(sql, financeLead(), DUA_BULAN_LALU);
    await expect(catatKoreksi(sql, financeStaff(), {
      bulan: BULAN_INI, bulanDikoreksi: DUA_BULAN_LALU, nilai: '-1000', alasan: 'x',
      serviceId: 'SVC-209912-9999',
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('OD dan Sales tidak boleh mencatat koreksi', async () => {
    for (const aktor of [od(), budi(), accountLead()]) {
      await expect(catatKoreksi(sql, aktor, {
        bulan: BULAN_INI, bulanDikoreksi: DUA_BULAN_LALU, nilai: '-1000', alasan: 'x',
      })).rejects.toThrow(MSG_KOREKSI_DENIED);
    }
  });

  it('id JRK- dicetak hanya SESUDAH semua gerbang lolos (aturan rumah #1)', async () => {
    const sebelum = await sql<{ n: string }[]>`select count(*) as n from id_sequences where prefix = 'JRK'`;
    await expect(catatKoreksi(sql, financeStaff(), {
      bulan: BULAN_INI, bulanDikoreksi: DUA_BULAN_LALU, nilai: '0', alasan: 'x',
    })).rejects.toThrow(MSG_KOREKSI_NILAI_NOL);
    const sesudah = await sql<{ n: string }[]>`select count(*) as n from id_sequences where prefix = 'JRK'`;
    expect(sesudah[0].n).toBe(sebelum[0].n);
  });
});

describeDb('periode', () => {
  it('null sebelum bulannya pernah disentuh — bukan baris palsu ber-status Terbuka', async () => {
    expect(await periode(sql, financeStaff(), '2019-05')).toBeNull();
  });

  it('id PBK- menyebut bulan yang DIWAKILINYA, bukan bulan penutupannya', async () => {
    // Buku bulan lalu ditutup HARI INI (bulan berjalan), dan idnya tetap
    // menyebut bulan lalu. Tanpa ini, setiap pembaca id harus diingatkan untuk
    // tidak mempercayai periode di dalamnya.
    await layananJalan(`${DUA_BULAN_LALU}-01`);
    const p = await tutupBulan(sql, financeLead(), BULAN_LALU);
    expect(p.id.slice(4, 10)).toBe(BULAN_LALU.replace('-', ''));
    expect(p.id.slice(4, 10)).not.toBe(BULAN_INI.replace('-', ''));
  });
});
