/**
 * M18 Store Operation — DINDING dua penulis + mesin #32 `store_ops_sku`.
 * Migrasi `20260924010000_w3_store_ops_sku.sql`, PRD `docs/prd/CDPS_Module18_Store_Ops.md`.
 *
 * ## Kenapa tes ini ada di lapisan SQL, bukan di lapisan domain
 *
 * Ketokan pemilik 2026-09-08 menuntut pembagian peran AM ⇄ Store Ops ditegakkan
 * **di DB, bukan cuma di TS**. Gerbang TS bisa benar dan tetap dilewati: setiap
 * tulisan domain masuk lewat koneksi service-role, dan job/backfill/perbaikan
 * manual tidak melewati `packages/domain` sama sekali.
 *
 * Jadi yang di-assert di sini adalah **UPDATE mentah yang HARUS gagal**. Kalau
 * satu pun `expect(...).rejects` di berkas ini berubah jadi lolos, dindingnya
 * hilang — dan hilangnya senyap, karena setiap tes domain di atasnya akan tetap
 * hijau.
 *
 * Dua mode gagal yang dijaga, dan keduanya disebut sendiri oleh ketokannya:
 *   (a) **target berubah SESUDAH hasilnya keluar** — "% Achievement" lalu
 *       dihitung terhadap angka yang digeser belakangan;
 *   (b) **hasil terisi sebelum ada pekerjaan** — angka yang tidak punya asal.
 *
 * Ditambah K-6, yang bentuknya sepasang CHECK dan gampang sekali rusak oleh
 * "kerapian": `[Terupload]` TIDAK menyebut satu pun kolom dampak. Kalau nanti
 * ada yang menambahkan `ctr_sesudah IS NOT NULL` ke `ck_sku_terupload` dengan
 * niat baik, tes `K-6` di bawah yang menahannya.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZSO-` dan
 * dibersihkan di afterAll (urutan anak→induk, FK NO ACTION).
 */
import { createClient, type Sql } from '@cdps/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const AM = 'EMP-ZSO-AM';
const PIC = 'EMP-ZSO-PIC';
const LEAD = 'EMP-ZSO-LEAD';

const CLI = 'CLI-ZSO-0001';
const SVC = 'SVC-ZSO-0001';
const BRF = 'BRF-ZSO-0001';
const SKU = 'SKU-ZSO-0001';

/** Satu baris SKU segar di `[Belum Dikerjakan]`, dipakai ulang tiap tes. */
async function baris(): Promise<void> {
  await sql`delete from sku_optimizations where id like 'SKU-ZSO-%'`;
  await sql`
    insert into sku_optimizations
      (id, brief_id, sequence_no, request_type, jenis_gambar, nama_produk, link_sku,
       total_req_picture, expected_done, target_ctr, target_cvr, created_by)
    values (${SKU}, ${BRF}, 1, 'Shopee New', 'Cover Only', 'Kaos Polos',
            'https://shopee.example/kaos', 3, current_date + 5, 2.5000, 1.2000, ${AM})`;
}

/** Gerakkan status lewat mesin — satu-satunya jalur sah (aturan rumah #2). */
async function pindah(
  ke: string,
  opts: { aktor?: string; lead?: boolean } = {},
): Promise<{ ok: boolean; code?: string; message?: string }> {
  const rows = await sql<{ r: { ok: boolean; code?: string; message?: string } }[]>`
    select sm_transition('store_ops_sku', 'store_ops_sku', 'sku_optimizations',
                         'id', 'status', ${SKU}, ${ke},
                         ${opts.aktor ?? PIC}, false, ${opts.lead ?? false}) as r`;
  return rows[0].r;
}

/**
 * Bawa baris ke `[Terupload]` seperti jalur sungguhannya: isi bukti produksi
 * DULU, transisi kemudian, dalam urutan yang sama dengan yang akan dipakai
 * domain (pola `internal_tasks`/`riset_awal` — CHECK non-deferrable menuntutnya).
 */
async function upload(): Promise<void> {
  await pindah('[Dikerjakan]');
  await sql`
    update sku_optimizations
       set link_output = 'https://drive.example/hasil', terupload_pada = now()
     where id = ${SKU}`;
  await pindah('[Terupload]');
}

