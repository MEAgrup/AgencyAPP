/**
 * M6D — Rekap Hasil Mingguan (Weekly Result Recap). Machine #18 gate layer.
 *
 * This file is the D-02 slice: the transition wrapper + the WHO gates for
 * machine #18 (`weekly_result_recap`), following the `plan.ts` pattern where the
 * engine (`sm_transition`) owns edge legality + the `require_lead` gate, and the
 * DOMAIN owns the finer "which person may press which button" gate.
 *
 * Deliberately narrow. The recap READS (own-clients / SPV all), the auto
 * aggregation, the manual fallbacks, the narrative validation at close, the
 * force-close job and the reopen-with-reason write path all land in later
 * tickets (D-03/D-05/D-06/D-09). What is frozen here is the shape of the machine
 * and who is allowed to drive it:
 *
 *   Terjadwal → Terbuka           system (Monday job, D-06)         — service-role
 *   Terbuka   → Ditutup           the owning AM/CRO (Rule 8)        — canCloseRecap
 *   Terbuka   → Ditutup Otomatis  system force-close (D-06)         — service-role
 *   Ditutup Otomatis → Terbuka    Head of Account reopen (RM-5)     — canReopenRecap
 *
 * See `docs/STATE_MACHINES.md` §15 and migration 20260813020000_m6d_wrr_machine.sql.
 */
import { notification, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';

// ---------------------------------------------------------------------------
// BI messages (CLAUDE.md #5)
// ---------------------------------------------------------------------------

/** The recap id does not resolve. */
export const MSG_RECAP_NOT_FOUND = '[rekap mingguan tidak ditemukan]';
/** Actor may not drive this recap transition. */
export const MSG_RECAP_FORBIDDEN = '[anda tidak memiliki akses untuk melakukan transisi ini]';

// ---------------------------------------------------------------------------
// Machine #18 (see migration 20260813020000). Status moves ONLY through
// `sm_transition` — never a raw UPDATE.
// ---------------------------------------------------------------------------

/** Machine name + audit entity_type for `sm_transition`. */
export const MACHINE_RECAP = 'weekly_result_recap';
const ENTITY_RECAP = 'weekly_result_recap';

/** Machine #18 states. */
export const WRR_TERJADWAL = 'Terjadwal';
export const WRR_TERBUKA = 'Terbuka';
export const WRR_DITUTUP = 'Ditutup';
export const WRR_DITUTUP_OTOMATIS = 'Ditutup Otomatis';

/** The single terminal state (Ditutup Otomatis is quasi-terminal — Head reopen). */
export const WRR_TERMINAL: readonly string[] = [WRR_DITUTUP];

// ---------------------------------------------------------------------------
// Permission — the domain "who may press the button" gates. The engine already
// refuses a non-(Director/Lead) on the reopen edge (require_lead); these narrow
// it further, exactly the way plan.ts narrows period-1 approval to Account.
// ---------------------------------------------------------------------------

/**
 * canCloseRecap: `Terbuka → Ditutup`. The client's assigned AM/CRO confirms the
 * week (Rule 8); an Account lead/Head may override, and a Director may always.
 * (Mirror of `canWritePlan` — `isLead(_, 'Account')` already covers Director.)
 */
export function canCloseRecap(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/**
 * canReopenRecap: `Ditutup Otomatis → Terbuka`. RM-5 (owner 2026-08-13) —
 * ONLY the Head of Account (the AM's superior), or a Director. Deliberately NOT
 * the owning AM: reopening is the supervisor giving the AM a second chance, and
 * the AM must not be able to erase their own force-close. `isLead(_, 'Account')`
 * is exactly "Account lead/Head OR Director", and a plain owning-AM (staff level)
 * fails it — which is the intended exclusion.
 */
export function canReopenRecap(actor: Actor): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION);
}

/**
 * canWriteRecap: the write-scope predicate for a recap's AM-writable fields
 * (RM-A6, the RM-C manual fallbacks, the RM-D narrative, and the `Sengketa
 * Angka` note on an auto figure). The owning AM/CRO, or an Account lead/Head
 * (Director covered by `isLead`); OD is read-only (Role Matrix §9). This is the
 * exact TS twin of the RLS helper `private.jwt_can_write_recap` — the D-03
 * frozen invariant is that the two must not diverge (asserted in
 * `recap.reals.test.ts`), mirroring `canWritePlan` ≡ `jwt_can_write_plan` (M6B
 * B-06). It scopes WHO may write; the column-level rule that an `otomatis` row's
 * value is immutable (only its `sengketa` may move) is the DB trigger's half —
 * RLS `WITH CHECK` cannot compare OLD to NEW.
 */
