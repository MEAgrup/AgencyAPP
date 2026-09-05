/**
 * Mesin Laporan Klien (C1 bagian 2) — the domain layer: detect → score → store,
 * and the single thing that makes C1 real: writing `clients.total_sales` in the
 * 30-day run-rate unit the Health Score reads.
 *
 * Writes run as the owning superuser `sql` (RLS bypassed) — the API's db()
 * service-role path (DECISIONS O37): the TS canWrite* gate is the primary wall,
 * the DB freeze/UNIQUE the second. Pure gate tests need no DB.
 *
 * The fixtures mirror the real export shape (date-range meta row, a "Semua"
 * filter row, the header row, a "Total nilai" summary row, daily rows) with the
 * exports' exact column strings — the same shape report.test.ts uses, but passed
 * as raw AoA so the SERVER does the readSheet/detect/score (as in production).
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZR-`. "N skip" is not "N pass".
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  canReadReport,
  canWriteReport,
  createReport,
  getReport,
  getReportInsight,
  listReports,
  MSG_ALASAN_CABUT_WAJIB,
  MSG_BELUM_TERBIT,
  MSG_SUDAH_ADA,
  MSG_SUDAH_TERBIT,
  MSG_TAHAP_FOKUS_TAK_DIKENAL,
  MSG_TAK_ADA_PERUBAHAN,
  publishReport,
  renderReport,
  renderReportForDownload,
  republishReport,
  resetReportInsight,
  revokeReport,
  saveReportInsight,
  setTahapFokus,
  STATUS_DICABUT,
  STATUS_DRAF,
  STATUS_TERBIT,
} from './report';
import { ConflictError, ForbiddenError, ValidationError } from './account';

// ---------------------------------------------------------------------------
// Pure gate unit tests (no DB)
// ---------------------------------------------------------------------------
const am = (id = 'ZZR-AM') => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = () => ({ employeeId: 'ZZR-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const creativeLead = () => ({ employeeId: 'ZZR-CRE', role: permission.makeRole({ division: 'Creative', level: 'lead' }) });
const director = () => ({ employeeId: 'ZZR-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = () => ({ employeeId: 'ZZR-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });

describe('canWriteReport', () => {
  it('the owning AM writes their own client report', () => {
    expect(canWriteReport(am('ZZR-AM'), 'ZZR-AM')).toBe(true);
  });
  it('an Account lead / Director may write any client report', () => {
    expect(canWriteReport(accountLead(), 'ZZR-AM')).toBe(true);
    expect(canWriteReport(director(), 'ZZR-AM')).toBe(true);
  });
  it('OD is read-only — no write, even though it reads everywhere', () => {
    expect(canWriteReport(od(), 'ZZR-AM')).toBe(false);
  });
  it('a stray AM / other-division lead cannot write', () => {
    expect(canWriteReport(am('ZZR-OTHER'), 'ZZR-AM')).toBe(false);
    expect(canWriteReport(creativeLead(), 'ZZR-AM')).toBe(false);
  });
});

describe('canReadReport', () => {
  it('owner AM / Account lead / OD / Director read', () => {
    expect(canReadReport(am('ZZR-AM'), 'ZZR-AM')).toBe(true);
    expect(canReadReport(accountLead(), 'ZZR-AM')).toBe(true);
    expect(canReadReport(od(), 'ZZR-AM')).toBe(true);
    expect(canReadReport(director(), 'ZZR-AM')).toBe(true);
  });
  it('a stray AM / other-division lead cannot read', () => {
    expect(canReadReport(am('ZZR-OTHER'), 'ZZR-AM')).toBe(false);
    expect(canReadReport(creativeLead(), 'ZZR-AM')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Export fixtures (raw AoA — the server parses/scores)
// ---------------------------------------------------------------------------
const META_BULAN = 'Ringkasan Toko 2026-08-01 ~ 2026-08-31';
const META_MINGGU = 'Ringkasan Toko 2026-08-04 ~ 2026-08-10'; // 7 days

const sheetAoa = (header: unknown[], rows: unknown[][], meta: string): unknown[][] =>
  [[meta], ['Semua', 'Semua', 'Semua'], header, ...rows];

const SHOP_TT_HEADER = [
  '', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
  'AOV', 'Pembeli', 'Produk terjual', 'Impresi produk', 'Klik produk',
  'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi', 'GMV dari video akun tertaut',
];
const shopTtAoa = (meta = META_BULAN): unknown[][] => sheetAoa(SHOP_TT_HEADER, [
  ['Total nilai penjualan', 'Rp100.000.000', 'Rp10.000.000', '50.000', 'Rp5.000.000', '1.000', '2,00%',
    'Rp100.000', '900', '1.200', '500.000', '20.000', 'Rp8.000.000', 'Rp15.000.000', 'Rp12.000.000'],
  ['Perubahan persentase', '5,00%', '', '-3,00%', '', '2,00%', '', '', '', '', '', '', '', '', ''],
  ['01/08/2026', 'Rp3.000.000', '', '', '', '30', '', '', '', '', '', '', '', '', ''],
  ['02/08/2026', 'Rp4.000.000', '', '', '', '40', '', '', '', '', '', '', '', '', ''],
], meta);

const SHA = 'a'.repeat(64);
const fileFrom = (filename: string, aoa: unknown[][]) => ({ filename, aoa, sha256: SHA, ukuranBytes: 4096 });

// ---------------------------------------------------------------------------
// DB integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER = 'ZZR-AM';
const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

const actorAm = { employeeId: OWNER, role: permission.makeRole({ division: 'Account', level: 'staff' }) };
const actorStray = { employeeId: 'ZZR-OTHER', role: permission.makeRole({ division: 'Account', level: 'staff' }) };
const actorOd = { employeeId: 'ZZR-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) };

async function seedClient(): Promise<string> {
  seq += 1;
  const client = `ZZR-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${client}, 'Rani', 'Alpha Digital', 'Bandung', 'https://shopee.co.id/alpha',
            'Home Living', 0, 0, 0, 'ZZR-SALES', 'ZZR-SALES', ${OWNER}, now(), ${OWNER})`;
  return client;
}
async function seedPlatform(client: string, platform = 'TikTok Shop'): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${client}, ${platform}, 'https://tiktok.com/@alpha', true, ${OWNER}) returning id`;
  return Number(rows[0].id);
}
async function totalSalesOf(client: string): Promise<number> {
  const r = await sql<{ total_sales: string }[]>`select total_sales from clients where id = ${client}`;
  return Number(r[0].total_sales);
}

afterEach(async () => {
  if (!sql) return;
  // `client_report_insight` genuinely refuses DELETE (append-only, no CASCADE),
  // so a fixture cannot tidy up through the product path — the same situation as
  // `prospect_activities` in activity.test.ts. Step around the guard as the
  // owning superuser, and put it straight back even if the delete throws, so a
  // failure here can never leave the table writable for the next test.
  await sql`alter table client_report_insight disable trigger trg_cri_no_delete`;
  try {
    await sql`delete from client_report_insight where report_id in (
      select id from client_reports where client_id like 'ZZR-CLI-%')`;
    await sql`delete from client_reports where client_id like 'ZZR-CLI-%'`; // berkas + publikasi CASCADE
  } finally {
    await sql`alter table client_report_insight enable trigger trg_cri_no_delete`;
  }
  await sql`delete from client_platforms where client_id like 'ZZR-CLI-%'`;
  await sql`delete from clients where id like 'ZZR-CLI-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

describeDb('createReport — score, store, and write total_sales', () => {
  it('a monthly report passes GMV through as the total_sales unit', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    expect(d.skor).not.toBeNull();
    expect(d.gmvNet).toBeGreaterThan(0);
    expect(d.periodeMulai).toBe('2026-08-01');
    expect(d.periodeAkhir).toBe('2026-08-31');
    expect(d.hariPeriode).toBe(31);
    expect(d.rentangDariBerkas).toBe(true);
    // Monthly: run-rate == net GMV (no scaling).
    expect(d.gmvRunrateBulanan).toBeCloseTo(d.gmvNet, 2);
    // clients.total_sales is written from the report — the gap C1 closes.
    expect(await totalSalesOf(client)).toBeCloseTo(d.gmvRunrateBulanan, 2);
  });

  it('a WEEKLY report writes the 30-day RUN-RATE, not the raw weekly GMV (trap #1)', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'mingguan', files: [fileFrom('toko.xlsx', shopTtAoa(META_MINGGU))],
    });
    expect(d.hariPeriode).toBe(7);
    // A weekly upload must NOT drop total_sales ~4x: the run-rate scales the
    // week up to a month (×30/7 ≈ 4.29). total_sales reads the run-rate.
    expect(d.gmvRunrateBulanan).toBeGreaterThan(d.gmvNet * 4);
    expect(d.gmvRunrateBulanan).toBeCloseTo((d.gmvNet * 30) / 7, 0);
    expect(await totalSalesOf(client)).toBeCloseTo(d.gmvRunrateBulanan, 2);
  });

  it('total_sales = Σ latest run-rate across a client\'s active platforms', async () => {
    const client = await seedClient();
    const a = await seedPlatform(client, 'TikTok Shop');
    const b = await seedPlatform(client, 'TikTok Shop 2');
    const da = await createReport(sql, actorAm, client, {
      clientPlatformId: a, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    const db = await createReport(sql, actorAm, client, {
      clientPlatformId: b, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    expect(await totalSalesOf(client)).toBeCloseTo(da.gmvRunrateBulanan + db.gmvRunrateBulanan, 2);
  });

  it('re-uploading the same toko × tipe × range is a ConflictError, never a silent overwrite', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    await expect(createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    })).rejects.toThrow(ConflictError);
    await expect(createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    })).rejects.toThrow(MSG_SUDAH_ADA);
  });

  it('refuses a report for a client the actor does not own', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await expect(createReport(sql, actorStray, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    })).rejects.toThrow(ForbiddenError);
  });

  it('rejects a missing store-analytics file with the exact BI message', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    // A product-analytics file detects unambiguously (prod_tt) — so we reach the
    // "toko wajib" gate rather than the own-vs-affiliate ambiguity guard.
    const prodOnly = sheetAoa(
      ['Nama', 'ID Produk', 'GMV', 'Klik produk', 'Impresi produk', 'CTOR (pesanan SKU)', 'Pesanan SKU', 'Produk terjual'],
      [['Produk Bintang', 'P1', 'Rp40.000.000', '900', '20.000', '3,00%', '27', '30']], META_BULAN,
    );
    await expect(createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('produk.xlsx', prodOnly)],
    })).rejects.toThrow(/Analitik Toko TikTok wajib/);
  });

  it('the stored report row is immutable (payload/GMV cannot be re-typed)', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    await expect(sql`update client_reports set gmv_net = 1 where id = ${d.id}`).rejects.toThrow(/immutable/);
  });
});

describeDb('reads — listReports / getReport / renderReport', () => {
  it('lists a client\'s reports newest-first and reads one back for OD', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    const list = await listReports(sql, actorOd, client);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(d.id);
    const full = await getReport(sql, actorOd, d.id);
    expect(full.berkas.length).toBeGreaterThan(0);
    expect(full.payload).not.toBeNull();
  });

  it('a stray AM is refused on read', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    await expect(listReports(sql, actorStray, client)).rejects.toThrow(ForbiddenError);
    await expect(getReport(sql, actorStray, d.id)).rejects.toThrow(ForbiddenError);
  });

  it('client HTML OMITS the internal remarks that internal HTML carries', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    const klien = await renderReport(sql, actorAm, d.id, 'klien');
    const internal = await renderReport(sql, actorAm, d.id, 'internal');
    expect(klien).toContain('<!DOCTYPE html>');
    // The internal page is marked as such in its title; the client page is not.
    expect(internal).toContain('Internal');
    expect(klien).not.toContain(' — Internal');
    // Internal-only score-note blocks are BUILT for internal, never for klien.
    expect(internal.length).toBeGreaterThan(klien.length);
  });
});

// ===========================================================================
// Insight yang bisa disunting + gerbang publikasi (migrasi 20260908010000)
// ===========================================================================
const DRAF_AM = {
  ringkasan: 'Suntingan AM: GMV naik karena kampanye Ramadan, bukan tren dasar.',
  poin: ['Poin AM satu', 'Poin AM dua'],
  rekomendasi_tinggi: [{ judul: 'Kunci stok hero SKU', target: 'Stok 30 hari', dampak: 'Cegah kehabisan', timeline: '2 minggu' }],
  rekomendasi_sedang: [],
  outlook: 'Suntingan AM: tahan budget sampai listing beres.',
  indikator: [{ nama: 'Target CVR', target: '2,0%' }],
};

/** How many rows the PORTAL's own filter would return for this report id. */
async function listPortalReports(db: Sql, _a: unknown, id: number): Promise<number> {
  const rows = await db<{ n: string }[]>`
    select count(*)::text as n from client_reports r
      join client_report_publikasi p on p.report_id = r.id
     where r.id = ${id} and p.status = '[Terbit]' and p.insight_revisi is not null`;
  return Number(rows[0].n);
}

