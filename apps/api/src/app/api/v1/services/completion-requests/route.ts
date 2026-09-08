/**
 * GET /api/v1/services/completion-requests — setiap Service di
 * `[Completion Requested]`, tertua dulu (O75). Antrean "Perlu Persetujuan Saya"
 * untuk Head of Account / Director; `client.pendingCompletionRequests`
 * menggerbanginya eksplisit (`canApproveCompletion`) dan mengembalikan kosong
 * untuk siapa pun di luar itu, terlepas dari RLS.
 *
 * Segmen statis di samping `/services/[id]` yang dinamis — Next menyelesaikan
 * yang statis lebih dulu, susunan yang sama dengan `/services/hold-requests`.
 */
import { client } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { readAsActor } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { pendingCompletionRequestToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await readAsActor(actor, (sql) => client.pendingCompletionRequests(sql, actor));
    return json({ data: rows.map(pendingCompletionRequestToWire) });
  });
}
