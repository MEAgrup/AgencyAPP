/**
 * POST/GET /api/v1/internal/px/evaluate/tick — Product Exchange M3-B, Flow
 * A+B (`productexchange.evaluateTick`): recompute `px_sku_volume` + evaluasi
 * kelayakan empat lapis untuk seluruh toko ber-`shop_id` (POST tanpa body,
 * atau GET), atau satu toko (`POST {"client_platform_id": …}`).
 *
 * AKTIVASI DITUNDA (ketokan pemilik 2026-09-15, lihat catatan penerapan
 * `docs/prd/CDPS_ProductExchange_M3.md`): route ini ADA dan bekerja, tapi
 * TIDAK dipanggil cron/hook otomatis manapun sampai PDT G1 `verified` di
 * ≥10 klien — hanya dipicu manual (curl/GitHub Actions) sampai saat itu.
 *
 * Sama pola tick lain (`@/lib/tick-auth`): bukan pengguna yang login, jadi
 * TIDAK memverifikasi JWT — gerbangnya secret bersama, tertutup bila tidak
 * dikonfigurasi. Kedua verb menjalankan sweep yang sama (POST membawa body
 * opsional untuk cron/curl; GET untuk Vercel Cron kelak, yang tidak bisa
 * membawa body).
 *
 * Route ini TIDAK punya pemanggil `web-internal` by design (route-parity
 * adalah FE→API): tick adalah alat operasi, bukan halaman.
 */
import { productexchange } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { tickSecretOk } from '@/lib/tick-auth';

interface Body {
  client_platform_id?: unknown;
}

function toWire(hasil: productexchange.PxTickSummary) {
  return {
    toko_dievaluasi: hasil.tokoDievaluasi,
    produk_dievaluasi: hasil.produkDievaluasi,
    lolos: hasil.lolos,
    per_verdict: hasil.perVerdict,
    gagal: hasil.gagal.map((g) => ({ client_platform_id: g.clientPlatformId, error: g.error })),
  };
}

async function runTick(clientPlatformId: number | undefined): Promise<Response> {
  const hasil = await productexchange.evaluateTick(db(), clientPlatformId);
  return json(toWire(hasil));
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    const body = await readJson<Body>(request).catch(() => ({}) as Body);
    const clientPlatformId = typeof body.client_platform_id === 'number' ? body.client_platform_id : undefined;
    return runTick(clientPlatformId);
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    if (!tickSecretOk(request)) return json({ error: 'unauthorized' }, 401);
    return runTick(undefined);
  });
}
