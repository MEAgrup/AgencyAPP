/**
 * B2 (HANDOFF_PENUTUP_REVISI_OD_20260908.md §4) — browser-tour fixture.
 *
 * NOT the Alpha Digital DoD fixture (`supabase/seed.sql`, which stays the
 * minimal Sprint-0 smoke set — 10 employees, 6 master services, 1 demo task).
 * This one drives ONE realistic client → transaction → service → brief chain
 * through real domain calls (leads.register → sales.close → finance.verifyPayment
 * → account.createBrief → creative/kol/storeops), the same way a real user's
 * clicks would, so the screens that only fail visually (never a thrown error
 * `tsc`/`vitest`/`next build` would catch) have real rows to render against.
 *
 * Run ONCE per fresh `db-rebuild` (not idempotent — a second run registers a
 * second lead with a new phone number and mints new IDs; harmless, just
 * redundant). Never run against anything but a local dev DB.
 *
 * ## AKTORNYA WAJIB KARYAWAN SUNGGUHAN, dan itu bukan kosmetik
 *
 * Sampai 2026-09-10 fixture ini memakai aktor sintetis `B2TOUR-BUDI`, yang
 * BUKAN baris `employees`. Akibatnya DUA butir UAT gagal PALSU
 * (`UAT_SALES_BROWSER_20260910.md` §5):
 *
 *   - kolom Owner `/sales` menampilkan `B2TOUR-BUDI` karena tidak ada nama
 *     untuk di-resolve — terbaca persis seperti bug feedback Sales `#2` yang
 *     justru sudah diperbaiki;
 *   - `clients.sales_pic_id` yang bukan karyawan berarti TIDAK ADA aktor yang
 *     bisa memenuhi `private.jwt_owns_client`, jadi setiap Sales staff kena 403
 *     di panel Kontrak — terbaca seperti FS-5 yang tidak bekerja.
 *
 * Karena itu ia kini memakai `EMP-0001` (Budi Santoso, Sales staff) dan
 * `EMP-0006` (Dewi Anggraini, Sales Head) dari `supabase/seed.sql`. Gerbangnya
 * tetap dievaluasi apa adanya — yang berubah hanya: aktornya benar-benar ada.
 *
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps \
 *   npx tsx scripts/seed-browser-tour.ts > /tmp/tour-ids.json
 *
 * (tsx needs to run from a path node_modules can resolve `@cdps/*` from —
 * i.e. the repo root, not a path outside it.)
 */
import { permission } from '@cdps/core';
import { createClient } from '@cdps/db';
import { leads, sales, finance, account, creative, kol, storeops, strategi } from '@cdps/domain';

const { close, submitQualifiedForm, submitNegotiation, markContacted, PAYMENT_SCHEME_TERMIN } = sales;
const { verifyPayment, attachContract } = finance;
const { createBrief, setStrategyRequirement } = account;
const { createAsset } = creative;
const { createBooking, book, startContent, submitContent, sendToQCReview, passQC, createPaymentRequest } = kol;
const { createSku } = storeops;
const { createStrategi } = strategi;

const URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/cdps';
const sql = createClient(URL);

const director = () => ({
  employeeId: 'EMP-0008',
  divisi: 'Management',
  role: permission.makeRole({ director: true }),
});

let seq = 0;
const phone = () => `0812${String(Date.now()).slice(-6)}${String(seq++).padStart(3, '0')}`;

/** planTier defaults to 'tanpa_plan' (no Strategy gate) — pass 'ditentukan_am'
 *  for the one service you want to build a real STRG- against. */
const SALES = 'EMP-0001';        // Budi Santoso — Sales staff (supabase/seed.sql)
const SALES_LAIN = 'EMP-0006';   // Dewi Anggraini — Sales Head
const ADMIN = 'EMP-0006';        // yang mengelola katalog MSL

