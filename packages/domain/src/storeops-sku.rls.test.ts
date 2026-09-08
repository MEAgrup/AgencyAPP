/**
 * M18 — dua gerbang baris SKU Store Operation, keduanya di DB:
 *   (a) `store_ops_skus_select` — siapa melihat baris siapa;
 *   (b) `trg_store_ops_skus_dinding_penulis` — siapa boleh menulis kolom mana.
 *
 * KENAPA KEDUANYA DI SATU BERKAS, dan kenapa keduanya diuji lewat DB sungguhan.
 *
 * Ketokan pemilik 2026-09-08 menaruh DUA penulis pada SATU baris: AM menulis
 * cakupan + target saat baris lahir, Store Operation menulis hasil saat eksekusi
 * lalu dampak saat evaluasi. Yang diminta secara eksplisit adalah dindingnya
 * **ditegakkan di DB, bukan cuma di TS** — karena sebuah gerbang TS hanya
 * berlaku untuk jalur yang memanggilnya, dan jalur kedua selalu muncul
 * belakangan (pelajaran STR-/STRG-: satu flag `false` cuma membuktikan SATU
 * pintu tertutup).
 *
 * Jadi tes ini menulis dari sisi yang **salah** dan menuntut kegagalan, memakai
 * koneksi service-role — persis jalur yang paling istimewa yang ada di sistem.
 * Kalau dindingnya ditulis di TS, tes ini hijau palsu; kalau ia ditulis sebagai
 * policy RLS, ia tidak pernah dievaluasi sama sekali (penulis BYPASSRLS).
 *
 * Sisi BACA-nya sebaliknya harus lewat `withClaims` (`SET LOCAL ROLE
 * authenticated` + klaim JWT sungguhan), pola `creative-asset-scope.rls.test.ts`:
 * tes domain biasa memakai koneksi BYPASSRLS dan karena itu buta terhadap
 * kombinasi "predikat TS meloloskan, RLS mengosongkan" — yang di UI terbaca
 * sebagai "belum ada datanya", bukan sebagai 403.
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZSO-`.
 */
import { createClient, withClaims, type Sql } from '@cdps/db';
import { storeops } from '@cdps/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const AM_PEMILIK = 'EMP-ZSO-AM';
const AM_LAIN = 'EMP-ZSO-AM2';
const PIC = 'EMP-ZSO-PIC';
const OPS_LAIN = 'EMP-ZSO-OPS2';

const CLI = 'CLI-ZSO-0001';
const SVC = 'SVC-ZSO-0001';
const BRF = 'BRF-ZSO-0001';
/** Dua baris: satu ber-PIC, satu belum dibagi leader — arm PIC tidak boleh jadi
 *  satu-satunya alasan sebuah baris terlihat oleh AM pemiliknya. */
const SKU_PIC = 'SKU-ZSO-0001';
const SKU_TANPA_PIC = 'SKU-ZSO-0002';
const MILIK_BRF = [SKU_PIC, SKU_TANPA_PIC];

/** Brief Store Operation milik AM LAIN — batas atas cakupan baca AM. */
const CLI_LAIN = 'CLI-ZSO-0009';
const BRF_LAIN = 'BRF-ZSO-0009';
const SKU_LAIN = 'SKU-ZSO-0009';
const SEMUA = [...MILIK_BRF, SKU_LAIN];

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

/** Baris `ZSO-` yang terlihat oleh sebuah claim set, terurut — kontraknya. */
async function terlihat(claim: Claim): Promise<string[]> {
  const rows = await withClaims(sql, claims(claim), (tx) =>
    tx<{ id: string }[]>`select id from store_ops_skus where id like 'SKU-ZSO-%' order by id`,
  );
  return rows.map((r) => r.id);
}

/**
 * UPDATE satu kolom dari sisi penulis `writer`, dalam SATU transaksi bersama
 * penandanya. `set_config(..., true)` = transaction-local, jadi penandanya
 * hilang saat COMMIT dan tidak bocor ke pemakai koneksi berikutnya.
 * `writer = null` sengaja menulis TANPA penanda — jalur mentah yang harus tumpul.
 */
