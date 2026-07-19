// Shared API/domain types for CDPS web-internal.
// Mirrors the fixed API contract exactly — no invented fields.

export interface Employee {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
}

export interface Role {
  division: string;
  level: string;
  od: boolean;
  director: boolean;
}

export interface MeResponse {
  employee: Employee;
  role: Role;
}

export interface NotificationItem {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  deep_link: string;
  actor: string;
  created_at: string;
  read_at: string | null;
}

export interface NotificationsResponse {
  data: NotificationItem[];
  unread_count: number;
}

export interface AdminEmployee {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  status_aktif: boolean;
  flagged: boolean;
}

export interface EmployeeSyncResult {
  synced: number;
  deactivated: number;
  flagged: number;
}

export interface RoleMapping {
  id: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
}

export interface LayeredRole {
  employee_id: string;
  role: 'od' | 'director';
  enabled: boolean;
}

// MSL v2 calculator pricing modes (DECISIONS 2026-07-16 / docs/handoff/MSL_KALKULATOR_VALIDASI.md).
export const PRICING_MODES = ['flat', 'min_floor', 'batch_ceiling', 'passthrough'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

// Frequency enum as stored/returned by the backend ("" = tidak ditentukan).
export const FREQUENCIES = ['', 'Monthly', 'One-time', 'Campaign'] as const;

export interface MasterService {
  id: string;
  name: string;
  standard_price: string;
  commission_rule: string;
  category: string;
  unit: string;
  min_qty: string;
  pricing_mode: string;
  apply_ppn: boolean;
  frequency: string;
  price_note: string;
  description: string;
  active: boolean;
  version_no: number;
  effective_from: string;
}

export interface DemoTask {
  id: string;
  title: string;
  status: string;
  created_by: string;
  created_at: string;
}

export interface AuditEntry {
  actor_employee_id: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

export interface DemoTaskDetail {
  task: {
    id: string;
    title: string;
    description: string;
    status: string;
    created_by: string;
    created_at: string;
  };
  allowed_transitions: string[];
  audit: AuditEntry[];
}

// CDPS canonical division labels — VERBATIM as the permission engine + role-map
// seeds store them (testdata/import_samples/role_mappings_uat.csv col 3): capitalized,
// "KOL" all-caps, "Live Stream" with a space. This is the value written into
// role_mappings.division by the admin form, which the HRIS sync then assigns as an
// employee's Role.Division; the delivery modules gate on the exact capitalized string
// (e.g. module6_account/strategy.go, module12_task/task.go), so a lowercase value here
// would create mappings that never match. (Legacy Wave 1 lowercase list corrected —
// see DECISIONS 2026-07-19.)
export const DIVISIONS = [
  'Sales',
  'Marketing',
  'Account',
  'Creative',
  'Ads',
  'KOL',
  'Live Stream',
  'Finance',
] as const;

export const LEVELS = ['staff', 'lead'] as const;
