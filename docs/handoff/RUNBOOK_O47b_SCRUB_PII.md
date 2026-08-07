# RUNBOOK O47b — scrub PII dari histori git

> Status per 2026-08-07: **diagnosis SELESAI, eksekusi BELUM.** Penghapusan
> branch ditolak dari sesi ini (`403` dari remote), jadi Langkah 1 butuh sesi
> atau orang dengan izin hapus-branch.
>
> Keputusan pemilik: **O47b pilihan (b)** (`docs/DECISIONS.md` 2026-08-07).

## 0. Temuan yang MENGUBAH rencananya — `main` tidak memuat PII

Rencana (b) berdiri di atas asumsi bahwa `main` memuat commit PII `f8faf12`,
sehingga scrub butuh `git filter-repo` + force-push + re-clone semua
kontributor. **Asumsi itu salah**, dan ini diverifikasi, bukan dibaca:

```
git merge-base --is-ancestor f8faf12 origin/main   # -> FALSE
```

`main` **tidak menjangkau** `f8faf12`. Repo pernah di-re-root, dan seluruh
lineage lama terputus darinya — **46 branch bahkan tidak punya merge base** dengan
`main` sama sekali.

**Konsekuensinya besar, dan bagus:**

| | Rencana (b) sebagaimana ditulis | Yang sebenarnya dibutuhkan |
|---|---|---|
| Rewrite histori `main` | wajib | **tidak perlu** |
| Force-push | wajib | **tidak perlu** |
| Re-clone semua kontributor | wajib | **tidak perlu** |
| Branch yang dihapus | ~85 | **26** |
| Tiket GitHub Support | wajib | wajib — **tidak berubah** |

Jadi scrub-nya berhenti menjadi operasi destruktif dan menjadi **penghapusan 26
ref yang tidak seorang pun pakai**, lalu satu tiket. Satu-satunya bagian yang
tidak menjadi lebih murah adalah bagian yang memang tidak bisa: GitHub tetap
menyimpan objek tak-terjangkau sampai Support menjalankan gc.

## 1. Peta branch remote (111 total, per 2026-08-07)

| Kelompok | Jumlah | Isi | Aman dihapus? |
|---|---|---|---|
| **Pembawa PII** — menjangkau `f8faf12` | **26** | Lineage lama; nol merge base dengan `main` | **Ya — dan inilah tujuan O47b** |
| Nenek moyang `main` — nol commit unik | **42** | Seluruh commit-nya sudah ada di `main` | Ya, lossless. Kebersihan saja, **bukan** PII |
| Nol merge base, TANPA PII | **20** | Sisa lineage lama | Kemungkinan besar ya — **butuh mata pemilik**, bukan keputusan otomatis |
| Punya isi unik vs `main` | **21** | `git diff main...branch` non-kosong | **JANGAN** hapus tanpa memeriksa isinya |
| `main` + branch kerja aktif | 2 | — | Tidak |

⚠️ **Kenapa "nol commit unik" bukan satu-satunya kriteria.** PR di-squash-merge,
jadi commit branch-nya tidak pernah mendarat dan branch yang kerjanya SUDAH
masuk tetap terlihat "belum ter-merge". Karena itu dipakai dua kriteria:
`rev-list --count main..branch` **dan** `git diff main...branch` kosong. Branch
yang nol merge base tidak bisa dinilai oleh keduanya — karena itu ia jadi
kelompok sendiri alih-alih diasumsikan aman.

## 2. Langkah eksekusi

### Langkah 1 — hapus 26 branch pembawa PII

Butuh izin hapus-branch; sesi 2026-08-07 ditolak `403`. Daftar + SHA di §3.

```
git fetch origin --prune
git push origin :refs/heads/claude/<nama-1> :refs/heads/claude/<nama-2> ...
```

**Pulih-able selama gc belum jalan:** `git push origin <sha>:refs/heads/<nama>`.
Itulah gunanya SHA di §3 — **jangan hapus berkas ini sebelum Langkah 3 selesai.**

### Langkah 2 — verifikasi nol ref menjangkau PII

Jangan dilewati, dan jangan diganti dengan "sudah dihapus kok":

```
git fetch origin --prune
git for-each-ref --format='%(refname:short)' refs/remotes/origin |
  while read r; do git merge-base --is-ancestor f8faf12 "$r" 2>/dev/null && echo "$r"; done
```

Keluarannya harus **kosong**. Kalau tidak, ada ref yang terlewat — dan
melaporkannya bersih akan jadi laporan palsu untuk kedua kalinya (yang pertama:
penghapusan berkas 2026-07-30, yang mengeluarkan PII dari tree saja).

### Langkah 3 — tiket GitHub Support

Objek yang sudah tak terjangkau **tetap bisa dibuka lewat URL commit langsung**
sampai Support menjalankan gc atas repo. Tanpa langkah ini, PII masih bisa
diambil siapa pun yang menyimpan SHA-nya — dan SHA itu ada di halaman PR lama.

