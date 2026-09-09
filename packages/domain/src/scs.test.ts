/**
 * M19 separuh SCS — modul domain `SMO & Content Strategist`.
 *
 * ## TIGA HAL YANG PALING MUDAH DIUJI TERBALIK DI SINI
 *
 * 1. **`clientId` null adalah kasus SAH, bukan galat.** Baris `all client:
 *    Brief` di sheet tidak punya klien, dan itulah SELURUH alasan modul ini
 *    berdiri sendiri alih-alih jadi Task M12 keempat. Sebuah tes yang
 *    meng-assert throw untuk `clientId: null` sedang menguji perilaku yang
 *    SALAH — dan ia akan hijau kalau seseorang "merapikan" `client_id` jadi
 *    wajib.
 * 2. **Speed Score Kategori standing adalah `'N/A'`, bukan `'0%'` dan bukan
 *    galat.** Kategori standing tidak punya SLA dengan sengaja; `'0%'` adalah
 *    pernyataan tentang kecepatan seseorang atas pekerjaan yang tidak pernah
 *    di-SLA-kan.
 * 3. **Angka turunan datang dari `audit_log`, bukan dari kolom.** Tes recompute
 *    di bawah menjalankan seluruh siklus lewat `sm_transition` lalu membaca
 *    angkanya — kalau ada yang menambahkan kolom jangkar, tes itu tetap hijau
 *    tapi `scs.registry.test.ts` yang merah.
 *
 * ⚠️ Koneksi tes ini BYPASSRLS. Hijau di sini tidak membuktikan apa pun soal
 * visibilitas — itu `scs-scope.rls.test.ts`.
 *
 * ⚠️ FK NO ACTION: `afterEach` menghapus baris SCS sebelum clients/employees.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  ConflictError,
  ForbiddenError,
  MSG_KATEGORI_TIDAK_AKTIF,
  MSG_KATEGORI_TIDAK_DIKENAL,
  MSG_LINK_HASIL_WAJIB,
  MSG_STANDING_TANPA_SLA,
  MSG_TARGET_HARUS_POSITIF,
  NotFoundError,
  STATUS_APPROVED,
  STATUS_BLOCKED,
  STATUS_IN_PROGRESS,
  STATUS_IN_REVIEW,
  STATUS_REVISION_REQ,
  STATUS_SUBMITTED,
  STATUS_TODO,
  ValidationError,
  approveScsTask,
  blockScsTask,
  canManageKategori,
  canManageTask,
  canReadQueue,
  canReviewTask,
  canWorkTask,
  createKategori,
  createScsTask,
  deleteScsTask,
  getScsTask,
  listKategori,
  openReviewScsTask,
  ownRowsOnly,
  queueScsTasks,
  requestRevisionScsTask,
  resumeScsTask,
  scsPicSummary,
  scsTaskMetrics,
  startScsTask,
  submitScsTask,
  unblockScsTask,
  updateKategori,
  updateScsTask,
  type Actor,
  type ScsTaskInput,
} from './scs';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const PIC = 'ZSC-PIC';
const PIC2 = 'ZSC-PIC2';
const HARI = '2026-09-10';

const creativeLead = (): Actor => ({ employeeId: 'ZSC-LEAD', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
const creativeStaff = (id = PIC): Actor => ({ employeeId: id, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });
const adsLead = (): Actor => ({ employeeId: 'ZSC-ADSL', divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const am = (): Actor => ({ employeeId: 'ZSC-AM', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const od = (): Actor => ({ employeeId: 'ZSC-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZSC-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });
/** Peran BERLAPIS — staff yang juga OD. Kasus yang paling sering luput. */
const staffOD = (): Actor => ({ employeeId: PIC, divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff', od: true }) });

let seq = 0;
let CLI = '';

const baris = (over: Partial<ScsTaskInput> = {}): ScsTaskInput => ({
  tanggal: HARI,
  kategoriKode: 'SCRIPT',
  judul: 'Script mamimegol',
  clientId: CLI,
  mendukungDivisi: null,
  assignedPic: PIC,
  targetQty: 7,
  catatan: null,
  ...over,
});

async function insClient(): Promise<string> {
  seq += 1;
  const cli = `ZSC-CLI-${seq}`;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${cli}, 'PIC', ${cli}, 'Bandung', 'link', 'Fashion', '0', '0', '0',
      'ZSC-SALES', 'ZSC-SALES', now(), 'ZSC-AM', 'ZSC-TEST')`;
  return cli;
}

async function insPics(): Promise<void> {
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('Creative', 'SMO ZSC', 'Creative', 'staff', 'ZSC-TEST')
    on conflict do nothing`;
  for (const id of [PIC, PIC2]) {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${id}, ${'Nama ' + id}, ${id + '@mea.test'}, 'Creative', 'SMO ZSC', true, 'ZSC-TEST')
      on conflict (employee_id) do nothing`;
  }
  // Lead + Director dipakai sebagai `created_by` (FK ke employees).
  for (const [id, jab] of [['ZSC-LEAD', 'Leader ZSC'], ['ZSC-DIR', 'Direktur ZSC']] as const) {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${id}, ${'Nama ' + id}, ${id + '@mea.test'}, 'Creative', ${jab}, true, 'ZSC-TEST')
      on conflict (employee_id) do nothing`;
  }
}

