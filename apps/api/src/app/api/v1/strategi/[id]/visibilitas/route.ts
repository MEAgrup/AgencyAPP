/**
 * PUT /api/v1/strategi/{id}/visibilitas — A-10 / Rule 16(b), the AM's toggle.
 *
 * **One field per call, not a batch.** Rule 16(b) requires the toggle to be
 * audit-logged, and the log exists to answer "who decided the client could see
 * the margin figure". A batch body writes "12 fields changed" into that log,
 * which answers nothing — so the shape of the endpoint is the shape of the
 * question the audit row has to be able to answer.
 *
 * The response is the WHOLE overlay rather than the one row that changed: the
 * §4.1 map is what the form draws from, and returning a single row would push
 * the FE into merging server state into its own copy — the way two copies of one
 * map start disagreeing.
 *
 * There is no GET here. The overlay ships inside `GET /strategi/{id}` as
 * `visibilitas`, so the editor page loads it in the request it already makes.
 */
import { strategi } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { strategiFieldVisibilityToWire } from '@/lib/wire';

interface Body {
  field_id?: unknown;
  visibilitas?: unknown;
}

/**
 * Both values go through as strings and are judged in the domain, on purpose. A
 * route that pre-filtered `field_id` against its own list of valid IDs would be
 * the third copy of the §4.1 map; `visibility.tierOf` answering `null` is the
 * single refusal, and it already returns the BI message for an unknown field.
 */
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<Body>(request);
    const rows = await strategi.setFieldVisibility(
      db(),
      actor,
      id,
      str(b.field_id),
      str(b.visibilitas),
    );
    return json({ visibilitas: rows.map(strategiFieldVisibilityToWire) });
  });
}
