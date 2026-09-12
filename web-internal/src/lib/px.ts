// Typed wrapper over lib/api.ts for Product Exchange PX-M2a (eligibility
// policy). Shapes mirror packages/domain/src/productexchange.ts +
// apps/api/src/lib/wire.ts (eligibilityPolicyToWire) exactly.

import { api } from '@/lib/api';

/** The calibration value shape, apa adanya (PRD §4.5). */
export interface PxEligibilityPolicyValue {
  sales_threshold_idr: number;
  threshold_basis: string;
  threshold_window_days: number;
  commission_floor_pct: number | null;
  require_stock_in: boolean;
  platforms: string[];
}

/** One versioned Product Exchange eligibility-policy row (Director-only). */
export interface PxEligibilityPolicy {
  versi: number;
  nilai: PxEligibilityPolicyValue;
  aktif: boolean;
  catatan: string | null;
  dibuat_pada: string;
  dibuat_oleh: string;
}

/** GET /px/eligibility-policy — every calibration version, newest first. Director-only. */
export function listEligibilityPolicy(): Promise<{ data: PxEligibilityPolicy[] }> {
  return api.get<{ data: PxEligibilityPolicy[] }>('/px/eligibility-policy');
}

/** Body of `POST /px/eligibility-policy` — a named interface so
 *  `body-parity.test.ts` can statically resolve it against the route. */
export interface CreateEligibilityPolicyInput {
  nilai: PxEligibilityPolicyValue;
  catatan: string;
  aktif?: boolean;
}

/** POST /px/eligibility-policy — mint the next calibration version. Director-only. */
export function createEligibilityPolicy(input: CreateEligibilityPolicyInput): Promise<PxEligibilityPolicy> {
  return api.post<PxEligibilityPolicy>('/px/eligibility-policy', input);
}
