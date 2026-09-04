/**
 * TikTok Ads Scanner — run one weekly scan (Gelombang 4, AS-01..AS-04).
 *
 *  - POST /api/v1/clients/{id}/adsscanner/scan — detect the uploaded TikTok
 *    Shop exports into the engine's 4 slots, score them, store one frozen
 *    `adsscanner_run` row. Thin shell: the browser only converts xlsx→AoA and
 *    hashes (RAB-04 pattern); the server detects, parses, and scores.
 */
import { adsscanner } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { adsScanRunDetailToWire } from '@/lib/wire';

interface FileWire {
  nama_berkas?: string;
  sha256?: string;
  ukuran_bytes?: number;
  aoa?: unknown[][];
  tipe_override?: string | null;
  video_kind_override?: string | null;
}

interface CfgWire {
  gate_scale?: number;
  gate_consider?: number;
  gate_yellow?: number;
  test_budget_daily?: number;
  scale_step_pct?: number;
  min_aov?: number;
  blacklist?: string[];
  usd_rate?: number;
  winner_pctl?: number;
}

interface RunAdsScanWire {
  kategori?: string;
  mode?: string;
  minggu_mulai?: string | null;
  cfg?: CfgWire | null;
  files?: FileWire[];
}

/** snake_case wire → camelCase domain. Only keys actually present are forwarded, so an omitted threshold falls back to the engine default rather than to `undefined`-as-a-value. */
function toCfg(c: CfgWire | null | undefined): adsscanner.AdsScanConfigInput | undefined {
  if (!c) return undefined;
  const out: adsscanner.AdsScanConfigInput = {};
  if (c.gate_scale !== undefined) out.gateScale = Number(c.gate_scale);
  if (c.gate_consider !== undefined) out.gateConsider = Number(c.gate_consider);
  if (c.gate_yellow !== undefined) out.gateYellow = Number(c.gate_yellow);
  if (c.test_budget_daily !== undefined) out.testBudgetDaily = Number(c.test_budget_daily);
  if (c.scale_step_pct !== undefined) out.scaleStepPct = Number(c.scale_step_pct);
  if (c.min_aov !== undefined) out.minAov = Number(c.min_aov);
  if (c.blacklist !== undefined) out.blacklist = (c.blacklist ?? []).map(String);
  if (c.usd_rate !== undefined) out.usdRate = Number(c.usd_rate);
  if (c.winner_pctl !== undefined) out.winnerPctl = Number(c.winner_pctl);
  return out;
}

function toInput(clientId: string, b: RunAdsScanWire): adsscanner.RunAdsScanInput {
  return {
    clientId,
    kategori: String(b.kategori ?? ''),
    // An unrecognised mode is passed through as-is so the domain's own
    // `MSG_MODE_TIDAK_VALID` answers it — the route does not silently coerce a
    // typo to 'weekly' and score the wrong thing.
    mode: b.mode === undefined || b.mode === null ? undefined : (b.mode as adsscanner.RunAdsScanInput['mode']),
    mingguMulai: b.minggu_mulai ?? null,
    cfg: toCfg(b.cfg),
    files: (b.files ?? []).map((f) => ({
      namaBerkas: String(f.nama_berkas ?? ''),
      sha256: String(f.sha256 ?? ''),
      ukuranBytes: Number(f.ukuran_bytes ?? 0),
      aoa: f.aoa ?? [],
      tipeOverride: f.tipe_override ?? null,
      videoKindOverride: (f.video_kind_override as 'kreator' | 'toko' | null) ?? null,
    })),
  };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<RunAdsScanWire>(request);
    const d = await adsscanner.runAdsScan(db(), actor, toInput(id, b));
    return json(adsScanRunDetailToWire(d), 201);
  });
}
