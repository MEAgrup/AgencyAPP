/**
 * POST /api/v1/client-portal/complaints — M15 Rule 5, the third complaint door.
 *
 * Creates a standard `CPL-` with `source='Client Portal'` and the submitting
 * contact recorded, routed to the AM exactly like a WhatsApp-logged one, and
 * returns the acknowledgment immediately.
 *
 * There is deliberately NO GET here. M15 Rule 6 confirmed complaint history is
 * submit-only: a client does not see a personal complaint log in the Portal, and
 * follow-up stays with the AM. Adding a read later is a product decision, not a
 * convenience — hence no stub.
 *
 * Rate limited 5/contact/hour + 20/IP/hour in the domain (spec §5.2), mapped to
 * 429 by `mapError`.
 */
import { clientPortal } from '@cdps/domain';
import { requireClientContactActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { clientIp, handle, json, readJson } from '@/lib/http';
import { portalComplaintAckToWire } from '@/lib/wire';

interface Body {
  deskripsi?: string;
  severity?: string | null;
  lampiran?: string | null;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireClientContactActor(request);
    const b = await readJson<Body>(request);
    const ack = await clientPortal.submitComplaint(db(), actor, {
      deskripsi: b.deskripsi ?? '',
      severity: b.severity ?? null,
      lampiran: b.lampiran ?? null,
      // The IP is taken from the request headers, never from the body — a
      // client-supplied value would let the per-IP limb be trivially evaded.
      ip: clientIp(request),
    });
    return json(portalComplaintAckToWire(ack), 201);
  });
}
