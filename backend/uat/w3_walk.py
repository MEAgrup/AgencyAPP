#!/usr/bin/env python3
# W3 UAT walk — Wave 3 gate-exit runbook (docs/handoff/W3_UAT_RUNBOOK.md), langkah 2-41.
# Mengeksekusi perjalanan Wave 3 (M3, M2, M11, M13, M14, M15-C1 + CAT-1) lewat API live
# pada stack UAT yang sudah berjalan (127.0.0.1:8080, boot README §"UAT login gate").
# Pola identik w2_walk.py: login helper, data unik per run (UQ), satu assertion = satu
# cek status/pesan-BI/field PERSIS seperti runbook; penomoran step = penomoran runbook.
# Precondition (rantai W2: klien released + AM SYIFA + Service+Brief Ads/Creative + Asset
# + ADC) dibangun sendiri via API. Tidak mengubah kode produk; hanya file ini yang baru.
#
# Langkah yang TIDAK terjangkau API real-time (dicatat SKIP + alasan + di mana ter-cover):
#   - 28 EvClientBandDrop (butuh 2 periode; sweep hanya bulan-tutup-terakhir, now=time.Now()
#     tak injectable) -> snapshot_db_test.go.
#   - 29 Alpha ~74,56 (vektor terkunci health_test.go; data walk real-time beda).
#   - 34 angka Kenny 86.4/+2/88.4 (vektor terkunci profile_test/snapshot_db_test; June real beda).
import json, sys, time, decimal, urllib.parse, urllib.request, urllib.error, http.cookiejar

BASE = "http://127.0.0.1:8080/api/v1"
UQ = str(int(time.time()) % 100000000)
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

def skip(no, desc, reason):
    results.append((no, desc, None, reason))
    print(f"SKIP  [{no}] {desc} :: {reason}")

def msg(b): return (b or {}).get("message", "")
def qenc(s): return urllib.parse.quote(s, safe="")

# ============================================================================
# LANGKAH 2 — login lintas peran Wave 3 + negatif auth
# ============================================================================
insan, me_insan = login("insanfr17@gmail.com")        # Marketing staff A (owner)
tri,   me_tri   = login("arivlokananta@gmail.com")    # Marketing staff B (reassign target)
mlead, me_mlead = login("uat.marketing1@cdps.local")  # Marketing lead (fixture O34) UATMKT0001
sales, me_sales = login("SAFFIRAMARWAH@GMAIL.COM")    # Sales staff (email uppercase)
head,  me_head  = login("c.nurhayati14@gmail.com")    # Sales Head
alead, me_alead = login("Anthy.handayani@gmail.com")  # Account Lead YULIANTI
am,    me_am    = login("syifanuralya@gmail.com")     # AM SYIFA (Account staff, owning)
am2,   me_am2   = login("sepriharyani95@gmail.com")   # AM alt SEPRI
cre,   me_cre   = login("marifnurrohman07@gmail.com") # Creative staff ARIF (PIC)
cre2,  me_cre2  = login("assifa.shakilla9c@gmail.com")# Creative staff alt ASSIFA
crelead, me_crl = login("uat.creative1@cdps.local")   # Creative lead (fixture)
ads,   me_ads   = login("kannyagathon@gmail.com")     # Ads staff KENNY (scored M14)
adslead, me_adl = login("uat.ads1@cdps.local")        # Ads lead (fixture)
fin,   me_fin   = login("uat.finance1@cdps.local")    # Finance staff (fixture)
od,    me_od    = login("orendy9@gmail.com")          # OD OKFA (read-only)
dirc,  me_dir   = login("uat.director1@cdps.local")   # Director (fixture)

INSAN_ID = me_insan["employee"]["employee_id"]
TRI_ID   = me_tri["employee"]["employee_id"]
MLEAD_ID = me_mlead["employee"]["employee_id"]
SALES_ID = me_sales["employee"]["employee_id"]
YULI_ID  = me_alead["employee"]["employee_id"]
SYIFA_ID = me_am["employee"]["employee_id"]
SEPRI_ID = me_am2["employee"]["employee_id"]
ARIF_ID  = me_cre["employee"]["employee_id"]
KENNY_ID = me_ads["employee"]["employee_id"]

roles_ok = (me_insan["role"]["division"]=="Marketing" and me_insan["role"]["level"]=="staff" and
            me_tri["role"]["division"]=="Marketing" and me_tri["role"]["level"]=="staff" and
            me_mlead["role"]["division"]=="Marketing" and me_mlead["role"]["level"]=="lead" and
            me_am["role"]["division"]=="Account" and me_am["role"]["level"]=="staff" and
            me_alead["role"]["level"]=="lead" and me_ads["role"]["division"]=="Ads" and
            me_od["role"]["od"] and me_dir["role"]["director"])
step(2, "login lintas peran Wave 3 (Marketing staf/lead, OD, Director, dll); role resolution benar", roles_ok,
     f"INSAN={me_insan['role']['division']}/{me_insan['role']['level']} MKTlead={me_mlead['role']['division']}/{me_mlead['role']['level']} OD={me_od['role']['od']} DIR={me_dir['role']['director']}")

op = opener(); st, b = call(op, "POST", "/auth/login", {"email": "insanfr17@gmail.com", "password": "salahsandi"})
step("2b", "password salah -> [email atau password salah]", st==401 and "email atau password salah" in msg(b), f"{st} {msg(b)}")
op = opener(); st, b = call(op, "POST", "/auth/login", {"email": f"orang.luar.{UQ}@nowhere.test", "password": "rahasia123"})
step("2c", "email luar roster ditolak", st in (401,503), f"{st} {msg(b)}")
skip("2d", "HRIS-down [sistem HRIS tidak dapat dihubungi...]", "dilarang mematikan mockhris; login-path lain PASS (preseden W2 2d)")

# ============================================================================
# B. M3-C1 — Campaign core (langkah 4-8)
# ============================================================================
def mkcamp(actor, name, channel="TikTok Ads", online=True, offline=False, start="2026-06-01"):
    return call(actor, "POST", "/marketing/campaigns",
                {"name": name, "channel": channel, "online": online, "offline": offline, "start_date": start})

# langkah 4 — field wajib tak lengkap -> ditolak, tak ada CMP- di-mint
st, b = mkcamp(insan, "", channel="", online=False, offline=False, start="")
inc1 = st==422 and "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" == msg(b)
st, b = mkcamp(insan, f"Camp NoChan {UQ}", channel="", online=True)
inc2 = st==422 and "data tidak lengkap" in msg(b)
st, b = mkcamp(insan, f"Camp NoSelect {UQ}", online=False, offline=False)
inc3 = st==422 and "data tidak lengkap" in msg(b)
step(4, "create field wajib tak lengkap -> [data tidak lengkap...]; tak ada CMP- di-mint (house rule 1)",
     inc1 and inc2 and inc3, f"empty={inc1} noChannel={inc2} noSelect={inc3}")

# langkah 5 — create valid -> Draft; owner=creator; divisi lain ditolak
st, b = mkcamp(insan, f"Camp Lifecycle {UQ}", channel="TikTok Ads", online=True)
CMP_B = b.get("id")
c5_ok = st==200 and CMP_B and CMP_B.startswith("CMP-") and b.get("status")=="Draft" and b.get("owner_employee_id")==INSAN_ID
st, b = mkcamp(am, f"Camp AMbad {UQ}")   # AM (divisi Account) create -> forbidden
c5_neg = st==403 and "[anda tidak memiliki akses ke data ini]" == msg(b)
step(5, "create valid -> CMP- status Draft (tanpa bracket), owner=INSAN; divisi lain (AM) create -> [anda tidak memiliki akses ke data ini]",
     c5_ok and c5_neg, f"CMP={CMP_B} draftOK={c5_ok} amDitolak={c5_neg}")