beforeAll(async () => {
  if (!sql) return;
  const karyawan = async (id: string, divisi: string, jabatan: string): Promise<void> => {
    await sql`
      insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
      values (${id}, ${id}, ${id + '@zso.example'}, ${divisi}, ${jabatan}, true, 'EMP-ZSO-AM')
      on conflict (employee_id) do nothing`;
  };
  await karyawan(AM, 'Account', 'Account Manager');
  await karyawan(PIC, 'Store Operation', 'Staff');
  await karyawan(LEAD, 'Store Operation', 'Lead');

  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline,
                         target_gmv, sales_pic_id, commission_payment_pic_id,
                         released_to_account_at, assigned_am_id, created_by)
    values (${CLI}, 'PIC', 'Toko ZSO', 'Bandung', 'https://t.example', 'Fashion', 0, 0,
            ${AM}, ${AM}, now(), ${AM}, ${AM})
    on conflict (id) do nothing`;
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
                          standard_price, commission_rule, status, created_by)
    values (${SVC}, ${CLI}, 'MS-ZSO', 1, 'Jasa', 0, 'none', '[Briefed]', ${AM})
    on conflict (id) do nothing`;
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
                        quantity_target, priority, recurring, created_by)
    values (${BRF}, ${SVC}, 'brief store ops', '[To Do]', 'Store Operation', 'Optimasi SKU',
            5, 'High', false, ${AM})
    on conflict (id) do nothing`;
});

beforeEach(async () => {
  if (!sql) return;
  await baris();
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from sku_optimizations where id like 'SKU-ZSO-%'`;
  await sql`delete from briefs where id like 'BRF-ZSO-%'`;
  await sql`delete from services where id like 'SVC-ZSO-%'`;
  await sql`delete from clients where id like 'CLI-ZSO-%'`;
  await sql`delete from employees where employee_id like 'EMP-ZSO-%'`;
  await sql.end();
});

dDb('M18 — dinding kelompok A (cakupan + target, milik AM)', () => {
  it('AM boleh mengoreksi cakupan DAN target selama nol pekerjaan terjadi', async () => {
    // Batas bawah dindingnya. Dinding yang menolak koreksi sebelum pekerjaan
    // dimulai bukan dinding, ia penghalang — AM salah ketik SKU harus bisa
    // membetulkannya tanpa membuang barisnya.
    await sql`
      update sku_optimizations
         set nama_produk = 'Kaos Lengan Panjang', target_ctr = 3.0000
       where id = ${SKU}`;
    const [row] = await sql<{ nama_produk: string; target_ctr: string }[]>`
      select nama_produk, target_ctr from sku_optimizations where id = ${SKU}`;
    expect(row.nama_produk).toBe('Kaos Lengan Panjang');
    expect(Number(row.target_ctr)).toBe(3);
  });

  it('(a) target BEKU begitu pekerjaan dimulai — mode gagal yang ketokannya sebut', async () => {
    await pindah('[Dikerjakan]');
    await expect(
      sql`update sku_optimizations set target_ctr = 0.0001 where id = ${SKU}`,
    ).rejects.toThrow(/target beku setelah pekerjaan dimulai/);
  });

  it('target tetap beku sesudah [Terupload] — bukan cuma di [Dikerjakan]', async () => {
    // Dinding yang hanya menjaga satu state adalah dinding yang bisa dilewati
    // dengan menunggu.
    await upload();
    await expect(
      sql`update sku_optimizations set target_cvr = 0.0001 where id = ${SKU}`,
    ).rejects.toThrow(/target beku setelah pekerjaan dimulai/);
  });

  it('cakupan (SKU mana, berapa gambar, kapan) ikut beku, bukan hanya angkanya', async () => {
    await pindah('[Dikerjakan]');
    await expect(
      sql`update sku_optimizations set total_req_picture = 99 where id = ${SKU}`,
    ).rejects.toThrow(/cakupan SKU beku setelah pekerjaan dimulai/);
    await expect(
      sql`update sku_optimizations set expected_done = current_date + 90 where id = ${SKU}`,
    ).rejects.toThrow(/cakupan SKU beku setelah pekerjaan dimulai/);
  });
});