async function tulis(
  writer: 'am' | 'ops' | null,
  id: string,
  kolom: string,
  nilai: string | number | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    if (writer !== null) {
      await tx`select set_config(${storeops.SKU_WRITER_GUC}, ${writer}, true)`;
    }
    await tx.unsafe(`update store_ops_skus set ${kolom} = $1 where id = $2`, [nilai, id]);
  });
}

/** Transisi lewat mesin #32 — satu-satunya penulis sah kolom `status`. */
async function transisi(id: string, ke: string): Promise<{ ok: boolean; message?: string }> {
  const rows = await sql<{ r: { ok: boolean; message?: string } }[]>`
    select sm_transition('store_ops_sku', 'store_ops_sku', 'store_ops_skus', 'id', 'status',
                         ${id}, ${ke}, ${PIC}, false, false, 'Store Operation') as r`;
  return rows[0].r;
}

async function statusOf(id: string): Promise<string> {
  const rows = await sql<{ status: string }[]>`select status from store_ops_skus where id = ${id}`;
  return rows[0].status;
}

/**
 * Kembalikan satu baris ke kondisi awal supaya tiap `it` berdiri sendiri.
 *
 * Jejak `audit_log`-nya sengaja TIDAK ikut dibersihkan — tidak bisa: tabel itu
 * menolak DELETE (aturan rumah #3, dijaga `immutability_checks`). Itulah kenapa
 * tes yang MENGHITUNG baris audit di bawah memakai id sekali-pakai per run,
 * bukan id bersama: pola `aktorUnik()` di `showcase.test.ts`, dan pelajaran A-T4
 * (dua suite atas DB yang sama memberi FAIL palsu karena `afterEach` tidak bisa
 * membersihkan audit).
 *
 * Reset status di sini lewat UPDATE status-SAJA, yaitu pintu yang dinding
 * penulis memang biarkan terbuka — jadi ia tidak diam-diam membuktikan
 * dindingnya longgar.
 */
async function resetBaris(id: string): Promise<void> {
  await sql`update store_ops_skus set status = '[Menunggu Eksekusi]' where id = ${id}`;
  await sql.begin(async (tx) => {
    await tx`select set_config('cdps.sku_writer', 'ops', true)`;
    await tx`update store_ops_skus set link_output = null, catatan_ops = null,
                                       ctr_sesudah = null where id = ${id}`;
  });
  await sql.begin(async (tx) => {
    await tx`select set_config('cdps.sku_writer', 'am', true)`;
    await tx`update store_ops_skus set target_ctr = 2.5 where id = ${id}`;
  });
}

