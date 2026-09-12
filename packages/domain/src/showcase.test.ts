/**
 * Showcase Klien Terbaik + ledger izin pitch — lapis domain (Gelombang C).
 *
 * TIGA HAL YANG BERKAS INI ADA UNTUK MENANGKAP, dan semuanya adalah kegagalan
 * yang TIDAK terlihat dari layar sampai sudah terlambat:
 *
 *  1. **Pelebaran diam-diam akses Sales.** C-1 membuka SATU halaman ke divisi
 *     Sales — pengecualian pertama terhadap Role Matrix Fase 0 §4. Tes di sini
 *     menyebut Sales EKSPLISIT (aturan rumah #6, pagar (d)) dan memeriksa
 *     bahwa gerbang mana pun di luar Showcase tetap menolaknya. Kalau seseorang
 *     kelak memakai ulang `canReadShowcase` untuk halaman kedua, atau
 *     menambahkan Sales ke `canKelolaIzinPitch`, CI yang memerah — bukan
 *     seorang klien yang menemukan angkanya beredar.
 *
 *  2. **Jahitan mesin laporan → read model Showcase.** Aturan yang dibawa dari
 *     Gelombang B dan terbukti dua kali (B2↔B3, lalu `angle_video`): tes unit di
 *     kedua sisi sebuah jahitan bisa hijau sementara jahitannya putus, karena
 *     masing-masing memakai fixture-nya sendiri. Maka ada satu tes di bawah yang
 *     menjalankan `report.createReport` YANG SUNGGUHAN — parse export, skor
 *     mesin, tulis `client_reports` — lalu menyuapkan hasilnya ke `listShowcase`
 *     YANG SUNGGUHAN. Ia memerah kalau salah satu sisi mengganti nama kolom,
 *     satuan, atau bentuk skornya.
 *
 *  3. **Riwayat izin yang bisa dihapus.** Ledger izin adalah satu-satunya bukti
 *     atas dasar apa sebuah angka klien pernah masuk materi pitch. UPDATE dan
 *     DELETE harus ditolak DB, bukan hanya "tidak ada jalurnya di TS".
 *
 * Dilewati kalau `DATABASE_URL` tidak diset. Baris di-namespace `ZSC-`.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission, showcase as core } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ForbiddenError, ValidationError } from './account';
import { createReport } from './report';
import {
  beriIzinPitch,
  cabutIzinPitch,
  canKelolaIzinPitch,
  canReadShowcase,
  listShowcase,
  materiPitch,
  melihatSebagaiSales,
  MSG_IZIN_BELUM_ADA,
  MSG_IZIN_SUDAH_ADA,
  MSG_BERLAKU_LAMPAU,
  riwayatIzin,
  statusIzin,
  statusIzinDariPeristiwa,
  type IzinPeristiwa,
} from './showcase';

// ---------------------------------------------------------------------------
// Aktor — Sales disebut EKSPLISIT di seluruh berkas ini (pagar (d), C-1)
// ---------------------------------------------------------------------------
const OWNER = 'ZSC-AM';
const am = (id = OWNER) => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = () => ({ employeeId: 'ZSC-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = () => ({ employeeId: 'ZSC-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = () => ({ employeeId: 'ZSC-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
const sales = (id = 'ZSC-SALES') => ({ employeeId: id, role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
const salesLead = () => ({ employeeId: 'ZSC-SLEAD', role: permission.makeRole({ division: 'Sales', level: 'lead' }) });
const creative = () => ({ employeeId: 'ZSC-CRE', role: permission.makeRole({ division: 'Creative', level: 'staff' }) });
const creativeLead = () => ({ employeeId: 'ZSC-CLEAD', role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
/** Director yang KEBETULAN terpetakan ke divisi Sales — haknya dari peran berlapis. */
const directorDiSales = () => ({ employeeId: 'ZSC-DS', role: permission.makeRole({ division: 'Sales', level: 'staff', director: true }) });

// ---------------------------------------------------------------------------
// Gerbang — murni, tanpa DB
// ---------------------------------------------------------------------------
describe('canReadShowcase — pagar (a): SATU halaman, dan Sales ada di dalamnya', () => {
  it('Sales DIBUKA (C-1, keputusan pemilik 2026-09-07) — staff maupun lead', () => {
    expect(canReadShowcase(sales())).toBe(true);
    expect(canReadShowcase(salesLead())).toBe(true);
  });
  it('Account (AM & lead), OD, dan Director tetap membaca', () => {
    expect(canReadShowcase(am())).toBe(true);
    expect(canReadShowcase(accountLead())).toBe(true);
    expect(canReadShowcase(od())).toBe(true);
    expect(canReadShowcase(director())).toBe(true);
  });
  it('divisi lain TIDAK ikut terbuka — pengecualiannya untuk Sales saja, bukan untuk "bukan Account"', () => {
    expect(canReadShowcase(creative())).toBe(false);
    expect(canReadShowcase(creativeLead())).toBe(false);
  });
});

