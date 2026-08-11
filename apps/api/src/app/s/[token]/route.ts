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
  :root {
    color-scheme: light dark;
    --bg: #f4f5f7; --card: #ffffff; --border: #e5e7eb; --hair: #eef0f3;
    --ink: #111827; --ink2: #374151; --muted: #6b7280; --accent: #0f766e;
  }
  * { box-sizing: border-box; }
  body { font: 15px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: var(--bg); color: var(--ink); }
  .wrap { max-width: 780px; margin: 0 auto; padding: 40px 20px 72px; }
  header { display: flex; align-items: flex-start; gap: 14px; border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 28px; }
  .mono { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 700; font-size: 15px; letter-spacing: .5px; display: flex; align-items: center; justify-content: center; }
  .htext { min-width: 0; }
  .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 11px; font-weight: 600; color: var(--accent); margin: 2px 0 2px; }
  h1 { font-size: 22px; margin: 0 0 4px; line-height: 1.2; }
  .meta { color: var(--muted); font-size: 13px; }
  section { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 6px 20px; margin: 0 0 16px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 16px 0 6px; color: var(--muted); }
  .row { display: flex; justify-content: space-between; gap: 20px; padding: 9px 0; border-top: 1px solid var(--hair); }
  .row:first-of-type { border-top: 0; }
  .label { color: var(--ink2); flex: 0 1 auto; }
  .value { color: var(--ink); font-weight: 600; text-align: right; white-space: pre-wrap; overflow-wrap: anywhere; }
  .field { padding: 10px 0; border-top: 1px solid var(--hair); }
  .field:first-of-type { border-top: 0; }
  .field .label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 3px; font-weight: 400; }
  .field .value { display: block; text-align: left; font-weight: 500; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; line-height: 1.5; }
  .neutral { text-align: center; padding: 104px 20px; color: var(--muted); }
  .neutral h1 { color: var(--ink); }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1014; --card: #171a21; --border: #262b34; --hair: #21252d;
      --ink: #f3f4f6; --ink2: #cbd2dc; --muted: #9aa4b2; --accent: #2dd4bf;
    }
    .mono { color: #06231f; }
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

/** Long or multi-line values read as a stacked block; short scalars stay inline. */
function fieldRow(label: string, value: string): string {
  const long = value.length > 56 || value.includes('\n');
  const cls = long ? 'field' : 'row';
  return `<div class="${cls}"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`;
}

function activePage(view: strategi.ShareLinkResolved): string {
  const approved = view.disetujuiPada ? new Date(view.disetujuiPada).toISOString().slice(0, 10) : '—';
  const sections = (view.sections ?? [])
    .map((s) => {
      const rows = s.fields.map((f) => fieldRow(f.label, f.value)).join('');
      return `<section><h2>${esc(s.seksi)}</h2>${rows}</section>`;
    })
    .join('');
  return shell(
    `Strategi — Versi ${view.versiNo ?? ''}`,
    `<header>
       <div class="mono">MEA</div>
       <div class="htext">
         <div class="eyebrow">Dokumen Strategi</div>
         <h1>Rencana Kerja Akun</h1>
         <div class="meta">Versi ${view.versiNo ?? '—'} · disetujui ${esc(approved)}</div>
       </div>
     </header>${sections || '<section><p>Belum ada bagian yang dibagikan.</p></section>'}
     <footer>Dokumen ini disiapkan oleh MEA Agency untuk Anda dan bersifat rahasia.
     Menampilkan versi aktif; hubungi Account Manager Anda untuk pertanyaan.</footer>`,
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
