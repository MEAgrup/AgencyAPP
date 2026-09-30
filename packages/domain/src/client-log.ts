/**
 * Log Aktivitas Klien (Account) — Improvement Req Account butir 5 (pemilik,
 * 2026-09-30; `docs/DECISIONS.md` 2026-09-30 "LOG-AKTIVITAS-KLIEN").
 *
 * "Untuk masing-masing klien, perlu fitur cek log dari masing-masing
 * aktivitasnya — dari mulai di-assign oleh Head sampai service-nya selesai,
 * seperti riwayat log milik sales."
 *
 * NOL tabel baru. Seluruh jejaknya SUDAH ada di `audit_log` yang immutable
 * (aturan rumah #3) — tersebar di belasan `entity_type` (client, service,
 * brief, strategi, plan, contract, …). Yang belum ada hanya satu pembaca yang
 * mengumpulkannya per klien. Modul ini pembaca itu, murni baca.
 *
 * ## Kenapa privileged read + gerbang domain, bukan `readAsActor`
 *
 * `audit_log_select` (O46) sengaja berbasis PENULIS: staff hanya melihat baris
 * yang ia tulis, lead hanya baris yang ditulis orang divisinya. Untuk jejak
 * klien itu salah arah — AM tidak akan melihat `am_assigned` yang ditulis Head,
 * dan Head of Account tidak akan melihat transisi Brief yang ditulis Creative.
 * Melebarkan policy itu per-entitas ditolak eksplisit oleh O46 (±30
 * entity_type, gagal diam-diam). Jadi: gerbang di TINGKAT KLIEN di sini —
 * OD/Director, Head/lead Account, atau AM pemilik klien — lalu baca lewat
 * koneksi privileged, persis pola `transitions.ts` ("filter TS yang sama").
 */

import { permission } from '@cdps/core';
import type { Queryable } from '@cdps/db';

export type Actor = permission.Actor;

export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
export const MSG_CLIENT_LOG_FORBIDDEN = '[anda tidak memiliki akses ke log aktivitas klien ini]';

const ACCOUNT_DIVISION = 'Account';
/** Batas baris per baca — sama dengan `audit.AUDIT_LIST_LIMIT` kelas besarnya, satu klien jarang mendekati. */
export const CLIENT_LOG_LIMIT = 2000;

export class NotFoundError extends Error {
  constructor(message = MSG_CLIENT_NOT_FOUND) {
    super(message);
    this.name = 'ClientLogNotFoundError';
  }
}
export class ForbiddenError extends Error {
  constructor(message = MSG_CLIENT_LOG_FORBIDDEN) {
    super(message);
    this.name = 'ClientLogForbiddenError';
  }
}

/** Satu baris log aktivitas klien. */
export interface ClientLogEntry {
  id: number;
  entityType: string;
  entityId: string;
  actorEmployeeId: string;
  /** Nama aktor (`private.employee_display_name`), jatuh ke id; `SISTEM` untuk job/migrasi. */
  actorNama: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: Date;
}

/** canReadClientLog — OD/Director, Head/lead Account (division-wide), atau AM pemilik klien. */
export function canReadClientLog(actor: Actor, assignedAm: string): boolean {
  if (permission.canReadDivision(actor, ACCOUNT_DIVISION)) {
    return true; // OD / Director / Account lead
  }
  return assignedAm !== '' && actor.employeeId === assignedAm;
}

/**
 * clientActivityLog mengumpulkan seluruh baris `audit_log` yang menyangkut satu
 * klien, terbaru di atas. `sql` HARUS koneksi privileged (lihat header).
 *
 * Cakupan entitas — rantai kelola klien sisi Account:
 *   client (closing, rilis ke Account, assign/reassign AM, koreksi field, …)
 *   → contract → service (+ plan gate, hold/void/closure) → strategi/STR-/plan
 *   → brief (+ tahapan produksi, kirim ulang) → ad_campaign
 *   → complaint / milestone / renewal / rekap mingguan.
 */
export async function clientActivityLog(sql: Queryable, actor: Actor, clientId: string): Promise<ClientLogEntry[]> {
  const cl = await sql<{ id: string; assigned_am_id: string | null }[]>`
    select id, assigned_am_id from clients where id = ${clientId}`;
  if (cl.length === 0) {
    throw new NotFoundError();
  }
  if (!canReadClientLog(actor, cl[0].assigned_am_id ?? '')) {
    throw new ForbiddenError();
  }

  const services = (await sql<{ id: string }[]>`select id from services where client_id = ${clientId}`).map((r) => r.id);
  const [briefs, strategyPlans] = services.length === 0
    ? [[], []]
    : await Promise.all([
      sql<{ id: string }[]>`select id from briefs where service_id = any(${services})`,
      sql<{ id: string }[]>`select id from strategy_plans where service_id = any(${services})`,
    ]).then(([b, s]) => [b.map((r) => r.id), s.map((r) => r.id)]);
  const byClient = async (table: string): Promise<string[]> =>
    (await sql<{ id: string }[]>`select id::text as id from ${sql(table)} where client_id = ${clientId}`).map((r) => r.id);
  const [strategi, plans, contracts, complaints, milestones, renewals, recaps, campaigns] = await Promise.all([
    byClient('strategi'), byClient('plan'), byClient('contracts'), byClient('complaints'),
    byClient('client_milestones'), byClient('renewal_requests'), byClient('weekly_result_recap'), byClient('ad_campaigns'),
  ]);

  // (entity_type, ids) pairs — satu predikat `entity_id = any(...)` per jenis,
  // semuanya menumpang indeks `idx_audit_entity (entity_type, entity_id)`.
  const groups: Array<[string, string[]]> = [
    ['client', [clientId]],
    ['contract', contracts],
    ['service', services],
    ['service_plan_gate', services],
    ['strategy_plan', strategyPlans],
    ['strategi', strategi],
    ['plan', plans],
    ['brief', briefs],
    ['brief_stage', briefs],
    ['ad_campaign', campaigns],
    ['complaint', complaints],
    ['client_milestone', milestones],
    ['renewal_request', renewals],
    ['weekly_result_recap', recaps],
  ].filter(([, ids]) => (ids as string[]).length > 0) as Array<[string, string[]]>;

  // Diratakan jadi dua array sejajar lalu di-unnest: satu nested-loop atas
  // indeks `idx_audit_entity`, bukan subquery berkorelasi per baris audit.
  const types: string[] = [];
  const ids: string[] = [];
  for (const [t, list] of groups) {
    for (const i of list) {
      types.push(t);
      ids.push(i);
    }
  }
  const rows = await sql<{
    id: string | number; entity_type: string; entity_id: string; actor_employee_id: string; actor_nama: string | null;
    action: string; before_json: unknown; after_json: unknown; created_at: Date;
  }[]>`
    with k(t, i) as (select * from unnest(${types}::text[], ${ids}::text[]))
    select a.id, a.entity_type, a.entity_id, a.actor_employee_id,
           private.employee_display_name(a.actor_employee_id) as actor_nama,
           a.action, a.before_json, a.after_json, a.created_at
      from k join audit_log a on a.entity_type = k.t and a.entity_id = k.i
     order by a.created_at desc, a.id desc
     limit ${CLIENT_LOG_LIMIT}`;
  return rows.map((r) => ({
    id: Number(r.id), entityType: r.entity_type, entityId: r.entity_id, actorEmployeeId: r.actor_employee_id,
    actorNama: r.actor_nama ?? r.actor_employee_id, action: r.action, beforeJson: r.before_json,
    afterJson: r.after_json, createdAt: r.created_at,
  }));
}
