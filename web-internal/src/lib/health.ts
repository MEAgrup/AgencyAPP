// Typed wrapper over lib/api.ts for Module 13 (Client Health) endpoints.
// Shapes mirror backend/internal/module13_health/{snapshot.go,health.go,roas.go}
// exactly — read from the handler code, never invented. All fields computed
// server-side (score, band, weights, component metrics); frontend renders
// read-only from JSON, never recalculates.

import { api } from '@/lib/api';
import type { Role } from '@/lib/types';

export interface Component {
  name: string; // 'gmv_growth', 'roas_attainment', etc. — stable keys for logic
  included: boolean;
  raw: number | null; // uncapped, null when excluded
  capped: number | null; // 0–100, null when excluded
  base_weight: number; // from 100
  effective_weight: number; // after redistribution (0 when excluded)
  excluded_reason?: string; // omitempty — only present when included:false
}

export interface Snapshot {
  id: string; // empty string on live preview
  client_id: string;
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
  final_health_score: number | null; // *float64, null when all-excluded
  score_display: string; // pre-formatted "74.60" or "—"
  band: string; // 'Healthy', 'Watch', 'At Risk', or '' (empty)
  roas_toggle_state: boolean; // snapshot of toggle at compute time
  components: Component[]; // array of 7 items, stable order
  computed_at?: string; // RFC3339, omitted on preview
  computed_by?: string; // omitted on preview
  preview: boolean;
}

export interface ScanResult {
  period: string; // YYYYMM
  snapshots_made: number;
  band_drops_flagged: number;
}

export interface ROASToggle {
  client_id: string;
  override: boolean | null;
  has_ads: boolean;
  has_active: boolean;
  effective: boolean; // live state at query time
}

// Component name constants (in backend compute order, §3)
export const COMPONENT_NAMES = [
  'gmv_growth',
  'roas_attainment',
  'task_completion',
  'revision_burden',
  'complaints',
  'satisfaction',
  'payment_timeliness',
] as const;

// Component display labels (PRD istilah persis)
export const COMPONENT_LABELS: Record<string, string> = {
  gmv_growth: 'GMV Growth',
  roas_attainment: 'ROAS Attainment',
  task_completion: 'Task Completion Rate',
  revision_burden: 'Revision Burden',
  complaints: 'Complaints',
  satisfaction: 'Satisfaction',
  payment_timeliness: 'Payment Timeliness',
};

// Band enum (verbatim dari API, tidak diterjemahkan per PRD)
export const BAND_VALUES = ['Healthy', 'Watch', 'At Risk'] as const;

export function getComponentLabel(name: string): string {
  return COMPONENT_LABELS[name] || name;
}

// UX gating for M13 write actions (run scan / ROAS toggle). Mirrors backend
// canRunScan/canToggleROAS (backend/internal/module13_health/service.go:76-95)
// short-circuit order exactly: Director always allowed (even when layered with
// OD, CLAUDE.md #6); otherwise Account division (staff/lead) without an OD
// layer. UX-only — the server remains the authority on permissions.
export function canManageHealth(role: Role | null): boolean {
  if (!role) return false;
  if (role.director) return true;
  if (role.od) return false;
  return role.division === 'Account' && (role.level === 'staff' || role.level === 'lead');
}

export function getTriggerScan(): Promise<ScanResult> {
  return api.post<ScanResult>('/health/snapshots/scan');
}

export function getSnapshot(clientId: string, period?: string): Promise<Snapshot> {
  const path = period ? `/clients/${clientId}/health?period=${period}` : `/clients/${clientId}/health`;
  return api.get<Snapshot>(path);
}

export function getTrend(clientId: string): Promise<{ data: Snapshot[] }> {
  return api.get<{ data: Snapshot[] }>(`/clients/${clientId}/health/trend`);
}

export function getPreview(clientId: string): Promise<Snapshot> {
  return api.get<Snapshot>(`/clients/${clientId}/health/preview`);
}

export function getROASToggle(clientId: string): Promise<ROASToggle> {
  return api.get<ROASToggle>(`/clients/${clientId}/health/roas-toggle`);
}

export function setROASToggle(clientId: string, override: boolean | null): Promise<ROASToggle> {
  // override can be true, false, or null (clear to default)
  const body = override === null ? {} : { override };
  return api.put<ROASToggle>(`/clients/${clientId}/health/roas-toggle`, body);
}