dDb('M18 — dinding kelompok B (hasil + dampak, milik Store Ops)', () => {
  it('(b) hasil DITOLAK selama baris masih [Belum Dikerjakan]', async () => {
    await expect(
      sql`update sku_optimizations set link_output = 'https://palsu.example' where id = ${SKU}`,
    ).rejects.toThrow(/hasil\/dampak tidak boleh terisi selama baris masih \[Belum Dikerjakan\]/);
  });

  it('(b) angka dampak juga ditolak di [Belum Dikerjakan]', async () => {
    await expect(
      sql`update sku_optimizations set ctr_sesudah = 9.9999 where id = ${SKU}`,
    ).rejects.toThrow(/hasil\/dampak tidak boleh terisi selama baris masih \[Belum Dikerjakan\]/);
  });

  it('`assigned_pic` DIKECUALIKAN — lead menugaskan orang sebelum barisnya mulai', async () => {
    // Ini batas bawah yang gampang hilang kalau dindingnya ditulis sebagai
    // "seluruh kelompok B beku di [Belum Dikerjakan]". Menugaskan orang justru
    // langkah yang wajar terjadi lebih dulu, dan K-1 menaruhnya di lead divisi.
    await sql`update sku_optimizations set assigned_pic = ${PIC} where id = ${SKU}`;
    const [row] = await sql<{ assigned_pic: string }[]>`
      select assigned_pic from sku_optimizations where id = ${SKU}`;
    expect(row.assigned_pic).toBe(PIC);
  });
});

dDb('M18 — jangkar sekali tulis & bukti beku', () => {
  it('`terupload_pada` beku — jangkar leadtime produksi tak bisa digeser', async () => {
    await upload();
    await expect(
      sql`update sku_optimizations set terupload_pada = now() - interval '30 days' where id = ${SKU}`,
    ).rejects.toThrow(/terupload_pada beku/);
  });

  it('`link_output` beku setelah [Terupload] — mengganti bukti = mengedit riwayat', async () => {
    await upload();
    await expect(
      sql`update sku_optimizations set link_output = 'https://lain.example' where id = ${SKU}`,
    ).rejects.toThrow(/link_output beku setelah \[Terupload\]/);
  });

  it('induk dan identitas beku selamanya', async () => {
    await expect(
      sql`update sku_optimizations set brief_id = 'BRF-ZSO-9999' where id = ${SKU}`,
    ).rejects.toThrow(/brief_id beku/);
    await expect(
      sql`update sku_optimizations set sequence_no = 7 where id = ${SKU}`,
    ).rejects.toThrow(/sequence_no beku/);
  });
});

