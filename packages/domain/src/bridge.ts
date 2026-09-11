/**
 * Bridge MSDPS → CDPS, Fase 1 — inbox `ORD-` + gate penerimaan Head Account.
 *
 * **Ini BUKAN modul PRD.** Otoritasnya `docs/DECISIONS.md` 2026-09-10, yang
 * MENGGANTIKAN entri 2026-07-12 ("TikTok GO di luar cakupan CDPS") —
 * preseden `TSK-` Penugasan Internal, "di luar 18 PRD" (`DATA_MODEL.md:44`).
 *
 * **Kenapa modul terpisah, bukan reuse `sales.close()`.** MSDPS mengirim
 * satu order yang sudah berbayar dan sudah terverifikasi — tidak ada
 * Lead/Prospect/Negotiation CDPS di baliknya, dan tidak boleh ada `TRX-`
 * (§4.3/§4.6 rencana bridging: transaksi bayangan akan masuk antrean
 * verifikasi M5, dashboard reminder, accrual, dan Kinerja Sales — empat
 * angka salah demi satu FK yang nyaman). `bridge.accept` adalah
 * **implementasi paralel yang DISENGAJA** terhadap `sales.close()`, bukan
 * reuse — preseden `renewal.ts`, dijustifikasi di `index.ts:150-153`.
 *
 * **Dua amandemen terhadap rencana asli, ditulis di sini karena kode ini
 * yang mewujudkannya** (detail penuh + tiga temuan lain di header migrasi
 * `20261007010000_bridge_msdps_fase1.sql`):
 *
 *   - **D5 → opsi (b).** BUKAN "BD MEAGO sync sebagai employee tanpa
 *     login" (employees.email NOT NULL + UNIQUE, provisionCredentials
 *     memberi kredensial ke SETIAP employee aktif). SATU employee layanan
 *     "MEAGO Bridge" — id-nya datang dari `input.bridgeEmployeeId`
 *     (diresolusi API layer dari env `MEAGO_BRIDGE_EMPLOYEE_ID`, divalidasi
 *     di sini terhadap tabel `employees`). Identitas BD MEAGO tidak hilang:
 *     ia terekam di `external_orders.payload` (imutabel) dan
 *     `client_external_billing.diverifikasi_oleh_external`.
 *   - **§4.3 → `services.sumber` + `clients.sumber`.** Komisi dijumlahkan
 *     PER LAYANAN (`finance.dealServices`), bukan per klien — satu klien
 *     lama boleh menerima satu layanan MEAGO tanpa seluruh riwayat
 *     komisinya ikut terkontaminasi. Setiap `SVC-` yang dibuat di sini
 *     WAJIB `sumber='meago'`.
 *
 * **D10 dibaca ulang** — gerbang tulis di sini adalah `permission.isLead(actor,
 * ACCOUNT_DIVISION)` (lead Account ATAU Director), BUKAN "Head Account saja":
 * tier "Head" terpisah belum ada di model peran (wave K-1, sengaja ditunda
 * pemilik 2026-09-07), dan `isLead` sudah mengikutsertakan Director.
 *
 * Pakai engine yang ada apa adanya — `ident`, `statemachine`, `audit`,
 * `notification`, `money`, `tz`. Reuse `msl.sellableAt` untuk resolusi versi
 * MSL aktif (bukan query paralel). **Jangan reimplementasi `msl`/`ident`/
 * `statemachine`/`audit`/`notification` — satu-satunya pengecualian adalah
 * `contracts` (lihat komentar di `accept()`): `contract.createContract`
 * membuka transaksinya sendiri dan tidak bisa dipanggil dari dalam transaksi
 * `bridge.accept`, jadi baris `insert into contracts` ditulis langsung di
 * sini, bentuknya identik dengan yang `createContract` tulis.
 */

import { ident, money, notification, permission, statemachine, tz } from '@cdps/core';
import {
  executors,
  withTransaction,
  type Queryable,
  type Sql,
} from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import * as msl from './msl';

const MACHINE = 'external_order';
const ENTITY_ORDER = 'external_order';
const ENTITY_CLIENT = 'client';
const SUMBER_MEAGO = 'meago';
const PAYLOAD_VERSI_DIDUKUNG = 1;