async function laporanBaru(): Promise<{ client: string; id: number }> {
  const client = await seedClient();
  const pid = await seedPlatform(client);
  const d = await createReport(sql, actorAm, client, {
    clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
  });
  return { client, id: d.id };
}

describeDb('insight laporan — revisi & paku', () => {
  it('a new report is born [Draf] with revisi 0 = the engine snapshot', async () => {
    const { id } = await laporanBaru();
    const b = await getReportInsight(sql, actorAm, id);
    expect(b.publikasi.status).toBe(STATUS_DRAF);
    expect(b.publikasi.insightRevisi).toBeNull();
    expect(b.mesin.revisi).toBe(0);
    expect(b.mesin.sumber).toBe('mesin');
    expect(b.terbaru.revisi).toBe(0);
    expect(b.terpaku).toBeNull();
    expect(b.mesin.insight.ringkasan.length).toBeGreaterThan(0);
  });

  it('saving an edit appends a revision and changes NOTHING for the client', async () => {
    const { id } = await laporanBaru();
    const b = await saveReportInsight(sql, actorAm, id, DRAF_AM, 'konteks Ramadan');
    expect(b.terbaru.revisi).toBe(1);
    expect(b.terbaru.sumber).toBe('manual');
    expect(b.terbaru.catatanRevisi).toBe('konteks Ramadan');
    // The engine snapshot survives untouched — that is what reset copies back.
    expect(b.mesin.revisi).toBe(0);
    expect(b.mesin.insight.ringkasan).not.toBe(DRAF_AM.ringkasan);
    // Still unpublished: a save is not an announcement.
    expect(b.publikasi.status).toBe(STATUS_DRAF);
    expect(b.publikasi.insightRevisi).toBeNull();
  });

  it('a rejected draft consumes no revision number', async () => {
    const { id } = await laporanBaru();
    await expect(saveReportInsight(sql, actorAm, id, { ...DRAF_AM, ringkasan: '  ' }))
      .rejects.toThrow('[ringkasan eksekutif wajib diisi]');
    const b = await getReportInsight(sql, actorAm, id);
    expect(b.terbaru.revisi).toBe(0);
  });

  it('publishing pins the latest revision; internal previews the newer one', async () => {
    const { id } = await laporanBaru();
    await saveReportInsight(sql, actorAm, id, DRAF_AM);
    const pub = await publishReport(sql, actorAm, id);
    expect(pub.status).toBe(STATUS_TERBIT);
    expect(pub.insightRevisi).toBe(1);
    expect(pub.diterbitkanOleh).toBe(OWNER);

    // Client render uses revisi 1 (the pinned one).
    const klien = await renderReport(sql, actorAm, id, 'klien');
    expect(klien).toContain('Poin AM satu');

    // Save revisi 2 — the client must NOT see it until republished.
    const b2 = await saveReportInsight(sql, actorAm, id, { ...DRAF_AM, ringkasan: 'REVISI DUA BELUM TERBIT' });
    expect(b2.adaPerubahanBelumTerbit).toBe(true);
    expect(b2.publikasi.insightRevisi).toBe(1);
    const klien2 = await renderReport(sql, actorAm, id, 'klien');
    expect(klien2).not.toContain('REVISI DUA BELUM TERBIT');
    const internal = await renderReport(sql, actorAm, id, 'internal');
    expect(internal).toContain('REVISI DUA BELUM TERBIT');

    // Republish moves the pin.
    const pub2 = await republishReport(sql, actorAm, id);
    expect(pub2.insightRevisi).toBe(2);
    expect(await renderReport(sql, actorAm, id, 'klien')).toContain('REVISI DUA BELUM TERBIT');
  });

  it('republish refuses when there is nothing new to publish', async () => {
    const { id } = await laporanBaru();
    await publishReport(sql, actorAm, id);
    await expect(republishReport(sql, actorAm, id)).rejects.toThrow(MSG_TAK_ADA_PERUBAHAN);
  });

  it('publish refuses on an already-published report; republish refuses on a draft', async () => {
    const { id } = await laporanBaru();
    await expect(republishReport(sql, actorAm, id)).rejects.toThrow(MSG_BELUM_TERBIT);
    await publishReport(sql, actorAm, id);
    await expect(publishReport(sql, actorAm, id)).rejects.toThrow(MSG_SUDAH_TERBIT);
  });

  it('reset brings back the engine text as a NEW revision, keeping the edit on file', async () => {
    const { id } = await laporanBaru();
    const b0 = await getReportInsight(sql, actorAm, id);
    const mesinText = b0.mesin.insight.ringkasan;
    await saveReportInsight(sql, actorAm, id, DRAF_AM);
    const b = await resetReportInsight(sql, actorAm, id);
    expect(b.terbaru.revisi).toBe(2);
    expect(b.terbaru.sumber).toBe('manual'); // a copy, not a second baseline
    expect(b.terbaru.insight.ringkasan).toBe(mesinText);
  });

  it('revoke clears the pin and needs a reason; the client can no longer read it', async () => {
    const { id } = await laporanBaru();
    await publishReport(sql, actorAm, id);
    await expect(revokeReport(sql, actorAm, id, '   ')).rejects.toThrow(ValidationError);
    await expect(revokeReport(sql, actorAm, id, '   ')).rejects.toThrow(MSG_ALASAN_CABUT_WAJIB);
    const pub = await revokeReport(sql, actorAm, id, 'salah berkas');
    expect(pub.status).toBe(STATUS_DICABUT);
    expect(pub.alasanCabut).toBe('salah berkas');
    // The pin SURVIVES a revocation on purpose — it records which revision the
    // client had already read. Readability is governed by `status`, so keeping
    // it exposes nothing.
    expect(pub.insightRevisi).toBe(0);
    await expect(listPortalReports(sql, actorAm, id)).resolves.toBe(0);
    // And it can be published again afterwards — [Dicabut] is not a dead end.
    const again = await publishReport(sql, actorAm, id);
    expect(again.status).toBe(STATUS_TERBIT);
    expect(again.insightRevisi).toBe(0);
    expect(again.alasanCabut).toBeNull();
  });

  it('OD reads the insight but may not edit or publish it', async () => {
    const { id } = await laporanBaru();
    await expect(getReportInsight(sql, actorOd, id)).resolves.toBeTruthy();
    await expect(saveReportInsight(sql, actorOd, id, DRAF_AM)).rejects.toThrow(ForbiddenError);
    await expect(publishReport(sql, actorOd, id)).rejects.toThrow(ForbiddenError);
    await expect(revokeReport(sql, actorOd, id, 'x')).rejects.toThrow(ForbiddenError);
  });

  it('an AM from another client cannot read, edit, or publish', async () => {
    const { id } = await laporanBaru();
    await expect(getReportInsight(sql, actorStray, id)).rejects.toThrow(ForbiddenError);
    await expect(saveReportInsight(sql, actorStray, id, DRAF_AM)).rejects.toThrow(ForbiddenError);
    await expect(publishReport(sql, actorStray, id)).rejects.toThrow(ForbiddenError);
  });

  it('every revision row is immutable — a correction is a new revision', async () => {
    const { id } = await laporanBaru();
    await saveReportInsight(sql, actorAm, id, DRAF_AM);
    await expect(sql`update client_report_insight set ringkasan = 'x' where report_id = ${id}`)
      .rejects.toThrow();
    await expect(sql`delete from client_report_insight where report_id = ${id}`).rejects.toThrow();
  });
});

