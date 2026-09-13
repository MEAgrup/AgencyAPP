/**
 * PDT (Pusat Data Toko) — predikat izin (G1-01) + pratinjau deteksi batch
 * (G1-09, `previewUploadBatch`).
 *
 * Bagian pertama murni, tanpa DB: ketiga predikat izin adalah fungsi
 * permission murni (sama seperti `showcase.canKelolaIzinPitch`, yang
 * lingkupnya disalin). Bagian `describeDb` (real Postgres, di-skip tanpa
 * `DATABASE_URL`) menguji `previewUploadBatch` — pemanggil NYATA pertama yang
 * menyambungkan `@cdps/core` `pdt` ke baris `client_platforms`/`clients`
 * sungguhan. Baris di-namespace `ZPDT-`.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  canKelolaBenchmark,
  canKirimLaporan,
  canUploadBatch,
  platformKeVokabPdt,
  previewUploadBatch,
  type PdtPreviewBerkasInput,
} from './pdt';

const OWNER = 'ZPDT-AM';
const am = (id = OWNER) => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = () => ({ employeeId: 'ZPDT-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = () => ({ employeeId: 'ZPDT-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = () => ({ employeeId: 'ZPDT-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
const sales = () => ({ employeeId: 'ZPDT-SALES', role: permission.makeRole({ division: 'Sales', level: 'staff' }) });
/** Director yang kebetulan terpetakan ke divisi lain — haknya dari peran berlapis. */
const directorDiSales = () => ({ employeeId: 'ZPDT-DS', role: permission.makeRole({ division: 'Sales', level: 'staff', director: true }) });

describe('canUploadBatch — AM pemilik klien, atau lead/Director Account', () => {
  it('AM pemilik klien boleh mengunggah batch kliennya', () => {
    expect(canUploadBatch(am(OWNER), OWNER)).toBe(true);
  });

  it('AM lain TIDAK boleh mengunggah batch klien yang bukan miliknya', () => {
    expect(canUploadBatch(am('ZPDT-LAIN'), OWNER)).toBe(false);
  });

  it('lead Account boleh, Director (di mana pun terpetakan) membawa lead', () => {
    expect(canUploadBatch(accountLead(), OWNER)).toBe(true);
    expect(canUploadBatch(director(), OWNER)).toBe(true);
    expect(canUploadBatch(directorDiSales(), OWNER)).toBe(true);
  });

  it('OD murni (bukan Director) TIDAK boleh mengunggah batch klien orang lain', () => {
    expect(canUploadBatch(od(), OWNER)).toBe(false);
  });

  it('divisi Sales TIDAK boleh mengunggah batch PDT', () => {
    expect(canUploadBatch(sales(), OWNER)).toBe(false);
  });

  it('klien tanpa AM (ownerAm null) TIDAK bisa diunggah siapa pun kecuali lead/Director', () => {
    expect(canUploadBatch(am(OWNER), null)).toBe(false);
    expect(canUploadBatch(accountLead(), null)).toBe(true);
  });
});

describe('canKelolaBenchmark — Director SAJA (bukan OD murni)', () => {
  it('Director boleh mengelola kalibrasi', () => {
    expect(canKelolaBenchmark(director())).toBe(true);
  });

  it('OD murni, lead Account, dan AM biasa TIDAK boleh', () => {
    expect(canKelolaBenchmark(od())).toBe(false);
    expect(canKelolaBenchmark(accountLead())).toBe(false);
    expect(canKelolaBenchmark(am())).toBe(false);
  });
});

describe('canKirimLaporan — lingkup sama seperti canUploadBatch', () => {
  it('AM pemilik klien boleh mengirim laporan kliennya', () => {
    expect(canKirimLaporan(am(OWNER), OWNER)).toBe(true);
  });

  it('AM lain TIDAK boleh mengirim laporan klien yang bukan miliknya', () => {
    expect(canKirimLaporan(am('ZPDT-LAIN'), OWNER)).toBe(false);
  });

  it('lead Account dan Director boleh', () => {
    expect(canKirimLaporan(accountLead(), OWNER)).toBe(true);
    expect(canKirimLaporan(director(), OWNER)).toBe(true);
  });
});

