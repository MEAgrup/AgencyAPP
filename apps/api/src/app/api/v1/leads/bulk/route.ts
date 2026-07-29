/**
 * POST /api/v1/leads/bulk — the Marketing bulk-import door (M1 §3). Ports Go's
 * handleBulkImportLeads: many registration rows processed with import-door
 * semantics (one transaction per row, duplicates blocked per row, ids minted only
 * for valid rows), answering the per-row report, the §3 Flow-7 summary line, and
 * the downloadable rejection list.
 *
 * The write gate lives in the domain (Marketing/Director only) so it cannot be
 * bypassed by another caller; a denied actor gets 403 for the whole request
 * rather than a report full of rejected rows.
 */
import { leads } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { bulkReportToWire } from '@/lib/wire';

interface Body {
  campaign_id?: string;
  rows?: { lead_name?: string; phone_number?: string; email?: string; source?: string }[];
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<Body>(request);
    const rows = (b.rows ?? []).map((r) => ({
      leadName: r.lead_name ?? '',
      phoneNumber: r.phone_number ?? '',
      email: r.email ?? '',
      source: r.source ?? '',
    }));
    const report = await leads.bulkImport(db(), actor, b.campaign_id ?? '', rows);
    return json(bulkReportToWire(report));
  });
}
