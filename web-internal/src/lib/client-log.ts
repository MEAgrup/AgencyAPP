'use client';

// Log Aktivitas Klien (Improvement Req Account butir 5, pemilik 2026-09-30).
// Mirrors `ClientLogEntryWire` (apps/api/src/lib/wire.ts). Data mentahnya
// audit_log immutable; file ini hanya menerjemahkan kode aksi ke kalimat yang
// dibaca orang Account. Label yang tidak dikenal jatuh ke kode aslinya — tidak
// pernah disembunyikan.

import { api } from '@/lib/api';

export interface ClientLogEntry {
  id: number;
  entity_type: string;
  entity_id: string;
  actor_employee_id: string;
  actor_nama: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

export function getClientActivityLog(clientId: string): Promise<{ data: ClientLogEntry[] }> {
  return api.get<{ data: ClientLogEntry[] }>(`/clients/${encodeURIComponent(clientId)}/activity-log`);
}

/** Nama jenis entitas untuk kolom "Objek". */
export const ENTITY_LABEL: Record<string, string> = {
  client: 'Klien',
  contract: 'Kontrak',
  service: 'Service',
  service_plan_gate: 'Gerbang Plan',
  strategy_plan: 'Strategy (STR)',
  strategi: 'Strategi',
  plan: 'Plan',
  brief: 'Brief',
  brief_stage: 'Tahapan Brief',
  ad_campaign: 'Kampanye Iklan',
  complaint: 'Komplain',
  client_milestone: 'Milestone',
  renewal_request: 'Renewal',
  weekly_result_recap: 'Rekap Mingguan',
};

/** Kategori filter — mengelompokkan entity_type yang dibaca bersama. */
export const LOG_FILTERS: { key: string; label: string; types: string[] }[] = [
  { key: 'semua', label: 'Semua', types: [] },
  { key: 'klien', label: 'Klien & AM', types: ['client', 'contract', 'renewal_request'] },
  { key: 'service', label: 'Service', types: ['service', 'service_plan_gate'] },
  { key: 'strategi', label: 'Strategi & Plan', types: ['strategi', 'strategy_plan', 'plan'] },
  { key: 'brief', label: 'Brief & Eksekusi', types: ['brief', 'brief_stage', 'ad_campaign'] },
  { key: 'lain', label: 'Komplain & Lainnya', types: ['complaint', 'client_milestone', 'weekly_result_recap'] },
];

const ACTION_LABEL: Record<string, string> = {
  create: 'Dibuat',
  closing: 'Closing oleh Sales',
  released_to_account: 'Dirilis ke Account (pembayaran terverifikasi)',
  am_assigned: 'AM di-assign oleh Head of Account',
  am_reassigned: 'AM dipindahkan (reassign)',
  client_field_edited: 'Data klien dikoreksi',
  platform_added: 'Platform ditambahkan',
  platform_updated: 'Platform diperbarui',
  service_hold_requested: 'Pengajuan Hold Service',
  service_held: 'Hold Service disetujui',
  service_hold_rejected: 'Pengajuan Hold ditolak',
  service_resumed: 'Service dilanjutkan (resume)',
  service_void_requested: 'Pengajuan Void Service',
  service_voided: 'Void Service disetujui',
  service_void_rejected: 'Pengajuan Void ditolak',
  service_closure_requested: 'Pengajuan Service selesai',
  service_closed: 'Service selesai (disetujui Director)',
  service_closure_rejected: 'Pengajuan Service selesai ditolak',
  strategy_requirement_override: 'Kebutuhan Strategy di-override',
  decide: 'Keputusan gerbang Plan',
  strategy_approved: 'Strategy disetujui',
  revision_requested: 'Revisi diminta',
  revision_feedback: 'Catatan revisi dari AM',
  pic_assigned: 'PIC ditetapkan',
  brief_dikirim_ulang: 'Brief direvisi & dikirim ulang AM',
  periode_iklan_dicatat: 'Periode iklan dicatat',
  attach_service: 'Service dilekatkan ke kontrak',
  detach_service: 'Service dilepas dari kontrak',
  update: 'Diperbarui',
  generate: 'Plan dibuat',
  dikembalikan: 'Dikembalikan',
  milestone_created: 'Milestone dibuat',
  execute: 'Renewal dieksekusi',
};

/** labelAksi — kalimat untuk satu baris log. Transisi status dibaca "A → B". */
export function labelAksi(e: Pick<ClientLogEntry, 'action' | 'entity_type'>): string {
  if (e.action.startsWith('transition:')) {
    const [from, to] = e.action.slice('transition:'.length).split('->');
    const obj = e.entity_type === 'brief_stage' ? 'Tahap' : 'Status';
    return `${obj}: ${from || '—'} → ${to || '—'}`;
  }
  return ACTION_LABEL[e.action] ?? e.action;
}
