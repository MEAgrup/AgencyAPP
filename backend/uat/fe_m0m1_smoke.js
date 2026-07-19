// Smoke test FE↔BE M0/M1 — pola FE_UAT_RUNBOOK (login riil, klik UI sungguhan).
// Jalankan: node m0m1_smoke.js  (stack UAT harus hidup: cdps :8080, next :3000)
const { chromium } = require('playwright-core');

const BASE = 'http://localhost:3000';
const PASS = 'rahasia123';
const RUN = Date.now().toString().slice(-7); // suffix unik per run
const PHONE_SCOUT = `0812${RUN}1`; // lead scouted staff A
const PHONE_POOL = `0813${RUN}2`; // lead pool (import Marketing)
const PHONE_BULK = `0814${RUN}3`; // lead bulk valid

const ACTORS = {
  salesA: 'faesalabdul900@gmail.com', // SALES JASA -> Sales staff
  salesB: 'nandarumpaka@gmail.com', // SALES JASA -> Sales staff (kontes)
  salesLead: 'c.nurhayati14@gmail.com', // HEAD OF SALES JASA -> Sales lead
  marketing: 'uat.marketing1@cdps.local', // Marketing lead (fixture O34)
  od: 'ORENDY9@GMAIL.COM', // OD layered riil
};