beforeAll(async () => {
  if (!sql) return;
  const klien = async (id: string, amId: string): Promise<void> => {
    await sql`
      insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline,
                           target_gmv, sales_pic_id, commission_payment_pic_id,
                           released_to_account_at, assigned_am_id, created_by)
      values (${id}, 'PIC', ${'Toko ' + id}, 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
              'EMP-ZSO-SALES', 'EMP-ZSO-SALES', now(), ${amId}, 'EMP-ZSO-SEED')
      on conflict (id) do nothing`;
  };
  const layanan = async (id: string, clientId: string): Promise<void> => {
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
                            standard_price, commission_rule, status, created_by)
      values (${id}, ${clientId}, 'MS-ZSO', 1, 'Jasa', 0, 'none', '[Briefed]', 'EMP-ZSO-SEED')
      on conflict (id) do nothing`;
  };
  const brief = async (id: string, serviceId: string): Promise<void> => {
    await sql`
      insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
                          quantity_target, priority, recurring, created_by)
      values (${id}, ${serviceId}, 'optimasi SKU', '[To Do]', 'Store Operation', 'Gambar SKU',
              2, 'High', false, 'EMP-ZSO-SEED')
      on conflict (id) do nothing`;
  };
  /** Baris SKU lahir dari tangan AM — `created_by` AM, bukan Store Ops (Rule 2). */
  const baris = async (id: string, briefId: string, pic: string | null, am: string): Promise<void> => {
    await sql`
      insert into store_ops_skus (id, brief_id, nama_produk, link_sku, request_type,
                                  jenis_gambar, total_req_picture, expected_done,
                                  target_ctr, assigned_pic, created_by)
      values (${id}, ${briefId}, ${'Produk ' + id}, 'https://shopee.example/x',
              'Shopee New', 'Cover + Pendamping', 3, current_date + 3, 2.5, ${pic}, ${am})
      on conflict (id) do nothing`;
  };

  await klien(CLI, AM_PEMILIK);
  await layanan(SVC, CLI);
  await brief(BRF, SVC);
  await baris(SKU_PIC, BRF, PIC, AM_PEMILIK);
  await baris(SKU_TANPA_PIC, BRF, null, AM_PEMILIK);

  await klien(CLI_LAIN, AM_LAIN);
  await layanan('SVC-ZSO-0009', CLI_LAIN);
  await brief(BRF_LAIN, 'SVC-ZSO-0009');
  await baris(SKU_LAIN, BRF_LAIN, null, AM_LAIN);
});

afterAll(async () => {
  if (!sql) return;
  // JEBAKAN FK NO ACTION: satu baris SKU yang tertinggal membuat `delete from
  // briefs` di berkas MANA PUN gagal, dan seluruh berkas sesudahnya ikut merah
  // tanpa menyebut sebabnya. Sudah kena dua kali di repo ini (`briefs` di
  // strategi.test.ts, `assets` di account.test.ts) — anak dulu, induk kemudian.
  // `audit_log` TIDAK dibersihkan: ia menolak DELETE (aturan rumah #3). Baris
  // jejaknya memang tertinggal, dan itu sebabnya tes penghitung audit memakai
  // id sekali-pakai per run.
  await sql`delete from store_ops_skus where id like 'SKU-ZSO%'`;
  await sql`delete from briefs where id like 'BRF-ZSO-%'`;
  await sql`delete from services where id like 'SVC-ZSO-%'`;
  await sql`delete from clients where id like 'CLI-ZSO-%'`;
  await sql.end();
});

dDb('M18 §9 — cakupan baca `store_ops_skus_select`', () => {
  it('AM pemilik melihat SEMUA baris Brief-nya, termasuk yang belum dibagi leader', async () => {
    expect(await terlihat({ employeeId: AM_PEMILIK, division: 'Account', level: 'staff' }))
      .toEqual(MILIK_BRF);
  });

  it('arm-nya KEPEMILIKAN: AM klien lain hanya melihat barisnya sendiri', async () => {
    expect(await terlihat({ employeeId: AM_LAIN, division: 'Account', level: 'staff' }))
      .toEqual([SKU_LAIN]);
  });

  it('staff Store Operation melihat barisnya SENDIRI, bukan seluruh antrean divisi', async () => {
    // K-1: pembagian baris ke PIC adalah wewenang leader. Sebuah lengan
    // "se-divisi tanpa lead" di sini akan membuka baris orang lain — sengaja
    // TIDAK ada, dan baris ini yang menjaganya.
    expect(await terlihat({ employeeId: PIC, division: 'Store Operation', level: 'staff' }))
      .toEqual([SKU_PIC]);
  });

  it('staff Store Operation tanpa baris melihat NOL, bukan antrean divisinya', async () => {
    expect(await terlihat({ employeeId: OPS_LAIN, division: 'Store Operation', level: 'staff' }))
      .toEqual([]);
  });

  it('lead Store Operation melihat seluruh baris Brief divisinya', async () => {
    // Lewat `private.jwt_division_owns_brief` — pintu SECURITY DEFINER, bukan
    // join ke `briefs`: join langsung akan dipersempit `briefs_select` dan
    // MEMBUANG barisnya, bukan mengosongkan kolomnya (perangkap O52).
    expect(await terlihat({ employeeId: 'EMP-ZSO-LEAD', division: 'Store Operation', level: 'lead' }))
      .toEqual(SEMUA);
  });

  it('divisi lain TIDAK melihat apa pun — staff maupun lead', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZSO-CRE', division: 'Creative', level: 'staff' }))
      .toEqual([]);
    expect(await terlihat({ employeeId: 'EMP-ZSO-KOL', division: 'KOL', level: 'lead' }))
      .toEqual([]);
    // Ads punya lengan buta-klien di `assets_select` (B-5). Ia TIDAK diperluas
    // ke baris SKU — kalau seseorang menyalin policy Asset bulat-bulat, merah.
    expect(await terlihat({ employeeId: 'EMP-ZSO-ADS', division: 'Ads', level: 'lead' }))
      .toEqual([]);
  });

  it('OD dan Director melihat semuanya', async () => {
    expect(await terlihat({ employeeId: 'EMP-ZSO-OD', division: 'Ops', od: true })).toEqual(SEMUA);
    expect(await terlihat({ employeeId: 'EMP-ZSO-DIR', division: 'Ops', director: true }))
      .toEqual(SEMUA);
  });

  it('tanpa GRANT SELECT ke `authenticated` tes ini mustahil hijau', async () => {
    // Bukan tes kosmetik: `client_milestones` pernah rilis ber-RLS TANPA grant,
    // dan halamannya gagal untuk SETIAP pembaca sejak hari pertama sementara
    // seluruh suite domain (koneksi service-role) hijau.
    const rows = await sql<{ ok: boolean }[]>`
      select has_table_privilege('authenticated', 'public.store_ops_skus', 'SELECT') as ok`;
    expect(rows[0].ok).toBe(true);
  });
});

