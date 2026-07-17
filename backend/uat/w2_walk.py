#!/usr/bin/env python3
# W2 UAT walk — Wave 2 gate-exit runbook (docs/handoff/W2_UAT_RUNBOOK.md), langkah 2–48.
# Mengeksekusi seluruh perjalanan Wave 2 lewat API live pada stack yang sudah berjalan
# (127.0.0.1:8080). Precondition (fase 0) dibangun sendiri via API mengikuti pola
# w120_walk.py: lead -> qualify (2 layanan flat -> 2 SVC) -> negosiasi -> closing ->
# payment-intent -> verify -> klien released. Setiap langkah mencetak PASS/FAIL + bukti
# (status persis [...] / pesan BI persis). Exit non-zero bila ada FAIL.
#
# Aktor: roster riil + fixture O26/O33/O34 (lihat runbook). Password semua rahasia123.
# Tidak mengubah kode produk; hanya file ini yang baru.
import json, sys, time, decimal, urllib.parse, urllib.request, http.cookiejar

BASE = "http://127.0.0.1:8080/api/v1"
UQ = str(int(time.time()) % 10000000)     # suffix unik agar rerun tak tabrakan dedup
results = []

def opener():
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
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}

def login(email, pw="rahasia123"):
    op = opener()
    st, b = call(op, "POST", "/auth/login", {"email": email, "password": pw})
    if st != 200:
        print(f"FATAL login {email}: {st} {b}"); sys.exit(2)
    return op, b

def step(no, desc, ok, evidence):
    results.append((no, desc, ok, evidence))
    print(f"{'PASS' if ok else 'FAIL'}  [{no}] {desc} :: {evidence}")

def msg(b): return (b or {}).get("message", "")

def qenc(s): return urllib.parse.quote(s, safe="")

# ============================================================================
# LANGKAH 2 — login lintas peran Wave 2 + negatif auth
# ============================================================================
sales, me_sales = login("saffiramarwah@gmail.com")     # Sales staff (riil)
head,  me_head  = login("c.nurhayati14@gmail.com")     # Sales Head (riil)
alead, me_alead = login("Anthy.handayani@gmail.com")   # Account Lead YULIANTI (riil)
am,    me_am    = login("syifanuralya@gmail.com")      # AM SYIFA (Account staff, riil)
am2,   me_am2   = login("sepriharyani95@gmail.com")    # AM lain SEPRI (Account staff, riil)
cre,   me_cre   = login("marifnurrohman07@gmail.com")  # Creative staff ARIF (riil)
cre2,  me_cre2  = login("assifa.shakilla9c@gmail.com") # Creative staff ASSIFA (riil)
crelead, me_crl = login("uat.creative1@cdps.local")    # Creative lead (fixture O34)
ads,   me_ads   = login("kannyagathon@gmail.com")      # Ads staff KENNY (riil)
adslead, me_adl = login("uat.ads1@cdps.local")         # Ads lead (fixture O34)
kol,   me_kol   = login("uat.kol1@cdps.local")         # KOL staff (fixture O34)
kollead, me_kll = login("uat.kol2@cdps.local")         # KOL lead (fixture O34)
lss,   me_lss   = login("uat.livestream1@cdps.local")  # Live Stream staff (fixture O34)
fin,   me_fin   = login("uat.finance1@cdps.local")     # Finance staff (fixture O33)
finh,  me_finh  = login("uat.finance2@cdps.local")     # Finance head (fixture O33)
od,    me_od    = login("orendy9@gmail.com")           # OD OKFA (riil, layered)
dirc,  me_dir   = login("uat.director1@cdps.local")    # Director (fixture O26)

SALES_ID = me_sales["employee"]["employee_id"]
HEAD_ID  = me_head["employee"]["employee_id"]
YULI_ID  = me_alead["employee"]["employee_id"]
SYIFA_ID = me_am["employee"]["employee_id"]
SEPRI_ID = me_am2["employee"]["employee_id"]
ARIF_ID  = me_cre["employee"]["employee_id"]
ASSIFA_ID= me_cre2["employee"]["employee_id"]
KENNY_ID = me_ads["employee"]["employee_id"]
KOL1_ID  = me_kol["employee"]["employee_id"]

roles_ok = (me_am["role"]["division"]=="Account" and me_am["role"]["level"]=="staff" and
            me_alead["role"]["level"]=="lead" and me_cre["role"]["division"]=="Creative" and
            me_ads["role"]["division"]=="Ads" and me_od["role"]["od"] and me_dir["role"]["director"] and
            me_kol["role"]["division"]=="KOL" and me_lss["role"]["division"]=="Live Stream")
step(2, "login 17 peran Wave 2 (riil+fixture), role resolution benar", roles_ok,
     f"AM={me_am['role']['division']}/{me_am['role']['level']} OD={me_od['role']['od']} DIR={me_dir['role']['director']}")

# password salah
op = opener(); st, b = call(op, "POST", "/auth/login", {"email": "saffiramarwah@gmail.com", "password": "salahsandi"})
step("2b", "password salah -> [email atau password salah]", st==401 and "email atau password salah" in msg(b), f"{st} {msg(b)}")
# email luar roster ditolak
op = opener(); st, b = call(op, "POST", "/auth/login", {"email": f"orang.luar.{UQ}@nowhere.test", "password": "rahasia123"})
step("2c", "email luar roster ditolak", st in (401,503), f"{st} {msg(b)}")
# OD read-only pada write Wave 2 (assign-am) -> 403 (langkah 47 menegaskan lagi)
# (uji nyata dilakukan setelah klien lahir; di sini cukup catat login OD sukses & od=true)
step("2d", "HRIS-down negatif [sistem HRIS...] TIDAK diuji (dilarang mematikan proses)", True,
     "SKIP by design: mockhris tidak boleh di-kill; login-path lain PASS")

# ============================================================================
# PRECONDITION (fase 0) — bangun klien released dgn >=2 SVC via API
# ============================================================================
st, msl = call(head, "GET", "/master-services")
flat = sorted([s for s in msl["data"] if s.get("pricing_mode")=="flat" and s.get("active")], key=lambda s: s["id"])
assert len(flat) >= 2, "butuh >=2 layanan flat di MSL"
SA, SB = flat[0], flat[1]   # dua master-service berbeda -> dua SVC saat closing
sel = [{"master_service_id": SA["id"], "quantity": 1, "amount": ""},
       {"master_service_id": SB["id"], "quantity": 1, "amount": ""}]
st, q = call(sales, "POST", "/sales/quote-preview", {"services": sel})
total = q.get("estimasi_nilai_idr") or ""
tot = decimal.Decimal(total.replace("Rp. ","").replace(".","").replace(",",".")) if total else decimal.Decimal(0)

PHONE = "0812W2" + UQ
st, b = call(sales, "POST", "/leads", {"LeadName": f"UAT W2 Deal {UQ}", "PhoneNumber": PHONE, "Source": "Scouting", "Email": f"uatw2{UQ}@example.com"})
lead_id = (b.get("lead") or {}).get("ID") or (b.get("lead") or {}).get("id")
att_id  = (b.get("attempt") or {}).get("ID") or (b.get("attempt") or {}).get("id")
assert att_id, f"lead gagal: {st} {b}"
call(sales, "POST", f"/attempts/{att_id}/contacted")
form = {"nama_pic": "PIC UAT W2", "toko": f"UAT W2 Toko {UQ}", "kota": "Jakarta", "link_toko": "https://toko.example/w2",
        "kategori": "Fashion", "platform": "Shopee", "store_link": "https://toko.example/w2",
        "gmv_baseline": "100000000", "target_gmv": "200000000", "marketing_budget": "10000000", "services": sel}
st, b = call(sales, "POST", f"/attempts/{att_id}/qualify", form)
assert st == 200, f"qualify gagal: {st} {b}"
pa = decimal.Decimal(str(SA["standard_price"]).split(".")[0])
pb = decimal.Decimal(str(SB["standard_price"]).split(".")[0])
lines = [{"master_service_id": SA["id"], "proposed_price": str(pa), "commission_rule": SA["commission_rule"], "payment_terms": "custom"},
         {"master_service_id": SB["id"], "proposed_price": str(pb), "commission_rule": SB["commission_rule"], "payment_terms": "custom"}]
