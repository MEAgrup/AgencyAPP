/**
 * GET /api/v1/client-portal/reports/{id}/html — the report the client reads.
 *
 * Always `klien` mode with the PINNED insight revision; there is no `mode`
 * parameter, because no client request should ever be able to ask for the
 * internal render.
 *
 * ## Why this is served same-origin, and what that closed
 *
 * M15 Rule 3 confirmed reports are "natively embedded". The security spec §6
 * planned that as a CROSS-ORIGIN iframe into `mea-client-reporting`, and left
 * OQ-8 open: how to pass a scoped token to a separate system without handing it
 * the Portal session cookie. Since the report engine now lives INSIDE CDPS
 * (`packages/core/src/report`), that question dissolves — there is no second
 * origin and no token to pass. The Portal page frames this endpoint on its own
 * origin, which also keeps the report's own CSS and JS out of the Portal
 * shell's.
 *
 * The CSP below is the report document's own, not the Portal's. Since CR-12 the
 * document fetches NOTHING from the network — CSS, Chart.js, and every icon are
 * pasted into it — so the policy names no external host at all, and
 * `frame-ancestors 'self'` keeps a third-party site from framing it.
 */
import { clientPortal } from '@cdps/domain';
import { requireClientContactActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { errorJson, handle } from '@/lib/http';

/**
 * CR-12 — NOL host eksternal.
 *
 * Sebelumnya kebijakan ini meng-allow-list `cdn.tailwindcss.com`,
 * `cdnjs.cloudflare.com`, `fonts.googleapis.com`, dan `fonts.gstatic.com`,
 * karena dokumennya memang menarik kelimanya. Setelah CR-12 dokumen itu tidak
 * menarik apa pun, jadi meninggalkan host-host itu di sini berarti dua hal
 * buruk sekaligus: CSP-nya BERBOHONG tentang apa yang dokumen ini butuhkan, dan
 * celahnya tetap terbuka untuk renderer yang lalai memasukkan tag CDN lagi
 * besok — persis kegagalan yang CR-12 ada untuk menutupnya.
 *
 * Dijaga dua tes di `report-csp.test.ts`: (a) kebijakan ini tidak memuat host
 * eksternal apa pun, dan (b) HTML yang dirender memang tidak memintanya.
 */
const REPORT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

/** Diekspor supaya tes bisa memeriksa kebijakan yang BENAR-BENAR dikirim, bukan
 *  salinannya yang diketik ulang di berkas tes. */
export const REPORT_CSP_HEADER = REPORT_CSP;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireClientContactActor(request);
    const { id } = await ctx.params;
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return errorJson(clientPortal.MSG_REPORT_NOT_FOUND, 404);
    }
    const body = await clientPortal.reportHtml(db(), actor, reportId);
    await clientPortal.logAccess(db(), clientPortal.contactScope(actor), 'view:report', String(reportId));
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': REPORT_CSP,
        'x-content-type-options': 'nosniff',
        // A published report is a point-in-time document, but it can be revoked
        // — so it must never sit in a shared cache after access is withdrawn.
        'cache-control': 'private, no-store',
      },
    });
  });
}