dDb('M18 §6 — dinding dua penulis, ditegakkan di DB', () => {
  it('UPDATE tanpa penanda sisi penulis ditolak seluruhnya, bahkan dari service role', async () => {
    await expect(tulis(null, SKU_PIC, 'catatan_ops', 'diam-diam')).rejects.toThrow(
      '[baris SKU hanya boleh diubah lewat jalur AM atau Store Operation]',
    );
  });

  it('Store Ops TIDAK bisa menyentuh kolom target — inti ketokan 2026-09-08', async () => {
    await expect(tulis('ops', SKU_PIC, 'target_ctr', 9.9)).rejects.toThrow(
      '[kolom cakupan dan target SKU hanya boleh diisi Account Manager]',
    );
  });

  it('Store Ops TIDAK bisa menyentuh cakupan (SKU mana, berapa gambar) juga', async () => {
    await expect(tulis('ops', SKU_PIC, 'total_req_picture', 99)).rejects.toThrow(
      '[kolom cakupan dan target SKU hanya boleh diisi Account Manager]',
    );
  });

  it('AM TIDAK bisa menyentuh kolom hasil', async () => {
    await expect(tulis('am', SKU_PIC, 'link_output', 'https://drive.example/x')).rejects.toThrow(
      '[kolom hasil dan dampak SKU hanya boleh diisi Store Operation]',
    );
  });

  it('AM TIDAK bisa mengisi angka dampak — evaluasi milik Store Ops (ketokan)', async () => {
    await expect(tulis('am', SKU_PIC, 'ctr_sesudah', 4.2)).rejects.toThrow(
      '[kolom hasil dan dampak SKU hanya boleh diisi Store Operation]',
    );
  });

  it('AM TIDAK bisa menunjuk PIC — siapa yang mengerjakan tetap wewenang leader (K-1)', async () => {
    await expect(tulis('am', SKU_TANPA_PIC, 'assigned_pic', 'EMP-ZSO-PIC')).rejects.toThrow(
      '[kolom hasil dan dampak SKU hanya boleh diisi Store Operation]',
    );
  });

  it('identitas baris (brief induk, pencipta) tidak bisa diubah dari sisi mana pun', async () => {
    await expect(tulis('am', SKU_PIC, 'created_by', 'EMP-PALSU')).rejects.toThrow(
      '[identitas baris SKU tidak dapat diubah]',
    );
  });

  it('sisi yang BENAR lolos: AM mengubah target selama eksekusi belum mulai', async () => {
    await resetBaris(SKU_PIC);
    await tulis('am', SKU_PIC, 'target_ctr', 3.75);
    const rows = await sql<{ v: string }[]>`select target_ctr::text as v from store_ops_skus where id = ${SKU_PIC}`;
    expect(Number(rows[0].v)).toBe(3.75);
  });

  it('sisi yang BENAR lolos: Store Ops mengisi hasil', async () => {
    await tulis('ops', SKU_PIC, 'link_output', 'https://drive.example/hasil');
    const rows = await sql<{ v: string | null }[]>`select link_output as v from store_ops_skus where id = ${SKU_PIC}`;
    expect(rows[0].v).toBe('https://drive.example/hasil');
  });

  it('begitu eksekusi mulai, target BEKU walau penulisnya AM', async () => {
    // Ini kalimat ketokannya diterjemahkan jadi kode: janji ke klien tidak boleh
    // berubah setelah hasilnya keluar. Tanpa baris ini, satu UPDATE menurunkan
    // target sesudah angka dampaknya masuk dan "achieve" jadi gratis.
    await resetBaris(SKU_PIC);
    expect((await transisi(SKU_PIC, '[Dikerjakan]')).ok).toBe(true);
    await expect(tulis('am', SKU_PIC, 'target_ctr', 0.1)).rejects.toThrow(
      '[cakupan dan target SKU tidak dapat diubah setelah Store Operation mulai mengerjakan]',
    );
    // …dan Store Ops tetap boleh bekerja pada baris yang sama.
    await tulis('ops', SKU_PIC, 'link_output', 'https://drive.example/hasil-2');
    await resetBaris(SKU_PIC);
  });
});