Minta: *"run gc / remove unreachable objects for `MEAgrup/AgencyAPP`"*, dan
sebutkan bahwa ref pembawanya sudah dihapus.

**Sebelum Langkah 3 selesai: JANGAN laporkan PII sudah bersih.**

### Langkah 4 (opsional, bukan PII) — kebersihan

42 branch nenek moyang `main` bisa dihapus kapan saja tanpa kehilangan apa pun.
20 branch nol-merge-base tanpa PII dan 21 branch berisi unik **butuh keputusan
pemilik**. Jangan disapu bersamaan dengan Langkah 1: mencampurnya membuat
Langkah 1 tidak bisa di-review, dan Langkah 1 adalah satu-satunya yang mendesak.

## 3. Daftar + SHA pemulihan

Perintah pulih: `git push origin <sha>:refs/heads/<nama-branch>`.

### Grup 1 — 26 branch pembawa PII (menjangkau `f8faf12`)

```
d93fd0f4fa85233fa8048b4d0056eb52746057ce claude/baca-supabase-handoff-j86i0f
b55246d5ab43ba0256ef5e995f50555ed1ddec94 claude/backend-auth-cdps-complete-m46ock
5c8ba6bb0f98353309ef5ad706c9f20efdfc4e52 claude/cdps-auth-uat-smoke-et5wql
9d1dd90a97889def24b6a461a0d0d9ae87ea0363 claude/cdps-credential-auth-check-x2e63d
213329bed0642fa59381df085774c34effd61235 claude/cdps-production-login-wtmxnn
bd7c1ea288dea6c38535265630a02328509b8fd4 claude/cdps-supabase-migration-plan-ypfwgx
06ba62e3d3518f56e7f50123b35a9afcc5b0b03e claude/employee-email-qa-passwords-oootfl
2cc97bb9e597cbe90055523746cb3a9284806a8c claude/fase-1-rls-auth-tog477
556c70f245242ae001f71d71922102e9b172a70d claude/fase1-sesi4-handoff-1x8v1i
f4818275c1f32d2455716d67e08295f381f23453 claude/fe-be-smoke-test-debt-fnexe3
6cda70f495e6fdacb33ae07dfcd4b020a122ef1b claude/fe-m0-m1-sales-leads-jazm79
daf9e22aa07048a68293363c3844377b09ed6379 claude/fe-m0-m1-sales-leads-vnpgxd
003c8d76e8d9e943eca119584d3223ddb3a335b4 claude/fe-m2-m3-marketing-campaign-iacc5y
1975ae9b3d639df070f8cc974479000241306046 claude/frontend-smoke-test-merge-j1tbud
cea94161c26862e9e4cbef07a9c11b3cfe159d70 claude/frontend-wave-2-dashboard-wave-3-jt46td
54d1de565e0c6cf1b20c64ae0c835bae38d913f9 claude/hris-cdps-auth-system-nx6vff
866a68b8b3666c1f4f5ad79fa702c13c4f704998 claude/lead-registration-validation-z9raw7
2f38783b0f58a00002d741f6fb36dfcbcd3db74b claude/pending-fe-tasks-luoz7q
4bae04c3bdcdf5105ee90041a9fa81e5c06e7a99 claude/railway-backend-deploy-8263rq
8a389b91d977ccce85cc5eaae37408e2a5f73179 claude/supabase-fase0-sesi2-handoff-fpz613
8a702e9298cd5904683f9fcedaec4a4f873b2747 claude/supabase-fase0-sesi3-continue-xko1b4
59e4a3a307625f30ab64c6634a563ea97206220f claude/wave-2-uat-mock-hris-qotk8y
026c4f6a92c273ebc4100757b80eb5c046f2602f claude/wave1-cdps-merge-rtnhrn
75883c39641c34ed5dd9e792857cdbee2a1c14ef claude/wave2-uat-gate-exit-asstfa
02415f1efb302c0dd9d4f69749b63c5439f99c98 claude/wave3-uat-runbook-6epydu
33537b2e1a7c572c3a4c6444f88826368172b6c7 claude/wave3-uat-runbook-aok65p
```

### Grup 2 — 42 branch yang seluruh commit-nya sudah ada di `main`

Bukan PII. Dihapus hanya untuk kebersihan, dan menghapusnya **tidak bisa**
kehilangan apa pun karena setiap commit-nya sudah ada di `main`.

