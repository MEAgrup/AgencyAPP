/**
 * D-3 — kunci tutup buku.
 *
 * Yang diuji di sini adalah hal-hal yang kalau salah, angka keuangan bergerak
 * tanpa ada yang tahu:
 *
 *   - dua gerbang peran yang SENGAJA berbeda, diuji lewat modul DAN lewat SQL
 *     mentah (melewati modul), karena gerbang yang hanya hidup di TypeScript
 *     bukan gerbang;
 *   - angka beku berversi: buka-ulang tidak menghapus, tutup-ulang menambah;
 *   - pagar bulan tertutup, KETIGA arahnya;
 *   - dan yang paling mudah dianggap sepele: layanan yang qty-nya tidak
 *     tercatat harus muncul sebagai "tidak terhitung", bukan dihitung sebagai 1.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  ConflictError,
  ForbiddenError,
  MSG_ALASAN_WAJIB,
  MSG_BELUM_LEWAT,
  MSG_KOREKSI_BULAN_TERTUTUP,
  MSG_PERIODE_TIDAK_VALID,
  MSG_SUDAH_TERTUTUP,
  MSG_TIDAK_BOLEH_BUKA,
  MSG_TIDAK_BOLEH_TUTUP,
  PENGHITUNG,
  STATUS_TERBUKA,
  STATUS_TERTUTUP,
  ValidationError,
  bandingkanVersi,
  bolehBukaBuku,
  bolehJurnalKoreksi,
  bolehTutupBuku,
  bukaBuku,
  catatJurnalKoreksi,
  getPeriode,
  hitungAngkaPeriode,
  listJurnalKoreksi,
  listVersi,
  periodeKeTanggal,
  tutupBuku,
} from './tutupbuku';

const aktor = (
  id: string,
  role: Partial<permission.Role> & { division?: string; level?: string; director?: boolean },
): permission.Actor => ({ employeeId: id, role: permission.makeRole(role as never) });

const financeLead = () => aktor('ZZ-FIN-LEAD', { division: 'Finance', level: 'lead' });
const financeStaff = () => aktor('ZZ-FIN-STAF', { division: 'Finance', level: 'staff' });
const creativeLead = () => aktor('ZZ-CRE-LEAD', { division: 'Creative', level: 'lead' });
const director = () => aktor('ZZ-DIR', { division: 'Finance', level: 'lead', director: true });
const od = () => aktor('ZZ-OD', { division: '', level: 'staff', od: true } as never);

// ---------------------------------------------------------------------------
// Unit — gerbang peran, tanpa DB
// ---------------------------------------------------------------------------

describe('gerbang peran', () => {
  it('menutup: Finance lead ATAU Director, bukan yang lain', () => {
    expect(bolehTutupBuku(financeLead())).toBe(true);
    expect(bolehTutupBuku(director())).toBe(true);
    expect(bolehTutupBuku(financeStaff())).toBe(false);
    // Yang paling penting dari keempat baris ini: lead divisi LAIN ditolak.
    // `require_lead` sendirian akan meloloskannya.
    expect(bolehTutupBuku(creativeLead())).toBe(false);
    expect(bolehTutupBuku(od())).toBe(false);
  });

  it('membuka kembali: Director SAJA — termasuk menolak Finance lead', () => {
    expect(bolehBukaBuku(director())).toBe(true);
    // Asimetrinya justru di baris ini. Kalau Finance lead boleh membuka
    // tutupannya sendiri, "tertutup" tidak menjaga apa pun.
    expect(bolehBukaBuku(financeLead())).toBe(false);
    expect(bolehBukaBuku(creativeLead())).toBe(false);
  });

  it('jurnal koreksi: sama dengan yang boleh menutup (ketokan 2026-09-08)', () => {
    expect(bolehJurnalKoreksi(financeLead())).toBe(true);
    expect(bolehJurnalKoreksi(director())).toBe(true);
    expect(bolehJurnalKoreksi(financeStaff())).toBe(false);
    expect(bolehJurnalKoreksi(creativeLead())).toBe(false);
  });
});

describe('periodeKeTanggal', () => {
  it('menerima YYYY-MM dan menolak yang lain dengan pesan BI', () => {
    expect(periodeKeTanggal('2026-08')).toBe('2026-08-01');
    for (const buruk of ['2026-8', '2026-13', '2026-00', '2026-08-01', '', 'agustus']) {
      expect(() => periodeKeTanggal(buruk)).toThrow(MSG_PERIODE_TIDAK_VALID);
    }
  });
});

// ---------------------------------------------------------------------------
// Integrasi
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) sql = createClient(URL);

afterAll(async () => {
  if (sql) await sql.end();
});

/**
 * Membuka SEMUA bulan yang tertutup, lalu membuang jejaknya.
 *
 * Harus dipanggil SEBELUM membersihkan baris uang, dan itu bukan detail
 * teknis: pagar bulan tertutup menolak DELETE atas baris bertanggal di bulan
 * tertutup — termasuk DELETE milik pembersihan tes. Pembersihan yang ditolak
 * meninggalkan baris, dan tes berikutnya gagal dengan "duplicate key" yang
 * tidak menyebut sebab sebenarnya sama sekali.
 */
