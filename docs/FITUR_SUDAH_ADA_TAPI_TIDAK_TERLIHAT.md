# Fitur: Sudah Ada, Tapi Tidak Terlihat

> **Untuk siapa dokumen ini.** Account Manager, Sales, dan Head — bukan developer.
> Lahir dari pola yang sama persis dengan `docs/FITUR_UPCOMING_MILESTONE.md`:
> *"fiturnya sudah jalan tapi belum pernah dijelaskan, jadi orang menganggapnya
> belum ada"*. Empat butir di bawah semuanya muncul di Feedback lapangan
> 2026-09-14 sebagai keluhan "belum ada" — pemilik memutuskan **jawab dulu,
> jangan dibangun** (`docs/handoff/HANDOFF_FEEDBACK_LAPANGAN_20260914.md` §2
> Gelombang 3), karena semuanya sudah diverifikasi ada di kode.

---

## 1. Lead "Not Qualified" — bisa didaftarkan ulang

**Keluhan:** *"Lead Not Qualified, kalau datang lagi bisa di-input ulang?"*

**Jawabannya: ya, sudah bisa — dan otomatis.** Kalau nomor telepon yang sama
masuk lagi (lewat pintu mana pun — form intake, import, dsb) sementara lead
lamanya berstatus `[Not Qualified]` (atau `[Rejected]`) dan tidak ada sales
yang sedang memegang attempt terbuka atas nomor itu, sistem **membuka kembali**
lead yang SAMA (bukan membuat lead baru) dan langsung melahirkan attempt baru
untuk sales yang mendaftarkannya.

Tidak ada tombol yang perlu ditekan — cukup daftarkan ulang nomornya seperti
lead baru biasa. Sistem yang mengenali riwayatnya lewat nomor telepon dan
memutuskan sendiri: buka kembali, gabung ke attempt yang sudah ada, atau
blokir (kalau masih ada sales lain yang aktif memegangnya).

*Sumber: `packages/domain/src/leads.ts` — jalur `outcome: 'reopen'` saat
`recordStatus` lead lama `[Not Qualified]`/`[Rejected]`.*

---

## 2. Menandai status iklan/layanan sedang "Hold" — sudah ada, dua langkah

**Keluhan:** *"Butuh fitur menandakan status iklan (hold, running, dll)."*

**Jawabannya: sudah ada**, dengan dua langkah persetujuan (bukan satu klik) —
persis supaya AM tidak bisa menghentikan pengerjaan klien sendirian tanpa
sepengetahuan atasan:

1. **AM mengajukan Hold** — di halaman klien (`/clients/{id}`), pada baris
   layanan yang statusnya **`[In Execution]`**. Wajib isi **alasan**. Status
   layanan berubah jadi **`[Hold Requested]`** — masih dianggap "aktif" di
   sisi klien, hanya menunggu keputusan Head.
2. **Head of Account menyetujui atau menolak** — di `/persetujuan` (kotak
   masuk persetujuan gabungan) atau langsung di halaman klien. Disetujui ⇒
   **`[On Hold]`**. Ditolak ⇒ kembali ke **`[In Execution]`**.
3. **Resume** — Head (atau Director) mengembalikan layanan dari `[On Hold]`
   ke `[In Execution]` kapan saja, tanpa perlu pengajuan AM lagi.

AM pemilik klien selalu diberi tahu (notifikasi in-app) setiap kali keputusan
dibuat, di kedua arah.

**Kalau Anda tidak melihat status ini di layar yang Anda maksud** — kolomnya
memang ada di `/clients/{id}` dan `/persetujuan`; kalau tetap tidak terlihat di
layar lain, itu tiket UI tersendiri (tampilkan status layanan di layar itu),
bukan fitur yang hilang.

*Sumber: `packages/domain/src/client.ts` — `requestHold` / `approveHold` /
`rejectHold` / `resumeService` (STATE_MACHINES.md, mesin Service).*

---

## 3. Penambahan jasa iklan secara durasi (perpanjangan / cross-sell)

**Keluhan:** *"Penambahan jasa iklan secara durasi."*

**Jawabannya: sudah ada** — panel **"Perpanjangan / Cross Sell / Bayar
Komisi"** di halaman klien (`/clients/{id}`). Tiga jenis pengajuan dari satu
panel yang sama:

| Jenis | Untuk apa |
|---|---|
| **Perpanjangan** | Memperpanjang jasa yang sudah berjalan — durasi baru dipilih (1–36 bulan), harga ikut opsi durasi katalog |
| **Cross-Sell** | Menjual jasa TAMBAHAN ke klien yang sudah ada |
| **Bayar Komisi** | Tagihan komisi murni (tidak memindahkan kepemilikan alokasi sales) |

Sama seperti negosiasi di closing: standar-saja langsung jalan, ada harga
custom ⇒ menunggu persetujuan Superior lewat `/persetujuan`. Durasi baru
diterbitkan sebagai kontrak (CTR-) baru yang **berantai** ke kontrak
sebelumnya (`contract_sebelumnya_id`) — riwayat perpanjangan tidak pernah
ditimpa, hanya disambung.

*Sumber: `packages/domain/src/renewal.ts` (R-03/R-04); komponen FE
`web-internal/src/components/clients/RenewalPanel.tsx`.*

---

## 4. Data testing/salah input — tidak bisa dihapus, dan itu disengaja

**Keluhan:** *"Data testing bisa dihapus?"*

**Jawabannya: tidak, dan itu memang aturan rumah #3 (CLAUDE.md)** — nol jalur
UPDATE/DELETE untuk riwayat apa pun di CDPS, termasuk lead. Kalau dibiarkan
bisa dihapus bebas, riwayat keputusan (siapa mengontak siapa, kapan, hasilnya
apa) bisa hilang tanpa jejak — dan itu persis yang audit log coba cegah.

**Untuk LEAD, ada jalur resmi**, bukan tombol hapus:

1. **Sales/AM mengajukan** — "Ajukan Hapus" pada lead itu, **wajib isi
   alasan**. Yang boleh mengajukan: pembuat lead itu sendiri, sales yang
   sedang memegang attempt-nya, atau Director.
2. **Head divisi asal lead menyetujui atau menolak** — lewat `/persetujuan`.
3. **Disetujui** ⇒ lead pindah ke status **`[Deleted]`** — status **terminal**
   (tidak bisa dibuka lagi dari sana), TAPI baris & riwayatnya tetap ada di
   database (bukan benar-benar terhapus). Nomor teleponnya jadi **bebas
   lagi** untuk didaftarkan sebagai lead yang sama sekali baru.
4. **Ditolak** ⇒ lead tetap seperti semula, tidak ada yang berubah.

Kalau memang cuma salah input (bukan mau menghapus jejaknya), jalur ini tetap
satu-satunya cara resmi menandainya "tidak dipakai" — tidak ada jalur "koreksi
diam-diam".

*Sumber: `packages/domain/src/leads.ts` — `requestDelete` / `approveDelete`
/ `rejectDelete`; migrasi `20260729162101_lead_delete_request.sql`.*