# langkah 6 — lifecycle via engine
def tr(actor, cid, to): return call(actor, "POST", f"/marketing/campaigns/{cid}/transition", {"to": to})
st, r1 = tr(insan, CMP_B, "Active");   l_active = st==200
st, r2 = tr(insan, CMP_B, "Paused");   l_paused = st==200
st, r3 = tr(insan, CMP_B, "Active");   l_reactive = st==200
st, r4 = tr(insan, CMP_B, "Closed");   l_closed = st==200
st, cb = call(insan, "GET", f"/marketing/campaigns/{CMP_B}")
end_set = cb.get("status")=="Closed" and cb.get("end_date") not in (None, "")
st, r5 = tr(insan, CMP_B, "Archived"); l_archived = st==200
# edge ilegal pada campaign FRESH (biar tak terganggu status terminal CMP_B)
st, bf = mkcamp(insan, f"Camp Illegal {UQ}"); CMP_ILL = bf.get("id")
st, b = tr(insan, CMP_ILL, "Closed");   ill1 = st==422 and "[transisi status tidak diizinkan]" == msg(b)
tr(insan, CMP_ILL, "Active")
st, b = tr(insan, CMP_ILL, "Archived"); ill2 = st==422 and "transisi status tidak diizinkan" in msg(b)
st, b = tr(insan, CMP_ILL, "Paused")
st, b = tr(insan, CMP_ILL, "Draft");    ill3 = st==422 and "transisi status tidak diizinkan" in msg(b)
step(6, "lifecycle Draft->Active<->Paused->Closed(+end_date/set_end_date)->Archived; edge ilegal -> [transisi status tidak diizinkan]",
     l_active and l_paused and l_reactive and l_closed and end_set and l_archived and ill1 and ill2 and ill3,
     f"active={l_active} paused={l_paused} react={l_reactive} closed={l_closed} endSet={end_set} arch={l_archived} illDraftClosed={ill1} illActiveArch={ill2} illPausedDraft={ill3}")

# langkah 7 — reassign ownership (lead/Director), negatif staff/target invalid
st, br = mkcamp(insan, f"Camp Reassign {UQ}"); CMP_RE = br.get("id")
st, b = call(insan, "POST", f"/marketing/campaigns/{CMP_RE}/reassign", {"owner_employee_id": TRI_ID})  # staff owner reassign
re_staff = st==403 and "[anda tidak memiliki akses ke data ini]" == msg(b)
st, b = call(mlead, "POST", f"/marketing/campaigns/{CMP_RE}/reassign", {"owner_employee_id": SYIFA_ID})  # target bukan Marketing staff
re_badtgt1 = st==404 and "[data tidak ditemukan]" == msg(b)
st, b = call(mlead, "POST", f"/marketing/campaigns/{CMP_RE}/reassign", {"owner_employee_id": MLEAD_ID})   # target lead (level != staff)
re_badtgt2 = st==404 and "data tidak ditemukan" in msg(b)
st, b = call(mlead, "POST", f"/marketing/campaigns/{CMP_RE}/reassign", {"owner_employee_id": TRI_ID})     # valid (lead reassign to staff TRI)
re_ok = st==200 and b.get("owner_employee_id")==TRI_ID
step(7, "reassign ke TRI oleh Marketing lead (fixture); staff reassign ditolak; target bukan Marketing-staff-aktif -> [data tidak ditemukan]",
     re_ok and re_staff and re_badtgt1 and re_badtgt2,
     f"reassignOK={re_ok} staffDitolak={re_staff} tgtAM={re_badtgt1} tgtLead={re_badtgt2}")

# langkah 8 — visibilitas §5
st, lst_insan = call(insan, "GET", "/marketing/campaigns")
insan_ids = {c["id"] for c in (lst_insan.get("data") or [])}
insan_ownonly = all(c["owner_employee_id"]==INSAN_ID for c in (lst_insan.get("data") or [])) and CMP_RE not in insan_ids
st, lst_tri = call(tri, "GET", "/marketing/campaigns")
tri_ids = {c["id"] for c in (lst_tri.get("data") or [])}
tri_sees_reassigned = CMP_RE in tri_ids and all(c["owner_employee_id"]==TRI_ID for c in (lst_tri.get("data") or []))
st, lst_lead = call(mlead, "GET", "/marketing/campaigns")
lead_ids = {c["id"] for c in (lst_lead.get("data") or [])}
lead_all = CMP_RE in lead_ids and CMP_B in lead_ids and any(c["owner_employee_id"]==INSAN_ID for c in (lst_lead.get("data") or []))
st, lst_od = call(od, "GET", "/marketing/campaigns"); od_all = st==200 and CMP_RE in {c["id"] for c in (lst_od.get("data") or [])}
st, lst_dir = call(dirc, "GET", "/marketing/campaigns"); dir_all = st==200 and CMP_RE in {c["id"] for c in (lst_dir.get("data") or [])}
st, b = call(am, "GET", "/marketing/campaigns"); other_deny = st==403 and "[anda tidak memiliki akses ke data ini]" == msg(b)
step(8, "visibilitas: staf own-only; TRI lihat pasca-reassign; lead/OD/Director SEMUA; divisi lain (AM) ditolak",
     insan_ownonly and tri_sees_reassigned and lead_all and od_all and dir_all and other_deny,
     f"insanOwnOnly={insan_ownonly} triSees={tri_sees_reassigned} leadAll={lead_all} od={od_all} dir={dir_all} amDeny={other_deny}")

# ============================================================================
# C. M3-C2 — Linkage M1/M0 (langkah 9-13)
# ============================================================================
def bulk(actor, campaign_id, name, phone):
    return call(actor, "POST", "/leads/bulk",
                {"campaign_id": campaign_id, "rows": [{"lead_name": name, "phone_number": phone}]})

# campaign ORIGIN (Draft) -> bulk import auto-activates (O13)
st, bo = mkcamp(insan, f"Camp Origin {UQ}", channel="TikTok Ads"); CMP_ORIGIN = bo.get("id")
st, b = bulk(insan, CMP_ORIGIN, f"W3 Origin Lead {UQ}", "08131"+UQ)
imp1 = st==200 and b.get("imported")==1
LEAD_ORIGIN = (b.get("rows") or [{}])[0].get("lead_id")
st, co = call(insan, "GET", f"/marketing/campaigns/{CMP_ORIGIN}")
auto1 = co.get("status")=="Active"
# campaign PAUSED -> bulk import auto-activates Paused->Active
st, bp = mkcamp(insan, f"Camp Paused {UQ}", channel="Instagram Organik"); CMP_PAUSED = bp.get("id")
tr(insan, CMP_PAUSED, "Active"); tr(insan, CMP_PAUSED, "Paused")
st, b = bulk(insan, CMP_PAUSED, f"W3 Paused Lead {UQ}", "08132"+UQ)
imp2 = st==200 and b.get("imported")==1
LEAD_PAUSED = (b.get("rows") or [{}])[0].get("lead_id")
st, cp = call(insan, "GET", f"/marketing/campaigns/{CMP_PAUSED}")
auto2 = cp.get("status")=="Active"
step(9, "O13 auto-activate: bulk import campaign_id=Draft -> Draft->Active + import jalan; ulang campaign Paused -> Paused->Active",
     imp1 and auto1 and imp2 and auto2,
     f"draftImp={imp1} draft->Active={auto1} pausedImp={imp2} paused->Active={auto2}")

