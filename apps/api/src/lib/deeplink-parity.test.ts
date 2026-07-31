/**
 * Notification deep-link ↔ FE page parity guard (DECISIONS **O51**).
 *
 * Sibling of `route-parity.test.ts`, same defect class one layer up: that gate
 * proves every path the FE **calls** is served; this one proves every path the
 * backend **sends a user to** exists as a page.
 *
 * Nothing checked it before, so `deep_link` was effectively a free-text column.
 * Phase 0 §9.2 mandates "deep-link to the entity" but not the paths, and the
 * paths are a frontend fact — so 8 of 10 emitted shapes pointed nowhere. The one
 * that reached production did it 38 times: `/performance_snapshot/PERF-202606-…`
 * against a page that lives at `/performance/[id]`. Every unit test still passed,
 * because each side was right about its own half and nobody compared the pair.
 *
 * Two assertions, and the second is the one that stops the regression:
 *
 *   1. every `deeplink.*()` builder returns a path that matches a real page;
 *   2. every `notification.emit(...)` call in `packages/domain` passes an
 *      explicit `deepLink:` — so a new emitter cannot silently inherit
 *      `notify_emit`'s `'/' || entity_type || '/' || entity_id` default, which is
 *      how this class of bug is born rather than how it spreads.
 *
 * There is deliberately **no** allow-list here. `route-parity`'s `KNOWN_GAPS`
 * exists because unported endpoints were a fact on the ground; a deep link, by
 * contrast, is one line at the emitter and there is no reason to ship a broken
 * one. If a page genuinely does not exist yet, point the builder at the closest
 * page that does (see `deeplink.brief`'s Ads case) — a link one click away is a
 * link; a 404 is a dead end.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deeplink } from '@cdps/core';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FE_APP = join(REPO_ROOT, 'web-internal/src/app');
const DOMAIN_SRC = join(REPO_ROOT, 'packages/domain/src');

function walk(dir: string, leaf: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, leaf));
    } else if (leaf(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The pages `web-internal` actually renders, with dynamic segments normalised to
 * `{}` and Next route groups (`(shell)`, `(auth)`) stripped — they organise files,
 * not URLs, so `(shell)/performance/[id]` is served at `/performance/{}`.
 */
function fePages(): Set<string> {
  const pages = new Set<string>();
  for (const file of walk(FE_APP, (n) => n === 'page.tsx')) {
    const path = file
      .slice(FE_APP.length)
      .replace(/\/page\.tsx$/, '')
      .replace(/\/\([^)]+\)/g, '')
      .replace(/\[[^\]]+\]/g, '{}');
    pages.add(path === '' ? '/' : path);
  }
  return pages;
}

/** Collapses a built deep link to the same shape as `fePages()` entries. */
function normalise(link: string): string {
  return link.replace(/\/[A-Z]+-\d{6}-\d{4}\b/g, '/{}').replace(/\/CLIENT-ID\b/g, '/{}');
}

/**
 * Every deep link the builders can produce, with a realistic id per entity. The
 * ids are shaped like real ones (`PREFIX-YYYYMM-NNNN`, `docs/DATA_MODEL.md`) so
 * `normalise` collapses exactly what a production value would collapse to.
 */
const BUILT: { what: string; link: string }[] = [
  { what: 'brief (Creative)', link: deeplink.brief('BRF-202607-0001', 'Creative') },
  { what: 'brief (KOL)', link: deeplink.brief('BRF-202607-0001', 'KOL') },
  { what: 'brief (Live Stream)', link: deeplink.brief('BRF-202607-0001', 'Live Stream') },
  { what: 'brief (Ads → division queue, no per-Brief page)', link: deeplink.brief('BRF-202607-0001', 'Ads') },
  { what: 'brief (unknown division → Board)', link: deeplink.brief('BRF-202607-0001', 'Nonexistent') },
  { what: 'asset', link: deeplink.asset('AST-202607-0001') },
  { what: 'task (brief source)', link: deeplink.task('brief', 'BRF-202607-0001', 'Creative') },
  { what: 'task (asset source)', link: deeplink.task('asset', 'AST-202607-0001', 'Creative') },
  { what: 'complaint', link: deeplink.complaint('CMP-202607-0001') },
  { what: 'client health', link: deeplink.clientHealth('CLIENT-ID') },
  { what: 'live-stream session', link: deeplink.liveStreamSession('LSS-202607-0001') },
  { what: 'performance snapshot', link: deeplink.performanceSnapshot('PERF-202606-0001') },
  { what: 'transaction', link: deeplink.transaction('TRX-202607-0001') },
  { what: 'prospect attempt', link: deeplink.attempt('PRSP-202607-0001') },
  { what: 'lead', link: deeplink.lead('LEAD-202607-0001') },
  { what: 'demo task', link: deeplink.demoTask('DMT-202607-0001') },
];

