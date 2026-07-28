/**
 * POST /api/v1/sales/quote-preview — read-only MSL v2 quote (Estimasi Nilai +
 * Komisi) for a service selection, no persistence. Ports Go's handleQuotePreview.
 *
 * The 1..5 service cap and every auto-calc live in the domain layer; this shell
 * just resolves the actor, maps the snake_case selection, and returns the quote.
 */
import { sales } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { quoteToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    requireActor(request);
    const body = await readJson<{
      services?: { master_service_id?: string; quantity?: number; amount?: string }[];
    }>(request);
    const selections = (body.services ?? []).map((s) => ({
      masterServiceId: s.master_service_id ?? '',
      quantity: s.quantity,
      amount: s.amount,
    }));
    const quote = await sales.previewQuote(db(), selections);
    // Top-level, snake_case, IDR-only — the Quote shape web-internal declares
    // (lib/sales.ts) and the one Go's handleQuotePreview writes. The mapper is
    // NOT optional: the domain Quote carries bigint money fields that
    // JSON.stringify throws on (C-03 finding).
    return json(quoteToWire(quote));
  });
}
