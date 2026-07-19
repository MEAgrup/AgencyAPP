// Smoke test FE↔BE hidup M2/M3 — alur runbook FE_UAT_RUNBOOK.md, blok Marketing.
// create campaign → Active → (lead M1 via API) → performance record → metrics →
// dashboard → Closed → rollup, sebagai Marketing staff; lalu cek gate Marketing lead.
//
// Prasyarat: stack UAT hidup (boot order import_samples/README.md §UAT, w2/w3_walk
// PASS) + `npm run dev` di web-internal. Jalankan:
//   npm i playwright   # sekali, di folder kerja mana pun (bukan dep app)
//   [PW_CHROMIUM=/opt/pw-browsers/chromium] node uat/m2m3_smoke.js [suffix-unik]
// Laporan eksekusi: docs/handoff/FE_SMOKE_REPORT_20260719_M2M3.md.
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:3000';
const STAFF = { email: 'arivlokananta@gmail.com', pass: 'rahasia123', id: '2411250461' };
const LEAD = { email: 'uat.marketing1@cdps.local', pass: 'rahasia123', id: 'UATMKT0001' };
const UQ = process.argv[2] || String(Math.floor(Date.now() / 1000) % 1000000);

const results = [];
function step(name, ok, note) {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' :: ' + note : ''}`);
}

(async () => {
  // PW_CHROMIUM: path chromium bila versi playwright ≠ browser terpasang
  // (container remote: /opt/pw-browsers/chromium). Kosongkan utk default.
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  );
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Collect console errors + unexpected 4xx/5xx (whitelist per runbook §D).
  const consoleErrors = [];
  const badResponses = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push({ status: r.status(), url: r.url() });
  });

  async function login(email, pass) {
    await ctx.clearCookies();
    await page.goto(`${BASE}/login`);
    await page.fill('#email', email);
    await page.fill('#password', pass);
    await page.click('button[type=submit]');
    await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  }

  // ---- A. Login negatif dulu (password salah) ----
  await page.goto(`${BASE}/login`);
  await page.fill('#email', STAFF.email);
  await page.fill('#password', 'salahsandi');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => {
    const a = document.querySelector('[role=alert]');
    return a && a.textContent.trim().length > 0;
  }, { timeout: 10000 });
  const errText = (await page.locator('[role=alert]').first().textContent()) || '';
  step('A6 login password salah -> alert BI, tetap di /login',
    page.url().includes('/login') && errText.includes('[') && errText.includes(']'),
    errText.trim());

  // ---- Login staff Marketing ----
  await login(STAFF.email, STAFF.pass);
  step('Login Marketing staff (ariv)', true, page.url());

  // ---- /marketing render + form create ----
  await page.goto(`${BASE}/marketing`);
  await page.waitForSelector('h1:has-text("Marketing — Campaign")');
  const hasCreate = await page.isVisible('#create-name');
  step('/marketing render + form Buat Campaign utk staff', hasCreate);

  // ---- Negatif: tanpa online/offline -> pesan BI verbatim ----
  await page.fill('#create-name', `Smoke FE ${UQ}`);
  await page.fill('#create-channel', 'TikTok Ads');
  await page.fill('#create-start', '2026-07-01');
  await page.click('form button[type=submit]:has-text("Buat Campaign")');
  const incAlert = await page.waitForSelector('form [role=alert]', { timeout: 10000 });
  const incText = ((await incAlert.textContent()) || '').trim();
  step('create tanpa Online/Offline -> [data tidak lengkap...] verbatim',
    incText === '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]', incText);

  // ---- Create valid -> redirect detail, status Draft ----
  await page.check('#create-online');
  await page.click('form button[type=submit]:has-text("Buat Campaign")');
  await page.waitForURL(/\/marketing\/CMP-/, { timeout: 15000 });
  const cmpId = page.url().split('/').pop();
  await page.waitForSelector(`h1:has-text("${cmpId}")`);
  let badge = (await page.textContent('h1 ~ p >> xpath=../.. >> .badge')) || '';
  badge = ((await page.locator('.row .badge').first().textContent()) || '').trim();
  step('create valid -> CMP- detail, status Draft tanpa bracket', badge === 'Draft', `${cmpId} badge=${badge}`);

  // ---- Draft -> Active via tombol transisi ----
  await page.click('button:has-text("Ubah ke Active")');
  await page.waitForFunction(() => {
    const b = document.querySelector('.row .badge');
    return b && b.textContent.trim() === 'Active';
  }, { timeout: 15000 });
  step('transisi Draft -> Active via UI', true);

  // ---- Suntik 1 lead M1 via API (FE M1 belum ada; pakai session cookie) ----
  const bulkRes = await page.evaluate(async ({ cmp, uq }) => {
    const r = await fetch('/api/v1/leads/bulk', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: cmp, rows: [{ lead_name: `Smoke Lead ${uq}`, phone_number: `0899${uq}1` }] }),
    });
    return { status: r.status, body: await r.json() };
  }, { cmp: cmpId, uq: UQ });
  step('inject lead M1 via POST /leads/bulk (imported=1)',
    bulkRes.status === 200 && bulkRes.body.imported === 1, JSON.stringify(bulkRes.body).slice(0, 120));

  // ---- Performance record: create budget ----
  await page.fill('#create-budget', '5000000');
  await page.click('button:has-text("Buat Performance Record")');
  await page.waitForSelector('#edit-budget', { timeout: 15000 });
  const budgetShown = ((await page.locator('section:has(h2:has-text("Performance Record")) .grid2 > div').first().textContent()) || '');
  step('create performance record budget 5jt -> budget_idr render',
    budgetShown.includes('Rp. 5.000.000,00'), budgetShown.replace('Budget', '').trim());

  // ---- Auto-Metrics render, lead_by_dashboard = 1, ROAS "—" ----
  await page.waitForSelector('h2:has-text("Auto-Metrics")');
  const metricsRows = await page.locator('section:has(h2:has-text("Auto-Metrics")) table tr').allTextContents();
  const leadRow = metricsRows.find((t) => t.startsWith('Lead-by-Dashboard')) || '';
  const roasRow = metricsRows.find((t) => t.startsWith('ROAS')) || '';
  const cplRow = metricsRows.find((t) => t.startsWith('Cost per Lead')) || '';
  // ROAS = attributed_sales/budget: budget 5jt != 0 -> "0.00" (bukan div-0).
  // CPRL = budget/real_leads: real_leads 0 -> "—" (div-0 kontrak house rule #7).
  const cprlRow = metricsRows.find((t) => t.startsWith('Cost per Real Lead')) || '';
  step('Auto-Metrics: Lead-by-Dashboard=1, CPL IDR, ROAS "0.00", CPRL "—" (div-0)',
    leadRow.endsWith('1') && cplRow.includes('Rp. 5.000.000,00') && roasRow.replace('ROAS', '').trim() === '0.00' && cprlRow.includes('—'),
    `lead=${leadRow} cpl=${cplRow} roas=${roasRow} cprl=${cprlRow}`);

  // ---- Edit budget ----
  await page.fill('#edit-budget', '7500000');
  await page.click('button:has-text("Simpan Budget")');
  await page.waitForFunction(() => {
    const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent?.includes('Performance Record'));
    return sec && sec.textContent.includes('Rp. 7.500.000,00');
  }, { timeout: 15000 });
  step('edit budget -> Rp. 7.500.000,00 ter-refresh', true);

  // ---- Dashboard M2 ----
  await page.goto(`${BASE}/marketing/performance`);
  await page.waitForSelector('h1:has-text("Performa Marketing")');
  await page.waitForSelector('table');
  const rowText = ((await page.locator(`table tr:has-text("${cmpId}")`).textContent()) || '');
  step('dashboard: row join id+nama+status badge+budget',
    rowText.includes(`Smoke FE ${UQ}`) && rowText.includes('Active') && rowText.includes('Rp. 7.500.000,00'),
    rowText.slice(0, 160));

  // ---- Kembali ke detail: Active -> Closed; end_date stamped; rollup ----
  await page.goto(`${BASE}/marketing/${cmpId}`);
  await page.click('button:has-text("Ubah ke Closed")');
  await page.waitForFunction(() => {
    const b = document.querySelector('.row .badge');
    return b && b.textContent.trim() === 'Closed';
  }, { timeout: 15000 });
  const endDate = ((await page.locator('div:has(> div:text-is("Tanggal Selesai")) > div').nth(1).textContent()) || '').trim();
  const rollupSec = ((await page.locator('section:has(h2:has-text("Rollup Funnel"))').textContent()) || '');
  step('transisi Active -> Closed: end_date terisi (bukan "—")', endDate !== '—' && endDate !== '', `end=${endDate}`);
  step('rollup funnel: Leads Generated=1 + Total Value Won IDR',
    /LeadsGenerated1/.test(rollupSec.replace(/\s+/g, '')) && rollupSec.includes('Rp.'),
    rollupSec.replace(/\s+/g, ' ').slice(0, 200));

  // ---- Staff lain TIDAK melihat campaign orang lain — kontrak; lead melihat semua ----
  // ---- Login Marketing LEAD: division-wide read, transisi boleh, budget TIDAK ----
  await login(LEAD.email, LEAD.pass);
  await page.goto(`${BASE}/marketing`);
  await page.waitForSelector('table');
  const leadSees = await page.isVisible(`a:has-text("${cmpId}")`);
  step('lead melihat campaign staff di list (division-wide)', leadSees);

  await page.goto(`${BASE}/marketing/${cmpId}`);
  await page.waitForSelector(`h1:has-text("${cmpId}")`);
  const hasArchiveBtn = await page.isVisible('button:has-text("Ubah ke Archived")');
  const hasEditBudget = await page.isVisible('#edit-budget');
  const hasReassign = await page.isVisible('#reassign-target');
  step('lead non-owner: tombol transisi ADA, form budget TIDAK ADA (monitor-not-edit), reassign ADA',
    hasArchiveBtn && !hasEditBudget && hasReassign,
    `transisi=${hasArchiveBtn} budgetForm=${hasEditBudget} reassign=${hasReassign}`);

  // ---- Lead: dashboard terlihat semua; lalu tutup lifecycle Closed -> Archived ----
  await page.goto(`${BASE}/marketing/performance`);
  await page.waitForSelector('table');
  const leadDash = await page.isVisible(`table tr:has-text("${cmpId}")`);
  step('dashboard lead: campaign staff tampil', leadDash);

  await page.goto(`${BASE}/marketing/${cmpId}`);
  await page.click('button:has-text("Ubah ke Archived")');
  await page.waitForFunction(() => {
    const b = document.querySelector('.row .badge');
    return b && b.textContent.trim() === 'Archived';
  }, { timeout: 15000 });
  const anyBtnLeft = await page.isVisible('button:has-text("Ubah ke")');
  step('lead: Closed -> Archived; terminal (tak ada tombol transisi lagi)', !anyBtnLeft);

  // ---- Rekap console/network ----
  const okBad = badResponses.filter((r) => {
    if (r.status === 401 && r.url.includes('/api/v1/me')) return false; // anonim by design
    if (r.status === 401 && r.url.includes('/auth/login')) return false; // uji negatif A6
    if (r.status === 422 && r.url.includes('/marketing/campaigns')) return false; // uji negatif create
    if (r.status === 404 && r.url.includes('/performance')) return false; // record belum ada by design
    return true;
  });
  step('nol response 4xx/5xx tak terduga', okBad.length === 0, JSON.stringify(okBad).slice(0, 300));
  const realConsoleErrors = consoleErrors.filter((t) => !t.includes('401') && !t.includes('422') && !t.includes('404'));
  step('nol console error tak terduga', realConsoleErrors.length === 0, JSON.stringify(realConsoleErrors).slice(0, 300));

  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log(`\nTOTAL ${results.length} langkah — PASS ${results.length - fails.length}, FAIL ${fails.length}`);
  process.exit(fails.length > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
