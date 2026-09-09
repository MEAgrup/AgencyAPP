/**
 * M19 — modul domain Creative Daily Ops: slot produksi, ketidaktersediaan PIC,
 * peringatan warn-not-block, dan angka turunan.
 *
 * ## SATU HAL YANG PALING MUDAH DIUJI TERBALIK
 *
 * Konflik studio dan PIC tidak tersedia **BERHASIL MENYIMPAN** dan hanya
 * mengembalikan `peringatan` (D3/D4). Sebuah tes yang meng-assert throw/4xx di
 * dua tempat itu sedang menguji perilaku yang SALAH — dan ia akan hijau kalau
 * seseorang "memperbaiki" modulnya menjadi memblokir. Karena itu tes di bawah
 * meng-assert KEDUANYA sekaligus: barisnya ada di DB, DAN pesannya ada di
 * `peringatan`.
 *
 * ⚠️ Koneksi tes ini BYPASSRLS. Hijau di sini tidak membuktikan apa pun soal
 * visibilitas — itu `dailyops-scope.rls.test.ts`.
 *
 * ⚠️ FK NO ACTION: `afterEach` menghapus slot SEBELUM clients/employees.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  canEnterActual,
  canManageSlot,
  canReadSchedule,
  canWriteUnavailability,
  createSlot,
  daySchedule,
  enterActual,
  getSlot,
  listStudios,
  listUnavailability,
  markUnavailable,
  ownRowsOnly,
  removeUnavailability,
  sameDaySummary,
  updateSlot,
  type Actor,
  type SlotInput,
} from './dailyops';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const PIC = 'ZDO-PIC';
const PIC2 = 'ZDO-PIC2';
const HARI = '2026-09-10';

const creativeLead = (): Actor => ({ employeeId: 'ZDO-LEAD', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
const creativeStaff = (id = PIC): Actor => ({ employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });
const adsLead = (): Actor => ({ employeeId: 'ZDO-ADSL', divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const am = (): Actor => ({ employeeId: 'ZDO-AM', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const od = (): Actor => ({ employeeId: 'ZDO-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZDO-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });
/** Peran BERLAPIS — staff yang juga OD. Kasus yang paling sering luput. */
const staffOD = (): Actor => ({ employeeId: PIC, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff', od: true }) });

let seq = 0;
let CLI = '';

const slot = (over: Partial<SlotInput> = {}): SlotInput => ({
  tanggal: HARI,
  clientId: CLI,
  studioCode: 'KASUARI',
  waktuMulai: '09:00',
  waktuSelesai: '12:00',
  assignedPic: PIC,
  jenisPaket: 'Paket A',
  taskType: 'Shoot',
  targetQty: 25,
  notes: null,
  ...over,
});

async function insClient(): Promise<string> {
  seq += 1;
  const cli = `ZDO-CLI-${seq}`;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${cli}, 'PIC', ${cli}, 'Bandung', 'link', 'Fashion', '0', '0', '0',
      'ZDO-SALES', 'ZDO-SALES', now(), 'ZDO-AM', 'ZDO-TEST')`;
  return cli;
}

/** Dua PIC yang sah: staff aktif yang `role_mappings`-nya memetakan ke Creative. */
async function insPics(): Promise<void> {
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('Creative', 'Videografer ZDO', 'Creative', 'staff', 'ZDO-TEST')
    on conflict do nothing`;
  for (const id of [PIC, PIC2]) {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${id}, ${'Nama ' + id}, ${id + '@mea.test'}, 'Creative', 'Videografer ZDO', true, 'ZDO-TEST')
      on conflict (employee_id) do nothing`;
  }
}

async function setup(): Promise<void> {
  await insPics();
  CLI = await insClient();
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from prod_slots where created_by like 'ZDO-%' or client_id like 'ZDO-CLI-%'`;
  await sql`delete from pic_unavailability where dicatat_oleh like 'ZDO-%' or employee_id like 'ZDO-%'`;
  await sql`delete from clients where id like 'ZDO-CLI-%'`;
  await sql`delete from employees where employee_id like 'ZDO-%'`;
  await sql`delete from role_mappings where created_by = 'ZDO-TEST'`;
});
afterAll(async () => { if (sql) await sql.end(); });

// ===========================================================================
// Izin — murni, tanpa DB. Matriks peran termasuk OD/Director berlapis.
// ===========================================================================