# langkah 10 — Closed/Archived diblokir; unknown -> not found
st, bc = mkcamp(insan, f"Camp Closed {UQ}"); CMP_CLOSED = bc.get("id")
tr(insan, CMP_CLOSED, "Active"); tr(insan, CMP_CLOSED, "Closed")
st, b = bulk(insan, CMP_CLOSED, f"W3 Closed Lead {UQ}", "08133"+UQ)
closed_block = b.get("imported")==0 and any("[campaign belum/tidak aktif, lead tidak bisa diimport]"==r.get("reason","") for r in (b.get("rows") or []))
st, ba = mkcamp(insan, f"Camp Archived {UQ}"); CMP_ARCH = ba.get("id")
tr(insan, CMP_ARCH, "Active"); tr(insan, CMP_ARCH, "Closed"); tr(insan, CMP_ARCH, "Archived")
st, b = bulk(insan, CMP_ARCH, f"W3 Arch Lead {UQ}", "08134"+UQ)
arch_block = b.get("imported")==0 and any("campaign belum/tidak aktif" in r.get("reason","") for r in (b.get("rows") or []))
st, b = bulk(insan, "CMP-000000-9999", f"W3 Ghost {UQ}", "08135"+UQ)
ghost = b.get("imported")==0 and any("[data tidak ditemukan]"==r.get("reason","") for r in (b.get("rows") or []))
step(10, "import campaign Closed/Archived DIBLOKIR [campaign belum/tidak aktif, lead tidak bisa diimport]; campaign tak dikenal -> [data tidak ditemukan]",
     closed_block and arch_block and ghost, f"closedBlock={closed_block} archBlock={arch_block} unknown={ghost}")

# langkah 11 — Source auto dari Channel + Origin/Last-Touch (verifikasi SELECT read-only)
import subprocess
def sqlq(q):
    out = subprocess.run(["mysql","-ucdps","-pcdps_dev","-h127.0.0.1","cdps","-N","-e",q],
                         capture_output=True, text=True).stdout.strip()
    return [f.strip() for f in out.split("\t")]
row = sqlq(f"SELECT source, origin_campaign_id, last_touch_campaign_id FROM leads WHERE id='{LEAD_ORIGIN}'")
src_iklan = row[0]=="Leads - Iklan"           # TikTok Ads -> Leads - Iklan (mapped)
origin_ok = row[1]==CMP_ORIGIN and row[2]==CMP_ORIGIN
rowp = sqlq(f"SELECT source FROM leads WHERE id='{LEAD_PAUSED}'")
src_unmapped = rowp[0]=="Instagram Organik"    # unmapped channel -> string as-is
step(11, "Source auto: TikTok Ads->[Leads - Iklan]; channel unmapped->string apa adanya; Origin=Last-Touch=campaign (immutable) [SELECT read-only]",
     src_iklan and origin_ok and src_unmapped,
     f"srcIklan={src_iklan}({row[0]}) origin={origin_ok} srcUnmapped={src_unmapped}({rowp[0]})")

# ---- Origin chain -> closing (langkah 12) : bangun CLIENT_MAIN (reused M11/M13/M14) ----
st, msl = call(head, "GET", "/master-services")
flat = sorted([s for s in msl["data"] if s.get("pricing_mode")=="flat" and s.get("active")], key=lambda s: s["id"])
assert len(flat) >= 2, "butuh >=2 layanan flat di MSL"
SA, SB = flat[0], flat[1]
sel = [{"master_service_id": SA["id"], "quantity": 1, "amount": ""},
       {"master_service_id": SB["id"], "quantity": 1, "amount": ""}]
pa = decimal.Decimal(str(SA["standard_price"]).split(".")[0])
pb = decimal.Decimal(str(SB["standard_price"]).split(".")[0])

def qualify_form(uq):
    return {"nama_pic":"PIC W3","toko":f"W3 Toko {uq}","kota":"Jakarta","link_toko":"https://toko.example/w3",
            "kategori":"Fashion","platform":"Shopee","store_link":"https://toko.example/w3",
            "gmv_baseline":"100000000","target_gmv":"200000000","marketing_budget":"10000000","services": sel}

def drive_to_close(att_id, uq):
    call(sales, "POST", f"/attempts/{att_id}/contacted")
    st, b = call(sales, "POST", f"/attempts/{att_id}/qualify", qualify_form(uq)); assert st==200, f"qualify {st} {b}"
    lines = [{"master_service_id": SA["id"],"proposed_price":str(pa),"commission_rule":SA["commission_rule"],"payment_terms":"custom"},
             {"master_service_id": SB["id"],"proposed_price":str(pb),"commission_rule":SB["commission_rule"],"payment_terms":"custom"}]
    st, b = call(sales, "POST", f"/attempts/{att_id}/negotiation", {"lines": lines, "no_nego": False}); assert st==200, f"nego {st} {b}"
    call(head, "POST", f"/attempts/{att_id}/negotiation/decision", {"decision":"approve","note":"UAT W3"})
    grand = pa + pb
    i1 = (grand/3).quantize(decimal.Decimal("1"), rounding=decimal.ROUND_DOWN); i2 = i1; i3 = grand - i1 - i2
    insts = [{"amount":str(i1),"due_date":"2026-08-01"},{"amount":str(i2),"due_date":"2026-09-01"},{"amount":str(i3),"due_date":"2026-10-01"}]
    good = {"parties":{"primary_salesperson_id":SALES_ID,"allocations":[{"salesperson_id":SALES_ID,"basis_points":10000}],
            "commission_payment_pic_id":SALES_ID},"payment_scheme":"[Termin]","installments":insts}
    st, b = call(sales, "POST", f"/attempts/{att_id}/close", good); assert b.get("client_id"), f"close {st} {b}"
    cli, trx = b.get("client_id"), b.get("transaction_id")
    call(sales, "POST", f"/clients/{cli}/payment-intent", {"payment_intent":"[Termin]"})
    st, tr_ = call(fin, "GET", f"/transactions/{trx}")
    il = (tr_.get("transaction") or {}).get("installments") or []
    call(fin, "POST", f"/transactions/{trx}/verify", {"installment_id":il[0]["id"],"amount":str(i1),
         "received_date":"2026-07-17","proof_of_payment":"https://bukti.example/w3"})
    return cli, trx, grand

# CLIENT_MAIN via the ORIGIN lead (claim pool -> close): stamps origin_campaign_id
st, b = call(sales, "POST", f"/leads/{LEAD_ORIGIN}/claim")
ATT_MAIN = (b.get("attempt") or {}).get("id")
assert ATT_MAIN, f"claim gagal: {st} {b}"
CLIENT_MAIN, TRX_MAIN, GRAND_MAIN = drive_to_close(ATT_MAIN, UQ+"M")
cli_origin = sqlq(f"SELECT origin_campaign_id FROM clients WHERE id='{CLIENT_MAIN}'")[0]
step(12, "closing lead ber-origin -> CLI mewarisi origin_campaign_id (stamp permanen ke Client) [SELECT read-only]",
     cli_origin==CMP_ORIGIN, f"client={CLIENT_MAIN} origin={cli_origin} (expect {CMP_ORIGIN})")

