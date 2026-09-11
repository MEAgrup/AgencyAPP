/**
 * M19 separuh SCS — gerbang yang memaku KEPUTUSAN, bukan cuma skema.
 *
 * KENAPA ADA. Empat hal di modul ini bisa dibatalkan tanpa satu pun galat yang
 * terlihat, dan masing-masing punya tes di bawah:
 *
 *  1. **Kosakata state mesin #34 harus IDENTIK `brief_task`.** Itulah yang
 *     membuat `task.computeMetrics()` dipakai ulang. Kalau seseorang
 *     "merapikan" `[Approved]` jadi `[Selesai]` di migrasi, tidak ada yang
 *     merah secara mencolok — Speed Score dan turnaround SELURUH baris SCS
 *     diam-diam jadi `null`, karena `computeMetrics` tidak lagi mengenali
 *     log-nya. Tes pertama di berkas ini yang merah lebih dulu.
 *  2. **`scs_tasks.client_id` harus NULLABLE.** Ia SELURUH alasan modul ini
 *     berdiri sendiri alih-alih jadi Task M12 keempat (baris `all client` di
 *     sheet tidak punya klien). Sebuah `NOT NULL` yang ditambahkan "untuk
 *     kebersihan data" membatalkan ketokan `M19-SCS-ENGINE` dan mengembalikan
 *     baris itu ke luar CDPS.
 *  3. **Kategori standing tidak boleh punya SLA.** `computeMetrics(evs, null)`
 *     memberi Speed Score 'N/A'; sebuah SLA pada Kategori standing memberi
 *     ANGKA kepada pekerjaan berulang yang tidak pernah dimaksudkan diukur
 *     begitu.
 *  4. **Nol kolom jangkar waktu dan nol kolom turunan di `scs_tasks`.** Semua
 *     angka diturunkan dari `audit_log` (aturan rumah #3/#4). Kolom jangkar
 *     kedua adalah angka kedua yang bisa menyimpang dari log.
 *
 * Perbandingannya SET-EQUAL, bukan hitungan: dua kesalahan yang saling
 * menutupi memberi hitungan yang cocok.
 *
 * Di-skip tanpa `DATABASE_URL`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ident } from '@cdps/core';
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

/** State pembatalan `brief_task` yang SENGAJA tidak ikut ke mesin #34. */
const CANCEL_BRIEF_TASK = '[Cancelled — Service Voided]';

async function statesOf(machine: string): Promise<string[]> {
  const rows = await db()<{ s: string }[]>`
    select distinct s from (
      select initial_state as s from sm_machines where name = ${machine}
      union all
      select from_state from sm_edges where machine = ${machine}
      union all
      select to_state   from sm_edges where machine = ${machine}
    ) x order by s`;
  return rows.map((r) => r.s);
}

async function edgesOf(machine: string): Promise<string[]> {
  const rows = await db()<{ e: string }[]>`
    select (from_state || ' -> ' || to_state || ' [lead=' || require_lead || ']') as e
      from sm_edges where machine = ${machine} order by e`;
  return rows.map((r) => r.e);
}

describe('M19 SCS — invariant TS', () => {
  it('prefix SCS terdaftar di PREFIXES (dual-home dengan entity_prefix)', () => {
    expect(ident.isRegisteredPrefix('SCS')).toBe(true);
    expect(ident.PREFIXES.SCS.module).toBe('M19');
  });
});