async function setup(): Promise<void> {
  await insPics();
  CLI = await insClient();
}

afterEach(async () => {
  if (!sql) return;
  // `audit_log` SENGAJA tidak dibersihkan: ia append-only dan trigger
  // `forbid_mutation` menolak DELETE bahkan dari koneksi service-role. Itu
  // aturan rumah #3 yang bekerja — baris jejak `ZSC-` yang tertinggal adalah
  // harga yang benar untuk riwayat yang tidak bisa dihapus siapa pun.
  // Trigger `trg_scs_tasks_hapus_hanya_todo` menolak DELETE pada baris yang
  // sudah lewat [To Do] — termasuk dari koneksi ini, dan itu memang gunanya.
  // Teardown karena itu mematikannya secara EKSPLISIT untuk baris `ZSC-`
  // sendiri; sebuah teardown yang diam-diam gagal akan menumpuk baris antar-run
  // dan membuat hitungan tes berikutnya salah (persis yang terjadi saat berkas
  // ini pertama dijalankan).
  await sql`alter table scs_tasks disable trigger trg_scs_tasks_hapus_hanya_todo`;
  await sql`delete from scs_tasks where created_by like 'ZSC-%' or client_id like 'ZSC-CLI-%'`;
  await sql`alter table scs_tasks enable trigger trg_scs_tasks_hapus_hanya_todo`;
  await sql`delete from scs_kategori where kode like 'ZSC%'`;
  await sql`delete from clients where id like 'ZSC-CLI-%'`;
  await sql`delete from employees where employee_id like 'ZSC-%'`;
  await sql`delete from role_mappings where created_by = 'ZSC-TEST'`;
});
afterAll(async () => { if (sql) await sql.end(); });

// ===========================================================================
// Izin — murni, tanpa DB. Matriks peran termasuk OD/Director berlapis.
// ===========================================================================

describe('matriks izin (PRD §13.3)', () => {
  it('canManageTask / canManageKategori: hanya lead Creative + Director', () => {
    const kasus: [string, Actor, boolean][] = [
      ['lead Creative (Leader Video)', creativeLead(), true],
      ['Director', director(), true],
      ['staff Creative (SMO sendiri)', creativeStaff(), false],
      ['lead divisi LAIN', adsLead(), false],
      ['AM', am(), false],
      // OD adalah peran BACA. Kalau ini pernah true, OD bisa menulis —
      // melanggar Phase 0 §4 ("OD = read-only everywhere + OKR").
      ['OD saja', od(), false],
    ];
    for (const [label, a, harap] of kasus) {
      expect(canManageTask(a), `manage:${label}`).toBe(harap);
      expect(canManageKategori(a), `kategori:${label}`).toBe(harap);
    }
  });

  it('canWorkTask: HANYA PIC baris itu — lead pun tidak', () => {
    // Sengaja lebih sempit daripada `canEnterActual` M19: lead yang menandai
    // baris orang lain [In Progress] memalsukan jangkar yang turnaround-nya
    // diukur dari situ.
    const kasus: [string, Actor, string, boolean][] = [
      ['PIC-nya sendiri', creativeStaff(PIC), PIC, true],
      ['PIC LAIN', creativeStaff(PIC2), PIC, false],
      ['lead Creative', creativeLead(), PIC, false],
      ['Director', director(), PIC, false],
      ['assigned_pic kosong tidak cocok dengan siapa pun', creativeStaff(''), '', false],
    ];
    for (const [label, a, pic, harap] of kasus) expect(canWorkTask(a, pic), label).toBe(harap);
  });

  it('canReviewTask: lead Creative + Director, NOL lengan AM', () => {
    // Berbeda dari Asset M7 (review-nya memang milik AM): baris SCS tidak punya
    // induk Brief, jadi tidak ada AM yang "memiliki" baris ini — dan untuk
    // baris "all client" tidak ada klien sehingga tidak ada AM sama sekali.
    expect(canReviewTask(creativeLead())).toBe(true);
    expect(canReviewTask(director())).toBe(true);
    expect(canReviewTask(am())).toBe(false);
    expect(canReviewTask(creativeStaff())).toBe(false);
    expect(canReviewTask(od())).toBe(false);
  });

  it('canReadQueue + ownRowsOnly: OD/Director di mana pun, lead se-divisi, staff barisnya sendiri', () => {
    expect(canReadQueue(od())).toBe(true);
    expect(ownRowsOnly(od())).toBe(false);
    expect(canReadQueue(director())).toBe(true);
    expect(ownRowsOnly(director())).toBe(false);
    expect(canReadQueue(creativeLead())).toBe(true);
    expect(ownRowsOnly(creativeLead())).toBe(false);
    expect(canReadQueue(creativeStaff())).toBe(true);
    expect(ownRowsOnly(creativeStaff())).toBe(true);
    expect(canReadQueue(am())).toBe(false);
    // BERLAPIS: staff Creative yang juga OD membaca SELURUH antrean lewat
    // lengan OD-nya, tapi tetap tidak boleh menulis (lihat kasus di atas).
    expect(canReadQueue(staffOD())).toBe(true);
    expect(ownRowsOnly(staffOD())).toBe(false);
    expect(canManageTask(staffOD())).toBe(false);
  });
});