dDb('M18 §6 — pintu `sm_transition`, satu-satunya penulis kolom status', () => {
  it('transisi lolos TANPA penanda penulis (status-saja adalah pintunya)', async () => {
    await resetBaris(SKU_TANPA_PIC);
    expect((await transisi(SKU_TANPA_PIC, '[Dikerjakan]')).ok).toBe(true);
    expect(await statusOf(SKU_TANPA_PIC)).toBe('[Dikerjakan]');
    await resetBaris(SKU_TANPA_PIC);
  });

  it('mengubah status BERSAMAAN dengan kolom data ditolak — bukan bentuk yang sm_transition hasilkan', async () => {
    await expect(
      sql`update store_ops_skus set status = '[Dikerjakan]', catatan_ops = 'x' where id = ${SKU_TANPA_PIC}`,
    ).rejects.toThrow('[status baris SKU hanya boleh diubah lewat mesin transisi]');
  });

  it('transisi yang tidak terdaftar diblokir dengan pesan BI mesinnya', async () => {
    await resetBaris(SKU_TANPA_PIC);
    const r = await transisi(SKU_TANPA_PIC, '[Dievaluasi]');
    expect(r.ok).toBe(false);
    expect(r.message).toBe('[transisi status tidak diizinkan]');
  });
});

