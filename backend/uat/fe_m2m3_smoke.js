// Smoke test FE↔BE M2 (Marketing Performance) + M3 (Campaign) — pola
// FE_UAT_RUNBOOK / fe_m0m1_smoke.js (login riil, klik UI sungguhan).
// Jalankan: node fe_m2m3_smoke.js  (stack UAT harus hidup: cdps :8080, next :3000)
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:3000';
const PASS = 'rahasia123';
const RUN = Date.now().toString().slice(-7); // suffix unik per run
const PHONE_LEAD = `0815${RUN}4`; // lead #1 — jalur closing (real lead)
const PHONE_JUNK = `0816${RUN}5`; // lead #2 — jalur NQ (junk)
const PHONE_BLOK = `0817${RUN}6`; // lead #3 — ditolak gate campaign Closed

const ACTORS = {
  mkStaff: 'INSANFR17@GMAIL.COM', // SEO CONTENT WRITER -> Marketing staff (owner)
  mkStaffB: 'arivlokananta@gmail.com', // PUBLIC RELATION -> Marketing staff (non-owner)
  mkLead: 'uat.marketing1@cdps.local', // Marketing lead (fixture O34)
  salesA: 'faesalabdul900@gmail.com', // SALES JASA -> Sales staff
  od: 'ORENDY9@GMAIL.COM', // OD layered riil
};
const MKSTAFF_ID = '2411250460'; // INSAN
const MKSTAFFB_ID = '2411250461'; // TRI

