/**
 * Product Exchange M3-B — volume per produk (`px_sku_volume`), verdict
 * kelayakan empat lapis (`px_sku_eligibility`), penerima push coverage MCN
 * (`px_coverage_snapshot`/`px_coverage_push`), konfirmasi kategori manusia
 * (`px_sku_kategori`), dan katalog. Sumber: `docs/prd/CDPS_ProductExchange_M3.md`
 * (lihat blok "Catatan penerapan di CDPS" di puncak berkas itu untuk daftar
 * deviasi PX-M3-01..08) + `docs/DECISIONS.md` 2026-09-15.
 *
 * Berkas TERPISAH dari `productexchange.ts` (M2a) sengaja — modul itu tetap
 * kecil, dan `packages/domain/src/index.ts` tetap satu namespace lewat
 * `productexchange.ts` menambahkan `export * from './productexchange-m3'`.
 *
 * KUNCI PER PRODUK (`platform_product_id`), BUKAN varian — PX-M3-07. Mesin
 * murni gerbang empat lapis ada di `@cdps/core` `px.evaluasiLapis`; berkas
 * ini HANYA membaca DB dan menyerahkan input sudah-jadi ke mesin itu.
 *
 * AKTIVASI DITUNDA (ketokan pemilik 2026-09-15): `recomputeDanEvaluasi`/
 * `evaluateTick` di sini adalah mesinnya, tapi TIDAK ada cron/hook otomatis
 * yang memanggilnya — hanya tick route manual sampai PDT G1 `verified` di
 * ≥10 klien. Titik aktivasi (cron `vercel.json` + hook commit PDT) dicatat
 * `docs/backlog/PX_M3_BACKLOG.md`, TIDAK dikerjakan di PR ini.
 */

import { permission, px } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { ACCOUNT_DIVISION, type Actor } from './account';
import {
  ContractError,
  ForbiddenError,
  MSG_POLICY_NOT_FOUND,
  NotFoundError,
  ValidationError,
  activeEligibilityPolicy,
  canKonfirmasiKategoriSku,
  canLihatKatalogPx,
  type EligibilityPolicy,
} from './productexchange';

export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_FORBIDDEN = '[anda tidak memiliki akses untuk melakukan aksi ini]';
export const MSG_KATEGORI_TIDAK_VALID =
  '[kategori tidak tersedia untuk platform ini, hubungi Hans untuk master kategori]';
export const MSG_STATUS_INVALID = "[status baris coverage harus 'covered' atau 'kosong']";
export const MSG_PAYLOAD_KOSONG = '[payload coverage tidak boleh kosong]';
export const MSG_TERLALU_BANYAK_BARIS = '[payload coverage melebihi 5.000 baris]';
export const MSG_BARIS_BERULANG = '[payload coverage berisi baris (level2_category, price_segment) berulang]';

const AUDIT_ENTITY_KATEGORI = 'px_sku_kategori';
const AUDIT_ENTITY_COVERAGE = 'px_coverage';
const AUDIT_ENTITY_TICK = 'px_evaluate_tick';
const AUDIT_ENTITY_VOLUME = 'px_sku_volume';

function toUtcDate(ymd: readonly number[]): number {
  return Date.UTC(ymd[0], ymd[1] - 1, ymd[2]);
}