dDb('M18 Rule 4 / ketokan K-6 — `[Terupload]` tidak menunggu angka dampak', () => {
  it('SKU bisa mencapai [Terupload] dengan enam kolom dampak masih NULL', async () => {
    // Kalau seseorang menambahkan gerbang "CTR/CVR wajib" pada transisi ini,
    // leadtime PRODUKSI Store Ops mulai memuat ~30 hari waktu tunggu pasar —
    // dan angka leadtime yang mengukur dua hal sekaligus tidak mengukur apa pun.
    await resetBaris(SKU_TANPA_PIC);
    expect((await transisi(SKU_TANPA_PIC, '[Dikerjakan]')).ok).toBe(true);
    expect((await transisi(SKU_TANPA_PIC, '[Terupload]')).ok).toBe(true);
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from store_ops_skus
       where id = ${SKU_TANPA_PIC}
         and ctr_sebelum is null and cvr_sebelum is null and rating_sebelum is null
         and ctr_sesudah is null and cvr_sesudah is null and rating_sesudah is null`;
    expect(rows[0].n).toBe(1);
  });

  it('evaluasi adalah LANGKAH TERPISAH sesudahnya, bukan syarat selesai', async () => {
    expect(await statusOf(SKU_TANPA_PIC)).toBe('[Terupload]');
    await tulis('ops', SKU_TANPA_PIC, 'ctr_sesudah', 4.2);
    expect((await transisi(SKU_TANPA_PIC, '[Dievaluasi]')).ok).toBe(true);
    expect(await statusOf(SKU_TANPA_PIC)).toBe(storeops.SKU_TERMINAL_STATE);
    await resetBaris(SKU_TANPA_PIC);
  });

  it('[Gagal Upload] bisa kembali ke [Dikerjakan] pada baris yang SAMA, dan ketiga langkahnya tercatat', async () => {
    // Baris SKU baru akan menyembunyikan kegagalan pertama dari penyebut
    // "% SKU Gagal Upload" — metrik yang worksheet divisi memang hitung, dan
    // yang PRD §5 turunkan dari "pernah menyentuh [Gagal Upload]" di audit_log.
    //
    // Id-nya sekali-pakai per run: `audit_log` menolak DELETE, jadi id bersama
    // akan membuat hitungan ini naik tiga setiap kali suite dijalankan ulang
    // atas DB yang sama (jebakan A-T4). Induknya BRF_LAIN supaya hitungan
    // `brief_jumlah_anak(BRF)` di bawah tidak ikut bergeser.
    const id = `SKU-ZSOG${Date.now().toString(36).toUpperCase()}`;
    await sql`
      insert into store_ops_skus (id, brief_id, nama_produk, request_type, jenis_gambar,
                                  total_req_picture, created_by)
      values (${id}, ${BRF_LAIN}, 'Produk gagal', 'Tiktok New', 'Cover Only', 1, ${AM_LAIN})`;

    expect((await transisi(id, '[Dikerjakan]')).ok).toBe(true);
    expect((await transisi(id, '[Gagal Upload]')).ok).toBe(true);
    expect((await transisi(id, '[Dikerjakan]')).ok).toBe(true);

    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_type = 'store_ops_sku' and entity_id = ${id}`;
    expect(rows[0].n).toBe(3);
  });
});

dDb('M18 §8 — `private.brief_jumlah_anak` dapat cabang Store Operation', () => {
  it('menghitung baris SKU, bukan jatuh ke ELSE 0 seperti sebelum M18', async () => {
    const rows = await sql<{ n: number }[]>`select private.brief_jumlah_anak(${BRF}) as n`;
    expect(rows[0].n).toBe(2);
  });

  it('angkanya BENAR di bawah RLS untuk staff yang hanya memiliki satu baris', async () => {
    // Inti alasan fungsinya SECURITY DEFINER: `count(*)` biasa di `briefCols`
    // dihitung di bawah policy pembacanya, dan `store_ops_skus_select` punya
    // lengan `assigned_pic`. Seorang staff akan melihat "1" untuk Brief berisi
    // 2 SKU — tanpa galat, dengan halaman menjawab 200. Angka antrean yang
    // salah lebih buruk daripada nol angka.
    const rows = await withClaims(
      sql,
      claims({ employeeId: PIC, division: 'Store Operation', level: 'staff' }),
      (tx) => tx<{ n: number }[]>`select private.brief_jumlah_anak(${BRF}) as n`,
    );
    expect(rows[0].n).toBe(2);
  });

  it('divisi tanpa tabel anak tetap 0, bukan NULL (kontrak A-req-3 utuh)', async () => {
    const rows = await sql<{ n: number }[]>`
      select private.brief_jumlah_anak(b.id) as n from briefs b
       where b.assigned_division = 'Account' limit 1`;
    if (rows.length > 0) expect(rows[0].n).toBe(0);
  });
});