describeDb('M19 SCS — mesin #34 adalah SALINAN VERBATIM brief_task', () => {
  it('mesin scs_task terdaftar, initial_state [To Do], nol auto_computed', async () => {
    const rows = await db()<{ initial_state: string; auto_computed: boolean }[]>`
      select initial_state, auto_computed from sm_machines where name = 'scs_task'`;
    expect(rows.length).toBe(1);
    expect(rows[0].initial_state).toBe('[To Do]');
    // `auto_computed` true akan membuat `sm_transition` menolak SETIAP transisi
    // manual — seluruh modul jadi read-only tanpa satu pun galat saat migrasi.
    expect(rows[0].auto_computed).toBe(false);
  });

  it('HIMPUNAN state identik brief_task, kecuali state pembatalan ber-Service', async () => {
    // Ini tes paling penting di berkas ini. Kosakata yang identik adalah SATU
    // ALASAN mesin #34 boleh ada tanpa melahirkan definisi kedua Speed Score.
    const scs = await statesOf('scs_task');
    const brief = (await statesOf('brief_task')).filter((s) => s !== CANCEL_BRIEF_TASK);
    expect(scs).toEqual(brief);
  });

  it('setiap state yang dibaca computeMetrics() benar-benar ada di mesin #34', async () => {
    // Daftar ini adalah state yang `task.computeMetrics()` cari di `audit_log`.
    // Kalau salah satunya hilang dari mesin, angka yang bergantung padanya
    // menjadi null untuk SELURUH baris SCS — tanpa galat.
    const dibaca = [
      '[In Progress]', '[Submitted]', '[In Review]', '[Approved]',
      '[Revision Requested]', '[Blocked]',
    ];
    const scs = await statesOf('scs_task');
    for (const s of dibaca) {
      expect(scs, `state ${s} dibaca computeMetrics tapi tidak ada di mesin scs_task`)
        .toContain(s);
    }
  });

  it('HIMPUNAN edge identik brief_task, kecuali edge menuju state pembatalan', async () => {
    const scs = await edgesOf('scs_task');
    const brief = (await edgesOf('brief_task')).filter((e) => !e.includes(CANCEL_BRIEF_TASK));
    expect(scs).toEqual(brief);
  });

  it('[Approved] adalah SATU-SATUNYA state terminal', async () => {
    const rows = await db()<{ state: string }[]>`
      select state from sm_terminal_states where machine = 'scs_task' order by state`;
    expect(rows.map((r) => r.state)).toEqual(['[Approved]']);
  });

  it('NOL state pembatalan — namanya belum diketok, dan tidak dikarang', async () => {
    // `brief_task` membatalkan lewat `[Cancelled — Service Voided]`; baris SCS
    // tidak punya Service, jadi sebab itu tak pernah terjadi. Kalau sebuah
    // state pembatalan muncul di sini, ia lahir tanpa entri DECISIONS.md.
    const scs = await statesOf('scs_task');
    expect(scs.filter((s) => /cancel|batal/i.test(s))).toEqual([]);
  });

  it('kedua edge [Blocked] menuntut lead — waktu blocked DIKURANGI dari turnaround', async () => {
    const rows = await db()<{ from_state: string; to_state: string; require_lead: boolean }[]>`
      select from_state, to_state, require_lead from sm_edges
       where machine = 'scs_task'
         and (from_state = '[Blocked]' or to_state = '[Blocked]')
       order by from_state`;
    expect(rows.length).toBe(2);
    // Kalau PIC bisa memblokir barisnya sendiri, ia memotong sendiri angka yang
    // menilainya (gerbang yang sama dengan M12 §5.3a).
    expect(rows.every((r) => r.require_lead)).toBe(true);
  });
});

