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
import type { MasterService, Pengakuan, PlanTier, QtyMenambah } from './types';

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
  /**
   * Held as a Pengakuan, never as '' — the catalog must always SAY when its
   * revenue is recognized. The form seeds it from the service being edited, and
   * `'saat_selesai'` for a brand-new one (see `EMPTY_FORM`).
   */
  pengakuan: Pengakuan;
  /**
   * FS-6 — baris pilihan tenor, dipegang sebagai STRING mentah seperti yang
   * diketik (alasan yang sama dengan `durasi_bulan`): admin yang sedang
   * mengosongkan kotak di tengah pengeditan tidak boleh membuatnya jadi 0.
   * Kosong = layanan tenor tunggal.
   */
  durasi_options: { durasi_bulan: string; harga: string }[];
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
  /**
   * ALWAYS sent, never omitted. The server refuses a service that has a
   * `durasi_bulan` but no `pengakuan` (both meanings are possible and neither
   * is safe to guess), so a missing key here would surface as
   * `[data tidak lengkap, ...]` on a form the admin thought was complete.
   */
  pengakuan: Pengakuan;
  /**
   * FS-6. Kunci SELALU dikirim (array kosong bila tenor tunggal), tidak pernah
   * dihilangkan — `updateService` ber-semantik FULL REPLACE, jadi payload yang
   * tidak membawanya akan MENGHAPUS opsi di versi baru tanpa peringatan. Itu
   * persis cacat yang pernah menghilangkan `durasi_bulan` diam-diam.
   */
  durasi_options: { durasi_bulan: number; harga: string }[];
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
  // Layanan baru mulai TANPA durasi, dan tanpa durasi hanya 'saat_selesai'
  // yang punya arti. Begitu admin mengisi durasi, dropdown-nya yang harus
  // mengatakan sisanya — bukan tebakan dari nilai durasi itu.
  pengakuan: 'saat_selesai' as Pengakuan,
  durasi_options: [],
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
    pengakuan: service.pengakuan,
    durasi_options: (service.durasi_options ?? []).map((o) => ({
      durasi_bulan: String(o.durasi_bulan),
      harga: String(o.harga),
    })),
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
    pengakuan: form.pengakuan,
    // Baris yang benar-benar KOSONG dibuang di sini — sebuah baris yang baru
    // ditambahkan lalu ditinggalkan adalah niat "batal", bukan tenor 0 rupiah.
    // Baris yang setengah terisi TIDAK dibuang: ia dikirim apa adanya supaya
    // server menolaknya dengan pesan BI, bukan supaya form diam-diam
    // membuangnya dan admin mengira tenornya tersimpan.
    durasi_options: form.durasi_options
      .filter((o) => o.durasi_bulan.trim() !== '' || o.harga.trim() !== '')
      .map((o) => ({ durasi_bulan: Number(o.durasi_bulan), harga: o.harga })),
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

/**
 * FS-6 — ringkasan pilihan tenor untuk kolom tabel: "3 / 6 / 12 bulan".
 *
 * Em dash untuk layanan tenor tunggal, mengikuti aturan rumah #7 — dan bukan
 * "0 pilihan", yang terbaca seperti kesalahan data padahal tenor tunggal adalah
 * bentuk normal seluruh katalog hari ini.
 */
export function formatOpsiDurasi(
  options: { durasi_bulan: number; harga: string }[] | null | undefined,
): string {
  if (!options || options.length === 0) return '—';
  return `${options.map((o) => o.durasi_bulan).join(' / ')} bulan`;
}

/** Human labels for the qty rule — used by the form and the table alike. */
export const QTY_MENAMBAH_LABELS: Record<QtyMenambah, string> = {
  durasi: 'Durasi (qty = jumlah bulan)',
  volume: 'Volume (qty = jumlah keluaran)',
};

/** Label kolom & dropdown "Kapan Pendapatan Diakui" (D-KOM). */
export const PENGAKUAN_LABELS: Record<Pengakuan, string> = {
  per_periode: 'Rata sepanjang durasi',
  saat_selesai: 'Sekaligus saat selesai',
  bulan_berikutnya: 'Bulan berikutnya (komisi)',
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

/**
 * FS-6b — apa yang boleh dikirim sebagai `durasi_bulan` untuk satu layanan.
 *
 * Array kosong berarti "layanan tenor tunggal": TIDAK ada yang boleh dikirim,
 * dan bukan karena tampilannya lebih rapi tanpa dropdown. Server menolak tenor
 * apa pun untuk layanan tanpa opsi (`sales.resolveTenor`), jadi UI yang
 * menawarkan satu pilihan di situ hanya akan melahirkan
 * `[data tidak lengkap, ...]` pada form yang tampak lengkap.
 */
export function tenorOptions(svc: { durasi_options?: { durasi_bulan: number; harga: string }[] } | undefined): {
  durasi_bulan: number;
  harga: string;
}[] {
  return svc?.durasi_options ?? [];
}

/**
 * punyaTenor menjawab satu pertanyaan yang dipakai empat layar: perlukah baris
 * ini menampilkan pemilih tenor sama sekali?
 */
export function punyaTenor(svc: { durasi_options?: { durasi_bulan: number; harga: string }[] } | undefined): boolean {
  return tenorOptions(svc).length > 0;
}

/**
 * tenorDefault memilih tenor yang sudah terpasang saat baris pertama muncul.
 *
 * Jawabannya opsi TERPENDEK, dan itu bukan sekadar "yang pertama": opsi
 * terpendek adalah satu-satunya yang harganya SAMA dengan `standard_price`
 * versi induknya (invarian `trg_msdo_terpendek`). Jadi baris yang baru dibuka
 * menunjukkan angka yang sama persis dengan yang ditunjukkan sistem sebelum
 * FS-6 — Sales melihat perubahan hanya ketika ia benar-benar memilih tenor
 * lain, bukan ketika ia membuka halaman.
 */
export function tenorDefault(svc: { durasi_options?: { durasi_bulan: number; harga: string }[] } | undefined): number | undefined {
  const opts = tenorOptions(svc);
  return opts.length > 0 ? opts[0].durasi_bulan : undefined;
}

/**
 * tenorLabel merangkai satu opsi jadi teks dropdown: "12 bulan — Rp. 36.000.000,00".
 *
 * Harganya IKUT ditampilkan, dan itu inti keluhan #6: yang membuat paket
 * panjang layak dijual justru harganya yang lebih murah per bulan. Dropdown
 * yang hanya menulis "12 bulan" menyembunyikan satu-satunya alasan Sales
 * memilihnya.
 */
export function tenorLabel(o: { durasi_bulan: number; harga: string }, formatIDR: (v: string) => string): string {
  return `${o.durasi_bulan} bulan — ${formatIDR(o.harga)}`;
}
