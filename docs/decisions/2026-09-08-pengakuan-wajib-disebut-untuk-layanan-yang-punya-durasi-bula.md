<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-08 | **🟢 `pengakuan` WAJIB DISEBUT untuk layanan yang punya `durasi_bulan`; boleh dihilangkan hanya kalau durasinya kosong** (`msl.normalizeInput`, pesan `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`). | Hari ini 42 dari 42 layanan berdurasi memang `per_periode` — tapi itu **keadaan data, bukan aturan**, dan menjadikannya default berarti menurunkan `pengakuan` dari `durasi_bulan` lagi, hal yang persis dilarang D-KOM. Layanan berdurasi bisa sah `saat_selesai` (proyek 3 bulan yang dibayar penuh saat rampung), dan menebak salah satunya menempatkan pendapatan di bulan yang salah selama berbulan-bulan tanpa ada yang melihatnya. Tanpa durasi, `per_periode` mustahil dan `bulan_berikutnya` adalah kasus `Komisi` yang wajib terang-terangan — jadi hanya satu arti yang tersisa dan boleh jadi default. | Claude (build) |