// ===========================================================================
// Kategori — taksonomi sebagai DATA.
// ===========================================================================

describeDb('Kategori', () => {
  it('empat Kategori seed terbaca, dan `Brief` BUKAN standing (ketokan 2026-09-09)', async () => {
    await setup();
    const ks = await listKategori(sql, creativeLead());
    const kode = ks.map((k) => k.kode);
    expect(kode).toEqual(['SCRIPT', 'BRIEF', 'UPLOAD_CHECKLIST', 'KOORDINASI']);
    // "brief SMO sebetulnya membantu team lain menyelesaikan task dari AM" ⇒
    // yang membedakannya dari Brief Strategist adalah `mendukungDivisi` pada
    // BARISNYA, bukan flag standing pada Kategorinya.
    expect(ks.find((k) => k.kode === 'BRIEF')?.isStanding).toBe(false);
    expect(ks.find((k) => k.kode === 'UPLOAD_CHECKLIST')?.isStanding).toBe(true);
    expect(ks.find((k) => k.kode === 'UPLOAD_CHECKLIST')?.slaJam).toBeNull();
  });

  it('Kategori standing ber-SLA DITOLAK dengan pesan yang bisa dibaca', async () => {
    await setup();
    await expect(createKategori(sql, creativeLead(), {
      kode: 'ZSC_STD', nama: 'Zsc standing', subType: null,
      isStanding: true, slaJam: 24, aktif: true, urutan: 900,
    })).rejects.toThrow(MSG_STANDING_TANPA_SLA);
  });

  it('lead menambah Kategori baru — 21 sisanya adalah DATA, bukan migrasi', async () => {
    await setup();
    const k = await createKategori(sql, creativeLead(), {
      kode: 'zsc_copy', nama: 'Zsc Copywriting', subType: 'Content',
      isStanding: false, slaJam: 12, aktif: true, urutan: 901,
    });
    expect(k.kode).toBe('ZSC_COPY');          // kode dinormalkan huruf besar
    const ks = await listKategori(sql, creativeLead());
    expect(ks.map((x) => x.kode)).toContain('ZSC_COPY');
  });

  it('staff TIDAK bisa mengelola Kategori; OD pun tidak', async () => {
    await setup();
    const input = {
      kode: 'ZSC_X', nama: 'Zsc X', subType: null,
      isStanding: false, slaJam: null, aktif: true, urutan: 902,
    };
    await expect(createKategori(sql, creativeStaff(), input)).rejects.toThrow(ForbiddenError);
    await expect(createKategori(sql, od(), input)).rejects.toThrow(ForbiddenError);
  });

  it('menonaktifkan Kategori TIDAK menghapusnya — baris historis tetap terbaca', async () => {
    await setup();
    await createKategori(sql, creativeLead(), {
      kode: 'ZSC_OFF', nama: 'Zsc Off', subType: null,
      isStanding: false, slaJam: 8, aktif: true, urutan: 903,
    });
    const b = await createScsTask(sql, creativeLead(), baris({ kategoriKode: 'ZSC_OFF' }));
    await updateKategori(sql, creativeLead(), 'ZSC_OFF', {
      kode: 'ZSC_OFF', nama: 'Zsc Off', subType: null,
      isStanding: false, slaJam: 8, aktif: false, urutan: 903,
    });
    // Hilang dari picker…
    expect((await listKategori(sql, creativeLead())).map((k) => k.kode)).not.toContain('ZSC_OFF');
    // …tapi baris yang sudah menunjuknya tetap bisa dibaca dan tetap punya nama.
    expect((await getScsTask(sql, creativeLead(), b.id)).kategoriNama).toBe('Zsc Off');
    // …dan baris BARU di bawahnya ditolak.
    await expect(createScsTask(sql, creativeLead(), baris({ kategoriKode: 'ZSC_OFF' })))
      .rejects.toThrow(MSG_KATEGORI_TIDAK_AKTIF);
  });
});

