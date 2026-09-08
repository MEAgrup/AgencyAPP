/**
 * /api/v1/finance/tutup-buku/{periode} — satu bulan.
 *
 * GET    : status bulan + angka yang SEDANG berlaku. Kalau bulannya tertutup,
 *          angkanya dibaca dari snapshot beku — BUKAN dihitung ulang. Itu inti
 *          D-3: laporan yang sudah dikirim harus tetap bisa dipertanggungjawabkan
 *          walau data mentahnya sudah bergerak.
 * POST   : tutup buku (Finance lead ATAU Director).
 *
 * Buka-ulang TIDAK ada di sini, ia POST ke `{periode}/buka`. Bukan DELETE:
 * membuka kembali WAJIB membawa alasan tertulis, dan DELETE tanpa badan
 * permintaan tidak bisa membawanya — memaksakannya berarti mengirim alasan
 * lewat query string, tempat ia akan mendarat di log akses. Lagipula tidak ada
 * yang dihapus: angka bekunya tetap ada sebagai versi.
 */
import { tutupbuku } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { angkaPeriodeToWire, periodeToWire, snapshotVersiToWire } from '@/lib/wire';

type Ctx = { params: Promise<{ periode: string }> };

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { periode } = await ctx.params;
    return readAsActor(actor, async (sql) => {
      const p = await tutupbuku.getPeriode(sql, periode);
      if (p !== null && p.status === tutupbuku.STATUS_TERTUTUP) {
        const versi = await tutupbuku.listVersi(sql, periode);
        const terakhir = versi[versi.length - 1];
        return json({
          data: {
            periode: periodeToWire(p),
            angka: angkaPeriodeToWire(terakhir.angka),
            // `beku: true` menjawab pertanyaan yang halaman WAJIB bisa jawab:
            // apakah yang dilihat ini angka yang dikunci, atau hitungan hari
            // ini yang bisa berubah besok.
            beku: true,
            versi_ditampilkan: terakhir.versi,
            versi: versi.map(snapshotVersiToWire).map((v) => ({ ...v, angka: undefined })),
          },
        });
      }
      const angka = await tutupbuku.hitungAngkaPeriode(sql, periode);
      return json({
        data: {
          periode: p === null ? null : periodeToWire(p),
          angka: angkaPeriodeToWire(angka),
          beku: false,
          versi_ditampilkan: null,
          versi: [],
        },
      });
    });
  });
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { periode } = await ctx.params;
    const hasil = await tutupbuku.tutupBuku(db(), actor, periode);
    return json({
      data: {
        periode: periodeToWire(hasil.periode),
        versi: hasil.versi,
        angka: angkaPeriodeToWire(hasil.angka),
      },
    });
  });
}