# langkah 13 — rollup derived-on-read
st, roll = call(insan, "GET", f"/marketing/campaigns/{CMP_ORIGIN}/rollup")
r_ok = (st==200 and roll.get("leads_generated")==1 and roll.get("real_leads")==1 and
        roll.get("clients_won")==1 and roll.get("total_value_won_idr","").startswith("Rp. "))
st, b = call(am, "GET", f"/marketing/campaigns/{CMP_ORIGIN}/rollup")  # divisi lain
r_neg = st==403 and "[anda tidak memiliki akses ke data ini]" == msg(b)
st, b = call(insan, "GET", "/marketing/campaigns/CMP-000000-9999/rollup")
r_nf = st==404 and "[data tidak ditemukan]" == msg(b)
step(13, "rollup derived: leads_generated=1, real_leads=1 (>=Qualified), clients_won=1, total_value_won (Rp...); negatif akses/not-found",
     r_ok and r_neg and r_nf,
     f"leads={roll.get('leads_generated')} real={roll.get('real_leads')} won={roll.get('clients_won')} val={roll.get('total_value_won_idr')} amDeny={r_neg} nf={r_nf}")

# ============================================================================
# D. M2-C1 — Marketing Performance Record + Auto-Metrics (langkah 14-17)
# ============================================================================
# gunakan campaign owned by INSAN (CMP_B lifecycle sudah Archived; pakai CMP_ORIGIN owned INSAN)
CMP_PERF = CMP_ORIGIN
st, b = call(insan, "POST", f"/marketing/campaigns/{CMP_PERF}/performance", {"budget": ""})
p_inc1 = st==422 and "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" == msg(b)
st, b = call(insan, "POST", f"/marketing/campaigns/{CMP_PERF}/performance", {"budget": "0"})
p_inc2 = st==422 and "data tidak lengkap" in msg(b)
st, b = call(insan, "POST", f"/marketing/campaigns/{CMP_PERF}/performance", {"budget": "abc"})
p_inc3 = st==422 and "data tidak lengkap" in msg(b)
st, b = call(insan, "POST", f"/marketing/campaigns/{CMP_PERF}/performance", {"budget": "20000000"})
p_ok = st==200 and b.get("budget_idr","").startswith("Rp. ")
st, b = call(insan, "POST", f"/marketing/campaigns/{CMP_PERF}/performance", {"budget": "20000000"})
p_dup = st==409 and "[performance record untuk campaign ini sudah ada]" == msg(b)
step(14, "perf record: budget kosong/<=0/non-angka -> [data tidak lengkap...]; budget valid -> lahir; record kedua -> [performance record untuk campaign ini sudah ada] (409)",
     p_inc1 and p_inc2 and p_inc3 and p_ok and p_dup,
     f"empty={p_inc1} zero={p_inc2} nan={p_inc3} ok={p_ok} dup={p_dup}")

# langkah 15 — gate tulis M2 §5 Rule 3: Marketing lead non-owner ditolak; OD ditolak; owner edit OK
st, b = call(mlead, "POST", f"/marketing/campaigns/{CMP_PERF}/performance/budget", {"budget": "30000000"})
g_lead = st==403 and "[anda tidak memiliki akses ke data ini]" == msg(b)
st, b = call(od, "POST", f"/marketing/campaigns/{CMP_PERF}/performance/budget", {"budget": "30000000"})
g_od = st==403
st, b = call(insan, "POST", f"/marketing/campaigns/{CMP_PERF}/performance/budget", {"budget": "25000000"})
g_owner = st==200 and b.get("budget_idr")=="Rp. 25.000.000,00"
step(15, "gate tulis: Marketing lead NON-owner -> [anda tidak memiliki akses ke data ini]; OD ditolak; owner edit budget OK (audit budget_edited)",
     g_lead and g_od and g_owner, f"leadDeny={g_lead} odDeny={g_od} ownerEdit={g_owner}")

# langkah 16 — Auto-Metrics derived read-only
st, b = call(insan, "GET", f"/marketing/campaigns/{CMP_PERF}/performance")
m = b.get("metrics") or {}
# lead_by_dashboard COUNT Origin=1, lead_real_by_sales=1; money fields Rp / — ; quality NN% atau —
m_ok = (st==200 and str(m.get("lead_by_dashboard"))=="1" and str(m.get("lead_real_by_sales"))=="1" and
        isinstance(m.get("cost_per_lead"), str) and isinstance(m.get("roas"), str))
step(16, "Auto-Metrics derived read-only (lead_by_dashboard=1, lead_real_by_sales=1, CPL/ROAS string IDR/'—')",
     m_ok, f"dash={m.get('lead_by_dashboard')} real={m.get('lead_real_by_sales')} cpl={m.get('cost_per_lead')} roas={m.get('roas')} quality={m.get('lead_quality_rate')}")

# langkah 17 — dashboard split
st, lst_insan_now = call(insan, "GET", "/marketing/campaigns")
insan_owncamps = {c["id"] for c in (lst_insan_now.get("data") or [])}
st, d_insan = call(insan, "GET", "/marketing/performance-dashboard")
d_ids = {r.get("campaign_id") for r in (d_insan.get("data") or [])}
d_staff_own = st==200 and CMP_PERF in d_ids and all(cid in insan_owncamps or cid is None for cid in d_ids)
st, d_lead = call(mlead, "GET", "/marketing/performance-dashboard")
lead_dids = {r.get("campaign_id") for r in (d_lead.get("data") or [])}
d_lead_all = st==200 and CMP_RE in lead_dids and CMP_PERF in lead_dids   # sees campaigns across staff (incl TRI-owned)
st, d_od = call(od, "GET", "/marketing/performance-dashboard"); d_od_all = st==200
st, b = call(am, "GET", "/marketing/performance-dashboard"); d_neg = st==403 and "[anda tidak memiliki akses ke data ini]" == msg(b)
step(17, "dashboard split: staf metrik OWN saja; lead/OD/Director SEMUA (lintas staf); divisi lain ditolak",
     d_staff_own and d_lead_all and d_od_all and d_neg,
     f"staffOwn={d_staff_own} leadAll={d_lead_all} od={d_od_all} amDeny={d_neg}")

# ============================================================================
# PRECONDITION lanjutan — services/briefs/asset/ADC pada CLIENT_MAIN (M11/M13/M14)
# ============================================================================
# release + assign AM SYIFA
st, cb = call(alead, "GET", f"/clients/{CLIENT_MAIN}")
svcs = sorted((cb.get("client") or {}).get("services") or [], key=lambda s: s["id"])
assert len(svcs) >= 2, f"CLIENT_MAIN butuh 2 SVC: {svcs}"
SVC_A = svcs[0]["id"]   # Direct
SVC_B = svcs[1]["id"]   # plan-gated
call(alead, "POST", f"/clients/{CLIENT_MAIN}/assign-am", {"am_id": SYIFA_ID})
# override SVC_B requires Strategy & Plan, buat + approve strategy
call(am, "POST", f"/services/{SVC_B}/strategy-requirement", {"requires_strategy_plan": True, "reason": "engagement butuh Strategy & Plan"})
st, b = call(am, "POST", f"/services/{SVC_B}/strategy",
             {"objective":"Naikkan GMV","target_kpi":"ROAS 4x","divisions_involved":["Creative","Ads"],
              "planned_brief_outline":"Outline","timeline_start":"2026-07-20","timeline_end":"2026-08-20"})