describe('matriks izin (PRD §5.6)', () => {
  it('canManageSlot: hanya lead Creative + Director', () => {
    const kasus: [string, Actor, boolean][] = [
      ['lead Creative (Leader Video)', creativeLead(), true],
      ['Director', director(), true],
      ['staff Creative', creativeStaff(), false],
      ['lead divisi LAIN', adsLead(), false],
      ['AM', am(), false],
      // OD adalah peran BACA. Kalau ini pernah jadi true, OD bisa menulis —
      // melanggar Phase 0 §4 ("OD = read-only everywhere + OKR").
      ['OD saja', od(), false],
    ];
    for (const [label, a, harap] of kasus) expect(canManageSlot(a), label).toBe(harap);
  });

  it('canEnterActual: PIC slot itu sendiri, lead Creative, Director — bukan PIC lain', () => {
    const kasus: [string, Actor, string, boolean][] = [
      ['PIC-nya sendiri', creativeStaff(PIC), PIC, true],
      ['PIC LAIN', creativeStaff(PIC2), PIC, false],
      ['lead Creative', creativeLead(), PIC, true],
      ['Director', director(), PIC, true],
      ['OD saja', od(), PIC, false],
      ['assigned_pic kosong tidak cocok dengan siapa pun', creativeStaff(''), '', false],
    ];
    for (const [label, a, pic, harap] of kasus) expect(canEnterActual(a, pic), label).toBe(harap);
  });

  it('canWriteUnavailability: Leader saja (D4 — BUKAN self-service PIC)', () => {
    expect(canWriteUnavailability(creativeLead())).toBe(true);
    expect(canWriteUnavailability(director())).toBe(true);
    // Inti D4: PIC tidak mencatat ketidaktersediaannya sendiri.
    expect(canWriteUnavailability(creativeStaff())).toBe(false);
    expect(canWriteUnavailability(od())).toBe(false);
    expect(canWriteUnavailability(adsLead())).toBe(false);
  });

  it('canReadSchedule + ownRowsOnly: staff lihat barisnya sendiri, lead se-divisi, OD/Director semua', () => {
    expect(canReadSchedule(creativeLead())).toBe(true);
    expect(ownRowsOnly(creativeLead())).toBe(false);
    expect(canReadSchedule(creativeStaff())).toBe(true);
    expect(ownRowsOnly(creativeStaff())).toBe(true);
    expect(canReadSchedule(od())).toBe(true);
    expect(ownRowsOnly(od())).toBe(false);
    expect(canReadSchedule(director())).toBe(true);
    expect(ownRowsOnly(director())).toBe(false);
    // Divisi lain tidak punya urusan dengan jadwal produksi Creative.
    expect(canReadSchedule(adsLead())).toBe(false);
    expect(canReadSchedule(am())).toBe(false);
  });

  it('peran BERLAPIS staff+OD: boleh baca semua baris, TETAP tidak boleh menulis', () => {
    // Kasus yang paling sering luput. `od: true` melebarkan BACA-nya sampai
    // seluruh divisi, tapi tidak memberinya satu pun hak tulis di modul ini.
    const a = staffOD();
    expect(canReadSchedule(a)).toBe(true);
    expect(ownRowsOnly(a)).toBe(false);
    expect(canManageSlot(a)).toBe(false);
    expect(canWriteUnavailability(a)).toBe(false);
    // Ia tetap PIC-nya sendiri, jadi menutup slotnya sendiri tetap boleh.
    expect(canEnterActual(a, PIC)).toBe(true);
    expect(canEnterActual(a, PIC2)).toBe(false);
  });
});

describe('listStudios — registry, bukan tabel bebas', () => {
  it('empat studio aktif, urut, dan `Luar Kantor` satu-satunya tanpa cek konflik', () => {
    const s = listStudios();
    expect(s.map((x) => x.code)).toEqual(['KASUARI', 'RAJAWALI', 'CEMPAKA', 'LUAR_KANTOR']);
    expect(s.filter((x) => !x.cekKonflik).map((x) => x.code)).toEqual(['LUAR_KANTOR']);
  });
});

// ===========================================================================
// createSlot
// ===========================================================================