// ===========================================================================
// Baris pekerjaan — tiga baris nyata dari sheet.
// ===========================================================================

describeDb('createScsTask — tiga baris sheet yang sungguhan', () => {
  it('`mamimegol: Script, qty 7` — baris ber-klien biasa', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    expect(b.id).toMatch(/^SCS-\d{6}-\d{4}$/);
    expect(b.status).toBe(STATUS_TODO);
    expect(b.clientId).toBe(CLI);
    expect(b.kategoriIsStanding).toBe(false);
    expect(b.targetQty).toBe(7);
  });

  it('`sagata: Upload & Checklist, qty 1` — Kategori standing, harian', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris({
      kategoriKode: 'UPLOAD_CHECKLIST', judul: 'Upload & checklist sagata', targetQty: 1,
    }));
    expect(b.kategoriIsStanding).toBe(true);
  });

  it('`all client: Brief` — clientId NULL, DAN INI SELURUH ALASAN MODUL INI ADA', async () => {
    await setup();
    // Sebuah tes yang meng-assert throw di sini sedang menguji perilaku yang
    // SALAH: M12 §2 Rule 1 mewajibkan klien untuk setiap Task, baris ini tidak
    // punya, dan opsi (b) dari ketokan `M19-SCS-ENGINE` dipilih justru supaya
    // ia bisa masuk sistem. Kalau baris ini pernah gagal, baris "all client"
    // kembali dicatat di Google Sheets.
    const b = await createScsTask(sql, creativeLead(), baris({
      kategoriKode: 'BRIEF', judul: 'Brief all client', clientId: null,
    }));
    expect(b.clientId).toBeNull();
    expect(b.clientName).toBeNull();
    const di = await sql<{ client_id: string | null }[]>`
      select client_id from scs_tasks where id = ${b.id}`;
    expect(di[0].client_id).toBeNull();
  });

  it('clientId string kosong DINORMALKAN ke null — satu bentuk di DB, bukan dua', async () => {
    await setup();
    // Dua bentuk ('' dan null) lolos filter `client_id is not null` secara
    // BERBEDA, jadi baris '' akan menyelinap ke angka per-klien.
    const b = await createScsTask(sql, creativeLead(), baris({ clientId: '' }));
    expect(b.clientId).toBeNull();
  });

  it('`mendukungDivisi` merekam dukungan ke divisi lain (ketokan 2026-09-09)', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris({
      kategoriKode: 'BRIEF', judul: 'Brief bantu Ads', clientId: null, mendukungDivisi: 'ADS',
    }));
    expect(b.mendukungDivisi).toBe('ADS');
    await expect(createScsTask(sql, creativeLead(), baris({ mendukungDivisi: 'TidakAda' })))
      .rejects.toThrow(ValidationError);
  });

  it('menolak yang memang omong kosong — dan HANYA itu', async () => {
    await setup();
    await expect(createScsTask(sql, creativeLead(), baris({ judul: '   ' })))
      .rejects.toThrow(ValidationError);
    await expect(createScsTask(sql, creativeLead(), baris({ tanggal: '10-09-2026' })))
      .rejects.toThrow(ValidationError);
    await expect(createScsTask(sql, creativeLead(), baris({ targetQty: 0 })))
      .rejects.toThrow(MSG_TARGET_HARUS_POSITIF);
    await expect(createScsTask(sql, creativeLead(), baris({ targetQty: 1.5 })))
      .rejects.toThrow(MSG_TARGET_HARUS_POSITIF);
    await expect(createScsTask(sql, creativeLead(), baris({ kategoriKode: 'TIDAK_ADA' })))
      .rejects.toThrow(MSG_KATEGORI_TIDAK_DIKENAL);
  });

  it('ID TIDAK di-mint saat validasi gagal (aturan rumah #1)', async () => {
    await setup();
    const sebelum = await sql<{ next_n: number | string }[]>`
      select next_n from id_sequences where prefix = 'SCS' and period = '202609'`;
    await expect(createScsTask(sql, creativeLead(), baris({ targetQty: 0 }))).rejects.toThrow();
    const sesudah = await sql<{ next_n: number | string }[]>`
      select next_n from id_sequences where prefix = 'SCS' and period = '202609'`;
    expect(sesudah.map((r) => Number(r.next_n))).toEqual(sebelum.map((r) => Number(r.next_n)));
  });

  it('PIC wajib staff Creative AKTIF — gerbang M7 dipakai ulang, menutup rantai HRIS', async () => {
    await setup();
    // Pesannya datang dari M7 (`CreativeValidationError`) dan BUKAN dari kelas
    // galat modul ini — justru itu buktinya gerbangnya dipakai ULANG alih-alih
    // ditulis kedua kali. `http.ts` sudah memetakan nama itu ke 400.
    await sql`update employees set status_aktif = false where employee_id = ${PIC2}`;
    await expect(createScsTask(sql, creativeLead(), baris({ assignedPic: PIC2 })))
      .rejects.toThrow('[PIC tidak valid: harus staff divisi Creative yang aktif]');
    // Orang di luar divisi Creative juga ditolak.
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values ('ZSC-ADS1', 'Ads 1', 'ads1@mea.test', 'Ads', 'Advertiser ZSC', true, 'ZSC-TEST')`;
    await expect(createScsTask(sql, creativeLead(), baris({ assignedPic: 'ZSC-ADS1' })))
      .rejects.toThrow('[PIC tidak valid: harus staff divisi Creative yang aktif]');
  });

  it('staff TIDAK bisa membuat barisnya sendiri — Leader yang menyusun antrean', async () => {
    await setup();
    await expect(createScsTask(sql, creativeStaff(), baris())).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// Sunting & hapus — batas [To Do].
// ===========================================================================

describeDb('updateScsTask / deleteScsTask — batasnya [To Do]', () => {
  it('sunting bebas selama [To Do]', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    const u = await updateScsTask(sql, creativeLead(), b.id, baris({
      judul: 'Script mamimegol (revisi brief)', targetQty: 9,
    }));
    expect(u.judul).toBe('Script mamimegol (revisi brief)');
    expect(u.targetQty).toBe(9);
  });

  it('sunting DITOLAK begitu baris dikerjakan — Kategori membawa SLA-nya', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    await expect(updateScsTask(sql, creativeLead(), b.id, baris({ kategoriKode: 'BRIEF' })))
      .rejects.toThrow(ConflictError);
  });

  it('DB menolaknya juga — trigger, bukan hanya lapisan TS', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    // Jalur tulis PALING berwenang yang ada (service-role) tetap ditolak.
    await expect(sql`update scs_tasks set kategori_kode = 'BRIEF' where id = ${b.id}`)
      .rejects.toThrow(/kategori_kode beku/);
    await expect(sql`update scs_tasks set target_qty = 99 where id = ${b.id}`)
      .rejects.toThrow(/target_qty beku/);
  });

  it('hapus boleh pada [To Do], DITOLAK sesudahnya — dan riwayatnya tetap ada', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await deleteScsTask(sql, creativeLead(), b.id);
    await expect(getScsTask(sql, creativeLead(), b.id)).rejects.toThrow(NotFoundError);
    // Baris audit-nya TIDAK ikut hilang (aturan rumah #3).
    const jejak = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'scs_task' and entity_id = ${b.id}
       order by id`;
    expect(jejak.map((r) => r.action)).toEqual(['scs_created', 'scs_deleted']);

    const b2 = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b2.id);
    await expect(deleteScsTask(sql, creativeLead(), b2.id)).rejects.toThrow(ConflictError);
    // Dan DB-nya sendiri menolak, bukan cuma gerbang TS-nya.
    await expect(sql`delete from scs_tasks where id = ${b2.id}`)
      .rejects.toThrow(/hanya baris \[To Do\] boleh dihapus/);
  });
});

