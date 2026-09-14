/**
 * /api/v1/daily-activities — F-6 (feedback lapangan 2026-09-14): log (POST) and
 * list (GET) daily work activities (Meeting Klien/Internal, Training, Webinar,
 * Input Data, Lainnya). Row scope is entirely RLS's (`daily_activities_select`,
 * migration 20261021010000) — staff sees own rows, Lead/SPV the whole division,
 * OD/Director everything — so GET reads through `readAsActor` and passes
 * whatever filters the caller sent straight to the domain layer.
 */
import { dailyactivity } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { dailyActivityToWire } from '@/lib/wire';

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const params = new URL(request.url).searchParams;
    const rows = await readAsActor(actor, (sql) => dailyactivity.list(sql, {
      employeeId: params.get('employee_id') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    }));
    return json({ data: rows.map(dailyActivityToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<{
      activity_type?: string;
      activity_date?: string;
      jam_mulai?: string;
      jam_selesai?: string;
      keterangan?: string;
      bukti_pelaksanaan?: string;
    }>(request);
    const activity = await dailyactivity.log(db(), actor, {
      activityType: body.activity_type ?? '',
      activityDate: body.activity_date ?? '',
      jamMulai: body.jam_mulai ?? '',
      jamSelesai: body.jam_selesai,
      keterangan: body.keterangan ?? '',
      buktiPelaksanaan: body.bukti_pelaksanaan,
    });
    return json(dailyActivityToWire(activity), 201);
  });
}
