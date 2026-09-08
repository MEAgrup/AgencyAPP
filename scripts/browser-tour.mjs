#!/usr/bin/env node
// B2 (HANDOFF_PENUTUP_REVISI_OD_20260908.md §4) — the reusable browser harness.
// Loads a session cookie (minted by scripts/dev-jwt.mjs) and full-page-screenshots
// a list of `web-internal` URLs, so a page that only fails visually (never a
// non-200, never a thrown error `tsc`/`vitest`/`next build` would catch) gets
// looked at by something other than `next build` succeeding.
//
// Requires: `web-internal` running (default localhost:3000) and `apps/api`
// running (default localhost:3001, since web-internal proxies /api/v1/* there
// per next.config.ts — see BACKEND_URL there for the port convention).
//
// Usage:
//   node scripts/browser-tour.mjs --token "$(cat token.txt)" --pages pages.json
//
// pages.json: [{ "path": "/finance", "name": "01-finance" }, ...]
//
// Screenshots land in --out (default ./tmp-browser-tour/), one PNG per page,
// plus a console.error() line per page listing any browser console errors —
// those are signal even on a 200 (a component that renders around a failed
// fetch, e.g.).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

// The pre-installed Chromium build in this environment's sandbox can be a
// different revision than whatever `playwright`'s own package.json pins (that
// mismatch is what `playwright.launch()` errors on with "Executable doesn't
// exist ... please run npx playwright install" — don't; there is no browser
// download in this sandbox). Point at it explicitly instead. Overridable via
// PLAYWRIGHT_CHROMIUM_PATH for a different environment.
function resolveChromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined; // let Playwright resolve its own default
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d));
  if (dirs.length === 0) return undefined;
  const newest = dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
  const candidate = path.join(root, newest, 'chrome-linux', 'chrome');
  return fs.existsSync(candidate) ? candidate : undefined;
}

async function main() {
  const token = arg('token');
  const pagesFile = arg('pages');
  const baseUrl = arg('base-url', 'http://127.0.0.1:3000');
  const cookieName = arg('cookie-name', 'cdps_access_token');
  const cookieDomain = arg('cookie-domain', new URL(baseUrl).hostname);
  const outDir = arg('out', './tmp-browser-tour');

  if (!token || !pagesFile) {
    console.error('Usage: node scripts/browser-tour.mjs --token <jwt> --pages <pages.json> [--base-url http://127.0.0.1:3000] [--out ./tmp-browser-tour]');
    process.exit(1);
  }

  const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: resolveChromiumPath() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    { name: cookieName, value: token, domain: cookieDomain, path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();

  let exitCode = 0;
  for (const p of pages) {
    const consoleErrors = [];
    const onConsole = (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
    const onPageError = (err) => consoleErrors.push(`pageerror: ${err.message}`);
    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    const url = `${baseUrl}${p.path}`;
    process.stdout.write(`==> ${url}\n`);
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(400); // let post-mount fetches settle
      await page.screenshot({ path: path.join(outDir, `${p.name}.png`), fullPage: true });
      const status = resp?.status();
      process.stdout.write(`    status: ${status}  console-errors: ${consoleErrors.length}\n`);
      if (consoleErrors.length > 0) {
        exitCode = 1;
        for (const e of consoleErrors) process.stdout.write(`      - ${e}\n`);
      }
      if (status && status >= 400) exitCode = 1;
    } catch (e) {
      exitCode = 1;
      process.stdout.write(`    FAILED: ${e.message}\n`);
      try { await page.screenshot({ path: path.join(outDir, `${p.name}-FAILED.png`), fullPage: true }); } catch { /* best-effort */ }
    } finally {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
  }

  await browser.close();
  process.exit(exitCode);
}

main();
