/**
 * Tes JAHITAN mesin accrual — aturan kerja #1: *"setiap jahitan wajib punya satu
 * tes yang memanggil KEDUA sisi sungguhan."*
 *
 * `packages/core/src/accrual.test.ts` sudah membuktikan aritmetikanya dengan 53
 * tes murni, dan `msl.test.ts` sudah membuktikan katalognya menyimpan
 * `pengakuan`. Keduanya bisa hijau sementara jahitannya putus — karena
 * masing-masing memakai fixture-nya sendiri. Yang diuji DI SINI persis
 * hal-hal yang hanya bisa salah di antara keduanya:
 *
 *   1. **String aksi audit.** Pembacanya mencari `transition:…->[On Hold]`.
 *      Kalau `sm_transition` menuliskannya dengan bentuk lain, seluruh riwayat
 *      hold terbaca kosong dan jadwalnya tetap terlihat masuk akal — pendapatan
 *      diakui di bulan yang seharusnya di-jeda, tanpa satu pun galat.
 *   2. **`[Hold Requested]` BUKAN hold.** Ia dinyatakan ACTIVE oleh migrasi
 *      `20260814080000`, dan pengakuan berhenti saat Head MENYETUJUI. Karena
 *      penolakan hold juga berakhir di `-> [In Execution]`, pembacanya bisa
 *      salah memasangkan — jadi ronde permintaan-lalu-DITOLAK diuji utuh lewat
 *      pintu sungguhan (`requestHold`/`rejectHold`).
 *   3. **Versi MSL yang DIPIN, bukan yang terbaru.** Sales Head yang mengubah
 *      `pengakuan` besok tidak boleh menggeser pengakuan engagement yang sudah
 *      jalan.
 *   4. **Qty mengalikan DURASI, tidak pernah mengalikan UANG.** `Σ services
 *      .standard_price` adalah `transactions.total_agreed_value`; mengalikannya
 *      lagi dengan qty akan mengakui lebih banyak daripada yang dijual.
 *   5. **Baris yang ditolak mesin tetap MUNCUL, membawa sebabnya.** Satu qty
 *      pecahan tidak boleh meruntuhkan laporan satu klien, dan tidak boleh
 *      menghilangkan barisnya diam-diam.
 *
 * Transisinya digerakkan oleh mesin status SUNGGUHAN — `sm_transition` di SQL —
 * bukan baris `audit_log` yang ditulis tangan. Untuk cabang yang menuntut
 * rentang MULTI-BULAN, satu baris audit bertanggal lampau ikut disisipkan;
 * `action`-nya **dibaca ulang dari baris yang mesin itu tulis sendiri**, bukan
 * diketik di sini, supaya string yang dipakai tes tidak bisa menyimpang dari
 * string yang dipakai produksi. (`audit_log` menolak UPDATE dan DELETE, jadi
 * membelokkan tanggal baris yang sudah ada memang tidak mungkin.)
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { money, permission, statemachine, tz } from '@cdps/core';
import { createClient, executors, type Sql } from '@cdps/db';
import { leads, sales } from './index';
import {
  approveHold,
  rejectHold,
  requestHold,
  resumeService,
  voidService,
} from './client';
import {
  canBacaAccrual,
  ForbiddenError,
  jadwalKlien,
  jadwalLayanan,
  MSG_ACCRUAL_DENIED,
  ServiceNotFoundError,
  type Actor,
} from './accrual';

const budi = (): Actor => ({
  employeeId: 'ZZ-BUDI', role: permission.makeRole({ division: 'Sales', level: 'staff' }),
});
const salesLead = (): Actor => ({
  employeeId: 'ZZ-SLEAD', role: permission.makeRole({ division: 'Sales', level: 'lead' }),
});
const accountStaff = (): Actor => ({
  employeeId: 'ZZ-AM', role: permission.makeRole({ division: 'Account', level: 'staff' }),
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
// Unit: gerbang baca.
// ---------------------------------------------------------------------------
describe('canBacaAccrual', () => {
  it('Finance segala level, OD, Director — bukan Sales, bukan Account', () => {
    expect(canBacaAccrual(financeStaff())).toBe(true);
    expect(canBacaAccrual(financeLead())).toBe(true);
    expect(canBacaAccrual(od())).toBe(true);
    expect(canBacaAccrual(director())).toBe(true);
    // Yang menutup transaksi dan yang mengeksekusinya TIDAK otomatis boleh
    // membaca pengakuan pendapatannya: ini worklist Finance, bukan laporan umum
    // (set yang sama persis dengan `finance.canReadFinanceQueue`).
    expect(canBacaAccrual(budi())).toBe(false);
    expect(canBacaAccrual(salesLead())).toBe(false);
    expect(canBacaAccrual(accountStaff())).toBe(false);
    expect(canBacaAccrual(accountLead())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration (real Postgres + real sm_transition).
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
/**
 * Klien kedua ber-hook `debug` postgres.js, supaya jumlah statement yang benar-
 * benar naik ke kabel bisa dihitung. Pola + alasannya sama dengan
 * `perf_n1.test.ts`: assertion wall-clock akan flaky dan tetap lolos di socket
 * lokal yang cepat walau N+1-nya kembali, sedangkan JUMLAH KUERI deterministik.
 */
