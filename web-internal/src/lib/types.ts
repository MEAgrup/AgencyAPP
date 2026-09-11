// Shared API/domain types for CDPS web-internal.
// Mirrors the fixed API contract exactly — no invented fields.

export interface Employee {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
}

export interface Role {
  division: string;
  level: string;
  od: boolean;
  director: boolean;
}

export interface MeResponse {
  employee: Employee;
  role: Role;
}

/**
 * LT-61 — a Live Stream vendor's own profile, returned by `POST /auth/login`
 * (vendor branch) and `GET /vendor/me`. Deliberately narrow: unlike `Employee`,
 * there is no `role` (a vendor Actor's role is always empty — see
 * packages/core/src/permission.ts) and no internal fields (`vendors.catatan_kinerja`
 * is MEA-internal and never sent here).
 */
export interface VendorProfile {
  vendor_id: string;
  nama_vendor: string;
}

export interface VendorMeResponse {
  vendor: VendorProfile;
}

export interface NotificationItem {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  deep_link: string;
  actor: string;
  created_at: string;
  read_at: string | null;
}

export interface NotificationsResponse {
  data: NotificationItem[];
  unread_count: number;
}

export interface AdminEmployee {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  status_aktif: boolean;
  flagged: boolean;
  /**
   * Non-null = akses sudah DICABUT PERMANEN (resign, ketokan pemilik
   * 2026-09-10). Berbeda dari `status_aktif: false`, yang bisa berbalik pada
   * sinkron HRIS berikutnya; yang ini tidak pernah. Tabel Karyawan memakainya
   * untuk menyembunyikan aksi pada baris yang sudah keluar.
   */
  resigned_at: string | null;
}

/**
 * Satu hal yang masih menunjuk seorang karyawan saat aksesnya dicabut —
 * ditampilkan sebagai langkah konfirmasi resign, supaya "lepas penugasan
 * aktif" jadi daftar yang bisa dibaca, bukan efek samping tak terlihat.
 *
 * `kind` sengaja string (bukan union sempit): server yang memutuskan
 * kategorinya, dan menyalin daftarnya ke sini hanya menciptakan versi kedua
 * yang bisa ketinggalan. Labelnya dipetakan lewat `HANDOVER_LABELS`.
 */
/**
 * Pemakaian satu id katalog per tabel snapshot (`GET /master-services/{id}/refs`).
 *
 * Duduk di sini dan bukan di `msl.ts` supaya ia satu rumah dengan
 * `MasterService`, dan supaya `shape-parity` bisa menjangkarnya tanpa harus
 * memindai seluruh `msl.ts`.
 */
export interface ServiceRefs {
  services: number;
  qualified_forms: number;
  negotiation_lines: number;
  renewal_lines: number;
  /**
   * Boleh dihapus atau tidak. DIBACA dari server, tidak diturunkan ulang di
   * layar dengan menjumlahkan keempat angka: aturannya milik
   * `private.master_service_refs`, dan tabel snapshot kelima yang lahir kelak
   * akan membuat penjumlahan lokal benar-menurut-dirinya tapi salah.
   */
  unused: boolean;
}

export interface HandoverItem {
  kind: string;
  id: string;
  label: string;
}

/** Jawaban `POST /admin/employees/{id}/resign`. */
export interface ResignResult {
  employee: AdminEmployee;
  handover: HandoverItem[];
}

/**
 * One row of the admin vendor-account screen (LT-61 follow-up) — a vendor
 * joined to its login, if any. `status_aktif: null` (not `false`) means the
 * vendor has never been provisioned an account at all.
 */
export interface VendorAccount {
  vendor_id: string;
  nama_vendor: string;
  auth_user_id: string | null;
  email: string | null;
  status_aktif: boolean | null;
  created_at: string | null;
  created_by: string | null;
}

/**
 * M15-C2 — one row of the admin client-contacts (Client Portal provisioning)
 * screen. Unlike `VendorAccount`, a row only ever exists for a contact that
 * HAS been provisioned — a Client can have zero-to-many contacts, so there is
 * no "unprovisioned" placeholder row to represent.
 */
export interface ClientContactAccount {
  auth_user_id: string;
  client_id: string;
  nama_klien: string;
  nama: string;
  email: string | null;
  status_aktif: boolean;
  must_change_password: boolean;
  created_at: string;
  created_by: string;
}

/**
 * One row of GET /employees/assignable — the payload of every assignment
 * dropdown (AM, Brief/Task/Asset PIC, Booking Coordinator).
 *
 * Narrower than `AdminEmployee` by design: the admin roster is Director/OD-only
 * and carries email/flagged/sync staleness; this list is read by anyone who
 * assigns work, so it carries only what is needed to pick a person.
 *
 * `divisi`/`jabatan` are the RAW HRIS strings — LABELS (this is what tells an
 * "Account Manager" apart from a "CRO" inside the same Account division), never a
 * scope. `division`/`level` are the resolved CDPS role the server validates
 * against.
 */
export interface AssignableEmployee {
  employee_id: string;
  nama: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
}

export interface EmployeeSyncResult {
  synced: number;
  deactivated: number;
  reactivated: number;
  flagged: number;
}

/** One row of GET /auth/admin/credentials — credential STATUS, never material. */
export interface CredentialInfo {
  employee_id: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  has_password: boolean;
  must_change_password: boolean;
  locked_until: string | null;
  password_changed_at: string | null;
}

