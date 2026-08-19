/**
 * Mesin Laporan Klien (C1) — per-client report collection.
 *
 *  - GET  /api/v1/clients/{id}/reports — the client's report chain, newest first.
 *  - POST /api/v1/clients/{id}/reports — build ONE report for one active store
 *    from the uploaded exports, store it, and (the gap C1 closes) rewrite
 *    `clients.total_sales` in the 30-day run-rate unit the Health Score reads.
 *
 * Thin shell: resolve the actor, map the snake_case body to the camelCase domain
 * input, call the domain, map back through wire.ts. The engine runs SERVER-SIDE
 * (the browser only parses xlsx to rows + sha256); the server re-stamps
 * `generated_at` with its own clock, so a tampered payload cannot shift a score.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { clientReportDetailToWire, clientReportSummaryToWire } from '@/lib/wire';

interface SheetFileWire {
  filename: string;
  aoa: unknown[][];
  sha256: string;
  ukuran_bytes: number;
  tipe_override?: string | null;
}

interface CreateReportWire {
  client_platform_id?: number;
  periode_tipe?: report.CreateReportInput['periodeTipe'];
  files?: SheetFileWire[];
  net?: boolean;
  linked_accounts?: string[];
  periode_mulai?: string | null;
  periode_akhir?: string | null;
}

function toCreateInput(b: CreateReportWire): report.CreateReportInput {
  return {
    clientPlatformId: Number(b.client_platform_id ?? 0),
    periodeTipe: (b.periode_tipe ?? 'bulanan') as report.CreateReportInput['periodeTipe'],
    files: (b.files ?? []).map((f) => ({
      filename: f.filename,
      aoa: f.aoa,
      sha256: f.sha256,
      ukuranBytes: Number(f.ukuran_bytes),
      tipeOverride: f.tipe_override ?? null,
    })),
    net: b.net,
    linkedAccounts: b.linked_accounts,
    periodeMulai: b.periode_mulai ?? null,
    periodeAkhir: b.periode_akhir ?? null,
  };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const rows = await report.listReports(db(), actor, id);
    return json({ data: rows.map(clientReportSummaryToWire) });
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<CreateReportWire>(request);
    const d = await report.createReport(db(), actor, id, toCreateInput(b));
    return json(clientReportDetailToWire(d), 201);
  });
}
