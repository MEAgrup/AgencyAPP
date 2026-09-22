/**
 * GET /api/v1/account/pdt/laporan/kiriman/{id}/html?mode=klien|internal[&download=1]
 * — M20 B-03, renderer HTML dua mode atas snapshot BEKU (`pdt_laporan_kiriman`).
 *
 * `mode` WAJIB dan divalidasi ketat ('klien'|'internal') — tidak ada default
 * diam-diam, karena mode salah berarti blok internal (kelengkapan, catatan
 * dimensi, benchmark versi) bisa terbangun untuk permintaan yang sebenarnya
 * ingin `klien` (R1). `pdt.bacaKirimanLaporanPdt` menegakkan permission-nya
 * sendiri (`canKirimLaporan` + OD read-only, PRD M20 §5); route ini TIDAK
 * membedakan gerbang per mode — jalur AM (`web-internal`) ini bukan jalur
 * portal klien (R10, itu route TERPISAH di Gelombang D dengan predikat klien
 * di SQL-nya sendiri, bukan di sini).
 *
 * Nama berkas diturunkan DI SERVER dari snapshot (`pdt.namaBerkasLaporan`,
 * toko/periode/mode) — B-03's requirement bahwa sufiks mode membedakan
 * salinan internal dari salinan klien begitu berkasnya duduk di folder
 * Downloads. `download=1` memaksa `Content-Disposition: attachment`; tanpa
 * itu browser merender inline (tombol "Lihat" vs "Unduh", B-04).
 *
 * CSP sama persis `client-portal/reports/[id]/html/route.ts` (CR-12 — nol
 * host eksternal): `packages/core/src/pdt/render.ts` menempel DOC_CSS/
 * CHART_JS/PRINT_BOOT/ikon dari `docassets` yang sama, jadi dokumen ini
 * TIDAK menarik apa pun dari jaringan juga. `cache-control: private,
 * no-store` — laporan bisa dicabut (Gelombang C), jadi tidak boleh nyangkut
 * di cache bersama sesudah akses dicabut.
 */
import { pdt } from '@cdps/domain';
import { pdt as pdtCore } from '@cdps/core';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle } from '@/lib/http';

/** Diekspor supaya tes bisa memeriksa kebijakan yang BENAR-BENAR dikirim (pola sama `REPORT_CSP_HEADER`). */
export const LAPORAN_HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const kirimanId = Number(id);
    if (!Number.isInteger(kirimanId) || kirimanId <= 0) {
      throw new BadRequestError('id is required (positive integer)');
    }

    const params = new URL(request.url).searchParams;
    const modeRaw = params.get('mode');
    if (modeRaw !== 'klien' && modeRaw !== 'internal') {
      throw new BadRequestError("mode is required ('klien' or 'internal')");
    }
    const mode: pdtCore.RenderMode = modeRaw;
    const download = params.get('download') === '1';

    const { laporan } = await pdt.bacaKirimanLaporanPdt(db(), actor, kirimanId);
    const html = pdtCore.renderLaporanHtml(laporan, mode);
    const namaBerkas = pdtCore.namaBerkasLaporan(laporan, mode);

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': LAPORAN_HTML_CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
        ...(download ? { 'content-disposition': `attachment; filename="${namaBerkas}"` } : {}),
      },
    });
  });
}