export function canWriteRecap(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

// ---------------------------------------------------------------------------
// Transition wrapper
// ---------------------------------------------------------------------------

/** transitionError maps an engine rejection to the shared error taxonomy. */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  if (res.code === 'not_found') return new NotFoundError(MSG_RECAP_NOT_FOUND);
  if (res.code === 'role_denied') return new ForbiddenError(res.message);
  // 'blocked' (illegal edge, incl. the machine's BI block message) and the rest
  // are conflicts on the current state.
  return new ConflictError(res.message);
}

/**
 * transitionRecap is the single wrapper every recap status move goes through —
 * the `plan.ts` transition pattern applied to machine #18. It forces the move
 * through `sm_transition` (row lock + edge check + `require_lead` gate + the
 * immutable audit row, one transaction) and maps a rejection onto the domain
 * error taxonomy. The person-level gates (`canCloseRecap` / `canReopenRecap`)
 * live in the named operations that call it (D-06/D-09); this is the low-level
 * path they share.
 *
 * Runs inside the caller's transaction so any sibling write (the reopen reason,
 * the close timestamp) commits or rolls back with the move.
 */
export async function transitionRecap(
  tx: TransactionSql,
  actor: Actor,
  recapId: string,
  to: string,
): Promise<void> {
  const ex = executors(tx);
  const res = await statemachine.transition(ex.sm, {
    machine: MACHINE_RECAP,
    entityType: ENTITY_RECAP,
    table: 'weekly_result_recap',
    entityId: recapId,
    to,
    actor,
  });
  if (!res.ok) throw transitionError(res);
}

// ===========================================================================
// D-09 — reads, writes, close (metric-completeness belt), reopen, division notes
// ===========================================================================

// --- Additional BI messages (CLAUDE.md #5) ---------------------------------
/** The client the recap points at does not resolve. */
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
/** The recap is not open (writes / close require Terbuka). */
export const MSG_RECAP_NOT_OPEN = '[rekap ini tidak dalam status Terbuka]';
/** RM-A6 opening note missing at close. */
export const MSG_CLOSE_PEMBUKA = '[penutupan dibatalkan: Catatan Pembuka (RM-A6) wajib diisi]';
/** RM-D1/RM-D3 narrative missing at close. */
export const MSG_CLOSE_NARASI =
  '[penutupan dibatalkan: narasi «Yang Bergerak» dan «Fokus Minggu Depan» wajib diisi]';
/** A required RM-C metric is neither filled nor marked `—` at close. */
export const MSG_CLOSE_METRIK =
  '[penutupan dibatalkan: setiap metrik hasil wajib diisi atau ditandai — (tidak tersedia)]';
/** A manual figure is missing its source attachment / capture date (RM-C7). */
export const MSG_METRIK_BUKTI = '[angka manual wajib menyertakan lampiran sumber dan tanggal ambil data]';
/** An auto figure cannot be hand-typed — only disputed. */
export const MSG_METRIK_NOT_MANUAL =
  '[metrik ini otomatis dari modul eksekusi — ajukan Sengketa Angka jika angkanya keliru]';
/** Manual write attempted on a metric key that is auto-only. */
export const MSG_METRIK_AUTO_ONLY = '[metrik ini tidak dapat diisi manual]';
/** Sengketa filed on a figure that is not an auto figure / does not exist. */
export const MSG_SENGKETA_TARGET = '[tidak ada angka otomatis untuk disengketakan]';
/** A division note is written by a division that did not touch the client this week. */
export const MSG_DIVISI_NOT_TOUCHED = '[divisi ini tidak menyentuh klien pada minggu ini]';
/** Reopen requires a reason (RM-5). */
export const MSG_REOPEN_REASON = '[alasan buka-kembali wajib diisi]';

/**
 * RM-C metrics an AM may fill manually (isi atau `—`): the non-auto fallbacks.
 * `view_organik` (T-4a) is manual-only — organic reach comes from the platform
 * report, entered per week; it is NEVER auto-written (kept separate from the paid
 * `total_view`, which IS auto from M10 live viewers).
 */
export const MANUAL_ELIGIBLE_METRICS: readonly string[] = ['total_view', 'view_organik', 'ctr', 'cvr'];
/** RM-C metrics that must be present (filled or `—`) before a recap closes (Rule 8). */
export const REQUIRED_AT_CLOSE_METRICS: readonly string[] = ['total_view', 'ctr', 'cvr'];
/** Valid division names for a division note (RM-D6). */
const DIVISIONS: readonly string[] = ['Creative', 'Ads', 'KOL', 'Live Stream'];

