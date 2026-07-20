#!/usr/bin/env python3
# AUTH UAT walk — jalur auth lokal CDPS (docs/handoff/AUTH_UAT_RUNBOOK.md).
# CAKUPAN SMOKE INI: skenario A, B, C, D, G, H, J (langkah 1-11, 25-35, 39-41).
# Skenario E, F, I DI LUAR CAKUPAN — tidak dieksekusi, tidak ditandai.
#
# Pola identik uat/w3_walk.py: urllib + cookiejar per aktor, satu assertion =
# satu cek status/pesan-BI/field PERSIS seperti runbook/kode; penomoran step =
# penomoran runbook; ringkasan PASS/FAIL/SKIP di akhir; exit 0 hanya bila 0 FAIL.
# Body error dibaca dari field .message (BUKAN .error), sesuai auth_handlers.go.
#
# Repeatable (prasyarat runbook butir 2, dev/UAT-only): di awal run me-reset
# state UAT — TRUNCATE employee_credentials + hapus sesi lama — sehingga skenario
# A (akun belum diaktifkan) valid tiap run. Satu-satunya tulis DB lain yang
# diizinkan: simulasi pemulihan lock via UPDATE locked_until (butir 3) — DITANDAI
# di output. Verifikasi audit via SELECT read-only + API (butir 4).
#
# Jalankan dari folder backend/ :  python3 uat/auth_walk.py
import json, sys, os, subprocess, urllib.request, urllib.error, http.cookiejar

BASE = "http://127.0.0.1:8080/api/v1"
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../backend
MYSQL = ["mysql", "-ucdps", "-pcdps_dev", "-h127.0.0.1", "cdps"]

# ---- Aktor (roster ter-sync) ----
DIR_EMAIL,  DIR_ID  = "uat.director1@cdps.local", "UATDIR0001"   # Director (layered)
LEAD_EMAIL, LEAD_ID = "uat.creative1@cdps.local", "UATCRE0001"   # Creative Lead
ARIF_EMAIL, ARIF_ID = "marifnurrohman07@gmail.com", "2111040039" # Staff Creative (divisi sama dgn lead)
KENNY_EMAIL, KENNY_ID = "kannyagathon@gmail.com", "2206060100"   # Staff divisi lain (Ads)

# ---- Password fixtures ----
DIR_TEMP, DIR_NEW   = "TempPassword123", "NewPass123"
ARIF_T1, ARIF_T2, ARIF_FINAL = "ArifTemp123", "ArifTemp456", "ArifFinal123"
LEAD_T1, LEAD_T2    = "LeadTemp123", "LeadTemp456"
KENNY_TEMP, KENNY_NEW = "KennyTemp123", "KennyNew123"

# ---- BI strings PERSIS (disalin dari kode) ----
BI_NOT_PROVISIONED = "[akun belum diaktifkan, hubungi admin untuk pengaturan password awal]"
BI_INCOMPLETE      = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"
BI_INVALID_CRED    = "[email atau password salah]"
BI_LOCKED          = "[akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]"
BI_OLD_MISMATCH    = "[password lama tidak sesuai]"
BI_FORCE_CHANGE    = "[wajib mengganti password terlebih dahulu]"
BI_SESSION_INVALID = "[sesi tidak valid, silahkan login kembali]"
BI_ADMIN_FORBIDDEN = "[anda tidak memiliki akses untuk mengatur password karyawan ini]"
BI_SETPASS_MSG     = "password temporer di-set untuk %s (wajib ganti saat login pertama)"
BI_SETPASS_SHORT   = "setpass: password minimal 8 karakter"

results = []
notes = []  # penyimpangan/simulasi

# ============================================================================
# Helpers
# ============================================================================
def new_client():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj)), cj

