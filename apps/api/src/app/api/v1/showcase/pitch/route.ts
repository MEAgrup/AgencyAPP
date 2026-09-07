/**
 * GET /api/v1/showcase/pitch[?download=1] — materi pitch sebagai satu berkas
 * HTML mandiri (Gelombang C, langkah 5).
 *
 * Kenapa dokumen padahal Sales sudah punya halamannya (C-1): yang dikirim ke
 * calon klien adalah berkas, bukan tautan ke sistem internal. Calon klien tidak
 * punya akun CDPS, dan membuatkan satu hanya untuk memperlihatkan satu tabel
 * adalah permukaan akses baru yang tidak seorang pun minta.
 *
 * Dokumen ini memuat KLIEN BER-IZIN SAJA, siapa pun yang meng-export — termasuk
 * Director. Halaman punya dua pandangan; berkas yang sudah terkirim tidak bisa
 * ditarik kembali, jadi gerbang C-3 di jalur ini mutlak. Penegakannya di domain
 * (`showcase.materiPitch`), bukan di rute.
 */
import { showcase } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle } from '@/lib/http';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { html, namaBerkas } = await showcase.materiPitch(db(), actor);
    const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
    if (new URL(request.url).searchParams.get('download') === '1') {
      // Dua bentuk sengaja: `filename` polos dibaca semua peramban, `filename*`
      // (RFC 5987) menjaga karakter non-ASCII pada nama berkas.
      headers['content-disposition'] =
        `attachment; filename="${namaBerkas.replace(/[^\x20-\x7E]/g, '_')}"; ` +
        `filename*=UTF-8''${encodeURIComponent(namaBerkas)}`;
    }
    return new Response(html, { status: 200, headers });
  });
}
