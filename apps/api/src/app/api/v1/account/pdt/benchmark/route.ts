/**
 * /api/v1/account/pdt/benchmark — PDT G2-02, Director-only kalibrasi
 * `pdt_benchmark` (PDT-21 Rule 25: "mengubah ambang tidak boleh lagi butuh
 * migrasi+deploy"). Preseden HURUF PER HURUF
 * `/api/v1/px/eligibility-policy` (`productexchange.canKelolaPolicy`).
 *
 * `pdt_benchmark` sengaja NOL policy RLS (dibaca/ditulis HANYA service-role,
 * gerbang Director di domain `pdt.canKelolaBenchmark`) — route ini memakai
 * `db()`, BUKAN `readAsActor`, sama pola `GET /account/pdt/laporan`.
 *
 * TikTok SAJA didukung hari ini (`platform` query/body param, default
 * `'tiktok'`) — `pdt.tambahVersiBenchmark` menolak platform lain (Shopee
 * tidak memakai `pdt_benchmark` sama sekali, lihat docblock domain).
 */
import { pdt } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { pdtBenchmarkVersiToWire } from '@/lib/wire';

interface PdtBenchmarkVersiBody {
  platform?: string;
  nilai: unknown;
  catatan?: string;
  aktif?: boolean;
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;
    const platform = params.get('platform') ?? 'tiktok';
    const rows = await pdt.listBenchmarkVersi(db(), actor, platform);
    return json({ data: rows.map(pdtBenchmarkVersiToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const b = await readJson<PdtBenchmarkVersiBody>(request);
    const row = await pdt.tambahVersiBenchmark(db(), actor, {
      platform: b.platform ?? 'tiktok',
      nilai: b.nilai,
      catatan: b.catatan ?? '',
      aktif: b.aktif,
    });
    return json(pdtBenchmarkVersiToWire(row), 201);
  });
}