describe('platformKeVokabPdt (PDT-22 — vokab client_platforms.platform ≠ vokab pdt)', () => {
  it('Shopee → shopee, TikTok Shop → tiktok', () => {
    expect(platformKeVokabPdt('Shopee')).toBe('shopee');
    expect(platformKeVokabPdt('TikTok Shop')).toBe('tiktok');
  });

  it('Tokopedia/Lazada/Blibli → null (manual, PDT tidak berlaku)', () => {
    expect(platformKeVokabPdt('Tokopedia')).toBeNull();
    expect(platformKeVokabPdt('Lazada')).toBeNull();
    expect(platformKeVokabPdt('Blibli')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// previewUploadBatch (G1-09) — integrasi Postgres nyata (di-skip tanpa
// DATABASE_URL). Pola fixture sama dengan account.test.ts/client.test.ts:
// prefix 'ZPDT-'/'ZZ-PDT-', dibersihkan afterEach.
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const nextClientId = (): string => `CLI-ZPDT-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, assignedAm: string | null): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${assignedAm}, 'ZZ-TEST')`;
}

async function insertClientPlatform(
  clientId: string,
  platform: string,
  shopId: string | null = null,
  akunKontenToko: readonly string[] | null = null,
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, active, shop_id, akun_konten_toko, created_by)
    values (${clientId}, ${platform}, true, ${shopId}, ${akunKontenToko ? JSON.stringify(akunKontenToko) : null}::jsonb, 'ZZ-TEST')
    returning id`;
  return rows[0].id;
}

afterAll(async () => {
  if (sql) await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from client_platforms where created_by like 'ZZ-%'`;
  await sql`delete from clients where created_by like 'ZZ-%'`;
});

const OWNER_AM = 'ZPDT-AM-DB';
const ownerActor = () => ({ employeeId: OWNER_AM, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const otherAm = () => ({ employeeId: 'ZPDT-AM-LAIN', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const leadActor = () => ({ employeeId: 'ZPDT-SPV-DB', role: permission.makeRole({ division: 'Account', level: 'lead' }) });

const decodeGagalBerkas = (nama: string, pesan: string): PdtPreviewBerkasInput => ({
  nama, sha256: null, bytes: null, ditolakPagar: null, decodeGagal: pesan, aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
});

const ditolakPagarBerkas = (nama: string, pesan: string): PdtPreviewBerkasInput => ({
  nama, sha256: null, bytes: null, ditolakPagar: { pesan }, decodeGagal: null, aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
});

/** Berkas shopee_ads_cpc LENGKAP (seluruh kolomDipanen + preamble) — cukup untuk status 'ok' dan sinyal identitas/periode. */
function shopeeAdsCpcBerkas(nama: string, idToko: string, periode: string): PdtPreviewBerkasInput {
  const header = [
    'ID Toko', 'Periode', 'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya',
    'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)',
  ];
  const aoa: unknown[][] = [
    [`ID Toko: ${idToko}`],
    ['Username: tokoku'],
    ['Nama Toko: Toko Saya'],
    [`Periode: ${periode}`],
    [],
    [],
    [],
    header,
    ['P1', '01/07/2026', 'PRD-1', '100', '10', '2', '5000', 'Iklan A', '200000', '4x', '2,5'],
  ];
  return { nama, sha256: 'sha-cpc', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, modulTerdeteksi: 'shopee_ads_cpc', ambiguous: false, matches: ['shopee_ads_cpc'] };
}

/** Berkas tt_video LENGKAP — cukup untuk status 'ok' dan sinyal identitas TikTok ('ID Kreator' terbanyak). */
function ttVideoBerkas(nama: string, idKreator: string): PdtPreviewBerkasInput {
  const header = ['ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator', 'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)'];
  const aoa: unknown[][] = [
    [], [],
    header,
    [idKreator, 'V1', '01/07/2026', 'Produk A', '100', '10', '2', '5', 'Kreator A', 'info', '1000', '50000'],
    [idKreator, 'V2', '02/07/2026', 'Produk B', '200', '20', '4', '10', 'Kreator A', 'info', '2000', '80000'],
  ];
  return { nama, sha256: 'sha-video', bytes: 100, ditolakPagar: null, decodeGagal: null, aoa, modulTerdeteksi: 'tt_video', ambiguous: false, matches: ['tt_video'] };
}

describeDb('previewUploadBatch (G1-09) — gerbang izin + platform', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    await expect(previewUploadBatch(sql, ownerActor(), 999999999, [])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('403 untuk AM yang bukan pemilik klien (dan bukan lead/Director)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    await expect(previewUploadBatch(sql, otherAm(), cpId, [])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lead Account boleh membaca pratinjau batch klien siapa pun', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const hasil = await previewUploadBatch(sql, leadActor(), cpId, []);
    expect(hasil.platform).toBe('shopee');
  });

  it('platform Tokopedia/Lazada/Blibli ⇒ ValidationError (PDT-22, manual saja)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Tokopedia');
    await expect(previewUploadBatch(sql, ownerActor(), cpId, [])).rejects.toBeInstanceOf(ValidationError);
  });

  it('moduleOptions hanya modul platform batch ini (bukan lintas platform)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, []);
    expect(hasil.moduleOptions.length).toBeGreaterThan(0);
    expect(hasil.moduleOptions.some((m) => m.kode === 'shopee_shop_stats')).toBe(false);
    expect(hasil.moduleOptions.some((m) => m.kode === 'tt_video')).toBe(true);
  });
});

describeDb('previewUploadBatch (G1-09) — status per berkas', () => {
  async function fixture(platform = 'Shopee'): Promise<number> {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    return insertClientPlatform(clientId, platform);
  }

  it('ditolakPagar ⇒ status ditolak_pagar, pesan apa adanya', async () => {
    const cpId = await fixture();
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [ditolakPagarBerkas('a.zip', '[berkas terenkripsi]')]);
    expect(hasil.berkas).toEqual([
      expect.objectContaining({ nama: 'a.zip', status: 'ditolak_pagar', pesan: '[berkas terenkripsi]', modulKode: null }),
    ]);
  });

  it('decodeGagal ⇒ status gagal, pesan = pesan decode (Rule 10 — "berkas tidak diunggah" tidak pernah dipakai)', async () => {
    const cpId = await fixture();
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [decodeGagalBerkas('b.xlsx', 'berkas tidak berisi sheet apa pun')]);
    expect(hasil.berkas[0]).toMatchObject({ status: 'gagal', pesan: 'berkas tidak berisi sheet apa pun' });
    expect(hasil.berkas[0].pesan).not.toContain('tidak diunggah');
  });

  it('ambiguous (>1 modul cocok) ⇒ status perlu_pilih_modul, menyebut daftar modul', async () => {
    const cpId = await fixture();
    const input: PdtPreviewBerkasInput = {
      nama: 'c.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [['x']], modulTerdeteksi: null, ambiguous: true, matches: ['shopee_diskon', 'shopee_flash_sale'],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [input]);
    expect(hasil.berkas[0].status).toBe('perlu_pilih_modul');
    expect(hasil.berkas[0].pesan).toContain('shopee_diskon');
    expect(hasil.berkas[0].pesan).toContain('shopee_flash_sale');
  });

  it('nol modul cocok (bukan ambiguous) ⇒ status perlu_pilih_modul juga, pesan berbeda', async () => {
    const cpId = await fixture();
    const input: PdtPreviewBerkasInput = {
      nama: 'd.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [['x']], modulTerdeteksi: null, ambiguous: false, matches: [],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [input]);
    expect(hasil.berkas[0].status).toBe('perlu_pilih_modul');
    expect(hasil.berkas[0].pesan).toContain('tidak dikenali');
  });

  it('modul terdeteksi, kolom wajib LENGKAP ⇒ status ok, baris header DICARI bukan hint mentah', async () => {
    const cpId = await fixture();
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('e.xlsx', '111', '01/07/2026 - 31/07/2026')]);
    expect(hasil.berkas[0]).toMatchObject({ status: 'ok', modulKode: 'shopee_ads_cpc', barisHeader: 8, kolomDipanen: 11, kolomBaru: [], pesan: null });
  });

  it('modul terdeteksi, kolom wajib HILANG ⇒ status gagal, pesan menyebut nama kolom (Rule 9)', async () => {
    const cpId = await fixture();
    const input: PdtPreviewBerkasInput = {
      nama: 'f.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [['Kode Produk', 'Dilihat', 'Biaya']], // shopee_ads_cpc, tapi 8 dari 11 kolomDipanen hilang
      modulTerdeteksi: 'shopee_ads_cpc', ambiguous: false, matches: ['shopee_ads_cpc'],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [input]);
    expect(hasil.berkas[0].status).toBe('gagal');
    expect(hasil.berkas[0].pesan).toContain("'Periode'");
  });

  it('kolom di luar whitelist/alias tercatat sebagai kolomBaru (Rule 8, NAMA saja)', async () => {
    const cpId = await fixture();
    const berkas = shopeeAdsCpcBerkas('g.xlsx', '111', '01/07/2026 - 31/07/2026');
    (berkas.aoa as unknown[][])[7] = [...(berkas.aoa as unknown[][])[7], 'Kolom Rahasia Baru'];
    (berkas.aoa as unknown[][])[8] = [...(berkas.aoa as unknown[][])[8], 'nilai-rahasia'];
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [berkas]);
    expect(hasil.berkas[0].kolomBaru).toEqual(['Kolom Rahasia Baru']);
  });
});

