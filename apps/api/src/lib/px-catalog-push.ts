/**
 * Outbound push — CDPS→MCN katalog PX Exchange snapshot
 * (`POST /api/bridge/px-catalog` di `mcnapp`). Kontrak:
 * `docs/BRIDGE_PX_CATALOG_CONTRACT.md` (disalin byte-identik dari `mcnapp` —
 * jangan menebak bentuk payload dari kode sisi manapun).
 *
 * Secret SAMA dengan Flow C (`BRIDGE_PX_SECRET`, `@/lib/bridge-auth`) — bukan
 * credential baru (kontrak §Envelope). `MCN_BRIDGE_URL` (baru, env khusus
 * arah push ini) = URL dasar deployment `mcnapp`.
 *
 * Fail-closed & tanpa retry di sini: env belum diset ⇒ no-op eksplisit
 * (`configured:false`), BUKAN lempar error — evaluate/tick tetap berjalan
 * walau push belum dikonfigurasi, sama pola AKTIVASI DITUNDA yang sudah
 * berlaku untuk tick itu sendiri. Kegagalan jaringan/HTTP juga TIDAK
 * dilempar — MCN mendegradasi aman ke snapshot terakhir bila push gagal
 * (kontrak §Non-negotiables #9), jadi satu push gagal tidak boleh
 * menjatuhkan hasil evaluate/tick yang memicunya.
 */
import { createHash } from 'node:crypto';
import type { productexchange } from '@cdps/domain';

interface CatalogPushWireRow {
  client_platform_id: string;
  platform_product_id: string;
  nama_produk: string | null;
  platform: string | null;
  nama_toko: string | null;
  level2_category: string | null;
  price_segment: string | null;
  sudah_afiliasi: boolean;
  dihitung_pada: string | null;
}

interface CatalogPushWireBody {
  snapshot_at: string;
  source: 'cdps';
  policy_note: string;
  rows: CatalogPushWireRow[];
}

function toWireBody(payload: productexchange.PxCatalogSnapshotPayload): CatalogPushWireBody {
  return {
    snapshot_at: payload.snapshotAt,
    source: payload.source,
    policy_note: payload.policyNote,
    rows: payload.rows.map((r) => ({
      client_platform_id: r.clientPlatformId,
      platform_product_id: r.platformProductId,
      nama_produk: r.namaProduk,
      platform: r.platform,
      nama_toko: r.namaToko,
      level2_category: r.level2Category,
      price_segment: r.priceSegment,
      sudah_afiliasi: r.sudahAfiliasi,
      dihitung_pada: r.dihitungPada ? r.dihitungPada.toISOString() : null,
    })),
  };
}

/**
 * catalogPushIdempotencyKey — persis format kontrak:
 * `px-catalog-<YYYYMMDD>-<sha256(payload)[0:12]>`. `YYYYMMDD` dari UTC hari
 * ini, hash dari body wire PERSIS yang dikirim (urutan key JSON stabil —
 * `toWireBody` selalu membangun objek dengan urutan key yang sama), supaya
 * retry hari yang sama dengan payload identik mengirim key yang sama persis.
 */
export function catalogPushIdempotencyKey(wireBody: CatalogPushWireBody, now: Date = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hash = createHash('sha256').update(JSON.stringify(wireBody)).digest('hex').slice(0, 12);
  return `px-catalog-${ymd}-${hash}`;
}

export interface CatalogPushOutcome {
  /** false = MCN_BRIDGE_URL/BRIDGE_PX_SECRET belum diset — nol percobaan jaringan dilakukan. */
  configured: boolean;
  ok: boolean;
  status: number;
  batchKey: string;
  rowsSent: number;
  rowsReceived?: number;
  duplicate?: boolean;
  error?: string;
}

export interface CatalogPushOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
}

/** pushCatalogSnapshot — POST snapshot ke bridge MCN. Tidak pernah melempar (lihat docblock berkas). */
export async function pushCatalogSnapshot(
  payload: productexchange.PxCatalogSnapshotPayload,
  opts: CatalogPushOptions = {},
): Promise<CatalogPushOutcome> {
  const url = process.env.MCN_BRIDGE_URL;
  const secret = process.env.BRIDGE_PX_SECRET;
  const wireBody = toWireBody(payload);
  const batchKey = catalogPushIdempotencyKey(wireBody, opts.now);

  if (!url || !secret) {
    return {
      configured: false,
      ok: false,
      status: 0,
      batchKey,
      rowsSent: wireBody.rows.length,
      error: 'not_configured',
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/api/bridge/px-catalog`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Idempotency-Key': batchKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(wireBody),
    });
    const bodyJson = (await res.json().catch(() => null)) as {
      batch_key?: string;
      rows_received?: number;
      duplicate?: boolean;
      error?: string;
    } | null;
    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        status: res.status,
        batchKey,
        rowsSent: wireBody.rows.length,
        error: bodyJson?.error ?? `http_${res.status}`,
      };
    }
    return {
      configured: true,
      ok: true,
      status: res.status,
      batchKey,
      rowsSent: wireBody.rows.length,
      rowsReceived: bodyJson?.rows_received,
      duplicate: bodyJson?.duplicate,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      status: 0,
      batchKey,
      rowsSent: wireBody.rows.length,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
