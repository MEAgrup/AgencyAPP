/**
 * POST/GET /api/v1/internal/px/evaluate/tick — Product Exchange M3-B, Flow
 * A+B (`productexchange.evaluateTick`): recompute `px_sku_volume` + evaluasi
 * kelayakan empat lapis untuk seluruh toko ber-`shop_id` (POST tanpa body,
 * atau GET), atau satu toko (`POST {"client_platform_id": …}`). Sesudah
 * setiap tick, juga membangun + mendorong snapshot katalog PX ke MCN
 * (`@/lib/px-catalog-push`, kontrak `docs/BRIDGE_PX_CATALOG_CONTRACT.md`) —
 * arah balik Flow C, frekuensi "sesudah tiap evaluate/tick" per kontrak.
 *
 * AKTIVASI DITUNDA (ketokan pemilik 2026-09-15, lihat catatan penerapan
 * `docs/prd/CDPS_ProductExchange_M3.md`): route ini ADA dan bekerja, tapi
 * TIDAK dipanggil cron/hook otomatis manapun sampai PDT G1 `verified` di
 * ≥10 klien — hanya dipicu manual (curl/GitHub Actions) sampai saat itu.
 * Push katalog mengikuti jadwal yang sama (hanya jalan saat tick manual
 * dipicu) sampai cron dipasang.
 *
 * Sama pola tick lain (`@/lib/tick-auth`): bukan pengguna yang login, jadi
 * TIDAK memverifikasi JWT — gerbangnya secret bersama, tertutup bila tidak
 * dikonfigurasi. Kedua verb menjalankan sweep yang sama (POST membawa body
 * opsional untuk cron/curl; GET untuk Vercel Cron kelak, yang tidak bisa
 * membawa body).
 *
 * Kegagalan push katalog TIDAK menggagalkan tick: hasil evaluate/verdict
 * tetap dikembalikan 200 apa pun hasil pushnya (`catalog_push` di body
 * respons melaporkan status push secara terpisah) — `pushCatalogSnapshot`
 * sendiri tidak pernah melempar, tapi `buildCatalogSnapshot`/
 * `recordCatalogPush` (baca/tulis DB) bisa, jadi tetap dibungkus try/catch.
 *
 * Route ini TIDAK punya pemanggil `web-internal` by design (route-parity
 * adalah FE→API): tick adalah alat operasi, bukan halaman.
 */
import { productexchange } from '@cdps/domain';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { pushCatalogSnapshot, type CatalogPushOutcome } from '@/lib/px-catalog-push';
import { tickSecretOk } from '@/lib/tick-auth';

interface Body {
  client_platform_id?: unknown;
}

function toWire(hasil: productexchange.PxTickSummary, push: CatalogPushOutcome | null) {
  return {
    toko_dievaluasi: hasil.tokoDievaluasi,
    produk_dievaluasi: hasil.produkDievaluasi,
    lolos: hasil.lolos,
    per_verdict: hasil.perVerdict,
    gagal: hasil.gagal.map((g) => ({ client_platform_id: g.clientPlatformId, error: g.error })),
    catalog_push: push
      ? {
          configured: push.configured,
          ok: push.ok,
          batch_key: push.batchKey,
          rows_sent: push.rowsSent,
          rows_received: push.rowsReceived ?? null,
          duplicate: push.duplicate ?? null,
          error: push.error ?? null,
        }
      : null,
  };
}

async function pushCatalogAfterTick(): Promise<CatalogPushOutcome | null> {
  try {
    const sql = db();
    const snapshot = await productexchange.buildCatalogSnapshot(sql);
    const result = await pushCatalogSnapshot(snapshot);
    if (result.configured) {
      await productexchange.recordCatalogPush(sql, {
        ok: result.ok,
        status: result.status,
        batchKey: result.batchKey,
        rowsSent: result.rowsSent,
        rowsReceived: result.rowsReceived,
        duplicate: result.duplicate,
        error: result.error,
      });
    }
    return result;
  } catch (err) {
    return {
      configured: true,
      ok: false,
      status: 0,
      batchKey: 'error',
      rowsSent: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runTick(clientPlatformId: number | undefined): Promise<Response> {
  const hasil = await productexchange.evaluateTick(db(), clientPlatformId);
  const push = await pushCatalogAfterTick();
  return json(toWire(hasil, push));
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