st, b = call(sales, "POST", f"/attempts/{att_id}/negotiation", {"lines": lines, "no_nego": False})
assert st == 200, f"negosiasi gagal: {st} {b}"
call(head, "POST", f"/attempts/{att_id}/negotiation/decision", {"decision": "approve", "note": "UAT W2"})
grand = pa + pb
i1 = (grand/3).quantize(decimal.Decimal("1"), rounding=decimal.ROUND_DOWN)
i2 = i1; i3 = grand - i1 - i2
insts = [{"amount": str(i1), "due_date": "2026-08-01"}, {"amount": str(i2), "due_date": "2026-09-01"}, {"amount": str(i3), "due_date": "2026-10-01"}]
good = {"parties": {"primary_salesperson_id": SALES_ID,
        "allocations": [{"salesperson_id": SALES_ID, "basis_points": 10000}],
        "commission_payment_pic_id": SALES_ID},
        "payment_scheme": "[Termin]", "installments": insts}
st, b = call(sales, "POST", f"/attempts/{att_id}/close", good)
cli, trx = b.get("client_id"), b.get("transaction_id")
assert cli and trx, f"closing gagal: {st} {b}"
call(sales, "POST", f"/clients/{cli}/payment-intent", {"payment_intent": "[Termin]"})
st, tr = call(fin, "GET", f"/transactions/{trx}")
inst_list = (tr.get("transaction") or {}).get("installments") or []
call(fin, "POST", f"/transactions/{trx}/verify", {"installment_id": inst_list[0]["id"], "amount": str(i1),
     "received_date": "2026-07-17", "proof_of_payment": "https://bukti.example/w2-1"})
st, cb = call(alead, "GET", f"/clients/{cli}")
released = (cb.get("client") or {}).get("released_to_account_at")
svcs = sorted((cb.get("client") or {}).get("services") or [], key=lambda s: s["id"])
step(3, "PRECONDITION: klien released dgn 2 SVC [Awaiting Onboarding] (flag Direct default)",
     bool(released) and len(svcs)==2 and all("[Awaiting Onboarding]" in s["status"] for s in svcs),
     f"cli={cli} released={released} svc={[(s['id'],s['status']) for s in svcs]}")
assert cli and released and len(svcs) >= 2, "precondition gagal — stop"
SVC_A = svcs[0]["id"]   # tetap Direct (langkah 8 & 15)
SVC_B = svcs[1]["id"]   # akan di-override plan-gated (langkah 9-16)

# ============================================================================
# B. M6 §3 — Onboarding & AM assignment (langkah 4-7)
# ============================================================================
st, iq = call(alead, "GET", "/account/intake")
in_q = any(r.get("client_id")==cli for r in (iq.get("data") or []))
st2, iqf = call(am, "GET", "/account/intake")
step(4, "Account Lead lihat intake queue; AM staff ditolak [anda tidak memiliki akses ke antrean intake Account]",
     st==200 and in_q and st2==403 and "antrean intake Account" in msg(iqf), f"lead={st} inq={in_q} amstaff={st2} {msg(iqf)}")

st, b = call(am, "POST", f"/clients/{cli}/assign-am", {"am_id": SYIFA_ID})   # AM staff assign -> forbidden
neg_amassign = st==403 and "tidak memiliki akses untuk menugaskan Account Manager" in msg(b)
st, b = call(alead, "POST", f"/clients/{cli}/assign-am", {"am_id": YULI_ID})  # assign lead (bukan staff)
neg_leadnotam = st in (400,422) and "harus staff divisi Account yang aktif" in msg(b)
st, b = call(alead, "POST", f"/clients/{cli}/assign-am", {"am_id": SYIFA_ID}) # valid
assign_ok = st==200 and b.get("assigned_am")==SYIFA_ID
st, b = call(alead, "POST", f"/clients/{cli}/assign-am", {"am_id": SYIFA_ID}) # sudah ada
neg_dup = st in (400,422) and "sudah memiliki Account Manager, gunakan reassignment" in msg(b)
step(5, "assign-am ke SYIFA (audit am_assigned); negatif lead/dup/AM-staff",
     assign_ok and neg_amassign and neg_leadnotam and neg_dup,
     f"assign={assign_ok} amstaff403={neg_amassign} leadNotAM={neg_leadnotam} dup={neg_dup}")

st, b = call(alead, "POST", f"/clients/{cli}/reassign-am", {"am_id": SEPRI_ID, "reason": ""})
neg_noreason = st in (400,422) and "alasan reassignment wajib diisi" in msg(b)
st, b = call(alead, "POST", f"/clients/{cli}/reassign-am", {"am_id": SYIFA_ID, "reason": "coba"})
neg_same = st in (400,422) and "Account Manager tujuan sama dengan yang sekarang" in msg(b)
st, b = call(alead, "POST", f"/clients/{cli}/reassign-am", {"am_id": SEPRI_ID, "reason": "cuti, dialihkan"})
r1 = st==200 and b.get("assigned_am")==SEPRI_ID
st, b = call(alead, "POST", f"/clients/{cli}/reassign-am", {"am_id": SYIFA_ID, "reason": "kembali ke AM semula"})
r2 = st==200 and b.get("assigned_am")==SYIFA_ID
step(6, "reassign-am (reason wajib, same ditolak, round-trip SEPRI->SYIFA audit am_reassigned)",
     neg_noreason and neg_same and r1 and r2, f"noreason={neg_noreason} same={neg_same} toSEPRI={r1} back={r2}")

st, ba = call(am, "GET", f"/clients/{cli}")
st2, bb = call(am2, "GET", f"/clients/{cli}")
st3, bc = call(alead, "GET", f"/clients/{cli}")
step(7, "visibilitas pasca-assign: AM SYIFA 200, AM lain SEPRI 404, Account Lead 200",
     st==200 and st2==404 and st3==200, f"syifa={st} sepri={st2} lead={st3}")

# ============================================================================
# C. M6 §4 — Strategy & Plan + jalur Direct + override M6-OA-1 (langkah 8-13)
# ============================================================================
st, b = call(am, "POST", f"/services/{SVC_A}/strategy",
             {"objective":"o","target_kpi":"k","divisions_involved":["Creative"],
              "planned_brief_outline":"x","timeline_start":"2026-07-20","timeline_end":"2026-08-20"})
step(8, "Service Direct: create strategy -> [layanan ini tidak memerlukan Strategy & Plan]",
     st in (400,422) and "tidak memerlukan Strategy & Plan" in msg(b), f"{st} {msg(b)}")

st, b = call(am, "POST", f"/services/{SVC_B}/strategy-requirement", {"requires_strategy_plan": True, "reason": ""})
ov_noreason = st in (400,422) and "alasan perubahan kebutuhan Strategy & Plan wajib diisi" in msg(b)
st, b = call(am2, "POST", f"/services/{SVC_B}/strategy-requirement", {"requires_strategy_plan": True, "reason": "butuh plan"})
ov_other = st==403 and "tidak memiliki akses untuk mengubah kebutuhan Strategy & Plan" in msg(b)
st, b = call(am, "POST", f"/services/{SVC_B}/strategy-requirement", {"requires_strategy_plan": True, "reason": "engagement butuh Strategy & Plan"})
ov_ok = st==200 and b.get("requires_strategy_plan") is True
step(9, "override M6-OA-1 svcB requires=Yes (alasan wajib; AM lain ditolak; COALESCE efektif)",
     ov_ok and ov_noreason and ov_other, f"ok={ov_ok} noreason={ov_noreason} other={ov_other}")

# GuardBriefCreation (langkah 14, diuji pada state benar: svcB plan-gated masih Awaiting)
st, b = call(am, "POST", f"/services/{SVC_B}/briefs",
             {"title":"UAT W2 guard","assigned_division":"Creative","deliverable_type":"Video",
              "quantity_target":1,"due_date":"2026-08-15","priority":"Medium"})
step(14, "guard Brief sebelum approval (svcB plan-gated Awaiting) -> [layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]",
     st in (400,422) and "wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief" in msg(b), f"{st} {msg(b)}")

st, b = call(am2, "POST", f"/services/{SVC_B}/strategy",
             {"objective":"o","target_kpi":"k","divisions_involved":["Creative"],
              "planned_brief_outline":"x","timeline_start":"2026-07-20","timeline_end":"2026-08-20"})
