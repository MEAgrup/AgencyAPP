/**
 * GET /api/v1/px/kategori-options — opsi dropdown `level2_category` untuk
 * konfirmasi kategori (halaman Kandidat PX, Rule 9-10 PRD M3 §3.3): distinct
 * `level2_category` dari snapshot coverage MCN TERBARU — AM hanya bisa
 * memilih kategori yang MEA punya kreatornya.
 *
 * `kategori_platform` diterima tapi TIDAK menyaring cabang — bukan sementara,
 * PERMANEN (M3-03-KATEGORI-MAPPING ditutup `docs/DECISIONS.md` 2026-09-16,
 * pemilik pilih opsi (c): pemetaan `Product category` TikTok → cabang
 * `level2_category` MCN dibiarkan terbuka ke Hans, tidak akan ditebak di
 * sini). `tersaring: false` di respons agar UI menulis catatan Rule 11 apa
 * adanya ("kategori yang MEA belum punya kreatornya tidak muncul di daftar").
 */
import { productexchange } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pxKategoriOptionsToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    requireActor(request);
    const options = await productexchange.listKategoriOptions(db());
    return json(pxKategoriOptionsToWire(options));
  });
}
