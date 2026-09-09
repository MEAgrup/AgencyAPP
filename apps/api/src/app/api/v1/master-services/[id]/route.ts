/**
 * PUT /api/v1/master-services/{id} — append a new immutable version to a master
 * service (nothing is mutated in place). Ports Go's handleUpdateMasterService.
 * The Sales-owned write gate + validation live in the domain layer.
 */
import { msl } from '@cdps/domain';
import { requireActor } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, readJson } from '@/lib/http';

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
   *
   * CATATAN semantik FULL REPLACE: `updateService` menulis baris versi BARU dari
   * isi payload, jadi payload yang TIDAK membawa `durasi_options` menghapus
   * opsinya di versi baru. Itu perilaku yang dinyatakan (ada tesnya), bukan
   * kecelakaan — dan itulah kenapa form MSL wajib mem-carry field ini.
   */
  durasi_options?: { durasi_bulan?: number; harga?: string }[];
  effective_from?: string;
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = requireActor(request);
    const { id } = await ctx.params;
    const b = await readJson<ServiceBody>(request);
    const versionNo = await msl.updateService(db(), actor, id, {
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
    });
    return json({ id, version_no: versionNo });
  });
}
