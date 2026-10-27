# Rencana: lead form website → Pool CDPS

27 Okt 2026. Keputusan: `docs/decisions/2026-10-27-website-lead-intake.md`,
`2026-10-27-origin-division-seo-website.md`, `2026-10-27-pool-rls-sales.md`.
Pengirim: plugin WordPress `mea-leads` (repo `wp-meagency`), kontrak
`docs/WEBSITE_LEAD_CONTRACT.md` di repo itu (`mea.website_lead.v1`).

## Alur

```text
WordPress mea-leads ──POST (HMAC)──▶ /api/v1/internal/website-leads
                                      ├─ verifikasi tanda tangan + timestamp ±300 dtk (lib/website-lead-auth.ts)
                                      └─ websiteLead.intake()  (satu transaksi)
                                           ├─ kunci idempotensi sudah ada → hasil pertama (200)
                                           ├─ validasi payload v1
                                           ├─ leads.poolIntake()  ← inti pintu import Marketing yang sama
                                           │     baru → [Pool] · terminal → dibuka ulang ke [Pool] · aktif/klien → duplikat
                                           ├─ duplikat → leads.manual_review_flag = true + audit
                                           ├─ insert website_lead_inbox (payload imutabel, lead_id)
                                           └─ notify m1.lead.website_masuk → lead Sales (+ pemilik attempt bila duplikat)
```

## Pekerjaan

| # | Bagian | Isi |
|---|---|---|
| 1 | Migrasi `20261221010000_website_lead_inbox.sql` | Tabel `website_lead_inbox` (imutabel, RLS mengikuti visibilitas lead), arm Pool di `leads_select`, katalog notifikasi v23 (1 event). Gate: tabel 187→188, notif_events 84→85 di `scripts/db-rebuild.sh` + `.github/workflows/ci.yml` |
| 2 | `packages/core` | `EVENTS.LeadWebsiteMasuk` + entri katalog v23 |
| 3 | `packages/domain` | `leads.ts`: inti `importOneRow` dipecah ke `poolIntake(tx, ex, actor, args)` (perilaku import tidak berubah; `origin_division` jadi parameter). `website-lead.ts`: `parsePayloadV1`, `intake`. Read model: `websiteLead` di Pool/Leads Database, blok `website` di detail, filter `website` |
| 4 | `apps/api` | `lib/website-lead-auth.ts` (HMAC, env `WEBSITE_LEAD_SECRET`), rute `POST /api/v1/internal/website-leads`, `?website=1` di `GET /leads` dan `GET /leads/pool`, `wire.ts` |
| 5 | `web-internal` | Badge "Lead Website", filter "Hanya lead website (otomatis)", blok asal website di detail lead |
| 6 | Test | Domain (intake baru/reopen/duplikat/idempotensi/payload salah, notifikasi, imutabilitas inbox, RLS Pool + inbox), API (vektor HMAC kontrak, timestamp kedaluwarsa, signature salah, secret kosong), shape/route parity |

## Respons ke WordPress (cocok dengan tabel bagian 4 kontrak)

| Kasus | HTTP | Body |
|---|---|---|
| Lead baru / dibuka ulang | 201 | `{"status":"dibuat","lead_id":"LEAD-…"}` |
| Nomor sudah diproses / sudah klien | 200 | `{"status":"duplikat","lead_id":"LEAD-…"}` |
| Kunci idempotensi sama | 200 | hasil pertama |
| Payload tidak valid | 422 | `{"error":"[…]"}` |
| Signature/timestamp/secret salah | 401 | `{"error":"unauthorized"}` |

## Setelah merge

1. `apply_migration` berkas migrasi ke `CDPS SG` (bukan `db push`).
2. Set env `WEBSITE_LEAD_SECRET` di deployment `apps/api` (nilai acak ≥ 32 byte, dikirim ke pemilik WordPress lewat saluran privat).
3. WordPress: hapus lead uji, isi `MEA_LEADS_ENDPOINT = https://<api-cdps>/api/v1/internal/website-leads` dan `MEA_LEADS_SECRET` di `wp-config.php`.
4. Kirim satu lead uji → cek Pool, badge, notifikasi, dan kolom ID lead CDPS di wp-admin Leads MEA.