// ===========================================================================
// R3 — tahap fokus, funnel di payload, dan unduhan bernama
// ===========================================================================
describeDb('setTahapFokus — siapa yang boleh, dan apa yang tercatat', () => {
  it('lets the OWNING AM set it, and echoes what was stored', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    expect(await setTahapFokus(sql, actorAm, client, pid, 'awareness')).toBe('awareness');
    const rows = await sql<{ tahap_fokus: string | null }[]>`
      select tahap_fokus from client_platforms where id = ${pid}`;
    expect(rows[0].tahap_fokus).toBe('awareness');
  });

  it('treats the empty string a <select> submits as "clear", not as an error', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await setTahapFokus(sql, actorAm, client, pid, 'conversion');
    expect(await setTahapFokus(sql, actorAm, client, pid, '')).toBeNull();
    expect(await setTahapFokus(sql, actorAm, client, pid, null)).toBeNull();
  });

  it('refuses an unknown stage with the BI message, and changes nothing', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await setTahapFokus(sql, actorAm, client, pid, 'awareness');
    await expect(setTahapFokus(sql, actorAm, client, pid, 'retention'))
      .rejects.toThrow(MSG_TAHAP_FOKUS_TAK_DIKENAL);
    const rows = await sql<{ tahap_fokus: string | null }[]>`
      select tahap_fokus from client_platforms where id = ${pid}`;
    expect(rows[0].tahap_fokus).toBe('awareness');
  });

  it('refuses a non-owning AM, and refuses OD — who may READ everything but writes nothing', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await expect(setTahapFokus(sql, actorStray, client, pid, 'awareness')).rejects.toThrow();
    await expect(setTahapFokus(sql, actorOd, client, pid, 'awareness')).rejects.toThrow();
    const rows = await sql<{ tahap_fokus: string | null }[]>`
      select tahap_fokus from client_platforms where id = ${pid}`;
    expect(rows[0].tahap_fokus).toBeNull();
  });

  it('records the change before→after in the audit log', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await setTahapFokus(sql, actorAm, client, pid, 'consideration');
    const rows = await sql<{ before_json: unknown; after_json: unknown }[]>`
      select before_json, after_json from audit_log
       where entity_type = 'client' and entity_id = ${client} and action = 'tahap_fokus_diubah'`;
    expect(rows).toHaveLength(1);
    expect((rows[0].before_json as { tahap_fokus: string | null }).tahap_fokus).toBeNull();
    expect((rows[0].after_json as { tahap_fokus: string | null }).tahap_fokus).toBe('consideration');
  });
});

