# MSL x Pricelist -- Rekonsiliasi Draft (180 Layanan)

> Audiens: **Sales Head**. Dokumen ini mencocokkan 180 kandidat layanan hasil kompilasi 1.517 deal ledger (`MSL_DRAFT_KOMPILASI.csv`) terhadap pricelist resmi (Google Sheets, snapshot dibaca 2026-07-11). Sesuai keputusan Nerissa 2026-07-11 (`docs/DECISIONS.md`): **pricelist = basis `usulan_standard_price`**, harga deal ledger yang berbeda = hasil negosiasi per-klien (bukan indikasi harga pricelist salah).

Urutan tabel **mengikuti urutan CSV** (descending jumlah_deal) -- prioritaskan validasi baris atas dulu.

## Legenda confidence

- **TINGGI** -- nama/platform match pasti + rumus satuan pricelist jelas tanpa ambiguitas platform/kuantitas -> `usulan_standard_price` SUDAH diisi di CSV.

- **SEDANG** -- ada kandidat match yang masuk akal (nama mirip / rumus bisa dihitung) tapi ada ambiguitas (multi-platform beda rate, kuantitas tidak eksplisit, atau kontradiksi dgn histori) -> harga TIDAK diisi, dicatat sbg kandidat.

- **RENDAH** -- tidak ada dasar pricelist yang cukup kuat, atau kategori sama sekali tidak dicakup pricelist -> TIDAK diisi.


## Tabel rekonsiliasi (urutan CSV, descending jumlah_deal)