async function bersihkanPeriode(): Promise<void> {
  await sql`set session_replication_role = replica`;
  await sql`delete from book_period_snapshots`;
  await sql`delete from audit_log where entity_type in ('book_period', 'jurnal_koreksi')`;
  await sql`set session_replication_role = origin`;
  await sql`delete from book_periods`;
}

afterEach(async () => {
  if (!sql) return;
  // book_period_snapshots menolak DELETE lewat trigger — sama seperti
  // audit_log. Dibersihkan dengan mematikan trigger sesi, bukan dengan
  // melonggarkan tabelnya: yang diuji tes lain justru penolakan itu.
  // audit_log juga append-only. Baris tutup-buku & jurnal koreksi dibersihkan
  // supaya tes berikutnya tidak menghitung jejak tes sebelumnya — jebakan yang
  // sudah tercatat di vendor.test.ts ("assertions cannot depend on run
  // history") dan tetap menggigit tes ini sekali sebelum diperbaiki.
  await bersihkanPeriode();
});

/** Bulan lampau yang aman dipakai tes — jauh dari bulan berjalan. */
const P1 = '2020-01';
const P2 = '2020-02';

describeDb('tutupBuku', () => {
  it('membekukan angka, mengunci bulan, dan menulis versi pertama', async () => {
    const hasil = await tutupBuku(sql, financeLead(), P1);
    expect(hasil.versi).toBe(1);
    expect(hasil.periode.status).toBe(STATUS_TERTUTUP);
    expect(hasil.angka.penghitung).toBe(PENGHITUNG);

    const versi = await listVersi(sql, P1);
    expect(versi).toHaveLength(1);
    expect(versi[0].ditutupOleh).toBe('ZZ-FIN-LEAD');
  });

  it('menolak lead divisi lain — dan SQL menolaknya juga, bukan cuma modul', async () => {
    await expect(tutupBuku(sql, creativeLead(), P1)).rejects.toThrow(MSG_TIDAK_BOLEH_TUTUP);

    // Lewat modul: ditolak. Sekarang lewati modulnya sepenuhnya dan panggil
    // mesinnya langsung, seperti panggilan service-role akan melakukannya.
    await sql`insert into book_periods (periode, versi_terakhir, created_by)
              values (${periodeKeTanggal(P1)}::date, 1, 'ZZ-TEST')`;
    await sql`insert into book_period_snapshots (periode, versi, ditutup_oleh, penghitung, angka)
              values (${periodeKeTanggal(P1)}::date, 1, 'ZZ-TEST', 'uji', '{"a":1}'::jsonb)`;
    const r = await sql<{ code: string }[]>`
      select sm_transition('book_period','book_period','book_periods','periode','status',
        ${periodeKeTanggal(P1)}, '[Tertutup]', 'ZZ-CRE-LEAD', false, true, 'Creative') ->> 'code' as code`;
    expect(r[0].code).toBe('role_denied');
  });

  it('menolak staf Finance', async () => {
    await expect(tutupBuku(sql, financeStaff(), P1)).rejects.toThrow(ForbiddenError);
  });

  it('menolak bulan yang belum selesai', async () => {
    const bulanIni = new Date().toISOString().slice(0, 7);
    await expect(tutupBuku(sql, financeLead(), bulanIni)).rejects.toThrow(MSG_BELUM_LEWAT);
  });

  it('menolak menutup dua kali', async () => {
    await tutupBuku(sql, financeLead(), P1);
    await expect(tutupBuku(sql, financeLead(), P1)).rejects.toThrow(MSG_SUDAH_TERTUTUP);
  });
});