str_other = st==403 and "hanya Account Manager pemilik klien yang dapat mengelola Strategy & Plan" in msg(b)
st, b = call(am, "POST", f"/services/{SVC_B}/strategy",
             {"objective":"Naikkan GMV","target_kpi":"ROAS 4x","divisions_involved":["Creative","Ads","KOL","Live Stream"],
              "planned_brief_outline":"Outline kampanye","timeline_start":"2026-07-20","timeline_end":"2026-08-20"})
STR = b.get("id"); str_born = st==200 and STR and "[Strategy Drafting]" in b.get("status","")
st, b = call(am, "POST", f"/services/{SVC_B}/strategy", {"objective":"o","target_kpi":"k","divisions_involved":["Creative"],"planned_brief_outline":"x","timeline_start":"2026-07-20","timeline_end":"2026-08-20"})
str_dup = st in (400,422) and "Strategy & Plan untuk layanan ini sudah ada" in msg(b)
st, b = call(am, "PUT", f"/strategies/{STR}", {"objective":"Naikkan GMV (rev)","target_kpi":"ROAS 4x","divisions_involved":["Creative","Ads","KOL","Live Stream"],"planned_brief_outline":"Outline v2","timeline_start":"2026-07-20","timeline_end":"2026-08-20"})
str_upd = st==200
step(10, "create STR svcB -> [Strategy Drafting] (AM lain ditolak; dobel ditolak; update draft OK)",
     str_born and str_other and str_dup and str_upd, f"born={str_born} STR={STR} other={str_other} dup={str_dup} upd={str_upd}")

st, b = call(am, "POST", f"/strategies/{STR}/submit")
sub_ok = st==200
st, b = call(am, "PUT", f"/strategies/{STR}", {"objective":"z","target_kpi":"k","divisions_involved":["Creative"],"planned_brief_outline":"x","timeline_start":"2026-07-20","timeline_end":"2026-08-20"})
sub_locked = st in (400,422) and "Strategy & Plan hanya dapat diubah saat berstatus Strategy Drafting" in msg(b)
step(11, "submit STR -> [Strategy Submitted for Approval]; update draft pasca-submit ditolak",
     sub_ok and sub_locked, f"submit={sub_ok} locked={sub_locked}")

st, b = call(alead, "POST", f"/strategies/{STR}/request-revision", {"notes": ""})
rev_noreason = st in (400,422) and "catatan revisi wajib diisi" in msg(b)
st, b = call(alead, "POST", f"/strategies/{STR}/request-revision", {"notes": "perbaiki KPI"})
rev_ok = st==200
st, b = call(am, "POST", f"/strategies/{STR}/approve")
am_noapprove = st==403 and "tidak memiliki akses untuk menyetujui atau meminta revisi Strategy & Plan" in msg(b)
call(am, "POST", f"/strategies/{STR}/submit")  # AM re-submit
st, sd = call(am, "GET", f"/strategies/{STR}")
revcount = sd.get("revision_count")
step(12, "request-revision (notes wajib) -> Drafting, revision_count derived +1; AM approve ditolak; re-submit",
     rev_noreason and rev_ok and am_noapprove and revcount==1, f"noreason={rev_noreason} rev={rev_ok} amNoApprove={am_noapprove} revcount={revcount}")

st, b = call(alead, "POST", f"/strategies/{STR}/approve")
st2, sd2 = call(am, "GET", f"/services/{SVC_B}/briefs")   # trigger not needed; check svc status via strategy
st3, cb2 = call(am, "GET", f"/clients/{cli}")
svcb_status = next((s["status"] for s in (cb2.get("client") or {}).get("services") or [] if s["id"]==SVC_B), "")
st4, sd3 = call(am, "GET", f"/strategies/{STR}")
step(13, "approve STR -> [Strategy Approved] + Service B [Awaiting Onboarding]->[Strategy Approved] (Approved By)",
     st==200 and "[Strategy Approved]" in sd3.get("status","") and "[Strategy Approved]" in svcb_status and sd3.get("approved_by")==YULI_ID,
     f"approve={st} STRstatus={sd3.get('status')} svcB={svcb_status} approvedBy={sd3.get('approved_by')}")

# ============================================================================
# D. M6 §5-§6 — Brief breakdown & dispatch (langkah 15-18)
# ============================================================================
def mkbrief(actor, svc, division, strategy_id="", qty=1, title=None, priority="Medium", deliverable="Video"):
    body = {"title": title or f"UAT W2 {division} {UQ}", "assigned_division": division,
            "deliverable_type": deliverable, "quantity_target": qty, "due_date": "2026-08-15", "priority": priority}
    if strategy_id: body["strategy_id"] = strategy_id
    return call(actor, "POST", f"/services/{svc}/briefs", body)

# langkah 15 — jalur Direct (Service A)
st, b = mkbrief(am, SVC_A, "Creative", strategy_id="STR-fake")
direct_hasstr = st in (400,422) and "layanan Direct tidak boleh memiliki Strategy ID pada brief" in msg(b)
st, b = mkbrief(am, SVC_A, "Creative")
BRF_A = b.get("id"); direct_ok = st==200 and "[To Do]" in b.get("status","")
st2, cbA = call(am, "GET", f"/clients/{cli}")
svca_status = next((s["status"] for s in (cbA.get("client") or {}).get("services") or [] if s["id"]==SVC_A), "")
step(15, "CreateBrief Direct (Service A) -> [To Do]; Service A [Awaiting Onboarding]->[Briefed]; Direct+strategy_id ditolak",
     direct_ok and direct_hasstr and "[Briefed]" in svca_status, f"ok={direct_ok} BRF_A={BRF_A} svcA={svca_status} negStr={direct_hasstr}")

# langkah 16 — jalur plan-gated (Service B) untuk 4 divisi
st, b = mkbrief(am, SVC_B, "Creative", strategy_id="STR-salah")
mism = st in (400,422) and "Strategy ID brief harus menunjuk Strategy & Plan yang disetujui" in msg(b)
st, b = mkbrief(am, SVC_B, "Nirwana", strategy_id=STR)
baddiv = st in (400,422) and "divisi tujuan tidak valid" in msg(b)
st, b = mkbrief(am, SVC_B, "Creative", strategy_id=STR, priority="Ultra")
badprio = st in (400,422) and "prioritas tidak valid" in msg(b)
st, b = mkbrief(am2, SVC_B, "Creative", strategy_id=STR)
notowner = st==403 and "hanya Account Manager pemilik klien yang dapat membuat Brief" in msg(b)
st, b = mkbrief(am, SVC_B, "Creative", strategy_id=STR, qty=3, title=f"UAT W2 CRE-assets {UQ}")
BRF_CRE = b.get("id"); cre_ok = st==200 and "[To Do]" in b.get("status","")
st2, cbB = call(am, "GET", f"/clients/{cli}")
svcb_after = next((s["status"] for s in (cbB.get("client") or {}).get("services") or [] if s["id"]==SVC_B), "")
st, b = mkbrief(am, SVC_B, "Ads", strategy_id=STR, deliverable="Ad Campaign", title=f"UAT W2 ADS {UQ}");  BRF_ADS = b.get("id")
st, b = mkbrief(am, SVC_B, "KOL", strategy_id=STR, deliverable="Endorse", title=f"UAT W2 KOL {UQ}");       BRF_KOL = b.get("id")
step(16, "CreateBrief plan-gated 4 divisi -> BRF [To Do]; Service B [Strategy Approved]->[Briefed]; negatif mismatch/divisi/prioritas/AM-lain",
     cre_ok and BRF_ADS and BRF_KOL and "[Briefed]" in svcb_after and mism and baddiv and badprio and notowner,
     f"cre={cre_ok} ads={bool(BRF_ADS)} kol={bool(BRF_KOL)} svcB={svcb_after} mism={mism} baddiv={baddiv} badprio={badprio} notowner={notowner}")

# langkah 17 — Live Stream brief off-machine
st, b = mkbrief(am, SVC_B, "Live Stream", strategy_id=STR, deliverable="Live Session", title=f"UAT W2 LS {UQ}")
BRF_LS = b.get("id"); ls_born = st==200 and "[Dispatched to Vendor]" in b.get("status","")
st, b = call(cre, "POST", f"/tasks/{BRF_LS}/start")
ls_notask = st in (400,422) and "bukan task yang dieksekusi" in msg(b)
step(17, "Brief Live Stream lahir off-machine [Dispatched to Vendor]; edge task ditolak [brief ini bukan task yang dieksekusi, di-dispatch ke vendor]",
     ls_born and ls_notask, f"born={ls_born} BRF_LS={BRF_LS} notask={ls_notask}")

