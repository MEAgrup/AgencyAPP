// Typed wrapper over lib/api.ts for Module 11 (Unified Board / PM Kanban).
// Shapes mirror backend/internal/httpapi/board_handlers.go +
// internal/module11_board/{board.go,views.go} exactly (Card struct views.go:29-42,
// Dependency struct board.go:118-130) — read from the brief, never invented.
// No money fields in this module. Everything here is read-mostly: the only
// mutation endpoint (POST /dependencies) is out of scope for this FE build
// (see fe_briefs/m11.md §1) and intentionally not wrapped here.

import { api } from '@/lib/api';

// ---------- Types ----------

/** Fixed 5-column mapping every native status collapses into (PRD §5.2 Rule 2). */
export const UNIVERSAL_COLUMNS = [
  'To Do',
  'In Progress',
  'Awaiting Review',
  'Blocked/Revision',
  'Done',
] as const;
export type UniversalColumn = (typeof UNIVERSAL_COLUMNS)[number];

export type CardType = 'brief' | 'asset' | 'booking' | 'session';

// Card (views.go:29-42). Fields marked omitempty in the Go struct are
// optional here — when empty on the backend the KEY IS ABSENT from the JSON,
// not null/"" (see fe_briefs/m11.md §6 gotchas), so treat these as
// possibly-undefined, never assume "".
export interface Card {
  id: string;
  type: CardType;
  division: string;
  client_id: string;
  brief_id: string;
  pic?: string;
  native_status: string;
  universal_column: string;
  due_date?: string; // "YYYY-MM-DD", NOT RFC3339 (views.go:245,447)
  overdue: boolean; // always present, never omitempty
  /** Client Board only ("Menunggu Dependency" | "Informational (link ke BRF-...)"). Never present on My Tasks cards. */
  dependency_badge?: string;
  created_at?: string; // RFC3339
}

export type DependencyType = 'Blocking' | 'Informational';
export type DependencyStatus = 'Pending' | 'Blocking' | 'Satisfied';

// Dependency (board.go:118-130). Fully derived/read-only status; only create
// (out of scope) and read exist in v1 — no PATCH/PUT/DELETE (see §5 TIDAK
// TERSEDIA point 4).
export interface Dependency {
  id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  type: DependencyType;
  note?: string;
  client_id: string;
  status: DependencyStatus;
  created_by: string;
  created_at: string;
}

// ---------- API functions ----------

/** GET /api/v1/board — Client Board. `client` query is mandatory server-side (422 if empty). */
export function getBoard(clientId: string): Promise<{ data: Card[] }> {
  return api.get<{ data: Card[] }>(`/board?client=${encodeURIComponent(clientId)}`);
}

/**
 * GET /api/v1/my-tasks — defaults to the caller's own tasks across all
 * Clients. Passing `employeeId` other than self is only permitted for
 * OD/Director/Account lead-SPV server-side (403 otherwise) — see brief §1/§4.
 */
export function getMyTasks(employeeId?: string): Promise<{ data: Card[] }> {
  const query = employeeId ? `?employee=${encodeURIComponent(employeeId)}` : '';
  return api.get<{ data: Card[] }>(`/my-tasks${query}`);
}

/**
 * GET /api/v1/dependencies — visibility filtering is silent server-side
 * (rows the actor can't see are skipped, no error/short array warning).
 */
export function listDependencies(params?: { source?: string; target?: string }): Promise<{ data: Dependency[] }> {
  const qs = new URLSearchParams();
  if (params?.source) qs.set('source', params.source);
  if (params?.target) qs.set('target', params.target);
  const query = qs.toString();
  return api.get<{ data: Dependency[] }>(`/dependencies${query ? `?${query}` : ''}`);
}

/** GET /api/v1/dependencies/{id} — single Dependency object at root (no {data:...} wrapper). */
export function getDependency(id: string): Promise<Dependency> {
  return api.get<Dependency>(`/dependencies/${id}`);
}

// ---------- Local display helpers (FE-only, not sourced from backend) ----------

// Division is an open-ended string on Card (backend comment: "Creative | Ads
// | KOL | Live Stream | ..."). There is no color enum from the API for this,
// and it is not a lifecycle status field, so `lib/status.ts`'s StatusBadge
// (reserved for entity state machines) is not used here. This is a small,
// local, purely-cosmetic tag mapping — unknown divisions fall back to gray
// rather than guessing.
const DIVISION_BADGE_CLASS: Record<string, string> = {
  Creative: 'badge-purple',
  Ads: 'badge-blue',
  KOL: 'badge-amber',
  'Live Stream': 'badge-green',
};

export function divisionBadgeClass(division: string): string {
  return DIVISION_BADGE_CLASS[division] ?? 'badge-gray';
}

/**
 * `dependency_badge` is a ready-to-render label string, not an enum (see
 * brief §2/§6) — this only picks a badge tone for the two known verbatim
 * shapes ("Menunggu Dependency" exact, "Informational (link ke BRF-...)"
 * prefix-matched because the BRF id is dynamic). Any other string (should
 * not happen per the contract) falls back to gray rather than guessing.
 */
export function dependencyBadgeClass(badge: string): string {
  if (badge === 'Menunggu Dependency') return 'badge-amber';
  if (badge.startsWith('Informational')) return 'badge-blue';
  return 'badge-gray';
}

/**
 * Resolves the existing FE detail route for a Card, inferred from the
 * division/type routing already established in Wave 1/2 modules (not an M11
 * API concept — M11 only returns ids/division/type). Brief cards route by
 * division to each division's own Brief detail page; unknown divisions fall
 * back to the M6 cross-division Brief queue page (`/account/briefs/{id}`),
 * which is the one page in the repo built to display a Brief regardless of
 * division. Sub-entity cards (asset/booking/session) route straight to their
 * own module's detail page.
 */
export function cardHref(card: Card): string {
  if (card.type === 'asset') return `/creative/assets/${card.id}`;
  if (card.type === 'booking') return `/kol/bookings/${card.id}`;
  if (card.type === 'session') return `/livestream/sessions/${card.id}`;
  // type === 'brief'
  switch (card.division) {
    case 'Creative':
      return `/creative/briefs/${card.id}`;
    case 'Ads':
      return `/ads/${card.id}`;
    case 'KOL':
      return `/kol/briefs/${card.id}`;
    case 'Live Stream':
      return `/livestream/briefs/${card.id}`;
    default:
      return `/account/briefs/${card.id}`;
  }
}