describeDb('createSlot — rencana, bukan deliverable', () => {
  it('lead mencetak baris ber-id SLOT- + baris audit, tanpa peringatan, tanpa status', async () => {
    await setup();
    const r = await createSlot(sql, creativeLead(), slot());
    expect(r.slot.id).toMatch(/^SLOT-\d{6}-\d{4}$/);
    expect(r.peringatan).toEqual([]);
    expect(r.slot.targetQty).toBe(25);
    // Belum ditutup: null, BUKAN nol — dan turunannya ikut null.
    expect(r.slot.actualQty).toBeNull();
    expect(r.slot.sisaQty).toBeNull();
    expect(r.slot.penyelesaianPct).toBeNull();
    expect(r.slot.studioNama).toBe('Kasuari');
    expect(r.slot.tanggal).toBe(HARI);
    expect(r.slot.waktuMulai).toBe('09:00');
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_id = ${r.slot.id} and action = 'slot_created'`;
    expect(audit[0].n).toBe(1);
  });

  it('slot TIDAK punya kolom status sama sekali — nol mesin (Rule 1/D1)', async () => {
    // Kalau seseorang menambahkan `status` ke prod_slots, D1 dibatalkan tanpa
    // entri DECISIONS.md dan CDPS punya engine lifecycle kedua.
    const kolom = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'prod_slots' and column_name = 'status'`;
    expect(kolom).toEqual([]);
  });

  it('staff dan OD ditolak; lead divisi lain ditolak', async () => {
    await setup();
    await expect(createSlot(sql, creativeStaff(), slot())).rejects.toThrow(ForbiddenError);
    await expect(createSlot(sql, od(), slot())).rejects.toThrow(ForbiddenError);
    await expect(createSlot(sql, adsLead(), slot())).rejects.toThrow(ForbiddenError);
  });

  it('PIC harus staff Creative AKTIF — gerbang M7 dipakai ulang, bukan ditulis kedua', async () => {
    await setup();
    // Karyawan dinonaktifkan di HRIS ⇒ berhenti bisa dijadwalkan pada sync
    // berikutnya, tanpa kode tambahan di modul ini.
    // Galatnya datang dari `creative.validateCreativeStaff` dan karena itu
    // ber-nama `CreativeValidationError`, BUKAN `DailyOpsValidationError` — dan
    // itu memang yang benar: satu definisi "staff Creative aktif", bukan dua.
    // `http.ts` mem-dispatch pada `Error.name` dan nama itu sudah terdaftar,
    // jadi route tetap menjawab 400 dengan pesan BI yang sama. Yang di-assert
    // di sini PESANNYA — yang dilihat pengguna — bukan kelasnya.
    const MSG_PIC = '[PIC tidak valid: harus staff divisi Creative yang aktif]';
    await sql`update employees set status_aktif = false where employee_id = ${PIC}`;
    await expect(createSlot(sql, creativeLead(), slot())).rejects.toThrow(MSG_PIC);
    await sql`update employees set status_aktif = true where employee_id = ${PIC}`;
    // Orang yang tidak dikenal sama sekali.
    await expect(createSlot(sql, creativeLead(), slot({ assignedPic: 'ZDO-HANTU' })))
      .rejects.toThrow(MSG_PIC);
  });

  it('ID dicetak HANYA sesudah validasi lolos (aturan rumah #1)', async () => {
    await setup();
    // Tabelnya `id_sequences (prefix, period, next_n)` — lihat
    // `20260722060601_ident_next.sql`. Bukan "ident_sequences.seq".
    const nextN = async () => (await sql<{ n: string }[]>`
      select coalesce(max(next_n)::text, '0') as n from id_sequences where prefix = 'SLOT'`)[0].n;
    const sebelum = await nextN();
    await expect(createSlot(sql, creativeLead(), slot({ targetQty: 0 }))).rejects.toThrow(ValidationError);
    const sesudah = await nextN();
    expect(sesudah).toBe(sebelum);
  });
});

describeDb('validasi yang MENOLAK — omong kosong aritmetik, bukan penilaian manusia', () => {
  it('setiap pesan BI di-assert ke KONSTANTA, bukan literal', async () => {
    await setup();
    const lead = creativeLead();
    const { MSG_DATA_TIDAK_LENGKAP, MSG_TARGET_HARUS_POSITIF, MSG_STUDIO_TIDAK_DIKENAL,
            MSG_JENIS_TASK_TIDAK_DIKENAL, MSG_RENTANG_WAKTU_TIDAK_VALID } = await import('./dailyops');
    await expect(createSlot(sql, lead, slot({ clientId: '' }))).rejects.toThrow(MSG_DATA_TIDAK_LENGKAP);
    await expect(createSlot(sql, lead, slot({ targetQty: 0 }))).rejects.toThrow(MSG_TARGET_HARUS_POSITIF);
    await expect(createSlot(sql, lead, slot({ targetQty: -3 }))).rejects.toThrow(MSG_TARGET_HARUS_POSITIF);
    await expect(createSlot(sql, lead, slot({ studioCode: 'GUDANG' }))).rejects.toThrow(MSG_STUDIO_TIDAK_DIKENAL);
    await expect(createSlot(sql, lead, slot({ taskType: 'Shooting' }))).rejects.toThrow(MSG_JENIS_TASK_TIDAK_DIKENAL);
    await expect(createSlot(sql, lead, slot({ waktuMulai: '12:00', waktuSelesai: '09:00' })))
      .rejects.toThrow(MSG_RENTANG_WAKTU_TIDAK_VALID);
    // Sama waktu = rentang nol, bukan slot.
    await expect(createSlot(sql, lead, slot({ waktuMulai: '09:00', waktuSelesai: '09:00' })))
      .rejects.toThrow(MSG_RENTANG_WAKTU_TIDAK_VALID);
  });
});

