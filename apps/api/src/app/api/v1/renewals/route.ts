/**
 * GET /api/v1/renewals — list renewal/cross-sell requests (R-03) across every
 * client, newest first. Mirrors GET /attempts: response is `{data: [...]}` in
 * snake_case, the optional `?status=` filter is applied in SQL, and row scope
 * is the RLS safety net (`renewal_requests_select`) rather than an extra TS
 * gate — same posture as `sales.listAttempts`. Built for the "Perlu
 * Persetujuan Saya" inbox (Sales lead / Director), which needs Renewal
 * requests across clients, not `GET /clients/{id}/renewals`'s one-client view.
 */
import { renewal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { renewalListRowToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const status = new URL(request.url).searchParams.get('status') ?? '';
    const rows = await readAsActor(actor, (sql) => renewal.listRenewals(sql, { status }));
    return json({ data: rows.map(renewalListRowToWire) });
  });
}
