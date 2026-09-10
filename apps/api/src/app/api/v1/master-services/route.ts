/**
 * /api/v1/master-services — list the MSL effective today (GET) and create a new
 * master service with version 1 (POST). Ports Go's handleListMasterServices /
 * handleCreateMasterService.
 *
 * The Sales-owned write gate + all validation live in the domain layer; this
 * shell resolves the actor and maps the snake_case wire body.
 */
import { msl } from '@cdps/domain';
import { tz } from '@cdps/core';
import { requireActor } from '@/lib/auth';
import { db, readAsActor } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';
import { masterServiceToWire } from '@/lib/wire';

interface ServiceBody {
  name?: string;
  standard_price?: string;
  commission_rule?: string;
  category?: string;
  unit?: string;
  min_qty?: string;
  pricing_mode?: string;
  apply_ppn?: boolean;
  frequency?: string;
  price_note?: string;
  description?: string;
  active?: boolean;
  requires_strategy_plan?: boolean;
  plan_tier?: string;
  /**
   * BULAN kalender. Absent, undefined, ATAU `null` sama artinya: layanan ini
   * sekali jadi dan tidak punya periode. `null` diterima karena pengirim
   * utamanya adalah form MSL admin, yang selalu punya kuncinya; memaksanya
   * menghilangkan kunci saat kosong adalah cara termudah menghilangkan nilainya
   * tanpa sadar.
   */
  durasi_bulan?: number | null;
  /** 'durasi' | 'volume'. Absent = 'volume' (sisi aman, lihat msl.ts). */
  qty_menambah?: string;
  /**
   * 'per_periode' | 'saat_selesai' | 'bulan_berikutnya' (D-KOM). Boleh absent
   * HANYA bila `durasi_bulan` kosong; kalau layanannya berdurasi, absennya
   * ditolak dengan pesan gerbang wajib — dua arti sama-sama mungkin dan tidak
   * ada sisi yang aman untuk ditebak (lihat msl.ts).
   */
  pengakuan?: string;
  /**
   * FS-6: pilihan tenor (1/3/6/12 bulan dengan harga berbeda). Absent atau `[]`
   * sama artinya: layanan tenor tunggal. Bila diisi, opsi TERPENDEK wajib sama
   * dengan `standard_price` + `durasi_bulan` — ditolak `msl.normalizeInput` DAN
   * trigger DB `trg_msdo_terpendek`.
   */
  durasi_options?: { durasi_bulan?: number; harga?: string }[];
  effective_from?: string;
}

function toInput(b: ServiceBody): msl.ServiceInput {
  return {
    name: b.name ?? '',
    standardPrice: b.standard_price ?? '',
    commissionRule: b.commission_rule ?? '',
    category: b.category,
    unit: b.unit,
    minQty: b.min_qty,
    pricingMode: b.pricing_mode,
    applyPPN: b.apply_ppn,
    frequency: b.frequency,
    priceNote: b.price_note,
    description: b.description,
    active: b.active,
    requiresStrategyPlan: b.requires_strategy_plan,
    planTier: b.plan_tier as msl.ServiceInput['planTier'],
    durasiBulan: b.durasi_bulan,
    qtyMenambah: b.qty_menambah as msl.ServiceInput['qtyMenambah'],
    pengakuan: b.pengakuan as msl.ServiceInput['pengakuan'],
    durasiOptions: (b.durasi_options ?? []).map((o) => ({
      durasiBulan: Number(o.durasi_bulan ?? 0),
      harga: o.harga ?? '',
    })),
    effectiveFrom: b.effective_from ?? '',
  };
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    // web-internal passes ?effective_at=YYYY-MM-DD (defaults to today) so the
    // Sales calculator can preview the MSL as of any date; fall back to today
    // when absent/malformed.
    const params = new URL(request.url).searchParams;
    const at = params.get('effective_at');
    const date = at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : tz.dateString(new Date());
    // `?sellable=1` menyaring layanan yang sudah diarsipkan. Ia OPT-IN, dan itu
    // disengaja: pemanggil terbesar endpoint ini adalah layar MSL admin, yang
    // justru HARUS melihat baris nonaktif (dengan badge-nya) supaya ada tempat
    // untuk memulihkannya. Yang opt-in adalah para PICKER — kalkulator,
    // Qualified Form, panel perpanjangan, layar persetujuan — karena merekalah
    // yang menawarkan sesuatu untuk DIJUAL.
    //
    // Penyaring ini KENYAMANAN, bukan gerbang: gerbang sebenarnya ada di
    // `msl.sellableAt`, yang dipanggil setiap jalur tulis. Sebuah request buatan
    // tangan yang melewatkan parameter ini tetap tidak bisa menjual layanan
    // yang diarsipkan.
    const sellableOnly = params.get('sellable') === '1';
    const services = await readAsActor(actor, (sql) =>
      sellableOnly ? msl.listSellableAt(sql, date) : msl.listEffectiveAt(sql, date));
    return json({ data: services.map(masterServiceToWire) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const body = await readJson<ServiceBody>(request);
    const id = await msl.createService(db(), actor, toInput(body));
    return json({ id }, 201);
  });
}
