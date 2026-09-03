/**
 * Client Portal read-model (M15-C2) — the EXTERNAL realm.
 *
 * What these tests exist to prove is not "the queries work" but the two things
 * that would be expensive to get wrong:
 *
 *  1. **Isolation.** A contact of client A must not reach client B's data, and
 *     not only by being absent from a list — by ASKING for it directly with a
 *     known id. Every read test therefore probes with an explicit id, because a
 *     list filter that happens to be correct tells you nothing about the
 *     by-id path (spec §4.3).
 *
 *  2. **The allow-list.** §4.2 forbids specific FIELDS, not just specific
 *     surfaces. So the DTOs are asserted by their KEY SETS: a future field added
 *     upstream must fail a test here rather than quietly reach a client.
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZP-`. "N skip" is not "N pass".
 */
import { afterEach, afterAll, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import {
  contactScope, gabungLabel, healthSummary, labelBand, labelKlien,
  LABEL_ACTION_NEEDED, LABEL_COMPLETED, LABEL_FINALIZING, LABEL_IN_PRODUCTION,
  LABEL_IN_REVIEW, LABEL_NEEDS_ATTENTION, LABEL_ON_TRACK, LABEL_QUEUED,
  listReports, MSG_DESKRIPSI_WAJIB, MSG_LAMPIRAN_BUKAN_TAUTAN, PESAN_ACK_KOMPLAIN,
  PortalForbiddenError, PortalNotFoundError, PortalRateLimitedError, PortalValidationError,
  reportHtml, serviceProgress, submitComplaint,
} from './client-portal';
import { createReport, publishReport, saveReportInsight } from './report';

// ---------------------------------------------------------------------------
// Pure units (no DB)
// ---------------------------------------------------------------------------
const contact = (contactId: string, clientId: string) =>
  ({ employeeId: contactId, clientContactId: contactId, clientId, role: permission.makeRole({}) });
const employee = () =>
  ({ employeeId: 'ZZP-AM', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const director = () =>
  ({ employeeId: 'ZZP-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });

describe('contactScope', () => {
  it('accepts a contact and returns the scope from the ACTOR, not the request', () => {
    expect(contactScope(contact('c1', 'CLI-1'))).toEqual({ contactId: 'c1', clientId: 'CLI-1' });
  });
  it('refuses an employee — even a Director', () => {
    // This realm is not a wider view of the internal one. A Director wanting to
    // see what a client sees uses the internal `?mode=klien` preview.
    expect(() => contactScope(employee())).toThrow(PortalForbiddenError);
    expect(() => contactScope(director())).toThrow(PortalForbiddenError);
  });
  it('refuses a half-formed contact actor', () => {
    expect(() => contactScope({ employeeId: 'c', clientContactId: 'c', clientId: '', role: permission.makeRole({}) }))
      .toThrow(PortalForbiddenError);
  });
});

describe('labelKlien — Universal Column relabelling (M15 Rule 2)', () => {
  it('maps every internal column to its client wording', () => {
    expect(labelKlien('To Do')).toBe(LABEL_QUEUED);
    expect(labelKlien('In Progress')).toBe(LABEL_IN_PRODUCTION);
    expect(labelKlien('Awaiting Review')).toBe(LABEL_FINALIZING);
    expect(labelKlien('Blocked/Revision')).toBe(LABEL_IN_REVIEW);
    expect(labelKlien('Done')).toBe(LABEL_COMPLETED);
  });
  it('never leaks an unmapped internal string', () => {
    // The failure mode must be a bland label, not the raw status.
    expect(labelKlien('[Blocked]')).toBe(LABEL_QUEUED);
    expect(labelKlien('')).toBe(LABEL_QUEUED);
  });
});

describe('gabungLabel — the least-finished piece of work wins', () => {
  it('a service with any unstarted work is Queued, not Completed', () => {
    expect(gabungLabel([LABEL_COMPLETED, LABEL_COMPLETED, LABEL_QUEUED])).toBe(LABEL_QUEUED);
  });
  it('only reports Completed when everything is', () => {
    expect(gabungLabel([LABEL_COMPLETED, LABEL_COMPLETED])).toBe(LABEL_COMPLETED);
  });
  it('a revision loop reads as In Review, below Finalizing', () => {
    expect(gabungLabel([LABEL_FINALIZING, LABEL_IN_REVIEW])).toBe(LABEL_IN_REVIEW);
  });
  it('a service with no work yet is Queued', () => {
    expect(gabungLabel([])).toBe(LABEL_QUEUED);
  });
});

describe('labelBand — health band wording (M15 Rule 4)', () => {
  it('maps the three bands and nothing else', () => {
    expect(labelBand('Healthy')).toBe(LABEL_ON_TRACK);
    expect(labelBand('Watch')).toBe(LABEL_NEEDS_ATTENTION);
    expect(labelBand('At Risk')).toBe(LABEL_ACTION_NEEDED);
    expect(labelBand('Something Else')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DB integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const AM = 'ZZP-AM';
const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

const META = 'Ringkasan Toko 2026-08-01 ~ 2026-08-31';
const SHOP_HEADER = [
  '', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
  'AOV', 'Pembeli', 'Produk terjual', 'Impresi produk', 'Klik produk',
  'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi', 'GMV dari video akun tertaut',
];
const shopAoa = (): unknown[][] => [
  [META], ['Semua', 'Semua', 'Semua'], SHOP_HEADER,
  ['Total nilai penjualan', 'Rp100.000.000', 'Rp10.000.000', '50.000', 'Rp5.000.000', '1.000', '2,00%',
    'Rp100.000', '900', '1.200', '500.000', '20.000', 'Rp8.000.000', 'Rp15.000.000', 'Rp12.000.000'],
  ['Perubahan persentase', '5,00%', '', '-3,00%', '', '2,00%', '', '', '', '', '', '', '', '', ''],
  ['01/08/2026', 'Rp3.000.000', '', '', '', '30', '', '', '', '', '', '', '', '', ''],
];
const fileFrom = () => ({ filename: 'toko.xlsx', aoa: shopAoa(), sha256: 'b'.repeat(64), ukuranBytes: 4096 });

const actorAm = { employeeId: AM, role: permission.makeRole({ division: 'Account', level: 'staff' }) };

interface Fixture { clientId: string; contactId: string; platformId: number }

async function seedKlien(): Promise<Fixture> {
  seq += 1;
  const clientId = `ZZP-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${clientId}, 'Rani', 'Alpha Digital', 'Bandung', 'https://x', 'Home Living', 0, 0, 0,
            'ZZP-SALES', 'ZZP-SALES', ${AM}, now(), ${AM})`;
  const plat = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${clientId}, 'TikTok Shop', 'https://tiktok.com/@a', true, ${AM}) returning id`;
  const ct = await sql<{ auth_user_id: string }[]>`
    insert into client_contacts (auth_user_id, client_id, nama, email, created_by)
    values (gen_random_uuid(), ${clientId}, 'Kontak Klien', ${`zzp-${RUN}-${seq}@example.test`}, ${AM})
    returning auth_user_id`;
  return { clientId, contactId: ct[0].auth_user_id, platformId: Number(plat[0].id) };
}

/** A report that has been published to the client, returning its id. */
async function laporanTerbit(f: Fixture, ringkasan: string): Promise<number> {
  const d = await createReport(sql, actorAm, f.clientId, {
    clientPlatformId: f.platformId, periodeTipe: 'bulanan', files: [fileFrom()],
  });
  await saveReportInsight(sql, actorAm, d.id, {
    ringkasan, poin: ['poin klien'], rekomendasi_tinggi: [], rekomendasi_sedang: [],
    outlook: 'outlook klien', indikator: [],
  });
  await publishReport(sql, actorAm, d.id);
  return d.id;
}

afterEach(async () => {
  if (!sql) return;
  await sql`alter table client_report_insight disable trigger trg_cri_no_delete`;
  try {
    await sql`delete from client_report_insight where report_id in (
      select id from client_reports where client_id like 'ZZP-CLI-%')`;
    await sql`delete from client_reports where client_id like 'ZZP-CLI-%'`;
  } finally {
    await sql`alter table client_report_insight enable trigger trg_cri_no_delete`;
  }
  await sql`delete from complaint_rate_limit_attempts where contact_id in (
    select auth_user_id from client_contacts where client_id like 'ZZP-CLI-%')`;
  await sql`delete from complaints where client_id like 'ZZP-CLI-%'`;
  // `client_health_snapshots` is append-only too (house rule #3) — same
  // step-around as above, and the same `finally` so a throw cannot leave the
  // guard off.
  await sql`alter table client_health_snapshots disable trigger client_health_snapshots_no_delete`;
  try {
    await sql`delete from client_health_snapshots where client_id like 'ZZP-CLI-%'`;
  } finally {
    await sql`alter table client_health_snapshots enable trigger client_health_snapshots_no_delete`;
  }
  await sql`delete from briefs where service_id in (select id from services where client_id like 'ZZP-CLI-%')`;
  await sql`delete from services where client_id like 'ZZP-CLI-%'`;
  await sql`delete from client_contacts where client_id like 'ZZP-CLI-%'`;
  await sql`delete from client_platforms where client_id like 'ZZP-CLI-%'`;
  await sql`delete from clients where id like 'ZZP-CLI-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

describeDb('laporan — hanya yang [Terbit], hanya milik klien sendiri', () => {
  it('lists only published reports, and never another client’s', async () => {
    const a = await seedKlien();
    const b = await seedKlien();
    const idA = await laporanTerbit(a, 'RINGKASAN KLIEN A');
    // B's report is created but left in [Draf].
    const draf = await createReport(sql, actorAm, b.clientId, {
      clientPlatformId: b.platformId, periodeTipe: 'bulanan', files: [fileFrom()],
    });

    const rowsA = await listReports(sql, contact(a.contactId, a.clientId));
    expect(rowsA.map((r) => r.reportId)).toEqual([idA]);

    const rowsB = await listReports(sql, contact(b.contactId, b.clientId));
    expect(rowsB).toEqual([]); // the draft is invisible even to its own client
    expect(draf.publikasi.status).toBe('[Draf]');
  });

  it('a contact asking DIRECTLY for another client’s report id gets not-found', async () => {
    const a = await seedKlien();
    const b = await seedKlien();
    const idA = await laporanTerbit(a, 'RAHASIA KLIEN A');
    // The by-id path, not the list — this is the one that matters.
    await expect(reportHtml(sql, contact(b.contactId, b.clientId), idA))
      .rejects.toThrow(PortalNotFoundError);
    // ...and A's own contact can read it, so the refusal above is scope, not a broken query.
    await expect(reportHtml(sql, contact(a.contactId, a.clientId), idA)).resolves.toContain('RAHASIA KLIEN A');
  });

  it('renders the PINNED revision in klien mode, never a later draft, never internal blocks', async () => {
    const a = await seedKlien();
    const id = await laporanTerbit(a, 'REVISI TERPAKU');
    await saveReportInsight(sql, actorAm, id, {
      ringkasan: 'REVISI BARU BELUM TERBIT', poin: ['x'], rekomendasi_tinggi: [],
      rekomendasi_sedang: [], outlook: 'o', indikator: [],
    });
    const html = await reportHtml(sql, contact(a.contactId, a.clientId), id);
    expect(html).toContain('REVISI TERPAKU');
    expect(html).not.toContain('REVISI BARU BELUM TERBIT');
    expect(html).not.toContain('INTERNAL');
  });

  it('a revoked report becomes unreadable', async () => {
    const a = await seedKlien();
    const id = await laporanTerbit(a, 'AKAN DICABUT');
    const { revokeReport } = await import('./report');
    await revokeReport(sql, actorAm, id, 'salah berkas');
    await expect(reportHtml(sql, contact(a.contactId, a.clientId), id)).rejects.toThrow(PortalNotFoundError);
    expect(await listReports(sql, contact(a.contactId, a.clientId))).toEqual([]);
  });

  it('the list DTO carries no score, GMV, engine version, or file provenance', async () => {
    const a = await seedKlien();
    await laporanTerbit(a, 'x');
    const rows = await listReports(sql, contact(a.contactId, a.clientId));
    expect(Object.keys(rows[0]).sort()).toEqual([
      'diterbitkanPada', 'periodeAkhir', 'periodeMulai', 'periodeTipe', 'platform', 'reportId',
    ]);
  });
});

describeDb('Service Progress — relabelled, and stripped of internals', () => {
  async function seedService(f: Fixture, briefStatuses: string[]): Promise<void> {
    const svc = `ZZP-SVC-${RUN}-${seq}`;
    await sql`
      insert into services (id, client_id, master_service_id, master_version_no, name,
        standard_price, commission_rule, status, created_by)
      values (${svc}, ${f.clientId}, 'MSV-X', 1, 'Kelola Toko TikTok', 0, 'none', '[In Execution]', ${AM})`;
    let i = 0;
    for (const st of briefStatuses) {
      i += 1;
      await sql`
        insert into briefs (id, service_id, title, status, assigned_division, assigned_pic, created_by)
        values (${`ZZP-BRF-${RUN}-${seq}-${i}`}, ${svc}, 'Rahasia internal', ${st}, 'Creative', 'ZZP-STAF', ${AM})`;
    }
  }

  it('rolls briefs up to one client-facing label and hides every internal detail', async () => {
    const a = await seedKlien();
    await seedService(a, ['[Approved]', '[In Progress]']);
    const rows = await serviceProgress(sql, contact(a.contactId, a.clientId));
    expect(rows).toHaveLength(1);
    expect(rows[0].namaLayanan).toBe('Kelola Toko TikTok');
    // Approved(Done) + In Progress ⇒ the unfinished one wins.
    expect(rows[0].label).toBe(LABEL_IN_PRODUCTION);
    expect(rows[0].jumlahPekerjaan).toBe(2);
    expect(rows[0].jumlahSelesai).toBe(1);
    // The DTO's key set IS the allow-list: no brief id, title, PIC, division, SLA.
    expect(Object.keys(rows[0]).sort()).toEqual(['jumlahPekerjaan', 'jumlahSelesai', 'label', 'namaLayanan']);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('ZZP-BRF');
    expect(dump).not.toContain('Rahasia internal');
    expect(dump).not.toContain('ZZP-STAF');
    expect(dump).not.toContain('[Approved]');
    expect(dump).not.toContain('[In Progress]');
  });

  it('shows nothing from another client', async () => {
    const a = await seedKlien();
    const b = await seedKlien();
    await seedService(a, ['[To Do]']);
    expect(await serviceProgress(sql, contact(b.contactId, b.clientId))).toEqual([]);
  });
});

describeDb('Health Summary — band label only', () => {
  it('returns the label and NOT the number, and nothing for another client', async () => {
    const a = await seedKlien();
    const b = await seedKlien();
    await sql`
      insert into client_health_snapshots
        (id, client_id, period_start, period_end, final_health_score, band, roas_toggle_state,
         components_json, computed_by)
      values (${`CHR-209908-${String(seq).padStart(4, '0')}`}, ${a.clientId}, '2026-08-01', '2026-08-31',
              74.6, 'Watch', true, '{"gmv":{"raw":40}}'::jsonb, ${AM})`;
    const h = await healthSummary(sql, contact(a.contactId, a.clientId));
    expect(h).toEqual({ label: LABEL_NEEDS_ATTENTION, periodeAkhir: '2026-08-31' });
    // The score and the breakdown are in the same row and must never travel.
    expect(JSON.stringify(h)).not.toContain('74.6');
    expect(JSON.stringify(h)).not.toContain('gmv');
    expect(await healthSummary(sql, contact(b.contactId, b.clientId))).toEqual({ label: null, periodeAkhir: null });
  });
});

describeDb('Complaint form — submit only', () => {
  it('creates a CPL- tagged Client Portal with the submitting contact, and acknowledges', async () => {
    const a = await seedKlien();
    const ack = await submitComplaint(sql, contact(a.contactId, a.clientId), {
      deskripsi: 'Laporan bulan ini angkanya beda dengan Seller Center.', ip: '10.0.0.9',
    });
    expect(ack.complaintId).toMatch(/^CPL-\d{6}-\d{4}$/);
    expect(ack.pesan).toBe(PESAN_ACK_KOMPLAIN);
    const rows = await sql<Record<string, unknown>[]>`
      select source, severity, status, assigned_to, submitting_contact_id
        from complaints where id = ${ack.complaintId}`;
    expect(rows[0].source).toBe('Client Portal');
    expect(rows[0].severity).toBe('Low');           // client omitted it
    expect(rows[0].status).toBe('[Open]');
    expect(rows[0].assigned_to).toBe(AM);            // routed to the AM, like door #2
    expect(rows[0].submitting_contact_id).toBe(a.contactId);
    // Routed through the SAME notification as a WhatsApp complaint.
    const notif = await sql<{ n: string }[]>`
      select count(*)::text as n from notifications
       where entity_type = 'complaint' and entity_id = ${ack.complaintId}`;
    expect(Number(notif[0].n)).toBeGreaterThan(0);
  });

  it('refuses a blank description and a non-link attachment', async () => {
    const a = await seedKlien();
    const c = contact(a.contactId, a.clientId);
    await expect(submitComplaint(sql, c, { deskripsi: '   ' })).rejects.toThrow(MSG_DESKRIPSI_WAJIB);
    await expect(submitComplaint(sql, c, { deskripsi: 'ok', lampiran: 'text' }))
      .rejects.toThrow(MSG_LAMPIRAN_BUKAN_TAUTAN);
    await expect(submitComplaint(sql, c, { deskripsi: 'ok', severity: 'Katastrofik' }))
      .rejects.toThrow(PortalValidationError);
  });

  it('rate-limits the 6th submission in an hour (spec §5.2)', async () => {
    const a = await seedKlien();
    const c = contact(a.contactId, a.clientId);
    for (let i = 0; i < 5; i += 1) {
      await submitComplaint(sql, c, { deskripsi: `komplain ${i}`, ip: '10.0.0.10' });
    }
    await expect(submitComplaint(sql, c, { deskripsi: 'ke-6', ip: '10.0.0.10' }))
      .rejects.toThrow(PortalRateLimitedError);
  });

  it('refuses an employee actor outright', async () => {
    await expect(submitComplaint(sql, actorAm, { deskripsi: 'x' })).rejects.toThrow(PortalForbiddenError);
  });
});
