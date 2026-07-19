# PROMPT — UI Auth untuk web-internal (paralel backend)

**Status:** Handoff untuk akun Claude Code lain  
**Tanggal:** 2026-07-19  
**Backend:** Sedang dikerjakan (sesi terpisah); kontrak API sudah FINAL  
**Frontend:** UI dan alur pelanggan kini dibangun terhadap API contract di dokumen ini

---

## 1. Konteks Singkat

### Perubahan Auth Mendasar

CDPS kini menggunakan **auth lokal** (password berbasis database) bukan HRIS:

- **HRIS** berfungsi HANYA sebagai sumber data karyawan (sync `GET /employees` + fallback CSV)
- **Jalur auth lama** (`POST /api/v1/auth/verify` ke HRIS) DIHAPUS sepenuhnya
- **Auth baru:** password lokal (hash bcrypt), dikelola di tabel `employee_credentials`

### Alur Kunci

1. **Provisioning:** Admin set password temporer per karyawan → respons berisi `must_change_password=true`
2. **Login pertama:** Karyawan wajib ganti password (tidak boleh navigasi sebelum ganti)
3. **Lupa password:** Admin reset (password temporer baru, wajib ganti lagi)
4. **Gate force-change:** Selain `/me`, `/logout`, `/change-password` — semua endpoint dilindungi; akses lain → 403 `[wajib mengganti password terlebih dahulu]`

### Backend siap Kapan?

Backend sedang dibangun paralel (migrasi DB, auth handlers, permission gate) di branch `claude/hris-cdps-auth-system-nx6vff`. **UI boleh pakai mock/stub respons sementara** (sesuai kontrak di dokumen ini), lalu disambungkan ke API real begitu branch backend tersebut merged/deployed ke staging — cek branch itu untuk status terkini.

---

## 2. Kontrak API Lengkap (FINAL — jangan deviasi)

**Format error:** semua error response:  
```json
{"message": "[pesan bahasa Indonesia]"}
```

Gunakan field `.message` (helper `writeErr` backend existing) — bukan `.error`, `.data`, atau `.details`.

### 2.1. Login

**`POST /api/v1/auth/login`**

**Request:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response 200 OK:**
```json
{
  "employee": {
    "employee_id": "string",
    "nama": "string",
    "email": "string",
    "divisi": "string",
    "jabatan": "string"
  },
  "role": {
    "division": "string",
    "level": "staff" | "lead",
    "od": boolean,
    "director": boolean
  },
  "must_change_password": boolean
}
```

**Error responses:**

| Status | Error Message (di `.message`) |
|--------|-----|
| **400** | `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` |
| **401** | `[email atau password salah]` (email tidak terdaftar, nonaktif, atau password salah) |
| **401** | `[akun belum diaktifkan, hubungi admin untuk pengaturan password awal]` (karyawan aktif tapi belum ada credentials) |
| **423** | `[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]` (locked_until > NOW) |

**Catatan:**
- Field kosong/null → 400
- Gagal login 5x berturut-turut → account terkunci 15 menit (423)
- Sukses login → buat session cookie (`cdps_session`, TTL 12h)
- Jika `must_change_password=true` → alur paksa di client (lihat §3.2)

---

### 2.2. Get Current User

**`GET /api/v1/auth/me`**

> Catatan: `GET /api/v1/me` (path lama yang mungkin sudah dipakai FE existing) tetap hidup sebagai alias — respons sama persis, ikut mengembalikan `must_change_password`, dan sama-sama exempt dari gate force-change. Pakai `/api/v1/auth/me` untuk kode baru.

