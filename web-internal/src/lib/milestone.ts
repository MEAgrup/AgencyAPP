// T-4c (RM-11) — Upcoming Milestones data layer. Mirrors apps/api MilestoneWire
// exactly (snake_case, keys identical); registered in shape-parity.
import { api } from '@/lib/api';

export interface Milestone {
  id: string;
  client_id: string;
  title: string;
  target_date: string; // YYYY-MM-DD
  status: string; // [Upcoming] | [Done] | [Cancelled]
  created_at: string; // RFC3339
  created_by: string;
}

export const MILESTONE_UPCOMING = '[Upcoming]';
export const MILESTONE_DONE = '[Done]';
export const MILESTONE_CANCELLED = '[Cancelled]';

/** GET /clients/{id}/milestones → {data: Milestone[]} (soonest target first). */
export function listMilestones(clientId: string): Promise<{ data: Milestone[] }> {
  return api.get<{ data: Milestone[] }>(`/clients/${clientId}/milestones`);
}

/** POST /clients/{id}/milestones → Milestone (object directly). */
export function createMilestone(clientId: string, title: string, targetDate: string): Promise<Milestone> {
  return api.post<Milestone>(`/clients/${clientId}/milestones`, { title, target_date: targetDate });
}

/** POST /milestones/{id}/transition → Milestone. `to` = [Done] | [Cancelled]. */
export function transitionMilestone(id: string, to: string): Promise<Milestone> {
  return api.post<Milestone>(`/milestones/${id}/transition`, { to });
}