// ===========================================================================
// WARN-NOT-BLOCK — inti D3/D4.
// ===========================================================================

describeDb('konflik studio MEMPERINGATKAN dan TETAP MENYIMPAN (Rule 8/D3)', () => {
  it('slot kedua yang bertumpang tersimpan, dengan pesan yang menyebut nama studio', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot({ waktuMulai: '09:00', waktuSelesai: '12:00' }));
    expect(a.peringatan).toEqual([]);
    // Contoh PRD §4: Kasuari 11.00–14.00 bertumpang 11.00–12.00 dengan slot 1.
    const b = await createSlot(sql, creativeLead(), slot({
      waktuMulai: '11:00', waktuSelesai: '14:00', assignedPic: PIC2, targetQty: 15,
    }));
    expect(b.peringatan).toEqual(['[studio Kasuari sudah dipakai pada rentang waktu ini]']);
    // ⚠️ INTI TESNYA: barisnya BENAR-BENAR ADA. Tes yang hanya memeriksa
    // pesannya akan tetap hijau kalau modulnya berubah jadi memblokir.
    const ada = await sql<{ n: number }[]>`
      select count(*)::int as n from prod_slots where id = ${b.slot.id}`;
    expect(ada[0].n).toBe(1);
    expect(b.slot.targetQty).toBe(15);
  });

  it('slot BERSAMBUNG (12.00 sesudah 09.00–12.00) BUKAN konflik — setengah terbuka', async () => {
    await setup();
    await createSlot(sql, creativeLead(), slot({ waktuMulai: '09:00', waktuSelesai: '12:00' }));
    const b = await createSlot(sql, creativeLead(), slot({
      waktuMulai: '12:00', waktuSelesai: '14:00', assignedPic: PIC2,
    }));
    // Jadwal yang berurutan rapi adalah jadwal paling benar; memperingatkannya
    // melatih orang mengabaikan peringatan.
    expect(b.peringatan).toEqual([]);
  });

  it('studio BERBEDA pada jam yang sama bukan konflik', async () => {
    await setup();
    await createSlot(sql, creativeLead(), slot({ studioCode: 'KASUARI' }));
    const b = await createSlot(sql, creativeLead(), slot({
      studioCode: 'RAJAWALI', assignedPic: PIC2,
    }));
    expect(b.peringatan).toEqual([]);
  });

  it('`Luar Kantor` TIDAK pernah memperingatkan konflik, betapa pun bertumpang', async () => {
    await setup();
    await createSlot(sql, creativeLead(), slot({ studioCode: 'LUAR_KANTOR' }));
    const b = await createSlot(sql, creativeLead(), slot({
      studioCode: 'LUAR_KANTOR', assignedPic: PIC2,
      waktuMulai: '09:30', waktuSelesai: '11:00',
    }));
    expect(b.peringatan).toEqual([]);
  });

  it('tanggal BERBEDA di studio yang sama bukan konflik', async () => {
    await setup();
    await createSlot(sql, creativeLead(), slot());
    const b = await createSlot(sql, creativeLead(), slot({ tanggal: '2026-09-11', assignedPic: PIC2 }));
    expect(b.peringatan).toEqual([]);
  });

  it('updateSlot tidak melaporkan slot bertumpang dengan DIRINYA SENDIRI', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot());
    const u = await updateSlot(sql, creativeLead(), a.slot.id, slot({ targetQty: 30 }));
    expect(u.peringatan).toEqual([]);
    expect(u.slot.targetQty).toBe(30);
  });
});