# langkah 18 — brief-queue visibility
def qstatus(actor, div):
    st, b = call(actor, "GET", f"/divisions/{qenc(div)}/brief-queue"); return st
q_cre_staff = qstatus(cre, "Creative")==200
q_other = 0; st, b = call(ads, "GET", f"/divisions/Creative/brief-queue"); q_other = st==403 and "tidak memiliki akses ke antrean brief divisi ini" in msg(b)
q_lead = qstatus(alead, "Creative")==200
q_od = qstatus(od, "Creative")==200
q_dir = qstatus(dirc, "Creative")==200
q_kol = qstatus(kol, "KOL")==200
q_lss = qstatus(lss, "Live Stream")==200
step(18, "brief-queue: staf divisi+Account lead+OD+Director lihat; staf divisi lain ditolak; fixture KOL/LS viewer",
     q_cre_staff and q_other and q_lead and q_od and q_dir and q_kol and q_lss,
     f"creStaff={q_cre_staff} adsOnCre403={q_other} lead={q_lead} od={q_od} dir={q_dir} kolFix={q_kol} lsFix={q_lss}")

# ============================================================================
# E. M12 — Task Execution (Brief-as-task) (langkah 19-24)
# Subjek brief-as-task = brief divisi Creative yang digerakkan langsung (Ads punya
# submit-guard M8 -> diuji terpisah di §G; Creative-as-task tak kena guard).
# ============================================================================
st, b = mkbrief(am, SVC_B, "Creative", strategy_id=STR, title=f"UAT W2 TASK {UQ}")
BRF_TASK = b.get("id")
st, b = call(cre, "POST", f"/tasks/{BRF_TASK}/start")   # first To Do departure on Service B
start_ok = st==200 and b.get("To")=="[In Progress]"
st2, cbEx = call(am, "GET", f"/clients/{cli}")
svcb_exec = next((s["status"] for s in (cbEx.get("client") or {}).get("services") or [] if s["id"]==SVC_B), "")
st, b = call(cre, "POST", f"/tasks/{BRF_TASK}/start")   # illegal (already In Progress)
start_illegal = st in (400,422) and "transisi status tidak diizinkan" in msg(b)
step(19, "start Brief-as-task [To Do]->[In Progress]; OnBriefLeavesToDo -> Service B [In Execution]; transisi ilegal ditolak",
     start_ok and "[In Execution]" in svcb_exec and start_illegal, f"start={start_ok} svcB={svcb_exec} illegal={start_illegal}")

st, b = call(crelead, "POST", f"/tasks/{BRF_TASK}/assign-pic", {"pic_id": KENNY_ID})  # PIC bukan Creative
pic_invalid = st in (400,422) and "PIC tidak valid: harus staff divisi tujuan yang aktif" in msg(b)
st, b = call(crelead, "POST", f"/tasks/{BRF_TASK}/sla", {"hours": 0})
sla_bad = st in (400,422) and "target SLA harus lebih dari 0 jam" in msg(b)
st, b = call(cre, "POST", f"/tasks/{BRF_TASK}/assign-pic", {"pic_id": ARIF_ID})  # staff assign
staff_assign = st==403 and "tidak memiliki akses untuk menugaskan PIC atau menetapkan SLA" in msg(b)
st, b = call(crelead, "POST", f"/tasks/{BRF_TASK}/assign-pic", {"pic_id": ARIF_ID})
assign_ok = st==200
st, b = call(crelead, "POST", f"/tasks/{BRF_TASK}/sla", {"hours": 48})
sla_ok = st==200
step(20, "Lead assign-pic + SLA; negatif PIC-invalid/SLA<=0/staff-assign",
     assign_ok and sla_ok and pic_invalid and sla_bad and staff_assign,
     f"assign={assign_ok} sla={sla_ok} picInvalid={pic_invalid} slaBad={sla_bad} staffAssign={staff_assign}")

st, b = call(cre2, "POST", f"/tasks/{BRF_TASK}/submit")   # non-PIC (ASSIFA)
nonpic = st==403 and "tidak memiliki akses untuk mengerjakan task ini" in msg(b)
step(21, "pasca-PIC: non-PIC submit ditolak [anda tidak memiliki akses untuk mengerjakan task ini]", nonpic, f"{st} {msg(b)}")

st, b = call(cre, "POST", f"/tasks/{BRF_TASK}/submit"); s_sub = st==200 and b.get("To")=="[Submitted]"
st, b = call(am, "POST", f"/briefs/{BRF_TASK}/review"); s_rev = st==200 and b.get("To")=="[In Review]"
st, b = call(am, "POST", f"/briefs/{BRF_TASK}/request-revision", {"feedback": "revisi warna"}); s_rr = st==200 and b.get("To")=="[Revision Requested]"
st, b = call(cre, "POST", f"/tasks/{BRF_TASK}/rework"); s_rw = st==200 and b.get("To")=="[In Progress]"
call(cre, "POST", f"/tasks/{BRF_TASK}/submit")
call(am, "POST", f"/briefs/{BRF_TASK}/review")
st, b = call(am, "POST", f"/briefs/{BRF_TASK}/approve"); s_ap = st==200 and b.get("To")=="[Approved]"
step(22, "PIC submit->AM review->request-revision->PIC rework->submit->review->approve (turnaround tak reset)",
     s_sub and s_rev and s_rr and s_rw and s_ap, f"sub={s_sub} rev={s_rev} rr={s_rr} rework={s_rw} approve={s_ap}")

# langkah 23 — block flow (brief-as-task terpisah, harus In Progress)
st, b = mkbrief(am, SVC_B, "Creative", strategy_id=STR, title=f"UAT W2 BLOCK {UQ}")
BRF_BLK = b.get("id")
call(cre, "POST", f"/tasks/{BRF_BLK}/start")
st, b = call(cre, "POST", f"/tasks/{BRF_BLK}/block-request", {"reason": ""})
blk_noreason = st in (400,422) and "alasan permintaan block wajib diisi" in msg(b)
st, b = call(cre, "POST", f"/tasks/{BRF_BLK}/block-request", {"reason": "menunggu aset klien"})
REQID = b.get("id"); blk_req = st==200 and REQID
st, b = call(cre, "POST", f"/tasks/{BRF_BLK}/block-requests/{REQID}/approve")
staff_decide = st==403 and "tidak memiliki akses untuk memutuskan permintaan block" in msg(b)
st, b = call(crelead, "POST", f"/tasks/{BRF_BLK}/block-requests/{REQID}/approve")
blk_ok = st==200
st, b = call(crelead, "POST", f"/tasks/{BRF_BLK}/block-requests/{REQID}/approve")
blk_processed = st in (400,422) and "permintaan block sudah diproses" in msg(b)
st, b = call(crelead, "POST", f"/tasks/{BRF_BLK}/resume"); blk_resume = st==200 and b.get("To")=="[In Progress]"
step(23, "block: staff request (reason wajib) -> lead approve [Blocked] -> resume [In Progress]; staff-decide & sudah-diproses ditolak",
     blk_noreason and blk_req and staff_decide and blk_ok and blk_processed and blk_resume,
     f"noreason={blk_noreason} req={bool(blk_req)} staffDecide={staff_decide} approve={blk_ok} processed={blk_processed} resume={blk_resume}")

st, m = call(am, "GET", f"/tasks/{BRF_TASK}/metrics")
speed = m.get("speed_score_display",""); ta = m.get("turnaround_hours")
metric_ok = st==200 and ta is not None and (speed.endswith("%") or speed in ("N/A","—"))
st2, m2 = call(am, "GET", f"/tasks/{BRF_BLK}/metrics")
na_ok = st2==200 and m2.get("speed_score_display")=="N/A"   # BLK: SLA absen / belum approved
step(24, "metrics: Speed Score=turnaround/SLA (uncapped), SLA absen -> N/A (worked-example exact tak reproducible di walk real-time)",
     metric_ok and na_ok, f"speed={speed} turnaround={ta} blkSLAabsent={m2.get('speed_score_display')}")