**Response 200 OK:**  
Bentuk identik dengan login (#2.1) — `{employee, role, must_change_password}`

**Error responses:**

| Status | Error Message |
|--------|-----|
| **401** | Tidak authenticated (session invalid/expired) |

---

### 2.3. Logout

**`POST /api/v1/auth/logout`**

**Response 204 No Content** — tak ada body

**Behavior:**
- Revoke session cookie
- Client: clear auth state, redirect ke `/login`

---

### 2.4. Ganti Password (User)

**`POST /api/v1/auth/change-password`**

**Request:**
```json
{
  "old_password": "string",
  "new_password": "string (min 8 karakter, maks 72 byte)"
}
```
(Aturan panjang hanya berlaku untuk `new_password`; `old_password` cukup wajib diisi.)

**Response 204 No Content**

**Error responses:**

| Status | Error Message |
|--------|-----|
| **400** | `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` (field kosong) |
| **400** | `[password minimal 8 karakter]` (new_password < 8) |
| **400** | `[password maksimal 72 karakter]` (new_password > 72 byte) |
| **401** | `[password lama tidak sesuai]` (old_password salah) |
| **401** | (tidak authenticated) |
| **423** | `[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]` (lockout — lihat catatan di bawah) |

**Behavior server-side:**
- Hash password baru (bcrypt)
- Set `must_change_password=0`
- Update `password_changed_at=NOW()`
- Reset `failed_attempts=0, locked_until=NULL`
- **REVOKE SEMUA sesi karyawan itu KECUALI sesi sekarang** (force re-login device lain)
- Audit: `action=password_changed_self`

**Lockout (BARU — counter shared dengan login):**
- `failed_attempts` di endpoint ini memakai **kolom yang sama** dengan `POST /auth/login`. `old_password` salah menaikkan counter itu (sama seperti password salah di login).
- Gagal ke-5 berturut-turut (lintas login DAN change-password, dihitung gabungan) memasang lock 15 menit — respons gagal ke-5 tetap **401** `[password lama tidak sesuai]`, lock terpasang setelahnya.
- Selama terkunci, endpoint ini menolak **423** dengan pesan di atas — **sekalipun `old_password` yang dikirim benar**. Login juga ditolak 423 di window yang sama (satu lock per akun, bukan per endpoint).
- **FE:** perlakukan 423 di halaman ganti password SAMA seperti 423 di halaman login (§3.1 butir 1) — tampilkan pesan persis, sarankan tunggu/hubungi admin. Tidak ada field baru di response body (masih `{"message": "[...]"}"`), tidak ada state baru selain menampilkan pesan 423.

**Catatan:**
- Endpoint ini TIDAK diblokir gate force-change (biar bisa diakses saat `must_change_password=true`)
- Tapi saat respons 204, client refresh `/me` untuk verifikasi `must_change_password=0` — baru boleh navigasi

---

### 2.5. Admin: Set Password Temporer

**`POST /api/v1/auth/admin/set-password`**

**Request:**
```json
{
  "employee_id": "string",
  "temp_password": "string (min 8, maks 72 byte)"
}
```

**Response 204 No Content**

**Error responses:**

| Status | Error Message |
|--------|-----|
| **400** | `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` (field kosong) |
| **400** | `[password minimal 8 karakter]` |
| **400** | `[password maksimal 72 karakter]` |
| **403** | `[anda tidak memiliki akses untuk mengatur password karyawan ini]` (otorisasi gagal — lihat §2.6 untuk scope) |
| **404** | `[karyawan tidak ditemukan]` (employee_id tidak ada di database) |
| **401** | (tidak authenticated) |

**Behavior server-side:**
- Otorisasi per role:
  - **Director:** bisa set password siapa saja
  - **Lead/SPV** (`Role.Level=="lead"`): hanya karyawan di divisi yang sama, DAN target **tidak boleh** punya layered role (od/director)
  - **Karyawan biasa (staff):** ditolak 403
  - Target tanpa role mapping: hanya Director bisa
- Upsert `employee_credentials`: hash password baru, `must_change_password=1`, reset counter+lock
- **REVOKE SEMUA sesi target** (force logout)
- Audit: `action=password_set_admin`, actor=logged-in user

**Catatan untuk UI:**
- Modal/form untuk set password temporer
- Saat sukses, tampilkan pengingat (copy bebas, TANPA format bracket `[...]` — bracket khusus string BI server): mis. "Password temporer ditetapkan. Sampaikan ke karyawan melalui saluran aman."
- Jangan tampilkan password plaintext di table — hanya indikasi ada/tidak ada

---

### 2.6. Admin: List Credentials

**`GET /api/v1/auth/admin/credentials`**

**Response 200 OK:**
```json
{
  "data": [
    {
      "employee_id": "string",
      "nama": "string",
      "email": "string",
      "divisi": "string",
      "jabatan": "string",
      "has_password": boolean,
      "must_change_password": boolean,
      "locked_until": "ISO8601 | null",
      "password_changed_at": "ISO8601 | null"
    }
  ]
}
```

**Error responses:**

| Status | Error Message |
|--------|-----|
| **403** | `[anda tidak memiliki akses untuk mengatur password karyawan ini]` (non-Director & non-Lead, atau Lead tanpa divisi valid) |
| **401** | (tidak authenticated) |

**Scope otorisasi:**
- **Director:** lihat semua karyawan aktif
- **Lead** (`Role.Level=="lead"`): lihat hanya karyawan divisi yang sama
- Lainnya → 403

**Catatan:**
- Data hanya karyawan dengan `status_aktif=1` (dari tabel `employees`)
- Field `has_password`: apakah `password_hash` tidak null
- `locked_until`: null jika tidak terkunci; otherwise ISO8601 datetime
- `password_changed_at`: null jika belum pernah ganti; otherwise ISO8601

---

### 2.7. Gate Force-Change (Server-side, tapi kritis untuk UI)

**Logika di backend:** jika user login punya `must_change_password=1`, setiap request ke endpoint protected (selain `/auth/me`, `/auth/logout`, `/auth/change-password`) → 403 SEBELUM handler endpoint dijalankan.

```
403
{
  "error": "[wajib mengganti password terlebih dahulu]"
}
```

**Dampak UI:**
- Saat `must_change_password=true` → navigasi paksa ke halaman ganti password (`/change-password`)
- Blokir tombol/link ke halaman lain
- Handler global: tangkap 403 dengan pesan itu → redirect ke `/change-password`
- Saat password berhasil diubah, refresh `/me` untuk update state

---

## 3. Pekerjaan UI (Spec Lengkap)

### 3.1. Halaman Login Existing — Adaptasi

**File:** `/src/app/login/page.tsx`

**Pekerjaan:**

1. **Tangani status error 401 & 423:**
   - Saat login gagal, extract `.message` dari respons, tampilkan persis tanpa parafrase
   - Handle `[akun belum diaktifkan...]` (401) → tampilkan pesan, disarankan hubungi admin
   - Handle `[akun terkunci...]` (423) → tampilkan pesan, timer atau "coba lagi nanti"

2. **Tangani `must_change_password` di respons 200:**
   - Jika `must_change_password=true` di respons login:
     - Jangan set session sepenuhnya
     - Simpan session (untuk `/change-password` nanti)
     - Redirect paksa ke `/change-password` (bukan `/`)
   - Jika `must_change_password=false` → login normal, redirect ke `/`

3. **Error lain:**
   - 400: tampilkan `[data tidak lengkap...]`
   - Fallback: gunakan `.message` dari respons atau fallback message

**Contoh pola (existing sudah ada, tinggal extend):**
```typescript
const session = await api.post<MeResponse>('/auth/login', { email, password });
if (session.must_change_password) {
  // Redirect ke halaman ganti password
  setSession(session); // Set minimal (employee + role)
  router.replace('/change-password');
} else {
  setSession(session);
  router.replace('/');
}
```

---

### 3.2. Halaman Ganti Password (New)

**File:** `/src/app/(shell)/account/change-password/page.tsx` (atau lokasi sesuai struktur)

**Persyaratan:**

1. **Form input:**
   - `old_password` (type="password") — diperlukan
   - `new_password` (type="password") — diperlukan
   - `new_password_confirm` (type="password") — untuk konfirmasi, client-side validasi saja

2. **Validasi client-side:**
   - Semua field wajib
   - `new_password`: min 8 karakter
   - `new_password`: maks 72 byte (hitung byte bukan char; JavaScript: `new TextEncoder().encode(str).length`)
   - Konfirmasi: `new_password === new_password_confirm`
   - Tampilkan error validasi sebelum submit ke server

3. **Submit & error handling:**
   - POST `/auth/change-password` dengan `old_password, new_password`
   - Handle 401 `[password lama tidak sesuai]` → tampilkan di form (field old_password focus)
   - Handle 400 `[password minimal...]` atau `[...maksimal...]` → tampilkan
   - Handle 423 `[akun terkunci sementara...]` (BARU — lockout kini juga berlaku di endpoint ini, counter shared dengan login) → tampilkan pesan persis, sama perlakuannya dengan 423 di halaman login (disable form/beri info "coba lagi nanti", bukan focus ke field tertentu)
   - Sukses 204:
     - Tampilkan confirmation/toast: "Password berhasil diubah. Mengalihkan..."
     - Call `GET /me` untuk update auth state (verify `must_change_password=0`)
     - Redirect ke `/` (atau halaman awal sebelumnya jika ada history)

4. **Styling & UX:**
   - Gunakan pola form existing (class="card form", btn, alert)
   - Tampilkan strength indicator atau meter untuk password (opsional, tapi recommended)
   - Disable submit button saat submitting
   - Password field: show/hide toggle (opsional)

**Contoh struktur:**
```typescript
// Saat mounted: cek must_change_password via auth context
// Jika false, bisa redirect ke / (sudah berhasil ganti)
const { employee, role } = useAuth();
if (!must_change_password) {
  router.push('/');
}
```

---

### 3.3. Alur Force-Change Global

**File:** `/src/middleware.ts` atau `/src/lib/auth-context.tsx` (extend)

**Pekerjaan:**

1. **Middleware/hook:** Saat `/me` di-fetch, jika `must_change_password=true`:
   - Jika user mencoba akses route selain `/change-password`, `/auth/logout`, `/api/v1/auth/*` → redirect ke `/change-password`
   - Bisa di middleware (Next.js) atau di page root layout

2. **Handler global 403:**
   - Interceptor di API client (di `lib/api.ts`):
     ```typescript
     if (res.status === 403 && body?.message?.includes('[wajib mengganti password')) {
       // Redirect ke /change-password
       window.location.href = '/change-password';
     }
     ```
   - Atau handle di masing-masing page yang protected (throw ke error boundary)

3. **UX saat di-force:**
   - Disarankan: dark overlay / loading screen + pesan "Anda perlu mengganti password terlebih dahulu"
   - Jangan langsung redirect; beri user 500ms untuk membaca
   - Blokir interaksi page lain

---

### 3.4. Panel Admin "Manajemen Password" (New)

**File:** `/src/app/(shell)/admin/credentials/page.tsx`

**Akses:**
- Hanya Director atau Lead (`role.level=="lead"`)
- Jika user tidak memenuhi syarat → 403 atau redirect ke dashboard

**Tabel (dari GET /api/v1/auth/admin/credentials):**

| Kolom | Sumber | Catatan |
|-------|--------|---------|
| **Nama** | `nama` | — |
| **Email** | `email` | — |
| **Divisi** | `divisi` | — |
| **Jabatan** | `jabatan` | — |
| **Status Password** | `has_password` | "Ada" (true) / "Belum" (false) |
| **Wajib Ganti?** | `must_change_password` | "Ya" / "Tidak" |
| **Terkunci Sampai** | `locked_until` | Format datetime atau "—" jika null |
| **Terakhir Diubah** | `password_changed_at` | Format date atau "—" jika null |
| **Aksi** | — | [Set Password] tombol / modal |

**Fitur:**

1. **Tombol [Set Password]:**
   - Klik → buka modal
   - Modal form:
     - Tampilkan nama karyawan + email (read-only)
     - Input: `temp_password` (min 8, maks 72 byte, validasi client-side)
     - Konfirmasi checkbox: "Saya akan memberitahu password ini melalui saluran aman"
     - Button: [Tetapkan] (POST /auth/admin/set-password) / [Batal]

2. **Success flow:**
   - Respons 204 → tampilkan toast/alert sukses
   - Pesan: `[Akses ditetapkan. Pastikan memberikan password temporer kepada karyawan melalui saluran aman (SMS/WhatsApp/meeting pribadi).]`
   - Refresh table (GET /admin/credentials lagi)
   - Modal close

3. **Error flow:**
   - 403 (otorisasi) → tampilkan alert: "Anda tidak punya akses untuk karyawan ini"
   - 404 (karyawan tidak ada) → alert: "Karyawan tidak ditemukan"
   - 400 (validasi password) → tampilkan di modal
   - Jangan close modal saat error

4. **Loading & disable:**
   - Saat fetch table: loading spinner
   - Saat submit modal: disable tombol [Tetapkan]
   - Button state: `{submitting ? 'Memproses...' : 'Tetapkan'}`

5. **Search/filter (opsional tapi recommended):**
   - Input pencarian nama/email (client-side filter dari data array)
   - Tidak perlu backend

6. **Pagination (opsional):**
   - Jika table > 50 rows, implementasikan pagination
   - Backend return semua, atau backend support query param limit/offset (TBD)

---

## 4. Konvensi Frontend (Ringkas)

### Struktur & Styling

- **Folder:** Pages di `/src/app/(shell)/`, komponental di `/src/components/`, logic di `/src/lib/`
- **CSS:** Module CSS (`.module.css`) per page, atau Tailwind jika sudah setup (cek tsconfig/next.config)
- **Existing:** Header, Sidebar, StatusBadge, card/form/btn/alert class globally available (global.css atau similar)

### API Client

- **Base:** `lib/api.ts` - fetch wrapper typed, error sebagai `ApiError{message, status}`
- **Types:** `lib/types.ts` — mirror API contract, no invented fields
- **Pattern:** 
  ```typescript
  const data = await api.get<ResponseType>('/endpoint');
  const data = await api.post<ResponseType>('/endpoint', payload);
  ```
- **Error:** field `.message` dalam response body, extracted & thrown sebagai `.message` di ApiError
- **Render:** `errorMessage(err)` utility untuk safe extraction

### Auth Context

- **Minimal:** `{employee, role, loading, refresh, setSession, logout}`
- **Add:** `mustChangePassword` boolean state jika diperlukan (extend dari MeResponse)
- **Extend MeResponse type** di `lib/types.ts`:
  ```typescript
  export interface MeResponse {
    employee: Employee;
    role: Role;
    must_change_password: boolean;  // NEW
  }
  ```

### Pesan Bahasa Indonesia

- **JANGAN parafrase** — copy-paste exact dari spec API (dengan `[...]` brackets)
- **Validation messages:** gunakan pesan server, atau client-side gunakan pesan dari spec
- **Toast/alert:** jangan translate atau edit — pastikan exact

### Next.js Specifics

- **App router** (bukan Pages Router)
- **Layout:** `/src/app/(shell)/layout.tsx` — wrapper Header + Sidebar untuk route protected
- **Public route:** `/src/app/login/page.tsx` — tidak perlu auth
- **Protected:** `/src/app/(shell)/**` — cek `useAuth()` di layout atau page, redirect jika tidak authenticated

---

## 5. Definition of Done UI

Sebelum handoff ke testing/QC:

- [ ] **Build & lint hijau:**
  ```bash
  cd web-internal
  npm run build
  npm run lint
  ```
  Tidak boleh ada error, warning minimal

- [ ] **Halaman login:**
  - [ ] Tangani 401/423/400 error, tampilkan pesan exact
  - [ ] Tangani `must_change_password=true` → redirect ke `/change-password`
  - [ ] Logout/navigasi: session cookie persis dari backend

- [ ] **Halaman ganti password:**
  - [ ] Form input (old + new + confirm)
  - [ ] Validasi client-side (8-72 byte)
  - [ ] Submit & error handling (401 old salah, 400 panjang)
  - [ ] Sukses 204 → refresh `/me` → redirect `/`
  - [ ] Saat `must_change_password=true` — user terpaksa di halaman ini, tidak bisa navigasi lain

- [ ] **Panel admin "Manajemen Password":**
  - [ ] GET /admin/credentials render table
  - [ ] Otorisasi: hanya Director + Lead dengan divisi tepat
  - [ ] Modal set password temporer
  - [ ] Error 403/404 handled
  - [ ] Sukses → refresh table + toast
  - [ ] Password validasi 8-72 byte

- [ ] **Global 403 force-change handler:**
  - [ ] Jika server kirim 403 `[wajib mengganti password...]` → redirect ke `/change-password`

- [ ] **Types & API client:**
  - [ ] `MeResponse` include `must_change_password: boolean`
  - [ ] Tidak ada invented fields
  - [ ] Error message exact dari spec

- [ ] **Styling:**
  - [ ] Gunakan existing class/component (card, form, btn, alert)
  - [ ] Responsive (mobile-friendly)
  - [ ] Consistent dengan halaman lain (color, spacing, font)

- [ ] **Audit & testing:**
  - [ ] Tidak menyentuh file `backend/`
  - [ ] Tidak menyentuh file `web-client-portal/`
  - [ ] Branch sendiri (e.g., `feature/ui-auth-local`)
  - [ ] Commit message jelas (e.g., "UI: Local Auth — login, force-change, admin credentials mgmt")

- [ ] **Mock API (sementara):**
  - [ ] Jika backend belum ready, buat stub response di component / middleware untuk development
  - [ ] Gunakan conditional: `if (process.env.NEXT_PUBLIC_MOCK_AUTH)` atau similar
  - [ ] Beri comment jelas: "// TODO: remove mock saat backend live"

---

## 6. Backend Dependency

Seluruh endpoint di §2 dibangun bersamaan di branch `claude/hris-cdps-auth-system-nx6vff` (satu paket kerja backend). Jangan mengandalkan ETA — cek branch/PR-nya untuk status nyata.

**Rekomendasi:**
- Mulai dev dengan mock response (copy dari spec §2)
- Swap mock → real API saat backend deployed ke staging
- **Jangan commit mock** — hapus atau guard dengan env var

---

## 7. Kontak & Questions

- **Backend lead:** (tergantung workflow project)
- **Product:** Keputusan final sudah fixed — lihat `docs/DECISIONS.md` entry 2026-07-19 ("AUTH DIREDESAIN — full lokal CDPS")
- **Bug/blocking:** Flag immediately, include status error + exact endpoint + request payload

---

## 8. Referensi Cepat — Copy-Paste String Exact

**Pesan BI wajib exact:**

```
[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]
[email atau password salah]
[akun belum diaktifkan, hubungi admin untuk pengaturan password awal]
[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]
[password lama tidak sesuai]
[password minimal 8 karakter]
[password maksimal 72 karakter]
[anda tidak memiliki akses untuk mengatur password karyawan ini]
[karyawan tidak ditemukan]
[wajib mengganti password terlebih dahulu]
```

**API paths:**
```
POST /api/v1/auth/login
GET /api/v1/auth/me
POST /api/v1/auth/logout
POST /api/v1/auth/change-password
POST /api/v1/auth/admin/set-password
GET /api/v1/auth/admin/credentials
```

---

Selamat mengerjakan! 🚀