async function seedService(
  id: string,
  price: string,
  planTier: string = 'tanpa_plan',
  opts: { durasiBulan?: number | null; tenor?: { bulan: number; harga: string }[] } = {},
) {
  await sql`insert into master_services (id, created_by) values (${id}, ${ADMIN})
            on conflict (id) do nothing`;
  await sql`insert into master_service_versions
    (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, plan_tier, durasi_bulan, created_by)
    values (${id}, 1, ${'Svc ' + id}, ${price}, '10% of standard price', true, '2020-01-01', 'flat', ${planTier},
            ${opts.durasiBulan ?? null}, ${ADMIN})
    on conflict do nothing`;
  // FS-6 opsi tenor: dipasang langsung supaya pemilih tenor di kalkulator /
  // Form Qualified punya sesuatu untuk dipilih tanpa perlu melewati layar MSL.
  if (opts.tenor && opts.tenor.length > 0) {
    const ver = await sql<{ id: string }[]>`
      select id from master_service_versions where service_id = ${id} and version_no = 1`;
    for (const t of opts.tenor) {
      await sql`insert into master_service_duration_options (version_id, durasi_bulan, harga, created_by)
                values (${ver[0].id}, ${t.bulan}, ${t.harga}, ${ADMIN})
                on conflict do nothing`;
    }
  }
}