describeDb('bukaBuku', () => {
  it('Director membuka dengan alasan; angka lama TIDAK hilang', async () => {
    await tutupBuku(sql, financeLead(), P1);
    const p = await bukaBuku(sql, director(), P1, 'invoice ganda ditemukan auditor');
    expect(p.status).toBe(STATUS_TERBUKA);
    expect(p.alasanBuka).toBe('invoice ganda ditemukan auditor');
    // Inti dari konsekuensi kedua: versi 1 masih di sana sesudah dibuka.
    expect(await listVersi(sql, P1)).toHaveLength(1);
    expect(p.versiTerakhir).toBe(1);
  });

  it('menolak Finance lead — termasuk lewat SQL mentah', async () => {
    await tutupBuku(sql, financeLead(), P1);
    await expect(bukaBuku(sql, financeLead(), P1, 'apa saja')).rejects.toThrow(MSG_TIDAK_BOLEH_BUKA);

    await sql`update book_periods set dibuka_pada = now(), dibuka_oleh = 'ZZ-FIN-LEAD',
                 alasan_buka = 'coba tembus' where periode = ${periodeKeTanggal(P1)}::date`;
    const r = await sql<{ code: string }[]>`
      select sm_transition('book_period','book_period','book_periods','periode','status',
        ${periodeKeTanggal(P1)}, '[Terbuka]', 'ZZ-FIN-LEAD', false, true, 'Finance') ->> 'code' as code`;
    expect(r[0].code).toBe('role_denied');
    expect((await getPeriode(sql, P1))?.status).toBe(STATUS_TERTUTUP);
  });

  it('menolak alasan kosong', async () => {
    await tutupBuku(sql, financeLead(), P1);
    await expect(bukaBuku(sql, director(), P1, '   ')).rejects.toThrow(MSG_ALASAN_WAJIB);
  });

  it('menolak membuka bulan yang tidak pernah ditutup', async () => {
    await expect(bukaBuku(sql, director(), P1, 'alasan')).rejects.toThrow();
  });
});

describeDb('tutup-ulang dan selisih antar versi', () => {
  it('menambah versi baru, menyimpan yang lama, dan selisihnya bisa dibaca', async () => {
    await tutupBuku(sql, financeLead(), P1);
    await bukaBuku(sql, director(), P1, 'koreksi');
    const lagi = await tutupBuku(sql, financeLead(), P1);
    expect(lagi.versi).toBe(2);

    const versi = await listVersi(sql, P1);
    expect(versi.map((v) => v.versi)).toEqual([1, 2]);

    const selisih = await bandingkanVersi(sql, P1, 1, 2);
    expect(selisih.versiSebelum).toBe(1);
    expect(selisih.versiSesudah).toBe(2);
    // Data tidak berubah di antara dua penutupan, jadi selisihnya nol — dan
    // "nol" di sini adalah jawaban yang informatif, bukan ketiadaan.
    expect(selisih.totalSelisih).toBe('0');
    expect(selisih.baris).toEqual([]);
  });

  it('angka beku tidak bisa disunting maupun dihapus', async () => {
    await tutupBuku(sql, financeLead(), P1);
    await expect(
      sql`update book_period_snapshots set angka = '{"palsu":1}'::jsonb
           where periode = ${periodeKeTanggal(P1)}::date`,
    ).rejects.toThrow(/immutable/i);
    await expect(
      sql`delete from book_period_snapshots where periode = ${periodeKeTanggal(P1)}::date`,
    ).rejects.toThrow(/immutable/i);
  });
});