def call(op, method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"})
    try:
        with op.open(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            raw = e.read()
            return e.code, (json.loads(raw) if raw else {})
        except Exception:
            return e.code, {}

def msg(b): return (b or {}).get("message", "")

def has_cookie(cj, name="cdps_session"):
    return any(c.name == name for c in cj)

def step(no, desc, ok, evidence):
    results.append((no, desc, bool(ok), evidence))
    print(f"{'PASS' if ok else 'FAIL'}  [{no}] {desc} :: {evidence}")

def skip(no, desc, reason):
    results.append((no, desc, None, reason))
    print(f"SKIP  [{no}] {desc} :: {reason}")

def mysql_exec(q):
    r = subprocess.run(MYSQL + ["-e", q], capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr

def sql_rows(q):
    r = subprocess.run(MYSQL + ["-N", "-e", q], capture_output=True, text=True)
    out = r.stdout.strip()
    if out == "":
        return []
    return [line.split("\t") for line in out.split("\n")]

def sql_scalar(q):
    rows = sql_rows(q)
    if not rows or not rows[0]:
        return None
    v = rows[0][0]
    return None if v == "NULL" else v

def setpass(emp, pw):
    r = subprocess.run(["go", "run", "./cmd/setpass", emp, pw],
                       cwd=BACKEND_DIR, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr

def login(email, pw):
    op, cj = new_client()
    st, b = call(op, "POST", "/auth/login", {"email": email, "password": pw})
    return op, cj, st, b

# JSON-string forbidden secret scan (after_json / API bodies must carry no secret)
SECRETS = [DIR_TEMP, DIR_NEW, ARIF_T1, ARIF_T2, ARIF_FINAL, LEAD_T1, LEAD_T2,
           KENNY_TEMP, KENNY_NEW]
def has_secret(s):
    low = s.lower()
    if "password_hash" in low or "$2a$" in s or "$2b$" in s or "$2y$" in s:
        return True
    if '"hash"' in low or "'hash'" in low:
        return True
    return any(p in s for p in SECRETS)

# ============================================================================
# Prasyarat sanity + RESET state UAT (butir 1)
# ============================================================================
try:
    with urllib.request.urlopen("http://127.0.0.1:8080/healthz") as r:
        assert r.status == 200
except Exception as e:
    print(f"FATAL: stack tidak hidup di :8080 ({e})"); sys.exit(2)

rc, so, se = mysql_exec(
    "SET FOREIGN_KEY_CHECKS=0; TRUNCATE employee_credentials; SET FOREIGN_KEY_CHECKS=1; DELETE FROM sessions;")
if rc != 0:
    print(f"FATAL: reset state gagal: {se}"); sys.exit(2)
creds0 = sql_scalar("SELECT COUNT(*) FROM employee_credentials")
sess0  = sql_scalar("SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL")
print(f"RESET  employee_credentials TRUNCATE (count={creds0}); sessions dihapus (aktif={sess0})")
notes.append("RESET awal run (dev/UAT-only, prasyarat runbook butir 2): TRUNCATE employee_credentials + DELETE FROM sessions.")

# ============================================================================
# A. Bootstrap kredensial — Director pertama (deployment segar) — langkah 1-3
# ============================================================================
# A.1 — creds kosong: login Director password apa pun -> 401 not-provisioned
op, cj, st, b = login(DIR_EMAIL, "apapunboleh")
step(1, "deployment segar (creds kosong): login Director -> 401 [akun belum diaktifkan, hubungi admin untuk pengaturan password awal]",
     st == 401 and msg(b) == BI_NOT_PROVISIONED, f"{st} {msg(b)!r}")

# A.2 — setpass CLI: password pendek ditolak tanpa nulis kredensial; password valid -> row + audit
rc_s, out_s, err_s = setpass(DIR_ID, "abc")
short_ok = rc_s != 0 and BI_SETPASS_SHORT in (err_s + out_s)
cred_after_short = sql_scalar(f"SELECT COUNT(*) FROM employee_credentials WHERE employee_id='{DIR_ID}'")
short_no_write = cred_after_short == "0"

rc_v, out_v, err_v = setpass(DIR_ID, DIR_TEMP)
valid_ok = rc_v == 0 and (BI_SETPASS_MSG % DIR_ID) in out_v
row = sql_rows(f"SELECT must_change_password, failed_attempts, locked_until FROM employee_credentials WHERE employee_id='{DIR_ID}'")
row_ok = bool(row) and row[0][0] == "1" and row[0][1] == "0" and row[0][2] == "NULL"
aj = sql_scalar(f"SELECT after_json FROM audit_log WHERE entity_id='{DIR_ID}' AND action='password_set_admin' AND actor_employee_id='CLI-BOOTSTRAP' ORDER BY id DESC LIMIT 1")
ajp = json.loads(aj) if aj else {}
et = sql_scalar(f"SELECT entity_type FROM audit_log WHERE entity_id='{DIR_ID}' AND action='password_set_admin' AND actor_employee_id='CLI-BOOTSTRAP' ORDER BY id DESC LIMIT 1")
audit_ok = (ajp == {"must_change_password": True, "via": "cli_bootstrap"}
            and et == "employee_credential" and not has_secret(aj or ""))
step(2, "setpass CLI: pw<8 -> exit err '"+BI_SETPASS_SHORT+"' tanpa nulis kredensial; pw valid -> row must_change=1/failed=0/locked=NULL + audit password_set_admin actor=CLI-BOOTSTRAP after_json={must_change_password:true,via:cli_bootstrap} (tanpa hash/password)",
     short_ok and short_no_write and valid_ok and row_ok and audit_ok,
     f"shortExit={short_ok} shortNoWrite={short_no_write} validOut={valid_ok} row={row_ok} audit={audit_ok} after_json={aj!r}")

# A.3 — Director login dgn password temporer -> 200 + must_change true
op, cj, st, b = login(DIR_EMAIL, DIR_TEMP)
step(3, "Director login password temporer -> 200 + must_change_password:true",
     st == 200 and b.get("must_change_password") is True, f"{st} must_change={b.get('must_change_password')}")

# ============================================================================
# B. Login password temporer -> force-change — langkah 4-5
# ============================================================================
# B.4 — login temp: body {employee, role, must_change_password:true} + cookie cdps_session
dir_gate, cj_gate, st, b = login(DIR_EMAIL, DIR_TEMP)
body_ok = (st == 200 and isinstance(b.get("employee"), dict)
           and b["employee"].get("employee_id") == DIR_ID
           and isinstance(b.get("role"), dict) and b.get("must_change_password") is True)
step(4, "login temp -> 200 body {employee, role, must_change_password:true}; cookie sesi cdps_session ter-set (atribut HttpOnly/TTL tidak di-assert terpisah di smoke ini — lihat auth_handlers.go)",
     body_ok and has_cookie(cj_gate),
     f"{st} emp={b.get('employee',{}).get('employee_id')} role={b.get('role',{}).get('director')} must={b.get('must_change_password')} cookie={has_cookie(cj_gate)}")

# B.5 — field kosong -> 400 [data tidak lengkap...] sebelum query DB
tmp, _ = new_client()
st1, b1 = call(tmp, "POST", "/auth/login", {})
st2, b2 = call(tmp, "POST", "/auth/login", {"email": DIR_EMAIL, "password": ""})
step(5, "login field kosong -> 400 [data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]",
     st1 == 400 and msg(b1) == BI_INCOMPLETE and st2 == 400 and msg(b2) == BI_INCOMPLETE,
     f"empty={st1}/{msg(b1)!r} noPass={st2}/{msg(b2)!r}")

# ============================================================================
# C. Gate force-change (403 + pengecualian) — langkah 6-7
# ============================================================================
# C.6 — route protected non-exempt -> 403 [wajib mengganti password terlebih dahulu]
st, b = call(dir_gate, "GET", "/notifications")
step(6, "gate: route protected non-exempt (GET /notifications) saat must_change=true -> 403 [wajib mengganti password terlebih dahulu]",
     st == 403 and msg(b) == BI_FORCE_CHANGE, f"{st} {msg(b)!r}")

# C.7 — empat pengecualian tetap lolos
st_me, b_me = call(dir_gate, "GET", "/auth/me")
me_ok = st_me == 200 and b_me.get("must_change_password") is True
st_legacy, _ = call(dir_gate, "GET", "/me")
legacy_ok = st_legacy == 200
# change-password TIDAK di-gate: body kosong -> 400 handler (BUKAN 403 gate), tanpa menaikkan counter
st_cp, b_cp = call(dir_gate, "POST", "/auth/change-password", {})
cp_not_gated = st_cp == 400 and msg(b_cp) == BI_INCOMPLETE
# logout pada sesi throwaway (agar tak membunuh dir_gate) -> 204
lo_op, _, _, _ = login(DIR_EMAIL, DIR_TEMP)
st_lo, _ = call(lo_op, "POST", "/auth/logout")
logout_ok = st_lo == 204
step(7, "pengecualian gate: GET /auth/me (200 must_change:true) + GET /me (200) + POST /auth/logout (204) + POST /auth/change-password TIDAK 403 (handler 400 [data tidak lengkap...])",
     me_ok and legacy_ok and cp_not_gated and logout_ok,
     f"me={me_ok} legacy={legacy_ok} cpNotGated={cp_not_gated}({st_cp}/{msg(b_cp)!r}) logout={logout_ok}({st_lo})")

# ============================================================================
# D. Ganti password — sukses, revoke sesi lain, password lama mati — langkah 8-11
# ============================================================================
# D.8 — dua sesi (A,B) login temp; sesi A change-password -> 204 + revoke sesi lain
dA, cjA, stA, _ = login(DIR_EMAIL, DIR_TEMP)
dB, cjB, stB, _ = login(DIR_EMAIL, DIR_TEMP)
st, b = call(dA, "POST", "/auth/change-password", {"old_password": DIR_TEMP, "new_password": DIR_NEW})
cp_ok = st == 204
row8 = sql_rows(f"SELECT must_change_password, failed_attempts, locked_until, password_changed_at FROM employee_credentials WHERE employee_id='{DIR_ID}'")
db_ok = bool(row8) and row8[0][0] == "0" and row8[0][1] == "0" and row8[0][2] == "NULL" and row8[0][3] != "NULL"
aj8 = sql_scalar(f"SELECT after_json FROM audit_log WHERE entity_id='{DIR_ID}' AND action='password_changed_self' AND actor_employee_id='{DIR_ID}' ORDER BY id DESC LIMIT 1")
aj8p = json.loads(aj8) if aj8 else None
audit8_ok = aj8p == {"must_change_password": False} and not has_secret(aj8 or "")
step(8, "sesi A change-password {old:temp,new} -> 204; DB must_change=0/failed=0/locked=NULL/password_changed_at set; audit password_changed_self after_json={must_change_password:false} (tanpa hash/password)",
     cp_ok and db_ok and audit8_ok,
     f"204={cp_ok} db={db_ok} audit={audit8_ok} after_json={aj8!r}")

# D.9 — sesi A: must_change false + route protected yang tadi 403 kini lolos
st_me9, b_me9 = call(dA, "GET", "/auth/me")
me9_ok = st_me9 == 200 and b_me9.get("must_change_password") is False
st_n9, _ = call(dA, "GET", "/notifications")
gate_cleared = st_n9 == 200
step(9, "sesi A pasca-ganti: GET /auth/me 200 must_change:false; GET /notifications kini 200 (bukan 403)",
     me9_ok and gate_cleared, f"me={me9_ok}(must={b_me9.get('must_change_password')}) notif200={gate_cleared}({st_n9})")

# D.10 — sesi B di-revoke -> 401
st_b10, b_b10 = call(dB, "GET", "/notifications")
step(10, "sesi B (device lain, tak ikut ganti) -> 401 [sesi tidak valid, silahkan login kembali]",
     st_b10 == 401 and msg(b_b10) == BI_SESSION_INVALID, f"{st_b10} {msg(b_b10)!r}")

# D.11 — login password LAMA -> 401 invalid; password BARU -> 200 must_change false
_, _, st_old, b_old = login(DIR_EMAIL, DIR_TEMP)
old_dead = st_old == 401 and msg(b_old) == BI_INVALID_CRED
dir_admin, cj_da, st_new, b_new = login(DIR_EMAIL, DIR_NEW)   # dir_admin dipakai utk admin/audit G-J
new_ok = st_new == 200 and b_new.get("must_change_password") is False
step(11, "login password LAMA (temp) -> 401 [email atau password salah]; login password BARU -> 200 must_change:false",
     old_dead and new_ok, f"old={st_old}/{msg(b_old)!r} new={st_new}/must={b_new.get('must_change_password')}")

# ---- E, F DI LUAR CAKUPAN SMOKE INI (tidak dieksekusi, tidak ditandai) ----

# ============================================================================
# G. Lockout via login — langkah 25-29
# ============================================================================
# Precondition: Director admin set-password ARIF (staff Creative)
st, _ = call(dir_admin, "POST", "/auth/admin/set-password", {"employee_id": ARIF_ID, "temp_password": ARIF_T1})
assert st == 204, f"precondition set-password ARIF gagal: {st}"

# G.25 — 4x login salah -> tiap 401 invalid; counter 1..4
counts = []
g25_ok = True
for i in range(4):
    st, b = login(ARIF_EMAIL, "wrongpass")[2:]
    fa = sql_scalar(f"SELECT failed_attempts FROM employee_credentials WHERE employee_id='{ARIF_ID}'")
    counts.append(fa)
    g25_ok = g25_ok and st == 401 and msg(b) == BI_INVALID_CRED and fa == str(i + 1)
step(25, "4x login salah -> tiap 401 [email atau password salah]; failed_attempts naik 1->2->3->4",
     g25_ok, f"counters={counts}")

# G.26 — percobaan ke-5 salah -> 401 invalid; DB: locked_until future, counter 0; audit account_locked{lock_minutes:15}
st, b = login(ARIF_EMAIL, "wrongpass")[2:]
resp5_ok = st == 401 and msg(b) == BI_INVALID_CRED
locked_fut = sql_scalar(f"SELECT locked_until IS NOT NULL AND locked_until > NOW() FROM employee_credentials WHERE employee_id='{ARIF_ID}'")
fa5 = sql_scalar(f"SELECT failed_attempts FROM employee_credentials WHERE employee_id='{ARIF_ID}'")
ajg = sql_scalar(f"SELECT after_json FROM audit_log WHERE entity_id='{ARIF_ID}' AND action='account_locked' ORDER BY id DESC LIMIT 1")
etg = sql_scalar(f"SELECT entity_type FROM audit_log WHERE entity_id='{ARIF_ID}' AND action='account_locked' ORDER BY id DESC LIMIT 1")
acg = sql_scalar(f"SELECT actor_employee_id FROM audit_log WHERE entity_id='{ARIF_ID}' AND action='account_locked' ORDER BY id DESC LIMIT 1")
g26_audit = (json.loads(ajg) if ajg else {}) == {"lock_minutes": 15} and etg == "employee_credential" and acg == ARIF_ID and not has_secret(ajg or "")
step(26, "percobaan ke-5 salah -> 401 [email atau password salah] (bukan 423); DB pasang locked_until=+15m & counter reset 0; audit account_locked entity=employee_credential actor=ARIF after_json={lock_minutes:15}",
     resp5_ok and locked_fut == "1" and fa5 == "0" and g26_audit,
     f"resp5={resp5_ok} lockedFuture={locked_fut} counter0={fa5=='0'} audit={g26_audit} after_json={ajg!r}")

# G.27 — percobaan ke-6 dgn password BENAR -> 423 locked
st, b = login(ARIF_EMAIL, ARIF_T1)[2:]
step(27, "percobaan ke-6 password BENAR saat terkunci -> 423 [akun terkunci sementara karena percobaan gagal berulang, coba lagi dalam 15 menit]",
     st == 423 and msg(b) == BI_LOCKED, f"{st} {msg(b)!r}")

# G.28 — pemulihan (a) tunggu 15m: DISIMULASIKAN via UPDATE locked_until ke masa lampau
mysql_exec(f"UPDATE employee_credentials SET locked_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE employee_id='{ARIF_ID}'")
notes.append("G.28 jalur-tunggu-15m DISIMULASIKAN via UPDATE locked_until=DATE_SUB(NOW(),INTERVAL 1 SECOND) (bukan menunggu riil).")
st, b = login(ARIF_EMAIL, ARIF_T1)[2:]
unlock_login_ok = st == 200
locked_after = sql_scalar(f"SELECT locked_until FROM employee_credentials WHERE employee_id='{ARIF_ID}'")
step(28, "pemulihan (a) tunggu 15m [DISIMULASIKAN via UPDATE locked_until]: login password benar -> 200; counter+lock ter-reset (locked_until=NULL)",
     unlock_login_ok and locked_after is None, f"login200={unlock_login_ok}({st}) lockedUntil={locked_after}")

# G.29 — pemulihan (b) reset admin: re-lock riil (5x salah) lalu Director set-password -> login temp baru langsung 200
for _ in range(5):
    login(ARIF_EMAIL, "wrongpass")
relocked = sql_scalar(f"SELECT locked_until IS NOT NULL AND locked_until > NOW() FROM employee_credentials WHERE employee_id='{ARIF_ID}'")
st_rst, _ = call(dir_admin, "POST", "/auth/admin/set-password", {"employee_id": ARIF_ID, "temp_password": ARIF_T2})
reset_ok = st_rst == 204
row29 = sql_rows(f"SELECT failed_attempts, locked_until FROM employee_credentials WHERE employee_id='{ARIF_ID}'")
reset_cleared = bool(row29) and row29[0][0] == "0" and row29[0][1] == "NULL"
arif_op, cj_arif, st_al, _ = login(ARIF_EMAIL, ARIF_T2)   # arif_op dipakai di H (sesi valid)
relogin_ok = st_al == 200
step(29, "pemulihan (b) reset admin: re-lock riil (5x salah) -> Director set-password (204) reset failed=0/locked=NULL -> login temp BARU langsung 200 tanpa menunggu",
     relocked == "1" and reset_ok and reset_cleared and relogin_ok,
     f"relocked={relocked} setpass204={reset_ok} cleared={reset_cleared} relogin200={relogin_ok}")

# ============================================================================
# H. Lockout via change-password (shared counter) — langkah 30-35
# ============================================================================
# Precondition: Director set-password Creative Lead + login (sesi valid; change-password exempt dari gate)
st, _ = call(dir_admin, "POST", "/auth/admin/set-password", {"employee_id": LEAD_ID, "temp_password": LEAD_T1})
assert st == 204, f"precondition set-password LEAD gagal: {st}"
lead_op, cj_lead, st_ll, _ = login(LEAD_EMAIL, LEAD_T1)
assert st_ll == 200, f"login LEAD gagal: {st_ll}"

# H.30 — 4x change-password old SALAH -> tiap 401 [password lama tidak sesuai]; counter 1..4
h_counts = []
h30_ok = True
for i in range(4):
    st, b = call(lead_op, "POST", "/auth/change-password", {"old_password": "wrongold", "new_password": "NewValid123"})
    fa = sql_scalar(f"SELECT failed_attempts FROM employee_credentials WHERE employee_id='{LEAD_ID}'")
    h_counts.append(fa)
    h30_ok = h30_ok and st == 401 and msg(b) == BI_OLD_MISMATCH and fa == str(i + 1)
step(30, "4x change-password old SALAH -> tiap 401 [password lama tidak sesuai]; failed_attempts (KOLOM SAMA dgn login) naik 1->2->3->4",
     h30_ok, f"counters={h_counts}")

# H.31 — ke-5 old salah -> 401 mismatch (bukan 423); DB lock + counter 0; audit account_locked
st, b = call(lead_op, "POST", "/auth/change-password", {"old_password": "wrongold", "new_password": "NewValid123"})
h31_resp = st == 401 and msg(b) == BI_OLD_MISMATCH
h31_lock = sql_scalar(f"SELECT locked_until IS NOT NULL AND locked_until > NOW() FROM employee_credentials WHERE employee_id='{LEAD_ID}'")
h31_cnt = sql_scalar(f"SELECT failed_attempts FROM employee_credentials WHERE employee_id='{LEAD_ID}'")
ajh = sql_scalar(f"SELECT after_json FROM audit_log WHERE entity_id='{LEAD_ID}' AND action='account_locked' ORDER BY id DESC LIMIT 1")
h31_audit = (json.loads(ajh) if ajh else {}) == {"lock_minutes": 15} and not has_secret(ajh or "")
step(31, "change-password ke-5 old salah -> 401 [password lama tidak sesuai] (bukan 423); DB pasang lock & counter 0; audit account_locked after_json={lock_minutes:15}",
     h31_resp and h31_lock == "1" and h31_cnt == "0" and h31_audit,
     f"resp={h31_resp} locked={h31_lock} counter0={h31_cnt=='0'} audit={h31_audit}")

# H.32 — ke-6 change-password old BENAR -> tetap 423 locked
st, b = call(lead_op, "POST", "/auth/change-password", {"old_password": LEAD_T1, "new_password": "NewValid123"})
step(32, "change-password ke-6 old BENAR saat terkunci -> 423 [akun terkunci...] (lock dicek sebelum bcrypt)",
     st == 423 and msg(b) == BI_LOCKED, f"{st} {msg(b)!r}")

# H.33 — cross-counter shared: 2x gagal login + 3x gagal change-password pada ARIF -> lock di ke-5
#   State ARIF (pasca G.29): password=ARIF_T2, counter 0, unlocked, sesi arif_op valid.
cross = []
for _ in range(2):
    login(ARIF_EMAIL, "wrongpass")
    cross.append(sql_scalar(f"SELECT failed_attempts FROM employee_credentials WHERE employee_id='{ARIF_ID}'"))
for _ in range(3):
    call(arif_op, "POST", "/auth/change-password", {"old_password": "wrongold", "new_password": "Whatever123"})
    cross.append(sql_scalar(f"SELECT failed_attempts FROM employee_credentials WHERE employee_id='{ARIF_ID}'"))
cross_locked = sql_scalar(f"SELECT locked_until IS NOT NULL AND locked_until > NOW() FROM employee_credentials WHERE employee_id='{ARIF_ID}'")
# progresi: login 1,2 lalu change-password 3,4, kemudian ke-5 memasang lock (counter reset 0)
prog_ok = cross[0] == "1" and cross[1] == "2" and cross[2] == "3" and cross[3] == "4" and cross[4] == "0"
step(33, "cross-counter shared: 2x gagal login + 3x gagal change-password (total 5 lintas 2 endpoint) -> lock terpasang di kegagalan ke-5 (counter=0 pasca-lock)",
     prog_ok and cross_locked == "1", f"progresi={cross} lockedPascaKe5={cross_locked}")

# H.34 — login password BENAR selama window -> 423 (enforcement shared)
st, b = login(ARIF_EMAIL, ARIF_T2)[2:]
step(34, "login password BENAR selama terkunci (lock dari jalur change-password) -> 423 [akun terkunci...] (lockout shared, bukan hanya counter)",
     st == 423 and msg(b) == BI_LOCKED, f"{st} {msg(b)!r}")

# H.35 — pemulihan: (sim tunggu) ARIF change-password lolos; (admin riil) Lead di-reset -> login 200
mysql_exec(f"UPDATE employee_credentials SET locked_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE employee_id='{ARIF_ID}'")
notes.append("H.35 jalur-tunggu-15m DISIMULASIKAN via UPDATE locked_until (ARIF); jalur reset-admin diuji riil (LEAD).")
st_cp35, _ = call(arif_op, "POST", "/auth/change-password", {"old_password": ARIF_T2, "new_password": ARIF_FINAL})
sim_ok = st_cp35 == 204
st_rl, _ = call(dir_admin, "POST", "/auth/admin/set-password", {"employee_id": LEAD_ID, "temp_password": LEAD_T2})
lead_cleared = sql_scalar(f"SELECT locked_until FROM employee_credentials WHERE employee_id='{LEAD_ID}'") is None
_, _, st_lead2, _ = login(LEAD_EMAIL, LEAD_T2)
admin_ok = st_rl == 204 and lead_cleared and st_lead2 == 200
step(35, "pemulihan §H: (a) tunggu 15m [DISIMULASIKAN] -> ARIF change-password 204; (b) reset admin riil -> Lead set-password(204)+locked NULL -> login temp baru 200",
     sim_ok and admin_ok, f"simChange204={sim_ok}({st_cp35}) adminReset={admin_ok}(setpass={st_rl} cleared={lead_cleared} login={st_lead2})")

# ---- I DI LUAR CAKUPAN SMOKE INI (tidak dieksekusi, tidak ditandai) ----

# ============================================================================
# J. Audit immutable + panel admin — langkah 39-41
# ============================================================================
# J.39 — telusuri audit A-H via API (Director); assert action/entity_type/actor + after_json tanpa secret
def audit_api(entity_id):
    st, b = call(dir_admin, "GET", f"/audit?entity_id={entity_id}")
    return st, (b.get("data") or [])

j39_ok = True
j39_detail = []
scan_clean = True
checks = [
    (DIR_ID,  {"password_set_admin", "password_changed_self"}),
    (ARIF_ID, {"password_set_admin", "account_locked"}),
    (LEAD_ID, {"password_set_admin", "account_locked"}),
]
for eid, want_actions in checks:
    st, entries = audit_api(eid)
    got_actions = {e.get("action") for e in entries}
    creds_entries = [e for e in entries if e.get("entity_type") == "employee_credential"]
    have = want_actions.issubset(got_actions)
    fields_ok = st == 200 and all(e.get("actor_employee_id") and e.get("action") and e.get("created_at") for e in creds_entries)
    for e in entries:
        if e.get("entity_type") == "employee_credential" and has_secret(json.dumps(e.get("after_json"))):
            scan_clean = False
    j39_ok = j39_ok and have and fields_ok
    j39_detail.append(f"{eid}:{sorted(got_actions & (want_actions|{'account_locked','password_changed_self','password_set_admin'}))}")
step(39, "audit A-H (Director read): password_set_admin (CLI-BOOTSTRAP + admin endpoint), password_changed_self, account_locked (login & change-password) hadir; entity_type=employee_credential, actor+action+timestamp tercatat; after_json TIDAK memuat hash/password",
     j39_ok and scan_clean, f"chains={j39_detail} secretClean={scan_clean}")

# J.40 — GET /auth/admin/credentials (Director): {"data":[...]} array non-null; tiap baris field cocok state DB
st, b = call(dir_admin, "GET", "/auth/admin/credentials")
data = b.get("data")
shape_ok = st == 200 and isinstance(data, list) and len(data) >= 1
rows_keys_ok = all(all(k in r for k in ("has_password", "must_change_password", "locked_until", "password_changed_at")) for r in (data or []))
by_id = {r["employee_id"]: r for r in (data or []) if "employee_id" in r}
match_ok = True
match_detail = []
for eid in (DIR_ID, ARIF_ID, LEAD_ID, KENNY_ID):
    r = by_id.get(eid)
    dbrow = sql_rows(
        "SELECT (c.password_hash IS NOT NULL), COALESCE(c.must_change_password,0), "
        "(c.locked_until IS NOT NULL), (c.password_changed_at IS NOT NULL) "
        f"FROM employees e LEFT JOIN employee_credentials c ON c.employee_id=e.employee_id WHERE e.employee_id='{eid}'")
    if not dbrow:
        continue
    db_has, db_must, db_lock, db_chg = dbrow[0]
    if r is None:
        # Director harus melihat semua; baris wajib ada
        match_ok = False; match_detail.append(f"{eid}:MISSING"); continue
    api_has = r["has_password"] is True
    api_must = r["must_change_password"] is True
    api_lock = r["locked_until"] is not None
    api_chg = r["password_changed_at"] is not None
    ok = (api_has == (db_has == "1") and api_must == (db_must == "1")
          and api_lock == (db_lock == "1") and api_chg == (db_chg == "1"))
    match_ok = match_ok and ok
    match_detail.append(f"{eid}:has{api_has}/{db_has} must{api_must}/{db_must} lock{api_lock}/{db_lock} chg{api_chg}/{db_chg}={'ok' if ok else 'MISMATCH'}")
step(40, "GET /auth/admin/credentials (Director): {\"data\":[...]} array non-null; tiap baris (has_password/must_change_password/locked_until/password_changed_at) COCOK state DB aktual pasca D/G/H",
     shape_ok and rows_keys_ok and match_ok,
     f"shape={shape_ok}(n={len(data) if isinstance(data,list) else data}) keys={rows_keys_ok} match={match_ok} :: {'; '.join(match_detail)}")

# J.41 — Staff biasa (KENNY) -> 403 [anda tidak memiliki akses untuk mengatur password karyawan ini]
# Setup: Director set-password KENNY -> login -> change-password (agar must_change=false, sehingga
# 403 yg muncul adalah 403 OTORISASI, bukan 403 gate force-change).
st, _ = call(dir_admin, "POST", "/auth/admin/set-password", {"employee_id": KENNY_ID, "temp_password": KENNY_TEMP})
assert st == 204, f"set-password KENNY gagal: {st}"
kenny_op, cj_k, st_kl, _ = login(KENNY_EMAIL, KENNY_TEMP)
assert st_kl == 200, f"login KENNY gagal: {st_kl}"
st_kc, _ = call(kenny_op, "POST", "/auth/change-password", {"old_password": KENNY_TEMP, "new_password": KENNY_NEW})
assert st_kc == 204, f"change-password KENNY gagal: {st_kc}"
st, b = call(kenny_op, "GET", "/auth/admin/credentials")
step(41, "Staff biasa (KENNY, must_change sudah false) GET /auth/admin/credentials -> 403 [anda tidak memiliki akses untuk mengatur password karyawan ini]",
     st == 403 and msg(b) == BI_ADMIN_FORBIDDEN, f"{st} {msg(b)!r}")

# ============================================================================
# Ringkasan
# ============================================================================
print()
fails = [r for r in results if r[2] is False]
skips = [r for r in results if r[2] is None]
passes = [r for r in results if r[2] is True]
# ringkasan per skenario
scen = {"A": (1, 3), "B": (4, 5), "C": (6, 7), "D": (8, 11), "G": (25, 29), "H": (30, 35), "J": (39, 41)}
def in_range(no, lo, hi):
    try: return lo <= int(no) <= hi
    except Exception: return False
print(f"TOTAL {len(results)} langkah — PASS {len(passes)}, FAIL {len(fails)}, SKIP {len(skips)}")
for name, (lo, hi) in scen.items():
    grp = [r for r in results if in_range(r[0], lo, hi)]
    p = sum(1 for r in grp if r[2] is True); f = sum(1 for r in grp if r[2] is False)
    print(f"  Skenario {name} (langkah {lo}-{hi}): PASS {p} FAIL {f} / {len(grp)}")
if fails:
    print("\nFAIL (produk atau skrip):")
    for r in fails:
        print(f"  FAIL [{r[0]}] {r[1]}\n        bukti: {r[3]}")
if notes:
    print("\nCatatan penyimpangan/simulasi:")
    for n in notes:
        print(f"  - {n}")
sys.exit(1 if fails else 0)