let counted: Sql;
let queries = 0;

if (URL) {
  sql = createClient(URL);
  counted = postgres(URL, {
    prepare: false,
    debug: (_c, q) => {
      // Lookup type-OID sekali per koneksi adalah bootstrap driver, bukan bagian
      // dari baca yang diuji.
      if (q.includes('pg_catalog')) {
        return;
      }
      queries++;
    },
  });
}

/** countQueries menjalankan fn dan melaporkan berapa statement yang ia kirim. */
async function countQueries<T>(fn: (q: Sql) => Promise<T>): Promise<number> {
  queries = 0;
  await fn(counted);
  return queries;
}

const HARI_INI = tz.dateString(new Date());
const BULAN_INI = HARI_INI.slice(0, 7);

let seq = 0;
const uniquePhone = (): string => `0817${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;
const uniqueMsv = (): string => `SVC-ZZ-ACC-${seq++}`;

interface Katalog {
  durasiBulan?: number | null;
  qtyMenambah?: string;
  pengakuan?: string;
  harga?: string;
}

/**
 * closedClient menjalankan pipeline closing SUNGGUHAN (register → contacted →
 * qualified form → negotiation → close) atas satu layanan katalog yang baru
 * dibuat, dan mengembalikan klien + `SVC-` yang lahir dari situ.
 *
 * Lewat pintu sungguhan, bukan `insert into services`, karena tiga dari lima
 * hal yang tes ini jaga hidup di jalur itu: `standard_price` yang datang dari
 * `proposed_price`, versi MSL yang DIPIN, dan `qualified_form_services.quantity`
 * yang jadi satu-satunya sumber qty sesudah closing.
 */
async function closedClient(k: Katalog = {}, qty = 1): Promise<{ clientId: string; serviceId: string; msvId: string }> {
  const msvId = uniqueMsv();
  const harga = k.harga ?? '31000000.00';
  await sql`insert into master_services (id, created_by) values (${msvId}, 'ZZ-ADMIN')`;
  await sql`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active, effective_from,
       pricing_mode, durasi_bulan, qty_menambah, pengakuan, created_by)
    values (${msvId}, 1, ${'Svc ' + msvId}, ${harga}, '10% of standard price', true, '2020-01-01',
       'flat', ${k.durasiBulan ?? null}, ${k.qtyMenambah ?? 'volume'}, ${k.pengakuan ?? 'saat_selesai'}, 'ZZ-ADMIN')`;

  const { attempt } = await leads.register(sql, budi(), { leadName: 'Alpha Digital', phoneNumber: uniquePhone() });
  await sales.markContacted(sql, budi(), attempt.id);
  await sales.submitQualifiedForm(sql, budi(), attempt.id, {
    namaPic: 'Ibu Alpha', toko: 'Alpha Digital', kota: 'Jakarta', linkToko: 'https://shopee/alpha',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [{ masterServiceId: msvId, quantity: qty }],
  });
  await sales.submitNegotiation(sql, budi(), attempt.id, [], true);
  const res = await sales.close(sql, budi(), attempt.id, {
    parties: { primarySalespersonId: 'ZZ-BUDI', allocations: [{ salespersonId: 'ZZ-BUDI', basisPoints: 10000 }] },
    paymentScheme: sales.PAYMENT_SCHEME_LUNAS,
  });
  await sql`update clients set assigned_am_id = 'ZZ-AM' where id = ${res.clientId}`;
  const svc = await sql<{ id: string }[]>`
    select id from services where client_id = ${res.clientId} order by id limit 1`;
  return { clientId: res.clientId, serviceId: svc[0].id, msvId };
}

/**
 * jalankan menggerakkan sebuah Service ke `[In Execution]` lewat MESIN STATUS
 * SUNGGUHAN (`sm_transition`), dua hop: `[Awaiting Onboarding] -> [Briefed] ->
 * [In Execution]`.
 *
 * Ia memakai engine langsung alih-alih `account.createBrief` karena jahitan yang
 * diuji berkas ini adalah **pembaca accrual ↔ riwayat transisi**, bukan gerbang
 * bisnis M6. Yang penting: baris `audit_log`-nya ditulis oleh fungsi SQL yang
 * sama yang dipakai produksi, jadi `action`-nya tidak bisa berbeda.
 */
async function jalankan(serviceId: string): Promise<void> {
  const ex = executors(sql);
  for (const to of ['[Briefed]', '[In Execution]']) {
    const res = await statemachine.transition(ex.sm, {
      machine: 'service', entityType: 'service', table: 'services', entityId: serviceId, to, actor: accountLead(),
    });
    expect(res.ok, `transisi ke ${to} ditolak: ${JSON.stringify(res)}`).toBe(true);
  }
}

/** Baris audit transisi satu Service, apa adanya. */
const transisi = async (serviceId: string): Promise<{ action: string; created_at: Date }[]> =>
  await sql<{ action: string; created_at: Date }[]>`
    select action, created_at from audit_log
     where entity_type = 'service' and entity_id = ${serviceId} and action like 'transition:%'
     order by created_at asc, id asc`;

/**
 * backdate menyisipkan SATU baris audit transisi bertanggal lampau, dengan
 * `action` yang DIBACA ULANG dari baris yang mesin status tulis sendiri.
 *
 * Ini satu-satunya cara menguji rentang multi-bulan: `audit_log` menolak UPDATE,
 * jadi tanggal baris yang sudah ada tidak bisa digeser, dan `now()` selalu hari
 * ini. Karena `action`-nya dikutip dari mesinnya, tes ini tetap merah kalau
 * format string transisi berubah — yang justru hal #1 yang dijaganya.
 */
async function backdate(serviceId: string, akhiran: string, tanggal: string): Promise<void> {
  const rows = await transisi(serviceId);
  const asli = rows.find((r) => r.action.endsWith(akhiran));
  expect(asli, `mesin status belum pernah menulis transisi ${akhiran}`).toBeDefined();
  await sql`
    insert into audit_log (entity_type, entity_id, actor_employee_id, action, created_at, created_by)
    values ('service', ${serviceId}, 'ZZ-ALEAD', ${asli!.action}, ${`${tanggal}T03:00:00Z`}, 'ZZ-ALEAD')`;
}

afterAll(async () => {
  if (sql) await sql.end();
  if (counted) await counted.end();
});

afterEach(async () => {
  if (!sql) return;
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

describeDb('jadwalLayanan — bahan yang dirakit dari data nyata', () => {
  it('membaca pengakuan + durasi dari versi MSL yang DIPIN, dan menutup persis di nilai bruto', async () => {
    const { serviceId } = await closedClient({ durasiBulan: 6, qtyMenambah: 'durasi', pengakuan: 'per_periode' });
    await jalankan(serviceId);

    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.pengakuan).toBe('per_periode');
    expect(j.durasiBulan).toBe(6);
    expect(j.durasiBulanTotal).toBe(6); // qty 1
    expect(j.galat).toBeNull();
    expect(j.tanggalMulai).toBe(HARI_INI); // hari transisi ke [In Execution]
    expect(j.tanggalVoid).toBeNull();
    expect(j.tanggalSelesai).toBeNull();
    expect(j.holds).toEqual([]);

    // Σ jadwal = nilai bruto baris, tepat, tanpa sepeser lebih atau kurang.
    const jd = j.jadwal!;
    expect(money.decimal(jd.diakui)).toBe(j.nilaiBruto);
    expect(jd.hangus).toBe(0n);
    expect(jd.belumDiakui).toBe(0n);
    expect(jd.baris[0].bulan).toBe(BULAN_INI);
    expect(jd.periode!.hariAktif).toBe(jd.periode!.hariTotal);
  });

  it('nilai brutonya PERSIS `services.standard_price`, yang Σ-nya nilai deal', async () => {
    const { clientId, serviceId } = await closedClient({ durasiBulan: 1, pengakuan: 'per_periode' });
    const svc = await sql<{ standard_price: string }[]>`
      select standard_price from services where id = ${serviceId}`;
    const trx = await sql<{ total_agreed_value: string }[]>`
      select total_agreed_value from transactions where client_id = ${clientId}`;
    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.nilaiBruto).toBe(svc[0].standard_price);
    // Satu layanan ⇒ Σ baris = nilai deal. Ini yang membuat "jangan kalikan qty
    // ke uang" bisa dibuktikan, bukan cuma dikomentari.
    expect(money.parse(j.nilaiBruto)).toBe(money.parse(trx[0].total_agreed_value));
  });

  it('qty MENGALIKAN durasi dan TIDAK mengalikan uang (beli 2 × 6 bulan = 12 bulan)', async () => {
    const { clientId, serviceId } = await closedClient(
      { durasiBulan: 6, qtyMenambah: 'durasi', pengakuan: 'per_periode' }, 2,
    );
    await jalankan(serviceId);
    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.qty).toBe('2.00');
    expect(j.durasiBulanTotal).toBe(12);

    const trx = await sql<{ total_agreed_value: string }[]>`
      select total_agreed_value from transactions where client_id = ${clientId}`;
    // Nilainya SUDAH mencakup qty (harga negosiasi per baris); yang diakui
    // mesin accrual tidak boleh melebihi yang benar-benar dijual.
    expect(money.decimal(j.jadwal!.diakui)).toBe(money.decimal(money.parse(trx[0].total_agreed_value)));
  });

  it('qty tidak mengubah durasi saat qty_menambah=volume (Nano KOL beli 10)', async () => {
    const { serviceId } = await closedClient({ durasiBulan: 1, qtyMenambah: 'volume', pengakuan: 'per_periode' }, 10);
    await jalankan(serviceId);
    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.qty).toBe('10.00');
    expect(j.durasiBulanTotal).toBe(1);
  });

  it('layanan sekali-jadi yang belum selesai: nol diakui, seluruhnya BELUM, sebabnya disebut', async () => {
    const { serviceId } = await closedClient({ durasiBulan: null, pengakuan: 'saat_selesai' });
    await jalankan(serviceId);
    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.jadwal!.alasanKosong).toBe('belum_selesai');
    expect(money.decimal(j.jadwal!.belumDiakui)).toBe(j.nilaiBruto);
    expect(j.jadwal!.hangus).toBe(0n);
  });

  it('Komisi (bulan_berikutnya) diakui satu bulan sesudah tanggal penjualannya', async () => {
    const { serviceId } = await closedClient({ durasiBulan: null, pengakuan: 'bulan_berikutnya' });
    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    // Tanggal penjualan = lahirnya baris `services`, yaitu Closing.
    expect(j.tanggalPenjualan).toBe(HARI_INI);
    const berikut = tz.addMonthsToDate(`${BULAN_INI}-01`, 1).slice(0, 7);
    expect(j.jadwal!.baris.map((b) => b.bulan)).toEqual([berikut]);
    // Ia TIDAK butuh [In Execution] untuk punya jadwal — bedanya dengan
    // per_periode, dan itu justru gunanya penanda ketiga.
    expect(j.tanggalMulai).toBeNull();
  });
});

describeDb('jadwalLayanan — riwayat dari mesin status sungguhan', () => {
  it('hold LEWAT PINTU SUNGGUHAN memotong jadwal dan mengatakannya', async () => {
    const { serviceId } = await closedClient({ durasiBulan: 6, pengakuan: 'per_periode' });
    await jalankan(serviceId);
    // Mundurkan hari mulai supaya ada hari aktif yang benar-benar berjalan
    // sebelum hold-nya — kalau tidak, hold hari ini menutup jadwal di nol hari.
    await backdate(serviceId, '->[In Execution]', tz.addDaysToDate(HARI_INI, -40));

    await requestHold(sql, accountStaff(), serviceId, 'klien minta jeda');
    // Permintaan SAJA belum menjeda apa pun — `[Hold Requested]` ACTIVE.
    let j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.holds).toEqual([]);
    expect(j.jadwal!.terpotongHold).toBe(false);

    await approveHold(sql, accountLead(), serviceId);
    j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.holds).toEqual([{ mulai: HARI_INI, selesai: null }]);
    expect(j.jadwal!.terpotongHold).toBe(true);
    expect(j.jadwal!.periode!.akhirEksklusif).toBeNull();
    // Sisanya BELUM, bukan hangus — hold bukan pembatalan.
    expect(j.jadwal!.hangus).toBe(0n);
    expect(j.jadwal!.belumDiakui > 0n).toBe(true);
  });

  it('hold yang DITOLAK tidak pernah tercatat sebagai hold — `[Hold Requested]` bukan `[On Hold]`', async () => {
    // Cabang paling mudah salah di seluruh berkas ini: penolakan hold juga
    // berakhir di `-> [In Execution]`, jadi pembaca yang memasangkan resume
    // dengan "permintaan" alih-alih dengan "persetujuan" akan mengarang satu
    // jendela hold yang tidak pernah ada.
    const { serviceId } = await closedClient({ durasiBulan: 6, pengakuan: 'per_periode' });
    await jalankan(serviceId);
    await requestHold(sql, accountStaff(), serviceId, 'klien minta jeda');
    await rejectHold(sql, accountLead(), serviceId, 'kontraknya masih jalan');

    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.holds).toEqual([]);
    expect(j.jadwal!.terpotongHold).toBe(false);
    expect(j.jadwal!.periode!.hariHold).toBe(0);
    // …dan hari mulainya tetap transisi PERTAMA, bukan yang dari penolakan itu.
    expect(j.tanggalMulai).toBe(HARI_INI);
  });

  it('resume menutup jendela hold-nya, dan jadwalnya tidak lagi terpotong', async () => {
    const { serviceId } = await closedClient({ durasiBulan: 6, pengakuan: 'per_periode' });
    await jalankan(serviceId);
    await backdate(serviceId, '->[In Execution]', tz.addDaysToDate(HARI_INI, -40));
    await requestHold(sql, accountStaff(), serviceId, 'jeda');
    await approveHold(sql, accountLead(), serviceId);
    await resumeService(sql, accountLead(), serviceId, 'klien siap lanjut');

    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.holds).toEqual([{ mulai: HARI_INI, selesai: HARI_INI }]);
    expect(j.jadwal!.terpotongHold).toBe(false);
    // Hold nol hari (minta & lepas di hari yang sama) tidak menggeser apa pun —
    // dan itu benar: tidak ada hari yang hilang.
    expect(j.jadwal!.periode!.hariHold).toBe(0);
    expect(money.decimal(j.jadwal!.diakui)).toBe(j.nilaiBruto);
  });

  it('void LEWAT PINTU SUNGGUHAN menghanguskan sisanya (D-1), tidak menggantungkannya', async () => {
    const { serviceId } = await closedClient({ durasiBulan: 6, pengakuan: 'per_periode' });
    await jalankan(serviceId);
    await backdate(serviceId, '->[In Execution]', tz.addDaysToDate(HARI_INI, -40));
    await voidService(sql, accountLead(), serviceId, 'klien membatalkan');

    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.tanggalVoid).toBe(HARI_INI);
    const jd = j.jadwal!;
    expect(jd.periode!.hariAktif).toBe(40); // 40 hari sudah jalan sebelum void
    expect(jd.hangus > 0n).toBe(true);
    expect(jd.belumDiakui).toBe(0n);
    expect(money.decimal(jd.diakui + jd.hangus)).toBe(j.nilaiBruto);
  });

  it('menyeberang bulan menurut HARI saat mulainya benar-benar di bulan lampau', async () => {
    // Inilah cabang yang membuktikan tanggal audit benar-benar sampai ke mesin:
    // dengan mulai 40 hari lalu dan durasi 1 bulan, periodenya sudah SELESAI,
    // jadwalnya menyentuh dua bulan kalender, dan Σ-nya tetap nilai bruto.
    const { serviceId } = await closedClient({ durasiBulan: 1, pengakuan: 'per_periode' });
    await jalankan(serviceId);
    const mulai = tz.addDaysToDate(HARI_INI, -40);
    await backdate(serviceId, '->[In Execution]', mulai);

    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.tanggalMulai).toBe(mulai);
    const jd = j.jadwal!;
    expect(jd.periode!.akhirEksklusif).toBe(tz.addMonthsToDate(mulai, 1));
    expect(jd.baris.length).toBeGreaterThanOrEqual(1);
    expect(new Set(jd.baris.map((b) => b.bulan)).size).toBe(jd.baris.length);
    expect(money.decimal(jd.diakui)).toBe(j.nilaiBruto);
  });
});

describeDb('jadwalLayanan — versi yang dipin & masukan yang ditolak', () => {
  it('memakai versi MSL yang DIPIN, bukan versi terbaru katalog', async () => {
    const { serviceId, msvId } = await closedClient({ durasiBulan: 6, pengakuan: 'per_periode' });
    await jalankan(serviceId);
    // Sales Head menerbitkan versi 2 dengan pengakuan yang berbeda.
    await sql`
      insert into master_service_versions
        (service_id, version_no, name, standard_price, commission_rule, active, effective_from,
         pricing_mode, durasi_bulan, qty_menambah, pengakuan, created_by)
      values (${msvId}, 2, ${'Svc ' + msvId}, '31000000.00', '10% of standard price', true, '2020-06-01',
         'flat', null, 'volume', 'saat_selesai', 'ZZ-ADMIN')`;

    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.masterVersionNo).toBe(1);
    expect(j.pengakuan).toBe('per_periode');
    expect(j.durasiBulan).toBe(6);
  });

  it('qty PECAHAN pada layanan berdurasi: barisnya TETAP ada, membawa sebabnya', async () => {
    // "2,5 periode" tidak punya arti, dan mesin murni menolaknya. Yang tidak
    // boleh terjadi: barisnya hilang dari laporan tanpa jejak, atau qty-nya
    // dibulatkan diam-diam.
    const { serviceId } = await closedClient(
      { durasiBulan: 6, qtyMenambah: 'durasi', pengakuan: 'per_periode' }, 1,
    );
    await sql`update qualified_form_services set quantity = 2.5 where created_by like 'ZZ-%'`;
    await jalankan(serviceId);

    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.jadwal).toBeNull();
    expect(j.galat).toMatch(/whole positive/i);
    expect(j.durasiBulanTotal).toBeNull();
    // Bahannya tetap terbaca, jadi yang membacanya tahu HARUS memperbaiki apa.
    expect(j.qty).toBe('2.50');
    expect(j.durasiBulan).toBe(6);
  });

  it('layanan tanpa baris QFS (mis. lahir dari perpanjangan) memakai qty 1', async () => {
    const { serviceId } = await closedClient({ durasiBulan: 6, qtyMenambah: 'durasi', pengakuan: 'per_periode' });
    await sql`delete from qualified_form_services where created_by like 'ZZ-%'`;
    await jalankan(serviceId);
    const j = await jadwalLayanan(sql, financeStaff(), serviceId);
    expect(j.qty).toBe('1');
    expect(j.durasiBulanTotal).toBe(6);
  });

  it('layanan yang tidak ada ditolak sebagai NotFound, bukan jadwal kosong', async () => {
    await expect(jadwalLayanan(sql, financeStaff(), 'SVC-209912-9999'))
      .rejects.toBeInstanceOf(ServiceNotFoundError);
  });
});

describeDb('jadwalKlien + gerbang peran', () => {
  it('mengembalikan setiap layanan klien, yang di-void ikut — nilai hangus adalah angka laporan', async () => {
    const { clientId, serviceId } = await closedClient({ durasiBulan: 6, pengakuan: 'per_periode' });
    await jalankan(serviceId);
    await backdate(serviceId, '->[In Execution]', tz.addDaysToDate(HARI_INI, -40));
    await voidService(sql, accountLead(), serviceId, 'batal');

    const daftar = await jadwalKlien(sql, financeStaff(), clientId);
    expect(daftar.map((d) => d.serviceId)).toContain(serviceId);
    const v = daftar.find((d) => d.serviceId === serviceId)!;
    expect(v.status).toBe('[Cancelled — Service Voided]');
    expect(v.jadwal!.hangus > 0n).toBe(true);
  });

  it('jumlah kueri TIDAK tumbuh bersama jumlah layanan (disiplin P-1)', async () => {
    // Riwayat transisi setiap layanan hidup di `audit_log`, dan versi paling
    // gampang menulisnya adalah satu kueri per baris. Itu N+1: tak terasa untuk
    // satu klien bertiga layanan, dan mahal begitu penutupan buku bulanan D-3
    // memanggilnya untuk seluruh klien. Wall-clock tidak bisa menjaga ini —
    // jumlah kueri bisa.
    const a = await closedClient({ durasiBulan: 6, pengakuan: 'per_periode' });
    await jalankan(a.serviceId);
    // Klien kedua dengan TIGA layanan di satu closing.
    const msvIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = uniqueMsv();
      msvIds.push(id);
      await sql`insert into master_services (id, created_by) values (${id}, 'ZZ-ADMIN')`;
      await sql`
        insert into master_service_versions
          (service_id, version_no, name, standard_price, commission_rule, active, effective_from,
           pricing_mode, durasi_bulan, qty_menambah, pengakuan, created_by)
        values (${id}, 1, ${'Svc ' + id}, '10000000.00', '10% of standard price', true, '2020-01-01',
           'flat', 6, 'volume', 'per_periode', 'ZZ-ADMIN')`;
    }
    const { attempt } = await leads.register(sql, budi(), { leadName: 'Beta Digital', phoneNumber: uniquePhone() });
    await sales.markContacted(sql, budi(), attempt.id);
    await sales.submitQualifiedForm(sql, budi(), attempt.id, {
      namaPic: 'Ibu Beta', toko: 'Beta Digital', kota: 'Bandung', linkToko: 'https://shopee/beta',
      kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
      services: msvIds.map((id) => ({ masterServiceId: id, quantity: 1 })),
    });
    await sales.submitNegotiation(sql, budi(), attempt.id, [], true);
    const tiga = await sales.close(sql, budi(), attempt.id, {
      parties: { primarySalespersonId: 'ZZ-BUDI', allocations: [{ salespersonId: 'ZZ-BUDI', basisPoints: 10000 }] },
      paymentScheme: sales.PAYMENT_SCHEME_LUNAS,
    });

    const satu = await countQueries((q) => jadwalKlien(q, financeStaff(), a.clientId));
    const tigaKueri = await countQueries((q) => jadwalKlien(q, financeStaff(), tiga.clientId));
    expect((await jadwalKlien(sql, financeStaff(), tiga.clientId)).length).toBe(3);
    expect(tigaKueri).toBe(satu);
  });

  it('Sales dan Account ditolak dengan pesan BI persis; Finance/OD/Director boleh', async () => {
    const { clientId, serviceId } = await closedClient({ durasiBulan: 6, pengakuan: 'per_periode' });
    for (const aktor of [budi(), salesLead(), accountStaff(), accountLead()]) {
      await expect(jadwalLayanan(sql, aktor, serviceId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(jadwalKlien(sql, aktor, clientId)).rejects.toThrow(MSG_ACCRUAL_DENIED);
    }
    for (const aktor of [financeStaff(), financeLead(), od(), director()]) {
      await expect(jadwalLayanan(sql, aktor, serviceId)).resolves.toBeDefined();
      await expect(jadwalKlien(sql, aktor, clientId)).resolves.toBeDefined();
    }
  });

  it('gerbangnya menolak SEBELUM menyentuh DB — layanan tak ada pun tetap 403, bukan 404', async () => {
    // Urutan ini bukan detail: 404 untuk aktor yang tak berhak membocorkan
    // apakah sebuah `SVC-` ada.
    await expect(jadwalLayanan(sql, budi(), 'SVC-209912-9999')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