// ---------------------------------------------------------------------------
// Penghitung — apa yang terjadi pada layanan yang TIDAK bisa dihitung
// ---------------------------------------------------------------------------

const RUN = Date.now().toString(36).slice(-6);

/**
 * Satu klien + satu versi katalog ber-`qty_menambah = 'durasi'`, lalu dua
 * layanan di atasnya: satu ber-qty, satu qty NULL.
 *
 * Versi katalognya dibuat di sini, bukan diambil dari seed, karena seed Alpha
 * Digital tidak punya satu pun layanan 'durasi' — dan justru layanan itulah
 * yang membawa risiko: ia satu-satunya yang qty-nya mengubah PANJANG masa
 * layanan, bukan cuma harganya.
 */
async function seedLayanan(): Promise<{ clientId: string; svcAda: string; svcNull: string }> {
  const clientId = `ZZT-CLI-${RUN}`;
  const msId = `ZZT-MS-${RUN}`;
  const svcAda = `ZZT-SVC-A-${RUN}`;
  const svcNull = `ZZT-SVC-N-${RUN}`;

  await sql`insert into clients (id, nama_pic, toko, kota, link_toko, kategori,
              gmv_baseline, target_gmv, total_sales, sales_pic_id, commission_payment_pic_id, created_by)
            values (${clientId}, 'PIC', 'Toko Uji', 'Bandung', 'https://x', 'Fashion',
                    0, 0, 0, 'ZZ-TEST', 'ZZ-TEST', 'ZZ-TEST')`;
  await sql`insert into master_services (id, created_by) values (${msId}, 'ZZ-TEST')`;
  await sql`insert into master_service_versions
              (service_id, version_no, name, standard_price, commission_rule, active,
               effective_from, durasi_bulan, qty_menambah, pengakuan, created_by)
            values (${msId}, 1, 'Uji Durasi', 6000000, '0% of standard price', true,
                    '2019-01-01', 6, 'durasi', 'per_periode', 'ZZ-TEST')`;

  for (const [id, qty] of [
    [svcAda, 2],
    [svcNull, null],
  ] as [string, number | null][]) {
    await sql`insert into services (id, client_id, master_service_id, master_version_no, name,
                standard_price, commission_rule, status, qty, created_by, created_at)
              values (${id}, ${clientId}, ${msId}, 1, 'Uji Durasi', 6000000, '0% of standard price',
                      '[In Execution]', ${qty}, 'ZZ-TEST', '2019-12-01T00:00:00Z')`;
    // Layanan mulai jalan 1 Januari 2020 — irisan pertamanya jatuh di P1.
    await sql`insert into audit_log (entity_type, entity_id, actor_employee_id, action,
                before_json, after_json, created_by, created_at)
              values ('service', ${id}, 'ZZ-TEST', 'transition:[Briefed]->[In Execution]',
                      '{}'::jsonb, '{}'::jsonb, 'ZZ-TEST', '2020-01-01T03:00:00Z')`;
  }
  return { clientId, svcAda, svcNull };
}

/**
 * FS-6b — satu versi katalog ber-OPSI TENOR (3/12 bulan) dan dua layanan di
 * atasnya: satu yang menjual paket 12 bulan (snapshot terisi), satu yang tidak
 * memilih tenor sama sekali (snapshot NULL).
 *
 * Versinya sengaja dibuat persis seperti katalog sungguhan setelah FS-6:
 * `standard_price`/`durasi_bulan` versi = opsi TERPENDEK (Rp 10,2jt / 3 bulan),
 * karena itulah yang ditegakkan `trg_msdo_terpendek`. Tanpa meniru bentuk itu,
 * tesnya akan hijau karena fixture-nya salah, bukan karena kodenya benar —
 * jebakan yang sudah tercatat di handoff FS (§3.4).
 */
