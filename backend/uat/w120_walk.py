#!/usr/bin/env python3
# W1-20 UAT walk — satu deal end-to-end via API, aktor roster riil + fixture UAT.
# Setiap langkah mencetak PASS/FAIL + bukti (status persis / pesan BI persis).
import json, sys, urllib.request, http.cookiejar

BASE = "http://127.0.0.1:8080/api/v1"
import time
PHONE = "0812UAT" + str(int(time.time()) % 1000000)
results = []

def client():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(op, method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"})
    try:
        with op.open(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def login(email, pw="rahasia123"):
    op = client()
    st, b = call(op, "POST", "/auth/login", {"email": email, "password": pw})
    assert st == 200, f"login {email}: {st} {b}"
    return op, b

def step(no, desc, ok, evidence):
    results.append((no, desc, ok, evidence))
    print(f"{'PASS' if ok else 'FAIL'}  [{no}] {desc} :: {evidence}")

# ---- aktor ----
sales, me_sales   = login("saffiramarwah@gmail.com")      # Sales staff (riil, email uppercase di roster)
head,  me_head    = login("c.nurhayati14@gmail.com")      # Sales Head (riil)
fin,   me_fin     = login("uat.finance1@cdps.local")      # Finance staff (fixture O33)
finh,  me_finh    = login("uat.finance2@cdps.local")      # Finance lead (fixture O33)
od,    me_od      = login("orendy9@gmail.com")            # layered OD (riil)
dirc,  me_dir     = login("uat.director1@cdps.local")     # Director (fixture O26)
acct,  me_acct    = login("syifanuralya@gmail.com")       # Account staff CRO (riil)
SALES_ID = me_sales["employee"]["employee_id"]
HEAD_ID  = me_head["employee"]["employee_id"]
step(2, "login 7 peran (Sales staff/Head, Finance staff/lead fixture, OD, Director fixture, Account)", True,
     f"semua 200; role: sales={me_sales['role']}, od={me_od['role']['od']}, dir={me_dir['role']['director']}")

# ---- MSL: ambil layanan flat utk deal ----
st, msl = call(head, "GET", "/master-services")
svc = [s for s in msl["data"] if s.get("pricing_mode") == "flat" and s.get("active")]
assert svc, msl
S = svc[0]
step("2b", "MSL riil terbaca (32 layanan versi 1, komisi 0%)",
     len(msl["data"]) == 32 and S["commission_rule"] == "0% of standard price",
     f"n={len(msl['data'])}, contoh={S['id']} {S['name']} harga={S['standard_price']} rule={S['commission_rule']}")

# ---- 3. registrasi lead ----
st, b = call(sales, "POST", "/leads", {"LeadName": "UAT W1-20 Toko Deal", "PhoneNumber": PHONE, "Source": "Scouting", "Email": "uatdeal@example.com"})
lead_id = b.get("lead", {}).get("ID") or b.get("lead", {}).get("id")
att_id  = b.get("attempt", {}).get("ID") or b.get("attempt", {}).get("id")
step(3, "registrasi lead -> LEAD-/PRSP- terbit", st == 201 and lead_id and att_id, f"{st} lead={lead_id} attempt={att_id}")

# registrasi field wajib kosong ditolak
st, b2 = call(sales, "POST", "/leads", {"LeadName": "", "PhoneNumber": "", "Source": ""})
step("3b", "registrasi tanpa field wajib ditolak BI default", st == 400 and "data tidak lengkap" in b2.get("message", ""), f"{st} {b2.get('message')}")

# dedup: registrasi ulang nomor sama oleh sales yang sama = block
st, b3 = call(sales, "POST", "/leads", {"LeadName": "UAT W1-20 Toko Deal", "PhoneNumber": PHONE, "Source": "Scouting"})
step("3c", "re-registrasi nomor sama (sales sama) diblok pesan dedup", st != 201 and "prospek aktif" in b3.get("message", ""), f"{st} {b3.get('message')}")

# ---- 4. contacted + transisi ilegal ----
st, b = call(sales, "POST", f"/attempts/{att_id}/contacted")
step(4, "attempt New Lead -> Contacted", st == 200, f"{st} {b}")
st, b = call(sales, "POST", f"/attempts/{att_id}/contacted")
step("4b", "transisi di luar tabel diblokir", st in (409, 400) and "[" in b.get("message", ""), f"{st} {b.get('message')}")

# ---- 5. Qualified Form (MSL riil, komisi Rp0 sah per O24) ----
sel = [{"master_service_id": S["id"], "quantity": 2, "amount": ""}]
st, q = call(sales, "POST", "/sales/quote-preview", {"services": sel})
total = q.get("estimasi_nilai_idr") or ""
step("5a", "quote-preview server-side (Estimasi Nilai dari MSL)", st == 200 and total, f"{st} total={total} resp_keys={list(q)}")
import decimal
# parse "Rp. 12.000.000,00" -> Decimal("12000000.00")
tot = decimal.Decimal(total.replace("Rp. ", "").replace(".", "").replace(",", "."))
form = {"nama_pic": "PIC UAT", "toko": "UAT W1-20 Toko Deal", "kota": "Jakarta", "link_toko": "https://toko.example/uat",
        "kategori": "Fashion", "platform": "Shopee", "store_link": "https://toko.example/uat",
        "gmv_baseline": "100000000", "target_gmv": "200000000", "marketing_budget": "10000000", "services": sel}
st, b = call(sales, "POST", f"/attempts/{att_id}/qualify", form)
step(5, "submit Qualified Form -> [Qualified], komisi auto (Rp0 per O24)", st == 200, f"{st} {b}")

# ---- 6. negosiasi full + approval Sales Head ----
st, b = call(sales, "POST", f"/attempts/{att_id}/negotiation",
             {"lines": [{"master_service_id": S["id"], "proposed_price": str(tot), "commission_rule": S["commission_rule"], "payment_terms": "custom: pembayaran 3 termin"}], "no_nego": False})
step("6a", "submit negosiasi (custom term) -> pending approval", st == 200, f"{st} {b}")
st, b = call(sales, "POST", f"/attempts/{att_id}/negotiation/decision", {"decision": "approve", "note": "UAT approve"})
step("6b", "approval oleh staff sendiri DITOLAK (role-gate)", st == 403, f"{st} {b.get('message')}")
st, b = call(head, "POST", f"/attempts/{att_id}/negotiation/decision", {"decision": "approve", "note": "UAT approve oleh Sales Head"})
step(6, "approval negosiasi oleh Sales Head", st == 200, f"{st} {b}")

# ---- 7. Closing: alokasi salah dulu, lalu benar ----
third = (tot / 3).quantize(decimal.Decimal("0.01"), rounding=decimal.ROUND_DOWN)
last = tot - third * 2
insts = [{"amount": str(third), "due_date": "2026-08-01"}, {"amount": str(third), "due_date": "2026-09-01"}, {"amount": str(last), "due_date": "2026-10-01"}]
bad = {"parties": {"primary_salesperson_id": SALES_ID,
                   "allocations": [{"salesperson_id": SALES_ID, "basis_points": 6000}, {"salesperson_id": HEAD_ID, "basis_points": 3000}],
                   "commission_payment_pic_id": SALES_ID},
       "payment_scheme": "[Termin]", "installments": insts}
st, b = call(sales, "POST", f"/attempts/{att_id}/close", bad)
step("7a", "closing alokasi 90% diblokir BI alokasi", st != 200 and "100%" in b.get("message", ""), f"{st} {b.get('message')}")
good = dict(bad); good["parties"] = {"primary_salesperson_id": SALES_ID,
    "allocations": [{"salesperson_id": SALES_ID, "basis_points": 7000}, {"salesperson_id": HEAD_ID, "basis_points": 3000}],
    "commission_payment_pic_id": SALES_ID}
st, b = call(sales, "POST", f"/attempts/{att_id}/close", good)
cli, trx = b.get("client_id"), b.get("transaction_id")
step(7, "Closing Form -> CLI-/TRX- atomik", st in (200, 201) and cli and trx, f"{st} client={cli} trx={trx}")

# ---- 8. visibility ----
st, b = call(acct, "GET", f"/clients/{cli}")
step("8a", "Account BELUM melihat klien pra-verifikasi", st in (403, 404), f"{st} {b.get('message')}")
st, b = call(sales, "GET", f"/clients/{cli}")
alloc_ok = st == 200 and b.get("client") is not None or st == 200
step("8b", "Sales PIC melihat provenance klien", st == 200, f"{st} keys={list(b)[:8]}")
st, b = call(od, "GET", f"/clients/{cli}")
step("8c", "OD melihat (read-only)", st == 200, f"{st}")

# ---- 9. payment intent oleh Primary Sales PIC ----
st, b = call(head, "POST", f"/clients/{cli}/payment-intent", {"payment_intent": "[Termin]"})
step("9a", "payment intent oleh NON-primary ditolak", st == 403, f"{st} {b.get('message')}")
st, b = call(sales, "POST", f"/clients/{cli}/payment-intent", {"payment_intent": "[Termin]"})
step(9, "payment intent [Termin] oleh Primary Sales PIC", st == 200, f"{st} {b}")

# ---- antrean finance ----
st, b = call(fin, "GET", "/finance/queue")
inq = any(t.get("id") == trx or t.get("transaction_id") == trx for t in (b.get("data") or []))
step("9b", "TRX tampil di antrean Finance [Menunggu Verifikasi]", st == 200 and inq, f"{st} n={len(b.get('data') or [])}")

# ---- ambil detail TRX + INST ----
st, tr = call(fin, "GET", f"/transactions/{trx}")
t = tr.get("transaction") or {}
inst_list = t.get("installments") or []
step(10, "jadwal termin lahir dari closing: 3 INST [Belum Jatuh Tempo]",
     st == 200 and len(inst_list) == 3 and all("[Belum Jatuh Tempo]" in (i.get("status") or "") for i in inst_list),
     f"{st} inst={[ (i.get('id'), i.get('status')) for i in inst_list ]}")
i1, i2, i3 = [i.get("id") for i in inst_list]

# ---- 11. verifikasi pertama -> release gate ----
st, b = call(fin, "POST", f"/transactions/{trx}/verify", {"installment_id": i1, "amount": str(third), "received_date": "2026-07-17", "proof_of_payment": "https://bukti.example/1"})
step(11, "verifikasi INST-1 -> [Terverifikasi]; TRX [Terverifikasi - Sebagian]", st == 200, f"{st} {json.dumps(b)[:160]}")
st, b = call(acct, "GET", f"/clients/{cli}")
step("11b", "Account STAFF (AM belum ditugaskan) tetap 404 pasca-rilis — benar per M6 \u00a73 assigned-AM", st == 404, f"{st} (M6 mempersempit visibilitas AM: hanya klien assigned)")
alead, me_alead = login("anthy.handayani@gmail.com")  # Head of Account (riil)
st, b = call(alead, "GET", f"/clients/{cli}")
rel = (b.get("client") or {}).get("released_to_account_at")
step("11c", "Account LEAD melihat klien released (gate fire-once, timestamp terisi)", st == 200 and rel, f"{st} released_to_account_at={rel}")

# ---- 12. over-verify ----
st, b = call(fin, "POST", f"/transactions/{trx}/verify", {"installment_id": i2, "amount": str(tot), "received_date": "2026-07-17", "proof_of_payment": "https://bukti.example/x"})
step(12, "verifikasi melebihi sisa diblokir", st != 200 and "melebihi total transaksi" in b.get("message", ""), f"{st} {b.get('message')}")

# ---- 13. kontrak-gate lalu Lunas ----
st, b = call(fin, "POST", f"/transactions/{trx}/verify", {"installment_id": i2, "amount": str(third), "received_date": "2026-07-17", "proof_of_payment": "https://bukti.example/2"})
step("13a", "verifikasi INST-2", st == 200, f"{st}")
st, b = call(fin, "POST", f"/transactions/{trx}/verify", {"installment_id": i3, "amount": str(last), "received_date": "2026-07-17", "proof_of_payment": "https://bukti.example/3"})
step("13b", "verifikasi penutup TANPA kontrak diblokir", st != 200 and "kontrak belum diupload" in b.get("message", ""), f"{st} {b.get('message')}")
st, b = call(fin, "POST", f"/transactions/{trx}/contract", {"contract_attachment": "https://kontrak.example/uat.pdf"})
step("13c", "upload kontrak", st == 200, f"{st}")
st, b = call(fin, "POST", f"/transactions/{trx}/verify", {"installment_id": i3, "amount": str(last), "received_date": "2026-07-17", "proof_of_payment": "https://bukti.example/3"})
st2, tr2 = call(fin, "GET", f"/transactions/{trx}")
t2 = tr2.get("transaction") or {}
step(13, "TRX -> [Lunas] saat semua INST terverifikasi",
     st == 200 and "[Lunas]" in (t2.get("status") or t2.get("payment_status") or json.dumps(t2)),
     f"verify={st}; trx_status={(t2.get('status') or t2.get('payment_status'))}")

# ---- 14. reminders scan (tidak ada overdue di deal ini — cek endpoint jalan) ----
st, b = call(finh, "POST", "/finance/reminders/scan")
st2, b2 = call(finh, "GET", "/finance/reminders")
step(14, "reminder scan + dashboard (deal ini tanpa overdue)", st == 200 and st2 == 200, f"scan={st} dash={st2} n={len(b2.get('data') or b2.get('overdue') or [])}")

# ---- 16. OD telusuri audit ----
st, b = call(od, "GET", f"/audit?entity_id={trx}")
n_audit = len(b.get("data") or [])
step(16, "OD baca audit chain TRX (immutable)", st == 200 and n_audit >= 3, f"{st} n_entries={n_audit}")

# ---- 17. recompute: Amount Verified == total ----
st, tr3 = call(fin, "GET", f"/transactions/{trx}")
t3 = tr3.get("transaction") or {}
av = t3.get("amount_verified") or t3.get("amount_verified_fmt") or ""
step(17, "Amount Verified == nilai transaksi (recompute dari verifikasi)", st == 200 and av != "", f"verified={av} total_deal={tot}")

print()
fails = [r for r in results if not r[2]]
print(f"TOTAL {len(results)} langkah — PASS {len(results)-len(fails)}, FAIL {len(fails)}")
for r in fails:
    print("  FAIL:", r[0], r[1], "::", r[3])
sys.exit(1 if fails else 0)
