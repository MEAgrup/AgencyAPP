/**
 * MEA SKU Screener — Modul A (SC-08).
 *
 *  - POST /api/v1/clients/{id}/skuscreener/screening — build one screening
 *    run from an uploaded "Bisnis Saya → Performa Produk" export (+ optional
 *    Ads CPC export), store it. Thin shell: the browser only converts
 *    xlsx→AoA and hashes (RAB-04 pattern); the server parses/scores.
 */
import { skuscreener } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { screeningRunDetailToWire } from '@/lib/wire';

interface NamedSheetWire { name: string; aoa: unknown[][] }
interface BerkasWire { nama_berkas: string; sha256: string; ukuran_bytes: number; peran: string }

interface RunScreeningWire {
  sheets?: NamedSheetWire[];
  ads_csv_rows?: unknown[][] | null;
  target_roas?: number;
  cpc_pasar_kategori?: number | null;
  faktor_cr_iklan?: number;
  berkas?: BerkasWire[];
}

function toInput(clientId: string, b: RunScreeningWire): skuscreener.RunScreeningInput {
  return {
    clientId,
    sheets: (b.sheets ?? []).map((s) => ({ name: s.name, aoa: s.aoa })),
    adsCsvRows: b.ads_csv_rows ?? null,
    targetRoas: Number(b.target_roas ?? 0),
    cpcPasarKategori: b.cpc_pasar_kategori ?? null,
    faktorCrIklan: b.faktor_cr_iklan,
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
    const b = await readJson<RunScreeningWire>(request);
    const d = await skuscreener.runScreening(db(), actor, toInput(id, b));
    return json(screeningRunDetailToWire(d), 201);
  });
}
