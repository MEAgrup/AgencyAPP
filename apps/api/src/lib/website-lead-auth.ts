/**
 * Verifikasi tanda tangan pintu mesin `POST /api/v1/internal/website-leads`
 * (WEBSITE-LEAD, docs/DECISIONS.md 2026-10-27). Kontrak pengirim:
 * `docs/WEBSITE_LEAD_CONTRACT.md` di repo WordPress `wp-meagency`.
 *
 *   X-MEA-Timestamp        detik Unix UTC
 *   X-MEA-Idempotency-Key  UUID v4, sama dengan `idempotency_key` di body
 *   X-MEA-Signature        "sha256=" + hex huruf kecil HMAC-SHA256(secret, "{timestamp}.{raw_body}")
 *
 * Secret-nya SENDIRI, `WEBSITE_LEAD_SECRET` — bukan `BRIDGE_INGEST_SECRET` atau
 * `CRON_SECRET` (`bridge-auth.ts` menjelaskan kenapa kredensial dipisah). Sama
 * fail-closed-nya: secret kosong ⇒ setiap request ditolak.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Selisih maksimum jam pengirim dan penerima (detik). */
export const MAX_SKEW_SECONDS = 300;

/** Tanda tangan kontrak v1 untuk satu body. Diekspor untuk test. */
export function sign(secret: string, timestamp: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

/**
 * websiteLeadSignatureOk memeriksa secret, timestamp, dan tanda tangan atas
 * byte body PERSIS (`rawBody`, dibaca sebagai teks sebelum di-parse). `nowSeconds`
 * hanya untuk test.
 */
export function websiteLeadSignatureOk(
  request: Request,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const secret = process.env.WEBSITE_LEAD_SECRET;
  if (!secret) return false; // tidak dikonfigurasi = tertutup
  const timestamp = request.headers.get('x-mea-timestamp') ?? '';
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const got = Buffer.from(request.headers.get('x-mea-signature') ?? '', 'utf8');
  const expected = Buffer.from(sign(secret, timestamp, rawBody), 'utf8');
  return got.length === expected.length && timingSafeEqual(got, expected);
}