// ---------------------------------------------------------------------------
// BI messages (CLAUDE.md #5). Bridge is not a PRD module, so no PRD supplies
// these strings — they follow the house default + the exact string the
// rencana bridging locks for the unmapped-service case.
// ---------------------------------------------------------------------------

export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_ORDER_NOT_FOUND = '[order tidak ditemukan]';
export const MSG_FORBIDDEN = '[anda tidak memiliki akses untuk mengelola order bridge ini]';
export const MSG_UNKNOWN_PAYLOAD_VERSION =
  '[versi payload bridge tidak dikenali, hubungi tim engineering]';
export const MSG_NO_ATTESTATION =
  '[atestasi pembayaran MSDPS tidak ditemukan pada payload, order tidak dapat diterima]';
/** Locked verbatim by the rencana bridging (§0.2 / A2 step 7) — do not reword. */
export const MSG_UNMAPPED_SERVICE = '[layanan MEAGO belum dipetakan ke Master Service List]';
export const MSG_ALREADY_DECIDED = '[order ini sudah diputuskan]';
export const MSG_BRIDGE_EMPLOYEE_NOT_FOUND =
  '[employee layanan MEAGO Bridge tidak ditemukan, hubungi admin]';
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';

// ---------------------------------------------------------------------------
// Permission — mirrors sm_edges gate (require_lead + require_division=Account)
// exactly, so the TS-side 403 and the SQL-side role_denied never diverge.
// ---------------------------------------------------------------------------

/** canDecideOrder: lead Account or Director (D10, re-read — see header). */
export function canDecideOrder(actor: Actor): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION);
}

// ---------------------------------------------------------------------------
// Payload v1 shape (docs/BRIDGE_MSDPS_CONTRACT.md). Duplicated types, no
// published package (D12) — the committed fixture in both repos is what
// keeps them from drifting, not a shared import.
// ---------------------------------------------------------------------------

export interface BridgePayloadLine {
  jenis: string;
  qty: number | null;
  catatan: string | null;
  alasanNonRoster: string | null;
  nilaiCrossCharge: string | null;
}

export interface BridgeAttestation {
  externalTrxRef: string;
  bentukKerjasama: string;
  nilai: string | null;
  diverifikasiPada: string; // ISO datetime — required (D13 gate lives at the source)
  diverifikasiOlehExternal: string | null;
}

export interface BridgeMerchant {
  externalId: string;
  nama: string;
  kota: string;
  kategoriPoi: string;
  picNama: string;
  picWhatsapp: string | null;
  tanggalMulaiKontrak: string;
  tanggalAkhirKontrak: string;
}