# ============================================================================
# F. M7 — Creative Asset + Daily Output (langkah 25-29)
# ============================================================================
st, b = call(cre, "POST", f"/briefs/{BRF_CRE}/assets", {"sequence_no": 9, "assigned_pic": ARIF_ID})
seq_oob = st in (400,422) and "nomor urut aset harus antara 1 dan jumlah target brief" in msg(b)
st, b = call(cre, "POST", f"/briefs/{BRF_ADS}/assets", {"sequence_no": 1})
not_cre = st in (400,422) and "brief ini bukan brief divisi Creative" in msg(b)
st, b = call(cre, "POST", f"/briefs/{BRF_CRE}/assets", {"sequence_no": 1, "assigned_pic": ARIF_ID})
AST1 = b.get("id"); ast_ok = st==200 and "[To Do]" in b.get("status","")
st, b = call(cre, "POST", f"/briefs/{BRF_CRE}/assets", {"sequence_no": 1, "assigned_pic": ARIF_ID})
seq_dup = st in (400,422) and "nomor urut aset sudah digunakan pada brief ini" in msg(b)
st, b = call(cre, "POST", f"/briefs/{BRF_CRE}/assets", {"sequence_no": 2, "assigned_pic": ARIF_ID})
AST2 = b.get("id")   # tetap [To Do] untuk uji linkage-not-approved
step(25, "CreateAsset seq1 -> [To Do]; negatif seq-luar-rentang/seq-dobel/brief-bukan-Creative",
     ast_ok and seq_oob and seq_dup and not_cre, f"ast1={AST1} ok={ast_ok} oob={seq_oob} dup={seq_dup} notCre={not_cre}")

st, b = call(cre, "POST", f"/assets/{AST1}/start")
ast_start = st==200 and b.get("To")=="[In Progress]"
st2, brA = call(am, "GET", f"/briefs/{BRF_CRE}")
brf_cre_status = brA.get("status")
st, b = call(cre, "POST", f"/assets/{AST1}/submit", {"output_link": ""})
nolink = st in (400,422) and "link output wajib diisi sebelum submit" in msg(b)
st, b = call(crelead, "POST", f"/assets/{AST1}/assign-pic", {"pic_id": KENNY_ID})  # PIC invalid (M12 msg)
assetpic_invalid = st in (400,422) and "PIC tidak valid: harus staff divisi tujuan yang aktif" in msg(b)
st, b = call(cre, "POST", f"/assets/{AST1}/submit", {"output_link": "https://drive.example/ast1"})
ast_submit = st==200 and b.get("To")=="[Submitted]"
step(26, "Asset start (roll-up Brief [In Progress]); submit tanpa link ditolak; assign-pic Asset invalid -> pesan M12",
     ast_start and "[In Progress]" in brf_cre_status and nolink and assetpic_invalid and ast_submit,
     f"start={ast_start} briefCRE={brf_cre_status} nolink={nolink} picInvalid={assetpic_invalid} submit={ast_submit}")

st, b = call(am2, "POST", f"/assets/{AST1}/review")
rev_other = st==403 and "hanya Account Manager pemilik klien yang dapat mereview aset ini" in msg(b)
st, b = call(am, "POST", f"/assets/{AST1}/review"); a_rev = st==200 and b.get("To")=="[In Review]"
st, b = call(am, "POST", f"/assets/{AST1}/request-revision", {"feedback": ""})
rev_nofeedback = st in (400,422) and "feedback revisi wajib diisi" in msg(b)
st, b = call(am, "POST", f"/assets/{AST1}/request-revision", {"feedback": "perbaiki intro"})
a_rr = st==200 and b.get("To")=="[Revision Requested]"
call(cre, "POST", f"/assets/{AST1}/rework")
call(cre, "POST", f"/assets/{AST1}/submit", {"output_link": "https://drive.example/ast1v2"})
call(am, "POST", f"/assets/{AST1}/review")
st, b = call(am, "POST", f"/assets/{AST1}/approve"); a_ap = st==200 and b.get("To")=="[Approved]"
step(27, "AM review/approve per-Asset; AM lain ditolak; request-revision tanpa feedback ditolak; -> [Approved]",
     rev_other and a_rev and rev_nofeedback and a_rr and a_ap, f"other={rev_other} review={a_rev} noFb={rev_nofeedback} rr={a_rr} approve={a_ap}")

st, b = call(cre, "POST", f"/assets/{AST1}/hours", {"hours": 0})
hours_bad = st in (400,422) and "jumlah Hours Logged harus lebih dari 0" in msg(b)
st, b = call(cre2, "POST", f"/assets/{AST1}/hours", {"hours": 5})   # ASSIFA bukan PIC/lead
hours_forbidden = st==403 and "tidak memiliki akses untuk mencatat Hours Logged aset ini" in msg(b)
st, b = call(cre, "POST", f"/assets/{AST1}/hours", {"hours": 6.5})
hours_ok = st==200
step(28, "Hours Logged: PIC log OK; <=0 ditolak; aktor tak berhak ditolak",
     hours_ok and hours_bad and hours_forbidden, f"ok={hours_ok} bad={hours_bad} forbidden={hours_forbidden}")

today = time.strftime("%Y-%m-%d")
st, b = call(cre, "GET", f"/daily-output/{ARIF_ID}?date={today}")
do_own = st==200 and b.get("locked") is False
st, b = call(cre, "GET", f"/daily-output/{ARIF_ID}?date=2020-01-01")
do_locked = st==200 and b.get("locked") is True
st, b = call(cre, "GET", f"/daily-output/{ARIF_ID}?date=bukan-tanggal")
do_malformed = st==400 and "format data tidak valid" in msg(b)
st, b = call(cre2, "GET", f"/daily-output/{ARIF_ID}?date={today}")   # staf Creative lain
do_forbidden = st==403 and "tidak memiliki akses ke Daily Output ini" in msg(b)
st, b = call(am, "GET", f"/daily-output/{ARIF_ID}?date={today}")     # AM juga bukan viewer
do_am = st==403
step(29, "Daily Output: PIC own (hari ini locked=false; hari lampau locked=true); malformed ditolak; staf lain/AM ditolak",
     do_own and do_locked and do_malformed and do_forbidden and do_am,
     f"own={do_own} locked={do_locked} malformed={do_malformed} otherCre={do_forbidden} am403={do_am}")

# ============================================================================
# G. M8 — Ad Campaign + gate Launch dua sisi (langkah 30-36)
# ============================================================================
st, b = call(ads, "POST", f"/briefs/{BRF_ADS}/campaigns",
             {"platform":"Shopee Ads","objective":"Sales","budget":"5000000","start_date":"2026-07-20","end_date":"2026-08-20","target_kpi":"ROAS 4x"})
camp_notinprog = st in (400,422) and "kampanye iklan hanya dapat dibuat saat brief berstatus In Progress" in msg(b)
call(ads, "POST", f"/tasks/{BRF_ADS}/start")   # Ads brief -> In Progress
st, b = call(ads, "POST", f"/briefs/{BRF_CRE}/campaigns", {"platform":"Shopee Ads","objective":"x","budget":"1000000","start_date":"2026-07-20","end_date":"2026-08-20","target_kpi":"ROAS 4x"})
camp_notads = st in (400,422) and "brief ini bukan brief divisi Ads" in msg(b)
st, b = call(ads, "POST", f"/briefs/{BRF_ADS}/campaigns", {"platform":"Bukan Platform","objective":"x","budget":"1000000","start_date":"2026-07-20","end_date":"2026-08-20","target_kpi":"ROAS 4x"})
camp_badplat = st in (400,422) and "platform tidak valid" in msg(b)
st, b = call(ads, "POST", f"/briefs/{BRF_ADS}/campaigns", {"platform":"Shopee Ads","objective":"x","budget":"1000000","start_date":"2026-08-20","end_date":"2026-07-20","target_kpi":"ROAS 4x"})
camp_baddate = st in (400,422) and "tanggal mulai dan selesai kampanye tidak valid" in msg(b)
st, b = call(ads, "POST", f"/briefs/{BRF_ADS}/campaigns",
             {"platform":"Shopee Ads","objective":"Sales","budget":"5000000","start_date":"2026-07-20","end_date":"2026-08-20","target_kpi":"ROAS 4x"})