describeDb('tahap — stempel ke payload yang beku', () => {
  it('stamps the stage in force at generation time', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await setTahapFokus(sql, actorAm, client, pid, 'awareness');
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    expect((d.payload as { tahap: { fokus: string | null } }).tahap.fokus).toBe('awareness');
  });

  it('leaves an ALREADY-ISSUED report saying what it said when the shop moves on', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await setTahapFokus(sql, actorAm, client, pid, 'awareness');
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    // The shop graduates to the next stage…
    await setTahapFokus(sql, actorAm, client, pid, 'conversion');
    // …and last month's report is unmoved. This is the whole reason the value is
    // stamped rather than joined at read time.
    const lagi = await getReport(sql, actorAm, d.id);
    expect((lagi.payload as { tahap: { fokus: string | null } }).tahap.fokus).toBe('awareness');
  });

  it('accepts a store with no stage set — the report is still built', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReport(sql, actorAm, client, {
      clientPlatformId: pid, periodeTipe: 'bulanan', files: [fileFrom('toko.xlsx', shopTtAoa())],
    });
    expect((d.payload as { tahap: { fokus: string | null } }).tahap.fokus).toBeNull();
    const html = await renderReport(sql, actorAm, d.id, 'klien');
    expect(html).toContain('Perjalanan Pembeli');
    expect(html).not.toContain('FOKUS PERIODE INI');
  });
});