| # | canonical_name | jumlah_deal | item pricelist match | harga pricelist / rumus | usulan_standard_price | confidence | catatan |
|---:|---|---:|---|---|---:|:-:|---|
| 1 | Optimasi Rating 100x | 290 | Shopee Rating Optimization (Rp15.000/checkout, min 50) DAN TikTok Rating Optimization (Rp17.000/checkout, min 50) | 100 x Rp15.000 = Rp1.500.000 (Shopee) vs 100 x Rp17.000 = Rp1.700.000 (TikTok) -- rate BERBEDA per platform | — | SEDANG | kandidat pricelist: Shopee Rating Optimization 100x checkout = 100 x Rp15.000 = Rp1.500.000; TikTok Rating Optimization 100x checkout = 100 x Rp17.000 = Rp1.700.000. Layanan ini muncul di 4 platform (Shopee, TikTok, TikTok Shop, Tokopedia) dengan rate pricelist berbeda per platform (Shopee vs TikTok) dan pricelist tidak menyebut rate Tokopedia/TikTok Shop terpisah -- TIDAK dirata-rata. Median deal riil Rp1.300.000 di bawah kedua hasil rumus, indikasi harga median historis sudah didiskon/nego atau MSL final perlu dipecah per-platform (Optimasi Rating 100x Shopee vs TikTok). |
| 2 | Jasa Iklan Traffic Marketplace Basic | 210 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- kategori 'Traffic Marketplace' (Lazada/Shopee ads) tidak ada di pricelist -- pricelist hanya punya 'Awareness & Consideration Phase' per-1K-view generik tanpa breakdown platform/traffic marketplace. |
| 3 | Jasa Pengajuan Shopee Mall | 81 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- submission/pengajuan status toko (Shopee Mall) tidak ada di pricelist. |
| 4 | Jasa Buka Toko Online Basic | 76 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- setup toko online tidak ada di pricelist. |
| 5 | Optimasi Rating 50x | 71 | Shopee Rating Optimization DAN TikTok Rating Optimization (per checkout, min 50) | 50 x Rp15.000 = Rp750.000 (Shopee) vs 50 x Rp17.000 = Rp850.000 (TikTok) | — | SEDANG | kandidat pricelist: 50 x Rp15.000 = Rp750.000 (Shopee) / 50 x Rp17.000 = Rp850.000 (TikTok). Muncul di 4 platform (Lazada, Shopee, TikTok, TikTok Shop), pricelist hanya punya rate Shopee & TikTok -- tidak ada rate Lazada, TIDAK dirata-rata. Median deal riil Rp750.000 cocok tepat dengan rumus Shopee (50x Rp15.000) -- ini memperkuat hipotesis rate Shopee sbg basis, tapi karena layanan tercatat lintas-platform tanpa pemisahan baris per platform, confidence tetap SEDANG. |
| 6 | GMV Max Mea Basic | 55 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- GMV Max (produk TikTok Shop performance-based) tidak ada di pricelist -- pricelist hanya sebut 'GMV MAX' sbg baris kosong tanpa harga di bagian Ads Spending. |
| 7 | Tiktok Ads GBS (Free Kelola ads Tiktok) | 51 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket GBS free-management tidak ada di pricelist. |
| 8 | Jasa Iklan Shopee 10 SKU | 48 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket iklan per-SKU tidak ada di pricelist. |
| 9 | Jasa Buka Toko Online Premium | 36 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Basic. |
| 10 | Meta Ads CPAS x Shopee Premium | 33 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- Meta Ads CPAS tidak ada di pricelist. |
| 11 | HAKI | 24 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- dokumen legal (HAKI) tidak ada di pricelist. |
| 12 | Traffic Tiktok Shop Awareness Basic 360 | 22 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket traffic awareness '360' tidak ada di pricelist. |
| 13 | GMV MAX MEA | 20 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 14 | Management Tiktok Shop Shopping Centre Optimization Basic | 17 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- kategori shopping centre optimization tidak ada di pricelist. |
| 15 | Meta Ads CPAS x Shopee Basic | 17 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads CPAS x Shopee Premium. |
| 16 | GMV MAX Advertising Management | 14 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 17 | GMV Max Mea Premium | 14 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 18 | Management Tiktok Shop Shopping Centre Optimization Pro | 13 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat versi Basic. |
| 19 | Endorsement Konten Tiktok Premium | 13 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara langsung. Pricelist hanya punya 3 tier KOL by follower (Nano/Micro/Macro&Mega) dengan model komisi '10% ratecard' -- 'Premium' bukan salah satu dari 3 tier tsb dan tidak ada rate flat yang match. Tidak cukup dasar untuk usulan harga. Pricelist KOL & Influencer memakai skema '10% ratecard' (komisi dari ratecard KOL, BUKAN dari standard price) -- tidak sesuai grammar O14 (N% of standard price / flat Rp N) karena basisnya ratecard eksternal, bukan standard price internal. Tidak diisi; perlu keputusan Sales Head apakah dikonversi ke grammar resmi atau dicatat sbg pengecualian. |
| 20 | Endorsement Konten Tiktok Basic | 13 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara langsung (bukan salah satu tier Nano/Micro/Macro&Mega KOL). Sama seperti Endorsement Konten Tiktok Premium -- basis '10% ratecard' pricelist tidak match grammar O14, tidak diisi. |
| 21 | Jasa Desain 25 SKU | 11 | SKU Design (per SKU, min 1, Rp100.000) | 25 x Rp100.000 = Rp2.500.000 | Rp 2.500.000 | TINGGI | Nama eksplisit '25 SKU', satuan pricelist 'per SKU' Rp100.000. Median deal riil Rp2.250.000 (11 deal) di bawah rumus -- nego turun ~10%, konsisten dgn keputusan Nerissa 2026-07-11. |
| 22 | Jasa Foto Katalog | 11 | Product Catalog Photos – 4 Outputs (per produk, min 1, Rp150.000) ATAU Product Catalog Photo – 1 Output (per foto, min 1, Rp40.000) | ambigu -- nama tidak menyebut jumlah output/foto | — | SEDANG | kandidat pricelist: Product Catalog Photos - 4 Outputs = Rp150.000/produk ATAU Product Catalog Photo - 1 Output = Rp40.000/foto. Nama MSL tidak menyebut kuantitas output sehingga tidak jelas rumus mana yang berlaku; rentang deal riil sangat lebar (Rp250.000 s.d. Rp5.000.000, median Rp500.000) mengindikasikan variasi paket/jumlah SKU tercampur dalam satu grup -- perlu Sales Head memecah per paket foto. |
| 23 | Live Affiliate 3 Affiliator 16 Jam Night | 11 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket live affiliate per-jam/per-affiliator tidak ada di pricelist (pricelist hanya punya Live Streaming per-sesi generik, bukan per-affiliator). |
| 24 | NIB | 11 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- dokumen legal (NIB) tidak ada di pricelist. |
| 25 | Budget Ads + PPN 11% | 11 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- top-up budget iklan + pajak, bukan jasa -- tidak ada di pricelist. |
| 26 | Tiktok Ads Basic | 10 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- tier iklan TikTok Basic/Premium tidak ada di pricelist (bukan Awareness & Consideration Phase generik). |
| 27 | Tiktok Ads Premium | 10 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Tiktok Ads Basic. |
| 28 | Jasa Live Shopee Basic | 10 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket live shopping bertingkat tidak ada di pricelist. |
| 29 | Matchmaking Top Creator Shopee Live Streaming 1 Affiliator 16 Jam Night | 10 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket matchmaking creator tidak ada di pricelist. |
| 30 | Endorsement Konten Tiktok Premium+ | 10 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara langsung. |
| 31 | Saldo Ads | 10 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- top-up saldo, bukan jasa. |
| 32 | Jasa Iklan Traffic Marketplace Premium | 8 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Basic. |
| 33 | Live Affiliate 1 Affiliator 16 Jam Night | 8 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Live Affiliate 3 Affiliator 16 Jam Night. |
| 34 | Jasa Iklan Riset Awareness | 7 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- riset awareness custom tidak ada di pricelist. |
| 35 | Jasa Content Premium | 6 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara persis -- kemungkinan terkait 'Short Video (Premium)' tapi nama tidak cukup spesifik (tidak menyebut 'video' / 'per video'), tidak diasumsikan sama. |
| 36 | Matchmaking Top Creator Shopee Live Streaming 3 Affiliator 16 Jam Night | 6 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 37 | Traffic Tiktok Shop Awareness Premium 360 | 6 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Basic 360. |
| 38 | Jasa Admin Campaign Marketplace | 6 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- tidak ada kategori 'Admin Campaign' di pricelist resmi (beda dari 'Customer Review Management' atau kategori lain). |
| 39 | Tiktok Ads Premium+ | 5 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Tiktok Ads Basic. |
| 40 | Jasa Buka Toko Online Pro | 5 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Basic. |
| 41 | Traffic Tiktok Shop Awareness Premium+ 360 | 5 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Basic 360. |
| 42 | Jasa Desain 50 SKU | 5 | SKU Design (per SKU, min 1, Rp100.000) | 50 x Rp100.000 = Rp5.000.000 | — | SEDANG | kandidat pricelist: 50 x Rp100.000 = Rp5.000.000. Namun SEMUA 5 deal riil tercatat persis Rp3.150.000 (bukan sebaran nego, tapi harga tunggal konsisten) -- ini indikasi kuat pricelist SKU Design Rp100.000/SKU BUKAN basis untuk paket 50 SKU ini (kemungkinan ada rate paket tersendiri utk 50 SKU yang lebih murah per-unit, atau field '50 SKU' bukan literal 50 unit desain). Tidak diisi TINGGI karena kontradiksi konsisten dgn rumus linear. |
| 43 | Shopee Video Affiliate 1 Affiliate 3 Video | 4 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket video affiliate tidak ada di pricelist. |
| 44 | Matchmaking Top Creator Shopee Live Streaming 1 Affiliator 16 Jam Day | 4 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 45 | Optimasi Rating 200x | 4 | Shopee Rating Optimization DAN TikTok Rating Optimization (per checkout, min 50) | 200 x Rp15.000 = Rp3.000.000 (Shopee) vs 200 x Rp17.000 = Rp3.400.000 (TikTok) | — | SEDANG | kandidat pricelist: 200 x Rp15.000 = Rp3.000.000 (Shopee) / 200 x Rp17.000 = Rp3.400.000 (TikTok). Platform terlihat: Shopee, TikTok Shop (bukan TikTok murni) -- pricelist tidak punya rate TikTok Shop terpisah, TIDAK dirata-rata. Harga max deal riil (Rp3.000.000) match rumus Shopee 200x -- indikasi kuat basis Shopee tapi baris MSL menggabung 2 platform jadi tetap SEDANG. |
| 46 | Optimasi Rating Shopee 100x | 4 | Shopee Rating Optimization (per checkout, min 50, Rp15.000) | 100 x Rp15.000 = Rp1.500.000 | Rp 1.500.000 | TINGGI | Platform tunggal Shopee (nama eksplisit menyebut Shopee), rumus 100 x Rp15.000/checkout = Rp1.500.000. Median deal riil Rp1.300.000 (semua 4 deal) lebih rendah -- dicatat sebagai nego, konsisten dengan keputusan Nerissa 2026-07-11 (harga pricelist = basis, harga ledger = hasil nego per-klien). |
| 47 | Komitmen fee Paket GMV Max Mea Paket B | 4 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- komitmen fee GMV Max tidak ada di pricelist. |
| 48 | Komitmen Fee | 4 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- generik komitmen fee tidak ada di pricelist. |
| 49 | Riset Judul 25 SKU | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- tidak ada item 'Riset Judul' / keyword research di pricelist resmi. |
| 50 | Jasa Pengajuan Tiktok Mall | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- submission TikTok Mall tidak ada di pricelist. |
| 51 | Jasa Iklan Shopee Basic | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Iklan Shopee lain. |
| 52 | GMV Max Mea Pro | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 53 | Jasa Trending Video Basic | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- tidak ada kategori 'Trending Video' di pricelist resmi. |
| 54 | Live Affiliate 3 Affiliator 16 Jam Day | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Live Affiliate lain. |
| 55 | Jasa Content Premium+ | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara persis -- sama seperti Jasa Content Premium. |
| 56 | Tiktok Mall | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Pengajuan Tiktok Mall. |
| 57 | Komitmen Fee GMV Max Tiktok Free Jasa Plus Komisi 5% | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- komitmen fee custom tidak ada di pricelist (meski menyebut komisi 5%, ini bukan Store Management -- basis komisi beda konteks, TIDAK disamakan). |
| 58 | Optimasi Rating 500x | 3 | Shopee Rating Optimization (per checkout, min 50, Rp15.000) | 500 x Rp15.000 = Rp7.500.000 | — | SEDANG | kandidat pricelist: 500 x Rp15.000 = Rp7.500.000 (Shopee, satu-satunya platform terlihat di baris ini). Median/max deal riil Rp6.000.000 di bawah hasil rumus -- selisih ~20% lebih tinggi dari histori nego, jadi tidak diisi otomatis walau platform tunggal (Shopee) cocok dengan rate pricelist yang tersedia. |
| 59 | Paket Hemat Basic | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket hemat custom tidak ada di pricelist. |
| 60 | GMV Max Event Paket B | 3 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max lain. |
| 61 | Optimasi rating 100x CO | 2 | Shopee Rating Optimization (Rp15.000/checkout, min 50) | 100 x Rp15.000 = Rp1.500.000 (asumsi 'CO' = varian internal Shopee, platform tunggal Shopee) | — | SEDANG | kandidat pricelist: 100 x Rp15.000 = Rp1.500.000 (Shopee, platform tunggal). Sufiks 'CO' tidak dijelaskan di pricelist maupun ledger (kemungkinan singkatan internal tim, mis. 'Checkout' atau 'Cash on delivery') -- makna tidak pasti sehingga tidak disamakan otomatis dengan 'Optimasi Rating Shopee 100x' walau angka & platform sama; perlu konfirmasi Sales Head arti 'CO'. |
| 62 | Live Affiliate 1 Affiliator 30 Jam Night | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Live Affiliate lain. |
| 63 | Tiktok Ads Basic+ | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Tiktok Ads Basic. |
| 64 | Tiktok ads | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Tiktok Ads Basic. |
| 65 | Meta Ads Premium | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- Meta Ads generik tidak ada di pricelist. |
| 66 | Live Affiliate 3 Affiliator 30 Jam Night | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Live Affiliate lain. |
| 67 | Jasa Foto Katalog Tematik | 2 | Thematic Product Photos – 4 Outputs (per produk, min 1, Rp250.000) | 1 x Rp250.000 = Rp250.000 (jika 1 produk) -- satuan 'per produk' berarti harga berskala dgn jumlah produk | — | SEDANG | kandidat pricelist: Thematic Product Photos - 4 Outputs = Rp250.000/produk. Median deal riil Rp1.950.000 = kira-kira 8x Rp250.000 -- indikasi harga historis untuk multi-produk (paket ~8 produk), tapi jumlah produk per deal tidak tercatat di MSL sehingga rumus pasti tidak bisa dipastikan. Tidak diisi otomatis. |
| 68 | META Ads CPAS x Shopee | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads CPAS x Shopee Premium. |
| 69 | Jasa Iklan Shopee Maksimal 10 SKU | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Iklan Shopee 10 SKU. |
| 70 | Jasa Optimasi Rating 100x CO | 2 | Shopee Rating Optimization / TikTok Rating Optimization (multi-platform) | 100 x Rp15.000 = Rp1.500.000 (Shopee) vs 100 x Rp17.000 = Rp1.700.000 (TikTok) | — | RENDAH | Multi-platform (Shopee, TikTok) dengan rate berbeda + sufiks 'CO' tidak jelas maknanya -- tidak cukup dasar untuk rumus tunggal. |
| 71 | Meta CPAS x Shopee | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads CPAS x Shopee Premium. |
| 72 | Riset Judul 10 SKU | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Riset Judul 25 SKU. |
| 73 | Add On Talent | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- baris 'Model (Add On)' di pricelist (bagian C. Asset Produk & A. Konten Organik) TIDAK memiliki harga terisi (sel harga kosong di sheet sumber). Tidak ada dasar angka. |
| 74 | GMV Max Basic | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 75 | Jasa Iklan Shopee 3 SKU | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Iklan Shopee 10 SKU. |
| 76 | Shopee Video Affiliate 3 Affiliate 3 Video | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Shopee Video Affiliate 1 Affiliate 3 Video. |
| 77 | Live Affiliate 1 Affiliator 16 Jam Day | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Live Affiliate lain. |
| 78 | Meta Ads CPAS x Shopee Pro | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads CPAS x Shopee Premium. |
| 79 | Live Shopee 30 jam | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Live Shopee Basic. |
| 80 | Jasa Live Shopee Basic 100 Jam | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Live Shopee Basic. |
| 81 | Komitmen Fee Management Iklan GMV Max MEA free biaya jasa & Komisi 3% | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat komitmen fee GMV Max lain. |
| 82 | Jasa Live Tiktok Basic | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Live Shopee Basic. |
| 83 | Jasa GMV Max Premium | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 84 | Komitmen Fee Management Iklan GMV Max MEA free biaya jasa & Komisi 5% | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat komitmen fee GMV Max lain. |
| 85 | Optimasi Rating 100x TikTok | 2 | TikTok Rating Optimization (Rp17.000/checkout, min 50) | 100 x Rp17.000 = Rp1.700.000 | — | SEDANG | kandidat pricelist: 100 x Rp17.000 = Rp1.700.000 (TikTok, platform tunggal & rate paling relevan). Deal riil hanya Rp1.500.000 (2 deal, identik) -- di bawah rumus TikTok, malah cocok persis dengan rumus Shopee (100x Rp15.000). Ambigu apakah harga TikTok pricelist berlaku atau layanan ini sebenarnya dijual rate Shopee -- perlu konfirmasi Sales Head, tidak diisi TINGGI. |
| 86 | Matchmaking Top Creator Tiktok Live Streaming 3 Affiliator 30 Jam Night | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 87 | Komitmen fee Paket Shopee Booster | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- Shopee Booster tidak ada di pricelist. |
| 88 | GMV Max MEA Intensive Premium | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 89 | Matchmaking Creator Shopee Live Streaming 1 Affiliator 16 Jam Day | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 90 | Shopee Booster Basic | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Komitmen fee Paket Shopee Booster. |
| 91 | GMV Max Event Paket A | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max lain. |
| 92 | Shopee Booster Premium | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Shopee Booster Basic. |
| 93 | Tiktok Growth Pro | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- growth pro custom tidak ada di pricelist. |
| 94 | Meta Ads Pro | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads Premium. |
| 95 | Add on Weekend Day – 8 Hours | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- add-on jam kerja live streaming custom, tidak persis match 'Night & Weekend Sessions' (beda basis jam: 8 jam vs sesi 3 jam) -- tidak diasumsikan linear. |
| 96 | Add on Weekday Night – 22 Hours | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Add on Weekend Day -- basis jam beda dari sesi 3 jam pricelist. |
| 97 | Add on Weekend Night – 8 Hours | 2 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Add on Weekend Day. |
| 98 | Jasa Iklan Awereness | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- iklan awareness custom shopee tanpa breakdown per-1K-view, tidak match pasti. |
| 99 | Perpanjangan Jasa Iklan Traffic Consideration | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- perpanjangan (renewal) custom, tidak ada di pricelist. |
| 100 | Tiktok Ads GBS (Free Kelola ads Tiktok) topup saldo iklan | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- top-up saldo, bukan jasa. |
| 101 | Jasa Iklan Shopee | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- generik, lihat Jasa Iklan Shopee 10 SKU. |
| 102 | Live Affiliate 1 Affiliator 60 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Live Affiliate lain. |
| 103 | Pengajuan Tiktok Mall | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Pengajuan Tiktok Mall. |
| 104 | Free Jasa Tiktok Ads Komisi 10% dari Omset Toko | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- skema komisi dari omset toko (bukan standard price) -- tidak match grammar O14, dan tidak ada basis pricelist. |
| 105 | Jasa Iklan Consideration | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Perpanjangan Jasa Iklan Traffic Consideration. |
| 106 | Endorsement Creator Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara langsung (bukan salah satu tier KOL pricelist). |
| 107 | Pengajuan Blue Tick | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- verifikasi centang biru tidak ada di pricelist. |
| 108 | Matchmaking Top Creator Shopee Live Streaming 3 Affiliator 30 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 109 | Jasa Launching Produk Basic | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- launching produk custom tidak ada di pricelist. |
| 110 | Jasa Iklan Traffic Marketplace Performance | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Iklan Traffic Marketplace Basic. |
| 111 | Jasa iklan traffic Marketplace | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Iklan Traffic Marketplace Basic. |
| 112 | Jasa desain marketplace 50 SKU | 1 | SKU Design (per SKU, min 1, Rp100.000) | 50 x Rp100.000 = Rp5.000.000 | — | SEDANG | Sama seperti 'Jasa Desain 50 SKU' -- 1 deal riil Rp3.150.000 tidak cocok rumus linear 50xRp100.000=Rp5.000.000, kemungkinan sama persis dgn grup 'Jasa Desain 50 SKU' (skrip tidak menggabung karena beda frasa 'marketplace') -- rekomendasi merge manual ke Sales Head sebelum isi harga. |
| 113 | Jasa optimasi rating | 1 | Shopee Rating Optimization / TikTok Rating Optimization -- quantity tidak disebut |  | — | RENDAH | Nama generik tanpa platform/kuantitas eksplisit di canonical_name (platform_terlihat: TikTok, tapi nama tidak menyebut checkout count) -- tidak cukup dasar untuk rumus otomatis. |
| 114 | Jasa Iklan Meta CPAS Paket Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads CPAS x Shopee Premium. |
| 115 | IG Yohan | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- nama tidak jelas/kemungkinan nama internal staf tercatat sbg layanan -- tidak match kategori pricelist manapun; direkomendasikan Sales Head cek data mentah. |
| 116 | Meta - Jasa Free Trial TikTok Shop \| Yusi | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- nama mengandung ' \| Yusi' -- kemungkinan artefak data (nama staf/catatan internal ikut ter-parse sbg bagian nama layanan). Tidak match pricelist, direkomendasikan Sales Head/QC data cek baris asal. |
| 117 | Meta Ads CPAS Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads CPAS x Shopee Premium. |
| 118 | Meta Ads Premium+ | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads Premium. |
| 119 | Jasa Optimasi Rating Toko Tiktok | 1 | TikTok Rating Optimization -- quantity tidak disebut |  | — | RENDAH | Nama tidak menyebut jumlah checkout; tidak bisa dihitung rumus tanpa asumsi kuantitas. |
| 120 | Live Affiliate 1 Affiliator 30 Jam Day | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Live Affiliate lain. |
| 121 | Jasa Live Shopee 50 Jam | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Live Shopee Basic. |
| 122 | Konten Feed & Reels IG Pro | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- tidak ada item Feed/Reels IG per-paket di pricelist (hanya Short Video, Carousel, Single Image generik, bukan spesifik IG Feed/Reels 'Pro'). |
| 123 | Live Affiliate 3 Affiliator 30 Jam Day | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Live Affiliate lain. |
| 124 | Jasa Optimasi Rating 100x CO Shopee | 1 | Shopee Rating Optimization (Rp15.000/checkout, min 50) | 100 x Rp15.000 = Rp1.500.000 | — | SEDANG | kandidat pricelist: 100 x Rp15.000 = Rp1.500.000 (Shopee eksplisit di nama). Sufiks 'CO' tidak dijelaskan pricelist -- sama seperti baris 'Optimasi rating 100x CO', maknanya tidak pasti sehingga confidence ditahan di SEDANG meski platform & angka cocok. |
| 125 | GMV MAX Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 126 | GMV Max Tiktok MEA Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 127 | Jasa Live Shopee Basic+ | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Live Shopee Basic. |
| 128 | Jasa Live Streaming 30 Jam Malam | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | kandidat parsial: pricelist punya 'Night & Weekend Sessions' per sesi (3 jam) Rp150.000 -- 30 jam = 10 sesi x Rp150.000 = Rp1.500.000, TAPI 1 deal riil tercatat Rp4.000.000 (>2.6x rumus), dan 'Malam' tidak otomatis sama dengan 'Night & Weekend Sessions' (istilah pricelist mencakup weekend juga). Confidence RENDAH -- gap besar & definisi tidak identik. |
| 129 | Jasa Konten Feed Pro | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Konten Feed & Reels IG Pro. |
| 130 | Matchmaking Top Creator Tiktok Live Streaming 15 Affiliator 60 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 131 | Jasa Foto Katalog dan Model | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST persis -- kombinasi foto + model (talent) tidak punya 1 baris harga di pricelist (harus dijumlah Product Catalog Photos + Add On Talent, tapi rasio/jumlah tidak diketahui dari nama). |
| 132 | Matchmaking Top Creator Tiktok Live Streaming 3 Affiliator 60 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 133 | Jasa Live Streaming 60 Jam Night Ekonomis | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | kandidat parsial: 'Night & Weekend Sessions' Rp150.000/sesi (3 jam) -- 60 jam = 20 sesi x Rp150.000 = Rp3.000.000, deal riil Rp8.000.000 jauh di atas. Label 'Ekonomis' tidak dijelaskan pricelist -- RENDAH. |
| 134 | Perpanjangan | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- renewal generik, tidak ada di pricelist. |
| 135 | Jasa Trending Video Premium+ | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Jasa Trending Video Basic. |
| 136 | Jasa Buka Toko Online Shopee | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Buka Toko Online Basic. |
| 137 | Optimasi Rating Shopee 50x | 1 | Shopee Rating Optimization (per checkout, min 50, Rp15.000) | 50 x Rp15.000 = Rp750.000 | Rp 750.000 | TINGGI | Platform tunggal Shopee, rumus 50 x Rp15.000 = Rp750.000. 1 deal historis persis Rp750.000 -- cocok 100% dengan rumus pricelist (bukan nego turun). |
| 138 | Jasa Personal Branding | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- tidak ada kategori personal branding. |
| 139 | Fee Komitmen GMV Max MEA Free Biaya Jasa Free Komisi | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat komitmen fee GMV Max lain. |
| 140 | Komitmen Fee GMV MAX Advertising Management | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 141 | Paket Hemat Tiktok Ads 1 Bulan (Komisi 5%) | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket hemat + komisi custom, tidak match Store Management (konteks beda -- iklan TikTok, bukan store management). |
| 142 | Traffic Tiktok Awareness 360 Basic | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Traffic Tiktok Shop Awareness Basic 360. |
| 143 | Jasa GMV Max Basic | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat GMV Max Mea Basic. |
| 144 | Jasa Optimasi Rating 100x | 1 | Shopee Rating Optimization (Rp15.000/checkout, min 50) | 100 x Rp15.000 = Rp1.500.000 | — | SEDANG | kandidat pricelist: 100 x Rp15.000 = Rp1.500.000 (Shopee, platform tunggal di baris ini). Nama sangat mirip 'Optimasi Rating 100x' (290 deal, grup #1) dan 'Optimasi Rating Shopee 100x' -- kemungkinan varian penamaan layanan yang sama, ditandai 'MIRIP TAPI TIDAK DIGABUNG' oleh skrip kompilasi; menunggu keputusan merge Sales Head sebelum diisi TINGGI. |
| 145 | Matchmaking Top Creator Tiktok Live Streaming 1 Affiliator 30 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 146 | Traffic Tiktok Awareness 360 Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Traffic Tiktok Shop Awareness Premium 360. |
| 147 | Optimasi Rating Shopee | 1 | Shopee Rating Optimization (per checkout, min 50, Rp15.000) -- TIDAK JELAS quantity | nama tidak menyebut jumlah checkout (bukan '...100x' / '...50x') | — | RENDAH | kandidat pricelist: Shopee Rating Optimization, tapi nama layanan TIDAK menyebut kuantitas (berbeda dari 'Optimasi Rating Shopee 100x'/'50x') sehingga rumus 'N x Rp15.000' tidak bisa ditentukan tanpa asumsi. 1 deal historis Rp1.300.000 = 87x checkout jika dihitung mundur -- kemungkinan varian ejaan dari 100x, perlu konfirmasi Sales Head, TIDAK diasumsikan. |
| 148 | Komitmen Fee GMV Max Mea Paket B | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Komitmen fee Paket GMV Max Mea Paket B. |
| 149 | Jasa Traffic SEO Awareness | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- SEO tidak ada di pricelist (pricelist hanya cover Ads platform sosial/marketplace). |
| 150 | Matchmaking Top Creator Shopee Live Streaming 3 Affiliator 60 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 151 | Jasa MEAGO Basic | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- MEAGO (sister brand/produk) tidak ada di pricelist MEA Agency ini. |
| 152 | Matchmaking Creator Tiktok Live Streaming 3 Affiliator 16 Jam Day | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 153 | Live Streaming Basic | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara persis -- pricelist punya 'Live Streaming (education & selling)' Rp350.000/sesi (3 jam, min 10 sesi = Rp3.500.000 dasar) tapi nama 'Basic' tidak menyebut sesi/jam sehingga rumus tidak bisa dipastikan; 1 deal riil Rp3.000.000 mendekati tapi tidak presisi (=~8.6 sesi), tidak diasumsikan. |
| 154 | Jasa live Streaming | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara persis -- nama generik tanpa jam/sesi, tidak match satuan pricelist manapun secara pasti. |
| 155 | Matchmaking Creator Tiktok Live Streaming 1 Affiliator 16 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 156 | 6 affliator 16 jam night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- paket 6-affiliator custom, tidak ada di pricelist (bukan satuan per-KOL/per-session langsung). |
| 157 | Store Management | 1 | A. Store Management (paket header: Rp6.000.000 + komisi 5%) | Rp6.000.000 (harga paket header) + komisi 5% of standard price | Rp 6.000.000 | TINGGI | Match langsung header pricelist 'A. Store Management' = Rp6.000.000 + komisi 5%. 1 deal riil tercatat Rp36.000.000 (durasi 6 bulan) = Rp6.000.000 x 6 bulan -- konsisten dengan Rp6.000.000/bulan sebagai standard_price bulanan (paket ini 'Monthly' per pricelist), MEMPERKUAT confidence TINGGI. usulan commission_rule: `5% of standard price` |
| 158 | MEAGO Video | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa MEAGO Basic. |
| 159 | Massive Video Affiliate Premium+ | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST persis -- sama seperti Massive Video Affiliate. |
| 160 | Matchmaking Top Creator Shopee Live Streaming 1 Affiliator 30 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 161 | Jasa Meta Ads CPAS x Shopee Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Meta Ads CPAS x Shopee Premium. |
| 162 | Jasa Live Tiktok 50 Jam | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Live Shopee Basic. |
| 163 | Jasa Live Tiktok Basic+ | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Live Shopee Basic. |
| 164 | Jasa Live Tiktok Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Jasa Live Shopee Basic. |
| 165 | Add On Talent Foto | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- 'Model (Add On)' tidak berharga di sheet sumber. |
| 166 | Paket Hemat Awareness TikTok Premium | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat Paket Hemat Basic. |
| 167 | Matchmaking Creator Tiktok  Live Streaming 3 Affiliator 30 Jam Night | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat matchmaking lain. |
| 168 | Jasa Live Streaming Reguler | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST secara persis -- sama seperti Jasa live Streaming. |
| 169 | 6 Affliator Shopee Video | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- lihat 6 affliator 16 jam night. |
| 170 | Short Video (UGC Style) / Ad Content | 1 | Short Video (UGC Style) / Ad Content (per video, min 5, Rp150.000) | nama identik persis dgn pricelist -- tapi satuan per-video x kuantitas tidak diketahui dari nama MSL | — | SEDANG | kandidat pricelist: nama MATCH PERSIS 'Short Video (UGC Style) / Ad Content', Rp150.000/video, min 5 video. Tapi 1 deal riil di MSL = Rp135.000.000 (durasi 6 bulan) -- jauh melebihi rumus 5 video x Rp150.000 = Rp750.000, indikasi deal ini adalah paket volume tinggi/bulanan berulang, bukan harga dasar per-video. Nama match sempurna tapi granularitas paket vs satuan berbeda jauh -- perlu Sales Head konfirmasi jumlah video riil dalam paket Rp135 juta sebelum standard_price ditetapkan sbg harga per-video dasar. |
| 171 | Add On Talent Video | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- 'Model (Add On)' tidak berharga di sheet sumber. |
| 172 | Jasa Konten Feed dan Reels Pro+ | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Konten Feed & Reels IG Pro. |
| 173 | Admin Campaign | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- sama seperti Jasa Admin Campaign Marketplace. |
| 174 | OBS | 1 | Banner / OBS Design (Per 5 slide, min 1, Rp250.000) | ambigu -- satuan 'per 5 slide', jumlah slide di deal tidak diketahui | — | SEDANG | kandidat pricelist: Banner/OBS Design Rp250.000 per 5 slide. 1 deal riil hanya Rp750.000 = 3x Rp250.000 (=15 slide jika linear) -- masuk akal tapi jumlah slide riil tidak tercatat di MSL, tidak dipastikan. |
| 175 | Massive Video Affiliate | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST persis -- 'Massive Video Production' ada tapi 'Affiliate' adalah kategori berbeda (affiliator/KOL), tidak digabungkan. |
| 176 | Short Video (Premium) | 1 | Short Video (Premium) (per video, min 5, Rp250.000) | nama identik persis -- 1 deal riil Rp90.000.000 (durasi 6 bulan) jauh dari rumus dasar 5 x Rp250.000 = Rp1.250.000 | — | SEDANG | kandidat pricelist: nama match persis, Rp250.000/video, min 5 video (=Rp1.250.000 dasar). Deal riil Rp90.000.000/6 bulan adalah paket volume besar, bukan harga satuan dasar -- sama seperti 'Short Video (UGC Style)', perlu pemecahan jumlah video oleh Sales Head sebelum standard_price final. |
| 177 | Jasa Addon Live Streaming Malam Weekday | 1 | Night & Weekend Sessions (per session 3 jam, Rp150.000) -- 'Weekday' vs 'Weekend' tidak match nama pricelist |  | — | RENDAH | Nama pricelist eksplisit 'Night & WEEKEND Sessions' sedangkan baris ini 'Malam WEEKDAY' -- justru kebalikan cakupan hari, tidak match langsung; tidak diisi. |
| 178 | Massive Video Production | 1 | Massive Video Production (sample required) (per 1 video, min 50, Rp50.000) | 50 x Rp50.000 = Rp2.500.000 (dasar minimum) | — | SEDANG | kandidat pricelist: nama MATCH PERSIS 'Massive Video Production'. Dasar minimum 50 video x Rp50.000 = Rp2.500.000, tapi 1 deal riil Rp30.000.000 (durasi 6 bulan) jauh melebihi minimum -- indikasi volume video riil jauh di atas 50 (atau paket bulanan berulang), jumlah video aktual tidak diketahui dari MSL. Tidak diisi otomatis. |
| 179 | Jasa Addon Live Streaming Malam Weekend | 1 | Night & Weekend Sessions (per session 3 jam, Rp150.000) | tidak jelas berapa sesi/jam dalam 1 unit 'addon' | — | SEDANG | kandidat pricelist: Night & Weekend Sessions Rp150.000/sesi (3 jam) -- namanya paling cocok scr konsep (malam + weekend) tapi jumlah sesi per 'addon' tidak disebut MSL; 1 deal riil Rp1.500.000 = tepat 10 x Rp150.000, kebetulan sama persis dgn baris 'Jasa Live Streaming 30 Jam Malam' (10 sesi = 30 jam) -- kemungkinan kedua baris ini sama, tapi tidak digabung otomatis (nama beda jauh). Menunggu konfirmasi Sales Head. |
| 180 | Add on | 1 | TIDAK ADA DI PRICELIST | — | — | RENDAH | TIDAK ADA DI PRICELIST -- nama terlalu generik ('Add on' tanpa keterangan) untuk dicocokkan ke salah satu baris Add On pricelist manapun -- tidak match pasti. |

## (a) Item pricelist yang TIDAK muncul di ledger (180 layanan MSL)

Item-item berikut ADA di pricelist resmi tetapi TIDAK menjadi kandidat match untuk baris manapun di `MSL_DRAFT_KOMPILASI.csv` (baik karena tidak ada 1 deal pun dgn nama serupa dalam 1.517 baris ledger, atau baris pricelist memang belum berharga di sheet sumber):

- 1. Store Management (paket, Monthly)
- 2. Growth Strategic (paket, Monthly)
- 3. Account Manager (paket, Monthly)
- 4. Insight & Analytic (paket, Monthly)
- 5. Ads Management (paket, Monthly)
- Awareness & Consideration Phase (per 1K view, min 300, Rp10.000, Monthly)
- GMV MAX (baris ada, harga kosong di sheet sumber)
- Product Catalog Photos – 4 Outputs (per produk, min 1, Rp150.000, One-time)
- Product Catalog Photo – 1 Output (per foto, min 1, Rp40.000)
- Thematic Product Photos – 4 Outputs (per produk, min 1, Rp250.000, One-time)
- SKU Video (per produk, min 1, Rp150.000, One-time)
- SKU Design (per SKU, min 1, Rp100.000)
- Banner / OBS Design (Per 5 slide, min 1, Rp250.000)
- Carousel Content (per set 5 konten, min 5, Rp150.000, Monthly)
- Single Image Content (min 5, Rp50.000)
- Nano KOL 1K-10K followers (per KOL, min 10, Rp5.000.000, Campaign, 10% ratecard)
- Micro KOL 10K-50K followers (per KOL, min 1, Rp5.000.000, Campaign, 10% ratecard)
- Macro & Mega KOL 50K-500K followers (per KOL, min 1, Rp10.000.000, Campaign, 10% ratecard)
- TOTAL AWARENESS (per 10K view, min 10, Rp100.000)
- Live Streaming (education & selling) (per session 3 jam, min 10, Rp350.000, Monthly)
- Educational Videos (per video, min 5, Rp250.000, Monthly)
- Live with TC / KOL / Celebrities (10% Rate Card, Rp10.000.000)
- Video with TC / KOL / Celebrities (10% Rate Card, Rp10.000.000)
- Special Spot (Rp700.000)
- Night & Weekend Sessions (per session 3 jam, Rp150.000)
- Customer Review Management (per bulan, Rp500.000, Monthly)
- Video Review (per video, min 5, Rp20.000)

Catatan: `Massive Video Production (sample required)`, `Shopee Rating Optimization`, dan `TikTok Rating Optimization` MUNCUL sbg kandidat match (lihat tabel di atas) sehingga tidak dimasukkan ke daftar ini.

## (b) Statistik ringkas

- Total layanan MSL draft: **180**

- Confidence **TINGGI** (harga terisi otomatis di CSV): **4**

- Confidence **SEDANG** (kandidat dicatat, harga TIDAK diisi, menunggu Sales Head): **17**

- Confidence **RENDAH** / tidak ada dasar pricelist (murni menunggu Sales Head): **159**

- `usulan_commission_rule` terisi otomatis (grammar O14 eksplisit dari pricelist): **1** (Store Management, `5% of standard price`)

- Dari 180 layanan, **176 baris (~98%) masih menunggu keputusan harga Sales Head**, baik karena kandidat ambigu (SEDANG) maupun tidak tercakup pricelist sama sekali (RENDAH).