function daysBetweenInclusive(mulai: string, selesai: string): number {
  const a = toUtcDate(mulai.split('-').map(Number));
  const b = toUtcDate(selesai.split('-').map(Number));
  return Math.round((b - a) / 86_400_000) + 1;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// ---------------------------------------------------------------------------
// Flow A — recompute px_sku_volume (Rule 4-8 PRD §3.2).
// ---------------------------------------------------------------------------

interface VolumeRow {
  platformProductId: string;
  gmv30d: number;
  pesanan30d: number;
  jendelaMulai: string;
  jendelaSelesai: string;
  cakupanHari: number;
  batchIds: number[];
}

async function recomputeVolume(tx: Queryable, clientPlatformId: number): Promise<VolumeRow[]> {
  const latest = await tx<{ periode_mulai: string; periode_selesai: string }[]>`
    select periode_mulai::text, periode_selesai::text
      from pdt_upload_batch
     where client_platform_id = ${clientPlatformId} and status = 'verified'
     order by periode_selesai desc
     limit 1`;
  if (latest.length === 0) return [];
  const jendelaMulai = latest[0].periode_mulai;
  const jendelaSelesai = latest[0].periode_selesai;
  const cakupanHari = daysBetweenInclusive(jendelaMulai, jendelaSelesai);

  const rows = await tx<
    { platform_product_id: string | null; gmv_30d: string; pesanan_30d: string; batch_ids: number[] }[]
  >`
    select
      coalesce(f.platform_product_id, s.platform_product_id) as platform_product_id,
      coalesce(sum(f.gmv), 0)::text as gmv_30d,
      coalesce(sum(f.pesanan), 0)::text as pesanan_30d,
      array_agg(distinct f.batch_id) as batch_ids
    from pdt_fact_sku_period f
    join pdt_upload_batch b on b.id = f.batch_id and b.status = 'verified'
    left join pdt_sku_master s on s.id = f.sku_id
    where f.client_platform_id = ${clientPlatformId}
      and f.basis = 'dibayar'
      and f.periode = ${jendelaMulai}::date
    group by coalesce(f.platform_product_id, s.platform_product_id)`;

  const out: VolumeRow[] = [];
  for (const r of rows) {
    if (r.platform_product_id === null) continue; // struktural — baris tanpa identitas produk (tak seharusnya)
    const row: VolumeRow = {
      platformProductId: r.platform_product_id,
      gmv30d: Number(r.gmv_30d),
      pesanan30d: Number(r.pesanan_30d),
      jendelaMulai,
      jendelaSelesai,
      cakupanHari,
      batchIds: r.batch_ids,
    };
    out.push(row);
    await tx`
      insert into px_sku_volume
        (client_platform_id, platform_product_id, jendela_mulai, jendela_selesai, basis,
         gmv_30d, pesanan_30d, cakupan_hari, batch_ids)
      values
        (${clientPlatformId}, ${row.platformProductId}, ${jendelaMulai}::date, ${jendelaSelesai}::date, 'dibayar',
         ${row.gmv30d}, ${row.pesanan30d}, ${cakupanHari}, ${row.batchIds})
      on conflict (client_platform_id, platform_product_id, jendela_selesai) do update set
        jendela_mulai = excluded.jendela_mulai, gmv_30d = excluded.gmv_30d,
        pesanan_30d = excluded.pesanan_30d, cakupan_hari = excluded.cakupan_hari,
        batch_ids = excluded.batch_ids, dihitung_pada = now()`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coverage lookup — dipakai L4, dibaca sekali per sweep (Flow B langkah 6/7).
// ---------------------------------------------------------------------------

interface CoverageLookup {
  batchKey: string | null;
  statusOf(level2Category: string, priceSegment: string): 'covered' | 'kosong' | null;
}

async function readLatestCoverage(sql: Queryable): Promise<CoverageLookup> {
  const latest = await sql<{ batch_key: string }[]>`
    select batch_key from px_coverage_snapshot order by snapshot_at desc, diterima_pada desc limit 1`;
  if (latest.length === 0) return { batchKey: null, statusOf: () => null };
  const batchKey = latest[0].batch_key;
  const rows = await sql<{ level2_category: string; price_segment: string; status: string }[]>`
    select level2_category, price_segment, status from px_coverage_snapshot where batch_key = ${batchKey}`;
  const map = new Map<string, 'covered' | 'kosong'>();
  for (const r of rows) map.set(`${r.level2_category}::${r.price_segment}`, r.status as 'covered' | 'kosong');
  return { batchKey, statusOf: (cat, seg) => map.get(`${cat}::${seg}`) ?? null };
}

// ---------------------------------------------------------------------------
// Flow B — evaluasi kelayakan (Rule 1-3, 9-18 PRD §3.1/§3.3/§3.4) + retensi
// (PX-M3-08).
// ---------------------------------------------------------------------------

export interface PxRecomputeSummary {
  clientPlatformId: number;
  produkDievaluasi: number;
  lolos: number;
  perVerdict: Record<string, number>;
}

async function evaluateStoreProducts(
  tx: Queryable,
  clientPlatformId: number,
  policy: EligibilityPolicy,
  coverage: CoverageLookup,
  onlyProductIds?: readonly string[],
): Promise<PxRecomputeSummary> {
  const cpRows = await tx<{ shop_id: string | null; platform: string }[]>`
    select shop_id, platform from client_platforms where id = ${clientPlatformId}`;
  if (cpRows.length === 0) return { clientPlatformId, produkDievaluasi: 0, lolos: 0, perVerdict: {} };
  const { shop_id: shopId, platform } = cpRows[0];

  const volumeRows = await tx<
    { platform_product_id: string; gmv_30d: string; jendela_mulai: string; jendela_selesai: string; batch_ids: number[] }[]
  >`
    select platform_product_id, gmv_30d::text, jendela_mulai::text, jendela_selesai::text, batch_ids
      from px_sku_volume
     where client_platform_id = ${clientPlatformId}
       and jendela_selesai = (select max(jendela_selesai) from px_sku_volume where client_platform_id = ${clientPlatformId})
       ${onlyProductIds && onlyProductIds.length > 0 ? tx`and platform_product_id = any(${onlyProductIds})` : tx``}`;
  if (volumeRows.length === 0) return { clientPlatformId, produkDievaluasi: 0, lolos: 0, perVerdict: {} };

  const produkIds = volumeRows.map((v) => v.platform_product_id);
  const hargaKategoriRows = await tx<
    { platform_product_id: string; harga_satuan_terakhir: string | null }[]
  >`
    select platform_product_id, max(harga_satuan_terakhir)::text as harga_satuan_terakhir
      from pdt_sku_master
     where client_platform_id = ${clientPlatformId} and platform_product_id = any(${produkIds})
     group by platform_product_id`;
  const hargaMap = new Map(hargaKategoriRows.map((r) => [r.platform_product_id, r.harga_satuan_terakhir]));

  const kategoriRows = await tx<{ platform_product_id: string; level2_category: string }[]>`
    select platform_product_id, level2_category from px_sku_kategori
     where client_platform_id = ${clientPlatformId} and platform_product_id = any(${produkIds})`;
  const kategoriMap = new Map(kategoriRows.map((r) => [r.platform_product_id, r.level2_category]));

  const existingRows = await tx<
    {
      platform_product_id: string;
      verdict: string;
      lapis_gagal: number | null;
      level2_category: string | null;
      price_segment: string | null;
      coverage_snapshot_batch_key: string | null;
    }[]
  >`
    with terbaru as (
      select *, row_number() over (partition by platform_product_id order by dihitung_pada desc) as rn
        from px_sku_eligibility
       where client_platform_id = ${clientPlatformId} and versi_policy = ${policy.versi}
    )
    select platform_product_id, verdict, lapis_gagal, level2_category, price_segment, coverage_snapshot_batch_key
      from terbaru where rn = 1`;
  const existingMap = new Map(existingRows.map((r) => [r.platform_product_id, r]));

  const bands = (policy.nilai.priceSegmentBands ?? []).map((b) => ({ segment: b.segment, maxIdr: b.maxIdr }));
  const perVerdict: Record<string, number> = {};
  let lolos = 0;

  for (const v of volumeRows) {
    const input: px.PxEvaluasiInput = {
      shopId,
      platform,
      policyPlatforms: policy.nilai.platforms,
      salesThresholdIdr: policy.nilai.salesThresholdIdr,
      volume: { gmv30d: Number(v.gmv_30d), jendelaMulai: v.jendela_mulai, jendelaSelesai: v.jendela_selesai },
      level2Category: kategoriMap.get(v.platform_product_id) ?? null,
      hargaSatuanTerakhir: hargaMap.get(v.platform_product_id) != null ? Number(hargaMap.get(v.platform_product_id)) : null,
      priceSegmentBands: bands,
      coverageStatus: null,
    };
    // L4 hanya perlu dievaluasi bila L3 (kategori+harga) sudah lolos.
    if (input.level2Category !== null && input.hargaSatuanTerakhir !== null) {
      const seg = px.hitungPriceSegment(input.hargaSatuanTerakhir, bands);
      if (seg !== null) input.coverageStatus = coverage.statusOf(input.level2Category, seg);
    }

    const hasil = px.evaluasiLapis(input);
    perVerdict[hasil.verdict] = (perVerdict[hasil.verdict] ?? 0) + 1;
    if (hasil.verdict === 'lolos') lolos += 1;

    const existing = existingMap.get(v.platform_product_id);
    const berubah =
      !existing ||
      existing.verdict !== hasil.verdict ||
      existing.lapis_gagal !== hasil.lapisGagal ||
      existing.level2_category !== hasil.levelCategory ||
      existing.price_segment !== hasil.priceSegment ||
      existing.coverage_snapshot_batch_key !== (hasil.verdict === 'lolos' || hasil.lapisGagal === 4 ? coverage.batchKey : null);

    if (berubah) {
      const batchKeyDicatat = hasil.lapisGagal === 4 || hasil.verdict === 'lolos' ? coverage.batchKey : null;
      // PX-M3-08 opsi B: snapshot volume yang MENDASARI baris verdict ini,
      // disalin dari px_sku_volume saat ditulis — permanen (kolom nullable
      // di tabel append-only), terpisah dari retensi 90-hari file ZIP
      // mentah di bawah. Menutup gap "klaim kelayakan tanpa riwayat" untuk
      // sengketa yang muncul setelah file mentahnya sendiri sudah dipurge.
      await tx`
        insert into px_sku_eligibility
          (client_platform_id, platform_product_id, versi_policy, verdict, lapis_gagal,
           level2_category, price_segment, coverage_snapshot_batch_key,
           gmv_30d, jendela_mulai, jendela_selesai, batch_ids)
        values
          (${clientPlatformId}, ${v.platform_product_id}, ${policy.versi}, ${hasil.verdict}, ${hasil.lapisGagal},
           ${hasil.levelCategory}, ${hasil.priceSegment}, ${batchKeyDicatat},
           ${v.gmv_30d}, ${v.jendela_mulai}::date, ${v.jendela_selesai}::date, ${v.batch_ids})`;
    }

    if (hasil.verdict === 'lolos') {
      // PX-M3-08: perpanjang retensi paket ZIP milik batch yang membentuk
      // volume ini, TIDAK PERNAH memperpendek (Rule 45 PDT). Ditulis oleh
      // domain PX sendiri (bukan planPdtPurgeTick) — menutup setengah dari
      // G1-10-RETENSI-RECOMPUTE tanpa menyentuh pdt.ts.
      await tx`
        update pdt_upload_batch
           set retensi_sampai = greatest(retensi_sampai, current_date + 90),
               retensi_alasan = 'katalog_px'
         where id = any(${v.batch_ids}) and legal_hold = false`;
    }
  }

  return { clientPlatformId, produkDievaluasi: volumeRows.length, lolos, perVerdict };
}

// ---------------------------------------------------------------------------
// Titik masuk Flow A+B satu toko — nama INI dikunci oleh rencana aktivasi
// (lihat header berkas): dipanggil manual sekarang (tick route), dan kelak
// dari route commit PDT setelah batch berstatus verified, TANPA perubahan
// tanda tangan.
// ---------------------------------------------------------------------------
export async function recomputeDanEvaluasi(sql: Sql, clientPlatformId: number): Promise<PxRecomputeSummary> {
  const policy = await activeEligibilityPolicy(sql);
  if (!policy) throw new NotFoundError(MSG_POLICY_NOT_FOUND);
  const coverage = await readLatestCoverage(sql);

  try {
    return await withTransaction(sql, async (tx) => {
      await recomputeVolume(tx, clientPlatformId);
      return evaluateStoreProducts(tx, clientPlatformId, policy, coverage);
    });
  } catch (err) {
    const ex = executors(sql);
    await ex.audit.insertAudit({
      entityType: AUDIT_ENTITY_VOLUME, entityId: String(clientPlatformId), actorEmployeeId: 'SYSTEM',
      action: 'px_volume_recompute_failed',
      beforeJson: null,
      afterJson: { client_platform_id: clientPlatformId, error: err instanceof Error ? err.message : String(err) },
      createdBy: 'SYSTEM',
    });
    throw err;
  }
}

export interface PxTickSummary {
  tokoDievaluasi: number;
  produkDievaluasi: number;
  lolos: number;
  perVerdict: Record<string, number>;
  gagal: { clientPlatformId: number; error: string }[];
}

/** evaluateTick — Flow A+B untuk satu toko (bila `clientPlatformId` diberi) atau seluruh toko ber-`shop_id`. Satu `audit_log` per tick. */
export async function evaluateTick(sql: Sql, clientPlatformId?: number): Promise<PxTickSummary> {
  const targets =
    clientPlatformId !== undefined
      ? [clientPlatformId]
      : (
          await sql<{ id: number }[]>`select id from client_platforms where shop_id is not null`
        ).map((r) => r.id);

  const summary: PxTickSummary = { tokoDievaluasi: 0, produkDievaluasi: 0, lolos: 0, perVerdict: {}, gagal: [] };
  for (const id of targets) {
    try {
      const hasil = await recomputeDanEvaluasi(sql, id);
      summary.tokoDievaluasi += 1;
      summary.produkDievaluasi += hasil.produkDievaluasi;
      summary.lolos += hasil.lolos;
      for (const [k, n] of Object.entries(hasil.perVerdict)) summary.perVerdict[k] = (summary.perVerdict[k] ?? 0) + n;
    } catch (err) {
      summary.gagal.push({ clientPlatformId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const ex = executors(sql);
  await ex.audit.insertAudit({
    entityType: AUDIT_ENTITY_TICK, entityId: 'TICK', actorEmployeeId: 'SYSTEM',
    action: 'px_evaluate_tick',
    beforeJson: null,
    afterJson: summary,
    createdBy: 'SYSTEM',
  });
  return summary;
}

/** Dipanggil setelah `intakeCoverage` menyimpan snapshot baru — L3/L4 ULANG untuk kandidat, TANPA recompute volume (Flow C langkah 7). */
async function reevaluateAfterCoverage(sql: Sql): Promise<void> {
  const policy = await activeEligibilityPolicy(sql);
  if (!policy) return;
  const coverage = await readLatestCoverage(sql);
  const stores = await sql<{ client_platform_id: number }[]>`select distinct client_platform_id from px_sku_volume`;
  for (const { client_platform_id: id } of stores) {
    await withTransaction(sql, (tx) => evaluateStoreProducts(tx, id, policy, coverage)).catch(() => {
      // Satu toko gagal tidak menghentikan sisanya (pola Rule 46 PDT error path);
      // sweep berikutnya (tick manual atau push berikutnya) akan mencoba lagi.
    });
  }
}

// ---------------------------------------------------------------------------
// Bridge intake — Flow C (PRD §4/§7). PX-M3-03/04: path final
// `/api/v1/internal/bridge/px-coverage`, 422 untuk kolom asing.
// ---------------------------------------------------------------------------

const ALLOWED_TOP_KEYS = new Set(['snapshot_at', 'source', 'policy_note', 'rows']);
const ALLOWED_ROW_KEYS = new Set([
  'level2_category',
  'price_segment',
  'creator_count',
  'total_slots_available',
  'total_proven_gmv',
  'status',
]);

export interface IntakeCoverageResult {
  batchKey: string;
  rowsReceived: number;
  duplicate: boolean;
}

function assertKeysAllowed(obj: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) throw new ContractError(`[payload coverage tidak sesuai kontrak: kolom '${k}' tidak dikenal]`);
  }
}

interface ParsedCoverageRow {
  level2Category: string;
  priceSegment: string;
  creatorCount: number;
  totalSlots: number;
  totalGmv: number;
  status: 'covered' | 'kosong';
}

function parseCoverageRow(raw: unknown): ParsedCoverageRow {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ContractError(MSG_INCOMPLETE);
  const r = raw as Record<string, unknown>;
  assertKeysAllowed(r, ALLOWED_ROW_KEYS);
  const level2Category = typeof r.level2_category === 'string' ? r.level2_category.trim() : '';
  const priceSegment = typeof r.price_segment === 'string' ? r.price_segment.trim() : '';
  if (level2Category === '' || priceSegment === '') throw new ContractError(MSG_INCOMPLETE);
  const creatorCount = r.creator_count;
  const totalSlots = r.total_slots_available;
  const totalGmv = r.total_proven_gmv;
  if (typeof creatorCount !== 'number' || !Number.isInteger(creatorCount) || creatorCount < 0) {
    throw new ContractError(MSG_INCOMPLETE);
  }
  if (typeof totalSlots !== 'number' || !Number.isInteger(totalSlots) || totalSlots < 0) {
    throw new ContractError(MSG_INCOMPLETE);
  }
  if (typeof totalGmv !== 'number' || !Number.isFinite(totalGmv) || totalGmv < 0) {
    throw new ContractError(MSG_INCOMPLETE);
  }
  const status = r.status;
  if (status !== 'covered' && status !== 'kosong') throw new ContractError(MSG_STATUS_INVALID);
  return { level2Category, priceSegment, creatorCount, totalSlots, totalGmv, status };
}

/**
 * intakeCoverage — Flow C langkah 4-7. Idempoten: `idempotencyKey` berulang
 * mengembalikan hasil ASLI dari `px_coverage_push`, 200, nol baris baru
 * (preseden `bridge.intake`). Setelah insert baru, memicu `reevaluateAfterCoverage`
 * (L3/L4 ulang untuk kandidat) DI LUAR transaksi insert.
 */
export async function intakeCoverage(sql: Sql, rawBody: unknown, idempotencyKey: string): Promise<IntakeCoverageResult> {
  const batchKey = (idempotencyKey ?? '').trim();
  if (batchKey === '') throw new ValidationError(MSG_INCOMPLETE);

  const result = await withTransaction(sql, async (tx) => {
    const existing = await tx<{ batch_key: string; rows_received: number }[]>`
      select batch_key, rows_received from px_coverage_push where batch_key = ${batchKey}`;
    if (existing.length > 0) {
      return { batchKey: existing[0].batch_key, rowsReceived: existing[0].rows_received, duplicate: true };
    }

    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) throw new ContractError(MSG_INCOMPLETE);
    const body = rawBody as Record<string, unknown>;
    assertKeysAllowed(body, ALLOWED_TOP_KEYS);

    const snapshotAtRaw = body.snapshot_at;
    if (typeof snapshotAtRaw !== 'string' || Number.isNaN(Date.parse(snapshotAtRaw))) throw new ContractError(MSG_INCOMPLETE);
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    if (source === '') throw new ContractError(MSG_INCOMPLETE);

    const rowsRaw = body.rows;
    if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) throw new ContractError(MSG_PAYLOAD_KOSONG);
    if (rowsRaw.length > 5000) throw new ContractError(MSG_TERLALU_BANYAK_BARIS);
    const rows = rowsRaw.map(parseCoverageRow);

    const snapshotAt = new Date(snapshotAtRaw);
    await tx`
      insert into px_coverage_push (batch_key, snapshot_at, source, rows_received, payload)
      values (${batchKey}, ${snapshotAt}, ${source}, ${rows.length}, ${tx.json(rawBody as never)})`;

    try {
      for (const r of rows) {
        await tx`
          insert into px_coverage_snapshot
            (batch_key, snapshot_at, level2_category, price_segment, creator_count, total_slots_available, total_proven_gmv, status)
          values
            (${batchKey}, ${snapshotAt}, ${r.level2Category}, ${r.priceSegment}, ${r.creatorCount}, ${r.totalSlots}, ${r.totalGmv}, ${r.status})`;
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw new ContractError(MSG_BARIS_BERULANG);
      throw err;
    }

    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: AUDIT_ENTITY_COVERAGE, entityId: batchKey, actorEmployeeId: 'SYSTEM',
      action: 'px_coverage_diterima',
      beforeJson: null,
      afterJson: { batch_key: batchKey, rows_received: rows.length, source },
      createdBy: 'SYSTEM',
    });

    return { batchKey, rowsReceived: rows.length, duplicate: false };
  });

  if (!result.duplicate) await reevaluateAfterCoverage(sql);
  return result;
}

// ---------------------------------------------------------------------------
// Konfirmasi kategori (Rule 9-11 PRD §3.3, D-24) — halaman Kandidat PX.
// ---------------------------------------------------------------------------

async function ownerAmOfClientPlatform(sql: Queryable, clientPlatformId: number): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select cl.assigned_am_id from client_platforms cp
      join clients cl on cl.id = cp.client_id
     where cp.id = ${clientPlatformId}`;
  if (rows.length === 0) return null;
  return rows[0].assigned_am_id;
}

export interface PxKandidatVerdict {
  clientPlatformId: number;
  platformProductId: string;
  verdict: string;
  lapisGagal: number | null;
  level2Category: string | null;
  priceSegment: string | null;
}

/**
 * konfirmasiKategori — AM memilih `level2_category` dari opsi yang MEA punya
 * kreatornya (Rule 10: dropdown = distinct `level2_category` snapshot
 * terbaru). Menulis `px_sku_kategori` (UPSERT — boleh koreksi, D-24), audit,
 * lalu langsung evaluasi ulang L3/L4 produk ini saja.
 */
export async function konfirmasiKategori(
  sql: Sql,
  actor: Actor,
  clientPlatformId: number,
  platformProductId: string,
  level2Category: string,
): Promise<PxKandidatVerdict> {
  const kategori = (level2Category ?? '').trim();
  if (kategori === '') throw new ValidationError(MSG_INCOMPLETE);

  const ownerAm = await ownerAmOfClientPlatform(sql, clientPlatformId);
  if (ownerAm === null) throw new NotFoundError('[toko tidak ditemukan]');
  if (!canKonfirmasiKategoriSku(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

  const opsi = await listKategoriOptions(sql);
  if (!opsi.includes(kategori)) throw new ValidationError(MSG_KATEGORI_TIDAK_VALID);

  await withTransaction(sql, async (tx) => {
    const before = await tx<{ level2_category: string }[]>`
      select level2_category from px_sku_kategori
       where client_platform_id = ${clientPlatformId} and platform_product_id = ${platformProductId}`;
    await tx`
      insert into px_sku_kategori (client_platform_id, platform_product_id, level2_category, dikonfirmasi_oleh)
      values (${clientPlatformId}, ${platformProductId}, ${kategori}, ${actor.employeeId})
      on conflict (client_platform_id, platform_product_id) do update set
        level2_category = excluded.level2_category, dikonfirmasi_oleh = excluded.dikonfirmasi_oleh,
        dikonfirmasi_pada = now()`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: AUDIT_ENTITY_KATEGORI, entityId: `${clientPlatformId}:${platformProductId}`, actorEmployeeId: actor.employeeId,
      action: 'px_kategori_dikonfirmasi',
      beforeJson: before.length > 0 ? { level2_category: before[0].level2_category } : null,
      afterJson: { level2_category: kategori },
      createdBy: actor.employeeId,
    });
  });

  const policy = await activeEligibilityPolicy(sql);
  if (!policy) throw new NotFoundError(MSG_POLICY_NOT_FOUND);
  const coverage = await readLatestCoverage(sql);
  await withTransaction(sql, (tx) => evaluateStoreProducts(tx, clientPlatformId, policy, coverage, [platformProductId]));

  const rows = await sql<
    { verdict: string; lapis_gagal: number | null; level2_category: string | null; price_segment: string | null }[]
  >`
    select verdict, lapis_gagal, level2_category, price_segment from px_sku_eligibility
     where client_platform_id = ${clientPlatformId} and platform_product_id = ${platformProductId}
       and versi_policy = ${policy.versi}
     order by dihitung_pada desc limit 1`;
  if (rows.length === 0) throw new NotFoundError('[produk kandidat tidak ditemukan]');
  return {
    clientPlatformId,
    platformProductId,
    verdict: rows[0].verdict,
    lapisGagal: rows[0].lapis_gagal,
    level2Category: rows[0].level2_category,
    priceSegment: rows[0].price_segment,
  };
}

/** listKategoriOptions — Rule 10: distinct `level2_category` dari snapshot TERBARU (dropdown TIDAK tersaring, permanen — M3-03 ditutup 2026-09-16, pemilik pilih opsi ini, bukan menunggu master kategori). */
export async function listKategoriOptions(sql: Queryable): Promise<string[]> {
  const latest = await sql<{ batch_key: string }[]>`
    select batch_key from px_coverage_snapshot order by snapshot_at desc, diterima_pada desc limit 1`;
  if (latest.length === 0) return [];
  const rows = await sql<{ level2_category: string }[]>`
    select distinct level2_category from px_coverage_snapshot
     where batch_key = ${latest[0].batch_key} order by level2_category`;
  return rows.map((r) => r.level2_category);
}

// ---------------------------------------------------------------------------
// Reads — Kandidat PX, Katalog PX, laporan kreator_kosong.
// ---------------------------------------------------------------------------

export interface PxKandidat {
  clientPlatformId: number;
  platformProductId: string;
  namaProduk: string | null;
  clientId: string;
  namaToko: string;
  platform: string;
  kategoriPlatform: string | null;
  hargaSatuan: number | null;
  gmv30d: number | null;
  level2Category: string | null;
  priceSegment: string | null;
  verdict: string;
  lapisGagal: number | null;
  dihitungPada: Date;
}

function actorIsPrivileged(actor: Actor): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION) || permission.canReadAll(actor);
}

type KandidatRow = {
  client_platform_id: number;
  platform_product_id: string;
  verdict: string;
  lapis_gagal: number | null;
  level2_category: string | null;
  price_segment: string | null;
  dihitung_pada: Date;
  client_id: string;
  nama_toko: string;
  platform: string;
  gmv_30d: string | null;
  nama_produk: string | null;
  kategori_platform: string | null;
  harga_satuan_terakhir: string | null;
};

function kandidatRowToDomain(r: KandidatRow): PxKandidat {
  return {
    clientPlatformId: r.client_platform_id,
    platformProductId: r.platform_product_id,
    namaProduk: r.nama_produk,
    clientId: r.client_id,
    namaToko: r.nama_toko,
    platform: r.platform,
    kategoriPlatform: r.kategori_platform,
    hargaSatuan: r.harga_satuan_terakhir === null ? null : Number(r.harga_satuan_terakhir),
    gmv30d: r.gmv_30d === null ? null : Number(r.gmv_30d),
    level2Category: r.level2_category,
    priceSegment: r.price_segment,
    verdict: r.verdict,
    lapisGagal: r.lapis_gagal,
    dihitungPada: r.dihitung_pada,
  };
}

/** listKandidat — AM: klien miliknya. Lead Account/Director/OD: semua (§6.1 PRD). */
export async function listKandidat(sql: Queryable, actor: Actor): Promise<PxKandidat[]> {
  const privileged = actorIsPrivileged(actor);
  const rows = privileged
    ? await sql<KandidatRow[]>`
        with terbaru as (
          select *, row_number() over (partition by client_platform_id, platform_product_id order by dihitung_pada desc) as rn
            from px_sku_eligibility
           where versi_policy = (select max(versi) from px_eligibility_policy where aktif = true)
        )
        select t.client_platform_id, t.platform_product_id, t.verdict, t.lapis_gagal, t.level2_category,
               t.price_segment, t.dihitung_pada, cl.id as client_id, cl.toko as nama_toko, cp.platform,
               v.gmv_30d::text as gmv_30d, m.nama_produk, m.kategori_platform, m.harga_satuan_terakhir::text as harga_satuan_terakhir
          from terbaru t
          join client_platforms cp on cp.id = t.client_platform_id
          join clients cl on cl.id = cp.client_id
          left join px_sku_volume v on v.client_platform_id = t.client_platform_id and v.platform_product_id = t.platform_product_id
            and v.jendela_selesai = (select max(jendela_selesai) from px_sku_volume v2 where v2.client_platform_id = t.client_platform_id)
          left join lateral (
            select max(s.harga_satuan_terakhir) as harga_satuan_terakhir,
                   (array_agg(s.nama_produk order by s.id))[1] as nama_produk,
                   (array_agg(s.kategori_platform order by s.id) filter (where s.kategori_platform is not null))[1] as kategori_platform
              from pdt_sku_master s
             where s.client_platform_id = t.client_platform_id and s.platform_product_id = t.platform_product_id
          ) m on true
         where t.rn = 1 and t.verdict in ('kategori_belum_dikonfirmasi', 'kreator_kosong', 'lolos')
         order by t.dihitung_pada desc`
    : await sql<KandidatRow[]>`
        with terbaru as (
          select *, row_number() over (partition by client_platform_id, platform_product_id order by dihitung_pada desc) as rn
            from px_sku_eligibility
           where versi_policy = (select max(versi) from px_eligibility_policy where aktif = true)
        )
        select t.client_platform_id, t.platform_product_id, t.verdict, t.lapis_gagal, t.level2_category,
               t.price_segment, t.dihitung_pada, cl.id as client_id, cl.toko as nama_toko, cp.platform,
               v.gmv_30d::text as gmv_30d, m.nama_produk, m.kategori_platform, m.harga_satuan_terakhir::text as harga_satuan_terakhir
          from terbaru t
          join client_platforms cp on cp.id = t.client_platform_id
          join clients cl on cl.id = cp.client_id
          left join px_sku_volume v on v.client_platform_id = t.client_platform_id and v.platform_product_id = t.platform_product_id
            and v.jendela_selesai = (select max(jendela_selesai) from px_sku_volume v2 where v2.client_platform_id = t.client_platform_id)
          left join lateral (
            select max(s.harga_satuan_terakhir) as harga_satuan_terakhir,
                   (array_agg(s.nama_produk order by s.id))[1] as nama_produk,
                   (array_agg(s.kategori_platform order by s.id) filter (where s.kategori_platform is not null))[1] as kategori_platform
              from pdt_sku_master s
             where s.client_platform_id = t.client_platform_id and s.platform_product_id = t.platform_product_id
          ) m on true
         where t.rn = 1 and t.verdict in ('kategori_belum_dikonfirmasi', 'kreator_kosong', 'lolos')
           and cl.assigned_am_id = ${actor.employeeId}
         order by t.dihitung_pada desc`;
  return rows.map(kandidatRowToDomain);
}

export interface PxKatalogItem {
  clientPlatformId: number;
  platformProductId: string;
  namaProduk: string | null;
  platform: string;
  clientId: string;
  namaToko: string;
  level2Category: string | null;
  priceSegment: string | null;
  sudahAfiliasi: boolean;
  dihitungPada: Date;
}

export interface PxCoverageMeta {
  batchKey: string | null;
  snapshotAt: Date | null;
  umurHari: number | null;
  basi: boolean;
}

const AMBANG_BASI_HARI = 10;

async function coverageMeta(sql: Queryable): Promise<PxCoverageMeta> {
  const rows = await sql<{ batch_key: string; snapshot_at: Date }[]>`
    select batch_key, snapshot_at from px_coverage_snapshot order by snapshot_at desc, diterima_pada desc limit 1`;
  if (rows.length === 0) return { batchKey: null, snapshotAt: null, umurHari: null, basi: true };
  const umurHari = Math.floor((Date.now() - rows[0].snapshot_at.getTime()) / 86_400_000);
  return { batchKey: rows[0].batch_key, snapshotAt: rows[0].snapshot_at, umurHari, basi: umurHari > AMBANG_BASI_HARI };
}

/** listKatalog — Lead Account/Director/OD (Rule 19-21 PRD §3.5). */
export async function listKatalog(
  sql: Queryable,
  actor: Actor,
): Promise<{ data: PxKatalogItem[]; snapshot: PxCoverageMeta }> {
  if (!canLihatKatalogPx(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
  const rows = await sql<
    {
      client_platform_id: number;
      platform_product_id: string;
      nama_produk: string | null;
      platform: string;
      client_id: string;
      nama_toko: string;
      level2_category: string | null;
      price_segment: string | null;
      sudah_afiliasi: boolean;
      dihitung_pada: Date;
    }[]
  >`select * from px_catalog_item_v order by dihitung_pada desc`;
  const snapshot = await coverageMeta(sql);
  return {
    data: rows.map((r) => ({
      clientPlatformId: r.client_platform_id,
      platformProductId: r.platform_product_id,
      namaProduk: r.nama_produk,
      platform: r.platform,
      clientId: r.client_id,
      namaToko: r.nama_toko,
      level2Category: r.level2_category,
      priceSegment: r.price_segment,
      sudahAfiliasi: r.sudah_afiliasi,
      dihitungPada: r.dihitung_pada,
    })),
    snapshot,
  };
}

export interface PxKreatorKosong {
  level2Category: string;
  priceSegment: string;
  jumlahProduk: number;
  jumlahKlien: number;
}

/** listKreatorKosong — laporan internal untuk MCN (input rekrutmen kreator, PRD §5 skenario `kreator_kosong`). */
export async function listKreatorKosong(sql: Queryable, actor: Actor): Promise<PxKreatorKosong[]> {
  if (!canLihatKatalogPx(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
  const rows = await sql<
    { level2_category: string; price_segment: string; jumlah_produk: number; jumlah_klien: number }[]
  >`
    with terbaru as (
      select *, row_number() over (partition by client_platform_id, platform_product_id order by dihitung_pada desc) as rn
        from px_sku_eligibility
       where versi_policy = (select max(versi) from px_eligibility_policy where aktif = true)
         and verdict = 'kreator_kosong'
    )
    select t.level2_category, t.price_segment,
           count(distinct t.platform_product_id)::int as jumlah_produk,
           count(distinct cp.client_id)::int as jumlah_klien
      from terbaru t
      join client_platforms cp on cp.id = t.client_platform_id
     where t.rn = 1 and t.level2_category is not null and t.price_segment is not null
     group by t.level2_category, t.price_segment
     order by jumlah_produk desc`;
  return rows.map((r) => ({
    level2Category: r.level2_category,
    priceSegment: r.price_segment,
    jumlahProduk: r.jumlah_produk,
    jumlahKlien: r.jumlah_klien,
  }));
}
