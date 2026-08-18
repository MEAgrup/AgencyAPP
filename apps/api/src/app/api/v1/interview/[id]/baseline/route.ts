/**
 * Riset Awal Baseline (RAB-04) — the per-platform baseline of "Kelola Klien".
 *
 *  - GET  /api/v1/interview/{id}/baseline — read every platform's baseline row
 *    plus the auto-filled interview fields (RAB-05) awaiting confirmation.
 *  - POST /api/v1/interview/{id}/baseline — submit ONE active platform's baseline
 *    (TikTok Shop = engine payload; every other platform = minimal manual entry).
 *
 * The route is a thin shell: resolve the actor, map the snake_case body to the
 * camelCase domain input, call the domain, map back through wire.ts. The engine
 * payload is computed in the browser (Supabase Storage is not configured, so no
 * binary is uploaded); the server re-stamps `generated_at` and re-derives the
 * store condition from the score, so a tampered payload is rejected.
 */
import { risetAwal } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { risetAwalBaselineToWire } from '@/lib/wire';

interface ManualWire {
  gmv_bulan?: number | null;
  order?: number | null;
  aov?: number | null;
  sku_total?: number | null;
  belanja_iklan?: number | null;
  roas?: number | null;
  periode_mulai?: string | null;
  periode_akhir?: string | null;
  tanggal_ambil?: string | null;
}

interface SumberBerkasWire {
  nama_berkas: string;
  sha256: string;
  ukuran_bytes: number;
  tipe_terdeteksi?: string | null;
  tipe_override?: string | null;
  jumlah_baris?: number | null;
  periode?: { mulai?: string | null; akhir?: string | null } | null;
  tanggal_ambil?: string | null;
}

interface SheetFileWire {
  filename: string;
  aoa: unknown[][];
  sha256: string;
  ukuran_bytes: number;
  tipe_override?: string | null;
  tanggal_ambil?: string | null;
}

interface AnalisaWire {
  files: SheetFileWire[];
  hist?: unknown[];
  net?: boolean;
  linked_accounts?: string[];
}

interface SubmitWire {
  client_platform_id?: number;
  analisa?: AnalisaWire;
  manual?: ManualWire;
  sumber_berkas?: SumberBerkasWire[];
}

function toSubmitInput(b: SubmitWire): risetAwal.SubmitBaselineInput {
  return {
    clientPlatformId: Number(b.client_platform_id ?? 0),
    analisa: b.analisa
      ? {
          files: (b.analisa.files ?? []).map((f) => ({
            filename: f.filename,
            aoa: f.aoa,
            sha256: f.sha256,
            ukuranBytes: Number(f.ukuran_bytes),
            tipeOverride: f.tipe_override ?? null,
            tanggalAmbil: f.tanggal_ambil ?? null,
          })),
          hist: (b.analisa.hist ?? []) as risetAwal.AnalisaPenuhInput['hist'],
          net: b.analisa.net,
          linkedAccounts: b.analisa.linked_accounts,
        }
      : undefined,
    manual: b.manual
      ? {
          gmvBulan: b.manual.gmv_bulan ?? null,
          order: b.manual.order ?? null,
          aov: b.manual.aov ?? null,
          skuTotal: b.manual.sku_total ?? null,
          belanjaIklan: b.manual.belanja_iklan ?? null,
          roas: b.manual.roas ?? null,
          periodeMulai: b.manual.periode_mulai ?? null,
          periodeAkhir: b.manual.periode_akhir ?? null,
          tanggalAmbil: b.manual.tanggal_ambil ?? null,
        }
      : undefined,
    sumberBerkas: (b.sumber_berkas ?? []).map((s) => ({
      namaBerkas: s.nama_berkas,
      sha256: s.sha256,
      ukuranBytes: Number(s.ukuran_bytes),
      tipeTerdeteksi: s.tipe_terdeteksi ?? null,
      tipeOverride: s.tipe_override ?? null,
      jumlahBaris: s.jumlah_baris ?? null,
      periode: s.periode ?? null,
      tanggalAmbil: s.tanggal_ambil ?? null,
    })),
  };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const v = await risetAwal.getBaseline(db(), actor, id);
    return json(risetAwalBaselineToWire(v));
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<SubmitWire>(request);
    const v = await risetAwal.submitBaseline(db(), actor, id, toSubmitInput(b));
    return json(risetAwalBaselineToWire(v));
  });
}