dDb('K-6 — "selesai" tidak menunggu angka dampak', () => {
  it('[Terupload] TIDAK menuntut satu pun CTR/CVR — inilah isi ketokannya', async () => {
    // Kalau seseorang "merapikan" `ck_sku_terupload` dengan menambahkan syarat
    // dampak, tes inilah yang merah. Leadtime produksi Store Ops yang mengukur
    // produksi DAN tunggu pasar sekaligus tidak mengukur apa pun.
    await upload();
    const [row] = await sql<{ status: string; ctr_sesudah: string | null }[]>`
      select status, ctr_sesudah from sku_optimizations where id = ${SKU}`;
    expect(row.status).toBe('[Terupload]');
    expect(row.ctr_sesudah).toBeNull();
  });

  it('[Terupload] TETAP menuntut bukti produksi — link_output + jangkar', async () => {
    // Sisi lain dari tes di atas: "tidak menunggu dampak" bukan "tidak menuntut
    // apa-apa".
    //
    // Perhatikan BENTUK penolakannya: `ck_sku_terupload` non-deferrable, jadi ia
    // meledak sebagai galat Postgres di dalam `sm_transition` — bukan
    // `{ok: false}` yang sopan. Itu memang jalur yang benar (transaksinya
    // ter-rollback penuh, status tidak bergerak), dan domain PR 2 karena itu
    // WAJIB menulis bukti produksi SEBELUM memanggil transisi — pola yang sama
    // dengan `internal_tasks.link_hasil` dan `riset_awal.disubmit_pada`.
    await pindah('[Dikerjakan]');
    await expect(pindah('[Terupload]')).rejects.toThrow(/ck_sku_terupload/);
    const [row] = await sql<{ status: string }[]>`
      select status from sku_optimizations where id = ${SKU}`;
    expect(row.status).toBe('[Dikerjakan]');
  });

  it('[Dievaluasi] MENUNTUT CTR/CVR sebelum & sesudah — satu state kemudian', async () => {
    await upload();
    await expect(
      sql`update sku_optimizations set dievaluasi_pada = now(), status = '[Dievaluasi]'
           where id = ${SKU}`,
    ).rejects.toThrow(/ck_sku_dievaluasi/);
  });

  it('langkah evaluasi lengkap berhasil, dan angkanya beku sesudahnya', async () => {
    await upload();
    await sql`
      update sku_optimizations
         set ctr_sebelum = 1.0000, cvr_sebelum = 0.5000,
             ctr_sesudah = 2.6000, cvr_sesudah = 1.3000, dievaluasi_pada = now()
       where id = ${SKU}`;
    expect((await pindah('[Dievaluasi]')).ok).toBe(true);
    await expect(
      sql`update sku_optimizations set ctr_sesudah = 9.0000 where id = ${SKU}`,
    ).rejects.toThrow(/angka dampak beku setelah \[Dievaluasi\]/);
  });

  it('rating opsional — ia tidak ikut menggerbang [Dievaluasi]', async () => {
    // Sejalan dengan `target_rating` yang NULL-able: rating tidak selalu
    // bergerak untuk tiap SKU, dan K-6 menyebut CTR/CVR sebagai yang wajib.
    await upload();
    await sql`
      update sku_optimizations
         set ctr_sebelum = 1.0000, cvr_sebelum = 0.5000,
             ctr_sesudah = 2.6000, cvr_sesudah = 1.3000, dievaluasi_pada = now()
       where id = ${SKU}`;
    expect((await pindah('[Dievaluasi]')).ok).toBe(true);
    const [row] = await sql<{ rating_sesudah: string | null }[]>`
      select rating_sesudah from sku_optimizations where id = ${SKU}`;
    expect(row.rating_sesudah).toBeNull();
  });
});

dDb('M18 — mesin #32 `store_ops_sku`', () => {
  it('lahir di [Belum Dikerjakan]', async () => {
    const [row] = await sql<{ status: string }[]>`
      select status from sku_optimizations where id = ${SKU}`;
    expect(row.status).toBe('[Belum Dikerjakan]');
  });

  it('nol edge mundur dari [Terupload] — jangkar produksi tak bisa dibatalkan', async () => {
    await upload();
    const r = await pindah('[Dikerjakan]');
    expect(r.ok).toBe(false);
  });

  it('pembatalan digerbang LEAD — yang diukur tak boleh mencabut ukurannya sendiri', async () => {
    // Baris [Dibatalkan] keluar dari penyebut %Ontime (PRD §5). Gerbang yang
    // sama persis dengan alasan M12 §5.3a mengunci [Blocked] ke SPV/Lead.
    await sql`update sku_optimizations set dibatalkan_pada = now(),
                 alasan_pembatalan = 'SKU ditarik klien' where id = ${SKU}`;
    expect((await pindah('[Dibatalkan]', { aktor: PIC, lead: false })).ok).toBe(false);
    expect((await pindah('[Dibatalkan]', { aktor: LEAD, lead: true })).ok).toBe(true);
  });

  it('[Dievaluasi] dan [Dibatalkan] terminal', async () => {
    await sql`update sku_optimizations set dibatalkan_pada = now(),
                 alasan_pembatalan = 'batal' where id = ${SKU}`;
    await pindah('[Dibatalkan]', { aktor: LEAD, lead: true });
    await expect(
      sql`update sku_optimizations set status = '[Dikerjakan]' where id = ${SKU}`,
    ).rejects.toThrow(/adalah state terminal/);
  });

  it('setiap transisi meninggalkan baris audit — riwayat immutable (aturan rumah #3)', async () => {
    // DELTA, bukan hitungan absolut. `audit_log` menolak DELETE (aturan rumah
    // #3), jadi `afterEach`/`beforeEach` tidak bisa membersihkannya: baris dari
    // tes-tes sebelumnya di berkas ini menumpuk pada `entity_id` yang sama, dan
    // asersi absolut akan merah karena urutan tes — bukan karena ada bug.
    // Ranjau ini sudah memakan dua siklus sesi lain (handoff Jalur B §Ranjau 1).
    const hitung = async (): Promise<number> => {
      const [{ n }] = await sql<{ n: string }[]>`
        select count(*) as n from audit_log
         where entity_type = 'store_ops_sku' and entity_id = ${SKU}
           and action like 'transition:%'`;
      return Number(n);
    };
    const sebelum = await hitung();
    await upload();
    expect((await hitung()) - sebelum).toBe(2);
  });
});

