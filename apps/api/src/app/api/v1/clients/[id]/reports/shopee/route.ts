/**
 * Mesin Laporan Klien Shopee (Gelombang 2 SH-06) — `cdps.report.shopee.v1`.
 *
 *  - POST /api/v1/clients/{id}/reports/shopee — build ONE Shopee report from
 *    the uploaded exports, store it (same `client_reports` table, dispatched
 *    by `payload_schema`), rewrite `clients.total_sales`, and — the "no
 *    manual upload" path for M6D RM-C — attribute the report's own combined
 *    Ads spend/omzet as an auto Metric Entry (`MTR-`,
 *    `entry_method='File Export'`) across the client's overlapping active
 *    `Shopee Ads` campaign(s).
 *
 * A sibling of `../route.ts` (TikTok), not a branch inside it: unlike
 * TikTok, Shopee's engine needs `periode`/`periode_mulai`/`periode_akhir` as
 * REQUIRED inputs (no file-derived range at all — see
 * `@cdps/domain` report.ts `CreateReportShopeeInput`), and takes an
 * `exclude_campaign_ids` the TikTok body has no equivalent for. Same thin-shell
 * contract otherwise: resolve actor → map wire → call domain → map back.
 */
import { report } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { clientReportDetailToWire } from '@/lib/wire';

interface SheetFileWire {
  filename: string;
  aoa: unknown[][];
  sha256: string;
  ukuran_bytes: number;
  tipe_override?: string | null;
}

interface CreateReportShopeeWire {
  client_platform_id?: number;
  periode_tipe?: report.CreateReportShopeeInput['periodeTipe'];
  files?: SheetFileWire[];
  periode?: string;
  periode_mulai?: string;
  periode_akhir?: string;
  exclude_campaign_ids?: string[];
}

function toCreateInput(b: CreateReportShopeeWire): report.CreateReportShopeeInput {
  return {
    clientPlatformId: Number(b.client_platform_id ?? 0),
    periodeTipe: (b.periode_tipe ?? 'bulanan') as report.CreateReportShopeeInput['periodeTipe'],
    files: (b.files ?? []).map((f) => ({
      filename: f.filename,
      aoa: f.aoa,
      sha256: f.sha256,
      ukuranBytes: Number(f.ukuran_bytes),
      tipeOverride: f.tipe_override ?? null,
    })),
    periode: b.periode ?? '',
    periodeMulai: b.periode_mulai ?? '',
    periodeAkhir: b.periode_akhir ?? '',
    excludeCampaignIds: b.exclude_campaign_ids ?? [],
  };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<CreateReportShopeeWire>(request);
    const d = await report.createReportShopee(db(), actor, id, toCreateInput(b));
    return json(clientReportDetailToWire(d), 201);
  });
}
