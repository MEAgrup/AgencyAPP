#!/usr/bin/env python3
# ============================================================================
# uat_creds.py — provisioning kredensial UAT bersama untuk walk lama (w2/w3/w120)
# ============================================================================
# !!! UAT / DEV-ONLY. DILARANG DIJALANKAN DI PRODUKSI. !!!
#
# Konteks: sejak auth lokal CDPS merged (DECISIONS 2026-07-19), login tidak lagi
# lewat HRIS. Kredensial hidup di tabel `employee_credentials` (migrasi
# 0037_local_auth) dan HARUS di-provision via `cmd/setpass` / admin set-password;
# password bersama lama `rahasia123` TIDAK lagi otomatis ada. Akibatnya walk lama
# yang login semua aktor dengan `rahasia123` kena 401 [akun belum diaktifkan...]
# (atau 403 gate force-change bila must_change_password=1).
#
# Modul ini menormalkan SELURUH roster `employees` ke satu kredensial UAT:
# password `rahasia123`, must_change_password=0, failed_attempts=0,
# locked_until=NULL — sehingga ke-43 aktor walk dapat login `rahasia123` TANPA
# kena gate force-change. Fungsi ini IDEMPOTEN dan aman dijalankan berulang.
#
# Preseden reset-state: `uat/auth_walk.py` (yang TRUNCATE employee_credentials +
# hapus sesi lama di awal run agar skenario "akun belum diaktifkan" valid tiap
# run). Modul ini adalah pendamping-nya untuk walk NON-auth: alih-alih meng-kosong-
# kan, ia MENGISI kredensial UAT bersama.
#
# Kenapa UPSERT SELURUH baris (bukan hanya yang belum ber-kredensial): stack UAT
# bekas sesi lain bisa punya kredensial tertinggal (mis. fixture Director dgn
# NewPass123, atau ARIF/KENNY hasil auth_walk dgn password non-rahasia123, atau
# UATCRE0001 dgn must_change_password=1). Aktor-aktor itu DIPAKAI walk dengan
# `rahasia123`, jadi baris yang sudah ada pun harus dinormalkan — kalau tidak,
# walk gagal login di aktor tersebut. UPSERT penuh mencapai tujuan sekaligus
# menyubsumsi langkah "UPDATE must_change_password=0 untuk baris hasil setpass".
#
# Tidak menyentuh kode produk. Dipanggil dari awal tiap walk (setelah cek healthz
# bila ada), SEBELUM login aktor mana pun.
# ============================================================================
import os
import subprocess
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../backend
MYSQL = ["mysql", "-ucdps", "-pcdps_dev", "-h127.0.0.1", "cdps"]
UAT_PASSWORD = "rahasia123"


def _mysql(args, sql):
    return subprocess.run(MYSQL + args + ["-e", sql],
                          capture_output=True, text=True, cwd=BACKEND_DIR)


def provision_uat_credentials(password=UAT_PASSWORD):
    """Idempoten: pastikan SEMUA employees bisa login `password` tanpa force-change.

    (a) minta SEKALI hash bcrypt valid via `go run ./cmd/setpass <emp> <password>`
        (setpass menulis must_change_password=1 — akan dinormalkan ke 0 di UPSERT);
    (b) SELECT hash tsb; (c) satu UPSERT ke seluruh roster employees.
    Mengembalikan jumlah baris employees yang di-cover.
    """
    # --- pilih satu employee_id untuk bootstrap hash lewat setpass ---
    r = _mysql(["-N"], "SELECT employee_id FROM employees ORDER BY employee_id LIMIT 1;")
    if r.returncode != 0 or not r.stdout.strip():
        print(f"[uat_creds] FATAL tak bisa baca roster employees: {r.stderr.strip() or r.stdout.strip()}",
              file=sys.stderr)
        sys.exit(2)
    seed_emp = r.stdout.strip().splitlines()[0].strip()

    # --- (a) hasilkan hash bcrypt valid via setpass (dev/UAT bootstrap) ---
    env = dict(os.environ)
    env.setdefault("CDPS_DSN",
                   "cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps?parseTime=true&multiStatements=true")
    sp = subprocess.run(["go", "run", "./cmd/setpass", seed_emp, password],
                        capture_output=True, text=True, cwd=BACKEND_DIR, env=env)
    if sp.returncode != 0:
        print(f"[uat_creds] FATAL setpass gagal: {sp.stderr.strip() or sp.stdout.strip()}",
              file=sys.stderr)
        sys.exit(2)

    # --- (b) baca hash yang baru ditulis setpass ---
    r = _mysql(["-N"], f"SELECT password_hash FROM employee_credentials WHERE employee_id='{seed_emp}';")
    if r.returncode != 0 or not r.stdout.strip():
        print(f"[uat_creds] FATAL tak bisa baca hash bootstrap: {r.stderr.strip() or r.stdout.strip()}",
              file=sys.stderr)
        sys.exit(2)
    phash = r.stdout.strip().splitlines()[0].strip()

    # --- (c) satu UPSERT UAT-only: normalkan SELURUH roster ke kredensial bersama ---
    # (INSERT ... SELECT dari employees; ON DUPLICATE KEY UPDATE menormalkan baris
    #  yang sudah ada — inilah yang membuat aktor fixture/auth_walk bisa rahasia123.)
    upsert = (
        "INSERT INTO employee_credentials "
        "(employee_id, password_hash, must_change_password, failed_attempts, locked_until, created_by) "
        f"SELECT e.employee_id, '{phash}', 0, 0, NULL, 'UAT-PROVISION' FROM employees e "
        "ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), "
        "must_change_password=0, failed_attempts=0, locked_until=NULL;"
    )
    r = _mysql([], upsert)
    if r.returncode != 0:
        print(f"[uat_creds] FATAL UPSERT kredensial gagal: {r.stderr.strip() or r.stdout.strip()}",
              file=sys.stderr)
        sys.exit(2)

    r = _mysql(["-N"], "SELECT COUNT(*) FROM employee_credentials;")
    n = r.stdout.strip().splitlines()[0].strip() if r.stdout.strip() else "?"
    print(f"[uat_creds] provisioning UAT selesai: {n} kredensial rahasia123 "
          f"(must_change_password=0), seed={seed_emp}")
    return n


if __name__ == "__main__":
    provision_uat_credentials()
