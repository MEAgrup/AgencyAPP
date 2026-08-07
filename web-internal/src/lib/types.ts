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

/**
 * One row of GET /employees/assignable — the payload of every assignment
 * dropdown (AM, Brief/Task/Asset PIC, Booking Coordinator).
 *
 * Narrower than `AdminEmployee` by design: the admin roster is Director/OD-only
 * and carries email/flagged/sync staleness; this list is read by anyone who
 * assigns work, so it carries only what is needed to pick a person.
 *
 * `divisi`/`jabatan` are the RAW HRIS strings — LABELS (this is what tells an
 * "Account Manager" apart from a "CRO" inside the same Account division), never a
 * scope. `division`/`level` are the resolved CDPS role the server validates
 * against.
 */
export interface AssignableEmployee {
  employee_id: string;
  nama: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
}

export interface EmployeeSyncResult {
  synced: number;
  deactivated: number;
  reactivated: number;
  flagged: number;
}

/** One row of GET /auth/admin/credentials — credential STATUS, never material. */
export interface CredentialInfo {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  has_password: boolean;
  must_change_password: boolean;
  locked_until: string | null;
  password_changed_at: string | null;
}

/**
 * Result of POST /admin/employee-import. The employee source is an admin CSV
 * upload, NOT an HRIS pull (DECISIONS OQ-4 — the HRIS endpoint was dropped), so
 * this replaces the old `/admin/employee-sync` shape.
 */
export interface EmployeeImportResult {
  source: string;
  sync: EmployeeSyncResult;
  provisioned: number;
  linked: number;
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

/**
 * Catalog tier (M6C S4). Declared HERE rather than in `account.ts` because
 * `account.ts` imports this file — putting it the other way round would make a
 * cycle. `account.ts` re-exports it, so existing importers are unaffected.
 */
export type PlanTier = 'plan_wajib' | 'ditentukan_am' | 'tanpa_plan';

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
  requires_strategy_plan: boolean;
  /** Catalog tier — set by Sales Head in the MSL admin (O54). */
  plan_tier: PlanTier;
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

// Blok `task` dari GET /demo-tasks/{id}. Berbeda dari `DemoTask` baris daftar:
// halaman detail juga membaca `description`. Dinamai (bukan objek inline) supaya
// gate paritas bentuk bisa membandingkan kunci di dalamnya — sebelum ini
// `description` hanya terdaftar sebagai "kunci ekstra" terhadap `DemoTask`,
// sehingga menghapusnya dari wire TIDAK akan memerahkan gate mana pun.
export interface DemoTaskDetailTask {
  id: string;
  title: string;
  description: string;
  status: string;
  created_by: string;
  created_at: string;
}

export interface DemoTaskDetail {
  task: DemoTaskDetailTask;
  allowed_transitions: string[];
  audit: AuditEntry[];
}

// Nilai divisi KANONIK role-mapping — persis konstanta backend
// (module0/2/6/7/8/9/10/12: "Marketing"/"Sales"/"Finance"/"Account"/"Creative"/
// "Ads"/"KOL"/"Live Stream") dan seed/batch riil (seed/role_mappings_riil.csv).
// Backend TIDAK memvalidasi kanon pada POST /admin/role-mappings, jadi form ini
// satu-satunya penjaga: nilai lowercase legacy Wave 1 menghasilkan mapping yang
// tidak pernah match gate divisi mana pun (DECISIONS 2026-07-19).
export const DIVISIONS = [
  'Marketing',
  'Sales',
  'Finance',
  'Account',
  'Creative',
  'Ads',
  'KOL',
  'Live Stream',
] as const;

export const LEVELS = ['staff', 'lead'] as const;
