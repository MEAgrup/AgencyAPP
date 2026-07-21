# Runbook — Daftar Email Karyawan + Password Temporer untuk QA

> Tujuan: (1) mengambil daftar email semua karyawan aktif di database **production (MySQL @ Railway)**, dan
> (2) men-set **password temporer** untuk mereka agar bisa mulai QA — **kecuali** `yohanagustian@meagency.co.id`.
>
> Runbook ini memakai tool bawaan aplikasi (`cmd/setpass`), **bukan** SQL mentah. Setiap password temporer otomatis:
> - `must_change_password = 1` → karyawan **wajib ganti password** saat login pertama (kamu tidak pernah tahu password final mereka),
> - semua sesi lama karyawan itu **di-revoke**,
> - dicatat di **audit log** (`action = password_set_admin`).
>
> ⚠️ Ini menyentuh **akun karyawan asli di production**. Jalankan sadar penuh. Password temporer bersifat rahasia — simpan & distribusikan lewat kanal aman, jangan di chat grup.

---

## Prasyarat

- Akses ke **Railway project** yang menghosting MySQL CDPS/AgencyAPP.
- Repo ter-clone: `git clone https://github.com/MEAgrup/AgencyAPP.git`
- Terpasang di mesin yang kamu pakai: **Go 1.24+**, **mysql client** (`mysql`), dan opsional **Railway CLI** (`npm i -g @railway/cli`).

---

## Langkah 1 — Cari credential MySQL di Railway

Railway mengekspos beberapa variabel pada service MySQL. Yang kamu butuh:

| Variabel | Contoh isi | Dipakai untuk |
|---|---|---|
| `MYSQLHOST` | `containers-us-west-x.railway.app` | host mysql client |
| `MYSQLPORT` | `7xxxx` | port mysql client |
| `MYSQLUSER` | `root` | user |
| `MYSQLPASSWORD` | `xxxxxxxx` | password |
| `MYSQLDATABASE` | `railway` | nama database |
| `MYSQL_URL` | `mysql://root:pass@mysql.railway.internal:3306/railway` | DSN internal (hanya jalan **di dalam** Railway) |
| `MYSQL_PUBLIC_URL` | `mysql://root:pass@containers-us-west-x.railway.app:7xxxx/railway` | DSN **dari luar** (laptop kamu) |

> 🔴 Penting: `MYSQL_URL` memakai host internal `*.railway.internal` yang **hanya bisa diakses dari dalam jaringan Railway**. Kalau kamu menjalankan runbook ini dari laptop/CI di luar Railway, pakai **`MYSQL_PUBLIC_URL`** (atau host+port proxy publik).