const results = [];
let failures = 0;
function check(step, ok, detail = '') {
  results.push({ step, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${step}${detail ? ' | ' + detail : ''}`);
}

const badResponses = [];
const consoleErrors = [];
// allowProbe: dinyalakan saat langkah sengaja menembak endpoint yang gate
// server-nya PASTI menolak (probe negatif) — 403/404 di jendela itu by design.
let allowProbe = false;
function expectedBad(url, status) {
  if (status === 401 && url.includes('/api/v1/me')) return true; // anonim di /login (by design)
  // 404 GET performance = record belum ada (FE render form create — by design M2)
  if (status === 404 && /\/marketing\/campaigns\/[^/]+\/performance$/.test(url)) return true;
  if (allowProbe && (status === 403 || status === 404)) return true;
  return false;
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' }); // tunggu hidrasi React
  await page.fill('#email', email);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

async function logout(ctx) {
  await ctx.clearCookies();
}

// Nilai stat di kartu grid2: label .muted lalu sibling value — regex atas innerText.
function statValue(sectionText, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n\\s*([^\\n]+)');
  const m = sectionText.match(re);
  return m ? m[1].trim() : null;
}

// Baris tabel Auto-Metrics: <td>Label</td><td>value</td>.
async function metricRow(page, label) {
  const row = page.locator('tr', { hasText: label }).first();
  const cells = await row.locator('td').allInnerTexts();
  return (cells[1] || '').trim();
}

async function importSingle(page, name, phone, campaignId) {
  await page.goto(`${BASE}/leads`);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.fill('#single-name', name);
  await page.fill('#single-phone', phone);
  if (campaignId) await page.fill('#single-campaign', campaignId);
  await page.getByRole('button', { name: 'Import', exact: true }).nth(1).click();
  await page.waitForSelector('.alert.alertInfo');
  return (await page.locator('.alert.alertInfo').first().innerText()).trim();
}

// Klaim lead dari Pool oleh Sales; kembalikan PRSP dari pesan sukses.
async function claimFromPool(page, leadName) {
  await page.goto(`${BASE}/leads`);
  await page.getByRole('button', { name: 'Pool', exact: true }).click();
  const row = page.locator('tr', { hasText: leadName });
  await row.waitFor();
  await row.getByRole('button', { name: 'Claim' }).click();
  await page.waitForSelector('.alert.alertSuccess');
  const msg = await page.locator('.alert.alertSuccess').innerText();
  const m = msg.match(/PRSP-\d{6}-\d{4}/);
  return m ? m[0] : null;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !expectedBad(r.url(), r.status())) {
      badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
  page.setDefaultTimeout(15000);

  let cmp = null;

  try {
    // ── S1. Marketing staff (owner): create campaign Draft + performance record ──
    await login(page, ACTORS.mkStaff);
    check('S1a login Marketing staff (owner)', true);
    await page.goto(`${BASE}/marketing`);
    await page.fill('#create-name', `Smoke CMP ${RUN}`);
    await page.fill('#create-channel', 'TikTok Ads');
    await page.check('#create-online');
    await page.fill('#create-start', '2026-07-19');
    await page.getByRole('button', { name: 'Buat Campaign' }).click();
    await page.waitForURL(/\/marketing\/CMP-\d{6}-\d{4}$/);
    cmp = page.url().match(/CMP-\d{6}-\d{4}/)[0];
    check('S1b create campaign → redirect detail + ID CMP', true, cmp);
    await page.locator('span.badge', { hasText: 'Draft' }).first().waitFor();
    check('S1c status lahir Draft (badge, tanpa bracket)', true);
    await page.getByRole('button', { name: 'Ubah ke Active' }).waitFor();
    check('S1d owner staff lihat tombol transisi edge sah (Draft→Active saja)',
      !(await page.getByRole('button', { name: 'Ubah ke Paused' }).count()));
    check('S1e staff owner TIDAK lihat form Reassign (lead/Director saja)',
      !(await page.locator('#reassign-target').count()));

    // Performance record (budget = satu-satunya field yang bisa ditulis)
    await page.fill('#create-budget', '10000000');
    await page.getByRole('button', { name: 'Buat Performance Record' }).click();
    await page.waitForSelector('text=Rp. 10.000.000,00');
    check('S1f create record → budget IDR verbatim', true, 'Rp. 10.000.000,00');
    const cplAwal = await metricRow(page, 'Cost per Lead');
    check('S1g Auto-Metrics render; CPL "—" saat 0 lead (div-0 bukan error)', cplAwal === '—', cplAwal);

    // ── S2. Import lead di bawah campaign DRAFT → auto-activate (O13) + Source auto ──
    const s2sum = await importSingle(page, `Smoke CMP Lead ${RUN}`, PHONE_LEAD, cmp);
    check('S2a import single ber-campaign → summary verbatim',
      s2sum === '[1 lead berhasil diimport, 0 ditolak (duplikat/data tidak lengkap)]', s2sum);
    await page.goto(`${BASE}/marketing/${cmp}`);
    await page.locator('span.badge', { hasText: 'Active' }).first().waitFor();
    check('S2b campaign Draft AUTO-ACTIVE karena intake (O13)', true);
    // Source auto-derive dari Channel (TikTok Ads → Leads - Iklan), campaign menang
    await page.goto(`${BASE}/leads`);
    await page.getByRole('button', { name: 'Database', exact: true }).click();
    await page.fill('#db-q', `Smoke CMP Lead ${RUN}`);
    await page.getByRole('button', { name: 'Terapkan' }).click();
    const dbRow = page.locator('tbody tr', { hasText: `Smoke CMP Lead ${RUN}` }).first();
    await dbRow.waitFor();
    const dbRowText = await dbRow.innerText();
    check('S2c Source auto-derive Channel→"Leads - Iklan" + kolom Campaign terisi',
      dbRowText.includes('Leads - Iklan') && dbRowText.includes(cmp), dbRowText.replace(/\s+/g, ' '));
    await logout(ctx);

    // ── S3. Sales: claim → Qualified → No-Nego (Auto Approved) → Closing (atribusi) ──
    await login(page, ACTORS.salesA);
    const prsp = await claimFromPool(page, `Smoke CMP Lead ${RUN}`);
    check('S3a claim lead campaign dari Pool → PRSP', Boolean(prsp), prsp || '');
    await page.goto(`${BASE}/sales/${prsp}`);
    await page.getByRole('button', { name: 'Tandai Contacted' }).click();
    await page.waitForSelector('text=Qualified Lead Form');
    await page.fill('#q-namapic', 'Bu Smoke M2M3');
    await page.fill('#q-toko', `Toko CMP ${RUN}`);
    await page.fill('#q-kota', 'Jakarta');
    await page.fill('#q-kategori', 'Kecantikan');
    await page.fill('#q-linktoko', 'https://toko.example/cmp-smoke');
    await page.getByText('Shopee', { exact: true }).click();
    await page.fill('#q-gmv', '40000000');
    await page.fill('#q-targetgmv', '90000000');
    const svcSelect = page.locator('table select').first();
    await svcSelect.selectOption({ index: 1 });
    const nominal = page.locator('input[placeholder="Nominal (Rp)"]');
    if (await nominal.count()) {
      await nominal.fill('12000000');
    } else {
      await page.locator('input[placeholder="Quantity"]').fill('1');
    }
    await page.waitForFunction(() => {
      const els = Array.from(document.querySelectorAll('div'));
      const label = els.find((e) => e.textContent === 'Estimasi Nilai Transaksi');
      return label && label.nextElementSibling && label.nextElementSibling.textContent.startsWith('Rp');
    }, { timeout: 15000 });
    await page.getByRole('button', { name: 'Submit Qualified Form' }).click();
    await page.waitForSelector('text=Negosiasi');
    check('S3b Qualified tercatat (real lead) → panel Negosiasi', true);
    await page.getByRole('button', { name: 'No Negotiation Required' }).click();
    await page.waitForSelector('text=Closing Form');
    check('S3c No-Nego → Auto Approved → Closing Form', true);
    await page.selectOption('#close-scheme', '[Bayar Penuh (Lunas)]');
    await page.getByRole('button', { name: 'Submit Closing' }).click();
    // alert sukses lama ("Attempt ditandai Contacted.") masih terpampang — tunggu
    // spesifik hasil closing (section persisten di luar gate status).
    await page.waitForSelector('text=Closing berhasil');
    const closeMsg = (await page.locator('.alert.alertSuccess', { hasText: 'Closing berhasil' }).innerText()).trim();
    check('S3d closing sukses → CLI + TRX (clients_won utk rollup)',
      /Client ID: CLI-\d{6}-\d{4}/.test(closeMsg) && /Transaction ID: TRX-\d{6}-\d{4}/.test(closeMsg), closeMsg);
    await page.waitForLoadState('networkidle'); // biarkan refetch pasca-closing selesai sebelum cookie dibuang
    await logout(ctx);

    // ── S4. Lead junk: import #2 → claim → Not Qualified [Tidak ada respon] ──
    await login(page, ACTORS.mkStaff);
    const s4sum = await importSingle(page, `Smoke CMP Junk ${RUN}`, PHONE_JUNK, cmp);
    check('S4a import lead #2 ber-campaign', s4sum.startsWith('[1 lead berhasil diimport'), s4sum);
    await logout(ctx);
    await login(page, ACTORS.salesA);
    const prspJunk = await claimFromPool(page, `Smoke CMP Junk ${RUN}`);
    await page.goto(`${BASE}/sales/${prspJunk}`);
    await page.getByRole('button', { name: 'Tandai Contacted' }).click();
    await page.waitForSelector('text=Qualified Lead Form');
    await page.getByText('[Tidak ada respon]', { exact: true }).click();
    await page.getByRole('button', { name: 'Tandai Not Qualified' }).click();
    await page.waitForSelector('text=Alasan Not Qualified');
    check('S4b lead #2 Not Qualified (taksonomi M1-OA-8) → junk M2', true);
    await logout(ctx);

    // ── S5. Owner: rollup + auto-metrics turunan log + edit budget ──
    await login(page, ACTORS.mkStaff);
    await page.goto(`${BASE}/marketing/${cmp}`);
    await page.waitForSelector('text=Rollup Funnel');
    // metrics dihitung on-read; tunggu funnel mencerminkan 2 lead
    await page.waitForFunction(() => {
      const sec = Array.from(document.querySelectorAll('section')).find((s) =>
        s.textContent.includes('Rollup Funnel'));
      return sec && /Leads Generated\s*2/.test(sec.innerText.replace(/\n/g, ' '));
    }, { timeout: 15000 });
    const rollupText = await page.locator('section', { hasText: 'Rollup Funnel' }).first().innerText();
    check('S5a rollup: Leads Generated = 2', statValue(rollupText, 'Leads Generated') === '2',
      statValue(rollupText, 'Leads Generated') || '');
    check('S5b rollup: Real Leads = 1 (hanya yang ≥ Qualified)', statValue(rollupText, 'Real Leads') === '1',
      statValue(rollupText, 'Real Leads') || '');
    check('S5c rollup: Clients Won = 1', statValue(rollupText, 'Clients Won') === '1',
      statValue(rollupText, 'Clients Won') || '');
    const totalWon = statValue(rollupText, 'Total Value Won') || '';
    check('S5d rollup: Total Value Won IDR verbatim (bukan "—")', totalWon.startsWith('Rp. '), totalWon);

    const quality = await metricRow(page, 'Lead-Quality Rate');
    check('S5e metrics: Lead-Quality Rate 50% (1 real / 2 dashboard)', quality === '50%', quality);
    const cpl = await metricRow(page, 'Cost per Lead');
    check('S5f metrics: CPL = Rp. 5.000.000,00 (10jt/2, IDR verbatim)', cpl === 'Rp. 5.000.000,00', cpl);
    const cprl = await metricRow(page, 'Cost per Real Lead');
    check('S5g metrics: CPRL = Rp. 10.000.000,00 (10jt/1)', cprl === 'Rp. 10.000.000,00', cprl);
    const roas = await metricRow(page, 'ROAS');
    check('S5h metrics: ROAS numerik (bukan "—", render verbatim server)', /^\d+\.\d{2}$/.test(roas), roas);
    const junkRow = page.locator('section', { hasText: 'Junk Breakdown' }).locator('tr', { hasText: '[Tidak ada respon]' });
    await junkRow.first().waitFor();
    const junkCells = await junkRow.first().locator('td').allInnerTexts();
    check('S5i junk breakdown: [Tidak ada respon] × 1 (label verbatim)', junkCells[1].trim() === '1',
      junkCells.join('|'));

    // Edit budget (owner) → metrik ikut (CPL 20jt/2 = 10jt)
    await page.fill('#edit-budget', '20000000');
    await page.getByRole('button', { name: 'Simpan Budget' }).click();
    await page.waitForSelector('text=Rp. 20.000.000,00');
    const cplAfter = await metricRow(page, 'Cost per Lead');
    check('S5j edit budget owner → CPL recompute Rp. 10.000.000,00', cplAfter === 'Rp. 10.000.000,00', cplAfter);
    await logout(ctx);

    // ── S6. Gating role: staff non-owner / lead / OD ──
    await login(page, ACTORS.mkStaffB);
    await page.goto(`${BASE}/marketing`);
    await page.waitForSelector('text=Daftar Campaign');
    await page.waitForFunction(() => !document.body.innerText.includes('Memuat...'));
    const listB = await page.innerText('body');
    check('S6a staff non-owner: campaign TIDAK muncul di list (server filter)', !listB.includes(cmp));
    await page.goto(`${BASE}/marketing/performance`);
    await page.waitForSelector('text=Performa Marketing');
    await page.waitForFunction(() => !document.body.innerText.includes('Memuat...'));
    const dashB = await page.innerText('body');
    check('S6b staff non-owner: dashboard tanpa campaign orang lain', !dashB.includes(cmp));
    allowProbe = true; // probe negatif: detail campaign orang lain — gate server pasti menolak
    await page.goto(`${BASE}/marketing/${cmp}`);
    await page.waitForSelector('.alert.alertError');
    const errB = (await page.locator('.alert.alertError').first().innerText()).trim();
    check('S6c staff non-owner buka detail → ditolak, pesan BI verbatim',
      errB === '[anda tidak memiliki akses ke data ini]' || errB === '[data tidak ditemukan]', errB);
    allowProbe = false;
    await logout(ctx);

    await login(page, ACTORS.mkLead);
    await page.goto(`${BASE}/marketing/${cmp}`);
    await page.waitForSelector('text=Info Campaign');
    await page.getByRole('button', { name: 'Ubah ke Closed' }).waitFor();
    check('S6d lead non-owner: tombol transisi ADA (division-wide)', true);
    check('S6e lead non-owner: form budget TIDAK ada (monitor, not edit — M2 §5 R3)',
      !(await page.locator('#edit-budget').count()) && !(await page.locator('#create-budget').count()));
    check('S6f lead: form Reassign ADA (M3-OA-6)', (await page.locator('#reassign-target').count()) === 1);
    await logout(ctx);

    await login(page, ACTORS.od);
    await page.goto(`${BASE}/marketing/${cmp}`);
    await page.waitForSelector('text=Info Campaign');
    const odBody = await page.innerText('body');
    check('S6g OD layered: detail + metrik terbaca (CanReadAll)', odBody.includes('Auto-Metrics'));
    check('S6h OD layered: read-only murni (tanpa transisi/reassign/budget)',
      !odBody.includes('Ubah ke ') &&
        !(await page.locator('#reassign-target').count()) &&
        !(await page.locator('#edit-budget').count()));
    await logout(ctx);

    // ── S7. Reassign (lead): negatif lalu positif dua arah ──
    await login(page, ACTORS.mkLead);
    await page.goto(`${BASE}/marketing/${cmp}`);
    await page.waitForSelector('#reassign-target');
    allowProbe = true; // target fiktif — server pasti menolak
    await page.fill('#reassign-target', 'EMP-TIDAKADA');
    await page.getByRole('button', { name: 'Reassign', exact: true }).click();
    await page.waitForSelector('.alert.alertError');
    const reErr = (await page.locator('.alert.alertError').first().innerText()).trim();
    check('S7a reassign target fiktif → pesan BI verbatim', reErr === '[data tidak ditemukan]', reErr);
    allowProbe = false;
    await page.fill('#reassign-target', MKSTAFFB_ID);
    await page.getByRole('button', { name: 'Reassign', exact: true }).click();
    await page.waitForFunction(
      (id) => document.body.innerText.includes(id), MKSTAFFB_ID, { timeout: 15000 });
    check('S7b reassign ke Marketing staff aktif → Owner berganti', true, MKSTAFFB_ID);
    await page.fill('#reassign-target', MKSTAFF_ID);
    await page.getByRole('button', { name: 'Reassign', exact: true }).click();
    await page.waitForFunction(
      (id) => document.body.innerText.includes(id), MKSTAFF_ID, { timeout: 15000 });
    check('S7c reassign balik ke owner awal', true, MKSTAFF_ID);

    // ── S8. Lead: Active→Closed (end_date server-stamp) ──
    await page.getByRole('button', { name: 'Ubah ke Closed' }).click();
    await page.locator('span.badge', { hasText: 'Closed' }).first().waitFor();
    check('S8a transisi Active→Closed oleh lead (division-wide)', true);
    const infoText = await page.locator('section', { hasText: 'Info Campaign' }).first().innerText();
    const tglSelesai = statValue(infoText, 'Tanggal Selesai') || '';
    check('S8b end_date di-stamp server saat Closed (bukan "—")', /\d/.test(tglSelesai), tglSelesai);
    await page.getByRole('button', { name: 'Ubah ke Archived' }).waitFor();
    check('S8c edge tersisa hanya Closed→Archived', !(await page.getByRole('button', { name: 'Ubah ke Active' }).count()));
    await logout(ctx);

    // ── S9. Gate intake campaign Closed + dashboard join (lead) ──
    await login(page, ACTORS.mkStaff);
    const s9sum = await importSingle(page, `Smoke CMP Blok ${RUN}`, PHONE_BLOK, cmp);
    check('S9a import di campaign Closed → summary 0 import 1 tolak',
      s9sum === '[0 lead berhasil diimport, 1 ditolak (duplikat/data tidak lengkap)]', s9sum);
    const s9body = await page.innerText('body');
    check('S9b alasan tolak verbatim gate O13',
      s9body.includes('[campaign belum/tidak aktif, lead tidak bisa diimport]'));
    await logout(ctx);

    await login(page, ACTORS.mkLead);
    await page.goto(`${BASE}/marketing/performance`);
    const dashRow = page.locator('tr', { hasText: cmp });
    await dashRow.first().waitFor();
    const dashText = (await dashRow.first().innerText()).replace(/\s+/g, ' ');
    check('S9c dashboard join client-side: nama + status + budget + quality',
      dashText.includes(`Smoke CMP ${RUN}`) &&
        dashText.includes('Closed') &&
        dashText.includes('Rp. 20.000.000,00') &&
        dashText.includes('50%'),
      dashText);
  } catch (err) {
    check('UNCAUGHT', false, String(err).slice(0, 300));
    try {
      await page.screenshot({ path: __dirname + '/smoke_m2m3_fail.png', fullPage: true });
      console.log('screenshot: smoke_m2m3_fail.png @ url ' + page.url());
    } catch {}
  } finally {
    await browser.close();
  }

  console.log('\n== Ringkasan ==');
  console.log(`PASS=${results.filter((r) => r.ok).length} FAIL=${failures}`);
  if (badResponses.length) console.log('HTTP>=400 tak terduga:\n' + badResponses.join('\n'));
  if (consoleErrors.length) console.log('Console errors:\n' + consoleErrors.slice(0, 10).join('\n'));
  process.exit(failures || badResponses.length ? 1 : 0);
})();