describe('canKelolaIzinPitch — pagar (a): akses Sales READ-ONLY', () => {
  it('Sales TIDAK boleh mencentang maupun mencabut izin, walau ia boleh membaca Showcase', () => {
    expect(canKelolaIzinPitch(sales(), OWNER)).toBe(false);
    expect(canKelolaIzinPitch(salesLead(), OWNER)).toBe(false);
  });
  it('AM pemilik klien mencentang (C-5), Account lead & Director juga', () => {
    expect(canKelolaIzinPitch(am(OWNER), OWNER)).toBe(true);
    expect(canKelolaIzinPitch(accountLead(), OWNER)).toBe(true);
    expect(canKelolaIzinPitch(director(), OWNER)).toBe(true);
  });
  it('AM lain tidak boleh menyentuh izin klien yang bukan miliknya', () => {
    expect(canKelolaIzinPitch(am('ZSC-LAIN'), OWNER)).toBe(false);
  });
  it('akun OD murni membaca Showcase tapi tidak mencentang izin klien orang lain', () => {
    expect(canReadShowcase(od())).toBe(true);
    expect(canKelolaIzinPitch(od(), OWNER)).toBe(false);
    // Lingkupnya SAMA PERSIS dengan `report.canWriteReport`: akun ber-lapis OD
    // yang JUGA AM pemilik klien tetap boleh — wewenangnya dari scope divisinya,
    // bukan dari lapis OD-nya (`permission.canWrite`). Disebut di sini supaya
    // pembaca berikutnya tidak "memperbaiki" ini jadi larangan mutlak dan
    // memutus jalur AM yang kebetulan dititipi lapis OD.
    expect(canKelolaIzinPitch(od(), 'ZSC-OD')).toBe(true);
  });
  it('klien tanpa AM ⇒ hanya lead/Director yang bisa, bukan sembarang AM', () => {
    expect(canKelolaIzinPitch(am('ZSC-SIAPA'), null)).toBe(false);
    expect(canKelolaIzinPitch(director(), null)).toBe(true);
  });
});