### Cara A — Lewat Dashboard (paling mudah)
1. Buka [railway.app](https://railway.app) → pilih **project** AgencyAPP.
2. Klik service **MySQL**.
3. Tab **Variables** → di sini semua variabel di atas terlihat (klik ikon mata untuk reveal, atau "Copy").
4. Untuk string koneksi siap pakai: tab **Connect** → salin **"Public Network"** connection URL (itu `MYSQL_PUBLIC_URL`).

### Cara B — Lewat Railway CLI
```bash
railway login
railway link            # pilih project + environment (production)
railway variables       # tampilkan semua variabel service (termasuk MYSQL_PUBLIC_URL)
```

Atau langsung buka shell mysql ke DB tanpa menyalin password:
```bash
railway connect MySQL   # membuka prompt mysql> tersambung ke DB production
```

---

## Langkah 2 — Set variabel koneksi di terminalmu

Pakai nilai dari Langkah 1. **Dari luar Railway → gunakan URL publik:**

```bash
# DSN untuk tool aplikasi (cmd/setpass). DSN() membaca CDPS_DSN / DATABASE_URL / MYSQL_URL
# dan otomatis menormalisasi bentuk mysql://user:pass@host:port/db
export CDPS_DSN="mysql://root:PASSWORD@containers-us-west-x.railway.app:7XXXX/railway"

# Variabel terpisah untuk mysql client (dipakai di Langkah 3 & 4)
export MYSQLHOST="containers-us-west-x.railway.app"
export MYSQLPORT="7XXXX"
export MYSQLUSER="root"
export MYSQLPASSWORD="PASSWORD"
export MYSQLDATABASE="railway"
```

Tes koneksi:
```bash
mysql -h "$MYSQLHOST" -P "$MYSQLPORT" -u "$MYSQLUSER" -p"$MYSQLPASSWORD" "$MYSQLDATABASE" \
  -e "SELECT COUNT(*) AS total_karyawan_aktif FROM employees WHERE status_aktif = 1;"
```

---

## Langkah 3 — Ambil daftar email semua karyawan aktif (deliverable #1)

```bash
mysql -h "$MYSQLHOST" -P "$MYSQLPORT" -u "$MYSQLUSER" -p"$MYSQLPASSWORD" "$MYSQLDATABASE" \
  -e "SELECT employee_id, nama, email, divisi, jabatan
        FROM employees
       WHERE status_aktif = 1
       ORDER BY divisi, employee_id;"
```

Kalau mau CSV untuk diarsip:
```bash
mysql -h "$MYSQLHOST" -P "$MYSQLPORT" -u "$MYSQLUSER" -p"$MYSQLPASSWORD" "$MYSQLDATABASE" \
  -N -B -e "SELECT employee_id, nama, email FROM employees WHERE status_aktif = 1 ORDER BY employee_id" \
  > daftar_karyawan_aktif.tsv
```

---

## Langkah 4 — Set password temporer untuk QA (kecuali Yohan)

Skrip di bawah: ambil semua karyawan aktif **kecuali** `yohanagustian@meagency.co.id`, buat password acak **unik per orang**, jalankan `setpass`, lalu catat hasilnya ke satu file rahasia (`qa_temp_passwords.csv`, mode `600`).

```bash
cd AgencyAPP            # root repo hasil clone

# 4a. Ambil target: employee_id <TAB> email (aktif, tanpa Yohan)
mysql -h "$MYSQLHOST" -P "$MYSQLPORT" -u "$MYSQLUSER" -p"$MYSQLPASSWORD" "$MYSQLDATABASE" \
  -N -B -e "SELECT employee_id, email
              FROM employees
             WHERE status_aktif = 1
               AND email <> 'yohanagustian@meagency.co.id'
             ORDER BY employee_id" \
  > /tmp/qa_targets.tsv

echo "Jumlah target: $(wc -l < /tmp/qa_targets.tsv)"

# 4b. Set password temporer unik per karyawan + catat ke file rahasia
umask 077                                  # file baru = rw hanya untuk kamu
echo "employee_id,email,temp_password" > qa_temp_passwords.csv

while IFS=$'\t' read -r EMP EMAIL; do
  [ -z "$EMP" ] && continue
  # password acak 14 karakter alfanumerik (memenuhi min 8, di bawah 72 byte)
  PW="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)"
  echo ">> $EMP ($EMAIL)"
  ( cd backend && CDPS_DSN="$CDPS_DSN" go run ./cmd/setpass "$EMP" "$PW" ) \
    && echo "$EMP,$EMAIL,$PW" >> qa_temp_passwords.csv
done < /tmp/qa_targets.tsv

rm -f /tmp/qa_targets.tsv
echo "Selesai. Password temporer tersimpan di: qa_temp_passwords.csv (mode 600)"
```

Verifikasi (opsional) — pastikan kredensial ter-provision & flag ganti-password menyala:
```bash
mysql -h "$MYSQLHOST" -P "$MYSQLPORT" -u "$MYSQLUSER" -p"$MYSQLPASSWORD" "$MYSQLDATABASE" \
  -e "SELECT e.email, c.must_change_password, c.created_by, c.created_at
        FROM employee_credentials c
        JOIN employees e ON e.employee_id = c.employee_id
       ORDER BY c.created_at DESC LIMIT 20;"
```

---

## Langkah 5 — Distribusi & kebersihan (wajib)

1. **Bagikan password temporer 1-arah, per orang** (DM/email personal, password manager), **bukan** di grup. Karyawan wajib ganti saat login pertama — password ini sekali pakai.
2. Setelah semua karyawan konfirmasi bisa login, **hapus** file rahasia:
   ```bash
   shred -u qa_temp_passwords.csv   # atau: rm -P qa_temp_passwords.csv (macOS)
   ```
3. **Jangan commit** `qa_temp_passwords.csv` / `daftar_karyawan_aktif.tsv` ke git. (Tambahkan ke `.gitignore` bila perlu.)
4. **Jangan hardcode** credential Railway di skrip yang di-commit — selalu lewat env var.

---

## Catatan

- `setpass` sengaja mem-**bypass** layer otorisasi HTTP (untuk bootstrap Director pertama di deployment baru). Karena itu ia hanya butuh akses DB langsung — cocok untuk operasi massal QA ini.
- Alternatif non-massal (per satu orang, lewat aplikasi berjalan): `POST /api/v1/auth/admin/set-password` sebagai Director/Lead. Untuk seluruh karyawan sekaligus, jalur `setpass` di atas lebih praktis.
- Yohan (`yohanagustian@meagency.co.id`) **di-exclude** sesuai permintaan — akunnya tidak disentuh (password & sesi tetap seperti apa adanya).