STR = b.get("id")
call(am, "POST", f"/strategies/{STR}/submit")
call(alead, "POST", f"/strategies/{STR}/approve")
# Creative brief (qty 3, PIC diisi via asset) + Ads brief
def mkbrief(actor, svc, division, strategy_id="", qty=1, title=None, deliverable="Video"):
    body={"title": title or f"W3 {division} {UQ}","assigned_division":division,"deliverable_type":deliverable,
          "quantity_target":qty,"due_date":"2026-08-15","priority":"Medium"}
    if strategy_id: body["strategy_id"]=strategy_id
    return call(actor, "POST", f"/services/{svc}/briefs", body)
st, b = mkbrief(am, SVC_B, "Creative", strategy_id=STR, qty=3, title=f"W3 CRE {UQ}"); BRF_CRE = b.get("id")
st, b = mkbrief(am, SVC_B, "Ads", strategy_id=STR, deliverable="Ad Campaign", title=f"W3 ADS {UQ}"); BRF_ADS = b.get("id")
# Two Direct Creative briefs (SVC_A) for dependency test
st, b = mkbrief(am, SVC_A, "Creative", title=f"W3 DEP-SRC {UQ}"); BRF_SRC = b.get("id")
st, b = mkbrief(am, SVC_A, "Creative", title=f"W3 DEP-TGT {UQ}"); BRF_TGT = b.get("id")

# ---- CAT-1 assets: one with hours, one without (both active, PIC ARIF) ----
st, b = call(cre, "POST", f"/briefs/{BRF_CRE}/assets", {"sequence_no":1,"assigned_pic":ARIF_ID}); AST_NOHRS = b.get("id")
st, b = call(cre, "POST", f"/briefs/{BRF_CRE}/assets", {"sequence_no":2,"assigned_pic":ARIF_ID}); AST_HRS = b.get("id")
call(cre, "POST", f"/assets/{AST_NOHRS}/start")   # In Progress (active, no hours)
call(cre, "POST", f"/assets/{AST_HRS}/start")
call(cre, "POST", f"/assets/{AST_HRS}/hours", {"hours": 4})   # hours logged today
# an approved asset for M14 output (seq 3)
st, b = call(cre, "POST", f"/briefs/{BRF_CRE}/assets", {"sequence_no":3,"assigned_pic":ARIF_ID}); AST_APP = b.get("id")
call(cre, "POST", f"/assets/{AST_APP}/start")
call(cre, "POST", f"/assets/{AST_APP}/submit", {"output_link":"https://drive.example/app"})
call(am, "POST", f"/assets/{AST_APP}/review")
call(am, "POST", f"/assets/{AST_APP}/approve")

# ============================================================================
# E. CAT-1 — Sweep EvHoursLoggedReminder (langkah 18)
# ============================================================================
st, b = call(am, "POST", "/assets/reminders/scan")   # AM (divisi lain) -> forbidden
cat_neg = st==403 and "[anda tidak memiliki akses untuk menjalankan pemindaian pengingat Hours Logged]" == msg(b)
st, scan = call(crelead, "POST", "/assets/reminders/scan")   # Creative lead -> ok
cat_scan = st==200 and scan.get("reminders_sent",0) >= 1
st, nb = call(cre, "GET", "/notifications")
notifs = nb.get("data") or []
rem_for_nohrs = any(n.get("event_type")=="m7.hours_logged.reminder" and n.get("entity_id")==AST_NOHRS for n in notifs)
rem_for_hrs = any(n.get("event_type")=="m7.hours_logged.reminder" and n.get("entity_id")==AST_HRS for n in notifs)
step(18, "CAT-1 scan: Asset aktif tanpa Hours -> reminder (m7.hours_logged.reminder ke PIC); Asset ber-Hours -> TIDAK; aktor tak berhak -> [anda tidak memiliki akses untuk menjalankan pemindaian pengingat Hours Logged]",
     cat_neg and cat_scan and rem_for_nohrs and not rem_for_hrs,
     f"amDeny={cat_neg} scanned={scan.get('reminders_sent')} reminderNoHrs={rem_for_nohrs} reminderHrs(expect False)={rem_for_hrs}")

# ============================================================================
# F. M11 — Dependency + gate blocking + My Tasks/board (langkah 19-23)
# ============================================================================
def mkdep(actor, src, tgt, dtype="Blocking", stype="brief", ttype="brief"):
    return call(actor, "POST", "/dependencies",
                {"source_type":stype,"source_id":src,"target_type":ttype,"target_id":tgt,"type":dtype})
# langkah 19 — create + negatif create-time
st, b = call(am, "POST", "/dependencies", {"source_id":"","target_id":"","type":""})
d_inc = st==422 and "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" == msg(b)
st, b = mkdep(am, BRF_SRC, BRF_TGT, dtype="Weird")
d_badtype = st==422 and "[tipe dependency tidak valid: harus Blocking atau Informational]" == msg(b)
st, b = mkdep(am, BRF_SRC, BRF_TGT, stype="asset")
d_badent = st==422 and "[dependency hanya dapat dibuat antar Brief]" == msg(b)
st, b = mkdep(am, BRF_SRC, BRF_SRC)
d_self = st==422 and "[Source dan Target Dependency tidak boleh Brief yang sama]" == msg(b)
st, b = mkdep(am, "BRF-000000-9999", BRF_TGT)
d_nf = st==404 and "[brief tidak ditemukan]" == msg(b)
st, b = mkdep(am, BRF_SRC, BRF_TGT, dtype="Blocking")
DEP1 = b.get("id"); d_ok = st==200 and DEP1 and DEP1.startswith("DEP-") and b.get("status") in ("Pending","Blocking")
step(19, "create Dependency DEP- (status derived); negatif field-wajib/tipe/entity/self/brief-not-found",
     d_ok and d_inc and d_badtype and d_badent and d_self and d_nf,
     f"DEP={DEP1} ok={d_ok} inc={d_inc} badType={d_badtype} badEnt={d_badent} self={d_self} nf={d_nf}")

# langkah 20 — constraint graf + otoritas
# cross-client: butuh brief di client lain -> bangun CLIENT_ALT minimal (1 Direct brief)
st, ba = call(sales, "POST", "/leads", {"lead_name":f"W3 Alt {UQ}","phone_number":"08136"+UQ,"source":"Scouting","email":f"alt{UQ}@ex.com"})
ATT_ALT = (ba.get("attempt") or {}).get("ID") or (ba.get("attempt") or {}).get("id")
CLIENT_ALT, _, _ = drive_to_close(ATT_ALT, UQ+"A")
call(alead, "POST", f"/clients/{CLIENT_ALT}/assign-am", {"am_id": SYIFA_ID})
st, cba = call(am, "GET", f"/clients/{CLIENT_ALT}")
SVC_ALT = sorted((cba.get("client") or {}).get("services") or [], key=lambda s:s["id"])[0]["id"]
st, b = mkbrief(am, SVC_ALT, "Creative", title=f"W3 ALT-BRF {UQ}"); BRF_ALT = b.get("id")
st, b = mkdep(am, BRF_SRC, BRF_ALT)
d_cross = st==422 and "[dependency hanya bisa dibuat antar Brief dalam Client yang sama]" == msg(b)
st, b = mkdep(am, BRF_SRC, BRF_TGT)   # pasangan sudah ada
d_dup = st==422 and "[dependency untuk pasangan Brief ini sudah ada]" == msg(b)
st, b = mkdep(am, BRF_TGT, BRF_SRC)   # membentuk siklus (SRC->TGT sudah ada)
d_cycle = st==422 and "[dependency ini membentuk siklus (circular dependency) dan ditolak]" == msg(b)
st, b = mkdep(cre, BRF_SRC, BRF_TGT)  # staf divisi (Creative) non-Account
d_authz = st==403 and "[hanya Account Manager pemilik klien atau SPV/Lead Account yang dapat membuat Dependency]" == msg(b)
st, b = mkdep(am2, BRF_SRC, BRF_TGT)  # AM non-owner
d_notowner = st==403 and "hanya Account Manager pemilik klien atau SPV/Lead Account" in msg(b)
step(20, "constraint: cross-client / pasangan dobel / siklus ditolak; otoritas staf-divisi & AM non-owner ditolak",
     d_cross and d_dup and d_cycle and d_authz and d_notowner,
     f"cross={d_cross} dup={d_dup} cycle={d_cycle} authz={d_authz} notOwner={d_notowner}")

