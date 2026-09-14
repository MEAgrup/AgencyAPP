// F-6 (feedback lapangan 2026-09-14) — Daily Activity (DACT-) data layer.
// Mirrors apps/api DailyActivityWire exactly (snake_case, keys identical);
// registered in shape-parity.
import { api } from '@/lib/api';

export const ACTIVITY_TYPES = [
  'Meeting Klien',
  'Meeting Internal',
  'Training',
  'Webinar',
  'Input Data',
  'Lainnya',
] as const;

export interface DailyActivity {
  id: string;
  employee_id: string;
  employee_nama: string;
  divisi: string;
  activity_type: string;
  activity_date: string; // YYYY-MM-DD
  jam_mulai: string; // HH:MM
  jam_selesai: string | null; // HH:MM
  keterangan: string;
  bukti_pelaksanaan: string | null;
  created_at: string; // RFC3339
}

export interface LogDailyActivityInput {
  activity_type: string;
  activity_date: string;
  jam_mulai: string;
  jam_selesai?: string;
  keterangan: string;
  bukti_pelaksanaan?: string;
}

/** GET /daily-activities?employee_id=&from=&to= → {data: DailyActivity[]}.
 *  Row scope is entirely RLS's — staff gets own rows, Lead/SPV the division,
 *  OD/Director everything; `employee_id` here only NARROWS what the caller
 *  is already allowed to see. */
export function listDailyActivities(filter: { employeeId?: string; from?: string; to?: string } = {}): Promise<{ data: DailyActivity[] }> {
  const params = new URLSearchParams();
  if (filter.employeeId) params.set('employee_id', filter.employeeId);
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  const qs = params.toString();
  return api.get<{ data: DailyActivity[] }>(`/daily-activities${qs ? `?${qs}` : ''}`);
}

/** POST /daily-activities → DailyActivity (object directly). */
export function logDailyActivity(input: LogDailyActivityInput): Promise<DailyActivity> {
  return api.post<DailyActivity>('/daily-activities', input);
}
