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
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { demoTaskToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const tasks = await readAsActor(actor, (sql) => demo.list(sql));
    // `{data: [...]}` in snake_case, as Go sends it and the list page reads it.
    return json({ data: tasks.map(demoTaskToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<{ title?: string; description?: string }>(request);
    const task = await demo.create(db(), actor, {
      title: body.title ?? '',
      description: body.description,
    });
    // Go returns the created task UNWRAPPED. Kept identical rather than "improved"
    // to a `{task}` envelope: no client reads this body today, so a divergence
    // here would only surface later, as a blank page nobody could explain.
    // The 201 is a deliberate deviation from Go's 200 — it is the correct code for
    // a creation, and no client branches on the status.
    return json(demoTaskToWire(task), 201);
  });
}