describeDb('narasi tahap — revisi, dan angka yang tidak ikut berubah', () => {
  it('stores the stage prose on the revision and leaves payload byte-identical', async () => {
    const { id } = await laporanBaru();
    const sebelum = JSON.stringify((await getReport(sql, actorAm, id)).payload);
    await saveReportInsight(sql, actorAm, id, {
      ...DRAF_AM,
      tahap_narasi: [{ tahap: 'awareness', judul: 'Judul AM', teks: 'Teks AM' }],
    }, null);
    const b = await getReportInsight(sql, actorAm, id);
    expect(b.terbaru.insight.tahap_narasi).toEqual([{ tahap: 'awareness', judul: 'Judul AM', teks: 'Teks AM' }]);
    // The numbers are the point: an insight edit must not move one of them.
    expect(JSON.stringify((await getReport(sql, actorAm, id)).payload)).toBe(sebelum);
  });

  it('carries the AM\'s stage prose into the client render, and the engine\'s before any edit', async () => {
    const { id } = await laporanBaru();
    expect(await renderReport(sql, actorAm, id, 'internal')).toContain('Catatan tahap Awareness');
    await saveReportInsight(sql, actorAm, id, {
      ...DRAF_AM,
      tahap_narasi: [{ tahap: 'awareness', judul: 'Judul AM', teks: 'Teks AM' }],
    }, null);
    const html = await renderReport(sql, actorAm, id, 'internal');
    expect(html).toContain('Teks AM');
    expect(html).not.toContain('Catatan tahap Awareness');
  });

  it('copies the machine stage prose back on reset, rather than recomputing it', async () => {
    const { id } = await laporanBaru();
    const mesin = (await getReportInsight(sql, actorAm, id)).mesin.insight.tahap_narasi;
    await saveReportInsight(sql, actorAm, id, { ...DRAF_AM, tahap_narasi: [] }, null);
    const b = await resetReportInsight(sql, actorAm, id);
    expect(b.terbaru.insight.tahap_narasi).toEqual(mesin);
  });
});

describeDb('renderReportForDownload — nama berkas yang membedakan dua salinan', () => {
  it('names the internal copy differently from the client copy', async () => {
    const { id } = await laporanBaru();
    const klien = await renderReportForDownload(sql, actorAm, id, 'klien');
    const internal = await renderReportForDownload(sql, actorAm, id, 'internal');
    expect(klien.namaBerkas).toBe('Laporan-Alpha-Digital-2026-08-01.html');
    expect(internal.namaBerkas).toBe('Laporan-Alpha-Digital-2026-08-01-INTERNAL.html');
    expect(internal.html.length).toBeGreaterThan(klien.html.length);
  });

  it('applies the same read scope as every other report read', async () => {
    const { id } = await laporanBaru();
    await expect(renderReportForDownload(sql, actorStray, id, 'klien')).rejects.toThrow();
    // OD reads everywhere — including the internal copy.
    await expect(renderReportForDownload(sql, actorOd, id, 'internal')).resolves.toBeTruthy();
  });
});
