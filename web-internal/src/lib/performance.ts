// Typed wrapper over lib/api.ts for Module 14 (Team Performance) endpoints.
// Shapes mirror backend/internal/module14_performance/*.go exactly.
// All score fields are numeric (0..100 range) or null. Field uang (IDR) tidak ada di modul ini.

import { api } from '@/lib/api';

// Component KPI yang berasal dari PRD M14 §2 (stabil, tidak pernah berubah key)
export const KPI_COMPONENTS = [
  'speed_score',
  'output_quantity',
  'gmv_impact',
  'revision_count',
  'roas_attainment',
  'optimization_activity',
  'creator_count',
  'qc_pass_rate',
  'escalation_rate',
  'chr_average',
  'complaint_resolution_speed',
  'revision_escalation_rate',
  'sourcing_turnaround', // diagnostic only untuk KOL
] as const;

export const ROLE_TYPES = ['Creative', 'Ads', 'KOL', 'AM'] as const;
export const DIVISIONS = ['Creative', 'Ads', 'KOL', 'Account'] as const; // Account = AM

// Individual component in snapshot
export interface SnapshotComponent {
  name: string; // key dari KPI_COMPONENTS
  raw: number | null;
  capped: number | null; // null untuk diagnostic (sourcing_turnaround)
  base_weight: number;
  effective_weight: number | null; // null untuk diagnostic
  included: boolean;
  excluded_reason: string | null;
  diagnostic: boolean; // true hanya untuk sourcing_turnaround di KOL
}

// Client-Outcome Modifier
export interface PerformanceModifier {
  value: number; // ±10, clamped
  raw_average: number | null;
  present: boolean; // false untuk AM atau saat tak ada data Client
  source_component: string; // key component, misal 'gmv_impact'
  source_clients: string[]; // array ID Client CLI-...
}

// Individual snapshot per staff
export interface Snapshot {
  staff_id: string;
  role_type: string; // Creative | Ads | KOL | AM
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD
  profile_score: number | null;
  final_score: number | null;
  score_display: string; // "88.40" atau "—"
  modifier: PerformanceModifier;
  components: SnapshotComponent[];
  targets_placeholder: boolean; // true = sebagian target masih ilustratif
  computed_at: string | null; // RFC3339 atau omit untuk Preview
  computed_by: string | null; // "system" atau kosong
  preview?: boolean; // true hanya untuk running_score yang tidak disimpan
}

// Team rollup summary
export interface TeamRollup {
  division: string; // Creative | Ads | KOL | Account
  period: string; // YYYYMM format
  members: TeamMember[];
  team_average: number | null;
  average_display: string; // "88.40" atau "—"
}

export interface TeamMember {
  staff_id: string;
  role_type: string; // Creative | Ads | KOL | AM
  final_score: number | null;
  score_display: string;
}

// KPI Weight config
export interface KPIWeight {
  role_type: string; // Creative | Ads | KOL | AM
  component: string; // key dari KPI_COMPONENTS
  weight: number; // 0..100, normalized ke 100% per role_type
  updated_at: string; // RFC3339
  updated_by: string; // employee_id
}

// Period Target config
export interface PeriodTarget {
  role_type: string;
  component: string;
  period_start: string; // YYYY-MM-DD atau "" untuk sentinel (semua periode)
  target_value: number;
  is_placeholder: boolean;
  updated_at: string; // RFC3339
  updated_by: string;
}

// Scan result
export interface ScanResult {
  period: string; // YYYYMM format
  snapshots_made: number;
}

// === API Functions ===

/**
 * GET /api/v1/performance/snapshots/scan (POST endpoint, diaktifkan Director)
 * Trigger monthly batch snapshot calculation untuk semua role-scored staff di semua divisi.
 * Idempotent — re-run tidak membuat duplikat.
 */
export function triggerPerformanceScan(): Promise<ScanResult> {
  return api.post<ScanResult>('/performance/snapshots/scan');
}

/**
 * GET /api/v1/staff/{id}/performance?period=YYYYMM
 * Fetch individual snapshot. Query param `period` opsional — kosong → terbaru.
 * Role gating: staff=diri sendiri, Lead/SPV=divisi staff tsb, OD/Director=semua.
 * 404 menyamarkan 403 (akses ditolak).
 */
export function getStaffPerformance(staffId: string, period?: string): Promise<Snapshot> {
  const query = period ? `?period=${period}` : '';
  return api.get<Snapshot>(`/staff/${staffId}/performance${query}`);
}

/**
 * GET /api/v1/staff/{id}/performance/trend
 * Fetch semua snapshot staff (trend history). Return array kosong [] jika belum ada snapshot.
 * 404 jika staff ada tapi actor tidak boleh lihat.
 */
export function getStaffPerformanceTrend(staffId: string): Promise<{ data: Snapshot[] }> {
  return api.get<{ data: Snapshot[] }>(`/staff/${staffId}/performance/trend`);
}