export interface BridgeOrderPayloadV1 {
  payloadVersi: 1;
  dealCode: string;
  bdIdentitas: string;
  merchant: BridgeMerchant;
  attestation: BridgeAttestation;
  lines: BridgePayloadLine[];
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function requireStr(v: unknown): string {
  const s = str(v);
  if (s === null) throw new ValidationError(MSG_INCOMPLETE);
  return s;
}

/**
 * parsePayloadV1 validates the raw JSON MSDPS sends against the contract
 * (docs/BRIDGE_MSDPS_CONTRACT.md v1). Unknown/missing `payload_versi` is
 * rejected explicitly rather than guessed (rencana bridging §4.5).
 */
export function parsePayloadV1(raw: unknown): BridgeOrderPayloadV1 {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const p = raw as Record<string, unknown>;
  if (Number(p.payload_versi) !== PAYLOAD_VERSI_DIDUKUNG) {
    throw new ValidationError(MSG_UNKNOWN_PAYLOAD_VERSION);
  }
  const dealCode = requireStr(p.deal_code);
  const bdIdentitas = requireStr(p.bd_identitas);

  const m = p.merchant as Record<string, unknown> | undefined;
  if (m === undefined || typeof m !== 'object') throw new ValidationError(MSG_INCOMPLETE);
  const merchant: BridgeMerchant = {
    externalId: requireStr(m.external_id),
    nama: requireStr(m.nama),
    kota: requireStr(m.kota),
    kategoriPoi: requireStr(m.kategori_poi),
    picNama: requireStr(m.pic_nama),
    picWhatsapp: str(m.pic_whatsapp),
    tanggalMulaiKontrak: requireStr(m.tanggal_mulai_kontrak),
    tanggalAkhirKontrak: requireStr(m.tanggal_akhir_kontrak),
  };

  const a = p.attestation as Record<string, unknown> | undefined;
  if (a === undefined || typeof a !== 'object') throw new ValidationError(MSG_INCOMPLETE);
  const diverifikasiPada = str(a.diverifikasi_pada);
  if (diverifikasiPada === null) {
    throw new ValidationError(MSG_NO_ATTESTATION);
  }
  if (str(a.bentuk_kerjasama) !== 'Berbayar') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const attestation: BridgeAttestation = {
    externalTrxRef: requireStr(a.external_trx_ref),
    bentukKerjasama: 'Berbayar',
    nilai: a.nilai === null || a.nilai === undefined ? null : String(a.nilai),
    diverifikasiPada,
    diverifikasiOlehExternal: str(a.diverifikasi_oleh_external),
  };

  const rawLines = p.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const lines: BridgePayloadLine[] = rawLines.map((rl) => {
    if (rl === null || typeof rl !== 'object') throw new ValidationError(MSG_INCOMPLETE);
    const l = rl as Record<string, unknown>;
    const jenis = requireStr(l.jenis);
    const alasanNonRoster = str(l.alasan_non_roster);
    if (jenis === 'KOL-Non-Roster' && alasanNonRoster === null) {
      throw new ValidationError(MSG_INCOMPLETE);
    }
    return {
      jenis,
      qty: l.qty === null || l.qty === undefined ? null : Number(l.qty),
      catatan: str(l.catatan),
      alasanNonRoster,
      nilaiCrossCharge:
        l.nilai_cross_charge === null || l.nilai_cross_charge === undefined
          ? null
          : String(l.nilai_cross_charge),
    };
  });

  return { payloadVersi: 1, dealCode, bdIdentitas, merchant, attestation, lines };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface BridgeOrderSummary {
  id: string;
  sumber: string;
  externalDealCode: string;
  status: string;
  diterimaPada: string;
  clientId: string | null;
  ditolakAlasan: string | null;
  diputusOleh: string | null;
  diputusPada: string | null;
}

export interface BridgeOrderDetail extends BridgeOrderSummary {
  payloadVersi: number;
  payload: BridgeOrderPayloadV1;
}

interface OrderRow {
  id: string;
  sumber: string;
  external_deal_code: string;
  payload: unknown;
  payload_versi: number;
  diterima_pada: Date;
  status: string;
  client_id: string | null;
  ditolak_alasan: string | null;
  diputus_oleh: string | null;
  diputus_pada: Date | null;
}

function rowToSummary(r: OrderRow): BridgeOrderSummary {
  return {
    id: r.id,
    sumber: r.sumber,
    externalDealCode: r.external_deal_code,
    status: r.status,
    diterimaPada: r.diterima_pada.toISOString(),
    clientId: r.client_id,
    ditolakAlasan: r.ditolak_alasan,
    diputusOleh: r.diputus_oleh,
    diputusPada: r.diputus_pada ? r.diputus_pada.toISOString() : null,
  };
}

function rowToDetail(r: OrderRow): BridgeOrderDetail {
  return {
    ...rowToSummary(r),
    payloadVersi: r.payload_versi,
    // `payload` is stored EXACTLY as MSDPS sent it (raw wire JSON, snake_case)
    // — parsePayloadV1 re-derives the typed shape on every read, never a
    // cached cast, so a stored fixture and a freshly-ingested row are read
    // identically.
    payload: parsePayloadV1(r.payload),
  };
}

async function loadOrder(sql: Queryable, id: string, forUpdate = false): Promise<OrderRow> {
  const rows = forUpdate
    ? await sql<OrderRow[]>`select * from external_orders where id = ${id} for update`
    : await sql<OrderRow[]>`select * from external_orders where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_ORDER_NOT_FOUND);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** listOrders — lead Account/Director/OD see everything; RLS narrows AM's own once accepted. */
export async function listOrders(
  sql: Queryable,
  status?: string,
): Promise<BridgeOrderSummary[]> {
  const rows =
    status === undefined
      ? await sql<OrderRow[]>`select * from external_orders order by diterima_pada desc`
      : await sql<OrderRow[]>`
          select * from external_orders where status = ${status}
           order by diterima_pada desc`;
  return rows.map(rowToSummary);
}

/** getOrder — full detail incl. immutable payload, for the accept/reject screen. */
export async function getOrder(sql: Queryable, id: string): Promise<BridgeOrderDetail> {
  return rowToDetail(await loadOrder(sql, id));
}

/** One dedup candidate for the accept screen — never auto-selected. */
export interface BridgeCandidate {
  clientId: string;
  toko: string;
  kota: string;
  /** 'exact' (client_external_ref) | 'link' (shop_id vs link_toko/store_link) | 'fuzzy' (toko+kota). */
  confidence: 'exact' | 'link' | 'fuzzy';
}

/**
 * candidates returns dedup matches in confidence order. Never picks for the
 * human — a wrong auto-merge is unrecoverable, a human choosing from three
 * candidates costs ten seconds (rencana bridging A2).
 */
export async function candidates(sql: Queryable, orderId: string): Promise<BridgeCandidate[]> {
  const order = await loadOrder(sql, orderId);
  const payload = parsePayloadV1(order.payload);
  const out: BridgeCandidate[] = [];
  const seen = new Set<string>();
  const push = (rows: { client_id: string; toko: string; kota: string }[], confidence: BridgeCandidate['confidence']) => {
    for (const r of rows) {
      if (seen.has(r.client_id)) continue;
      seen.add(r.client_id);
      out.push({ clientId: r.client_id, toko: r.toko, kota: r.kota, confidence });
    }
  };

  const exact = await sql<{ client_id: string; toko: string; kota: string }[]>`
    select c.id as client_id, c.toko, c.kota
      from client_external_ref ref
      join clients c on c.id = ref.client_id
     where ref.sumber = ${SUMBER_MEAGO} and ref.external_id = ${payload.merchant.externalId}`;
  push(exact, 'exact');

  const shopId = `%${payload.merchant.externalId}%`;
  const link = await sql<{ client_id: string; toko: string; kota: string }[]>`
    select distinct c.id as client_id, c.toko, c.kota
      from clients c
      left join client_platforms cp on cp.client_id = c.id
     where c.link_toko ilike ${shopId} or cp.store_link ilike ${shopId}`;
  push(link, 'link');

  const namaLike = `%${payload.merchant.nama}%`;
  const kotaLike = `%${payload.merchant.kota}%`;
  const fuzzy = await sql<{ client_id: string; toko: string; kota: string }[]>`
    select id as client_id, toko, kota from clients
     where toko ilike ${namaLike} and kota ilike ${kotaLike}`;
  push(fuzzy, 'fuzzy');

  return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * intake — called ONLY by the machine ingest route
 * (`POST /api/v1/internal/bridge/orders`), never by a JWT actor. Idempotent:
 * a repeated `idempotencyKey` returns the ORIGINAL ord_code, zero new rows,
 * zero second notification (MSDPS retries after an ambiguous timeout, and a
 * retry must never mint a second order).
 */
export async function intake(
  sql: Sql,
  rawPayload: unknown,
  idempotencyKey: string,
): Promise<{ ordCode: string; status: string }> {
  const key = (idempotencyKey ?? '').trim();
  if (key === '') throw new ValidationError(MSG_INCOMPLETE);

  return withTransaction(sql, async (tx) => {
    const existing = await tx<{ id: string; status: string }[]>`
      select id, status from external_orders where idempotency_key = ${key}`;
    if (existing.length > 0) {
      return { ordCode: existing[0].id, status: existing[0].status };
    }

    const payload = parsePayloadV1(rawPayload);
    const ex = executors(tx);
    const now = new Date();
    const id = await ident.nextId(ex.ident, 'ORD', now);

    await tx`
      insert into external_orders
        (id, sumber, external_deal_code, payload, payload_versi, idempotency_key)
      values
        (${id}, ${SUMBER_MEAGO}, ${payload.dealCode}, ${rawPayload as unknown as never}::jsonb,
         ${payload.payloadVersi}, ${key})`;

    await ex.audit.insertAudit({
      entityType: ENTITY_ORDER, entityId: id, actorEmployeeId: 'SYSTEM',
      action: 'create',
      beforeJson: null,
      afterJson: { sumber: SUMBER_MEAGO, external_deal_code: payload.dealCode },
      createdBy: 'SYSTEM',
    });

    await ex.notify.notifyEmit({
      event: notification.EVENTS.BridgeOrderMasuk,
      entityType: ENTITY_ORDER,
      entityId: id,
      actor: 'SYSTEM',
      deepLink: '',
      division: ACCOUNT_DIVISION,
      explicit: [],
      notifyActor: false,
    });

    return { ordCode: id, status: '[Masuk]' };
  });
}

/** Field the human accepting types by hand — never derived from the payload (D7). */
export interface BridgeAcceptInput {
  /** Existing CLI- to attach to, or null to mint a new one. */
  existingClientId: string | null;
  gmvBaseline: string;
  targetGmv: string;
  linkToko: string;
  kategori: string;
  /** Resolved by the API layer from env `MEAGO_BRIDGE_EMPLOYEE_ID` (D5 opsi b). */
  bridgeEmployeeId: string;
}

function parseMoneyField(v: string): string {
  try {
    return money.decimal(money.parse(v));
  } catch {
    throw new ValidationError(MSG_INCOMPLETE);
  }
}

/** Months between two YYYY-MM-DD dates, clamped to the contracts CHECK range [1,36]. */
function monthsBetween(mulai: string, akhir: string): number {
  const [y1, m1] = mulai.split('-').map(Number);
  const [y2, m2] = akhir.split('-').map(Number);
  const n = (y2 - y1) * 12 + (m2 - m1);
  return Math.min(36, Math.max(1, n));
}

/**
 * accept — one transaction, gated to lead Account/Director (D10). Refuses an
 * order lacking a payment attestation for ANY actor, Director included (the
 * CDPS-side guarantee behind D4/D13 — see rencana bridging A2 step 2).
 */
export async function accept(
  sql: Sql,
  actor: Actor,
  orderId: string,
  input: BridgeAcceptInput,
): Promise<BridgeOrderSummary> {
  if (!canDecideOrder(actor)) throw new ForbiddenError(MSG_FORBIDDEN);

  const gmvBaseline = parseMoneyField(input.gmvBaseline);
  const targetGmv = parseMoneyField(input.targetGmv);
  const linkToko = (input.linkToko ?? '').trim();
  const kategori = (input.kategori ?? '').trim();
  if (linkToko === '' || kategori === '') throw new ValidationError(MSG_INCOMPLETE);
  const bridgeEmployeeId = (input.bridgeEmployeeId ?? '').trim();
  if (bridgeEmployeeId === '') throw new ValidationError(MSG_INCOMPLETE);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const now = new Date();
    const order = await loadOrder(tx, orderId, true);
    if (order.status !== '[Masuk]') throw new ConflictError(MSG_ALREADY_DECIDED);

    // parsePayloadV1 already refuses a payload with no attestation
    // (MSG_NO_ATTESTATION) — the CDPS-side guarantee behind D4/D13 runs on
    // every read of the stored payload, not only at intake, so a future
    // payload_versi cannot slip an unattested order past this gate.
    const payload = parsePayloadV1(order.payload);

    const bridgeEmp = await tx<{ employee_id: string }[]>`
      select employee_id from employees where employee_id = ${bridgeEmployeeId} and status_aktif`;
    if (bridgeEmp.length === 0) throw new ValidationError(MSG_BRIDGE_EMPLOYEE_NOT_FOUND);

    // Resolve every line's Master Service BEFORE writing anything — an
    // unmapped line must fail the WHOLE accept atomically (rencana bridging
    // §0.2 / A2 step 7), never a half-real order.
    const resolved: {
      masterServiceId: string;
      versionNo: number;
      name: string;
      standardPrice: string;
      commissionRule: string;
      requiresStrategyPlan: boolean;
      planTier: string | null;
    }[] = [];
    for (const line of payload.lines) {
      const mapRows = await tx<{ master_service_id: string }[]>`
        select master_service_id from external_service_map
         where sumber = ${SUMBER_MEAGO} and external_service_type = ${line.jenis} and aktif`;
      if (mapRows.length === 0) throw new ValidationError(MSG_UNMAPPED_SERVICE);
      let view;
      try {
        view = await msl.sellableAt(tx, mapRows[0].master_service_id, tz.dateString(now));
      } catch {
        throw new ValidationError(MSG_UNMAPPED_SERVICE);
      }
      resolved.push({
        masterServiceId: mapRows[0].master_service_id,
        versionNo: view.versionNo,
        name: view.name,
        standardPrice: view.standardPrice,
        commissionRule: view.commissionRule,
        requiresStrategyPlan: view.requiresStrategyPlan,
        planTier: view.planTier,
      });
    }

    // Attach to an existing client, or mint a new one (sumber='meago').
    // NEVER auto-merge — existingClientId comes from a human choosing among
    // `candidates()`, this function does not search on its own.
    let clientId: string;
    if (input.existingClientId !== null && input.existingClientId !== '') {
      const existing = await tx<{ id: string }[]>`
        select id from clients where id = ${input.existingClientId} for update`;
      if (existing.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
      clientId = existing[0].id;
    } else {
      clientId = await ident.nextId(ex.ident, 'CLI', now);
      await tx`
        insert into clients
          (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
           sales_pic_id, commission_payment_pic_id, sumber, created_by)
        values
          (${clientId}, ${payload.merchant.picNama}, ${payload.merchant.nama}, ${payload.merchant.kota},
           ${linkToko}, ${kategori}, ${gmvBaseline}, ${targetGmv},
           ${bridgeEmployeeId}, ${bridgeEmployeeId}, ${SUMBER_MEAGO}, ${actor.employeeId})`;
      await ex.audit.insertAudit({
        entityType: ENTITY_CLIENT, entityId: clientId, actorEmployeeId: actor.employeeId,
        action: 'create',
        beforeJson: null,
        afterJson: { sumber: SUMBER_MEAGO, external_deal_code: payload.dealCode, order_id: order.id },
        createdBy: actor.employeeId,
      });
    }

    // client_external_ref — UNIQUE (sumber, external_id) catches a double-
    // accept race properly. Insert directly, never check-then-insert.
    await tx`
      insert into client_external_ref (client_id, sumber, external_id, created_by)
      values (${clientId}, ${SUMBER_MEAGO}, ${payload.merchant.externalId}, ${actor.employeeId})`;

    // client_external_billing — the attestation, verbatim from the stored
    // (immutable) payload.
    await tx`
      insert into client_external_billing
        (client_id, sumber, external_deal_code, external_trx_ref, bentuk_kerjasama, nilai,
         nilai_cross_charge, diverifikasi_pada, diverifikasi_oleh_external, dilaporkan_oleh)
      values
        (${clientId}, ${SUMBER_MEAGO}, ${payload.dealCode}, ${payload.attestation.externalTrxRef},
         'Berbayar', ${payload.attestation.nilai}, ${sumCrossCharge(payload.lines)},
         ${payload.attestation.diverifikasiPada}::timestamptz, ${payload.attestation.diverifikasiOlehExternal},
         ${actor.employeeId})`;

    // One CTR- carrying the merchant's own contract window (payload), one
    // SVC- per bridged line hanging off it — both branches (new/attach)
    // symmetric. Judgment call logged docs/DECISIONS.md 2026-09-10: the
    // rencana only spells out CTR- creation for the attach-existing-client
    // branch; extending it to the new-client branch keeps every
    // sumber='meago' client groupable under O57 the same way a sales-closed
    // one is, instead of leaving new clients contract-less by omission.
    //
    // `contract.createContract` is NOT called here: it opens its OWN
    // transaction (`withTransaction` → `sql.begin`), and postgres.js's
    // `TransactionSql` has no nested `.begin()` — calling it from inside
    // `bridge.accept`'s own transaction throws `sql.begin is not a
    // function`. The insert below is the same shape `createContract` writes,
    // run directly against `tx` so it shares this function's one atomic
    // transaction instead of opening a second one.
    const ctrId = await ident.nextId(ex.ident, 'CTR', now);
    await tx`
      insert into contracts
        (id, client_id, durasi_bulan, tanggal_mulai, tanggal_akhir, catatan, created_by)
      values
        (${ctrId}, ${clientId},
         ${monthsBetween(payload.merchant.tanggalMulaiKontrak, payload.merchant.tanggalAkhirKontrak)},
         ${payload.merchant.tanggalMulaiKontrak}, ${payload.merchant.tanggalAkhirKontrak},
         ${`Bridge MSDPS — ${payload.dealCode}`}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'contract', entityId: ctrId, actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { client_id: clientId, external_deal_code: payload.dealCode, trigger: 'bridge_accept' },
      createdBy: actor.employeeId,
    });

    for (let i = 0; i < payload.lines.length; i += 1) {
      const line = payload.lines[i];
      const r = resolved[i];
      const svcId = await ident.nextId(ex.ident, 'SVC', now);
      await tx`
        insert into services
          (id, client_id, contract_id, master_service_id, master_version_no, name,
           standard_price, commission_rule, status, requires_strategy_plan, plan_tier, sumber, created_by)
        values
          (${svcId}, ${clientId}, ${ctrId}, ${r.masterServiceId}, ${r.versionNo}, ${r.name},
           ${r.standardPrice}, ${r.commissionRule}, '[Awaiting Onboarding]',
           ${r.requiresStrategyPlan}, ${r.planTier}, ${SUMBER_MEAGO}, ${actor.employeeId})`;
    }

    // Account intake gate (M5 §5, account.ts:189 reads exactly this column).
    // This is the ONLY thing that opens the normal CDPS flow — bridge does
    // NOT assign an AM; the client enters the Unassigned Intake Queue like
    // any other released client (M6 §3).
    await tx`
      update clients set released_to_account_at = ${now}
       where id = ${clientId} and released_to_account_at is null`;
    await ex.audit.insertAudit({
      entityType: ENTITY_CLIENT, entityId: clientId, actorEmployeeId: actor.employeeId,
      action: 'released_to_account',
      beforeJson: null,
      afterJson: { external_deal_code: payload.dealCode, trigger: 'bridge_accept' },
      createdBy: actor.employeeId,
    });

    // `client_id` is written BEFORE the transition, not after: `sm_transition`
    // is the ONLY writer of the status column, and `ck_extorders_diterima`
    // (status='[Diterima]' ⇒ client_id NOT NULL) is checked immediately after
    // EVERY statement, not deferred. Flipping status first would violate it
    // the instant `sm_transition`'s own UPDATE runs, before this function
    // ever gets to set client_id.
    await tx`update external_orders set client_id = ${clientId}, diputus_oleh = ${actor.employeeId}, diputus_pada = ${now} where id = ${order.id}`;

    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE,
      entityType: ENTITY_ORDER,
      table: 'external_orders',
      entityId: order.id,
      to: '[Diterima]',
      actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
    }

    return rowToSummary(await loadOrder(tx, order.id));
  });
}

function sumCrossCharge(lines: BridgePayloadLine[]): string | null {
  let total: bigint | null = null;
  for (const l of lines) {
    if (l.nilaiCrossCharge === null) continue;
    const v = money.parse(l.nilaiCrossCharge);
    total = (total ?? 0n) + v;
  }
  return total === null ? null : money.decimal(total);
}

/** reject — same gate as accept, reason mandatory. */
export async function reject(
  sql: Sql,
  actor: Actor,
  orderId: string,
  alasan: string,
): Promise<BridgeOrderSummary> {
  if (!canDecideOrder(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
  const reason = (alasan ?? '').trim();
  if (reason === '') throw new ValidationError(MSG_INCOMPLETE);

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const order = await loadOrder(tx, orderId, true);
    if (order.status !== '[Masuk]') throw new ConflictError(MSG_ALREADY_DECIDED);

    // `ditolak_alasan` written BEFORE the transition — same reasoning as
    // `accept`: `ck_extorders_ditolak` is checked immediately after
    // `sm_transition`'s own UPDATE, which only ever touches `status`.
    const now = new Date();
    await tx`
      update external_orders
         set ditolak_alasan = ${reason}, diputus_oleh = ${actor.employeeId}, diputus_pada = ${now}
       where id = ${order.id}`;

    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE,
      entityType: ENTITY_ORDER,
      table: 'external_orders',
      entityId: order.id,
      to: '[Ditolak]',
      actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
    }

    return rowToSummary(await loadOrder(tx, order.id));
  });
}

// ---------------------------------------------------------------------------
// Admin — external_service_map CRUD (`role_mappings` pattern). Write =
// Director only (`permission.canManageAdmin`), mirroring the neighbour
// `admin.upsertRoleMapping`. Read is `USING (true)` at the RLS layer
// (pure catalog) — no TS gate needed for listing.
// ---------------------------------------------------------------------------

export interface ExternalServiceMap {
  id: number;
  sumber: string;
  externalServiceType: string;
  masterServiceId: string;
  aktif: boolean;
}

interface ServiceMapRow {
  id: number;
  sumber: string;
  external_service_type: string;
  master_service_id: string;
  aktif: boolean;
}

function rowToServiceMap(r: ServiceMapRow): ExternalServiceMap {
  return {
    id: r.id,
    sumber: r.sumber,
    externalServiceType: r.external_service_type,
    masterServiceId: r.master_service_id,
    aktif: r.aktif,
  };
}

/** listServiceMap returns every mapping row, newest first. */
export async function listServiceMap(sql: Queryable): Promise<ExternalServiceMap[]> {
  const rows = await sql<ServiceMapRow[]>`select * from external_service_map order by id desc`;
  return rows.map(rowToServiceMap);
}

export interface ExternalServiceMapInput {
  externalServiceType: string;
  masterServiceId: string;
  aktif: boolean;
}

/**
 * upsertServiceMap creates a mapping row (or reactivates one) — Director
 * only. Never overwrites an existing active row for the same
 * `external_service_type`: the partial unique index enforces at most one
 * active row, so a new mapping must first deactivate the old one (two calls,
 * both audited), mirroring `role_mappings`' own edit-by-resubmit shape but
 * without silently discarding the row being replaced (aturan rumah #3).
 */
export async function upsertServiceMap(
  sql: Sql,
  actor: Actor,
  input: ExternalServiceMapInput,
): Promise<ExternalServiceMap> {
  if (!permission.canManageAdmin(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
  const externalServiceType = (input.externalServiceType ?? '').trim();
  const masterServiceId = (input.masterServiceId ?? '').trim();
  if (externalServiceType === '' || masterServiceId === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await tx<{ id: string }[]>`select id from master_services where id = ${masterServiceId}`;
    if (svc.length === 0) throw new ValidationError(MSG_INCOMPLETE);
    const rows = await tx<ServiceMapRow[]>`
      insert into external_service_map (sumber, external_service_type, master_service_id, aktif, created_by)
      values (${SUMBER_MEAGO}, ${externalServiceType}, ${masterServiceId}, ${input.aktif}, ${actor.employeeId})
      returning *`;
    await ex.audit.insertAudit({
      entityType: 'external_service_map', entityId: String(rows[0].id), actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { external_service_type: externalServiceType, master_service_id: masterServiceId, aktif: input.aktif },
      createdBy: actor.employeeId,
    });
    return rowToServiceMap(rows[0]);
  });
}

/** deactivate flips one mapping row `aktif=false` (never DELETE — history stays readable). */
export async function deactivateServiceMap(sql: Sql, actor: Actor, id: number): Promise<void> {
  if (!permission.canManageAdmin(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<ServiceMapRow[]>`
      update external_service_map set aktif = false where id = ${id} and aktif returning *`;
    if (rows.length === 0) return;
    await ex.audit.insertAudit({
      entityType: 'external_service_map', entityId: String(id), actorEmployeeId: actor.employeeId,
      action: 'deactivate', beforeJson: { aktif: true }, afterJson: { aktif: false },
      createdBy: actor.employeeId,
    });
  });
}