// ===========================================================================
// Siklus hidup penuh lewat sm_transition.
// ===========================================================================

describeDb('mesin #34 — siklus penuh, dan gerbang perannya', () => {
  it('[To Do] → … → [Approved], masing-masing oleh peran yang benar', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    expect((await startScsTask(sql, creativeStaff(), b.id)).status).toBe(STATUS_IN_PROGRESS);
    expect((await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x')).status)
      .toBe(STATUS_SUBMITTED);
    expect((await openReviewScsTask(sql, creativeLead(), b.id)).status).toBe(STATUS_IN_REVIEW);
    expect((await approveScsTask(sql, creativeLead(), b.id)).status).toBe(STATUS_APPROVED);
  });

  it('hanya PIC yang boleh memulai dan submit — lead pun tidak', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await expect(startScsTask(sql, creativeLead(), b.id)).rejects.toThrow(ForbiddenError);
    await expect(startScsTask(sql, creativeStaff(PIC2), b.id)).rejects.toThrow(ForbiddenError);
    await startScsTask(sql, creativeStaff(), b.id);
    await expect(submitScsTask(sql, creativeStaff(PIC2), b.id, 'x')).rejects.toThrow(ForbiddenError);
  });

  it('submit tanpa link hasil DITOLAK — "selesai" tanpa lampiran adalah klaim', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    await expect(submitScsTask(sql, creativeStaff(), b.id, '   '))
      .rejects.toThrow(MSG_LINK_HASIL_WAJIB);
    // Statusnya TIDAK bergerak.
    expect((await getScsTask(sql, creativeLead(), b.id)).status).toBe(STATUS_IN_PROGRESS);
  });

  it('review dan revisi milik lead; staff tidak bisa menyetujui barisnya sendiri', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x');
    await expect(openReviewScsTask(sql, creativeStaff(), b.id)).rejects.toThrow(ForbiddenError);
    await openReviewScsTask(sql, creativeLead(), b.id);
    await expect(approveScsTask(sql, creativeStaff(), b.id)).rejects.toThrow(ForbiddenError);
    // AM pun tidak — baris SCS tidak punya induk Brief, jadi tidak ada AM yang
    // memilikinya (dan untuk baris "all client" tidak ada klien sama sekali).
    await expect(approveScsTask(sql, am(), b.id)).rejects.toThrow(ForbiddenError);
  });

  it('QC lead sebelum review dibuka: [Submitted] → [Revision Requested]', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x');
    expect((await requestRevisionScsTask(sql, creativeLead(), b.id)).status)
      .toBe(STATUS_REVISION_REQ);
    expect((await resumeScsTask(sql, creativeStaff(), b.id)).status).toBe(STATUS_IN_PROGRESS);
  });

  it('[Blocked] hanya lead — waktu blocked DIKURANGI dari turnaround', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    // Kalau PIC bisa memblokir barisnya sendiri, ia memotong sendiri angka yang
    // menilainya (gerbang yang sama dengan M12 §5.3a).
    await expect(blockScsTask(sql, creativeStaff(), b.id)).rejects.toThrow(ForbiddenError);
    expect((await blockScsTask(sql, creativeLead(), b.id)).status).toBe(STATUS_BLOCKED);
    expect((await unblockScsTask(sql, creativeLead(), b.id)).status).toBe(STATUS_IN_PROGRESS);
  });

  it('transisi ilegal ditolak engine, bukan diam-diam diterima', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    // [To Do] → [Approved] tidak punya edge.
    await expect(approveScsTask(sql, creativeLead(), b.id)).rejects.toThrow(ConflictError);
  });

  it('[Approved] adalah terminal — DB menolak menggerakkannya lagi', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x');
    await openReviewScsTask(sql, creativeLead(), b.id);
    await approveScsTask(sql, creativeLead(), b.id);
    await expect(requestRevisionScsTask(sql, creativeLead(), b.id)).rejects.toThrow();
    // link_hasil beku sesudah [Approved]: mengganti bukti sesudah disetujui
    // adalah mengedit riwayat.
    await expect(sql`update scs_tasks set link_hasil = 'ganti' where id = ${b.id}`)
      .rejects.toThrow(/link_hasil beku/);
  });

  it('NOL `update ... set status` — setiap transisi meninggalkan baris audit', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x');
    const rows = await sql<{ action: string }[]>`
      select action from audit_log where entity_type = 'scs_task' and entity_id = ${b.id}
       order by id`;
    expect(rows.map((r) => r.action)).toEqual([
      'scs_created',
      'transition:[To Do]->[In Progress]',
      'transition:[In Progress]->[Submitted]',
    ]);
  });
});