describeDb('PIC tidak tersedia MEMPERINGATKAN dan TETAP MENYIMPAN (Rule 9/D4)', () => {
  it('menjadwalkan orang yang CUTI tersimpan, dengan peringatannya', async () => {
    await setup();
    await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Cuti', catatan: null,
    });
    const r = await createSlot(sql, creativeLead(), slot());
    expect(r.peringatan).toEqual(['[PIC tidak tersedia pada tanggal ini]']);
    const ada = await sql<{ n: number }[]>`
      select count(*)::int as n from prod_slots where id = ${r.slot.id}`;
    expect(ada[0].n).toBe(1);
  });

  it('rentang cuti INKLUSIF di kedua ujung', async () => {
    await setup();
    await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: '2026-09-10', tanggalSelesai: '2026-09-12',
      alasan: 'Sakit', catatan: null,
    });
    for (const t of ['2026-09-10', '2026-09-11', '2026-09-12']) {
      const r = await createSlot(sql, creativeLead(), slot({ tanggal: t }));
      expect(r.peringatan, `dalam rentang: ${t}`).toContain('[PIC tidak tersedia pada tanggal ini]');
    }
    for (const t of ['2026-09-09', '2026-09-13']) {
      const r = await createSlot(sql, creativeLead(), slot({ tanggal: t }));
      expect(r.peringatan, `di luar rentang: ${t}`).toEqual([]);
    }
  });

  it('cuti orang LAIN tidak memperingatkan slot ini', async () => {
    await setup();
    await markUnavailable(sql, creativeLead(), {
      employeeId: PIC2, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Izin', catatan: null,
    });
    const r = await createSlot(sql, creativeLead(), slot({ assignedPic: PIC }));
    expect(r.peringatan).toEqual([]);
  });

  it('KEDUA peringatan bisa muncul bersamaan, dan barisnya tetap tersimpan', async () => {
    await setup();
    await createSlot(sql, creativeLead(), slot({ assignedPic: PIC2 }));
    await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Cuti', catatan: null,
    });
    const r = await createSlot(sql, creativeLead(), slot({ assignedPic: PIC }));
    expect(r.peringatan.slice().sort()).toEqual([
      '[PIC tidak tersedia pada tanggal ini]',
      '[studio Kasuari sudah dipakai pada rentang waktu ini]',
    ].sort());
    const ada = await sql<{ n: number }[]>`
      select count(*)::int as n from prod_slots where id = ${r.slot.id}`;
    expect(ada[0].n).toBe(1);
  });

  it('peringatan yang diterima ikut tercatat di audit — bukan toast yang hilang', async () => {
    await setup();
    await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Cuti', catatan: null,
    });
    const r = await createSlot(sql, creativeLead(), slot());
    const rows = await sql<{ after_json: { peringatan?: string[] } }[]>`
      select after_json from audit_log
       where entity_id = ${r.slot.id} and action = 'slot_created'`;
    expect(rows[0].after_json.peringatan).toEqual(['[PIC tidak tersedia pada tanggal ini]']);
  });
});

// ===========================================================================
// enterActual + angka turunan
// ===========================================================================

describeDb('enterActual — menutup slot, tanpa auto-rollover', () => {
  it('PIC menutup slotnya sendiri; turunan dihitung saat baca', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot({ targetQty: 15 }));
    const r = await enterActual(sql, creativeStaff(PIC), a.slot.id, 9);
    // Contoh PRD §4: Alvi 9/15 = 60%.
    expect(r.actualQty).toBe(9);
    expect(r.sisaQty).toBe(6);
    expect(r.penyelesaianPct).toBe(60);
  });

  it('aktual > target ditolak dengan pesan BI-nya', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot({ targetQty: 15 }));
    const { MSG_AKTUAL_MELEBIHI_TARGET } = await import('./dailyops');
    await expect(enterActual(sql, creativeLead(), a.slot.id, 16))
      .rejects.toThrow(MSG_AKTUAL_MELEBIHI_TARGET);
    // DB pun menolaknya — gerbangnya dua kali, bukan sekali.
    await expect(
      sql`update prod_slots set actual_qty = 99 where id = ${a.slot.id}`,
    ).rejects.toThrow();
  });

  it('aktual 0 SAH dan berbeda dari "belum ditutup"', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot({ targetQty: 15 }));
    const r = await enterActual(sql, creativeLead(), a.slot.id, 0);
    // Beda yang penting: 0 = "sesi jalan, nol unit selesai"; null = "belum
    // ditutup". Men-default-kan null ke 0 membuat keduanya tak terbedakan.
    expect(r.actualQty).toBe(0);
    expect(r.sisaQty).toBe(15);
    expect(r.penyelesaianPct).toBe(0);
  });

  it('PIC LAIN tidak boleh menutup slot orang', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot({ assignedPic: PIC }));
    await expect(enterActual(sql, creativeStaff(PIC2), a.slot.id, 5)).rejects.toThrow(ForbiddenError);
    await expect(enterActual(sql, od(), a.slot.id, 5)).rejects.toThrow(ForbiddenError);
  });

  it('sisa TIDAK di-rollover otomatis — slot lama mempertahankan angkanya (Flow 7)', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot({ targetQty: 15 }));
    await enterActual(sql, creativeLead(), a.slot.id, 9);
    // Nol slot baru muncul sendiri, dan slot pertama tetap 9/15 yang jujur.
    const jumlah = await sql<{ n: number }[]>`
      select count(*)::int as n from prod_slots where client_id = ${CLI}`;
    expect(jumlah[0].n).toBe(1);
    const tetap = await getSlot(sql, creativeLead(), a.slot.id);
    expect([tetap.actualQty, tetap.targetQty]).toEqual([9, 15]);
  });

  it('updateSlot tidak bisa menurunkan target di bawah aktual yang sudah tercatat', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot({ targetQty: 15 }));
    await enterActual(sql, creativeLead(), a.slot.id, 9);
    const { MSG_AKTUAL_MELEBIHI_TARGET } = await import('./dailyops');
    // Kalau ini lolos, penyelesaian bisa > 100% dan constraint DB akan pecah
    // dengan pesan mentah yang bukan bahasa pengguna.
    await expect(updateSlot(sql, creativeLead(), a.slot.id, slot({ targetQty: 5 })))
      .rejects.toThrow(MSG_AKTUAL_MELEBIHI_TARGET);
  });
});

