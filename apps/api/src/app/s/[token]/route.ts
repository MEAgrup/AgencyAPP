/**
 * GET /s/{token} — the client-facing read-only Strategi (M6A §7 D20, RA-3, RA-7).
 *
 * Unauthenticated BY DESIGN: the token is the credential (§7), so there is no
 * `requireActor` here. It runs on the service-role connection (`db()`), and
 * every safety property comes from `resolveShareLink`, never from RLS:
 *
 *   - the visibility filter (`shareableFieldIds`) is applied in the domain BEFORE
 *     anything is serialised — this page only ever receives already-filtered data;
 *   - only the approved ACTIVE version is reachable; Draft/Draft Revisi are not;
 *   - RA-7 / X-06: the active version only — no history, no diff in the payload;
 *   - an unknown, revoked, or expired token renders the SAME neutral page, with no
 *     data and no hint about what was there.
 *
 * The token is a path segment (never a query param) per the §7 privacy note, and
 * the response is `no-store` + `noindex` because it is a secret-bearing URL.
 */
import { strategi } from '@cdps/domain';
import { db } from '@/lib/db';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PAGE_CSS = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1a1a1a; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  header { border-bottom: 2px solid #d8dce2; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 13px; }
  section { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; margin: 0 0 16px; }
  h2 { font-size: 15px; margin: 0 0 10px; color: #374151; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-top: 1px solid #f0f1f3; }
  .row:first-of-type { border-top: 0; }
  .label { color: #374151; }
  .value { color: #111827; font-weight: 600; text-align: right; white-space: pre-wrap; }
  .neutral { text-align: center; padding: 96px 20px; color: #6b7280; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1115; color: #e5e7eb; }
    section { background: #171a21; border-color: #262b34; }
    header { border-color: #262b34; }
    .row { border-color: #21252d; } h2, .label { color: #9aa4b2; } .value { color: #f3f4f6; }
  }
`;

function shell(title: string, inner: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">${inner}</div></body></html>`;
}

/** The single neutral outcome for unknown / revoked / expired (§7): no hint. */
function neutralPage(): string {
  return shell(
    'Tautan tidak aktif',
    `<div class="neutral"><h1>Tautan tidak aktif</h1>
     <p>Tautan ini sudah tidak berlaku. Silakan hubungi Account Manager Anda.</p></div>`,
  );
}

function activePage(view: strategi.ShareLinkResolved): string {
  const approved = view.disetujuiPada ? new Date(view.disetujuiPada).toISOString().slice(0, 10) : '—';
  const sections = (view.sections ?? [])
    .map((s) => {
      const rows = s.fields
        .map(
          (f) =>
            `<div class="row"><span class="label">${esc(f.label)}</span>` +
            `<span class="value">${esc(f.value)}</span></div>`,
        )
        .join('');
      return `<section><h2>${esc(s.seksi)}</h2>${rows}</section>`;
    })
    .join('');
  return shell(
    `Strategi — Versi ${view.versiNo ?? ''}`,
    `<header><h1>Strategi</h1>
       <div class="meta">Versi ${view.versiNo ?? '—'} · disetujui ${esc(approved)}</div>
     </header>${sections || '<section><p>Belum ada bagian yang dibagikan.</p></section>'}`,
  );
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Secret-bearing URL: never cache, never index.
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = request.headers.get('user-agent');
  let view: strategi.ShareLinkResolved;
  try {
    view = await strategi.resolveShareLink(db(), token, { ip, userAgent });
  } catch {
    // A resolve failure must not reveal itself — same neutral page as a bad token.
    return htmlResponse(neutralPage());
  }
  return htmlResponse(view.aktif ? activePage(view) : neutralPage());
}