# langkah 21 — gate blocking (Target final transition [In Review]->[Approved])
# Target: start -> assign PIC ARIF -> submit -> review ; Source belum Approved -> approve Target DIBLOKIR
call(cre, "POST", f"/tasks/{BRF_TGT}/start")
call(crelead, "POST", f"/tasks/{BRF_TGT}/assign-pic", {"pic_id": ARIF_ID})
call(cre, "POST", f"/tasks/{BRF_TGT}/submit")
call(am, "POST", f"/briefs/{BRF_TGT}/review")
st, b = call(am, "POST", f"/briefs/{BRF_TGT}/approve")
gate_msg = f"Brief ini belum bisa lanjut ke [Approved] karena menunggu {BRF_SRC} selesai Approved."
gate_blocked = st==422 and msg(b)==gate_msg
step(21, "gate blocking: approve Target saat Source belum [Approved] -> template §12 'Brief ini belum bisa lanjut ke [Approved] karena menunggu <BRF> selesai Approved.'",
     gate_blocked, f"{st} got={msg(b)!r}")

# langkah 22 — Source -> [Approved] => Dependency Satisfied + EvDependencySatisfied ke PIC Target
call(cre, "POST", f"/tasks/{BRF_SRC}/start")
call(cre, "POST", f"/tasks/{BRF_SRC}/submit")
call(am, "POST", f"/briefs/{BRF_SRC}/review")
st, b = call(am, "POST", f"/briefs/{BRF_SRC}/approve")
src_approved = st==200 and b.get("To")=="[Approved]"
st, dg = call(am, "GET", f"/dependencies/{DEP1}")
dep_satisfied = dg.get("status")=="Satisfied"
st, nb = call(cre, "GET", "/notifications")
dep_notif = any(n.get("event_type")=="m11.dependency.satisfied" and n.get("entity_id")==DEP1 for n in (nb.get("data") or []))
# setelah Source Approved, Target boleh di-approve
st, b = call(am, "POST", f"/briefs/{BRF_TGT}/approve")
tgt_now = st==200 and b.get("To")=="[Approved]"
step(22, "Source->[Approved]: Dependency Satisfied + EvDependencySatisfied (m11.dependency.satisfied) ke PIC Target; Target lalu boleh approve",
     src_approved and dep_satisfied and dep_notif and tgt_now,
     f"srcApproved={src_approved} depSatisfied={dep_satisfied} notif={dep_notif} tgtApproved={tgt_now}")

# langkah 23 — My Tasks + Client Board + dependency listing scoped
st, mt_cre = call(cre, "GET", "/my-tasks"); mt_ok = st==200 and isinstance(mt_cre.get("data"), list)
st, mt_emp = call(cre2, "GET", "/my-tasks"); mt_own = st==200   # ASSIFA own (may be empty)
st, bd = call(am, "GET", f"/board?client={CLIENT_MAIN}")
board_ok = st==200 and isinstance(bd.get("data"), list) and len(bd.get("data"))>=1
st, dl = call(am, f"GET", f"/dependencies?source={BRF_SRC}")
dl_ok = st==200 and any(d["id"]==DEP1 for d in (dl.get("data") or []))
st, dg2 = call(cre, "GET", f"/dependencies/{DEP1}")  # PIC (ARIF) of client unit sees it
dl_scoped = st==200 and dg2.get("id")==DEP1
step(23, "My Tasks (own) + Client Board (kolom universal) + dependency listing scoped visibilitas Client",
     mt_ok and mt_own and board_ok and dl_ok and dl_scoped,
     f"myTasks={mt_ok} ownStaff={mt_own} board={board_ok}({len(bd.get('data') or [])}) depList={dl_ok} scoped={dl_scoped}")

# ============================================================================
# G. M13 — Client Health snapshot (langkah 24-29)
# ============================================================================
st, b = call(od, "POST", "/health/snapshots/scan")  # OD ditolak
h_neg = st==403 and "[anda tidak memiliki akses untuk menjalankan pemindaian skor kesehatan klien]" == msg(b)
st, scan = call(am, "POST", "/health/snapshots/scan")  # AM (Account) ok
h_scan = st==200 and "period" in scan
st, snap = call(am, "GET", f"/clients/{CLIENT_MAIN}/health")
chr_exists = st==200 and snap.get("id","").startswith("CHR-") and snap.get("period_start","").startswith("2026-06")
step(24, "health scan (Account/Director; OD ditolak [...pemindaian skor kesehatan klien]); CHR- lahir untuk klien (period bulan tutup terakhir=Juni 2026)",
     h_neg and h_scan and chr_exists,
     f"odDeny={h_neg} period={scan.get('period')} made={scan.get('snapshots_made')} CHR={snap.get('id')} periodStart={snap.get('period_start')}")

# langkah 25 — components_json 7 sub-score + band + redistribusi/excluded
comps = snap.get("components") or []
band_valid = snap.get("band") in ("Healthy","Watch","At Risk","")
has_excluded_or_included = any(("included" in c) or ("excluded" in c) or ("weight" in c) for c in comps) if comps else True
step(25, "GET health: components per-komponen (raw/capped/bobot/included-excluded), band Healthy/Watch/At Risk, komponen missing->excluded (redistribusi, bukan error)",
     st==200 and band_valid and has_excluded_or_included,
     f"band={snap.get('band')!r} score={snap.get('score_display')} nComp={len(comps)} sample={comps[0] if comps else None}")

# langkah 26 — ROAS toggle
st, b = call(am, "PUT", f"/clients/{CLIENT_MAIN}/health/roas-toggle", {"override": True})
rt_set = st==200 and b.get("override") is True
st, b = call(am, "GET", f"/clients/{CLIENT_MAIN}/health/roas-toggle")
rt_get = st==200 and b.get("override") is True
st, b = call(am, "PUT", f"/clients/{CLIENT_MAIN}/health/roas-toggle", {"override": None})   # clear -> default
rt_clear = st==200 and b.get("override") is None
st, b = call(cre, "PUT", f"/clients/{CLIENT_MAIN}/health/roas-toggle", {"override": True})   # divisi lain
rt_neg = st in (403,404)
step(26, "ROAS toggle: set/get override (audit before->after), clear->NULL default; aktor tak berhak ditolak",
     rt_set and rt_get and rt_clear and rt_neg, f"set={rt_set} get={rt_get} clear={rt_clear} otherDeny={rt_neg}")