describeDb('M19 SCS — skema scs_tasks memaku ketokannya', () => {
  it('client_id NULLABLE — ini ketokan M19-SCS-ENGINE, bukan kelalaian', async () => {
    const rows = await db()<{ is_nullable: string }[]>`
      select is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = 'scs_tasks'
         and column_name = 'client_id'`;
    expect(rows.length).toBe(1);
    // NOT NULL di sini menghapus baris "all client" dari sistem dan
    // mengembalikannya ke Google Sheets — keadaan yang modul ini ada untuk
    // mengakhiri. Lihat DECISIONS.md 2026-09-09.
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('NOL kolom jangkar waktu — angka diturunkan dari audit_log (aturan rumah #3/#4)', async () => {
    const rows = await db()<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'scs_tasks'
         and (column_name like '%dimulai%' or column_name like '%disubmit%'
              or column_name like '%disetujui%' or column_name like '%selesai_pada%'
              or column_name like '%direview%')`;
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it('NOL kolom turunan yang disimpan', async () => {
    const rows = await db()<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'scs_tasks'
         and (column_name like '%turnaround%' or column_name like '%speed%'
              or column_name like '%revisi_count%' or column_name like '%revision%'
              or column_name like '%persen%' or column_name like '%terlambat%')`;
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it('mendukung_divisi ber-FK ke division_registry, BUKAN ke briefs', async () => {
    // FK ke `briefs` akan memberi baris ini induk Brief — dan itu menuntut
    // barisnya di HALAMAN_BRIEF plus membangunkan seluruh rantai gerbang
    // Service/pembayaran yang justru dihindari `client_id` nullable.
    const rows = await db()<{ tabel: string }[]>`
      select ct.relname as tabel
        from pg_constraint c
        join pg_class t  on t.oid  = c.conrelid
        join pg_class ct on ct.oid = c.confrelid
       where t.relname = 'scs_tasks' and c.conname = 'fk_scs_divisi'`;
    expect(rows.map((r) => r.tabel)).toEqual(['division_registry']);
  });

  it('DELETE hanya boleh pada [To Do] — trigger, bukan kesopanan lapisan TS', async () => {
    const rows = await db()<{ tgname: string }[]>`
      select tgname from pg_trigger tg
        join pg_class c on c.oid = tg.tgrelid
       where c.relname = 'scs_tasks' and not tg.tgisinternal
       order by tgname`;
    expect(rows.map((r) => r.tgname)).toContain('trg_scs_tasks_hapus_hanya_todo');
    expect(rows.map((r) => r.tgname)).toContain('trg_scs_tasks_beku');
  });
});

describeDb('M19 SCS — scs_kategori: taksonomi sebagai DATA', () => {
  it('SETIAP Kategori standing punya sla_jam NULL — ditegakkan CHECK, diuji di sini', async () => {
    // Bukan hanya baris seed: query ini akan merah untuk Kategori apa pun yang
    // ditambahkan lead Creative kelak lewat jalur yang melewati constraint.
    const rows = await db()<{ kode: string }[]>`
      select kode from scs_kategori where is_standing and sla_jam is not null`;
    expect(rows.map((r) => r.kode)).toEqual([]);
  });

  it('CHECK-nya nyata: DB menolak Kategori standing ber-SLA', async () => {
    await expect(
      db()`
        insert into scs_kategori (kode, nama, is_standing, sla_jam, urutan)
        values ('ZREG_STANDING', 'Zreg standing ber-SLA', true, 24, 999)`,
    ).rejects.toThrow();
  });

  it('empat Kategori yang TERBUKTI di sumber ada, dan flag-nya seperti diketok', async () => {
    const rows = await db()<{ kode: string; is_standing: boolean; sla_jam: number | null }[]>`
      select kode, is_standing, sla_jam from scs_kategori order by urutan`;
    expect(rows.map((r) => r.kode)).toEqual(['SCRIPT', 'BRIEF', 'UPLOAD_CHECKLIST', 'KOORDINASI']);
    // `Brief` is_standing = FALSE, dan itu KETOKAN pemilik 2026-09-09 ("brief
    // SMO sebetulnya membantu team lain menyelesaikan task dari AM") — bukan
    // default yang belum dipikirkan. Menandainya standing membuat deliverable
    // Brief Strategist yang sungguhan HILANG dari seri deliverable.
    const brief = rows.find((r) => r.kode === 'BRIEF');
    expect(brief?.is_standing).toBe(false);
    expect(brief?.sla_jam).not.toBeNull();
    // `Koordinasi` = jurnal Content Creator (Gap H-1) sebagai satu KATEGORI,
    // bukan entitas ketiga. Tidak di-review siapa pun ⇒ standing ⇒ nol SLA.
    const koor = rows.find((r) => r.kode === 'KOORDINASI');
    expect(koor?.is_standing).toBe(true);
    expect(koor?.sla_jam).toBeNull();
  });

  it('`sub_type` hidup di BARIS, bukan di taksonomi (M19-SCS-SUBTYPE-GRAIN, opsi (a))', async () => {
    // Sumbernya (Gap B) menyebut Sub Type field PER BARIS: "Support
    // VideoGrapher ... and Sub Type both become optional on the merged entity".
    // Sebagai atribut Kategori ia MEMBATALKAN alasan penggabungan taksonominya
    // sendiri — satu baris `Brief` tidak bisa `Brief Feed` sementara baris
    // `Brief` lain `Brief Story`. Ketokan pemilik 2026-09-11: ia pindah.
    const kol = await db()<{ table_name: string; data_type: string; is_nullable: string }[]>`
      select table_name, data_type, is_nullable from information_schema.columns
       where table_schema = 'public' and column_name = 'sub_type'
         and table_name in ('scs_kategori', 'scs_tasks')
       order by table_name`;
    // TEPAT satu tempat. Dua tempat = dua sumber untuk satu fakta (opsi (c),
    // ditolak); nol tempat = pembedaan Brief Feed/Story hilang lagi.
    expect(kol.map((r) => r.table_name)).toEqual(['scs_tasks']);
    expect(kol[0].is_nullable).toBe('YES');   // opsional — kosong itu sah
  });

  it('sub_type SENGAJA teks bebas — nol CHECK constraint yang mengunci delapan nama', async () => {
    // Delapan Sub Type di worksheet masih bergerak; mengunci mereka di CHECK
    // berarti satu migrasi per koreksi taksonomi. Kalau ia kelak stabil, ia
    // naik jadi enum tertutup + baris DECISIONS.md — bukan sebaliknya.
    // Alasannya tidak berubah karena kolomnya pindah tabel.
    const rows = await db()<{ conname: string }[]>`
      select c.conname from pg_constraint c
        join pg_class t on t.oid = c.conrelid
       where t.relname in ('scs_kategori', 'scs_tasks') and c.contype = 'c'
         and pg_get_constraintdef(c.oid) like '%sub_type%'`;
    expect(rows.map((r) => r.conname)).toEqual([]);
  });
});
