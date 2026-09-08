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
async function seedService(id: string, price: string, planTier: string = 'tanpa_plan') {
  await sql`insert into master_services (id, created_by) values (${id}, 'B2TOUR-ADMIN')
            on conflict (id) do nothing`;
  await sql`insert into master_service_versions
    (service_id, version_no, name, standard_price, commission_rule, active, effective_from, pricing_mode, plan_tier, created_by)
    values (${id}, 1, ${'Svc ' + id}, ${price}, '10% of standard price', true, '2020-01-01', 'flat', ${planTier}, 'B2TOUR-ADMIN')
    on conflict do nothing`;
}

async function main() {
  console.error('== B2 tour fixture: building one worked example ==');
  const budi = { employeeId: 'B2TOUR-BUDI', divisi: 'Sales', role: permission.makeRole({ division: 'Sales', level: 'staff' }) };

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
    parties: { primarySalespersonId: 'B2TOUR-BUDI', allocations: [{ salespersonId: 'B2TOUR-BUDI', basisPoints: 10000 }] },
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

  console.error('\n== DONE — JSON on stdout ==');
  console.log(JSON.stringify({
    clientId, trxId, prospectAttemptId: reg.attempt.id,
    svc1, svc2, svc3,
    strategiId: strategi_.id,
    briefCreative: briefCreative.id, briefUnsplit: briefUnsplit.id,
    briefKol: briefKol.id, bookingId: booking.id, paymentRequestId: paymentRequest.id,
    briefStoreOps: briefStoreOps.id, skuIds,
  }, null, 2));
}

main()
  .catch((e) => { console.error('FAILED:', e); process.exitCode = 1; })
  .finally(() => sql.end());