/**
 * GET /api/v1/performance/teams/{division}?period=YYYYMM
 * Fetch team rollup. Query param `period` opsional — kosong → periode terbaru yang ada data.
 * Role gating: OD/Director=divisi manapun, Lead/SPV=hanya divisi sendiri.
 * Return: period="" + members=[] jika belum ada data bulan itu (bukan error, HTTP 200).
 */
export function getTeamRollup(division: string, period?: string): Promise<TeamRollup> {
  const query = period ? `?period=${period}` : '';
  return api.get<TeamRollup>(`/performance/teams/${division}${query}`);
}

/**
 * GET /api/v1/performance/config/weights
 * Fetch KPI weight configuration untuk semua role_type.
 * Siapa saja dengan CDPS scope boleh GET ini (bukan Director-only).
 */
export function getWeightsConfig(): Promise<{ data: KPIWeight[] }> {
  return api.get<{ data: KPIWeight[] }>('/performance/config/weights');
}

/**
 * PUT /api/v1/performance/config/weights
 * Update KPI weights untuk satu role_type (FULL REPLACE, bukan patch).
 * Request body: { role_type, weights: { [component_key]: weight, ... } }
 * Validasi server: Σweights harus = 100 (toleransi 1e-6).
 * Director only.
 */
export function updateWeightsConfig(
  roleType: string,
  weights: Record<string, number>
): Promise<{ ok: boolean }> {
  return api.put<{ ok: boolean }>('/performance/config/weights', {
    role_type: roleType,
    weights,
  });
}

/**
 * GET /api/v1/performance/config/targets
 * Fetch period target configuration untuk normalisasi KPI.
 */
export function getTargetsConfig(): Promise<{ data: PeriodTarget[] }> {
  return api.get<{ data: PeriodTarget[] }>('/performance/config/targets');
}

/**
 * PUT /api/v1/performance/config/targets
 * Upsert satu baris period target.
 * Request body: { role_type, component, period_start, target_value, is_placeholder }
 * period_start: YYYY-MM-DD atau "" (sentinel untuk semua periode — backend translate ke "0001-01-01").
 * Director only.
 */
export function updateTargetsConfig(
  roleType: string,
  component: string,
  targetValue: number,
  isPlaceholder: boolean,
  periodStart?: string
): Promise<{ ok: boolean }> {
  return api.put<{ ok: boolean }>('/performance/config/targets', {
    role_type: roleType,
    component,
    period_start: periodStart || '',
    target_value: targetValue,
    is_placeholder: isPlaceholder,
  });
}

/**
 * Helper: Map role_type (Creative|Ads|KOL|AM) ↔ division (Creative|Ads|KOL|Account).
 * AM = Account division, per PRD §2.
 * Also handles case normalization: role.division comes as lowercase from HRIS ('creative'|'ads'|'kol'|'account'),
 * but M14 API expects uppercase division ('Creative'|'Ads'|'KOL'|'Account').
 */
export function divisionOfRole(roleType: string): string {
  if (roleType === 'AM') return 'Account';
  return roleType;
}

export function roleTypeOfDivision(division: string): string {
  if (division === 'Account') return 'AM';
  return division;
}

/**
 * Convert role.division (lowercase from HRIS) to M14 API format (uppercase).
 * E.g. 'creative' → 'Creative', 'account' → 'Account'.
 */
export function normalizeM14Division(roleDivision: string): string {
  const lowerDiv = roleDivision.toLowerCase();
  if (lowerDiv === 'account') return 'Account';
  if (lowerDiv === 'creative') return 'Creative';
  if (lowerDiv === 'ads') return 'Ads';
  if (lowerDiv === 'kol') return 'KOL';
  // Other divisions not relevant to M14 (marketing, sales, finance, livestream)
  return roleDivision;
}

/**
 * Helper: Format YYYYMM string (202606) menjadi label bulan yang readable.
 */
export function formatPeriodLabel(period: string): string {
  if (!period || period.length !== 6) return '—';
  const year = period.substring(0, 4);
  const month = period.substring(4, 6);
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = parseInt(month, 10);
  return `${monthNames[monthIdx] || '?'} ${year}`;
}

/**
 * Helper: Format component name untuk UI (capitalize, keep as-is dari PRD).
 * Catatan: PRD tidak memberi label BI resmi — gunakan nama Inggris dari PRD §2 tabel.
 */
export const COMPONENT_LABELS: Record<string, string> = {
  speed_score: 'Speed Score',
  output_quantity: 'Output Quantity',
  gmv_impact: 'GMV Impact',
  revision_count: 'Revision Count',
  roas_attainment: 'ROAS Attainment',
  optimization_activity: 'Optimization Activity',
  creator_count: 'Creator Count',
  qc_pass_rate: 'QC Pass Rate',
  escalation_rate: 'Escalation Rate',
  chr_average: 'CHR Average',
  complaint_resolution_speed: 'Complaint Resolution Speed',
  revision_escalation_rate: 'Revision Escalation Rate',
  sourcing_turnaround: 'Sourcing Turnaround', // diagnostic
};