async function seedTenor(): Promise<{ clientId: string; svcTenor: string; svcVersi: string }> {
  const clientId = `ZZT-CLI-T-${RUN}`;
  const msId = `ZZT-MS-T-${RUN}`;
  const svcTenor = `ZZT-SVC-T12-${RUN}`;
  const svcVersi = `ZZT-SVC-TNL-${RUN}`;

  await sql`insert into clients (id, nama_pic, toko, kota, link_toko, kategori,
              gmv_baseline, target_gmv, total_sales, sales_pic_id, commission_payment_pic_id, created_by)
            values (${clientId}, 'PIC', 'Toko Tenor', 'Bandung', 'https://x', 'Fashion',
                    0, 0, 0, 'ZZ-TEST', 'ZZ-TEST', 'ZZ-TEST')`;
  await sql`insert into master_services (id, created_by) values (${msId}, 'ZZ-TEST')`;
  const ver = await sql<{ id: string }[]>`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, active,
       effective_from, durasi_bulan, qty_menambah, pengakuan, created_by)
    values (${msId}, 1, 'Jasa Iklan Traffic Basic', 10200000, '0% of standard price', true,
            '2019-01-01', 3, 'volume', 'per_periode', 'ZZ-TEST')
    returning id`;
  for (const [durasi, harga] of [[3, 10200000], [12, 36000000]] as [number, number][]) {
    await sql`insert into master_service_duration_options (version_id, durasi_bulan, harga, created_by)
              values (${ver[0].id}, ${durasi}, ${harga}, 'ZZ-TEST')`;
  }

  for (const [id, harga, durasi] of [
    [svcTenor, 36000000, 12],
    [svcVersi, 10200000, null],
  ] as [string, number, number | null][]) {
    await sql`insert into services (id, client_id, master_service_id, master_version_no, name,
                standard_price, commission_rule, status, qty, durasi_bulan, created_by, created_at)
              values (${id}, ${clientId}, ${msId}, 1, 'Jasa Iklan Traffic Basic', ${harga},
                      '0% of standard price', '[In Execution]', 1, ${durasi}, 'ZZ-TEST',
                      '2019-12-01T00:00:00Z')`;
    await sql`insert into audit_log (entity_type, entity_id, actor_employee_id, action,
                before_json, after_json, created_by, created_at)
              values ('service', ${id}, 'ZZ-TEST', 'transition:[Briefed]->[In Execution]',
                      '{}'::jsonb, '{}'::jsonb, 'ZZ-TEST', '2020-01-01T03:00:00Z')`;
  }
  return { clientId, svcTenor, svcVersi };
}

async function bersihkanLayanan(): Promise<void> {
  await sql`set session_replication_role = replica`;
  await sql`delete from audit_log where created_by = 'ZZ-TEST'`;
  await sql`set session_replication_role = origin`;
  await sql`delete from services where created_by = 'ZZ-TEST'`;
  await sql`delete from master_service_versions where created_by = 'ZZ-TEST'`;
  await sql`delete from master_services where created_by = 'ZZ-TEST'`;
  await sql`delete from clients where created_by = 'ZZ-TEST'`;
}