// --- Read models -----------------------------------------------------------

export interface Recap {
  id: string;
  clientId: string;
  planId: string | null;
  isoYear: number;
  isoWeek: number;
  mingguMulai: string;
  mingguAkhir: string;
  status: string;
  pernahDitutupOtomatis: boolean;
  catatanPembuka: string | null;
  ditutupPada: string | null;
  ditutupOleh: string | null;
  createdAt: string;
  createdBy: string;
}

export interface RecapDivisi {
  recapId: string;
  divisi: string;
  jumlahProduksi: number;
  rincian: Record<string, unknown>;
  sengketa: string | null;
}

export interface RecapMetrik {
  recapId: string;
  metrik: string;
  nilai: number | null;
  sumber: string;
  fileBukti: string | null;
  tanggalAmbil: string | null;
  nilaiMingguLalu: number | null;
  sengketa: string | null;
}

export interface RecapCatatan {
  recapId: string;
  yangBergerak: string | null;
  yangTertahan: string | null;
  fokusMingguDepan: string | null;
  bahanUntukKlien: string | null;
  catatanMetrikTambahan: string | null;
}

export interface RecapCatatanDivisi {
  id: number;
  recapId: string;
  divisi: string;
  catatan: string;
  createdAt: string;
  createdBy: string;
}

export interface RecapDetail {
  recap: Recap;
  divisi: RecapDivisi[];
  metrik: RecapMetrik[];
  catatan: RecapCatatan | null;
  catatanDivisi: RecapCatatanDivisi[];
}

