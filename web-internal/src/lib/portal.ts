// M15-C1 Team Portal (INTERNAL) — types + fungsi API 1:1 dengan
// backend/internal/httpapi/portal_handlers.go + module15_portal/portal.go.
// Ketiga surface adalah read-model murni (Rule 8: nol entitas baru, nol write,
// nol emisi) di atas M11/M12/M13/M14 — semua tipe modul di-reuse dari lib
// modulnya, bukan diduplikasi.
import { api } from '@/lib/api';
import type { Card } from '@/lib/board';
import type { Snapshot, TeamRollup } from '@/lib/performance';
import type { PendingBlockRequest } from '@/lib/tasks';

// module15_portal.StaffLanding (portal.go:85) — landing staf (Rule 9).
// open_tasks sudah TERURUT SLA-risk dari server (Overdue → due terdekat →
// tanpa-due; Done dikecualikan) — jangan diurut ulang di FE.
// running_score = M14 preview bulan berjalan (computed-on-read, preview:true);
// null utk role tanpa KPI Profile (Sales/Finance/Marketing/lead) — bukan error.
export interface StaffLanding {
  employee_id: string;
  open_tasks: Card[];
  running_score: Snapshot | null;
  trend: Snapshot[];
}

// module15_portal.ClientShortcut (portal.go:172) — ringkas Client Board (Rule 10).
export interface ClientShortcut {
  client_id: string;
  client_name: string;
  assigned_am: string;
  board_ref: string; // deep-link hint ke Client Board (M11)
}

// module15_portal.TeamPortal (portal.go:180) — landing SPV/Lead (Rule 10).
// (lib/tasks.ts punya proyeksi parsial utk halaman block-requests; ini bentuk penuh.)
export interface TeamPortalFull {
  division: string;
  performance_rollup: TeamRollup;
  client_shortcuts: ClientShortcut[];
  block_queue: PendingBlockRequest[];
}

// module15_portal.MgmtRow (portal.go:258) — satu baris scan CHR portfolio (§6.3).
// Semua field derived; band/score kosong = klien belum punya snapshot (tetap tampil).
export interface MgmtRow {
  client_id: string;
  client_name: string;
  assigned_am: string;
  board_ref: string; // deep-link hint ke Client Board (M11) — drill-through §6.3 (M15-G2)
  snapshot_id: string; // "" saat belum ada snapshot
  period: string; // "YYYY-MM-DD" snapshot terbaru; "" saat belum ada
  score_display: string; // sudah diformat server (house #7: "—" saat kosong)
  band: string; // 'Healthy' | 'Watch' | 'At Risk' | ''
  trend_direction: 'up' | 'down' | 'flat';
  dragging_component: string; // key komponen M13 ber-skor capped terendah; "" bila tak ada
  dragging_capped: number | null;
}

// module15_portal.ManagementDashboard (portal.go:271).
export interface ManagementDashboard {
  filter_band: string;
  filter_am: string;
  filter_division: string; // "" = seluruh basis klien (§6.3 "by division mix", M15-G1)
  sort: string;
  rows: MgmtRow[];
}

// Divisi ber-skor M14 — /portal/team menolak (404 rollup) divisi di luar ini
// (edge terdokumentasi DECISIONS W3-M15-C1: audiens Rule 10 = divisi ber-skor).
export const PORTAL_TEAM_DIVISIONS = ['Creative', 'Ads', 'KOL', 'Account'] as const;

// Band M13 utk filter Management Dashboard (module13_health).
export const MGMT_BANDS = ['Healthy', 'Watch', 'At Risk'] as const;

// GET /portal/me — semua role terautentikasi (scope = data sendiri).
export function getMyPortal(): Promise<StaffLanding> {
  return api.get<StaffLanding>('/portal/me');
}

// GET /portal/team[?division=&period=YYYYMM] — gate server: actor.IsLead(division)
// atau Director; division kosong default ke divisi aktor (Director WAJIB memilih).
export function getTeamPortalFull(division?: string, period?: string): Promise<TeamPortalFull> {
  const q = new URLSearchParams();
  if (division) q.set('division', division);
  if (period) q.set('period', period);
  const qs = q.toString();
  return api.get<TeamPortalFull>(`/portal/team${qs ? `?${qs}` : ''}`);
}

// GET /portal/management[?band=&am=&division=&sort=am] — Director + OD SAJA (Rule 11/§6.3).
export function getManagementDashboard(opts?: {
  band?: string;
  am?: string;
  division?: string;
  sort?: 'band' | 'am';
}): Promise<ManagementDashboard> {
  const q = new URLSearchParams();
  if (opts?.band) q.set('band', opts.band);
  if (opts?.am) q.set('am', opts.am);
  if (opts?.division) q.set('division', opts.division);
  if (opts?.sort) q.set('sort', opts.sort);
  const qs = q.toString();
  return api.get<ManagementDashboard>(`/portal/management${qs ? `?${qs}` : ''}`);
}
