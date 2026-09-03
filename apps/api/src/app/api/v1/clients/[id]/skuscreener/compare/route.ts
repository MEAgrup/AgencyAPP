/**
 * MEA SKU Screener — Modul B (SC-08).
 *
 *  - POST /api/v1/clients/{id}/skuscreener/compare — before/after comparison
 *    from two "Performa Produk" exports of different periods.
 */
import { skuscreener } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { screeningRunDetailToWire } from '@/lib/wire';

interface NamedSheetWire { name: string; aoa: unknown[][] }
interface BerkasWire { nama_berkas: string; sha256: string; ukuran_bytes: number; peran: string }

interface RunCompareWire {
  sheets_sebelum?: NamedSheetWire[];
  sheets_sesudah?: NamedSheetWire[];
  min_klik_sesudah?: number;
  berkas?: BerkasWire[];
}

function toInput(clientId: string, b: RunCompareWire): skuscreener.RunCompareInput {
  return {
    clientId,
    sheetsBefore: (b.sheets_sebelum ?? []).map((s) => ({ name: s.name, aoa: s.aoa })),
    sheetsAfter: (b.sheets_sesudah ?? []).map((s) => ({ name: s.name, aoa: s.aoa })),
    minKlikSesudah: b.min_klik_sesudah,
    berkas: (b.berkas ?? []).map((f) => ({
      namaBerkas: f.nama_berkas, sha256: f.sha256, ukuranBytes: Number(f.ukuran_bytes),
      peran: f.peran as skuscreener.ScreeningBerkasInput['peran'],
    })),
  };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<RunCompareWire>(request);
    const d = await skuscreener.runCompare(db(), actor, toInput(id, b));
    return json(screeningRunDetailToWire(d), 201);
  });
}