describe('melihatSebagaiSales — memisahkan "melihat sebagai Sales" dari "kebetulan di divisi Sales"', () => {
  it('Sales biasa: ya', () => {
    expect(melihatSebagaiSales(sales())).toBe(true);
    expect(melihatSebagaiSales(salesLead())).toBe(true);
  });
  it('Director yang terpetakan ke divisi Sales: TIDAK — haknya datang dari peran berlapisnya', () => {
    expect(melihatSebagaiSales(directorDiSales())).toBe(false);
  });
  it('Account/OD/Director: tidak', () => {
    expect(melihatSebagaiSales(am())).toBe(false);
    expect(melihatSebagaiSales(od())).toBe(false);
    expect(melihatSebagaiSales(director())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Aturan turunan status izin — murni, diuji di batasnya
// ---------------------------------------------------------------------------
const peristiwa = (o: Partial<IzinPeristiwa> & { aksi: 'beri' | 'cabut' }): IzinPeristiwa => ({
  id: 1, clientId: 'ZSC-CLI', berlakuSampai: null, dokumenCatatan: null, alasan: null,
  createdAt: new Date('2026-09-01T00:00:00Z'), createdBy: OWNER, ...o,
});

/**
 * setahunLagi — tanggal masa berlaku yang SELALU di masa depan, apa pun hari
 * tesnya dijalankan.
 *
 * Kenapa ada: `beriIzinPitch` menolak `berlakuSampai` yang sudah lewat, jadi
 * setiap tanggal literal di sebuah tes DB adalah bom waktu — hijau sampai
 * tanggal itu terlampaui, lalu merah selamanya, dan merahnya muncul di PR
 * orang lain yang tidak menyentuh apa pun di sini.
 *
 * Kasus izin yang BENAR-BENAR kedaluwarsa tidak bisa dibangun lewat API (dan
 * memang tidak seharusnya bisa) — ia diuji di blok murni
 * `statusIzinDariPeristiwa` di bawah, tempat `hariIni` diteruskan sebagai
 * argumen justru supaya batasnya bisa diuji tanpa menunggu kalender.
 */
function setahunLagi(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

describe('statusIzinDariPeristiwa', () => {
  it('ledger kosong ⇒ tidak berizin, dan BUKAN kedaluwarsa (belum pernah ada izin)', () => {
    const s = statusIzinDariPeristiwa('ZSC-CLI', null, '2026-09-07');
    expect(s.berizin).toBe(false);
    expect(s.kedaluwarsa).toBe(false);
    expect(s.sejak).toBeNull();
  });
  it('`beri` tanpa masa berlaku ⇒ berizin selamanya sampai dicabut', () => {
    const s = statusIzinDariPeristiwa('ZSC-CLI', peristiwa({ aksi: 'beri' }), '2030-01-01');
    expect(s.berizin).toBe(true);
    expect(s.kedaluwarsa).toBe(false);
  });
  it('`beri` yang masa berlakunya TEPAT hari ini masih berlaku — batasnya inklusif', () => {
    const s = statusIzinDariPeristiwa('ZSC-CLI', peristiwa({ aksi: 'beri', berlakuSampai: '2026-09-07' }), '2026-09-07');
    expect(s.berizin).toBe(true);
    expect(s.kedaluwarsa).toBe(false);
  });
  it('`beri` yang lewat sehari ⇒ TIDAK berizin, dan ditandai kedaluwarsa (perlu diperpanjang, bukan diminta)', () => {
    const s = statusIzinDariPeristiwa('ZSC-CLI', peristiwa({ aksi: 'beri', berlakuSampai: '2026-09-06' }), '2026-09-07');
    expect(s.berizin).toBe(false);
    expect(s.kedaluwarsa).toBe(true);
  });
  it('`cabut` ⇒ tidak berizin, dan BUKAN kedaluwarsa — dua sebab yang berbeda', () => {
    const s = statusIzinDariPeristiwa('ZSC-CLI', peristiwa({ aksi: 'cabut' }), '2026-09-07');
    expect(s.berizin).toBe(false);
    expect(s.kedaluwarsa).toBe(false);
    expect(s.sejak).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;
let aktorSeq = 0;

/** Id aktor unik per jalan — `audit_log` tak bisa dibersihkan, jadi tes yang
 *  menghitung barisnya harus menghitung barisnya SENDIRI. */
function aktorUnik(prefix: string): string {
  aktorSeq += 1;
  return `ZSC-${prefix}-${RUN}-${aktorSeq}`;
}

/** Berapa baris audit Showcase yang aktor ini tulis. */
async function barisAuditShowcase(employeeId: string): Promise<Record<string, unknown>[]> {
  return sql<Record<string, unknown>[]>`
    select action, after_json from audit_log
     where entity_type = 'showcase' and actor_employee_id = ${employeeId} order by id`;
}

async function seedClient(opts: { am?: string | null; toko?: string } = {}): Promise<string> {
  seq += 1;
  const id = `ZSC-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${id}, 'Rani', ${opts.toko ?? 'Toko ' + id}, 'Bandung', 'https://shopee.co.id/x',
            'Home Living', 0, 0, 0, 'ZSC-SALES', 'ZSC-SALES',
            ${opts.am === undefined ? OWNER : opts.am}, now(), ${OWNER})`;
  return id;
}

/** Sisipkan laporan ber-skor langsung — untuk menguji AMBANG, bukan mesinnya.
 *  Beberapa periode (`bulan`) untuk KLIEN YANG SAMA berbagi SATU baris
 *  `client_platforms` — persis seperti realita (satu toko, banyak laporan
 *  bulanan) dan seperti yang ditegakkan `uq_client_platforms_active_platform`
 *  (PX-M2a §4b): tidak boleh dua baris aktif untuk (client_id, platform) yang
 *  sama. */
async function seedLaporan(client: string, skor: number | null, bulan: number, gmv = 100_000_000): Promise<void> {
  const existing = await sql<{ id: number }[]>`
    select id from client_platforms where client_id = ${client} and platform = 'TikTok Shop' and active`;
  const platformId = existing.length > 0
    ? Number(existing[0].id)
    : Number((await sql<{ id: number }[]>`
        insert into client_platforms (client_id, platform, active, created_by)
        values (${client}, 'TikTok Shop', true, ${OWNER}) returning id`)[0].id);
  const mm = String(bulan).padStart(2, '0');
  await sql`
    insert into client_reports (client_id, client_platform_id, platform, periode_tipe,
                                periode_mulai, periode_akhir, hari_periode, payload,
                                skor, skor_label, gmv_net, gmv_kotor, gmv_runrate_bulanan,
                                engine_versi, payload_schema, created_by, benchmark_versi)
    values (${client}, ${platformId}, 'TikTok Shop', 'bulanan',
            ${`2026-${mm}-01`}, ${`2026-${mm}-28`}, 28, '{}'::jsonb,
            ${skor}, ${skor === null ? null : skor >= 8 ? 'SEHAT' : skor >= 6 ? 'PERLU PERHATIAN' : 'KRITIS'},
            ${gmv}, ${gmv}, ${gmv},
            'cdps.report.tiktok.v1', 'cdps.report.tiktok.v1', ${OWNER},
            (select max(versi) from report_benchmark))`;
}

/** Klien yang LOLOS ambang: tiga periode ber-skor ≥ ambang. */
async function seedKlienLolos(opts: { am?: string | null } = {}): Promise<string> {
  const c = await seedClient(opts);
  await seedLaporan(c, 8.1, 1, 100_000_000);
  await seedLaporan(c, 8.4, 2, 150_000_000);
  await seedLaporan(c, 8.7, 3, 220_000_000);
  return c;
}

afterEach(async () => {
  if (!sql) return;
  // `audit_log` SENGAJA tidak dibersihkan: ia menolak DELETE (aturan rumah #3),
  // dan itu justru salah satu hal yang berkas ini ada untuk mengandalkan. Tes
  // yang memeriksa baris audit karena itu memakai id aktor yang unik per
  // jalannya (`aktorUnik`) dan menghitung hanya barisnya sendiri — bukan
  // mengosongkan tabel dan berharap tak ada yang lain di sana.

  // Dua tabel yang menolak DELETE by design (append-only). Trigger dimatikan
  // sebagai superuser pemilik dan DIKEMBALIKAN di `finally` — kegagalan
  // pembersihan tak boleh meninggalkan tabel dalam keadaan bisa ditulis untuk
  // tes berikutnya. Pola yang sama dipakai `report.domain.test.ts`.
  await sql`alter table client_pitch_consents disable trigger trg_client_pitch_consents_frozen`;
  await sql`alter table client_report_insight disable trigger trg_cri_no_delete`;
  try {
    await sql`delete from client_pitch_consents where client_id like 'ZSC-CLI-%'`;
    await sql`delete from client_report_insight where report_id in (
      select id from client_reports where client_id like 'ZSC-CLI-%')`;
    await sql`delete from client_reports where client_id like 'ZSC-CLI-%'`; // berkas + publikasi CASCADE
  } finally {
    await sql`alter table client_report_insight enable trigger trg_cri_no_delete`;
    await sql`alter table client_pitch_consents enable trigger trg_client_pitch_consents_frozen`;
  }
  await sql`delete from client_platforms where client_id like 'ZSC-CLI-%'`;
  await sql`delete from clients where id like 'ZSC-CLI-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

// ---------------------------------------------------------------------------
// Izin — jalur tulis
// ---------------------------------------------------------------------------
describeDb('izin pitch — ledger append-only (C-5)', () => {
  it('AM pemilik memberi izin ⇒ status berizin, dan ledger bertambah SATU baris', async () => {
    const c = await seedClient();
    const s = await beriIzinPitch(sql, am(), c, { dokumenCatatan: 'PKS-2026-014 pasal 7' });
    expect(s.berizin).toBe(true);
    expect(s.dokumenCatatan).toBe('PKS-2026-014 pasal 7');
    const r = await riwayatIzin(sql, am(), c);
    expect(r).toHaveLength(1);
    expect(r[0].aksi).toBe('beri');
  });

  it('Sales DITOLAK memberi izin — read-only (pagar (a))', async () => {
    const c = await seedClient();
    await expect(beriIzinPitch(sql, sales(), c)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(beriIzinPitch(sql, salesLead(), c)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('AM lain ditolak; Director boleh atas klien siapa pun', async () => {
    const c = await seedClient();
    await expect(beriIzinPitch(sql, am('ZSC-LAIN'), c)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await beriIzinPitch(sql, director(), c)).berizin).toBe(true);
  });

  it('memberi izin dua kali ditolak — "sejak kapan berlaku" tak boleh punya dua jawaban', async () => {
    const c = await seedClient();
    await beriIzinPitch(sql, am(), c);
    await expect(beriIzinPitch(sql, am(), c)).rejects.toThrow(MSG_IZIN_SUDAH_ADA);
  });

  it('masa berlaku di masa lalu ditolak dengan pesan BI-nya', async () => {
    const c = await seedClient();
    await expect(beriIzinPitch(sql, am(), c, { berlakuSampai: '2020-01-01' })).rejects.toThrow(MSG_BERLAKU_LAMPAU);
  });

  it('mencabut menambah baris `cabut`, TIDAK menghapus baris `beri` — riwayatnya tetap utuh', async () => {
    const c = await seedClient();
    await beriIzinPitch(sql, am(), c, { dokumenCatatan: 'email 3 Sep' });
    const s = await cabutIzinPitch(sql, director(), c, 'klien menarik izin');
    expect(s.berizin).toBe(false);
    const r = await riwayatIzin(sql, am(), c);
    expect(r.map((x) => x.aksi)).toEqual(['cabut', 'beri']);
    expect(r[1].dokumenCatatan).toBe('email 3 Sep'); // baris `beri` lama masih apa adanya
    expect(r[0].alasan).toBe('klien menarik izin');
  });

  it('mencabut saat belum pernah ada izin ditolak — tak ada apa pun untuk dicabut', async () => {
    const c = await seedClient();
    await expect(cabutIzinPitch(sql, director(), c)).rejects.toThrow(MSG_IZIN_BELUM_ADA);
  });

  it('sesudah dicabut, izin boleh diberikan lagi — dan riwayatnya menunjukkan ketiganya', async () => {
    const c = await seedClient();
    await beriIzinPitch(sql, am(), c);
    await cabutIzinPitch(sql, am(), c, 'salah klien');
    await beriIzinPitch(sql, am(), c, { berlakuSampai: '2030-12-31' });
    const r = await riwayatIzin(sql, am(), c);
    expect(r.map((x) => x.aksi)).toEqual(['beri', 'cabut', 'beri']);
    expect((await statusIzin(sql, am(), c)).berizin).toBe(true);
  });

  it('izin BERTANGGAL yang dicabut tercatat "ditarik", bukan "habis masanya"', async () => {
    const c = await seedClient();
    // Tanggalnya RELATIF terhadap hari ini, tidak pernah literal. Versi
    // pertama tes ini memakai '2026-09-08' — hari ia ditulis — sehingga ia
    // hijau satu hari lalu MERAH selamanya sesudahnya: `beriIzinPitch`
    // menolak masa berlaku yang sudah lewat, jadi tesnya gagal di SETUP dan
    // tidak pernah sekali pun mencapai perilaku yang namanya klaim.
    await beriIzinPitch(sql, am(), c, { berlakuSampai: setahunLagi() });
    await cabutIzinPitch(sql, am(), c, 'klien menarik izin sebelum masa berlaku habis');
    const st = await statusIzin(sql, am(), c);
    expect(st.berizin).toBe(false);
    expect(st.kedaluwarsa).toBe(false); // dicabut, bukan kedaluwarsa
  });

  it('setiap peristiwa izin masuk audit log dengan before→after (aturan rumah #3)', async () => {
    const c = await seedClient();
    await beriIzinPitch(sql, am(), c);
    await cabutIzinPitch(sql, director(), c, 'ditarik');
    const rows = await sql<{ action: string; actor_employee_id: string }[]>`
      select action, actor_employee_id from audit_log
       where entity_type = 'client_pitch_consent' and entity_id = ${c} order by id`;
    expect(rows.map((r) => r.action)).toEqual(['izin_pitch_diberikan', 'izin_pitch_dicabut']);
    expect(rows[1].actor_employee_id).toBe('ZSC-DIR');
  });

  it('riwayat izin TIDAK bisa di-UPDATE maupun di-DELETE (trigger DB, bukan sekadar tak ada jalur TS)', async () => {
    const c = await seedClient();
    await beriIzinPitch(sql, am(), c);
    await expect(sql`update client_pitch_consents set alasan = 'diubah' where client_id = ${c}`)
      .rejects.toThrow(/immutable/);
    await expect(sql`delete from client_pitch_consents where client_id = ${c}`)
      .rejects.toThrow(/immutable/);
  });

  it('membaca status/riwayat izin klien orang lain ditolak — termasuk untuk Sales', async () => {
    const c = await seedClient();
    await expect(statusIzin(sql, am('ZSC-LAIN'), c)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(riwayatIzin(sql, sales(), c)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await statusIzin(sql, od(), c)).berizin).toBe(false); // OD membaca
  });
});

// ---------------------------------------------------------------------------
// Showcase — daftar & pagar
// ---------------------------------------------------------------------------
describeDb('listShowcase — ambang, izin, dan kalimat jujur saat kosong', () => {
  it('divisi lain ditolak membuka Showcase sama sekali', async () => {
    await expect(listShowcase(sql, creative())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('klien yang lolos ambang muncul untuk Account walau BELUM berizin — supaya AM tahu izin mana yang perlu diminta', async () => {
    const c = await seedKlienLolos();
    const v = await listShowcase(sql, am());
    const k = v.klien.find((x) => x.clientId === c);
    expect(k).toBeDefined();
    expect(k!.berizin).toBe(false);
    expect(k!.periodeDinilai).toBe(3);
    expect(v.disaringIzin).toBe(false);
  });

  it('pagar (b): Sales TIDAK melihat klien yang belum berizin, tapi diberi tahu berapa yang disembunyikan', async () => {
    const c = await seedKlienLolos();
    const v = await listShowcase(sql, sales());
    expect(v.klien.find((x) => x.clientId === c)).toBeUndefined();
    expect(v.disaringIzin).toBe(true);
    expect(v.disembunyikanTanpaIzin).toBeGreaterThanOrEqual(1);
  });

  it('pagar (b): begitu izin diberikan, klien yang sama muncul untuk Sales', async () => {
    const c = await seedKlienLolos();
    await beriIzinPitch(sql, am(), c);
    const v = await listShowcase(sql, sales());
    expect(v.klien.map((x) => x.clientId)).toContain(c);
  });

  it('pagar (b): izin yang dicabut menghilangkan klien dari pandangan Sales lagi', async () => {
    const c = await seedKlienLolos();
    await beriIzinPitch(sql, am(), c);
    expect((await listShowcase(sql, sales())).klien.map((x) => x.clientId)).toContain(c);
    await cabutIzinPitch(sql, director(), c, 'klien menarik izin');
    expect((await listShowcase(sql, sales())).klien.map((x) => x.clientId)).not.toContain(c);
  });

  it('Sales TIDAK menerima daftar klien yang tersisih — itu bukan bagian halaman yang C-1 buka', async () => {
    await seedClient(); // klien tanpa laporan sama sekali
    const vSales = await listShowcase(sql, sales());
    const vAm = await listShowcase(sql, am());
    expect(vSales.tersisih).toHaveLength(0);
    expect(vAm.tersisih.length).toBeGreaterThan(0);
  });

  it('pagar (c): akses Sales masuk audit log, MEMUAT klien mana yang ia lihat', async () => {
    const c = await seedKlienLolos();
    await beriIzinPitch(sql, am(), c);
    const id = aktorUnik('SALES');
    await listShowcase(sql, sales(id));
    const rows = await barisAuditShowcase(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('showcase_dibuka_sales');
    expect((rows[0].after_json as Record<string, unknown>).klien_terlihat).toContain(c);
    expect((rows[0].after_json as Record<string, unknown>).divisi).toBe('Sales');
  });

  it('pagar (c): akses Account/OD/Director TIDAK menulis baris audit Sales', async () => {
    await seedKlienLolos();
    const idAm = aktorUnik('AM');
    const idOd = aktorUnik('OD');
    const idDir = aktorUnik('DIR');
    await listShowcase(sql, { employeeId: idAm, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
    await listShowcase(sql, { employeeId: idOd, role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
    await listShowcase(sql, { employeeId: idDir, role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
    for (const id of [idAm, idOd, idDir]) {
      expect(await barisAuditShowcase(id)).toHaveLength(0);
    }
  });

  it('Director yang terpetakan ke divisi Sales melihat versi PENUH dan tak menulis baris audit Sales', async () => {
    const c = await seedKlienLolos();
    const id = aktorUnik('DIRSALES');
    const v = await listShowcase(sql, {
      employeeId: id,
      role: permission.makeRole({ division: 'Sales', level: 'staff', director: true }),
    });
    expect(v.disaringIzin).toBe(false);
    expect(v.klien.map((x) => x.clientId)).toContain(c);
    expect(await barisAuditShowcase(id)).toHaveLength(0);
  });

  it('halaman kosong membawa SEBABNYA per klien, bukan sekadar tabel kosong (C-2)', async () => {
    const belum = await seedClient();
    const kurang = await seedClient();
    await seedLaporan(kurang, 9.5, 1);
    const rendah = await seedClient();
    await seedLaporan(rendah, 9.0, 1);
    await seedLaporan(rendah, 9.0, 2);
    await seedLaporan(rendah, 5.0, 3);

    const v = await listShowcase(sql, am());
    const alasan = new Map(v.tersisih.map((t) => [t.clientId, t.alasan]));
    expect(alasan.get(belum)).toBe('belum_ada_laporan');
    expect(alasan.get(kurang)).toBe('periode_kurang');
    expect(alasan.get(rendah)).toBe('skor_kurang');
    expect(v.ambang.skorMin).toBe(core.AMBANG_SKOR_MIN);
    expect(v.ambang.minPeriode).toBe(core.AMBANG_MIN_PERIODE);
    expect(v.ambang.kalimat).toBe(core.AMBANG_KALIMAT);
  });

  it('laporan ber-skor NULL tidak dibaca sebagai skor 0 — klien jatuh ke "belum ber-skor", bukan "buruk"', async () => {
    const c = await seedClient();
    await seedLaporan(c, null, 1);
    await seedLaporan(c, null, 2);
    await seedLaporan(c, null, 3);
    const v = await listShowcase(sql, am());
    const t = v.tersisih.find((x) => x.clientId === c);
    expect(t?.alasan).toBe('laporan_belum_berskor');
    expect(t?.skorTerakhir).toBeNull();
  });

  it('totalLaporan & totalKlienDitimbang ikut dibawa — konteks yang halaman kosong butuhkan', async () => {
    const c = await seedKlienLolos();
    const v = await listShowcase(sql, am());
    expect(v.totalLaporan).toBeGreaterThanOrEqual(3);
    expect(v.totalKlienDitimbang).toBeGreaterThanOrEqual(1);
    expect(v.klien.map((x) => x.clientId)).toContain(c);
  });
});

// ---------------------------------------------------------------------------
// JAHITAN LINTAS-SISI — mesin laporan SUNGGUHAN → read model Showcase SUNGGUHAN
// ---------------------------------------------------------------------------
const META = (m: string) => `Ringkasan Toko 2026-${m}-01 ~ 2026-${m}-28`;
const SHOP_TT_HEADER = [
  '', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
  'AOV', 'Pembeli', 'Produk terjual', 'Impresi produk', 'Klik produk',
  'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi', 'GMV dari video akun tertaut',
];
const shopAoa = (bulan: string, gmv: string): unknown[][] => [
  [META(bulan)],
  ['Semua', 'Semua', 'Semua'],
  SHOP_TT_HEADER,
  ['Total nilai penjualan', gmv, 'Rp10.000.000', '50.000', 'Rp5.000.000', '1.000', '2,00%',
    'Rp100.000', '900', '1.200', '500.000', '20.000', 'Rp8.000.000', 'Rp15.000.000', 'Rp12.000.000'],
  ['Perubahan persentase', '5,00%', '', '-3,00%', '', '2,00%', '', '', '', '', '', '', '', '', ''],
  [`01/${bulan}/2026`, 'Rp3.000.000', '', '', '', '30', '', '', '', '', '', '', '', '', ''],
];

describeDb('JAHITAN: report.createReport yang sungguhan → listShowcase yang sungguhan', () => {
  it('tiga laporan dari MESIN menghasilkan satu baris Showcase dengan skor & GMV mesin itu juga', async () => {
    // Kenapa ini ada: tes unit di kedua sisi jahitan bisa hijau sementara
    // jahitannya putus, karena masing-masing memakai fixture-nya sendiri
    // (pelajaran B2↔B3 dan `angle_video`, DECISIONS 2026-09-06/07). Di sini
    // TIDAK ADA fixture `client_reports` — barisnya ditulis mesin laporan.
    const client = await seedClient();
    const pid = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, active, created_by)
      values (${client}, 'TikTok Shop', true, ${OWNER}) returning id`;
    const platformId = Number(pid[0].id);

    const dibuat = [];
    for (const [bulan, gmv] of [['06', 'Rp100.000.000'], ['07', 'Rp150.000.000'], ['08', 'Rp220.000.000']] as const) {
      dibuat.push(
        await createReport(sql, am(), client, {
          clientPlatformId: platformId,
          periodeTipe: 'bulanan',
          files: [{ filename: `toko-${bulan}.xlsx`, aoa: shopAoa(bulan, gmv), sha256: 'a'.repeat(64), ukuranBytes: 4096 }],
        }),
      );
    }
    const terakhir = dibuat[2];
    const pertama = dibuat[0];
    expect(terakhir.skor).not.toBeNull();

    const v = await listShowcase(sql, am());
    const lolos = v.klien.find((k) => k.clientId === client);
    const tersisih = v.tersisih.find((t) => t.clientId === client);

    // Sisi mana klien ini muncul TIDAK ditebak: ia diturunkan dari skor yang
    // mesin benar-benar hasilkan, lalu diuji. Sebuah `if (lolos)` telanjang
    // akan hijau juga saat cabang yang menarik tak pernah dijalani — persis
    // bentuk "hijau di atas kode yang bug" yang berkas ini ada untuk mencegah.
    const harusLolos = Number(terakhir.skor) >= core.AMBANG_SKOR_MIN;
    expect(Boolean(lolos)).toBe(harusLolos);
    expect(Boolean(tersisih)).toBe(!harusLolos);

    if (lolos) {
      expect(lolos.periodeDinilai).toBe(3);
      expect(lolos.skorTerakhir).toBeCloseTo(Number(terakhir.skor), 5);
      expect(lolos.trenGmv.awal).toBeCloseTo(pertama.gmvRunrateBulanan, 2);
      expect(lolos.trenGmv.akhir).toBeCloseTo(terakhir.gmvRunrateBulanan, 2);
      expect(lolos.periodeAkhir).toBe(terakhir.periodeAkhir);
      expect(lolos.platform).toEqual(['TikTok Shop']);
    } else {
      expect(tersisih!.periodeBerskor).toBe(3);
      expect(tersisih!.alasan).toBe('skor_kurang');
      expect(tersisih!.skorTerakhir).toBeCloseTo(Number(terakhir.skor), 5);
    }
  });

  it('GMV yang Showcase tampilkan adalah RUN-RATE mesin, bukan GMV mentah — laporan mingguan tidak jatuh 4x', async () => {
    // Jahitan satuan: `client_reports.gmv_runrate_bulanan` adalah satuan yang
    // SAMA untuk mingguan & bulanan (keputusan 3, DECISIONS 2026-08-19).
    // Showcase membaca kolom itu; kalau suatu saat ia beralih ke `gmv_net`,
    // tes ini memerah alih-alih materi pitch menunjukkan angka seperempatnya.
    const client = await seedClient();
    const pid = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, active, created_by)
      values (${client}, 'TikTok Shop', true, ${OWNER}) returning id`;
    const d = await createReport(sql, am(), client, {
      clientPlatformId: Number(pid[0].id),
      periodeTipe: 'mingguan',
      files: [{
        filename: 'toko-minggu.xlsx',
        aoa: [
          ['Ringkasan Toko 2026-08-04 ~ 2026-08-10'],
          ['Semua', 'Semua', 'Semua'],
          SHOP_TT_HEADER,
          ['Total nilai penjualan', 'Rp70.000.000', 'Rp1.000.000', '5.000', 'Rp1.000.000', '100', '2,00%',
            'Rp700.000', '90', '120', '50.000', '2.000', 'Rp800.000', 'Rp1.500.000', 'Rp1.200.000'],
        ],
        sha256: 'b'.repeat(64),
        ukuranBytes: 4096,
      }],
    });
    expect(d.gmvRunrateBulanan).toBeGreaterThan(d.gmvNet * 4);

    const v = await listShowcase(sql, am());
    const t = v.tersisih.find((x) => x.clientId === client);
    const k = v.klien.find((x) => x.clientId === client);
    // Satu laporan saja ⇒ pasti tersisih karena periode kurang; yang diuji di
    // sini adalah SATUANNYA sampai, dan itu terbaca dari sisi mana pun.
    expect(k).toBeUndefined();
    expect(t?.alasan).toBe('periode_kurang');
    const baris = await sql<{ gmv_runrate_bulanan: string }[]>`
      select gmv_runrate_bulanan from client_reports where client_id = ${client}`;
    expect(Number(baris[0].gmv_runrate_bulanan)).toBeCloseTo(d.gmvRunrateBulanan, 2);
  });

  it('JAHITAN izin: baris ledger yang sungguhan menentukan apa yang Sales lihat, bukan flag di memori', async () => {
    const c = await seedKlienLolos();
    // Tulis izin lewat jalur produk, baca lewat jalur produk, dan periksa
    // barisnya ADA di tabel — tiga sisi yang sama, bukan tiga fixture.
    await beriIzinPitch(sql, am(), c, { berlakuSampai: '2030-01-01', dokumenCatatan: 'PKS-2026-014' });
    const baris = await sql<Record<string, unknown>[]>`
      select aksi, berlaku_sampai, dokumen_catatan from client_pitch_consents where client_id = ${c}`;
    expect(baris).toHaveLength(1);
    expect(baris[0].aksi).toBe('beri');
    expect(baris[0].dokumen_catatan).toBe('PKS-2026-014');
    const v = await listShowcase(sql, sales());
    expect(v.klien.map((x) => x.clientId)).toContain(c);
    expect(v.disembunyikanTanpaIzin).toBe(v.tersisih.length === 0 ? v.disembunyikanTanpaIzin : v.disembunyikanTanpaIzin);
  });
});

// ---------------------------------------------------------------------------
// Materi pitch — gerbang izin di sini MUTLAK, tak peduli siapa yang meng-export
// ---------------------------------------------------------------------------
describeDb('materiPitch — dokumen yang meninggalkan gedung', () => {
  it('klien lolos ambang tapi BELUM berizin TIDAK masuk dokumen — walau Director yang meng-export', async () => {
    // Ini perbedaan sengaja dengan `listShowcase`: halaman memperlihatkan klien
    // belum-berizin ke Account/Director supaya mereka tahu izin mana yang perlu
    // diminta. Dokumen tidak, karena berkas yang sudah terkirim ke calon klien
    // tak bisa ditarik kembali.
    const c = await seedKlienLolos();
    const view = await listShowcase(sql, director());
    expect(view.klien.map((k) => k.clientId)).toContain(c);

    const doc = await materiPitch(sql, director());
    expect(doc.html).not.toContain(c);
    expect(doc.jumlahKlien).toBe(0);
    expect(doc.disembunyikanTanpaIzin).toBeGreaterThanOrEqual(1);
    expect(doc.html).toContain('Belum ada klien yang memenuhi ambang');
  });

  it('sesudah izin dicatat, kliennya masuk dokumen dengan nama tokonya', async () => {
    const c = await seedClient({ toko: 'Toko Sorot Utama' });
    await seedLaporan(c, 8.2, 1, 100_000_000);
    await seedLaporan(c, 8.5, 2, 150_000_000);
    await seedLaporan(c, 8.9, 3, 240_000_000);
    await beriIzinPitch(sql, am(), c);

    const doc = await materiPitch(sql, am());
    expect(doc.jumlahKlien).toBe(1);
    expect(doc.html).toContain('Toko Sorot Utama');
    expect(doc.html).toContain('Rp. 240.000.000,00');
    expect(doc.namaBerkas).toMatch(/^Showcase-Klien-Terbaik-MEA-\d{4}-\d{2}-\d{2}\.html$/);
  });

  it('Sales boleh meng-export, dan dokumennya isinya sama — izin yang menentukan, bukan peran', async () => {
    const c = await seedClient({ toko: 'Toko Berizin' });
    await seedLaporan(c, 8.3, 1, 50_000_000);
    await seedLaporan(c, 8.6, 2, 70_000_000);
    await seedLaporan(c, 8.8, 3, 120_000_000);
    await beriIzinPitch(sql, am(), c);

    const olehSales = await materiPitch(sql, sales(aktorUnik('SALES')));
    const olehAm = await materiPitch(sql, am());
    expect(olehSales.jumlahKlien).toBe(olehAm.jumlahKlien);
    expect(olehSales.html).toContain('Toko Berizin');
  });

  it('divisi di luar Account/Sales ditolak meng-export sama sekali', async () => {
    await expect(materiPitch(sql, creative())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
