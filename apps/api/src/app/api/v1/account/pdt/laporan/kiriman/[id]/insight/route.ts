/**
 * GET/PUT /api/v1/account/pdt/laporan/kiriman/{id}/insight — M20 Gelombang C
 * (C-03), editor narasi laporan PDT (C-04).
 *
 * GET  → `pdt.bacaInsightKiriman`: revisi TERBARU + status publikasi (layar
 *        editor perlu keduanya sekaligus — narasi apa yang sedang disunting,
 *        dan label status "Draf/Terbit/Dicabut"). Permission `canKirimLaporan`
 *        DITAMBAH OD read-only, pola sama `GET .../html`.
 * PUT  → `pdt.simpanInsightKiriman`: menulis revisi BARU (append-only, R3).
 *        Body TUJUH bidang (`PdtInsightEditDraftBody`) — enam narasi sama
 *        persis draf pra-kirim (`PUT .../laporan/kirim`) plus `tahap_narasi`
 *        baru. TIDAK memindahkan paku publikasi (R4) — hanya
 *        Terbitkan/Terbitkan Ulang yang melakukan itu.
 */
import { pdt } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { BadRequestError, handle, json } from '@/lib/http';
import { pdtInsightStateToWire, pdtLaporanInsightRowToWire, toPdtInsightEditDraft, type PdtInsightEditDraftBody } from '@/lib/wire';

function parseKirimanId(id: string): number {
  const kirimanId = Number(id);
  if (!Number.isInteger(kirimanId) || kirimanId <= 0) {
    throw new BadRequestError('id is required (positive integer)');
  }
  return kirimanId;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const kirimanId = parseKirimanId((await ctx.params).id);
    const state = await pdt.bacaInsightKiriman(db(), actor, kirimanId);
    return json(pdtInsightStateToWire(state));
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const kirimanId = parseKirimanId((await ctx.params).id);
    const body = (await request.json().catch(() => ({}))) as PdtInsightEditDraftBody;
    const row = await pdt.simpanInsightKiriman(db(), actor, kirimanId, toPdtInsightEditDraft(body));
    return json(pdtLaporanInsightRowToWire(row));
  });
}