/**
 * Result of POST /admin/employee-import. The employee source is an admin CSV
 * upload, NOT an HRIS pull (DECISIONS OQ-4 — the HRIS endpoint was dropped), so
 * this replaces the old `/admin/employee-sync` shape.
 */
export interface EmployeeImportResult {
  source: string;
  sync: EmployeeSyncResult;
  provisioned: number;
  linked: number;
}

export interface RoleMapping {
  id: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
}

/**
 * One row of the national-holiday calendar. It is what makes "hari kerja" in the
 * Kelola Klien SLA mean working days rather than calendar days; empty calendar =
 * only weekends are excluded.
 */
export interface HariLibur {
  tanggal: string;
  keterangan: string;
  created_at: string;
  created_by: string;
}

export interface LayeredRole {
  employee_id: string;
  role: 'od' | 'director';
  enabled: boolean;
}

// MSL v2 calculator pricing modes (DECISIONS 2026-07-16 / docs/handoff/MSL_KALKULATOR_VALIDASI.md).
export const PRICING_MODES = ['flat', 'min_floor', 'batch_ceiling', 'passthrough'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

// Frequency enum as stored/returned by the backend ("" = tidak ditentukan).
export const FREQUENCIES = ['', 'Monthly', 'One-time', 'Campaign'] as const;

/**
 * Catalog tier (M6C S4). Declared HERE rather than in `account.ts` because
 * `account.ts` imports this file — putting it the other way round would make a
 * cycle. `account.ts` re-exports it, so existing importers are unaffected.
 */
export type PlanTier = 'plan_wajib' | 'ditentukan_am' | 'tanpa_plan';

/**
 * Apa yang bertambah kalau klien beli lebih dari satu (ketokan Q3 2026-09-07).
 * `durasi` ⇒ durasi total = qty × durasi_bulan; `volume` ⇒ qty adalah jumlah
 * keluaran dalam periode yang sama.
 */
export type QtyMenambah = 'durasi' | 'volume';

/**
 * KAPAN pendapatan sebuah layanan diakui mesin accrual (ketokan D-KOM
 * 2026-09-07). TIDAK bisa diturunkan dari `durasi_bulan`: `Komisi` dan `Jasa
 * Pengajuan Shopee Mall` sama-sama `durasi_bulan = null` dengan arti berbeda.
 */
export type Pengakuan = 'per_periode' | 'saat_selesai' | 'bulan_berikutnya';

export interface MasterService {
  id: string;
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
  requires_strategy_plan: boolean;
  /** Catalog tier — set by Sales Head in the MSL admin (O54). */
  plan_tier: PlanTier;
  /** BULAN kalender. null = layanan sekali jadi, tidak punya periode (Q5). */
  durasi_bulan: number | null;
  /** Apa yang ditambah qty yang dibeli klien (Q3). */
  qty_menambah: QtyMenambah;
  /** Kapan pendapatannya diakui (D-KOM). */
  pengakuan: Pengakuan;
  /**
   * FS-6: pilihan tenor (1/3/6/12 bulan dengan harga berbeda), terurut dari
   * yang TERPENDEK. `[]` = layanan tenor tunggal — bentuk seluruh katalog
   * sebelum FS-6, jadi setiap halaman yang membacanya harus tetap benar untuk
   * array kosong.
   *
   * Opsi pertama SELALU sama dengan `standard_price` + `durasi_bulan` di atas
   * (invarian trigger DB `trg_msdo_terpendek`), jadi kode lama yang hanya
   * membaca kedua field itu tidak pernah membaca angka yang tidak mewakili
   * apa pun.
   */
  durasi_options: { durasi_bulan: number; harga: string }[];
  version_no: number;
  effective_from: string;
}

export interface DemoTask {
  id: string;
  title: string;
  status: string;
  created_by: string;
  created_at: string;
}

export interface AuditEntry {
  actor_employee_id: string;
  action: string;
  before_json: unknown;
  after_json: unknown;
  created_at: string;
}

// Blok `task` dari GET /demo-tasks/{id}. Berbeda dari `DemoTask` baris daftar:
// halaman detail juga membaca `description`. Dinamai (bukan objek inline) supaya
// gate paritas bentuk bisa membandingkan kunci di dalamnya — sebelum ini
// `description` hanya terdaftar sebagai "kunci ekstra" terhadap `DemoTask`,
// sehingga menghapusnya dari wire TIDAK akan memerahkan gate mana pun.
export interface DemoTaskDetailTask {
  id: string;
  title: string;
  description: string;
  status: string;
  created_by: string;
  created_at: string;
}

export interface DemoTaskDetail {
  task: DemoTaskDetailTask;
  allowed_transitions: string[];
  audit: AuditEntry[];
}

// Nilai divisi KANONIK role-mapping — persis konstanta backend
// (module0/2/6/7/8/9/10/12: "Marketing"/"Sales"/"Finance"/"Account"/"Creative"/
// "Ads"/"KOL"/"Live Stream"; plus "HR" — `admin.HR_DIVISION`, gerbang mutasi &
// resign) dan seed/batch riil (seed/role_mappings_riil.csv).
// Backend TIDAK memvalidasi kanon pada POST /admin/role-mappings, jadi form ini
// satu-satunya penjaga: nilai lowercase legacy Wave 1 menghasilkan mapping yang
// tidak pernah match gate divisi mana pun (DECISIONS 2026-07-19).
export const DIVISIONS = [
  'Marketing',
  'Sales',
  'Finance',
  'Account',
  'Creative',
  'Ads',
  'KOL',
  'Live Stream',
  'HR',
] as const;

export const LEVELS = ['staff', 'lead'] as const;