describe('deeplink → FE page parity (O51)', () => {
  it('resolves the FE page table (sanity: the known-broken targets exist as pages)', () => {
    const pages = fePages();
    // If any of these three disappears, the failures below would be about a
    // moved page rather than a wrong link — so name them explicitly.
    expect(pages).toContain('/performance/{}');
    expect(pages).toContain('/finance/transactions/{}');
    expect(pages).toContain('/sales/{}');
  });

  it.each(BUILT)('$what → a page that exists', ({ link }) => {
    expect(fePages()).toContain(normalise(link));
  });

  it('sends nothing shaped like the old notify_emit default (/<entity_type>/<id>)', () => {
    // snake_case first segment = an entity_type leaked into a URL. The FE has no
    // underscored route segment, so this is a cheap, precise smell test.
    const leaked = BUILT.filter(({ link }) => /^\/[a-z]+_[a-z_]+\//.test(link));
    expect(leaked).toEqual([]);
  });
});

/**
 * Blanks out comments while preserving every byte offset and newline, so a call
 * site's line number survives and prose cannot masquerade as code. Needed because
 * `domain/notification.ts` documents the producer half as "`notification.emit()`"
 * in a doc comment — a naive scan reports that sentence as an emitter missing its
 * deepLink. Strings and template literals are tracked so a `//` inside one is not
 * mistaken for a comment.
 */
function codeOnly(src: string): string {
  const out = src.split('');
  let i = 0;
  let quote = ''; // '\'' | '"' | '`' when inside a string
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote !== '') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      out[i] = ' ';
      if (i + 1 < src.length) out[i + 1] = ' ';
      i += 2;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

describe('every notification emitter passes an explicit deepLink (O51)', () => {
  /**
   * Each `notification.emit(` call site in `packages/domain`, as
   * `file:line` → the call's argument text. Brace-counted rather than
   * regex-matched: the argument object spans lines and nests `[...]`/`{...}`.
   */
  function emitCallSites(): { where: string; body: string }[] {
    const sites: { where: string; body: string }[] = [];
    for (const file of walk(DOMAIN_SRC, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const src = codeOnly(readFileSync(file, 'utf8'));
      const needle = 'notification.emit(';
      let from = 0;
      for (;;) {
        const at = src.indexOf(needle, from);
        if (at === -1) break;
        from = at + needle.length;
        let depth = 1;
        let i = from;
        while (i < src.length && depth > 0) {
          if (src[i] === '(') depth += 1;
          if (src[i] === ')') depth -= 1;
          i += 1;
        }
        sites.push({
          where: `${file.slice(DOMAIN_SRC.length + 1)}:${src.slice(0, at).split('\n').length}`,
          body: src.slice(from, i),
        });
      }
    }
    return sites;
  }

  it('finds the emitters (guard against a scanner that silently matches nothing)', () => {
    expect(emitCallSites().length).toBeGreaterThanOrEqual(15);
  });

  it('has no emitter relying on the SQL default deep link', () => {
    const missing = emitCallSites()
      .filter(({ body }) => !/\bdeepLink:/.test(body))
      .map(({ where }) => where);
    expect(missing).toEqual([]);
  });

  it('builds every deepLink through the deeplink module, never a literal path', () => {
    const handWritten = emitCallSites()
      .filter(({ body }) => /\bdeepLink:\s*[`'"]/.test(body))
      .map(({ where }) => where);
    expect(handWritten).toEqual([]);
  });
});
