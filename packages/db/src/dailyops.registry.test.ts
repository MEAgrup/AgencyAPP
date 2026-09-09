/**
 * M19 — gerbang dual-home Creative Daily Ops: `dailyops` (TS) ≡ skema DB.
 *
 * KENAPA ADA. `task_type` dan `alasan` adalah enum tertutup yang hidup di dua
 * tempat (CHECK constraint ↔ konstanta di `packages/core/src/dailyops.ts`), dan
 * `studios` adalah registry ber-baris yang hidup di dua tempat (tabel ↔
 * `STUDIOS`). Registry yang tidak dipaksa identik hanyalah komentar — dan
 * divergensinya punya bentuk yang sangat khusus di sini:
 *
 *   - TS punya nilai yang DB tolak ⇒ form lolos validasi lalu gagal di INSERT
 *     dengan pesan constraint mentah (bukan bahasa pengguna);
 *   - DB punya nilai yang TS tidak tahu ⇒ baris lama tiba-tiba tidak bisa
 *     dirender;
 *   - `studios.cek_konflik` berbeda antara TS dan DB ⇒ **pemeriksaan konflik
 *     studio diam-diam mati atau diam-diam menyala**. Itu kelas yang paling
 *     buruk di sini: tidak ada galat, tidak ada baris hilang, cuma peringatan
 *     yang seharusnya muncul dan tidak muncul.
 *
 * Pola dan alasan lokasinya sama dengan `ident.registry.test.ts` (PREFIXES ↔
 * entity_prefix), `division.registry.test.ts` (DIVISIONS ↔ division_registry),
 * dan `storeops.registry.test.ts`: berkas ini butuh KEDUA belahan — konstanta
 * TS (core) dan koneksi Postgres (db) — dan `core` sengaja tidak punya
 * dependency `postgres`.
 *
 * Perbandingannya SET-EQUAL, bukan hitungan: dua kesalahan yang saling menutupi
 * memberi hitungan yang cocok (blind spot yang sudah dicatat
 * `notif_catalog.reals.test.ts`).
 *
 * Di-skip tanpa `DATABASE_URL`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { dailyops } from '@cdps/core';
import { createClient, type Sql } from './client';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql | undefined;
function db(): Sql {
  sql ??= createClient(URL as string);
  return sql;
}

afterAll(async () => {
  await sql?.end();
});

/**
 * Nilai literal di dalam CHECK constraint `col IN ('a', 'b', …)`. Dibaca dari
 * `pg_get_constraintdef` — teks yang DIHASILKAN katalog, bukan teks migrasi,
 * jadi ia ikut menangkap constraint yang di-ALTER belakangan.
 */
async function nilaiCheck(tabel: string, nama: string): Promise<string[]> {
  const rows = await db()<{ def: string }[]>`
    select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = ${tabel} and c.conname = ${nama}`;
  expect(rows.length, `constraint ${nama} tidak ditemukan di ${tabel}`).toBe(1);
  return [...rows[0].def.matchAll(/'((?:[^']|'')*)'/g)]
    .map((m) => m[1].replace(/''/g, "'"))
    .sort();
}