describeDb('angka turunan — dihitung dari baris, nol kolom penyimpan', () => {
  it('pembagian nol menghasilkan null (⇒ FE render "—"), bukan 0 dan bukan galat', async () => {
    await setup();
    // Aturan rumah #7. Nol yang dikirim sebagai angka terbaca sebagai
    // "0% tercapai" — pernyataan tentang kinerja orang yang datanya belum ada.
    const ringkas = await sameDaySummary(sql, creativeLead(), HARI, HARI);
    expect(ringkas).toEqual([]);
    const a = await createSlot(sql, creativeLead(), slot());
    const belum = await sameDaySummary(sql, creativeLead(), HARI, HARI);
    expect(belum[0].slotFillPct).toBe(0);
    // Σtarget = 25, Σactual = 0 karena belum ditutup ⇒ 0%, bukan null.
    expect(belum[0].penyelesaianPct).toBe(0);
    expect(a.slot.penyelesaianPct).toBeNull();
  });

  it('sameDaySummary menjumlahkan per PIC dan menghitung slot fill', async () => {
    await setup();
    const lead = creativeLead();
    // Contoh PRD §4: Killa 25/25, Alvi 9/15.
    const s1 = await createSlot(sql, lead, slot({ assignedPic: PIC, targetQty: 25 }));
    const s2 = await createSlot(sql, lead, slot({
      assignedPic: PIC2, targetQty: 15, studioCode: 'RAJAWALI',
    }));
    const s3 = await createSlot(sql, lead, slot({
      assignedPic: PIC2, targetQty: 5, studioCode: 'CEMPAKA',
    }));
    await enterActual(sql, lead, s1.slot.id, 25);
    await enterActual(sql, lead, s2.slot.id, 9);
    // s3 sengaja TIDAK ditutup ⇒ slot fill PIC2 = 1/2.
    void s3;
    const ringkas = await sameDaySummary(sql, lead, HARI, HARI);
    const byId = Object.fromEntries(ringkas.map((r) => [r.employeeId, r]));
    expect(byId[PIC].penyelesaianPct).toBe(100);
    expect(byId[PIC].slotFillPct).toBe(100);
    expect(byId[PIC2].totalTarget).toBe(20);
    expect(byId[PIC2].totalActual).toBe(9);
    expect(byId[PIC2].penyelesaianPct).toBe(45);
    expect(byId[PIC2].slotFillPct).toBe(50);
  });

  it('membaca angka turunan TIDAK menulis apa pun (nol jalur mutasi)', async () => {
    await setup();
    const lead = creativeLead();
    const a = await createSlot(sql, lead, slot());
    await enterActual(sql, lead, a.slot.id, 20);
    const hitung = async (t: string) =>
      (await sql<{ n: number }[]>`select count(*)::int as n from ${sql(t)}`)[0].n;
    const [auditSebelum, slotSebelum] = [await hitung('audit_log'), await hitung('prod_slots')];
    await sameDaySummary(sql, lead, HARI, HARI);
    await daySchedule(sql, lead, HARI);
    await getSlot(sql, lead, a.slot.id);
    expect(await hitung('audit_log')).toBe(auditSebelum);
    expect(await hitung('prod_slots')).toBe(slotSebelum);
  });

  it('angka turunan bisa dihitung ULANG dari baris — nol kolom yang menyimpannya', async () => {
    await setup();
    const a = await createSlot(sql, creativeLead(), slot({ targetQty: 15 }));
    await enterActual(sql, creativeLead(), a.slot.id, 9);
    const mentah = await sql<{ target_qty: number; actual_qty: number }[]>`
      select target_qty, actual_qty from prod_slots where id = ${a.slot.id}`;
    const r = await getSlot(sql, creativeLead(), a.slot.id);
    // Satu-satunya sumbernya dua kolom itu; tidak ada `sisa`/`persen` tersimpan.
    expect(r.sisaQty).toBe(Number(mentah[0].target_qty) - Number(mentah[0].actual_qty));
    expect(r.penyelesaianPct).toBe(
      Math.round((Number(mentah[0].actual_qty) / Number(mentah[0].target_qty)) * 10000) / 100,
    );
  });
});

