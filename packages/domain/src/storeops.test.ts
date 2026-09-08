/**
 * M18 — modul domain Store Operation: baris SKU, gerbang dua penulis, transisi,
 * rollup Brief, dan angka turunan.
 *
 * Yang diuji di sini adalah LAPISAN DOMAIN-nya. Dindingnya sendiri hidup di DB
 * dan diuji dari sisi yang salah di `storeops-sku.rls.test.ts` — dua berkas
 * karena dua pertanyaan berbeda: "apakah jalur resmi menolak orang yang salah"
 * (di sini) dan "apakah jalur MENTAH juga tertutup" (di sana). Yang kedua yang
 * benar-benar menjawab ketokan.
 *
 * ⚠️ FK NO ACTION: `afterEach` menghapus baris SKU SEBELUM `briefs`. Satu baris
 * yang tertinggal membuat setiap berkas tes sesudahnya merah tanpa menyebut
 * sebabnya (sudah kena dua kali di repo ini).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assignPic,
  catatDampak,
  createSku,
  getSku,
  listByBrief,
  mulaiKerja,
  summaryByBrief,
  tandaiGagalUpload,
  tandaiTerupload,
  ulangiKerja,
  updateSkuScope,
  type Actor,
  type SkuScopeInput,
} from './storeops';
import { diagnoseBriefRollup } from './task';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const AM = 'ZSD-AM';
const PIC = 'ZSD-PIC';

const am = (id = AM): Actor => ({ employeeId: id, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (): Actor => ({ employeeId: 'ZSD-ALEAD', divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const opsStaff = (id = PIC): Actor => ({ employeeId: id, divisi: 'Store Operation', role: permission.makeRole({ division: 'Store Operation', level: 'staff' }) });
const opsLead = (): Actor => ({ employeeId: 'ZSD-OLEAD', divisi: 'Store Operation', role: permission.makeRole({ division: 'Store Operation', level: 'lead' }) });
const creativeStaff = (): Actor => ({ employeeId: 'ZSD-CRE', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });
const od = (): Actor => ({ employeeId: 'ZSD-OD', divisi: 'Management', role: permission.makeRole({ od: true }) });
const director = (): Actor => ({ employeeId: 'ZSD-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) });

const scope = (over: Partial<SkuScopeInput> = {}): SkuScopeInput => ({
  namaProduk: 'Kaos Polos Hitam',
  linkSku: 'https://shopee.example/kaos',
  requestType: 'Shopee New',
  jenisGambar: 'Cover + Pendamping',
  totalReqPicture: 3,
  expectedDone: '2026-09-20',
  targetCtr: 2.5,
  targetCvr: 1.2,
  targetRating: 4.5,
  ...over,
});

let seq = 0;

/** Satu Brief Store Operation lengkap dengan rantai klien→service-nya. */
async function insBrief(qty = 1, divisi = 'Store Operation'): Promise<string> {
  seq += 1;
  const cli = `ZSD-CLI-${seq}`;
  const svc = `ZSD-SVC-${seq}`;
  const brf = `ZSD-BRF-${seq}`;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${cli}, 'PIC', ${cli}, 'Bandung', 'link', 'Fashion', '0', '0', '0',
      'ZSD-SALES', 'ZSD-SALES', now(), ${AM}, 'ZSD-TEST')`;
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
                          standard_price, commission_rule, status, created_by)
    values (${svc}, ${cli}, 'MS-ZSD', 1, 'Optimasi SKU', 0, 'none', '[Briefed]', 'ZSD-TEST')`;
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
                        quantity_target, priority, recurring, created_by)
    values (${brf}, ${svc}, 'optimasi SKU', '[To Do]', ${divisi}, 'Gambar SKU',
            ${qty}, 'High', false, 'ZSD-TEST')`;
  return brf;
}

/** PIC yang sah: staff aktif yang `role_mappings`-nya memetakan ke Store Operation. */
async function insPic(): Promise<void> {
  await sql`
    insert into role_mappings (divisi, jabatan, division, level, created_by)
    values ('Store Operation', 'Staff Store Ops', 'Store Operation', 'staff', 'ZSD-TEST')
    on conflict do nothing`;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${PIC}, 'Pic Store Ops', ${PIC + '@mea.test'}, 'Store Operation', 'Staff Store Ops', true, 'ZSD-TEST')
    on conflict (employee_id) do nothing`;
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from store_ops_skus where created_by like 'ZSD-%' or brief_id like 'ZSD-BRF-%'`;
  await sql`delete from briefs where id like 'ZSD-BRF-%'`;
  await sql`delete from services where id like 'ZSD-SVC-%'`;
  await sql`delete from clients where id like 'ZSD-CLI-%'`;
  await sql`delete from employees where employee_id like 'ZSD-%'`;
  await sql`delete from role_mappings where created_by = 'ZSD-TEST'`;
});
afterAll(async () => { if (sql) await sql.end(); });

describeDb('createSku — cakupan + target adalah milik AM (ketokan 2026-09-08)', () => {
  it('AM pemilik mencetak baris ber-id SKU- dengan status lahir [Menunggu Eksekusi] + baris audit', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    expect(r.id).toMatch(/^SKU-\d{6}-\d{4}$/);
    expect(r.status).toBe('[Menunggu Eksekusi]');
    expect(r.targetCtr).toBe(2.5);
    // Turunan pada baris yang belum dikerjakan: belum ada apa-apa untuk dihitung.
    expect(r.actualDone).toBeNull();
    expect(r.leadtime).toBeNull();
    expect(r.verdict).toBeNull();
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where entity_id = ${r.id} and action = 'sku_created'`;
    expect(audit[0].n).toBe(1);
  });

  it('Store Operation TIDAK boleh membuat baris SKU — itu inti ketokannya', async () => {
    // Kalau gerbang ini dilonggarkan, angka target jadi angka yang diketik
    // pelaksananya sendiri, dan tidak bisa dipertanggungjawabkan ke klien.
    const brf = await insBrief();
    await expect(createSku(sql, opsLead(), brf, scope())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSku(sql, opsStaff(), brf, scope())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('AM klien lain, divisi lain, dan OD ditolak; lead Account dan Director boleh', async () => {
    const brf = await insBrief();
    await expect(createSku(sql, am('ZSD-AM2'), brf, scope())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSku(sql, creativeStaff(), brf, scope())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createSku(sql, od(), brf, scope())).rejects.toBeInstanceOf(ForbiddenError); // OD read-only
    await expect(createSku(sql, accountLead(), brf, scope())).resolves.toBeTruthy();
    await expect(createSku(sql, director(), brf, scope())).resolves.toBeTruthy();
  });

  it('menolak Brief divisi lain — baris SKU hanya ada di bawah Brief Store Operation', async () => {
    const brf = await insBrief(1, 'Creative');
    await expect(createSku(sql, am(), brf, scope())).rejects.toBeInstanceOf(ValidationError);
  });

  it('ID dicetak HANYA setelah validasi lolos (aturan rumah #1)', async () => {
    const brf = await insBrief();
    const sebelum = await sql<{ n: number }[]>`
      select coalesce(max(next_n), 0)::int as n from id_sequences where prefix = 'SKU'`;
    await expect(createSku(sql, am(), brf, scope({ namaProduk: '   ' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createSku(sql, am(), brf, scope({ requestType: 'Lazada New' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createSku(sql, am(), brf, scope({ jenisGambar: 'Cover' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createSku(sql, am(), brf, scope({ totalReqPicture: 0 }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createSku(sql, am(), brf, scope({ expectedDone: 'besok' }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createSku(sql, am(), brf, scope({ targetCtr: -1 }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createSku(sql, am(), brf, scope({ targetRating: 9 }))).rejects.toBeInstanceOf(ValidationError);
    const sesudah = await sql<{ n: number }[]>`
      select coalesce(max(next_n), 0)::int as n from id_sequences where prefix = 'SKU'`;
    expect(sesudah[0].n).toBe(sebelum[0].n); // tujuh penolakan, nol nomor terbakar
  });
});

describeDb('updateSkuScope — target beku begitu eksekusi mulai', () => {
  it('AM boleh mengubah target selama [Menunggu Eksekusi]', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    const u = await updateSkuScope(sql, am(), r.id, scope({ targetCtr: 4 }));
    expect(u.targetCtr).toBe(4);
  });

  it('sesudah [Dikerjakan], target DITOLAK — janji ke klien tidak berubah setelah hasilnya keluar', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await mulaiKerja(sql, opsStaff(), r.id);
    await expect(updateSkuScope(sql, am(), r.id, scope({ targetCtr: 0.1 })))
      .rejects.toBeInstanceOf(ConflictError);
    const tetap = await getSku(sql, am(), r.id);
    expect(tetap.targetCtr).toBe(2.5);
  });

  it('Store Operation tetap tidak boleh menyentuh cakupan lewat jalur ini', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await expect(updateSkuScope(sql, opsLead(), r.id, scope({ targetCtr: 9 })))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});

describeDb('assignPic — SIAPA yang mengerjakan tetap wewenang leader (K-1)', () => {
  it('leader Store Operation menunjuk PIC; AM dan staff ditolak', async () => {
    await insPic();
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await expect(assignPic(sql, am(), r.id, PIC)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignPic(sql, opsStaff(), r.id, PIC)).rejects.toBeInstanceOf(ForbiddenError);
    await assignPic(sql, opsLead(), r.id, PIC);
    expect((await getSku(sql, opsLead(), r.id)).assignedPic).toBe(PIC);
  });

  it('PIC harus staff Store Operation yang aktif', async () => {
    await insPic();
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await expect(assignPic(sql, opsLead(), r.id, 'ZSD-TIDAK-ADA')).rejects.toBeInstanceOf(ValidationError);
    await expect(assignPic(sql, opsLead(), r.id, AM)).rejects.toBeInstanceOf(ValidationError);
  });
});

describeDb('siklus hidup baris SKU (mesin #32)', () => {
  it('[Menunggu Eksekusi] → [Dikerjakan] → [Terupload]; link hasil WAJIB', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await expect(tandaiTerupload(sql, opsStaff(), r.id, 'x')).rejects.toBeInstanceOf(ConflictError); // salah urutan
    await mulaiKerja(sql, opsStaff(), r.id);
    await expect(tandaiTerupload(sql, opsStaff(), r.id, '   ')).rejects.toBeInstanceOf(ValidationError);
    await tandaiTerupload(sql, opsStaff(), r.id, 'https://drive.example/hasil');
    const s = await getSku(sql, am(), r.id);
    expect(s.status).toBe('[Terupload]');
    expect(s.linkOutput).toBe('https://drive.example/hasil');
  });

  it('[Terupload] TIDAK menunggu angka dampak — K-6, dan tesnya di sini', async () => {
    // Kalau seseorang menambahkan gerbang "CTR/CVR wajib" pada tandaiTerupload,
    // lead time PRODUKSI Store Ops mulai memuat ~30 hari tunggu pasar.
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await mulaiKerja(sql, opsStaff(), r.id);
    await tandaiTerupload(sql, opsStaff(), r.id, 'https://drive.example/hasil');
    const s = await getSku(sql, am(), r.id);
    expect(s.ctrSesudah).toBeNull();
    expect(s.cvrSesudah).toBeNull();
    expect(s.ratingSesudah).toBeNull();
    expect(s.status).toBe('[Terupload]');
  });

  it('evaluasi adalah langkah terpisah, dan keenam angkanya WAJIB di situ', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await mulaiKerja(sql, opsStaff(), r.id);
    await tandaiTerupload(sql, opsStaff(), r.id, 'https://drive.example/hasil');
    await expect(catatDampak(sql, opsStaff(), r.id, {
      ctrSebelum: 1, cvrSebelum: 1, ratingSebelum: 4,
      ctrSesudah: Number.NaN, cvrSesudah: 1, ratingSesudah: 4,
    })).rejects.toBeInstanceOf(ValidationError);
    await catatDampak(sql, opsStaff(), r.id, {
      ctrSebelum: 1.5, cvrSebelum: 0.8, ratingSebelum: 4.2,
      ctrSesudah: 3.0, cvrSesudah: 1.0, ratingSesudah: 4.6,
    });
    const s = await getSku(sql, am(), r.id);
    expect(s.status).toBe('[Dievaluasi]');
    // % Achievement CTR = 3.0 / 2.5 = 120% ⇒ achieve.
    expect(s.achievementCtrPct).toBeCloseTo(120);
    expect(s.verdict).toBe('achieve');
  });

  it('[Gagal Upload] butuh alasan, dan kembali ke [Dikerjakan] pada baris yang SAMA', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await mulaiKerja(sql, opsStaff(), r.id);
    await expect(tandaiGagalUpload(sql, opsStaff(), r.id, ' ')).rejects.toBeInstanceOf(ValidationError);
    await tandaiGagalUpload(sql, opsStaff(), r.id, 'Ditolak Shopee: watermark');
    await ulangiKerja(sql, opsStaff(), r.id);
    const s = await getSku(sql, am(), r.id);
    expect(s.status).toBe('[Dikerjakan]');
    // "Pernah gagal" permanen — dibaca dari jejak, bukan dari status terkini.
    expect(s.pernahGagalUpload).toBe(true);
    expect(s.catatanOps).toBe('Ditolak Shopee: watermark');
  });

  it('AM tidak boleh menggerakkan baris; PIC lain juga tidak selama barisnya sudah dibagi', async () => {
    await insPic();
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await assignPic(sql, opsLead(), r.id, PIC);
    await expect(mulaiKerja(sql, am(), r.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(mulaiKerja(sql, opsStaff('ZSD-OPS9'), r.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(mulaiKerja(sql, opsStaff(PIC), r.id)).resolves.toBeTruthy();
  });
});

describeDb('angka turunan (PRD §5) — nol yang disimpan', () => {
  it('actualDone diturunkan dari stempel [Terupload], dan leadtime dari perbandingannya', async () => {
    const brf = await insBrief();
    // expected_done kemarin ⇒ upload hari ini pasti Late; besok ⇒ On Time.
    const kemarin = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const besok = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

    const telat = await createSku(sql, am(), brf, scope({ expectedDone: kemarin }));
    await mulaiKerja(sql, opsStaff(), telat.id);
    await tandaiTerupload(sql, opsStaff(), telat.id, 'link');
    const t = await getSku(sql, am(), telat.id);
    expect(t.actualDone).not.toBeNull();
    expect(t.leadtime).toBe('Late');

    const tepat = await createSku(sql, am(), brf, scope({ expectedDone: besok }));
    await mulaiKerja(sql, opsStaff(), tepat.id);
    await tandaiTerupload(sql, opsStaff(), tepat.id, 'link');
    expect((await getSku(sql, am(), tepat.id)).leadtime).toBe('On Time');
  });

  it('tanpa expected_done leadtime `null` — TIDAK di-default diam-diam (M16 Rule 8)', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope({ expectedDone: null }));
    await mulaiKerja(sql, opsStaff(), r.id);
    await tandaiTerupload(sql, opsStaff(), r.id, 'link');
    const s = await getSku(sql, am(), r.id);
    expect(s.actualDone).not.toBeNull();
    expect(s.leadtime).toBeNull();
  });

  it('target 0 atau kosong ⇒ % Achievement `null`, bukan galat pembagian nol (aturan rumah #7)', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope({ targetCtr: 0, targetCvr: null }));
    await mulaiKerja(sql, opsStaff(), r.id);
    await tandaiTerupload(sql, opsStaff(), r.id, 'link');
    await catatDampak(sql, opsStaff(), r.id, {
      ctrSebelum: 1, cvrSebelum: 1, ratingSebelum: 4, ctrSesudah: 2, cvrSesudah: 2, ratingSesudah: 5,
    });
    const s = await getSku(sql, am(), r.id);
    expect(s.achievementCtrPct).toBeNull();
    expect(s.achievementCvrPct).toBeNull();
    expect(s.verdict).toBeNull();
  });

  it('summaryByBrief menghitung %Ontime dan % pernah-gagal dari jejak, bukan status terkini', async () => {
    const brf = await insBrief(2);
    const kemarin = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const besok = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

    const a = await createSku(sql, am(), brf, scope({ expectedDone: besok }));
    const b = await createSku(sql, am(), brf, scope({ expectedDone: kemarin }));
    await mulaiKerja(sql, opsStaff(), a.id);
    await tandaiTerupload(sql, opsStaff(), a.id, 'link');
    await mulaiKerja(sql, opsStaff(), b.id);
    await tandaiGagalUpload(sql, opsStaff(), b.id, 'ditolak');
    await ulangiKerja(sql, opsStaff(), b.id);
    await tandaiTerupload(sql, opsStaff(), b.id, 'link');

    const s = await summaryByBrief(sql, am(), brf);
    expect(s.total).toBe(2);
    expect(s.selesai).toBe(2);
    expect(s.dievaluasi).toBe(0);   // dipisah dari `selesai` — itu inti K-6
    expect(s.dinilaiOntime).toBe(2);
    expect(s.ontime).toBe(1);
    expect(s.ontimePct).toBeCloseTo(50);
    // b sekarang [Terupload], BUKAN [Gagal Upload] — tapi ia pernah gagal.
    expect(s.pernahGagalUpload).toBe(1);
    expect(s.gagalUploadPct).toBeCloseTo(50);
  });

  it('Brief tanpa baris SKU: persentase `null`, bukan 0 dan bukan galat', async () => {
    const brf = await insBrief();
    const s = await summaryByBrief(sql, am(), brf);
    expect(s.total).toBe(0);
    expect(s.ontimePct).toBeNull();
    expect(s.gagalUploadPct).toBeNull();
  });
});

describeDb('rollup Brief (M18 §8) — berhenti di [Terupload], bukan [Dievaluasi]', () => {
  it('Brief bergerak ke [In Progress] pada baris pertama yang dikerjakan', async () => {
    const brf = await insBrief(2);
    const a = await createSku(sql, am(), brf, scope());
    await createSku(sql, am(), brf, scope());
    await mulaiKerja(sql, opsStaff(), a.id);
    const st = await sql<{ status: string }[]>`select status from briefs where id = ${brf}`;
    expect(st[0].status).toBe('[In Progress]');
  });

  it('Brief menutup ke [In Review] saat SEMUA baris [Terupload] — tanpa menunggu evaluasi', async () => {
    // Ini ketokan K-6 pada tingkat Brief: menahan rollup sampai [Dievaluasi]
    // berarti AM baru melihat pekerjaan yang sudah tayang ~30 hari kemudian.
    const brf = await insBrief(2);
    const a = await createSku(sql, am(), brf, scope());
    const b = await createSku(sql, am(), brf, scope());
    for (const r of [a, b]) {
      await mulaiKerja(sql, opsStaff(), r.id);
      await tandaiTerupload(sql, opsStaff(), r.id, 'link');
    }
    const st = await sql<{ status: string }[]>`select status from briefs where id = ${brf}`;
    expect(st[0].status).toBe('[In Review]');
  });

  it('rollup TIDAK pernah menutup Brief ke [Approved] sendiri — itu tetap keputusan AM', async () => {
    const brf = await insBrief(1);
    const a = await createSku(sql, am(), brf, scope());
    await mulaiKerja(sql, opsStaff(), a.id);
    await tandaiTerupload(sql, opsStaff(), a.id, 'link');
    await catatDampak(sql, opsStaff(), a.id, {
      ctrSebelum: 1, cvrSebelum: 1, ratingSebelum: 4, ctrSesudah: 3, cvrSesudah: 2, ratingSesudah: 5,
    });
    const st = await sql<{ status: string }[]>`select status from briefs where id = ${brf}`;
    expect(st[0].status).toBe('[In Review]'); // bukan [Approved]
  });

  it('satu baris [Gagal Upload] MENAHAN rollup — ia memang penghambat', async () => {
    const brf = await insBrief(2);
    const a = await createSku(sql, am(), brf, scope());
    const b = await createSku(sql, am(), brf, scope());
    await mulaiKerja(sql, opsStaff(), a.id);
    await tandaiTerupload(sql, opsStaff(), a.id, 'link');
    await mulaiKerja(sql, opsStaff(), b.id);
    await tandaiGagalUpload(sql, opsStaff(), b.id, 'ditolak');
    const st = await sql<{ status: string }[]>`select status from briefs where id = ${brf}`;
    expect(st[0].status).toBe('[In Progress]');
  });

  it('diagnoseBriefRollup (B-1a) menjawab "n dari N" untuk Brief Store Operation', async () => {
    // Pelajaran B-1a: rollup yang tidak menutup harus bisa DIBACA sebabnya,
    // bukan mati diam. Sebelum M18, Brief Store Ops tidak punya anak sama sekali
    // di mata fungsi ini dan selalu terbaca `nol_unit`.
    const brf = await insBrief(3);
    const a = await createSku(sql, am(), brf, scope());
    await createSku(sql, am(), brf, scope());
    await mulaiKerja(sql, opsStaff(), a.id);
    await tandaiTerupload(sql, opsStaff(), a.id, 'link');

    const d = await diagnoseBriefRollup(sql, brf);
    expect(d.created).toBe(2);
    expect(d.target).toBe(3);
    expect(d.done).toBe(1);                      // [Terupload] SUDAH terhitung selesai
    expect(d.blocker).toBe('unit_belum_lengkap'); // 2 dari 3 baris dibuat
    expect(d.rollupTarget).toBe('[In Progress]');
  });
});

describeDb('baca — cermin RLS (PRD §9)', () => {
  it('listByBrief menyaring per pembaca: staff hanya barisnya, lead/AM/OD semuanya', async () => {
    await insPic();
    const brf = await insBrief(2);
    const a = await createSku(sql, am(), brf, scope());
    await createSku(sql, am(), brf, scope());
    await assignPic(sql, opsLead(), a.id, PIC);

    expect((await listByBrief(sql, am(), brf)).length).toBe(2);
    expect((await listByBrief(sql, opsLead(), brf)).length).toBe(2);
    expect((await listByBrief(sql, od(), brf)).length).toBe(2);
    expect((await listByBrief(sql, opsStaff(PIC), brf)).map((r) => r.id)).toEqual([a.id]);
    expect((await listByBrief(sql, creativeStaff(), brf)).length).toBe(0);
  });

  it('getSku menolak pembaca di luar cakupan, dan 404 untuk id yang tidak ada', async () => {
    const brf = await insBrief();
    const r = await createSku(sql, am(), brf, scope());
    await expect(getSku(sql, creativeStaff(), r.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSku(sql, am(), 'SKU-000000-9999')).rejects.toBeInstanceOf(NotFoundError);
  });
});
