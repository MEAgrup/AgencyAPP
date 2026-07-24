/**
 * /api/v1/demo-tasks — list (GET) and create (POST) demo tasks.
 *
 * Thin shell over @cdps/domain `demo`: resolve the actor from the JWT, validate
 * inputs (the BI `[...]` gate lives in the domain layer), then call the service,
 * which composes ident + insert + audit in one @cdps/db transaction. Ports Go's
 * handleListDemoTasks / handleCreateDemoTask.
 */
import { demo } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const tasks = await demo.list(db());
    return json({ tasks });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = await requireActor(request);
    const body = await readJson<{ title?: string; description?: string }>(request);
    const task = await demo.create(db(), actor, {
      title: body.title ?? '',
      description: body.description,
    });
    return json({ task }, 201);
  });
}