# langkah 27 — live preview (derived-on-read, tak disimpan) + trend
st, prev = call(am, "GET", f"/clients/{CLIENT_MAIN}/health/preview")
prev_ok = st==200 and prev.get("preview") is True and prev.get("id","")=="" and prev.get("period_start","").startswith("2026-07")
st, trend = call(am, "GET", f"/clients/{CLIENT_MAIN}/health/trend")
trend_ok = st==200 and isinstance(trend.get("data"), list) and any(s.get("id","").startswith("CHR-") for s in trend.get("data"))
step(27, "live preview (Rule 10) derived-on-read, TIDAK disimpan (preview=true, id kosong, period bulan berjalan Juli); trend=deret snapshot tersimpan",
     prev_ok and trend_ok, f"preview={prev_ok}(prevFlag={prev.get('preview')} id={prev.get('id')!r} p={prev.get('period_start')}) trend={trend_ok}")

# langkah 28 — EvClientBandDrop: butuh 2 periode; sweep hanya bulan-tutup-terakhir
skip(28, "EvClientBandDrop (band turun 2 periode)",
     "TIDAK terjangkau API real-time: sweep hanya skor bulan-kalender-tutup-terakhir (now=time.Now() tak injectable via handler); emisi in-tx INSERT fire-once. Ter-cover unit test module13_health/snapshot_db_test.go")

# langkah 29 — worked example Alpha (vektor terkunci unit test)
skip(29, "worked example Alpha Digital ~74,56 -> band Watch",
     "vektor terkunci module13_health/health_test.go; data walk real-time (period Juni klien-baru) berbeda. Recompute=display (house #4) ter-cover langkah 25/41 & unit test")

# ============================================================================
# H. M14 — Team Performance snapshot (langkah 30-34)
# ============================================================================
# langkah 30 — config KPI weights (Director); Sigma=100; non-Director ditolak
st, wl = call(dirc, "GET", "/performance/config/weights"); w_read = st==200
st, b = call(dirc, "PUT", "/performance/config/weights",
             {"role_type":"Ads","weights":{"speed_score":25,"roas_attainment":30,"gmv_impact":25,"optimization_activity":20}})
w_ok = st==200
st, b = call(dirc, "PUT", "/performance/config/weights",
             {"role_type":"Ads","weights":{"speed_score":25,"roas_attainment":30,"gmv_impact":25,"optimization_activity":10}})
w_not100 = st==400 and "[total bobot KPI harus berjumlah 100]" == msg(b)
st, b = call(ads, "PUT", "/performance/config/weights",
             {"role_type":"Ads","weights":{"speed_score":25,"roas_attainment":30,"gmv_impact":25,"optimization_activity":20}})
w_nondir = st==403 and "[anda tidak memiliki akses untuk mengubah konfigurasi KPI performa]" == msg(b)
st, b = call(od, "PUT", "/performance/config/weights",
             {"role_type":"Ads","weights":{"speed_score":25,"roas_attainment":30,"gmv_impact":25,"optimization_activity":20}})
w_od = st==403
step(30, "config weights (Director): Σ=100 OK; Σ≠100 -> [total bobot KPI harus berjumlah 100]; non-Director/OD tulis -> [anda tidak memiliki akses untuk mengubah konfigurasi KPI performa]",
     w_read and w_ok and w_not100 and w_nondir and w_od,
     f"read={w_read} setOK={w_ok} not100={w_not100} nonDir={w_nondir} od={w_od}")

# langkah 31 — O9 targets placeholder
st, tl = call(dirc, "GET", "/performance/config/targets")
tgts = tl.get("data") or []
t_all_placeholder = st==200 and (len(tgts)==0 or all(t.get("is_placeholder") in (True,1) for t in tgts))
step(31, "O9 targets: semua seed is_placeholder=1 (target periode riil masih TERBUKA, non-blocking)",
     t_all_placeholder, f"nTargets={len(tgts)} allPlaceholder={t_all_placeholder}")

# langkah 32 — Director sweep lintas divisi; non-Director/OD ditolak
st, b = call(ads, "POST", "/performance/snapshots/scan")   # non-Director
pf_nondir = st==403 and "[anda tidak memiliki akses untuk menjalankan pemindaian skor performa tim]" == msg(b)
st, b = call(od, "POST", "/performance/snapshots/scan")     # OD read-only
pf_od = st==403
st, pscan = call(dirc, "POST", "/performance/snapshots/scan")
pf_scan = st==200 and "period" in pscan
st, ks = call(ads, "GET", f"/staff/{KENNY_ID}/performance")
kenny_perf = st==200 and ks.get("id","").startswith("PERF-") and ks.get("role_type")=="Ads" and ks.get("period_start","").startswith("2026-06")
# lead tanpa profile (Marketing) tak dapat snapshot: INSAN Marketing -> 404
st, b = call(insan, "GET", f"/staff/{INSAN_ID}/performance")
mkt_nosnap = st==404 and "[data tidak ditemukan]" == msg(b)
step(32, "perf sweep (Director, lintas divisi): PERF- lahir tiap staf ber-profil (KENNY Ads); non-Director/OD ditolak [...pemindaian skor performa tim]; Marketing staf tanpa profil -> tak ada snapshot",
     pf_nondir and pf_od and pf_scan and kenny_perf and mkt_nosnap,
     f"nonDir={pf_nondir} od={pf_od} period={pscan.get('period')} made={pscan.get('snapshots_made')} KENNY={ks.get('id')} mktNoSnap={mkt_nosnap}")

# langkah 33 — breakdown penuh + Client-Outcome Modifier + team rollup
st, ks = call(ads, "GET", f"/staff/{KENNY_ID}/performance")
bd_full = "components" in ks and "modifier" in ks and ("final_score" in ks) and ("profile_score" in ks)
st, tr_ads = call(adslead, "GET", "/performance/teams/Ads")
team_ok = st==200 and isinstance(tr_ads.get("members"), list) and "average_display" in tr_ads
# AM CHR average (AM breakdown chr_average component) — SYIFA AM
st, ams = call(am, "GET", f"/staff/{SYIFA_ID}/performance")
am_has_snapshot = st==200 and ams.get("role_type")=="AM"
step(33, "breakdown penuh (profile+modifier+final) tiap respons; team rollup simple-average derived-on-read; AM snapshot role_type=AM",
     bd_full and team_ok and am_has_snapshot,
     f"breakdown={bd_full} teamRollup={team_ok}(avg={tr_ads.get('average_display')}) amSnap={am_has_snapshot}")

# langkah 34 — EvPerformancePublished + worked example Kenny (angka SKIP)
st, nb = call(ads, "GET", "/notifications")
perf_notif = any(n.get("event_type")=="m14.performance.published" for n in (nb.get("data") or []))
step(34, "EvPerformancePublished (m14.performance.published) per staf DALAM tx insert (fire-once); [angka Kenny 86.4/+2/88.4 SKIP -> unit test]",
     perf_notif, f"kennyNotif={perf_notif} kennyFinalDisplay={ks.get('score_display')} modifier={ks.get('modifier')}")

# ============================================================================
# I. M15-C1 — Team Portal (langkah 35-39)
# ============================================================================
st, me = call(ads, "GET", "/portal/me")
me_ok = st==200 and ("open_tasks" in me or "tasks" in me or "running_score" in me or "performance" in me)
step(35, "portal/me: open tasks (SLA-risk first) + running Performance Score bulan berjalan (computed-on-read)",
     me_ok, f"{st} keys={sorted(me.keys())}")