```
68fa00ed0f555841da2a68b6f1a2e57dfc7af9ef claude/am-assignment-dropdown-search-1fnhs1
532b470a3384dbd4045632ec784eb7d5df2885eb claude/baca-handoff-cutover-szsw80
b0dc008d505f157b4d025d4799e1f3128f320b29 claude/backup-mysql-railway-9kf557
075a06d0ccb32f2308a5b155462af62aa157edd2 claude/c-04-master-service-list-ioh59y
df3dddb5a3d450d59e031003da5a8790e4a25616 claude/c03-vercel-director-access-7vmki0
7789472101a49928f1f5da4a138ce22c81c4994f claude/campaign-dropdown-lead-registration-exp8eb
3cebd061872f3dcec7a587c2ab2d31285b284682 claude/cdps-qa-revisi-fgr5d9
9b1fd1422553d7e9c90635593eecf4b56652ced0 claude/cdps-sg-cutover-continue-4jbfpy
4ac30306f0804945b9176b63a2c7d4f669c90405 claude/cdps-sg-cutover-migrasi-azzlwr
f161e1f3c965828c65339ae87f6550593fb48d99 claude/cdps-sg-cutover-sesi13-2kmgy4
94513a1f6f291b55eded931956384e0f428dce06 claude/cdps-supabase-migration-enh0gp
18ae5718cf314632960ea75e2de62d823bd04994 claude/ci-gates-db-migrations-101jt4
9a70ffa55cfe81a29e41d041c51cf59844d8f434 claude/deployment-status-vercel-supabase-wdv0e5
b23441c62b429538710044ad768d940901e1ec8d claude/finance-qa-partial-payment-gh3q5h
a34391af239aa374c44842439220cb4b0b7f4478 claude/finance-transaction-edit-mechanism-88vmyx
1633d765d3fba9e4e211492869f9295d6b6f0e4c claude/go-retirement-progress-08ly3d
25a383b8d0019d126124f437aa3aedbec97cc36a claude/go-retirement-progress-6r14e0
5237dfdb0c62e9a6d934f3afe7d44632a12c711f claude/go-retirement-progress-eq0855
d5ce8eed3705df7f83621fc8f0171fe404cb771f claude/go-ts-port-handoff-393n4n
ba57ae44e8aac9b68df3ccefa7d96b74a52acda3 claude/handoff-cutover-sesi1-yh3o39
4556f4cb1175288534068f55ba3011a6f0661ed4 claude/handoff-fase1-docs-bwr0jg
5b22ae61f8bb2eddeeabd58fc4c2b713a9e76222 claude/handoff-m6abc-sesi5-2eq31i
cc83105ac80c339c7340d0e444c5320decf56294 claude/handoff-sesi-6-cutover-ysut7c
b93b590e328bb53f4aa9fffc75bc2d3bece38f44 claude/lead-status-store-details-600zhe
bdbddd63b6b90c7b5b8827da6fbdcb1a2a09480c claude/lead-transaksi-tanpa-negosiasi-u1yz1t
91cc2c9f6e4588dd2b49f8b43144941604d929a7 claude/m1-pool-claim-attempt-client-syt5jx
9e98c1074b35b0d3f43c871bc68d3db7373ac14c claude/m4-client-lock-matrix
48a0bcc480464229d3603bf439287a3c1a914d00 claude/m5-finance-payment-verification
ece2a4c67252588ee7032f9bf7c7c83948e0ef67 claude/m6ab-strategi-plan-3x7p0a
212a89a067f4e808f1eb3ed1e906a60e6be7590e claude/migrasi-cdps-sg-cutover-behnjc
f7069106cfa7274bfc160a4a3d5ac0386e1126c9 claude/port-m10-livestream-q7zz7p
b9c2108d0abac14b4f3ce878aa9b962a94597c22 claude/port-m11-board-dependencies
76fdf881dbb211ad8a4b427864dbabbc88333363 claude/port-m13-client-health
b111f390a83dd6ee74d84c3f82cd8da00059c150 claude/port-m14-team-performance-lvmfdb
0e24ce5943542b428f43f0eb85d4d1dee50f0f4d claude/port-m15-portal
944e57d6cdb2f79077066b65167fad25044762b2 claude/port-m2-marketing
938062838548e53d7503f93104e9d4a4e99d71de claude/port-m3-campaign
0456c920c3c0e6f8bd911e05090981aa5cbdbfc1 claude/port-m7-daily-output-reminder
98da3da55fb4485d2027f53c48319b215cdc93c0 claude/qa-halaman-live-vercel-error-l2rgq3
ca32fc73adc887271ebd72b20c63ee25f6a1509d claude/qa-onboarding-service-account-1yrl1l
cfebed1c53b71475b26c8606930e07c69a427f39 claude/wave2-port-start-cllq8v
92738f3d65c576f8a63850ccbece35de11d034a8 claude/wire-parity-delivery-a-nbhiqg
```

## 4. Cara menghasilkan ulang daftar ini

Kalau daftar di §3 dicurigai basi, hasilkan ulang alih-alih mempercayainya:

```
git fetch origin --prune

# Grup 1 — pembawa PII
git for-each-ref --format='%(objectname) %(refname:short)' refs/remotes/origin |
  while read sha ref; do
    git merge-base --is-ancestor f8faf12 "$ref" 2>/dev/null && echo "$sha $ref"
  done

# Grup 2 — nol commit unik terhadap main
git for-each-ref --format='%(objectname) %(refname:short)' refs/remotes/origin |
  while read sha ref; do
    [ "$ref" = "origin/main" ] && continue
    [ "$(git rev-list --count origin/main..$ref)" = "0" ] && echo "$sha $ref"
  done
```
