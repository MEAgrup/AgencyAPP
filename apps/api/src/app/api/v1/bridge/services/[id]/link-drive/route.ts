/**
 * POST /api/v1/bridge/services/{id}/link-drive — isi/ganti/kosongkan link
 * Google Drive daftar kerja satu layanan bridge MEAGO (BRIDGE-LIVESTREAM,
 * keputusan pemilik 2026-11-05). Gerbang di domain (`bridge.setLinkDrive`):
 * lead Account / Director / AM klien; hanya layanan `sumber='meago'`; beraudit.
 */
import { bridge } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { layananBridgeToWire } from '@/lib/wire';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const body = await readJson<{ link_drive?: string | null }>(request);
    const result = await bridge.setLinkDrive(db(), actor, id, body.link_drive ?? null);
    return json(layananBridgeToWire(result));
  });
}