describe('M19 kosakata — invariant TS', () => {
  it('tidak ada nilai ganda di kedua enum maupun di registry studio', () => {
    expect(new Set(dailyops.TASK_TYPES).size).toBe(dailyops.TASK_TYPES.length);
    expect(new Set(dailyops.ALASAN_TIDAK_TERSEDIA).size).toBe(dailyops.ALASAN_TIDAK_TERSEDIA.length);
    expect(new Set(dailyops.STUDIOS.map((s) => s.code)).size).toBe(dailyops.STUDIOS.length);
    expect(new Set(dailyops.STUDIOS.map((s) => s.urutan)).size).toBe(dailyops.STUDIOS.length);
  });

  it('NOL nama state — modul ini nol mesin status dengan sengaja (Rule 1/D1)', () => {
    // Kalau seseorang menambahkan SLOT_STATES/STATUS_* di `dailyops.ts`, ia
    // sedang membatalkan D1 ("PROD-SLOT adalah catatan rencana, bukan
    // deliverable") tanpa entri DECISIONS.md. Baris ini yang merah lebih dulu.
    const kunci = Object.keys(dailyops as Record<string, unknown>);
    expect(kunci.filter((k) => /STATE|STATUS/i.test(k))).toEqual([]);
  });

  it('predikat menolak nilai yang tidak terdaftar', () => {
    expect(dailyops.isTaskType('Shoot')).toBe(true);
    expect(dailyops.isTaskType('Shooting')).toBe(false);
    expect(dailyops.isAlasanTidakTersedia('Cuti')).toBe(true);
    expect(dailyops.isAlasanTidakTersedia('Cuti Tahunan')).toBe(false);
  });

  it('alasan TIDAK tumbuh menjadi taksonomi cuti HR', () => {
    // CDPS bukan HRIS. Empat nilai ini menjawab "boleh dijadwalkan atau tidak",
    // bukan "hak cutinya berapa". Menambah 'Cuti Tahunan'/'Unpaid'/'Melahirkan'
    // adalah memperluas klaim kewenangan dan butuh entri DECISIONS.md — bukan
    // satu baris. Jumlahnya dipaku supaya penambahan itu terlihat di diff.
    expect(dailyops.ALASAN_TIDAK_TERSEDIA.length).toBe(4);
  });

  it('studioNama() tidak pernah mengembalikan string kosong, bahkan untuk kode asing', () => {
    expect(dailyops.studioNama('KASUARI')).toBe('Kasuari');
    // Fallback ke kode mentah: pesan peringatan `[studio X sudah dipakai ...]`
    // dengan X kosong adalah pesan yang tidak menyebut apa pun.
    expect(dailyops.studioNama('TIDAK_ADA')).toBe('TIDAK_ADA');
  });

  it('`Luar Kantor` adalah SATU-SATUNYA studio tanpa cek konflik', () => {
    const tanpaCek = dailyops.STUDIOS.filter((s) => !s.cekKonflik).map((s) => s.code);
    expect(tanpaCek).toEqual(['LUAR_KANTOR']);
  });

  it('waktuBertumpang() setengah terbuka — slot bersambung BUKAN konflik', () => {
    // Inti perilakunya. Perbandingan tertutup akan memperingatkan setiap
    // pasangan slot yang berurutan rapi — yaitu justru jadwal paling benar.
    expect(dailyops.waktuBertumpang('09:00', '12:00', '12:00', '14:00')).toBe(false);
    expect(dailyops.waktuBertumpang('09:00', '12:00', '11:00', '14:00')).toBe(true);
    expect(dailyops.waktuBertumpang('11:00', '14:00', '09:00', '12:00')).toBe(true);
    // Terkurung penuh, dua arah.
    expect(dailyops.waktuBertumpang('09:00', '17:00', '10:00', '11:00')).toBe(true);
    expect(dailyops.waktuBertumpang('10:00', '11:00', '09:00', '17:00')).toBe(true);
    // Bersebelahan di arah sebaliknya.
    expect(dailyops.waktuBertumpang('12:00', '14:00', '09:00', '12:00')).toBe(false);
    // Bentuk `HH:MM:SS` yang dikembalikan driver untuk kolom `time`.
    expect(dailyops.waktuBertumpang('09:00:00', '12:00:00', '11:30:00', '13:00:00')).toBe(true);
  });

  it('tanggalDalamRentang() INKLUSIF di kedua ujung — beda dari waktuBertumpang, dan itu disengaja', () => {
    // Cuti "10–12 September" berarti tanggal 12 orangnya masih tidak ada.
    expect(dailyops.tanggalDalamRentang('2026-09-10', '2026-09-10', '2026-09-12')).toBe(true);
    expect(dailyops.tanggalDalamRentang('2026-09-12', '2026-09-10', '2026-09-12')).toBe(true);
    expect(dailyops.tanggalDalamRentang('2026-09-13', '2026-09-10', '2026-09-12')).toBe(false);
    expect(dailyops.tanggalDalamRentang('2026-09-09', '2026-09-10', '2026-09-12')).toBe(false);
  });
});

describeDb('M19 kosakata — TS ≡ CHECK constraint', () => {
  it('TASK_TYPES ≡ ck_slot_task_type', async () => {
    expect(await nilaiCheck('prod_slots', 'ck_slot_task_type'))
      .toEqual([...dailyops.TASK_TYPES].sort());
  });

  it('ALASAN_TIDAK_TERSEDIA ≡ ck_picunav_alasan', async () => {
    expect(await nilaiCheck('pic_unavailability', 'ck_picunav_alasan'))
      .toEqual([...dailyops.ALASAN_TIDAK_TERSEDIA].sort());
  });

  it('DB menolak task_type yang tidak terdaftar (constraint-nya nyata, bukan dokumentasi)', async () => {
    await expect(
      db()`
        insert into prod_slots (id, tanggal, client_id, studio_code, waktu_mulai, waktu_selesai,
                                assigned_pic, task_type, target_qty, created_by)
        values ('SLOT-ZREG-0001', '2026-09-10', 'CLI-TIDAK-ADA', 'KASUARI', '09:00', '12:00',
                'ZZ-REG', 'Shooting', 1, 'ZZ-REG')`,
    ).rejects.toThrow();
  });
});

