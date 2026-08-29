// Typed wrapper over lib/api.ts for Permintaan (REQ-, M16 §5.5).
// Shapes mirror apps/api/src/lib/wire.ts EXACTLY (snake_case, explicit nulls —
// a missing key is worse than a null, per CLAUDE.md's O43 note).
//
// Permintaan is a divisi request TERKAIT KLIEN (Top-up Saldo / Contract
// Creator / Creator Payment Approval) — deliberately separate from Penugasan
// Internal (`penugasan.ts`, TSK-, which is sengaja WITHOUT client/service) and
// from Task M12. Keterlambatan is DERIVED server-side at read time — this
// file never computes it client-side.

import { api } from '@/lib/api';

export interface Permintaan {
  id: string;
  jenis: string; // 'Top-up Saldo' | 'Contract Creator' | 'Creator Payment Approval'
  judul: string;
  deskripsi: string;
  brief_id: string | null;
  service_id: string | null;
  client_id: string;
  cpr_id: string | null; // Creator Payment Approval only — menyambung CPR- (M9)
  diajukan_oleh: string;
  diajukan_divisi: string;
  tujuan_divisi: string;
  tujuan_employee_id: string | null;
  due_date: string; // "YYYY-MM-DD" — created_at + 1 hari kerja
  status: string; // [Diajukan] | [Diproses] | [Selesai] | [Ditolak]
  diproses_pada: string | null; // RFC3339
  selesai_pada: string | null; // RFC3339
  ditolak_pada: string | null; // RFC3339
  alasan_ditolak: string;
  catatan_proses: string;
  terlambat_berjalan: boolean; // still open, past due_date
  selesai_terlambat: boolean; // reached [Selesai] after due_date
  hari_terlambat: number;
  created_by: string;
  created_at: string; // RFC3339
}

export interface PermintaanPayload {
  jenis: string;
  judul: string;
  deskripsi?: string;
  brief_id?: string;
  service_id?: string;
  cpr_id?: string;
  tujuan_employee_id?: string;
}

export async function listPermintaanQueue(divisi: string): Promise<Permintaan[]> {
  const res = await api.get<{ data: Permintaan[] }>(`/permintaan?divisi=${encodeURIComponent(divisi)}`);
  return res.data;
}

export async function listPermintaanForClient(clientId: string): Promise<Permintaan[]> {
  const res = await api.get<{ data: Permintaan[] }>(`/clients/${clientId}/permintaan`);
  return res.data;
}

export async function getPermintaan(id: string): Promise<Permintaan> {
  return api.get<Permintaan>(`/permintaan/${id}`);
}

export async function createPermintaan(body: PermintaanPayload): Promise<Permintaan> {
  return api.post<Permintaan>('/permintaan', body);
}

export async function prosesPermintaan(id: string): Promise<Permintaan> {
  return api.post<Permintaan>(`/permintaan/${id}/proses`);
}

export async function selesaiPermintaan(id: string, catatan?: string): Promise<Permintaan> {
  return api.post<Permintaan>(`/permintaan/${id}/selesai`, { catatan });
}

export async function tolakPermintaan(id: string, alasan: string): Promise<Permintaan> {
  return api.post<Permintaan>(`/permintaan/${id}/tolak`, { alasan });
}
