/** /api/v1/dependencies — declare (POST) and list (GET) cross-Brief Dependencies (M11 §5.1). */
import { dependency } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { dependencyToWire } from '@/lib/wire';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<{
      source_type?: string; source_id?: string; target_type?: string; target_id?: string; type?: string; note?: string;
    }>(request);
    const dep = await dependency.createDependency(db(), actor, {
      sourceType: b.source_type, sourceId: b.source_id ?? '', targetType: b.target_type,
      targetId: b.target_id ?? '', type: b.type ?? '', note: b.note,
    });
    return json(dependencyToWire(dep));
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const url = new URL(request.url);
    const deps = await dependency.listDependencies(
      db(), actor, url.searchParams.get('source') ?? '', url.searchParams.get('target') ?? '',
    );
    return json({ data: deps.map(dependencyToWire) });
  });
}