describeDb('M19 registry studio — STUDIOS ≡ tabel studios', () => {
  it('himpunan kode identik', async () => {
    const rows = await db()<{ code: string }[]>`select code from studios order by code`;
    expect(rows.map((r) => r.code)).toEqual([...dailyops.STUDIOS].map((s) => s.code).sort());
  });

  it('setiap baris identik field-per-field — termasuk cek_konflik', async () => {
    // `cek_konflik` adalah alasan utama tes ini ada: kalau TS bilang true dan
    // DB bilang false (atau sebaliknya), pemeriksaan konflik studio berubah
    // tanpa galat, tanpa baris hilang, tanpa satu pun tes lain merah.
    const rows = await db()<{
      code: string; nama: string; aktif: boolean; cek_konflik: boolean; urutan: number;
    }[]>`select code, nama, aktif, cek_konflik, urutan from studios order by urutan`;
    expect(rows.map((r) => ({
      code: r.code, nama: r.nama, aktif: r.aktif,
      cekKonflik: r.cek_konflik, urutan: Number(r.urutan),
    }))).toEqual([...dailyops.STUDIOS].slice().sort((a, b) => a.urutan - b.urutan));
  });
});

describeDb('M19 skema — yang SENGAJA tidak ada', () => {
  it('NOL mesin `prod_slot`/`slot` di sm_machines (Rule 1/D1)', async () => {
    const rows = await db()<{ name: string }[]>`
      select name from sm_machines where name like '%slot%' or name like '%prod%'`;
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('NOL kolom turunan yang disimpan di prod_slots (aturan rumah #4)', async () => {
    // `sisa`, `persen_selesai`, `on_time` dst. harus DITURUNKAN saat baca.
    // Sebuah kolom yang menyimpannya bisa dimundurkan sesudah faktanya.
    const rows = await db()<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'prod_slots'
         and (column_name like '%sisa%' or column_name like '%persen%'
              or column_name like '%selesai_hari%' or column_name like '%on_time%'
              or column_name like '%fill%')`;
    // `waktu_selesai` sengaja tidak cocok pola di atas; kalau ia ikut tertangkap
    // suatu saat, pola-nya yang salah, bukan skemanya.
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it('pic_unavailability NOL kolom approval/saldo — batas HRIS ada di skema, bukan cuma di komentar', async () => {
    const rows = await db()<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'pic_unavailability'
         and (column_name like '%approv%' or column_name like '%setuju%'
              or column_name like '%saldo%' or column_name like '%kuota%'
              or column_name like '%status%' or column_name like '%entitle%'
              or column_name like '%carry%' or column_name like '%sisa%')`;
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it('pic_unavailability menolak UPDATE tapi mengizinkan DELETE', async () => {
    // Salah catat harus bisa dicabut; menyunting rentangnya sesudah jadwal
    // disusun di atasnya mengubah arti peringatan yang sudah ditampilkan.
    const pic = (await db()<{ employee_id: string }[]>`
      select employee_id from employees limit 1`)[0]?.employee_id;
    expect(pic, 'seed employees kosong — jalankan scripts/db-rebuild.sh').toBeTruthy();
    const ins = await db()<{ id: string }[]>`
      insert into pic_unavailability (employee_id, tanggal_mulai, tanggal_selesai, alasan, dicatat_oleh)
      values (${pic}, '2099-01-01', '2099-01-02', 'Cuti', ${pic}) returning id`;
    const id = ins[0].id;
    await expect(
      db()`update pic_unavailability set alasan = 'Sakit' where id = ${id}`,
    ).rejects.toThrow(/append-only|immutable/i);
    await db()`delete from pic_unavailability where id = ${id}`;
    const sisa = await db()<{ n: string }[]>`
      select count(*)::text as n from pic_unavailability where id = ${id}`;
    expect(sisa[0].n).toBe('0');
  });
});
