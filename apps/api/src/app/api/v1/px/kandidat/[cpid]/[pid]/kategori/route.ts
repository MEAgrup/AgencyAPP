/**
 * PUT /api/v1/px/kandidat/{cpid}/{pid}/kategori — AM (atau lead Account/
 * Director) mengonfirmasi `level2_category` satu produk kandidat PX (D-24,
 * Rule 9-11). Satu kali per produk — boleh dikoreksi (UPSERT), setiap
 * perubahan tercatat `audit_log`.
 *
 * `pid` (`platform_product_id`) di-`decodeURIComponent` — sama alasan
 * `strategi/{id}/assumptions/{kode}/status`: identitasnya bisa membawa
 * karakter yang perlu di-escape di path.
 *
 * Balasan langsung verdict TERBARU produk itu (evaluasi ulang L3/L4 terjadi
 * di dalam `konfirmasiKategori`, bukan menunggu tick berikutnya).
 */
import { productexchange } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { pxKandidatVerdictToWire } from '@/lib/wire';

/** Nama field ini WAJIB `level2_category` (bukan `nilai`/`kategori`) — `body-parity.test.ts` menuntut nama yang FE benar-benar kirim. */
export interface KonfirmasiKategoriInput {
  level2_category?: unknown;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ cpid: string; pid: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { cpid, pid } = await ctx.params;
    const b = await readJson<KonfirmasiKategoriInput>(request);
    const hasil = await productexchange.konfirmasiKategori(
      db(),
      actor,
      Number(cpid),
      decodeURIComponent(pid),
      String(b.level2_category ?? ''),
    );
    return json(pxKandidatVerdictToWire(hasil));
  });
}