async function main() {
  console.error('== B2 tour fixture: building one worked example ==');
  const budi = { employeeId: SALES, divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }) };
  const dewi = { employeeId: SALES_LAIN, divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'lead' }) };

  await seedService('SVC-B2TOUR-1', '9000000.00', 'ditentukan_am');
  await seedService('SVC-B2TOUR-2', '6000000.00');
  await seedService('SVC-B2TOUR-3', '5000000.00');

  const reg = await leads.register(sql, budi, { leadName: 'Tur Browser Demo', phoneNumber: phone() });
  await markContacted(sql, budi, reg.attempt.id);
  await submitQualifiedForm(sql, budi, reg.attempt.id, {
    namaPic: 'Bu Demo', toko: 'Tur Browser Demo Store', kota: 'Jakarta', linkToko: 'https://shopee/tur-demo',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '50000000', targetGmv: '80000000',
    services: [
      { masterServiceId: 'SVC-B2TOUR-1', quantity: 1 },
      { masterServiceId: 'SVC-B2TOUR-2', quantity: 1 },
      { masterServiceId: 'SVC-B2TOUR-3', quantity: 1 },
    ],
  });
  await submitNegotiation(sql, budi, reg.attempt.id, [], true);
  const closed = await close(sql, budi, reg.attempt.id, {
    parties: { primarySalespersonId: SALES, allocations: [{ salespersonId: SALES, basisPoints: 10000 }] },
    paymentScheme: PAYMENT_SCHEME_TERMIN,
    installments: [{ amount: '10000000', dueDate: '2026-07-01' }, { amount: '10000000', dueDate: '2026-12-01' }],
  });
  const clientId = closed.clientId;
  const trxId = closed.transactionId;
  console.error('client:', clientId, 'transaction:', trxId);

  const inst = await sql<{ id: string; installment_no: number }[]>`
    select id, installment_no from installments where transaction_id = ${trxId} order by installment_no`;

  // Verify #1, attach contract, verify #2 -> [Lunas]. For /finance + /finance/transactions/{id}.
  await verifyPayment(sql, director(), {
    transactionId: trxId, installmentId: inst[0].id, amount: '10000000',
    receivedDate: '2026-07-23', proofOfPayment: 'https://drive/proof-b2tour',
  });
  await attachContract(sql, director(), trxId, 'https://drive/contract-b2tour');
  await verifyPayment(sql, director(), {
    transactionId: trxId, installmentId: inst[1].id, amount: '10000000', receivedDate: '2026-07-24',
  });
  console.error('transaction verified [Lunas]');

  const svcRows = await sql<{ id: string }[]>`
    select id from services where client_id = ${clientId} order by id`;
  const [svc1, svc2, svc3] = svcRows.map((r) => r.id);

  // svc2/svc3 opt out of the Strategy gate so Brief creation does not need a
  // full Strategi workflow; svc1 keeps its gate (plan_tier='ditentukan_am' set
  // above) so we can build a real STRG- for /account/strategi/{id}.
  await setStrategyRequirement(sql, director(), svc2, false, 'Tur browser B2 — tidak butuh Strategi');
  await setStrategyRequirement(sql, director(), svc3, false, 'Tur browser B2 — tidak butuh Strategi');

  // --- Strategi (STRG-) for svc1 — /account/strategi/{id} --------------------
  // NOT /account/strategies/{id} — that path is the RETIRED `STR-` (legacy)
  // read-only notice (docs/DECISIONS.md "STRG- KANONIK DIKETOK", 2026-09-08);
  // it will show "[Strategy & Plan tidak ditemukan]" for a STRG- id, which
  // looks like a bug and is not one.
  const strategi_ = await createStrategi(sql, director(), svc1, {
    durasiKontrakBulan: 6,
    tanggalMulaiKontrak: '2026-07-01',
    tanggalAkhirKontrak: '2026-12-31',
  });
  console.error('strategi:', strategi_.id);

  // --- Brief #1 — Creative, WITH children (Assets) ---------------------------
  const briefCreative = await createBrief(sql, director(), svc2, {
    title: 'Konten Feed Bulanan', assignedDivision: 'Creative', deliverableType: 'Video',
    quantityTarget: 12, dueDate: '2026-10-15', priority: 'High',
  });
  console.error('brief (Creative, split):', briefCreative.id);
  for (let i = 0; i < 3; i++) {
    await createAsset(sql, director(), briefCreative.id, { sequenceNo: i + 1 });
  }

  // --- Brief #2 — Creative, WITHOUT children ("belum dipecah" badge) ---------
  const briefUnsplit = await createBrief(sql, director(), svc2, {
    title: 'Desain Banner Promo Akhir Tahun', assignedDivision: 'Creative', deliverableType: 'Desain',
    quantityTarget: 4, dueDate: '2026-11-01', priority: 'Medium',
  });
  console.error('brief (Creative, unsplit):', briefUnsplit.id);

  // --- Brief #3 — KOL, with a Booking -> Payment Request ----------------------
  const briefKol = await createBrief(sql, director(), svc3, {
    title: 'Endorse Produk Baru', assignedDivision: 'KOL', deliverableType: 'Konten KOL',
    quantityTarget: 2, dueDate: '2026-10-20', priority: 'High',
  });
  console.error('brief (KOL):', briefKol.id);
  const booking = await createBooking(sql, director(), briefKol.id, {
    creatorName: 'Kreator Demo', platform: 'TikTok', sourcePool: 'MCN MEA Roster',
    agreedRate: '2000000',
  });
  await book(sql, director(), booking.id);
  await startContent(sql, director(), booking.id);
  await submitContent(sql, director(), booking.id, 'https://drive/konten-b2tour');
  await sendToQCReview(sql, director(), booking.id);
  await passQC(sql, director(), booking.id);
  const paymentRequest = await createPaymentRequest(sql, director(), booking.id, '2000000', 'BCA 1234567890 a.n. Kreator Demo');
  console.error('creator booking:', booking.id, 'payment request:', paymentRequest.id);

  // --- Brief #4 — Store Operation, with SKU rows ------------------------------
  // svc3, not svc1 — svc1's Strategi is only [Draft] here (never approved),
  // and Store Operation's Brief needs a service whose Strategy gate is
  // already satisfied (Aktif or opted out), same rule as briefKol above.
  const briefStoreOps = await createBrief(sql, director(), svc3, {
    title: 'Optimasi Listing SKU Unggulan', assignedDivision: 'Store Operation', deliverableType: 'Optimasi SKU',
    quantityTarget: 5, dueDate: '2026-10-25', priority: 'High',
  });
  console.error('brief (Store Operation):', briefStoreOps.id);
  const skuIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const sku = await createSku(sql, director(), briefStoreOps.id, {
      namaProduk: `Produk Unggulan #${i + 1}`,
      requestType: 'Shopee New',
      jenisGambar: 'Cover Only',
      totalReqPicture: 5,
      expectedDone: '2026-10-30',
      targetCtr: 3.5,
      targetCvr: 1.2,
      targetRating: 4.5,
    });
    skuIds.push(sku.id);
  }
  console.error('sku rows:', skuIds.join(', '));

  // ==========================================================================
  // TIGA FIXTURE TAMBAHAN — membuka butir UAT yang sebelumnya TIDAK BISA diuji
  // (`UAT_SALES_BROWSER_20260910.md` §4). Ketiganya berdiri sendiri dan tidak
  // mengubah rantai utama di atas.
  // ==========================================================================

  // --- (A) PROSPEK BERSAMA (feedback Sales #3) ------------------------------
  // Lahir SENDIRI: sales kedua mendaftarkan nomor yang SAMA selagi attempt
  // pertama masih terbuka ⇒ `leads.register` memutuskan outcome 'join' dan
  // menautkan keduanya (`bersama_dengan_attempt_id`). Karena itu lead ini
  // sengaja TIDAK ditutup — menutupnya menghapus justru yang mau dilihat.
  const teleponBersama = phone();
  const bersamaA = await leads.register(sql, budi, { leadName: 'Tur Prospek Bersama', phoneNumber: teleponBersama });
  const bersamaB = await leads.register(sql, dewi, { leadName: 'Tur Prospek Bersama', phoneNumber: teleponBersama });
  console.error('prospek bersama:', bersamaA.attempt.id, '<->', bersamaB.attempt.id);

  // --- (B) KLIEN TANPA KONTRAK (FS-5b) --------------------------------------
  // `sales.deriveDuration` TIDAK mencetak kontrak bila seluruh layanan yang
  // ditutup berdurasi NULL. Klien ini membuktikan cabang teks eksplisit di
  // kolom Durasi Kontrak — cabang yang tidak bisa dilihat selama satu-satunya
  // klien di DB punya kontrak.
  await seedService('SVC-B2TOUR-SEKALI', '4000000.00');   // nol durasi_bulan
  const regTanpa = await leads.register(sql, budi, { leadName: 'Tur Tanpa Kontrak', phoneNumber: phone() });
  await markContacted(sql, budi, regTanpa.attempt.id);
  await submitQualifiedForm(sql, budi, regTanpa.attempt.id, {
    namaPic: 'Bu Sekali', toko: 'Tur Tanpa Kontrak Store', kota: 'Bandung', linkToko: 'https://shopee/tur-sekali',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '10000000', targetGmv: '15000000',
    services: [{ masterServiceId: 'SVC-B2TOUR-SEKALI', quantity: 1 }],
  });
  await submitNegotiation(sql, budi, regTanpa.attempt.id, [], true);
  const closedTanpa = await close(sql, budi, regTanpa.attempt.id, {
    parties: { primarySalespersonId: SALES, allocations: [{ salespersonId: SALES, basisPoints: 10000 }] },
    paymentScheme: PAYMENT_SCHEME_TERMIN,
    installments: [{ amount: '4000000', dueDate: '2026-08-01' }],
  });
  console.error('klien tanpa kontrak:', closedTanpa.clientId);

  // --- (C) ATTEMPT DI TAHAP QUALIFIED, ber-TENOR (FS-6b) --------------------
  // Ditinggal DI Qualified dengan sengaja: begitu ia dinegosiasikan dan
  // ditutup, Form Qualified-nya tidak bisa disunting lagi dan pemilih tenornya
  // hilang — persis yang membuat butir ini tidak teruji sebelumnya.
  await seedService('SVC-B2TOUR-TENOR', '3000000.00', 'tanpa_plan', {
    durasiBulan: 1,
    tenor: [{ bulan: 1, harga: '3000000.00' }, { bulan: 6, harga: '15000000.00' }],
  });
  const regTenor = await leads.register(sql, budi, { leadName: 'Tur Tenor Qualified', phoneNumber: phone() });
  await markContacted(sql, budi, regTenor.attempt.id);
  await submitQualifiedForm(sql, budi, regTenor.attempt.id, {
    namaPic: 'Bu Tenor', toko: 'Tur Tenor Store', kota: 'Surabaya', linkToko: 'https://shopee/tur-tenor',
    kategori: 'Fashion', platform: 'Shopee', gmvBaseline: '20000000', targetGmv: '30000000',
    services: [{ masterServiceId: 'SVC-B2TOUR-TENOR', quantity: 1, durasiBulan: 6 }],
  });
  console.error('attempt Qualified ber-tenor:', regTenor.attempt.id);

  console.error('\n== DONE — JSON on stdout ==');
  console.log(JSON.stringify({
    clientId, trxId, prospectAttemptId: reg.attempt.id,
    svc1, svc2, svc3,
    strategiId: strategi_.id,
    briefCreative: briefCreative.id, briefUnsplit: briefUnsplit.id,
    briefKol: briefKol.id, bookingId: booking.id, paymentRequestId: paymentRequest.id,
    briefStoreOps: briefStoreOps.id, skuIds,
    // Tiga fixture tambahan (UAT_SALES_BROWSER_20260910.md §4).
    bersamaAttemptA: bersamaA.attempt.id, bersamaAttemptB: bersamaB.attempt.id,
    clientTanpaKontrak: closedTanpa.clientId,
    attemptQualifiedTenor: regTenor.attempt.id,
  }, null, 2));
}

main()
  .catch((e) => { console.error('FAILED:', e); process.exitCode = 1; })
  .finally(() => sql.end());
