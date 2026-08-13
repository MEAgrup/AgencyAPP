/**
 * /api/v1/admin/hari-libur — the national-holiday calendar behind every
 * "hari kerja" count (Kelola Klien SLA, owner decision 2026-08-13).
 *
 *  - GET  — list the calendar (Director/OD read).
 *  - POST — register one holiday (Director only).
 *
 * Uses the PRIVILEGED client: `hari_libur` is default-deny with no SELECT policy
 * (it is config, like `role_mappings`), so RLS cannot scope this read — the
 * Director/OD gate lives in the domain layer instead.
 */
import { admin } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { hariLiburToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const rows = await admin.listHariLibur(db(), actor);
    return json({ data: rows.map(hariLiburToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = (await readJson<Record<string, unknown>>(request)) ?? {};
    const row = await admin.addHariLibur(db(), actor, {
      tanggal: b.tanggal == null ? '' : String(b.tanggal),
      keterangan: b.keterangan == null ? '' : String(b.keterangan),
    });
    return json(hariLiburToWire(row), 201);
  });
}