st, team = call(alead, "GET", "/portal/team")   # Account lead
team_ok2 = st==200 and ("rollup" in team or "block_queue" in team or "clients" in team.keys() or "Rollup" in team)
st, teamd = call(dirc, "GET", "/portal/team?division=Ads")   # Director any division
team_dir = st==200
step(36, "portal/team (Account lead/Director): team rollup M14 + Client Board ringkas + block-approval queue (delegasi M12)",
     team_ok2 and team_dir, f"team200={team_ok2} keys={sorted(team.keys())} dirDiv={team_dir}")

# langkah 37 — lead divisi non-scored -> 404 by design
st, b = call(mlead, "GET", "/portal/team")   # Marketing lead -> 404 dari rollup M14
p_team404 = st==404 and "[data tidak ditemukan]" == msg(b)
st, b = call(mlead, "GET", "/performance/teams/Marketing")
p_teams404 = st==404 and "[data tidak ditemukan]" == msg(b)
step(37, "edge lead divisi non-scored: portal/team & performance/teams/Marketing -> 404 by design (audiens Rule 10 = divisi ber-skor)",
     p_team404 and p_teams404, f"portalTeam={st} teams404={p_teams404} portal404={p_team404}")

# langkah 38 — Management Dashboard (Director/OD saja)
st, mg_dir = call(dirc, "GET", "/portal/management")
mg_ok = st==200 and ("clients" in mg_dir or "data" in mg_dir or "rows" in mg_dir)
st, mg_od = call(od, "GET", "/portal/management"); mg_od_ok = st==200
st, b = call(am, "GET", "/portal/management"); mg_neg = st==403 and "[anda tidak memiliki akses ke data ini]" == msg(b)
st, b = call(alead, "GET", "/portal/management"); mg_lead = st==403
step(38, "Management Dashboard (Director/OD SAJA): semua klien x CHR terbaru (band/trend/dragging/AM); staf/lead divisi -> [anda tidak memiliki akses ke data ini]",
     mg_ok and mg_od_ok and mg_neg and mg_lead,
     f"dir={mg_ok} od={mg_od_ok} amDeny={mg_neg} leadDeny={mg_lead} keys={sorted(mg_dir.keys())}")

# langkah 39 — M15-C2 Client Portal DITUNDA, tidak diuji
skip(39, "M15-C2 Client Portal", "DITUNDA (Decided 2026-07-18): tidak ada kode/endpoint portal klien; sengaja tidak di-UAT (langkah 42)")

# ============================================================================
# J. Audit immutable + recompute derived (langkah 40-41)
# ============================================================================
def audit_actions(entity_id):
    st, b = call(od, "GET", f"/audit?entity_id={qenc(entity_id)}")
    return st, [(e.get("action"), e.get("actor_employee_id"), e.get("created_at")) for e in (b.get("data") or [])]

# audit chains hadir
chain_details = []; chain_ok = True
for eid, want in [(CMP_B, "create"), (CMP_RE, "owner_reassigned"), (CMP_ORIGIN, "campaign_auto_activated"),
                  (LEAD_ORIGIN, "create"), (CMP_PERF, None), (DEP1, "create")]:
    st, acts = audit_actions(eid)
    act_names = [a[0] for a in acts]
    present = st==200 and len(acts)>=1 and all(a[1] and a[0] and a[2] for a in acts)
    if want: present = present and want in act_names
    chain_ok = chain_ok and present
    chain_details.append(f"{eid}:{len(acts)}")
# CHR-/PERF- immutable via trigger DB (UPDATE diharapkan GAGAL)
chr_id = snap.get("id")
upd_chr = subprocess.run(["mysql","-ucdps","-pcdps_dev","-h127.0.0.1","cdps","-e",
                          f"UPDATE client_health_snapshots SET band='X' WHERE id='{chr_id}';"], capture_output=True, text=True)
chr_immutable = upd_chr.returncode != 0 and "immutable" in (upd_chr.stderr or "").lower()
perf_id = ks.get("id")
upd_perf = subprocess.run(["mysql","-ucdps","-pcdps_dev","-h127.0.0.1","cdps","-e",
                           f"UPDATE performance_snapshots SET final_score=1 WHERE id='{perf_id}';"], capture_output=True, text=True)
perf_immutable = upd_perf.returncode != 0 and "immutable" in (upd_perf.stderr or "").lower()
# OD write Wave 3 ditolak
st1, _ = call(od, "POST", f"/marketing/campaigns/{CMP_B}/transition", {"to":"Active"})
st2, _ = call(od, "POST", "/dependencies", {"source_id":BRF_SRC,"target_id":BRF_TGT,"type":"Blocking"})
od_write_blocked = st1==403 and st2==403
step(40, "audit chain immutable (actor/action/timestamp) seluruh Wave 3; CHR-/PERF- UPDATE via SQL DIHARAPKAN GAGAL (trigger); OD write Wave 3 ditolak (403)",
     chain_ok and chr_immutable and perf_immutable and od_write_blocked,
     f"chains=[{', '.join(chain_details)}] chrImmutable={chr_immutable} perfImmutable={perf_immutable} odBlocked={od_write_blocked}")

# langkah 41 — recompute derived = tampil
# (a) rollup M3
st, roll2 = call(insan, "GET", f"/marketing/campaigns/{CMP_ORIGIN}/rollup")
recompute_rollup = roll2.get("leads_generated")==1 and roll2.get("clients_won")==1
# (b) Auto-Metrics M2 stable
st, pm = call(insan, "GET", f"/marketing/campaigns/{CMP_PERF}/performance")
mm = pm.get("metrics") or {}
recompute_metrics = str(mm.get("lead_by_dashboard"))=="1"
# (c) Health M13: recompute (preview) tetap derived; snapshot score_display konsisten format
st, sp2 = call(am, "GET", f"/clients/{CLIENT_MAIN}/health")
recompute_health = sp2.get("id")==chr_id and sp2.get("score_display")==snap.get("score_display")
# (d) Performance M14: snapshot stabil
st, ks2 = call(ads, "GET", f"/staff/{KENNY_ID}/performance")
recompute_perf = ks2.get("id")==perf_id and ks2.get("score_display")==ks.get("score_display")
# (e) Dependency status dari status Source live (Source Approved -> Satisfied)
st, dg3 = call(am, "GET", f"/dependencies/{DEP1}")
recompute_dep = dg3.get("status")=="Satisfied"
step(41, "recompute derived = nilai tampil: rollup M3, Auto-Metrics M2, Health M13, Performance M14, Dependency status (dari Source live)",
     recompute_rollup and recompute_metrics and recompute_health and recompute_perf and recompute_dep,
     f"rollup={recompute_rollup} metrics={recompute_metrics} health={recompute_health} perf={recompute_perf} dep={recompute_dep}")

# ============================================================================
print()
fails = [r for r in results if r[2] is False]
skips = [r for r in results if r[2] is None]
passes = [r for r in results if r[2] is True]
print(f"TOTAL {len(results)} langkah — PASS {len(passes)}, FAIL {len(fails)}, SKIP {len(skips)}")
for r in fails:
    print("  FAIL:", r[0], "::", r[1], "::", r[3])
for r in skips:
    print("  SKIP:", r[0], "::", r[3])
sys.exit(1 if fails else 0)