// ===========================================================================
// Angka turunan — DIHITUNG ULANG dari log, memakai task.computeMetrics().
// ===========================================================================

describeDb('scsTaskMetrics — recompute-from-log, nol rumus kedua', () => {
  it('turnaround + Speed Score dihitung dari audit_log, bukan dari kolom', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());   // SCRIPT, sla_jam 24
    await startScsTask(sql, creativeStaff(), b.id);
    await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x');
    await openReviewScsTask(sql, creativeLead(), b.id);
    await approveScsTask(sql, creativeLead(), b.id);

    const m = await scsTaskMetrics(sql, creativeLead(), b.id);
    expect(m.status).toBe(STATUS_APPROVED);
    // Siklus di dalam satu tes berjalan dalam hitungan milidetik ⇒ turnaround
    // ~0 jam, dan Speed Score ~0% — yang penting: keduanya ANGKA, bukan null.
    expect(m.turnaroundHours).not.toBeNull();
    expect(m.turnaroundHours as number).toBeGreaterThanOrEqual(0);
    expect(m.speedScorePct).not.toBeNull();
    expect(m.speedScoreDisplay).toMatch(/%$/);
  });

  it('Kategori standing ⇒ Speed Score `N/A`, BUKAN `0%` dan bukan galat', async () => {
    await setup();
    // Inti Gap G. `0%` adalah pernyataan tentang kecepatan seseorang atas
    // pekerjaan yang tidak pernah di-SLA-kan; `N/A` adalah kebenaran.
    const b = await createScsTask(sql, creativeLead(), baris({
      kategoriKode: 'UPLOAD_CHECKLIST', targetQty: 1,
    }));
    await startScsTask(sql, creativeStaff(), b.id);
    await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x');
    await openReviewScsTask(sql, creativeLead(), b.id);
    await approveScsTask(sql, creativeLead(), b.id);
    const m = await scsTaskMetrics(sql, creativeLead(), b.id);
    expect(m.speedScoreDisplay).toBe('N/A');
    expect(m.speedScorePct).toBeNull();
    // Turnaround tetap ada — yang tidak ada hanya pembanding SLA-nya.
    expect(m.turnaroundHours).not.toBeNull();
  });

  it('setiap kedatangan di [Revision Requested] terhitung satu revisi', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x');
    // Ronde 1 — QC lead sebelum review dibuka.
    await requestRevisionScsTask(sql, creativeLead(), b.id);
    await resumeScsTask(sql, creativeStaff(), b.id);
    await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x2');
    // Ronde 2 — sesudah review dibuka.
    await openReviewScsTask(sql, creativeLead(), b.id);
    await requestRevisionScsTask(sql, creativeLead(), b.id);
    const m = await scsTaskMetrics(sql, creativeLead(), b.id);
    expect(m.revisionCount).toBe(2);
  });

  it('baris yang belum disetujui: turnaround null, dan itu bukan galat', async () => {
    await setup();
    const b = await createScsTask(sql, creativeLead(), baris());
    await startScsTask(sql, creativeStaff(), b.id);
    const m = await scsTaskMetrics(sql, creativeLead(), b.id);
    expect(m.turnaroundHours).toBeNull();
    expect(m.status).toBe(STATUS_IN_PROGRESS);
  });
});

