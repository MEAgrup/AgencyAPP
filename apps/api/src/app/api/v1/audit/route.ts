/**
 * GET /api/v1/audit?entity_type=&entity_id= — the generic entity-history reader
 * behind every audit panel in web-internal (Creative Asset history, lead detail,
 * prospect-attempt detail, demo tasks). Ports Go's handleAudit.
 *
 * Authenticated-only, exactly like Go: there is no role gate here. Row visibility
 * comes from RLS on `audit_log`, which is NARROWER than Go's (a staff caller sees
 * only entries they authored). See packages/domain/src/audit.ts for why that is
 * left alone rather than loosened here.
 */
import { audit } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { auditEntryToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const url = new URL(request.url);
    const entries = await readAsActor(actor, (sql) =>
      audit.auditTrail(sql, {
        entityType: url.searchParams.get('entity_type') ?? '',
        entityId: url.searchParams.get('entity_id') ?? '',
      }),
    );
    return json({ data: entries.map(auditEntryToWire) });
  });
}