describeDb('hitungAngkaPeriode — yang tidak bisa dihitung TIDAK ikut dihitung', () => {
  afterEach(async () => {
    await bersihkanLayanan();
  });

  it('menghitung layanan ber-qty dan MELAPORKAN yang qty-nya kosong, bukan menganggapnya 1', async () => {
    const { svcAda, svcNull } = await seedLayanan();
    const angka = await hitungAngkaPeriode(sql, P1);

    const dihitung = angka.baris.find((b) => b.serviceId === svcAda);
    expect(dihitung, 'layanan ber-qty harus punya angka').toBeDefined();

    // Inti tes ini. Layanan yang qty-nya tidak tercatat TIDAK boleh muncul
    // sebagai baris berangka, dan TIDAK boleh hilang tanpa jejak.
    expect(angka.baris.find((b) => b.serviceId === svcNull)).toBeUndefined();
    const dilewati = angka.tidakTerhitung.find((t) => t.serviceId === svcNull);
    expect(dilewati, 'layanan tanpa qty harus muncul sebagai tidak terhitung').toBeDefined();
    expect(dilewati?.sebab).toContain('tidak tercatat');
  });

  it('qty MENGGANDAKAN durasi: beli 2 × 6 bulan tersebar 12 bulan, bukan 6', async () => {
    const { svcAda } = await seedLayanan();
    // Rp 6.000.000 dibagi 12 irisan bulanan = Rp 500.000 sebulan. Kalau qty
    // diabaikan (dianggap 1), angkanya jadi Rp 1.000.000 — dua kali lipat, di
    // separuh jumlah bulan. Itu kelas kesalahan yang tes ini jaga.
    const angka = await hitungAngkaPeriode(sql, P1);
    const b = angka.baris.find((x) => x.serviceId === svcAda);
    expect(b?.jumlah).toBe('50000000');
    expect(b?.jumlahIdr).toBe('Rp. 500.000,00');

    // Dan bulan ke-12 masih punya angka, bulan ke-13 tidak.
    const bulan12 = await hitungAngkaPeriode(sql, '2020-12');
    expect(bulan12.baris.find((x) => x.serviceId === svcAda)?.jumlah).toBe('50000000');
    const bulan13 = await hitungAngkaPeriode(sql, '2021-01');
    expect(bulan13.baris.find((x) => x.serviceId === svcAda)).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // FS-6b — tenor yang DIJUAL, bukan tenor terpendek di katalog
  // -------------------------------------------------------------------------
  //
  // Cacat yang dijaga tes ini tidak melempar galat apa pun. Invarian FS-6
  // (`trg_msdo_terpendek`) menyamakan `master_service_versions.durasi_bulan`
  // dengan opsi TERPENDEK. Jadi selama `hitungAngkaPeriode` membaca versi,
  // paket 12 bulan diakui sepanjang 3 bulan: nilainya utuh, jumlah irisannya
  // salah, dan setiap baris tetap konsisten dengan dirinya sendiri.
  //
  // Rp 36.000.000 / 12 = Rp 3.000.000 sebulan. Kalau kolom snapshot diabaikan,
  // angkanya jadi Rp 12.000.000 sebulan selama tiga bulan lalu nol — empat kali
  // lipat, di seperempat jumlah bulan.
  it('FS-6b: paket 12 bulan disebar 12 bulan, bukan sepanjang opsi terpendek', async () => {
    const { svcTenor } = await seedTenor();

    const p1 = await hitungAngkaPeriode(sql, P1);
    const b = p1.baris.find((x) => x.serviceId === svcTenor);
    expect(b?.jumlah).toBe('300000000');
    expect(b?.jumlahIdr).toBe('Rp. 3.000.000,00');

    // Bulan ke-12 masih berangka; bulan ke-13 tidak. Kalau versi yang terbaca,
    // keduanya sudah kosong sejak bulan ke-4.
    expect((await hitungAngkaPeriode(sql, '2020-12')).baris.find((x) => x.serviceId === svcTenor)?.jumlah)
      .toBe('300000000');
    expect((await hitungAngkaPeriode(sql, '2021-01')).baris.find((x) => x.serviceId === svcTenor))
      .toBeUndefined();
  });

  it('FS-6b: durasi_bulan NULL tetap membaca versi — nol perubahan bagi baris lama', async () => {
    const { svcVersi } = await seedTenor();
    // Layanan yang sama, snapshot kosong: Rp 10.200.000 / 3 = Rp 3.400.000.
    const b = (await hitungAngkaPeriode(sql, P1)).baris.find((x) => x.serviceId === svcVersi);
    expect(b?.jumlahIdr).toBe('Rp. 3.400.000,00');
    expect((await hitungAngkaPeriode(sql, '2020-04')).baris.find((x) => x.serviceId === svcVersi))
      .toBeUndefined();
  });

  it('angka beku menyimpan daftar tidak-terhitung, jadi bulan yang kurang lengkap terbaca', async () => {
    const { svcNull } = await seedLayanan();
    const hasil = await tutupBuku(sql, financeLead(), P1);
    expect(hasil.angka.tidakTerhitung.map((t) => t.serviceId)).toContain(svcNull);

    const beku = (await listVersi(sql, P1))[0];
    expect(beku.angka.tidakTerhitung.map((t) => t.serviceId)).toContain(svcNull);
  });
});

// ---------------------------------------------------------------------------
// Jurnal koreksi
// ---------------------------------------------------------------------------

describeDb('jurnal koreksi', () => {
  it('dicatat di bulan terbuka, atas bulan tertutup, dan terbaca kembali', async () => {
    await tutupBuku(sql, financeLead(), P1);
    const j = await catatJurnalKoreksi(sql, financeLead(), {
      periodeDikoreksi: P1,
      periodeCatat: P2,
      keterangan: 'invoice ganda CLI-1, dikembalikan',
      nilai: '-1500000.00',
    });
    expect(j.periodeDikoreksi).toBe(P1);
    expect(j.periodeCatat).toBe(P2);
    // Format rumah menaruh tanda minus DI DEPAN 'Rp.', bukan sesudahnya —
    // diambil dari money.format, bukan dari dugaan.
    expect(j.nilaiIdr).toBe('-Rp. 1.500.000,00');

    const daftar = await listJurnalKoreksi(sql, P1);
    expect(daftar).toHaveLength(1);
    expect(daftar[0].keterangan).toBe('invoice ganda CLI-1, dikembalikan');
  });

  it('menerima catatan TANPA nilai — null, bukan nol', async () => {
    await tutupBuku(sql, financeLead(), P1);
    const j = await catatJurnalKoreksi(sql, director(), {
      periodeDikoreksi: P1,
      periodeCatat: P2,
      keterangan: 'reklasifikasi, tanpa perubahan nilai',
    });
    expect(j.nilai).toBeNull();
    expect(j.nilaiIdr).toBeNull();
  });

  it('menolak mencatat ke bulan yang JUGA sudah tertutup', async () => {
    await tutupBuku(sql, financeLead(), P1);
    await tutupBuku(sql, financeLead(), P2);
    await expect(
      catatJurnalKoreksi(sql, financeLead(), {
        periodeDikoreksi: P1,
        periodeCatat: P2,
        keterangan: 'apa saja',
      }),
    ).rejects.toThrow(MSG_KOREKSI_BULAN_TERTUTUP);
  });

  it('menolak mengoreksi bulan yang masih terbuka — perbaiki datanya, jangan tulis catatan', async () => {
    await expect(
      catatJurnalKoreksi(sql, financeLead(), {
        periodeDikoreksi: P1,
        periodeCatat: P2,
        keterangan: 'apa saja',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('menolak peran yang tidak boleh menutup buku', async () => {
    await tutupBuku(sql, financeLead(), P1);
    await expect(
      catatJurnalKoreksi(sql, creativeLead(), {
        periodeDikoreksi: P1,
        periodeCatat: P2,
        keterangan: 'apa saja',
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('keterangan kosong ditolak', async () => {
    await tutupBuku(sql, financeLead(), P1);
    await expect(
      catatJurnalKoreksi(sql, financeLead(), {
        periodeDikoreksi: P1,
        periodeCatat: P2,
        keterangan: '   ',
      }),
    ).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Pagar bulan tertutup — TIGA arah, diuji lewat SQL karena di situlah ia hidup
// ---------------------------------------------------------------------------

describeDb('pagar bulan tertutup', () => {
  afterEach(async () => {
    // Urutannya mengikuti rantai FK dari daun ke akar. Salah urutan di sini
    // tidak bikin satu tes merah — ia bikin SEMUA tes sesudahnya merah dengan
    // pesan "duplicate key" yang tidak menyebut sebab sebenarnya.
    await bersihkanPeriode();
    await sql`delete from installments where created_by = 'ZZ-TEST'`;
    await sql`delete from payment_verifications where created_by = 'ZZ-TEST'`;
    await sql`delete from transactions where created_by = 'ZZ-TEST'`;
    await bersihkanLayanan();
  });

  async function seedTrx(): Promise<string> {
    const clientId = `ZZT-CLI-${RUN}`;
    const trxId = `ZZT-TRX-${RUN}`;
    await sql`insert into clients (id, nama_pic, toko, kota, link_toko, kategori,
                gmv_baseline, target_gmv, total_sales, sales_pic_id, commission_payment_pic_id, created_by)
              values (${clientId}, 'PIC', 'Toko Uji', 'Bandung', 'https://x', 'Fashion',
                      0, 0, 0, 'ZZ-TEST', 'ZZ-TEST', 'ZZ-TEST')
              on conflict (id) do nothing`;
    await sql`insert into transactions (id, client_id, payment_intent_scheme, total_agreed_value,
                payment_status, created_by)
              values (${trxId}, ${clientId}, 'Full', 1000000, '[Menunggu Verifikasi]', 'ZZ-TEST')`;
    return trxId;
  }

  const catat = (trx: string, tanggal: string) =>
    sql`insert into payment_verifications (transaction_id, amount, received_date, verified_by, created_by)
        values (${trx}, 1000, ${tanggal}::date, 'ZZ-TEST', 'ZZ-TEST')`;

  it('arah 1 — menulis KE bulan tertutup ditolak, bulan terbuka lolos', async () => {
    const trx = await seedTrx();
    await tutupBuku(sql, financeLead(), P1);
    await expect(catat(trx, '2020-01-15')).rejects.toThrow(/sudah ditutup/);
    // Kontrol: tanpa kontrol ini, tes di atas juga hijau kalau INSERT-nya
    // gagal karena sebab lain sama sekali.
    await expect(catat(trx, '2020-02-15')).resolves.toBeDefined();
  });

  it('arah 2 — memindahkan baris KELUAR dari bulan tertutup ditolak', async () => {
    const trx = await seedTrx();
    await catat(trx, '2020-01-15');
    await tutupBuku(sql, financeLead(), P1);
    // Ini arah yang paling mudah terlupa: mengubah angka Januari tanpa pernah
    // menulis satu baris pun BERTANGGAL Januari.
    await expect(
      sql`update payment_verifications set received_date = '2020-02-15'
           where transaction_id = ${trx}`,
    ).rejects.toThrow(/sudah ditutup/);
  });

  it('arah 3 — menghapus baris di bulan tertutup ditolak', async () => {
    const trx = await seedTrx();
    await catat(trx, '2020-01-15');
    await tutupBuku(sql, financeLead(), P1);
    await expect(
      sql`delete from payment_verifications where transaction_id = ${trx}`,
    ).rejects.toThrow(/sudah ditutup/);
  });

  it('pagar terangkat lagi begitu Director membuka bulannya', async () => {
    const trx = await seedTrx();
    await tutupBuku(sql, financeLead(), P1);
    await expect(catat(trx, '2020-01-15')).rejects.toThrow(/sudah ditutup/);
    await bukaBuku(sql, director(), P1, 'ada penerimaan yang terlewat');
    await expect(catat(trx, '2020-01-15')).resolves.toBeDefined();
  });

  it('installment tanpa tanggal verifikasi tidak kena pagar — ia belum masuk bulan mana pun', async () => {
    const trx = await seedTrx();
    await tutupBuku(sql, financeLead(), P1);
    await expect(
      sql`insert into installments (id, transaction_id, installment_no, amount, status, created_by)
          values (${`ZZT-INST-${RUN}`}, ${trx}, 1, 1000, '[Belum Jatuh Tempo]', 'ZZ-TEST')`,
    ).resolves.toBeDefined();
    await expect(
      sql`update installments set verified_date = '2020-01-20' where id = ${`ZZT-INST-${RUN}`}`,
    ).rejects.toThrow(/sudah ditutup/);
  });
});