describeDb('previewUploadBatch (G1-09) — identitas (Rule 2-4) + periode (Rule 5)', () => {
  it('Shopee, shop_id belum terikat ⇒ usulkan_ikat dari preamble; periode dari preamble', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', null);
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')]);
    expect(hasil.identitas).toEqual({ status: 'usulkan_ikat', usulan: '938284780' });
    expect(hasil.periode).toEqual({ status: 'ok', mulai: '2026-07-01', selesai: '2026-07-31' });
  });

  it('Shopee, ID Toko berkas ≠ shop_id tersimpan ⇒ tolak, menyebut KEDUA nilai', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-LAMA');
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [shopeeAdsCpcBerkas('a.xlsx', '938284780', '01/07/2026 - 31/07/2026')]);
    expect(hasil.identitas.status).toBe('tolak');
    expect((hasil.identitas as { pesan: string }).pesan).toContain('938284780');
    expect((hasil.identitas as { pesan: string }).pesan).toContain('SHOP-LAMA');
  });

  it('Shopee tanpa satu pun berkas Ads ber-preamble ⇒ tidak_dapat_divalidasi', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee', 'SHOP-1');
    const header = ['Pesanan Dibuat', 'Total Pengunjung']; // shopee_shop_stats, tak ada preamble
    const berkas: PdtPreviewBerkasInput = {
      nama: 'stats.xlsx', sha256: 's', bytes: 1, ditolakPagar: null, decodeGagal: null,
      aoa: [header], modulTerdeteksi: 'shopee_shop_stats', ambiguous: false, matches: ['shopee_shop_stats'],
    };
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [berkas]);
    expect(hasil.identitas.status).toBe('tidak_dapat_divalidasi');
  });

  it('TikTok, akun_konten_toko belum terikat ⇒ usulkan_ikat dari ID Kreator terbanyak', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, null);
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [ttVideoBerkas('v.xlsx', 'kreator-a')]);
    expect(hasil.identitas).toEqual({ status: 'usulkan_ikat', usulan: 'kreator-a' });
  });

  it('TikTok, ID Kreator terdaftar di akun_konten_toko ⇒ cocok', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop', null, ['kreator-a', 'kreator-b']);
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [ttVideoBerkas('v.xlsx', 'kreator-a')]);
    expect(hasil.identitas).toEqual({ status: 'cocok' });
  });

  it('nol berkas ber-status ok ⇒ periode null (bukan objek "tolak")', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, OWNER_AM);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const hasil = await previewUploadBatch(sql, ownerActor(), cpId, [decodeGagalBerkas('x.xlsx', 'rusak')]);
    expect(hasil.periode).toBeNull();
  });
});