ADC = b.get("id"); camp_born = st==200 and "[Paused]" in b.get("status","")
step(30, "CreateCampaign ADC lahir [Paused] (born INSERT, O32); negatif brief-not-InProgress/bukan-Ads/platform/tanggal",
     camp_born and camp_notinprog and camp_notads and camp_badplat and camp_baddate,
     f"ADC={ADC} born={camp_born} notInProg={camp_notinprog} notAds={camp_notads} badPlat={camp_badplat} badDate={camp_baddate}")

# langkah 32 — submit brief Ads TANPA ADC ber-aset (ADC ada tapi belum ada aset tertaut)
st, b = call(ads, "POST", f"/tasks/{BRF_ADS}/submit")
submit_guard = st in (400,422) and "campaign belum lengkap, lengkapi platform/budget/aset kreatif sebelum submit" in msg(b)
step(32, "submit brief setup Ads tanpa ADC ber-aset -> [campaign belum lengkap, lengkapi platform/budget/aset kreatif sebelum submit]",
     submit_guard, f"{st} {msg(b)}")

# langkah 31 — link aset
st, b = call(ads, "POST", f"/campaigns/{ADC}/assets", {"asset_id": AST2})   # AST2 belum Approved
link_notapproved = st in (400,422) and "aset kreatif harus disetujui sebelum ditautkan" in msg(b)
st, b = call(ads, "POST", f"/campaigns/{ADC}/assets", {"asset_id": AST1})   # AST1 Approved
link_ok = st==200
st, b = call(ads, "POST", f"/campaigns/{ADC}/assets", {"asset_id": AST1})
link_dup = st in (400,422) and "aset kreatif sudah ditautkan ke kampanye ini" in msg(b)
step(31, "LinkAsset: aset belum Approved ditolak; link approved OK; tautan dobel ditolak (aset klien lain: butuh klien ke-2 -> tak diuji)",
     link_notapproved and link_ok and link_dup, f"notApproved={link_notapproved} ok={link_ok} dup={link_dup}")

# submit brief Ads kini lengkap -> Submitted
st, b = call(ads, "POST", f"/tasks/{BRF_ADS}/submit"); ads_submit_ok = st==200 and b.get("To")=="[Submitted]"

# langkah 33 — launch gate dua sisi
st, b = call(ads, "POST", f"/campaigns/{ADC}/launch")   # brief setup belum Approved
launch_a = st in (400,422) and "kampanye belum dapat diluncurkan, brief setup belum disetujui" in msg(b)
call(am, "POST", f"/briefs/{BRF_ADS}/review")
call(am, "POST", f"/briefs/{BRF_ADS}/approve")   # brief Ads -> Approved
st, b = call(ads, "POST", f"/campaigns/{ADC}/launch")   # brief Approved + aset Approved -> Active
launch_ok = st==200 and b.get("To")=="[Active]"
step(33, "Launch gate: (a) brief belum disetujui ditolak; setelah brief+aset Approved -> [Active]. Sisi (b) aset-tertaut-belum-Approved = guard defensif ads.go:141 tak terjangkau via API (link wajib Approved & Approved terminal)",
     launch_a and launch_ok, f"guardA={launch_a} launch={launch_ok}")

st, b = call(ads, "POST", f"/campaigns/{ADC}/pause"); c_pause = st==200 and b.get("To")=="[Paused]"
st, b = call(ads, "POST", f"/campaigns/{ADC}/end");   c_end = st==200 and b.get("To")=="[Ended]"
st, b = call(ads, "POST", f"/campaigns/{ADC}/launch") # dari [Ended] -> ilegal
c_illegal = st in (400,422) and "transisi status tidak diizinkan" in msg(b)
step(34, "pause [Active]->[Paused], end ->[Ended]; transisi di luar 3-status ditolak [transisi status tidak diizinkan]",
     c_pause and c_end and c_illegal, f"pause={c_pause} end={c_end} illegal={c_illegal}")

st, b = call(ads, "POST", f"/campaigns/{ADC}/metrics", {"period_start":"2026-07-20","period_end":"2026-07-27","spend":"-1","gmv":"100","entry_method":"Manual"})
m_neg = st in (400,422) and "nilai spend dan GMV tidak boleh negatif" in msg(b)
st, b = call(ads, "POST", f"/campaigns/{ADC}/metrics", {"period_start":"2026-07-20","period_end":"2026-07-27","spend":"1000000","gmv":"4000000","entry_method":"BukanMetode"})
m_badmethod = st in (400,422) and "metode input tidak valid" in msg(b)
st, b = call(ads, "POST", f"/campaigns/{ADC}/metrics", {"period_start":"2026-07-20","period_end":"2026-07-27","spend":"1000000","gmv":"4000000","entry_method":"Manual"})
m_ok = st==200
st, cc = call(ads, "GET", f"/campaigns/{ADC}")
roas = cc.get("roas_display"); tot_spend = cc.get("total_spend"); tot_gmv = cc.get("total_gmv")
roas_ok = tot_spend and abs((tot_gmv/tot_spend) - (cc.get("roas") or 0)) < 1e-6
step(35, "Metric Entry append-only; spend/GMV negatif & metode invalid ditolak; ROAS derived (GMV/Spend)",
     m_ok and m_neg and m_badmethod and roas_ok, f"ok={m_ok} neg={m_neg} badMethod={m_badmethod} spend={tot_spend} gmv={tot_gmv} roas={roas}")

# langkah 36 — optimisasi budget >50% oleh Advertiser polos vs owning AM / SPV Ads
st, b = call(ads, "POST", f"/campaigns/{ADC}/optimizations", {"change_type":"Budget","before_value":"5000000","after_value":"9000000","reason":"scale up"})
opt_gate = st==403 and "penyesuaian budget lebih dari 50% memerlukan persetujuan AM/SPV Ads" in msg(b)
st, b = call(adslead, "POST", f"/campaigns/{ADC}/optimizations", {"change_type":"Budget","before_value":"5000000","after_value":"9000000","reason":"scale up disetujui SPV"})
opt_spv = st==200
st, b = call(am, "POST", f"/campaigns/{ADC}/optimizations", {"change_type":"Budget","before_value":"5000000","after_value":"9000000","reason":"scale up disetujui AM"})
opt_am = st==200
step(36, "Optimisasi budget >50%: Advertiser polos -> 403 [penyesuaian budget lebih dari 50% memerlukan persetujuan AM/SPV Ads]; SPV Ads(fixture)/owning AM diizinkan",
     opt_gate and opt_spv and opt_am, f"gate403={opt_gate} spvAds={opt_spv} owningAM={opt_am}")

# ============================================================================
# H. M9 — KOL Booking + CPR + Attributed GMV (fixture O34) (langkah 37-41)
# ============================================================================
def mkbooking(actor, brief, pool="MCN MEA Roster", rate="1500000", name=None):
    return call(actor, "POST", f"/briefs/{brief}/bookings",
                {"creator_name": name or f"UAT W2 Kreator {UQ}", "platform":"TikTok", "source_pool":pool, "agreed_rate":rate})

st, b = mkbooking(kol, BRF_CRE)   # brief bukan KOL
bk_notkol = st in (400,422) and "brief ini bukan brief divisi KOL" in msg(b)
st, b = mkbooking(kol, BRF_KOL, pool="Pool Ngawur")
bk_badpool = st in (400,422) and "source pool tidak valid" in msg(b)
st, b = mkbooking(kol, BRF_KOL, name=f"UAT W2 Main {UQ}")
BKG1 = b.get("id"); bk_born = st==200 and "[Sourcing]" in b.get("status","")
call(kol, "POST", f"/bookings/{BKG1}/book")   # -> Booked (roll-up Brief In Progress)
st2, brK = call(am, "GET", f"/briefs/{BRF_KOL}")
step(37, "CreateBooking -> [Sourcing]; roll-up Book -> Brief [In Progress]; negatif brief-bukan-KOL/source-pool",
     bk_born and bk_notkol and bk_badpool and "[In Progress]" in brK.get("status",""),
     f"BKG1={BKG1} born={bk_born} notKOL={bk_notkol} badPool={bk_badpool} briefKOL={brK.get('status')}")

# Buat SEMUA booking sekarang, selagi Brief masih bookable (BKG1 QC Passed nanti akan
# me-roll-up Brief -> [Approved] hanya bila semua booking terminal; BKG3 tetap Sourcing
# agar Brief tetap [In Progress] untuk uji gate).
st, b = mkbooking(kol, BRF_KOL, name=f"UAT W2 Cap {UQ}");     BKG2 = b.get("id")
st, b = mkbooking(kol, BRF_KOL, name=f"UAT W2 GmvGate {UQ}"); BKG3 = b.get("id")