// ===========================================================================
// Antrean + rekap.
// ===========================================================================

describeDb('queueScsTasks + scsPicSummary', () => {
  it('staff Creative dipersempit ke barisnya sendiri DI SQL, bukan hanya oleh RLS', async () => {
    await setup();
    await createScsTask(sql, creativeLead(), baris({ assignedPic: PIC }));
    await createScsTask(sql, creativeLead(), baris({ assignedPic: PIC2 }));
    const f = { dariTanggal: HARI, sampaiTanggal: HARI, pic: null, kategoriKode: null, status: null };
    // Koneksi domain adalah service-role (BYPASSRLS): tanpa penyempitan di SQL,
    // tes ini hijau untuk query yang lewat API justru kosong.
    const milikStaff = await queueScsTasks(sql, creativeStaff(PIC), f);
    expect(milikStaff.every((r) => r.assignedPic === PIC)).toBe(true);
    expect(milikStaff.length).toBe(1);
    // Lead melihat keduanya.
    expect((await queueScsTasks(sql, creativeLead(), f)).length).toBe(2);
    // Staff TIDAK bisa memakai filter `pic` untuk mengintip orang lain.
    const intip = await queueScsTasks(sql, creativeStaff(PIC), { ...f, pic: PIC2 });
    expect(intip.every((r) => r.assignedPic === PIC)).toBe(true);
  });

  it('AM tidak punya akses baca sama sekali (PRD §13.3 — nol lengan AM)', async () => {
    await setup();
    await expect(queueScsTasks(sql, am(), {
      dariTanggal: HARI, sampaiTanggal: HARI, pic: null, kategoriKode: null, status: null,
    })).rejects.toThrow(ForbiddenError);
  });

  it('rekap memisahkan standing dari deliverable — inti Gap G', async () => {
    await setup();
    // Satu deliverable (SCRIPT, qty 7) + dua standing (UPLOAD_CHECKLIST qty 1).
    const jalankanSampaiApproved = async (input: ScsTaskInput): Promise<void> => {
      const b = await createScsTask(sql, creativeLead(), input);
      await startScsTask(sql, creativeStaff(), b.id);
      await submitScsTask(sql, creativeStaff(), b.id, 'https://drive/x');
      await openReviewScsTask(sql, creativeLead(), b.id);
      await approveScsTask(sql, creativeLead(), b.id);
    };
    await jalankanSampaiApproved(baris());
    await jalankanSampaiApproved(baris({ kategoriKode: 'UPLOAD_CHECKLIST', targetQty: 1 }));
    await jalankanSampaiApproved(baris({ kategoriKode: 'UPLOAD_CHECKLIST', targetQty: 1 }));
    // Satu baris yang belum selesai.
    await createScsTask(sql, creativeLead(), baris({ judul: 'Belum' }));

    const rows = await scsPicSummary(sql, creativeLead(), HARI, HARI);
    const r = rows.find((x) => x.employeeId === PIC);
    // Menjumlahkan keduanya memberi "3 selesai" — angka produktivitas yang naik
    // hanya karena seseorang mencatat pekerjaan harian yang selalu ada.
    expect(r?.deliverableSelesai).toBe(1);
    expect(r?.deliverableQty).toBe(7);
    expect(r?.standingSelesai).toBe(2);
    expect(r?.belumSelesai).toBe(1);
    expect(r?.totalBaris).toBe(4);
  });

  it('jendela tanggal INKLUSIF dua ujung, dan tanggal ngawur ditolak', async () => {
    await setup();
    await createScsTask(sql, creativeLead(), baris({ tanggal: '2026-09-10' }));
    await createScsTask(sql, creativeLead(), baris({ tanggal: '2026-09-12' }));
    const f = (a: string, b: string) => ({
      dariTanggal: a, sampaiTanggal: b, pic: null, kategoriKode: null, status: null,
    });
    expect((await queueScsTasks(sql, creativeLead(), f('2026-09-10', '2026-09-12'))).length).toBe(2);
    expect((await queueScsTasks(sql, creativeLead(), f('2026-09-11', '2026-09-12'))).length).toBe(1);
    await expect(queueScsTasks(sql, creativeLead(), f('10/09/2026', '2026-09-12')))
      .rejects.toThrow(ValidationError);
  });
});

