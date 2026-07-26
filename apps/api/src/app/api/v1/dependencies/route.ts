/**
 * /api/v1/dependencies — M11 cross-Brief Dependency (DEP-).
 *   POST: declare a Dependency (§3 step 2 / §5.1). Authority: owning AM / Account
 *         lead / Director. Validation (same Client, no dup, no cycle) is server-side.
 *   GET:  list Dependencies filtered by ?source= and/or ?target= (each optional),
 *         each with its derived status; only rows whose Client the actor may see.
 * Ports Go's handleCreateDependency / handleListDependencies.
 */
import { board } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { dependencyToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<{
      source_type?: string; source_id?: string; target_type?: string;
      target_id?: string; type?: string; note?: string;
    }>(request);
    const dep = await board.createDependency(db(), actor, {
      sourceType: b.source_type ?? '', sourceId: b.source_id ?? '', targetType: b.target_type ?? '',
      targetId: b.target_id ?? '', type: b.type ?? '', note: b.note ?? '',
    });
    return json(dependencyToWire(dep));
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const q = new URL(request.url).searchParams;
    const deps = await board.listDependencies(db(), actor, q.get('source') ?? '', q.get('target') ?? '');
    return json({ data: deps.map(dependencyToWire) });
  });
}