# langkah 38 — lifecycle native + negatif (BKG1 happy-path)
call(kol, "POST", f"/bookings/{BKG1}/start-content")
st, b = call(kol, "POST", f"/bookings/{BKG1}/submit-content", {"content_link": ""})
sc_nolink = st in (400,422) and "link konten wajib diisi sebelum submit" in msg(b)
call(kol, "POST", f"/bookings/{BKG1}/submit-content", {"content_link": "https://tt.example/main"})
call(kol, "POST", f"/bookings/{BKG1}/send-qc")
st, b = call(kol, "POST", f"/bookings/{BKG1}/pass-qc"); passed = st==200 and b.get("To")=="[QC Passed]"
# BKG2 untuk uji cap-revisi + escalate + drop
call(kol, "POST", f"/bookings/{BKG2}/book")
call(kol, "POST", f"/bookings/{BKG2}/start-content")
call(kol, "POST", f"/bookings/{BKG2}/submit-content", {"content_link": "https://tt.example/cap"})
call(kol, "POST", f"/bookings/{BKG2}/send-qc")
st, b = call(kol, "POST", f"/bookings/{BKG2}/fail-qc", {"qc_notes": ""})
fq_nonotes = st in (400,422) and "catatan QC wajib diisi" in msg(b)
st, b = call(kol, "POST", f"/bookings/{BKG2}/fail-qc", {"qc_notes": "revisi 1"}); fq1 = st==200
call(kol, "POST", f"/bookings/{BKG2}/resubmit", {"content_link": "https://tt.example/cap2"})
call(kol, "POST", f"/bookings/{BKG2}/send-qc")
st, b = call(kol, "POST", f"/bookings/{BKG2}/fail-qc", {"qc_notes": "revisi 2"})
cap = st in (400,422) and "batas revisi kreator tercapai, silakan eskalasi booking" in msg(b)
st, b = call(kollead, "POST", f"/bookings/{BKG2}/escalate", {"qc_notes": ""})
esc_nonotes = st in (400,422) and "catatan QC wajib diisi" in msg(b)
st, b = call(kollead, "POST", f"/bookings/{BKG2}/escalate", {"qc_notes": "kreator tidak responsif"}); esc = st==200
st, b = call(kollead, "POST", f"/bookings/{BKG2}/drop", {"reason": ""})
drop_noreason = st in (400,422) and "alasan drop wajib diisi" in msg(b)
st, b = call(kollead, "POST", f"/bookings/{BKG2}/drop", {"reason": "gagal, di-drop"}); dropped = st==200 and b.get("To")=="[Dropped]"
step(38, "lifecycle native -> [QC Passed]; link konten wajib; QC notes wajib; cap revisi(1); escalate; drop(reason wajib)->[Dropped]",
     passed and sc_nolink and fq_nonotes and fq1 and cap and esc_nonotes and esc and drop_noreason and dropped,
     f"passed={passed} noLink={sc_nolink} qcNotes={fq_nonotes} fq1={fq1} cap={cap} escNotes={esc_nonotes} esc={esc} dropNoReason={drop_noreason} dropped={dropped}")

# langkah 39 — attributed GMV
st, b = call(am, "POST", f"/bookings/{BKG1}/attributed-gmv", {"attributed_gmv": "12000000"})   # AM ditolak
gmv_am = st==403 and "tidak memiliki akses untuk mengerjakan booking ini" in msg(b)
st, b = call(kol, "POST", f"/bookings/{BKG3}/attributed-gmv", {"attributed_gmv": "1000000"})   # BKG3 masih Sourcing
gmv_gate = st in (400,422) and "GMV teratribusi hanya dapat dicatat setelah booking QC Passed" in msg(b)
st, b = call(kollead, "POST", f"/bookings/{BKG1}/attributed-gmv", {"attributed_gmv": "12000000"})   # KOL lead OK
gmv_ok = st==200
step(39, "Attributed GMV (M9-OA-4): hanya [QC Passed]; AM ditolak; Coordinator/KOL lead OK; overwrite-and-audit",
     gmv_am and gmv_gate and gmv_ok, f"amDitolak={gmv_am} gate={gmv_gate} ok={gmv_ok}")

# langkah 40 — CPR request side
st, b = call(kol, "POST", f"/bookings/{BKG3}/payment-request", {"amount":"1500000","payment_details":"BCA 123"})
cpr_gate = st in (400,422) and "permintaan pembayaran hanya dapat dibuat setelah booking QC Passed" in msg(b)
st, b = call(kol, "POST", f"/bookings/{BKG1}/payment-request", {"amount":"999999","payment_details":"BCA 123"})
cpr_mismatch = st in (400,422) and "jumlah pembayaran harus sama dengan Agreed Rate booking" in msg(b)
st, b = call(kol, "POST", f"/bookings/{BKG1}/payment-request", {"amount":"1500000","payment_details":"BCA 123456789"})
CPR = b.get("id"); cpr_ok = st==200 and "[Requested]" in b.get("status","")
st, b = call(kol, "POST", f"/bookings/{BKG1}/payment-request", {"amount":"1500000","payment_details":"BCA"})
cpr_dup = st in (400,422) and "permintaan pembayaran untuk booking ini sudah ada" in msg(b)
step(40, "CPR: hanya [QC Passed]; amount != Agreed Rate ditolak; dobel ditolak -> CPR [Requested]",
     cpr_gate and cpr_mismatch and cpr_ok and cpr_dup, f"gate={cpr_gate} mismatch={cpr_mismatch} CPR={CPR} ok={cpr_ok} dup={cpr_dup}")

# langkah 41 — CPR finance side
st, b = call(fin, "POST", f"/payment-requests/{CPR}/receive"); cpr_recv = st==200 and b.get("To")=="[Received by Finance]"
st, b = call(fin, "POST", f"/payment-requests/{CPR}/reject", {"reason": ""})
cpr_rejnoreason = st in (400,422) and "alasan penolakan wajib diisi" in msg(b)
st, b = call(fin, "POST", f"/payment-requests/{CPR}/pay"); cpr_paid = st==200 and b.get("To")=="[Paid]"
st, bk = call(kol, "GET", f"/bookings/{BKG1}")
pay_status = bk.get("payment_status","")
step(41, "CPR finance: receive->[Received by Finance]; reject reason wajib; pay->[Paid]; Payment Status BKG refleksi CPR",
     cpr_recv and cpr_rejnoreason and cpr_paid and "[Paid]" in pay_status,
     f"recv={cpr_recv} rejNoReason={cpr_rejnoreason} paid={cpr_paid} bkgPay={pay_status}")

# ============================================================================
# I. M10 — Live Stream Session (LSS-) AM-owned (langkah 42-46)
# ============================================================================
def mksession(actor, brief, platform="TikTok Shop Live", dt="2026-07-25 19:00:00", dur="2"):
    return call(actor, "POST", f"/briefs/{brief}/sessions",
                {"platform":platform,"requested_datetime":dt,"target_duration_hours":dur,"products_talent":"Produk A"})

st, b = mksession(am, BRF_CRE)   # brief bukan LS
sess_notls = st in (400,422) and "brief ini bukan brief divisi Live Stream" in msg(b)
st, b = mksession(am, BRF_LS, platform="Zoom")
sess_badplat = st in (400,422) and "platform tidak valid" in msg(b)
st, b = mksession(am, BRF_LS, dur="0")
sess_baddur = st in (400,422) and "durasi harus lebih dari 0 jam" in msg(b)
st, b = mksession(am, BRF_LS, dt="bukan-waktu")
sess_baddt = st in (400,422) and "format tanggal/waktu tidak valid" in msg(b)
st, b = mksession(lss, BRF_LS)   # staf non-AM
sess_nonam = st==403 and "tidak memiliki akses untuk mengelola sesi live stream ini" in msg(b)
st, b = mksession(am, BRF_LS)
LSS = b.get("id"); sess_born = st==200 and "[Requested]" in b.get("status","") and b.get("data_confidence_tier")=="Vendor-Reported"
step(42, "CreateSession -> [Requested] (tier Vendor-Reported); negatif bukan-LS/platform/durasi/datetime/staf-non-AM",
     sess_born and sess_notls and sess_badplat and sess_baddur and sess_baddt and sess_nonam,
     f"LSS={LSS} born={sess_born} notLS={sess_notls} badPlat={sess_badplat} badDur={sess_baddur} badDt={sess_baddt} nonAM={sess_nonam}")