dDb('M18 — kosakata worksheet tertutup (PRD Rule 12)', () => {
  it('`request_type` di luar tujuh nilai ditolak', async () => {
    await expect(sql`
      insert into sku_optimizations
        (id, brief_id, sequence_no, request_type, jenis_gambar, nama_produk, link_sku,
         total_req_picture, expected_done, target_ctr, target_cvr, created_by)
      values ('SKU-ZSO-0002', ${BRF}, 2, 'Lazada New', 'Cover Only', 'X', 'https://x.example',
              1, current_date, 1.0, 1.0, ${AM})`).rejects.toThrow(/ck_sku_request_type/);
  });

  it('`jenis_gambar` di luar empat nilai ditolak', async () => {
    await expect(sql`
      insert into sku_optimizations
        (id, brief_id, sequence_no, request_type, jenis_gambar, nama_produk, link_sku,
         total_req_picture, expected_done, target_ctr, target_cvr, created_by)
      values ('SKU-ZSO-0003', ${BRF}, 3, 'Shopee New', 'Cover Saja', 'X', 'https://x.example',
              1, current_date, 1.0, 1.0, ${AM})`).rejects.toThrow(/ck_sku_jenis_gambar/);
  });

  it('target WAJIB — "diisi oleh AM, BESERTA targetnya" (PRD Rule 4)', async () => {
    await expect(sql`
      insert into sku_optimizations
        (id, brief_id, sequence_no, request_type, jenis_gambar, nama_produk, link_sku,
         total_req_picture, expected_done, created_by)
      values ('SKU-ZSO-0004', ${BRF}, 4, 'Shopee New', 'Cover Only', 'X', 'https://x.example',
              1, current_date, ${AM})`).rejects.toThrow(/target_ctr/);
  });

  it('`sequence_no` unik per Brief — pola `assets`', async () => {
    await expect(sql`
      insert into sku_optimizations
        (id, brief_id, sequence_no, request_type, jenis_gambar, nama_produk, link_sku,
         total_req_picture, expected_done, target_ctr, target_cvr, created_by)
      values ('SKU-ZSO-0005', ${BRF}, 1, 'Shopee New', 'Cover Only', 'X', 'https://x.example',
              1, current_date, 1.0, 1.0, ${AM})`).rejects.toThrow(/uq_sku_brief_seq/);
  });
});

dDb('M18 — `private.brief_jumlah_anak` mendapat cabang Store Operation', () => {
  it('menghitung baris SKU, bukan jatuh ke ELSE 0', async () => {
    // A-req-3 memakai satu fungsi ber-CASE. Sebelum migrasi ini, Brief Store Ops
    // jatuh ke `ELSE 0` dan leader melihat "belum dipecah" untuk Brief berisi 5
    // SKU — persis keluhan yang A-req-3 tutup untuk divisi lain.
    const [{ n }] = await sql<{ n: number }[]>`
      select private.brief_jumlah_anak(${BRF}) as n`;
    expect(n).toBe(1);
  });

  it('baris [Dibatalkan] IKUT terhitung — angka ini "sudah dipecah jadi berapa"', async () => {
    // Bukan "berapa yang masih hidup". Yang kedua adalah pekerjaan rollup
    // (PR 2), dan ia butuh pembilang DAN penyebut — bukan satu angka yang
    // diam-diam sudah menyaring.
    await sql`update sku_optimizations set dibatalkan_pada = now(),
                 alasan_pembatalan = 'batal' where id = ${SKU}`;
    await pindah('[Dibatalkan]', { aktor: LEAD, lead: true });
    const [{ n }] = await sql<{ n: number }[]>`
      select private.brief_jumlah_anak(${BRF}) as n`;
    expect(n).toBe(1);
  });
});