// --- Coercion helpers (numeric/date columns arrive as string|Date) ---------
function optNum(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
function optStr(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function isoTs(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
function dateStr(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

interface RecapRow {
  id: string; client_id: string; plan_id: string | null;
  iso_year: number | string; iso_week: number | string;
  minggu_mulai: unknown; minggu_akhir: unknown;
  status: string; pernah_ditutup_otomatis: boolean;
  catatan_pembuka: string | null; ditutup_pada: unknown; ditutup_oleh: string | null;
  created_at: unknown; created_by: string;
}
function rowToRecap(r: RecapRow): Recap {
  return {
    id: r.id,
    clientId: r.client_id,
    planId: r.plan_id ?? null,
    isoYear: Number(r.iso_year),
    isoWeek: Number(r.iso_week),
    mingguMulai: dateStr(r.minggu_mulai),
    mingguAkhir: dateStr(r.minggu_akhir),
    status: r.status,
    pernahDitutupOtomatis: r.pernah_ditutup_otomatis,
    catatanPembuka: optStr(r.catatan_pembuka),
    ditutupPada: r.ditutup_pada ? isoTs(r.ditutup_pada) : null,
    ditutupOleh: optStr(r.ditutup_oleh),
    createdAt: isoTs(r.created_at),
    createdBy: r.created_by,
  };
}

// --- Permission gates (read + division-note write) -------------------------

/**
 * canReadRecap: own-clients (assigned AM) / SPV+Head (Account lead) / OD+Director
 * (read-all) / **the lead of a division that touched the client this week**
 * (RM-D6 read arm — so a division lead can see the recap they owe a note on).
 * The division-lead arm is the O48 read-widening D-09 adds (see the D-09 migration
 * + DECISIONS 2026-08-13); it is mirrored in the RLS SELECT policy.
 */
export function canReadRecap(actor: Actor, ownerAm: string | null, touchedDivisions: readonly string[]): boolean {
  if (permission.canReadAll(actor)) return true;
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  if (ownerAm !== null && ownerAm === actor.employeeId) return true;
  return touchedDivisions.some((d) => permission.isLead(actor, d));
}

/**
 * canWriteRecapDivisiNote: RM-D6 — the lead of the touching division writes their
 * OWN division's note (an Account lead/Head/Director may too, as override).
 */
export function canWriteRecapDivisiNote(actor: Actor, divisi: string): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return permission.isLead(actor, divisi);
}

// --- Read loaders ----------------------------------------------------------

async function loadRecap(sql: Queryable, id: string): Promise<Recap> {
  const rows = await sql<RecapRow[]>`select * from weekly_result_recap where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_RECAP_NOT_FOUND);
  return rowToRecap(rows[0]);
}
function loadRecapForUpdate(tx: TransactionSql, id: string): Promise<Recap> {
  return tx<RecapRow[]>`select * from weekly_result_recap where id = ${id} for update`.then((rows) => {
    if (rows.length === 0) throw new NotFoundError(MSG_RECAP_NOT_FOUND);
    return rowToRecap(rows[0]);
  });
}
async function ownerAmOfClient(sql: Queryable, clientId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  return rows[0].assigned_am_id;
}
async function touchedDivisions(sql: Queryable, recapId: string): Promise<string[]> {
  const rows = await sql<{ divisi: string }[]>`
    select divisi from wrr_divisi where recap_id = ${recapId} order by divisi`;
  return rows.map((r) => r.divisi);
}

/** getRecapDetail — the full recap bundle, scope-gated (canReadRecap). */
export async function getRecapDetail(sql: Queryable, actor: Actor, id: string): Promise<RecapDetail> {
  const recap = await loadRecap(sql, id);
  const ownerAm = await ownerAmOfClient(sql, recap.clientId);
  const touched = await touchedDivisions(sql, id);
  if (!canReadRecap(actor, ownerAm, touched)) throw new ForbiddenError(MSG_RECAP_FORBIDDEN);

  const divisiRows = await sql<{ recap_id: string; divisi: string; jumlah_produksi: number | string;
    rincian: Record<string, unknown>; sengketa: string | null }[]>`
    select recap_id, divisi, jumlah_produksi, rincian, sengketa
      from wrr_divisi where recap_id = ${id} order by divisi`;
  const metrikRows = await sql<{ recap_id: string; metrik: string; nilai: unknown; sumber: string;
    file_bukti: string | null; tanggal_ambil: unknown; nilai_minggu_lalu: unknown; sengketa: string | null }[]>`
    select recap_id, metrik, nilai, sumber, file_bukti, tanggal_ambil, nilai_minggu_lalu, sengketa
      from wrr_metrik where recap_id = ${id} order by metrik`;
  const catatanRows = await sql<{ recap_id: string; yang_bergerak: string | null; yang_tertahan: string | null;
    fokus_minggu_depan: string | null; bahan_untuk_klien: string | null; catatan_metrik_tambahan: string | null }[]>`
    select recap_id, yang_bergerak, yang_tertahan, fokus_minggu_depan, bahan_untuk_klien, catatan_metrik_tambahan
      from wrr_catatan where recap_id = ${id}`;
  const catatanDivisiRows = await sql<{ id: number; recap_id: string; divisi: string; catatan: string;
    created_at: unknown; created_by: string }[]>`
    select id, recap_id, divisi, catatan, created_at, created_by
      from wrr_catatan_divisi where recap_id = ${id} order by created_at`;

  return {
    recap,
    divisi: divisiRows.map((d) => ({
      recapId: d.recap_id, divisi: d.divisi, jumlahProduksi: Number(d.jumlah_produksi),
      rincian: d.rincian ?? {}, sengketa: optStr(d.sengketa),
    })),
    metrik: metrikRows.map((m) => ({
      recapId: m.recap_id, metrik: m.metrik, nilai: optNum(m.nilai), sumber: m.sumber,
      fileBukti: optStr(m.file_bukti), tanggalAmbil: m.tanggal_ambil ? dateStr(m.tanggal_ambil) : null,
      nilaiMingguLalu: optNum(m.nilai_minggu_lalu), sengketa: optStr(m.sengketa),
    })),
    catatan: catatanRows.length === 0 ? null : {
      recapId: catatanRows[0].recap_id,
      yangBergerak: optStr(catatanRows[0].yang_bergerak),
      yangTertahan: optStr(catatanRows[0].yang_tertahan),
      fokusMingguDepan: optStr(catatanRows[0].fokus_minggu_depan),
      bahanUntukKlien: optStr(catatanRows[0].bahan_untuk_klien),
      catatanMetrikTambahan: optStr(catatanRows[0].catatan_metrik_tambahan),
    },
    catatanDivisi: catatanDivisiRows.map((c) => ({
      id: Number(c.id), recapId: c.recap_id, divisi: c.divisi, catatan: c.catatan,
      createdAt: isoTs(c.created_at), createdBy: c.created_by,
    })),
  };
}

/** listRecapsForClient — a client's recap chain, newest week first, scope-gated. */
export async function listRecapsForClient(sql: Queryable, actor: Actor, clientId: string): Promise<Recap[]> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  // Division-lead read arm is per-recap (depends on which divisions touched each
  // week); at the client-list level we admit AM-owner / Account-lead / read-all.
  if (!(permission.canReadAll(actor) || permission.isLead(actor, ACCOUNT_DIVISION)
        || (ownerAm !== null && ownerAm === actor.employeeId))) {
    throw new ForbiddenError(MSG_RECAP_FORBIDDEN);
  }
  const rows = await sql<RecapRow[]>`
    select * from weekly_result_recap where client_id = ${clientId}
     order by iso_year desc, iso_week desc`;
  return rows.map(rowToRecap);
}

/** getPlanRekapRollup — RM-E read-only rollup (D-08) for a plan period, gated. */
export async function getPlanRekapRollup(sql: Queryable, actor: Actor, planId: string): Promise<unknown> {
  const planRows = await sql<{ client_id: string }[]>`select client_id from plan where id = ${planId}`;
  if (planRows.length === 0) throw new NotFoundError('[periode plan tidak ditemukan]');
  const ownerAm = await ownerAmOfClient(sql, planRows[0].client_id);
  if (!(permission.canReadAll(actor) || permission.isLead(actor, ACCOUNT_DIVISION)
        || (ownerAm !== null && ownerAm === actor.employeeId))) {
    throw new ForbiddenError(MSG_RECAP_FORBIDDEN);
  }
  const rows = await sql<{ r: unknown }[]>`select wrr_plan_rollup(${planId}) as r`;
  return rows[0].r;
}

// --- Write helpers ---------------------------------------------------------

/** Assert the actor may write the recap's AM-writable fields, or throw. */
async function assertCanWrite(tx: TransactionSql, actor: Actor, recap: Recap): Promise<void> {
  const ownerAm = await ownerAmOfClient(tx, recap.clientId);
  if (!canWriteRecap(actor, ownerAm)) throw new ForbiddenError(MSG_RECAP_FORBIDDEN);
}
function requireOpen(recap: Recap): void {
  if (recap.status !== WRR_TERBUKA) throw new ConflictError(MSG_RECAP_NOT_OPEN);
}

// --- RM-A6: opening note ---------------------------------------------------
/** saveRecapPembuka — RM-A6 «Catatan Pembuka» (AM, while open). */
export async function saveRecapPembuka(sql: Sql, actor: Actor, id: string, catatanPembuka: string): Promise<Recap> {
  const teks = (catatanPembuka ?? '').trim();
  return withTransaction(sql, async (tx) => {
    const recap = await loadRecapForUpdate(tx, id);
    await assertCanWrite(tx, actor, recap);
    requireOpen(recap);
    await tx`update weekly_result_recap set catatan_pembuka = ${teks === '' ? null : teks} where id = ${id}`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_RECAP, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'catatan_pembuka_disimpan',
      beforeJson: { catatan_pembuka: recap.catatanPembuka }, afterJson: { catatan_pembuka: teks },
      createdBy: actor.employeeId,
    });
    return loadRecap(tx, id);
  });
}

// --- RM-D / RM-C9: narrative (full-replace upsert) -------------------------
export interface RecapNarasiInput {
  yangBergerak?: string | null;
  yangTertahan?: string | null;
  fokusMingguDepan?: string | null;
  bahanUntukKlien?: string | null;
  catatanMetrikTambahan?: string | null;
}
function optText(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}
/** saveRecapNarasi — RM-D1/2/3/5 + RM-C9 (full replace: omitted → null, not merged). */
export async function saveRecapNarasi(sql: Sql, actor: Actor, id: string, input: RecapNarasiInput): Promise<RecapCatatan> {
  return withTransaction(sql, async (tx) => {
    const recap = await loadRecapForUpdate(tx, id);
    await assertCanWrite(tx, actor, recap);
    requireOpen(recap);
    const bergerak = optText(input.yangBergerak);
    const tertahan = optText(input.yangTertahan);
    const fokus = optText(input.fokusMingguDepan);
    const bahan = optText(input.bahanUntukKlien);
    const metrikTambahan = optText(input.catatanMetrikTambahan);
    await tx`
      insert into wrr_catatan
        (recap_id, yang_bergerak, yang_tertahan, fokus_minggu_depan, bahan_untuk_klien, catatan_metrik_tambahan, created_by)
      values (${id}, ${bergerak}, ${tertahan}, ${fokus}, ${bahan}, ${metrikTambahan}, ${actor.employeeId})
      on conflict (recap_id) do update
        set yang_bergerak = excluded.yang_bergerak, yang_tertahan = excluded.yang_tertahan,
            fokus_minggu_depan = excluded.fokus_minggu_depan, bahan_untuk_klien = excluded.bahan_untuk_klien,
            catatan_metrik_tambahan = excluded.catatan_metrik_tambahan, updated_at = now()`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_RECAP, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'narasi_disimpan',
      beforeJson: {}, afterJson: { yang_bergerak: bergerak, fokus_minggu_depan: fokus },
      createdBy: actor.employeeId,
    });
    const rows = await tx<{ recap_id: string; yang_bergerak: string | null; yang_tertahan: string | null;
      fokus_minggu_depan: string | null; bahan_untuk_klien: string | null; catatan_metrik_tambahan: string | null }[]>`
      select recap_id, yang_bergerak, yang_tertahan, fokus_minggu_depan, bahan_untuk_klien, catatan_metrik_tambahan
        from wrr_catatan where recap_id = ${id}`;
    return {
      recapId: rows[0].recap_id, yangBergerak: optStr(rows[0].yang_bergerak),
      yangTertahan: optStr(rows[0].yang_tertahan), fokusMingguDepan: optStr(rows[0].fokus_minggu_depan),
      bahanUntukKlien: optStr(rows[0].bahan_untuk_klien), catatanMetrikTambahan: optStr(rows[0].catatan_metrik_tambahan),
    };
  });
}

// --- RM-C: manual fallback metric (isi atau `—`) ---------------------------
export interface RecapMetrikManualInput {
  /** null / 'tidak_tersedia' marker → `—`; a number → a sourced manual figure. */
  nilai: number | null;
  fileBukti?: string;
  tanggalAmbil?: string;
}
/** recordRecapMetrikManual — RM-C3/C4/C5 manual fallback or `—` (tidak_tersedia). */
export async function recordRecapMetrikManual(
  sql: Sql, actor: Actor, id: string, metrik: string, input: RecapMetrikManualInput,
): Promise<RecapMetrik> {
  if (!MANUAL_ELIGIBLE_METRICS.includes(metrik)) throw new ValidationError(MSG_METRIK_AUTO_ONLY);
  return withTransaction(sql, async (tx) => {
    const recap = await loadRecapForUpdate(tx, id);
    await assertCanWrite(tx, actor, recap);
    requireOpen(recap);
    // Never let a manual write clobber an auto figure (belt is latent under the
    // service-role write path — jwt actor NULL — so enforce it here in TS).
    const existing = await tx<{ sumber: string }[]>`
      select sumber from wrr_metrik where recap_id = ${id} and metrik = ${metrik}`;
    if (existing.length > 0 && existing[0].sumber === 'otomatis') {
      throw new ConflictError(MSG_METRIK_NOT_MANUAL);
    }
    let sumber: string;
    let nilai: number | null;
    let fileBukti: string | null;
    let tanggalAmbil: string | null;
    if (input.nilai === null) {
      sumber = 'tidak_tersedia'; nilai = null; fileBukti = null; tanggalAmbil = null;
    } else {
      if (!Number.isFinite(input.nilai) || input.nilai < 0) throw new ValidationError(MSG_METRIK_AUTO_ONLY);
      const fb = (input.fileBukti ?? '').trim();
      const ta = (input.tanggalAmbil ?? '').trim();
      if (fb === '' || ta === '') throw new ValidationError(MSG_METRIK_BUKTI);
      sumber = 'manual'; nilai = input.nilai; fileBukti = fb; tanggalAmbil = ta;
    }
    await tx`
      insert into wrr_metrik (recap_id, metrik, sumber, nilai, file_bukti, tanggal_ambil, created_by)
      values (${id}, ${metrik}, ${sumber}, ${nilai}, ${fileBukti}, ${tanggalAmbil}, ${actor.employeeId})
      on conflict (recap_id, metrik) do update
        set sumber = excluded.sumber, nilai = excluded.nilai,
            file_bukti = excluded.file_bukti, tanggal_ambil = excluded.tanggal_ambil, updated_at = now()`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_RECAP, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'metrik_manual_dicatat',
      beforeJson: {}, afterJson: { metrik, sumber, nilai },
      createdBy: actor.employeeId,
    });
    const rows = await tx<{ recap_id: string; metrik: string; nilai: unknown; sumber: string;
      file_bukti: string | null; tanggal_ambil: unknown; nilai_minggu_lalu: unknown; sengketa: string | null }[]>`
      select recap_id, metrik, nilai, sumber, file_bukti, tanggal_ambil, nilai_minggu_lalu, sengketa
        from wrr_metrik where recap_id = ${id} and metrik = ${metrik}`;
    return {
      recapId: rows[0].recap_id, metrik: rows[0].metrik, nilai: optNum(rows[0].nilai), sumber: rows[0].sumber,
      fileBukti: optStr(rows[0].file_bukti), tanggalAmbil: rows[0].tanggal_ambil ? dateStr(rows[0].tanggal_ambil) : null,
      nilaiMingguLalu: optNum(rows[0].nilai_minggu_lalu), sengketa: optStr(rows[0].sengketa),
    };
  });
}

// --- RM-B6 / RM-C: Sengketa Angka on an auto figure → notif SPV ------------
async function emitSengketa(tx: TransactionSql, actor: Actor, id: string): Promise<void> {
  const ex = executors(tx);
  await notification.emit(ex.notify, {
    event: notification.EVENTS.RekapSengketaAngka,
    entityType: ENTITY_RECAP, entityId: id, actor: actor.employeeId,
    deepLink: `/account/rekap/${id}`, division: ACCOUNT_DIVISION,
  });
}
/** fileRecapSengketaMetrik — RM-C dispute on an `otomatis` metric (routes to SPV). */
export async function fileRecapSengketaMetrik(sql: Sql, actor: Actor, id: string, metrik: string, alasan: string): Promise<void> {
  const teks = (alasan ?? '').trim();
  if (teks === '') throw new ValidationError(MSG_SENGKETA_TARGET);
  return withTransaction(sql, async (tx) => {
    const recap = await loadRecapForUpdate(tx, id);
    await assertCanWrite(tx, actor, recap);
    requireOpen(recap);
    const upd = await tx`
      update wrr_metrik set sengketa = ${teks}
       where recap_id = ${id} and metrik = ${metrik} and sumber = 'otomatis'`;
    if (upd.count === 0) throw new ConflictError(MSG_SENGKETA_TARGET);
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_RECAP, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'sengketa_metrik_diajukan', beforeJson: { metrik }, afterJson: { metrik, alasan: teks },
      createdBy: actor.employeeId,
    });
    await emitSengketa(tx, actor, id);
  });
}
/** fileRecapSengketaDivisi — RM-B6 dispute on a division production figure. */
export async function fileRecapSengketaDivisi(sql: Sql, actor: Actor, id: string, divisi: string, alasan: string): Promise<void> {
  const teks = (alasan ?? '').trim();
  if (teks === '') throw new ValidationError(MSG_SENGKETA_TARGET);
  return withTransaction(sql, async (tx) => {
    const recap = await loadRecapForUpdate(tx, id);
    await assertCanWrite(tx, actor, recap);
    requireOpen(recap);
    const upd = await tx`
      update wrr_divisi set sengketa = ${teks} where recap_id = ${id} and divisi = ${divisi}`;
    if (upd.count === 0) throw new NotFoundError(MSG_SENGKETA_TARGET);
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_RECAP, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'sengketa_divisi_diajukan', beforeJson: { divisi }, afterJson: { divisi, alasan: teks },
      createdBy: actor.employeeId,
    });
    await emitSengketa(tx, actor, id);
  });
}

// --- RM-D6: division note (append-only) ------------------------------------
/** addRecapCatatanDivisi — RM-D6 weekly note owed by a touching division. */
export async function addRecapCatatanDivisi(
  sql: Sql, actor: Actor, id: string, divisi: string, catatan: string,
): Promise<RecapCatatanDivisi> {
  if (!DIVISIONS.includes(divisi)) throw new ValidationError(MSG_DIVISI_NOT_TOUCHED);
  const teks = (catatan ?? '').trim();
  if (teks === '') throw new ValidationError('[catatan divisi tidak boleh kosong]');
  if (!canWriteRecapDivisiNote(actor, divisi)) throw new ForbiddenError(MSG_RECAP_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    const recap = await loadRecapForUpdate(tx, id);
    requireOpen(recap);
    // The division must actually have touched the client this week (has a
    // production row) — a note from an uninvolved division is meaningless.
    const touched = await tx`select 1 from wrr_divisi where recap_id = ${id} and divisi = ${divisi}`;
    if (touched.length === 0) throw new ConflictError(MSG_DIVISI_NOT_TOUCHED);
    const rows = await tx<{ id: number; recap_id: string; divisi: string; catatan: string;
      created_at: unknown; created_by: string }[]>`
      insert into wrr_catatan_divisi (recap_id, divisi, catatan, created_by)
      values (${id}, ${divisi}, ${teks}, ${actor.employeeId})
      returning id, recap_id, divisi, catatan, created_at, created_by`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_RECAP, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'catatan_divisi_ditambah', beforeJson: { divisi }, afterJson: { divisi, catatan: teks },
      createdBy: actor.employeeId,
    });
    return {
      id: Number(rows[0].id), recapId: rows[0].recap_id, divisi: rows[0].divisi, catatan: rows[0].catatan,
      createdAt: isoTs(rows[0].created_at), createdBy: rows[0].created_by,
    };
  });
}

// --- Close (metric-completeness belt over the DB narrative gate) -----------
/**
 * closeRecap — `Terbuka → Ditutup` (AM confirm, Rule 8). The domain belt: RM-A6
 * present, RM-D1/RM-D3 present, and every required RM-C metric filled-or-`—`
 * (the completeness check D-05 deliberately moved here — the DB narrative gate
 * cannot know whether aggregation ran). The DB gate still fires under the
 * transition as the ultimate wall. On close, fires catatan_divisi_belum_diisi for
 * every touching division that owes a note but has not filed (RM-8 / job c).
 */
export async function closeRecap(sql: Sql, actor: Actor, id: string): Promise<Recap> {
  return withTransaction(sql, async (tx) => {
    const recap = await loadRecapForUpdate(tx, id);
    const ownerAm = await ownerAmOfClient(tx, recap.clientId);
    if (!canCloseRecap(actor, ownerAm)) throw new ForbiddenError(MSG_RECAP_FORBIDDEN);
    if (recap.status !== WRR_TERBUKA) throw new ConflictError(MSG_RECAP_NOT_OPEN);

    // RM-A6 opening note.
    if (recap.catatanPembuka === null || recap.catatanPembuka.trim() === '') {
      throw new ValidationError(MSG_CLOSE_PEMBUKA);
    }
    // RM-D1 + RM-D3 narrative (belt; DB gate is the braces).
    const cat = await tx<{ yang_bergerak: string | null; fokus_minggu_depan: string | null }[]>`
      select yang_bergerak, fokus_minggu_depan from wrr_catatan where recap_id = ${id}`;
    const bergerak = cat[0]?.yang_bergerak ?? null;
    const fokus = cat[0]?.fokus_minggu_depan ?? null;
    if (!bergerak || bergerak.trim() === '' || !fokus || fokus.trim() === '') {
      throw new ValidationError(MSG_CLOSE_NARASI);
    }
    // Every required RM-C metric has a row (auto-filled, manual, or `—`).
    const present = await tx<{ metrik: string }[]>`
      select metrik from wrr_metrik where recap_id = ${id} and metrik in ${tx(REQUIRED_AT_CLOSE_METRICS as string[])}`;
    const have = new Set(present.map((p) => p.metrik));
    for (const m of REQUIRED_AT_CLOSE_METRICS) {
      if (!have.has(m)) throw new ValidationError(MSG_CLOSE_METRIK);
    }

    await transitionRecap(tx, actor, id, WRR_DITUTUP);
    await tx`update weekly_result_recap set ditutup_pada = now(), ditutup_oleh = ${actor.employeeId} where id = ${id}`;

    // Job (c) at close — divisions owing a mandatory note that have not filed.
    const owing = await tx<{ divisi: string }[]>`
      select d.divisi from wrr_divisi d
       where d.recap_id = ${id}
         and not exists (select 1 from wrr_catatan_divisi cd where cd.recap_id = ${id} and cd.divisi = d.divisi)`;
    const ex = executors(tx);
    for (const o of owing) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.CatatanDivisiBelumDiisi,
        entityType: ENTITY_RECAP, entityId: id, actor: actor.employeeId,
        deepLink: `/account/rekap/${id}`, division: o.divisi,
        explicitRecipients: ownerAm === null ? [] : [ownerAm],
      });
    }
    return loadRecap(tx, id);
  });
}

/** reopenRecap — `Ditutup Otomatis → Terbuka` (Head only, RM-5). Reason logged; the
 * permanent pernah_ditutup_otomatis flag is never cleared (DB guard). */
export async function reopenRecap(sql: Sql, actor: Actor, id: string, alasan: string): Promise<Recap> {
  const teks = (alasan ?? '').trim();
  if (teks === '') throw new ValidationError(MSG_REOPEN_REASON);
  if (!canReopenRecap(actor)) throw new ForbiddenError(MSG_RECAP_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    const recap = await loadRecapForUpdate(tx, id);
    if (recap.status !== WRR_DITUTUP_OTOMATIS) throw new ConflictError('[hanya rekap Ditutup Otomatis yang dapat dibuka kembali]');
    await transitionRecap(tx, actor, id, WRR_TERBUKA);
    await tx`update weekly_result_recap set ditutup_pada = null, ditutup_oleh = null where id = ${id}`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_RECAP, entityId: id, actorEmployeeId: actor.employeeId,
      action: 'dibuka_kembali', beforeJson: { status: WRR_DITUTUP_OTOMATIS },
      afterJson: { status: WRR_TERBUKA, alasan: teks }, createdBy: actor.employeeId,
    });
    return loadRecap(tx, id);
  });
}