// ===========================================================================
// Baris "all client" tidak boleh menyelinap ke angka per-klien.
// ===========================================================================

describeDb('baris ber-clientId NULL dan angka per-klien', () => {
  it('nol view di atas scs_tasks — tidak ada jalan tersembunyi ke angka per-klien', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.views
       where table_schema = 'public' and view_definition like '%scs_tasks%'`;
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});

// ===========================================================================
// Nol jalur ke Modul 14 — sikap yang sama dengan D5 dan internal_tasks.
// ===========================================================================

describe('KPI Profile M14 untuk peran gabungan DITUNDA dengan sengaja', () => {
  it('performance.ts tidak mengimpor `scs` sama sekali', async () => {
    // Kalau peran gabungan mewarisi profil "Creative" apa adanya, dua dari lima
    // komponennya secara struktural nol (Output Quantity = *Approved Assets*,
    // GMV Impact melekat pada Asset): 47,5% bobot hilang, M14 Rule 6
    // meredistribusinya, dan Speed Score jadi ~54% seluruh skor seseorang. Skor
    // yang ABSEN itu jujur; skor yang SALAH dipakai di review kinerja.
    //
    // Kalau `performance.ts` suatu saat mengimpor modul ini, penundaan itu
    // sedang dibatalkan tanpa entri DECISIONS.md — dan baris ini yang merah
    // lebih dulu.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'performance.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\/scs'/);
    expect(src).not.toMatch(/\bscs\b/);
  });
});
