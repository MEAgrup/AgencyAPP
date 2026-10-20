<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| LT-8 | 🟡 **BARU 2026-08-31 (M16, Akun A) — alasan pengembalian brief untuk Live Stream/AI Optimizer/Store Operation (yang tidak punya daftar terstruktur seperti Creative/KOL) memakai SATU kode umum fallback `'Brief kurang jelas'`**, dipilih karena satu-satunya alasan yang muncul di kedua daftar existing (Creative 5, KOL 2). Perlu daftar sungguhan saat requirement Live/AI Optimizer/pekerjaan Store Operation datang (lihat LT-2). | Pemilik | **Tidak** memblokir — fallback valid (anggota union CHECK constraint DB), hanya kurang granular |
