/**
 * Data layer for the Karyawan page's roster actions.
 *
 * Why a `lib/` module rather than inline `api.*` calls in the page: the house
 * pattern is "satu fungsi tipis per endpoint di FE data layer" (DECISIONS
 * 2026-09-07), and `body-parity.test.ts` resolves a request body from an
 * interface declared in the SAME file as the call — a payload typed in another
 * module reads as `unresolved`, and an unresolved body checks nothing.
 */
import { api } from './api';
import type { AdminEmployee, HandoverItem, ResignResult } from './types';

/**
 * The employee directory — the roster spine of the Karyawan page.
 *
 * Deliberately `/admin/employees` and NOT `/auth/admin/credentials` (which the
 * page used alone until 2026-09-10). Two reasons, both of which broke the
 * resign feature outright:
 *
 *  - the credentials endpoint filters `WHERE e.status_aktif`, so a resigned
 *    employee VANISHES from the table — the operator gets no confirmation their
 *    own action landed, and cannot tell "resigned" from "never existed";
 *  - it scopes a Lead to their own mapped division, so an HR Lead saw HR staff
 *    only and could never reach the person they were asked to mutate.
 *
 * `/admin/employees` carries the whole directory (resigned rows included) and,
 * since migration 20260929010000, is readable by the HR Lead who does the
 * writing. Credential columns are merged in from the other endpoint where the
 * caller is allowed to see them.
 */
export function listAdminEmployees(): Promise<{ data: AdminEmployee[] }> {
  return api.get<{ data: AdminEmployee[] }>('/admin/employees');
}

/** Everything still assigned to this employee — the resign confirmation step. */
export function employeeHandover(employeeId: string): Promise<{ data: HandoverItem[] }> {
  return api.get<{ data: HandoverItem[] }>(`/admin/employees/${employeeId}/handover`);
}

/** Body of the resign call. Named so `body-parity.test.ts` can resolve it. */
export interface ResignBody {
  alasan: string;
}

/**
 * Permanently revoke an employee's access. There is no counterpart that undoes
 * this, by design — see `admin.resignEmployee`.
 */
export function resignEmployee(
  employeeId: string,
  body: ResignBody,
): Promise<{ data: ResignResult }> {
  return api.post<{ data: ResignResult }>(`/admin/employees/${employeeId}/resign`, body);
}

/** Human labels for `HandoverItem.kind`, so the page never spells them inline. */
export const HANDOVER_LABELS: Record<string, string> = {
  klien_sales_pic: 'Klien (Sales PIC)',
  klien_am: 'Klien (Account Manager)',
  klien_komisi_pic: 'Klien (PIC Komisi/Pembayaran)',
  brief: 'Brief berjalan',
  penugasan: 'Penugasan Internal',
  scs: 'Pekerjaan SCS',
  booking_kol: 'Booking KOL',
};

/** Label for a `kind`, falling back to the raw value rather than to an empty cell. */
export function handoverLabel(kind: string): string {
  return HANDOVER_LABELS[kind] ?? kind;
}
