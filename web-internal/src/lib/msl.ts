/**
 * Master Service List — the mapping between the admin form and the API payload.
 *
 * This lives in `lib/` rather than inside the page for one reason: `updateService`
 * is FULL REPLACE. Every "Ubah" writes a brand-new immutable version row from
 * whatever the payload contains, so a field the form forgets to carry is not
 * "left alone" — it is erased in the new version. That is not a hypothetical:
 * until 2026-09-07 the form neither showed nor sent `durasi_bulan`, so editing
 * either of the two services that had one (AI Video, Optimasi SKU — seeded with
 * 30 days by migration `20260831070000`) would have silently written NULL.
 *
 * A page component cannot be unit-tested cheaply; this mapping can. Keeping the
 * two directions here — row → form, form → payload — means the round-trip is
 * pinned by `msl.test.ts`, and a future field added to `MasterService` without
 * being carried through shows up as a failing test instead of as a value that
 * quietly disappears the next time someone edits a price.
 */
import { api } from './api';
import type { MasterService, PlanTier, QtyMenambah } from './types';

export interface MslFormState {
  name: string;
  standard_price: string;
  commission_rule: string;
  category: string;
  unit: string;
  min_qty: string;
  pricing_mode: string;
  apply_ppn: boolean;
  frequency: string;
  price_note: string;
  description: string;
  active: boolean;
  plan_tier: PlanTier;
  /**
   * Held as the raw string the input carries, not as a number: '' is how the
   * admin says "layanan sekali jadi, tidak punya periode", and it has to survive
   * being typed through (someone clearing the box mid-edit) without becoming 0.
   */
  durasi_bulan: string;
  qty_menambah: QtyMenambah;
  effective_from: string;
}

/** The body POST /master-services and PUT /master-services/:id accept. */
export interface MslPayload {
  name: string;
  standard_price: string;
  commission_rule: string;
  category: string;
  unit: string;
  min_qty: string;
  pricing_mode: string;
  apply_ppn: boolean;
  frequency: string;
  price_note: string;
  description: string;
  active: boolean;
  plan_tier: PlanTier;
  /** null = sekali jadi. The key is ALWAYS present — see the note above. */
  durasi_bulan: number | null;
  qty_menambah: QtyMenambah;
  effective_from: string;
}

/** today's date as YYYY-MM-DD, the default cutover for a new version. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export const EMPTY_MSL_FORM: MslFormState = {
  name: '',
  standard_price: '',
  commission_rule: '',
  category: '',
  unit: '',
  min_qty: '',
  pricing_mode: 'flat',
  apply_ppn: false,
  frequency: '',
  price_note: '',
  description: '',
  active: true,
  // Default to the safest tier: a new catalog entry must not silently start
  // demanding a Strategi. The Sales Head opts in (O54).
  plan_tier: 'tanpa_plan',
  durasi_bulan: '',
  // 'volume' is the safe default for the same reason the DB defaults to it:
  // under-stating a duration shows up fast, over-stating it spreads revenue
  // across years without anyone noticing.
  qty_menambah: 'volume',
  effective_from: todayISO(),
};

/**
 * formToState fills the edit form from the version currently effective. Every
 * field the payload will send must be read back here — that is the invariant
 * that stops a full-replace update from erasing what it did not display.
 *
 * `effective_from` is deliberately NOT copied: a new version cuts over from
 * today, not from the day the old one started.
 */
export function serviceToForm(service: MasterService): MslFormState {
  return {
    name: service.name,
    standard_price: String(service.standard_price),
    commission_rule: service.commission_rule,
    category: service.category,
    unit: service.unit,
    min_qty: service.min_qty,
    pricing_mode: service.pricing_mode || 'flat',
    apply_ppn: service.apply_ppn,
    frequency: service.frequency,
    price_note: service.price_note,
    description: service.description,
    active: service.active,
    plan_tier: service.plan_tier,
    durasi_bulan: service.durasi_bulan === null ? '' : String(service.durasi_bulan),
    qty_menambah: service.qty_menambah,
    effective_from: todayISO(),
  };
}

/**
 * parseDurasiBulan turns what the admin typed into what the API stores. Empty
 * (or whitespace) is the legitimate "sekali jadi" and becomes null; anything
 * that is not a whole positive number of MONTHS is ALSO sent as-typed so the
 * server rejects it with the house BI message rather than the form quietly
 * rounding it — except that a non-numeric string has no number to send, so it
 * becomes NaN and the server answers `[data tidak lengkap, ...]`.
 */
export function parseDurasiBulan(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  return Number(t);
}

/**
 * formToPayload builds the request body. `standard_price` is forced to '0' for
 * passthrough and `min_qty` is dropped for modes that do not use it, mirroring
 * what the backend normalizer expects.
 */
export function formToPayload(form: MslFormState): MslPayload {
  const isPassthrough = form.pricing_mode === 'passthrough';
  const needsMinQty = form.pricing_mode === 'min_floor' || form.pricing_mode === 'batch_ceiling';
  return {
    name: form.name,
    standard_price: isPassthrough ? '0' : form.standard_price,
    commission_rule: form.commission_rule,
    category: form.category,
    unit: form.unit,
    min_qty: needsMinQty ? form.min_qty : '',
    pricing_mode: form.pricing_mode,
    apply_ppn: form.apply_ppn,
    frequency: form.frequency,
    price_note: form.price_note,
    description: form.description,
    active: form.active,
    plan_tier: form.plan_tier,
    durasi_bulan: parseDurasiBulan(form.durasi_bulan),
    qty_menambah: form.qty_menambah,
    effective_from: form.effective_from,
  };
}

/**
 * formatDurasiBulan renders the column. House rule #7: a value that does not
 * apply renders as an em dash, never as 0 — "0 bulan" would read as a real
 * duration of zero, which is a different claim from "sekali jadi".
 *
 * The unit is spelled out because the same column used to hold DAYS: a bare
 * "6" in a catalogue that once meant days is exactly the ambiguity that put
 * month numbers in the `unit` column in the first place.
 */
export function formatDurasiBulan(months: number | null | undefined): string {
  if (months === null || months === undefined) return '—';
  return `${months} bulan`;
}

/** Human labels for the qty rule — used by the form and the table alike. */
export const QTY_MENAMBAH_LABELS: Record<QtyMenambah, string> = {
  durasi: 'Durasi (qty = jumlah bulan)',
  volume: 'Volume (qty = jumlah keluaran)',
};

/**
 * saveMasterService is the one door the MSL admin writes through — create when
 * `id` is null, new version when it is not.
 *
 * It lives here, next to `MslPayload`, rather than in the page, because
 * `body-parity.test.ts` resolves a request body from the interface declared IN
 * THE SAME FILE as the `api.*` call. A page that posts a payload typed in
 * another module reads as `unresolved` to that scanner — and an unresolved body
 * checks nothing, which would silently retire the very guard that catches
 * FE↔route key drift.
 */
export async function saveMasterService(id: string | null, payload: MslPayload): Promise<void> {
  if (id) {
    await api.put(`/master-services/${id}`, payload);
  } else {
    await api.post('/master-services', payload);
  }
}