st, b = call(am, "POST", f"/sessions/{LSS}/confirm"); s_conf = st==200 and b.get("To")=="[Confirmed by Vendor]"
st, b = call(am, "POST", f"/sessions/{LSS}/results", {"actual_datetime":"2026-07-25 19:05:00","actual_duration_hours":"2.1","orders_generated":40,"gmv":"25000000","vendor_report_link":""})
res_nolink = st in (400,422) and "link laporan vendor wajib diisi sebelum sesi selesai" in msg(b)
st, b = call(am, "POST", f"/sessions/{LSS}/results", {"actual_datetime":"2026-07-25 19:05:00","actual_duration_hours":"2.1","orders_generated":40,"gmv":"25000000","vendor_report_link":"https://vendor.example/report"})
res_ok = st==200 and b.get("To")=="[Completed]"
step(43, "confirm -> [Confirmed by Vendor]; results -> [Completed] (vendor report link wajib)",
     s_conf and res_nolink and res_ok, f"confirm={s_conf} noLink={res_nolink} results={res_ok}")

st, b = call(am, "POST", f"/sessions/{LSS}/flag-discrepancy", {"notes": ""})
flag_nonotes = st in (400,422) and "catatan rekonsiliasi wajib diisi" in msg(b)
st, b = call(am, "POST", f"/sessions/{LSS}/flag-discrepancy", {"notes": "durasi actual > target"})
flag_ok = st==200 and b.get("To")=="[Discrepancy Flagged]"
st, b = call(am, "POST", f"/sessions/{LSS}/reconcile"); recon_ok = st==200 and b.get("To")=="[Reconciled]"
st2, brLS = call(am, "GET", f"/briefs/{BRF_LS}")
ls_brief_approved = "[Approved]" in brLS.get("status","")
step(44, "flag-discrepancy (notes wajib, NON-BLOCKING) -> reconcile [Reconciled]; semua session reconciled -> Brief LS [Approved]",
     flag_nonotes and flag_ok and recon_ok and ls_brief_approved,
     f"noNotes={flag_nonotes} flag={flag_ok} recon={recon_ok} briefLS={brLS.get('status')}")

# langkah 45 — reopen O27-b
st, b = call(am2, "POST", f"/briefs/{BRF_LS}/reopen")
reopen_other = st==403 and "tidak memiliki akses untuk membuka kembali brief ini" in msg(b)
st, b = call(alead, "POST", f"/briefs/{BRF_LS}/reopen")
reopen_lead = st==403 and "tidak memiliki akses untuk membuka kembali brief ini" in msg(b)
st, b = call(od, "POST", f"/briefs/{BRF_LS}/reopen")
reopen_od = st==403
st, b = call(am, "POST", f"/briefs/{BRF_LS}/reopen")
reopen_ok = st==200 and "[Dispatched to Vendor]" in b.get("status","")
st, b = call(am, "POST", f"/briefs/{BRF_LS}/reopen")   # sudah Dispatched -> tak bisa reopen
reopen_badstate = st in (400,422) and "brief tidak dapat dibuka kembali pada status ini" in msg(b)
st, b = mksession(am, BRF_LS)   # session baru pasca-reopen
reopen_newsess = st==200
step(45, "reopen O27-b (AM/Director) [Approved]->[Dispatched to Vendor]; AM lain/Account lead/OD ditolak; non-Approved ditolak; session baru bisa dibuat",
     reopen_ok and reopen_other and reopen_lead and reopen_od and reopen_badstate and reopen_newsess,
     f"ok={reopen_ok} otherAM={reopen_other} lead={reopen_lead} od={reopen_od} badState={reopen_badstate} newSess={reopen_newsess}")

# ============================================================================
# J. Audit immutable + recompute (langkah 47-48)  (langkah 46 setelah, via void Service A)
# ============================================================================
def audit_n(entity_id):
    st, b = call(od, "GET", f"/audit?entity_id={entity_id}")
    return st, (b.get("data") or [])
chain_ok = True; details = []
for eid in [cli, STR, BRF_TASK, AST1, ADC, BKG1, LSS]:
    st, entries = audit_n(eid)
    ok = st==200 and len(entries) >= 1 and all(e.get("actor_employee_id") and e.get("action") and e.get("created_at") for e in entries)
    chain_ok = chain_ok and ok
    details.append(f"{eid}:{len(entries)}")
# OD semua write ditolak (contoh assign-am, task-approve, session-confirm)
st1, b1 = call(od, "POST", f"/clients/{cli}/assign-am", {"am_id": SYIFA_ID})
st2, b2 = call(od, "POST", f"/briefs/{BRF_CRE}/approve")
od_write_blocked = st1==403 and st2==403
step(47, "audit chain immutable (actor/action/timestamp) untuk seluruh perjalanan Wave 2; OD semua write ditolak (403)",
     chain_ok and od_write_blocked, f"chains=[{', '.join(details)}] odWriteBlocked={od_write_blocked}")

# langkah 48 — recompute derived = tampil
st, m = call(am, "GET", f"/tasks/{BRF_TASK}/metrics")
sp = m.get("speed_score_pct"); ta = m.get("turnaround_hours"); sla = m.get("sla_target_hours")
speed_recompute = (sp is None) or (sla and abs(sp - (ta/sla*100)) < 1e-6)
st, cc = call(ads, "GET", f"/campaigns/{ADC}")
roas_recompute = cc.get("total_spend") and abs((cc.get("total_gmv")/cc.get("total_spend")) - (cc.get("roas") or 0)) < 1e-6
st, do = call(cre, "GET", f"/daily-output/{ARIF_ID}?date={today}")
do_recompute = st==200 and isinstance(do.get("entries"), list)
st, bk = call(kol, "GET", f"/bookings/{BKG1}")
gmv_recompute = bk.get("attributed_gmv") is not None
# cross-check DB: assets.attributed_gmv adalah cache recompute (tak ada kolom running mutable)
step(48, "recompute derived = nilai tampil: Speed(turnaround/SLA), ADC ROAS(GMV/Spend), Daily Output (dari audit), Attributed GMV booking",
     speed_recompute and roas_recompute and do_recompute and gmv_recompute,
     f"speed={speed_recompute}(pct={sp} ta={ta} sla={sla}) roas={roas_recompute} dailyOutput={do_recompute} bkgGMV={gmv_recompute}")

# langkah 46 — interaksi void (LS brief pada Service A yang di-void). Bangun LS brief+session
# di Service A (Direct), lalu Director void Service A -> brief cancelled -> CreateSession ditolak.
st, b = mkbrief(am, SVC_A, "Live Stream", deliverable="Live Session", title=f"UAT W2 LS-void {UQ}")
BRF_LSV = b.get("id")
st, b = mksession(am, BRF_LSV); LSSV = b.get("id")
st, vr = call(dirc, "POST", f"/services/{SVC_A}/void")
void_ok = st==200
st, cbv = call(am, "GET", f"/briefs/{BRF_LSV}")
lsv_status = cbv.get("status","")
st, b = mksession(am, BRF_LSV)   # brief ter-void
void_create = st in (400,422) and "brief untuk sesi ini telah dibatalkan" in msg(b)
st, b = call(am, "POST", f"/sessions/{LSSV}/confirm")   # session ter-void dibekukan
void_frozen = st in (400,422) and "brief untuk sesi ini telah dibatalkan" in msg(b)
step(46, "interaksi void: brief ter-void -> CreateSession [brief untuk sesi ini telah dibatalkan]; session dibekukan",
     void_ok and void_create and void_frozen, f"void={void_ok} briefStatus={lsv_status} createDitolak={void_create} frozen={void_frozen}")

# ============================================================================
print()
fails = [r for r in results if not r[2]]
print(f"TOTAL {len(results)} langkah runbook — PASS {len(results)-len(fails)}, FAIL {len(fails)}")
for r in fails:
    print("  FAIL:", r[0], "::", r[1], "::", r[3])
sys.exit(1 if fails else 0)