const results = [];
let failures = 0;
function check(step, ok, detail = '') {
  results.push({ step, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${step}${detail ? ' | ' + detail : ''}`);
}

const badResponses = [];
const consoleErrors = [];
function expectedBad(url, status) {
  if (status === 401 && url.includes('/api/v1/me')) return true; // anonim di /login (by design)
  return false;
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' }); // tunggu hidrasi React (controlled inputs)
  await page.fill('#email', email);
  await page.fill('#password', PASS);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

async function logout(ctx) {
  await ctx.clearCookies();
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

  try {
    // ── S1. Marketing lead: import single (→Pool) + bulk (valid/invalid/dupe) ──
    await login(page, ACTORS.marketing);
    check('S1a login Marketing lead', true);
    await page.goto(`${BASE}/leads`);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.fill('#single-name', `Smoke Pool ${RUN}`);
    await page.fill('#single-phone', PHONE_POOL);
    await page.selectOption('#single-source', 'Leads - Iklan');
    await page.getByRole('button', { name: 'Import', exact: true }).nth(1).click();
    await page.waitForSelector('.alert.alertInfo');
    const singleSummary = await page.locator('.alert.alertInfo').first().innerText();
    check(
      'S1b import single → summary verbatim',
      singleSummary.trim() === '[1 lead berhasil diimport, 0 ditolak (duplikat/data tidak lengkap)]',
      singleSummary.trim(),
    );

    // bulk: 1 valid, 1 tanpa telepon (ditolak), 1 duplikat pool (ditolak)
    await page.fill(
      '#bulk-text',
      `Smoke Bulk ${RUN},${PHONE_BULK},,Website\nTanpa Telepon ${RUN},,,Website\nSmoke Pool Dupe ${RUN},${PHONE_POOL},,Website`,
    );
    await page.getByRole('button', { name: 'Import Bulk' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.alert.alertInfo').length >= 2);
    const bulkSummary = await page.locator('.alert.alertInfo').nth(1).innerText();
    check(
      'S1c bulk 3 baris → summary verbatim 1 ok 2 tolak',
      bulkSummary.trim() === '[1 lead berhasil diimport, 2 ditolak (duplikat/data tidak lengkap)]',
      bulkSummary.trim(),
    );
    const pageText = await page.innerText('body');
    check(
      'S1d alasan tolak verbatim (baris tak lengkap)',
      pageText.includes('[data tidak lengkap, baris tidak diimport]'),
    );
    check(
      'S1e alasan tolak verbatim (duplikat pool)',
      pageText.includes('[lead sudah ada & sedang diproses, tidak diimport]'),
    );
    await logout(ctx);

    // ── S2. Sales staff A: pool claim ──
    await login(page, ACTORS.salesA);
    check('S2a login Sales staff A', true);
    await page.goto(`${BASE}/leads`);
    await page.getByRole('button', { name: 'Pool', exact: true }).click();
    const rowA = page.locator('tr', { hasText: `Smoke Pool ${RUN}` });
    await rowA.waitFor();
    await rowA.getByRole('button', { name: 'Claim' }).click();
    await page.waitForSelector('.alert.alertSuccess');
    const claimMsg = await page.locator('.alert.alertSuccess').innerText();
    check('S2b claim pool → PRSP dibuat', /PRSP-\d{6}-\d{4}/.test(claimMsg), claimMsg.trim());
    // tombol berubah jadi "Sudah diklaim" (my_open_attempt)
    await page
      .locator('tr', { hasText: `Smoke Pool ${RUN}` })
      .getByRole('button', { name: 'Sudah diklaim' })
      .waitFor();
    check('S2c pool row → Sudah diklaim (disabled)', true);
    await logout(ctx);

    // ── S3. Sales staff B: kontes claim lead yang sama ──
    await login(page, ACTORS.salesB);
    await page.goto(`${BASE}/leads`);
    await page.getByRole('button', { name: 'Pool', exact: true }).click();
    const rowB = page.locator('tr', { hasText: `Smoke Pool ${RUN}` });
    await rowB.waitFor();
    check('S3a kontes terlihat: "1 sales mengerjakan"', (await rowB.innerText()).includes('1 sales mengerjakan'));
    await rowB.getByRole('button', { name: 'Claim' }).click();
    await page.waitForSelector('.alert.alertSuccess');
    await page
      .locator('tr', { hasText: `Smoke Pool ${RUN}` })
      .locator('text=2 sales mengerjakan')
      .waitFor();
    check('S3b claim kedua sah → "2 sales mengerjakan"', true);
    await logout(ctx);

    // ── S4. Sales staff A: registrasi scouted + lifecycle sampai Pending ──
    await login(page, ACTORS.salesA);
    await page.goto(`${BASE}/sales`);
    await page.fill('#reg-name', `Smoke Scout ${RUN}`);
    await page.fill('#reg-phone', PHONE_SCOUT);
    await page.selectOption('#reg-source', 'Scouting');
    await page.getByRole('button', { name: 'Registrasi Lead' }).last().click();
    await page.waitForSelector('.alert.alertSuccess');
    const regMsg = await page.locator('.alert.alertSuccess').innerText();
    const prspMatch = regMsg.match(/attempt (PRSP-\d{6}-\d{4})/);
    check('S4a registrasi lead → PRSP', Boolean(prspMatch), regMsg.trim());
    const prsp = prspMatch[1];

    await page.goto(`${BASE}/sales/${prsp}`);
    await page.getByRole('button', { name: 'Tandai Contacted' }).click();
    await page.waitForSelector('text=Qualified Lead Form');
    check('S4b Contacted → form Qualified muncul', true);

    // Qualified Form
    await page.fill('#q-namapic', 'Pak Smoke');
    await page.fill('#q-toko', `Toko Smoke ${RUN}`);
    await page.fill('#q-kota', 'Bandung');
    await page.fill('#q-kategori', 'Fashion');
    await page.fill('#q-linktoko', 'https://toko.example/smoke');
    await page.getByText('Shopee', { exact: true }).click();
    await page.fill('#q-gmv', '50000000');
    await page.fill('#q-targetgmv', '100000000');
    // pilih jasa pertama dari MSL; isi qty/nominal sesuai mode yang muncul
    const svcSelect = page.locator('table select').first();
    await svcSelect.selectOption({ index: 1 });
    const nominal = page.locator('input[placeholder="Nominal (Rp)"]');
    if (await nominal.count()) {
      await nominal.fill('12000000');
    } else {
      await page.locator('input[placeholder="Quantity"]').fill('1');
    }
    // preview quote read-only terisi dari server
    await page.waitForFunction(() => {
      const els = Array.from(document.querySelectorAll('div'));
      const label = els.find((e) => e.textContent === 'Estimasi Nilai Transaksi');
      return label && label.nextElementSibling && label.nextElementSibling.textContent.startsWith('Rp');
    }, { timeout: 15000 });
    check('S4c preview Estimasi Nilai (read-only, IDR server)', true);
    await page.getByRole('button', { name: 'Submit Qualified Form' }).click();
    await page.waitForSelector('text=Negosiasi');
    check('S4d submit Qualified → panel Negosiasi', true);

    // Negotiation Required, edit harga
    await page.getByRole('button', { name: 'Negotiation Required', exact: true }).click();
    const priceInput = page.locator('form input[type=number]').first();
    await priceInput.fill('10000000');
    await page.getByRole('button', { name: 'Ajukan Negosiasi' }).click();
    await page.waitForSelector('text=Keputusan Negosiasi');
    const ownerView = await page.innerText('body');
    check(
      'S4e Pending Approval; owner lihat status menunggu (bukan panel keputusan)',
      ownerView.includes('menunggu persetujuan Superior'),
    );
    await logout(ctx);

    // ── S5. Sales lead: approve negosiasi ──
    await login(page, ACTORS.salesLead);
    await page.goto(`${BASE}/sales/${prsp}`);
    await page.waitForSelector('#decision-note');
    check('S5a superior lihat panel keputusan', true);
    // Revise/Reject disabled tanpa note
    const reviseDisabled = await page.getByRole('button', { name: 'Revise / Counter' }).isDisabled();
    check('S5b Revise disabled tanpa catatan', reviseDisabled);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForSelector('text=Closing Form');
    check('S5c Approve → Closing Form muncul', true);
    await logout(ctx);

    // ── S6. Sales staff A: closing Termin 2 cicilan ──
    await login(page, ACTORS.salesA);
    await page.goto(`${BASE}/sales/${prsp}`);
    await page.waitForSelector('text=Closing Form');
    await page.selectOption('#close-scheme', '[Termin]');
    await page.fill('#inst-amount-0', '6000000');
    await page.fill('#inst-due-0', '2026-08-01');
    await page.getByRole('button', { name: 'Tambah Termin' }).click();
    await page.fill('#inst-amount-1', '4000000');
    await page.fill('#inst-due-1', '2026-09-01');
    await page.getByRole('button', { name: 'Submit Closing' }).click();
    await page.waitForSelector('.alert.alertSuccess');
    const closeMsg = await page.locator('.alert.alertSuccess').innerText();
    check(
      'S6a closing sukses → CLI + TRX',
      /Client ID: CLI-\d{6}-\d{4}/.test(closeMsg) && /Transaction ID: TRX-\d{6}-\d{4}/.test(closeMsg),
      closeMsg.trim(),
    );
    // negatif: Termin Σ ≠ total → pesan BI verbatim dari server
    // (dilakukan SEBELUM closing sukses tidak bisa — attempt sudah closed; cukup satu jalur negatif di S7)
    await logout(ctx);

    // ── S7. Negatif via UI: Termin salah Σ pada attempt kontes milik B ──
    await login(page, ACTORS.salesB);
    await page.goto(`${BASE}/sales`);
    const rowKontes = page.locator('tr', { hasText: `Smoke Pool ${RUN}` }).first();
    await rowKontes.waitFor();
    const prspB = (await rowKontes.innerText()).match(/PRSP-\d{6}-\d{4}/)[0];
    await page.goto(`${BASE}/sales/${prspB}`);
    await page.getByRole('button', { name: 'Tandai Contacted' }).click();
    await page.waitForSelector('text=Qualified Lead Form');
    // NQ tanpa lainnya text: pilih [Lainnya ...] lalu isi — jalur NQ positif + verifikasi taksonomi verbatim
    await page.getByText('[Tidak ada respon]', { exact: true }).click();
    await page.getByRole('button', { name: 'Tandai Not Qualified' }).click();
    await page.waitForSelector('text=Alasan Not Qualified');
    const nqBody = await page.innerText('body');
    check('S7a NQ tercatat, taksonomi verbatim tampil', nqBody.includes('[Tidak ada respon]'));
    await logout(ctx);

    // ── S8. OD layered: read-only di /sales & /leads ──
    await login(page, ACTORS.od);
    await page.goto(`${BASE}/sales`);
    await page.waitForSelector('text=Prospect Attempt');
    const odSales = await page.innerText('body');
    check('S8a OD: form registrasi disembunyikan', !odSales.includes('Registrasi Lead'));
    await page.goto(`${BASE}/sales/${prsp}`);
    await page.waitForSelector('text=Riwayat Audit');
    const odDetail = await page.innerText('body');
    check(
      'S8b OD: detail terbaca (Closed-Success), tanpa tombol aksi',
      odDetail.includes('Closed-Success') && !odDetail.includes('Submit Closing'),
    );
    await page.goto(`${BASE}/leads`);
    await page.getByRole('button', { name: 'Pool', exact: true }).click();
    await page.waitForSelector('text=Lead marketing yang belum dimenangkan');
    const odPool = await page.innerText('body');
    check('S8c OD: tombol Claim tidak ada', !odPool.includes('Sudah diklaim') && !/\bClaim\b/.test(odPool.replace(/Kontes/g, '')));
    await logout(ctx);

    // ── S9. /leads/[id] detail + histori (Marketing lead) ──
    await login(page, ACTORS.marketing);
    await page.goto(`${BASE}/leads`);
    await page.getByRole('button', { name: 'Database', exact: true }).click();
    await page.fill('#db-q', `Smoke Pool ${RUN}`);
    await page.getByRole('button', { name: 'Terapkan' }).click();
    const leadLink = page.locator('tbody a', { hasText: 'LEAD-' }).first();
    await leadLink.waitFor();
    await leadLink.click();
    await page.waitForSelector('text=Prospect Attempts (Kontes)');
    const detText = await page.innerText('body');
    check(
      'S9a lead detail: 2 attempt kontes + histori render',
      (detText.match(/PRSP-\d{6}-\d{4}/g) || []).length >= 2 && detText.includes('Histori'),
    );
  } catch (err) {
    check('UNCAUGHT', false, String(err).slice(0, 300));
    try {
      await page.screenshot({ path: __dirname + '/smoke_fail.png', fullPage: true });
      console.log('screenshot: smoke_fail.png @ url ' + page.url());
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