// ===========================================================================
// daySchedule
// ===========================================================================

describeDb('daySchedule — bentuk yang dirender grid', () => {
  it('SELURUH studio aktif jadi kolom, termasuk yang nol slot', async () => {
    await setup();
    await createSlot(sql, creativeLead(), slot({ studioCode: 'KASUARI' }));
    const d = await daySchedule(sql, creativeLead(), HARI);
    // Kolom kosong itu informasi ("ruangan itu bebas"), bukan hiasan.
    expect(d.studios.map((s) => s.code)).toEqual(['KASUARI', 'RAJAWALI', 'CEMPAKA', 'LUAR_KANTOR']);
    expect(d.studios.find((s) => s.code === 'RAJAWALI')?.slots).toEqual([]);
    expect(d.studios.find((s) => s.code === 'KASUARI')?.slots.length).toBe(1);
  });

  it('slot bertumpang di satu studio KEDUANYA terlihat — tumpang-tindih diizinkan, jadi harus terbaca', async () => {
    await setup();
    await createSlot(sql, creativeLead(), slot({ waktuMulai: '09:00', waktuSelesai: '12:00' }));
    await createSlot(sql, creativeLead(), slot({
      waktuMulai: '11:00', waktuSelesai: '14:00', assignedPic: PIC2,
    }));
    const d = await daySchedule(sql, creativeLead(), HARI);
    const kasuari = d.studios.find((s) => s.code === 'KASUARI');
    expect(kasuari?.slots.length).toBe(2);
    // Urut waktu mulai, supaya grid bisa menumpuknya secara deterministik.
    expect(kasuari?.slots.map((s) => s.waktuMulai)).toEqual(['09:00', '11:00']);
  });

  it('PIC yang tidak tersedia hari itu ikut terbawa — Leader melihatnya SAAT merencanakan', async () => {
    await setup();
    await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Cuti', catatan: 'acara keluarga',
    });
    const d = await daySchedule(sql, creativeLead(), HARI);
    expect(d.tidakTersedia.map((u) => [u.employeeId, u.alasan])).toEqual([[PIC, 'Cuti']]);
  });

  it('total target dan aktual satu hari', async () => {
    await setup();
    const lead = creativeLead();
    const a = await createSlot(sql, lead, slot({ targetQty: 25 }));
    await createSlot(sql, lead, slot({ targetQty: 15, studioCode: 'RAJAWALI', assignedPic: PIC2 }));
    await enterActual(sql, lead, a.slot.id, 20);
    const d = await daySchedule(sql, lead, HARI);
    expect(d.totalTarget).toBe(40);
    // Slot kedua belum ditutup ⇒ tidak menyumbang, dan tidak dihitung nol.
    expect(d.totalActual).toBe(20);
  });

  it('staff Creative biasa hanya melihat barisnya sendiri', async () => {
    await setup();
    const lead = creativeLead();
    await createSlot(sql, lead, slot({ assignedPic: PIC }));
    await createSlot(sql, lead, slot({ assignedPic: PIC2, studioCode: 'RAJAWALI' }));
    const semua = await daySchedule(sql, lead, HARI);
    expect(semua.studios.flatMap((s) => s.slots).length).toBe(2);
    const sendiri = await daySchedule(sql, creativeStaff(PIC), HARI);
    const barisnya = sendiri.studios.flatMap((s) => s.slots);
    expect(barisnya.length).toBe(1);
    expect(barisnya[0].assignedPic).toBe(PIC);
  });

  it('divisi lain ditolak; tanggal ngawur ditolak', async () => {
    await setup();
    await expect(daySchedule(sql, adsLead(), HARI)).rejects.toThrow(ForbiddenError);
    await expect(daySchedule(sql, creativeLead(), '10-09-2026')).rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
// Ketidaktersediaan — batas HRIS
// ===========================================================================

describeDb('markUnavailable / removeUnavailability — jadwal, bukan manajemen cuti', () => {
  it('Leader mencatat; PIC sendiri TIDAK bisa (D4)', async () => {
    await setup();
    const r = await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Cuti', catatan: null,
    });
    expect(r.alasan).toBe('Cuti');
    expect(r.dicatatOleh).toBe('ZDO-LEAD');
    await expect(markUnavailable(sql, creativeStaff(PIC), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Cuti', catatan: null,
    })).rejects.toThrow(ForbiddenError);
  });

  it('alasan di luar empat nilai ditolak — taksonomi cuti HR tidak boleh menyelinap masuk', async () => {
    await setup();
    const { MSG_ALASAN_TIDAK_DIKENAL, MSG_RENTANG_TANGGAL_TIDAK_VALID } = await import('./dailyops');
    await expect(markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI,
      alasan: 'Cuti Tahunan', catatan: null,
    })).rejects.toThrow(MSG_ALASAN_TIDAK_DIKENAL);
    await expect(markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: '2026-09-12', tanggalSelesai: '2026-09-10',
      alasan: 'Cuti', catatan: null,
    })).rejects.toThrow(MSG_RENTANG_TANGGAL_TIDAK_VALID);
  });

  it('bisa DICABUT tapi TIDAK bisa disunting (immutability)', async () => {
    await setup();
    const r = await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Cuti', catatan: null,
    });
    // Menyunting rentangnya sesudah jadwal disusun di atasnya mengubah arti
    // peringatan yang sudah ditampilkan. Ditolak dari koneksi PALING berwenang
    // yang ada (BYPASSRLS) — jadi ini benar-benar dinding, bukan gerbang TS.
    await expect(
      sql`update pic_unavailability set alasan = 'Sakit' where id = ${r.id}`,
    ).rejects.toThrow(/append-only|immutable/i);
    await removeUnavailability(sql, creativeLead(), r.id);
    const sisa = await listUnavailability(sql, creativeLead(), HARI, HARI);
    expect(sisa.filter((u) => u.id === r.id)).toEqual([]);
    // Pencabutannya sendiri tercatat.
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_id = ${String(r.id)} and action = 'pic_unavailability_removed'`;
    expect(audit[0].n).toBe(1);
  });

  it('mencabut yang tidak ada memberi NotFound, bukan sukses hening', async () => {
    await setup();
    await expect(removeUnavailability(sql, creativeLead(), 987654321))
      .rejects.toThrow(NotFoundError);
  });

  it('staff ditolak mencabut', async () => {
    await setup();
    const r = await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: HARI, tanggalSelesai: HARI, alasan: 'Cuti', catatan: null,
    });
    await expect(removeUnavailability(sql, creativeStaff(PIC), r.id)).rejects.toThrow(ForbiddenError);
  });

  it('listUnavailability memotong rentang yang BERSINGGUNGAN, bukan hanya yang termuat penuh', async () => {
    await setup();
    await markUnavailable(sql, creativeLead(), {
      employeeId: PIC, tanggalMulai: '2026-09-08', tanggalSelesai: '2026-09-15',
      alasan: 'Dinas Luar', catatan: null,
    });
    // Cuti seminggu yang MELINGKUPI jendela yang ditanyakan harus tetap muncul.
    const r = await listUnavailability(sql, creativeLead(), '2026-09-10', '2026-09-11');
    expect(r.length).toBe(1);
    const luar = await listUnavailability(sql, creativeLead(), '2026-09-20', '2026-09-21');
    expect(luar).toEqual([]);
  });
});

// ===========================================================================
// D5 — angka ini tidak pernah sampai ke Modul 14.
// ===========================================================================

describe('D5 — penyelesaian hari-sama TIDAK terhubung ke Modul 14', () => {
  it('performance.ts tidak mengimpor `dailyops` sama sekali', async () => {
    // D2 dan D5 menunjuk arah berbeda dan itu disengaja; yang tidak boleh
    // terjadi adalah keduanya tercampur saat dibangun. Kalau `performance.ts`
    // suatu saat mengimpor modul ini, D5 sedang dibatalkan tanpa entri
    // DECISIONS.md — dan baris inilah yang merah lebih dulu.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'performance.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\/dailyops'/);
    expect(src).not.toMatch(/dailyops/);
  });
});
