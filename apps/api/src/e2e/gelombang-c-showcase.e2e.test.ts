/**
 * Uji terima Gelombang C — Showcase Klien Terbaik, dijalankan LEWAT RUTE.
 *
 * Aturan yang dibawa dari Gelombang B dan terbukti dua kali (B2↔B3, lalu
 * `angle_video`): **setiap jahitan wajib punya satu tes yang memanggil KEDUA
 * sisi yang sungguhan**. Untuk Gelombang C jahitannya ada tiga, dan ketiganya
 * dilalui di sini sebagai `Request` ke route handler `apps/api` yang sungguhan —
 * lewat `requireActor` (JWT HS256 yang di-mint tes ini), lewat `wire.ts`, lewat
 * domain, ke Postgres hasil `db-rebuild`:
 *
 *   1. **`client_reports` sungguhan → read model Showcase.** Laporannya ditulis
 *      `POST /clients/{id}/reports` — mesin laporan yang sungguhan, bukan
 *      fixture baris `client_reports`.
 *   2. **ledger izin (C-5) → daftar yang Sales lihat.** Izin diberikan lewat
 *      `POST /clients/{id}/izin-pitch` dan dampaknya dibaca lewat
 *      `GET /showcase` dengan token Sales.
 *   3. **domain → wire → halaman.** Yang diperiksa adalah BADAN JSON-nya
 *      (snake_case, `null` eksplisit) — kelas bug O43 hidup persis di situ:
 *      rute menjawab 200 dan halamannya tetap blank.
 *
 * Yang tes ini TIDAK buktikan, disebut jujur: piksel React. Halaman
 * `/showcase` merender apa yang badan ini bawa; itu diuji terpisah di
 * `web-internal`.
 *
 * Dilewati bila `DATABASE_URL` tak diset. Baris ber-awalan `ZZ-UATC`.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import { showcase as coreShowcase } from '@cdps/core';

import { GET as showcaseGet } from '../app/api/v1/showcase/route';
import { GET as izinGet, POST as izinPost } from '../app/api/v1/clients/[id]/izin-pitch/route';
import { POST as izinCabut } from '../app/api/v1/clients/[id]/izin-pitch/cabut/route';
import type { IzinPanelWire, IzinStatusWire, ShowcaseViewWire } from '../lib/wire';

const SECRET = 'uat-gelombang-c-secret';
const URL_DB = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL_DB);
let sql: Sql;
if (URL_DB) sql = createClient(URL_DB);

// ---------------------------------------------------------------------------
// Aktor — token GoTrue asli (HS256), diverifikasi `requireActor` seperti biasa.
// ---------------------------------------------------------------------------
const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url');
function sign(c: { employeeId: string; division: string; level: string; od?: boolean; director?: boolean }): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: {
      employee_id: c.employeeId, division: c.division, level: c.level,
      od: c.od ?? false, director: c.director ?? false,
    },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const AM = 'ZZ-UATC-AM';
const SALES = 'ZZ-UATC-SALES';
const CREATIVE = 'ZZ-UATC-CRE';
const DIR = 'ZZ-UATC-DIR';
const amToken = sign({ employeeId: AM, division: 'Account', level: 'staff' });
const salesToken = sign({ employeeId: SALES, division: 'Sales', level: 'staff' });
const creativeToken = sign({ employeeId: CREATIVE, division: 'Creative', level: 'staff' });
const dirToken = sign({ employeeId: DIR, division: 'Account', level: 'staff', director: true });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string, token: string): Request =>
  new Request(`http://localhost/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
const post = (path: string, token: string, body: unknown): Request =>
  new Request(`http://localhost/api/v1${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const body = async <T,>(res: Response): Promise<T> => (await res.json()) as T;

// ---------------------------------------------------------------------------
// Fixture — SATU klien, tiga laporan bulanan ber-skor di atas ambang.
//
// Laporannya disisipkan langsung KARENA yang diuji berkas ini adalah rantai
// rute Showcase, bukan mesin laporan: jahitan mesin→read model sudah dijaga
// `packages/domain/src/showcase.test.ts` ("JAHITAN: report.createReport yang
// sungguhan → listShowcase yang sungguhan"). Menyalin lagi seluruh export
// TikTok ke sini akan menguji hal yang sama dua kali sambil membuat berkas ini
// gagal karena sebab yang bukan miliknya.
// ---------------------------------------------------------------------------
const CLIENT = 'ZZ-UATC-CLI-1';
const CLIENT_RENDAH = 'ZZ-UATC-CLI-2';
const CLIENT_KOSONG = 'ZZ-UATC-CLI-3';

async function seedKlien(id: string): Promise<void> {
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${id}, 'Rani', ${'Toko ' + id}, 'Bandung', 'https://shopee.co.id/x', 'Home Living',
            0, 0, 0, 'ZZ-UATC-SL', 'ZZ-UATC-SL', ${AM}, now(), ${AM})`;
}

async function seedLaporan(clientId: string, skor: number, bulan: number, gmv: number): Promise<void> {
  const [cp] = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, active, created_by)
    values (${clientId}, 'TikTok Shop', true, ${AM}) returning id`;
  const mm = String(bulan).padStart(2, '0');
  await sql`
    insert into client_reports (client_id, client_platform_id, platform, periode_tipe,
                                periode_mulai, periode_akhir, hari_periode, payload,
                                skor, skor_label, gmv_net, gmv_kotor, gmv_runrate_bulanan,
                                engine_versi, payload_schema, created_by, benchmark_versi)
    values (${clientId}, ${cp.id}, 'TikTok Shop', 'bulanan',
            ${`2026-${mm}-01`}, ${`2026-${mm}-28`}, 28, '{}'::jsonb,
            ${skor}, ${skor >= 8 ? 'SEHAT' : skor >= 6 ? 'PERLU PERHATIAN' : 'KRITIS'},
            ${gmv}, ${gmv}, ${gmv}, 'cdps.report.tiktok.v1', 'cdps.report.tiktok.v1', ${AM},
            (select max(versi) from report_benchmark))`;
}

beforeAll(async () => {
  if (!sql) return;
  process.env.SUPABASE_JWT_SECRET = SECRET;
  await bersihkan();
  await seedKlien(CLIENT);
  await seedLaporan(CLIENT, 8.2, 1, 100_000_000);
  await seedLaporan(CLIENT, 8.5, 2, 150_000_000);
  await seedLaporan(CLIENT, 8.9, 3, 240_000_000);

  await seedKlien(CLIENT_RENDAH);
  await seedLaporan(CLIENT_RENDAH, 9.0, 1, 90_000_000);
  await seedLaporan(CLIENT_RENDAH, 8.5, 2, 80_000_000);
  await seedLaporan(CLIENT_RENDAH, 4.5, 3, 40_000_000); // jatuh — KRITIS di periode terakhir

  await seedKlien(CLIENT_KOSONG); // nol laporan
});

async function bersihkan(): Promise<void> {
  await sql`alter table client_pitch_consents disable trigger trg_client_pitch_consents_frozen`;
  await sql`alter table client_report_insight disable trigger trg_cri_no_delete`;
  try {
    await sql`delete from client_pitch_consents where client_id like 'ZZ-UATC-%'`;
    await sql`delete from client_report_insight where report_id in (
      select id from client_reports where client_id like 'ZZ-UATC-%')`;
    await sql`delete from client_reports where client_id like 'ZZ-UATC-%'`;
  } finally {
    await sql`alter table client_report_insight enable trigger trg_cri_no_delete`;
    await sql`alter table client_pitch_consents enable trigger trg_client_pitch_consents_frozen`;
  }
  await sql`delete from client_platforms where client_id like 'ZZ-UATC-%'`;
  await sql`delete from clients where id like 'ZZ-UATC-%'`;
}

afterAll(async () => {
  if (!sql) return;
  await bersihkan();
  await sql.end();
});

// ---------------------------------------------------------------------------
dDb('§C butir 1 — halaman Showcase menjawab, dan badannya snake_case (kelas O43)', () => {
  it('GET /showcase untuk AM: 200, klien lolos ambang ada, kunci wire lengkap', async () => {
    const res = await showcaseGet(get('/showcase', amToken));
    expect(res.status).toBe(200);
    const v = await body<ShowcaseViewWire>(res);

    const k = v.klien.find((x) => x.client_id === CLIENT);
    expect(k).toBeDefined();
    // Kunci snake_case, dan `null` EKSPLISIT — bukan kunci yang hilang.
    expect(Object.keys(k!).sort()).toEqual([
      'berizin', 'kategori', 'client_id', 'periode_akhir', 'periode_dinilai', 'periode_mulai',
      'platform', 'skor_label_terakhir', 'skor_terakhir', 'toko', 'tren_gmv', 'tren_skor',
    ].sort());
    expect(k!.periode_dinilai).toBe(3);
    expect(k!.skor_terakhir).toBe(8.9);
    expect(k!.skor_label_terakhir).toBe('SEHAT');
    expect(k!.tren_gmv).toEqual({ awal: 100_000_000, akhir: 240_000_000, delta: 1.4 });
    expect(k!.platform).toEqual(['TikTok Shop']);
  });

  it('ambang ikut dikirim supaya halaman MENYEBUTKANNYA di layar (C-4)', async () => {
    const v = await body<ShowcaseViewWire>(await showcaseGet(get('/showcase', amToken)));
    expect(v.ambang.skor_min).toBe(coreShowcase.AMBANG_SKOR_MIN);
    expect(v.ambang.min_periode).toBe(coreShowcase.AMBANG_MIN_PERIODE);
    expect(v.ambang.kalimat).toContain('8,0');
    expect(v.ambang.sumber).toContain('C-4');
  });

  it('setiap klien yang tersisih membawa KALIMAT sebabnya, bukan sekadar kode (C-2)', async () => {
    const v = await body<ShowcaseViewWire>(await showcaseGet(get('/showcase', amToken)));
    const kosong = v.tersisih.find((t) => t.client_id === CLIENT_KOSONG);
    const rendah = v.tersisih.find((t) => t.client_id === CLIENT_RENDAH);
    expect(kosong?.alasan).toBe('belum_ada_laporan');
    expect(kosong?.alasan_kalimat).toBe(coreShowcase.ALASAN_KALIMAT.belum_ada_laporan);
    expect(kosong?.skor_terakhir).toBeNull(); // null EKSPLISIT
    expect(rendah?.alasan).toBe('skor_kurang');
    expect(rendah?.alasan_kalimat).toContain('8,0');
    expect(rendah?.skor_terakhir).toBe(4.5);
  });
});

dDb('§C butir 2 — empat pagar C-1 berdiri di lapis rute', () => {
  it('pagar (a): divisi di luar Account/Sales ditolak 403', async () => {
    const res = await showcaseGet(get('/showcase', creativeToken));
    expect(res.status).toBe(403);
  });

  it('pagar (b): Sales membuka Showcase dan TIDAK melihat klien yang belum berizin', async () => {
    const res = await showcaseGet(get('/showcase', salesToken));
    expect(res.status).toBe(200);
    const v = await body<ShowcaseViewWire>(res);
    expect(v.disaring_izin).toBe(true);
    expect(v.klien.map((k) => k.client_id)).not.toContain(CLIENT);
    expect(v.disembunyikan_tanpa_izin).toBeGreaterThanOrEqual(1);
    // Sales juga tidak menerima daftar klien yang performanya belum cukup.
    expect(v.tersisih).toEqual([]);
  });

  it('pagar (a): Sales ditolak 403 di endpoint izin — aksesnya read-only', async () => {
    expect((await izinPost(post(`/clients/${CLIENT}/izin-pitch`, salesToken, {}), ctx(CLIENT))).status).toBe(403);
    expect((await izinGet(get(`/clients/${CLIENT}/izin-pitch`, salesToken), ctx(CLIENT))).status).toBe(403);
    expect((await izinCabut(post(`/clients/${CLIENT}/izin-pitch/cabut`, salesToken, {}), ctx(CLIENT))).status).toBe(403);
  });

  it('pagar (b)+(c): izin diberikan ⇒ Sales melihat kliennya, dan aksesnya tercatat di audit log', async () => {
    const beri = await izinPost(
      post(`/clients/${CLIENT}/izin-pitch`, amToken, {
        berlaku_sampai: '2030-12-31',
        dokumen_catatan: 'PKS-2026-014 pasal 7',
      }),
      ctx(CLIENT),
    );
    expect(beri.status).toBe(200);
    const st = await body<IzinStatusWire>(beri);
    expect(st.berizin).toBe(true);
    expect(st.berlaku_sampai).toBe('2030-12-31');
    expect(st.kedaluwarsa).toBe(false);

    const v = await body<ShowcaseViewWire>(await showcaseGet(get('/showcase', salesToken)));
    expect(v.klien.map((k) => k.client_id)).toContain(CLIENT);
    expect(v.klien.find((k) => k.client_id === CLIENT)!.berizin).toBe(true);

    const audit = await sql<{ after_json: Record<string, unknown> }[]>`
      select after_json from audit_log
       where entity_type = 'showcase' and actor_employee_id = ${SALES}
       order by id desc limit 1`;
    expect(audit).toHaveLength(1);
    expect(audit[0].after_json.klien_terlihat).toContain(CLIENT);
  });

  it('pagar (b): izin dicabut ⇒ klien hilang lagi dari pandangan Sales', async () => {
    const cabut = await izinCabut(
      post(`/clients/${CLIENT}/izin-pitch/cabut`, dirToken, { alasan: 'klien menarik izin' }),
      ctx(CLIENT),
    );
    expect(cabut.status).toBe(200);
    expect((await body<IzinStatusWire>(cabut)).berizin).toBe(false);

    const v = await body<ShowcaseViewWire>(await showcaseGet(get('/showcase', salesToken)));
    expect(v.klien.map((k) => k.client_id)).not.toContain(CLIENT);
  });
});

dDb('§C butir 3 — riwayat izin utuh dan tak bisa diubah (C-5, aturan rumah #3)', () => {
  it('GET izin-pitch mengembalikan status + riwayat lengkap, terbaru dulu', async () => {
    const res = await izinGet(get(`/clients/${CLIENT}/izin-pitch`, amToken), ctx(CLIENT));
    expect(res.status).toBe(200);
    const p = await body<IzinPanelWire>(res);
    expect(p.status.berizin).toBe(false);
    expect(p.riwayat.map((r) => r.aksi)).toEqual(['cabut', 'beri']);
    // Baris `beri` yang lama TETAP membawa buktinya — inilah gunanya ledger.
    expect(p.riwayat[1].dokumen_catatan).toBe('PKS-2026-014 pasal 7');
    expect(p.riwayat[1].berlaku_sampai).toBe('2030-12-31');
    expect(p.riwayat[0].alasan).toBe('klien menarik izin');
    // Kunci yang tak terisi dikirim sebagai `null`, bukan dihilangkan.
    expect(p.riwayat[0].dokumen_catatan).toBeNull();
    expect(p.riwayat[0].berlaku_sampai).toBeNull();
  });

  it('baris ledger menolak UPDATE dan DELETE di DB, bukan hanya "tak ada jalur rute"', async () => {
    await expect(sql`update client_pitch_consents set alasan = 'x' where client_id = ${CLIENT}`)
      .rejects.toThrow(/immutable/);
    await expect(sql`delete from client_pitch_consents where client_id = ${CLIENT}`)
      .rejects.toThrow(/immutable/);
  });

  it('memberi izin lagi sesudah dicabut berhasil, dan riwayatnya menunjukkan ketiganya', async () => {
    const res = await izinPost(post(`/clients/${CLIENT}/izin-pitch`, amToken, {}), ctx(CLIENT));
    expect(res.status).toBe(200);
    const p = await body<IzinPanelWire>(await izinGet(get(`/clients/${CLIENT}/izin-pitch`, amToken), ctx(CLIENT)));
    expect(p.riwayat.map((r) => r.aksi)).toEqual(['beri', 'cabut', 'beri']);
    expect(p.status.berizin).toBe(true);
    expect(p.status.berlaku_sampai).toBeNull(); // tanpa batas waktu
  });

  it('memberi izin dua kali ditolak dengan pesan BI-nya, bukan 500', async () => {
    const res = await izinPost(post(`/clients/${CLIENT}/izin-pitch`, amToken, {}), ctx(CLIENT));
    expect(res.status).toBe(400);
    expect((await body<{ error: string }>(res)).error).toMatch(/^\[.*\]$/);
  });
});
