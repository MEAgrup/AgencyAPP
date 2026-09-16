# Referensi — `level2_category` TikTok (Product Exchange M3, M3-03-KATEGORI-MAPPING)

> Sumber: Google Sheet dibagikan pemilik 2026-09-16 (laporan performa afiliasi TikTok Shop MEA,
> Juli 2026, kolom "Level 1 category"/"Level 2 category" per produk, plus tab terpisah
> "list unique cateogry lvl 2"). Disimpan verbatim di sini supaya tidak hilang seperti
> `CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md` (M19, dicatat `docs/DECISIONS.md` 2026-09-10) —
> dokumen sumber eksternal yang dirujuk tapi tidak pernah di-commit.

## Yang dokumen ini SELESAIKAN

Daftar **137 nilai unik `Level 2 category`** TikTok Shop di bawah adalah subset yang teramati dari
seluruh 198 nilai yang disebut `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` P-02 sebagai taksonomi
`level2_category` MCN. Ini SEKARANG bisa jadi rujukan tertulis untuk nama-nama kategori yang sah —
sebelum ini, satu-satunya sumber adalah `listKategoriOptions` (baca langsung dari
`px_coverage_snapshot`, hanya nilai yang PERNAH di-push MCN, bukan katalog resmi).

## Yang dokumen ini BELUM selesaikan (gap granularitas — M3-03 sendiri sudah DITUTUP 2026-09-16)

> **Update 2026-09-16**: `M3-03-KATEGORI-MAPPING` (`docs/DECISIONS.md`) sudah ditutup — pemilik
> memilih opsi (c): dropdown `level2_category` tetap TIDAK tersaring secara PERMANEN (fallback
> Rule 10), AM tetap konfirmasi manual dari daftar penuh. Gap granularitas di bawah ini **tetap
> nyata** dan **tetap TIDAK dipetakan otomatis** — bedanya sekarang eksplisit: pemetaan
> `kategori_platform → level2_category` bukan lagi "menunggu Hans untuk MENUTUP tiket", melainkan
> "sengaja tidak dibangun sampai Hans/master kategori resmi ada" (keputusan final, bukan status
> tertunda). Dokumen ini tetap berguna sebagai referensi AM dan sebagai bahan awal kalau/ketika
> master kategori itu dibangun.

`kategori_platform` (kolom yang benar-benar ditulis `pdt_sku_master`, dibaca dari `tt_orders`
"Product Category") **BUKAN** granularitas yang sama dengan `level2_category` di bawah — ia lebih
KASAR dan berbahasa Indonesia. Bukti langsung dari fixture tes PDT
(`packages/core/src/pdt/fakta.test.ts`, `ekstrakBarisSkuMasterTtOrders`):
`kategoriPlatform: 'Fashion Pria'` — satu nilai kasar yang, dari daftar Level 2 di bawah, bisa
berpadanan dengan SALAH SATU dari sekurangnya sembilan `level2_category`: `Men's Tops`,
`Men's Bottoms`, `Men's Underwear & Socks`, `Men's Shoes`, `Men's Bags`, `Men's Care`,
`Men's Special Occasion Clothing`, `Men's Islamic Clothing`, `Fashion Watches & Accessories`
(tergantung produknya). Ini PERSIS peringatan `CDPS_PDT_Pusat_Data_Toko.md` P-02: *"granularitasnya
beda"* — bukan lagi dugaan, sekarang dikonfirmasi dengan nilai fixture nyata + daftar Level 2 nyata.

**Konsekuensinya**: dokumen ini TIDAK bisa langsung dipakai membangun pemetaan
`kategori_platform → level2_category` satu-ke-satu di kode — melakukannya berarti menebak cabang
mana dari sembilan+ opsi yang benar untuk "Fashion Pria", persis pelanggaran aturan rumah
"jangan pernah menebak isi mapping yang ambigu." Yang dokumen ini SUDAH sediakan: pasangan
Level 1 ↔ Level 2 yang TERAMATI di sampel data (bukan katalog resmi lengkap, hanya yang muncul di
137 baris performa afiliasi Juli 2026) — lihat tabel §2. Kalau pemetaan yang dimaksud pemilik
adalah level KASAR (Level 1, mis. "Fashion Pria" ≈ `Womenswear & Underwear`-nya versi pria) bukan
Level 2 langsung, itu tetap butuh SATU keputusan lagi: apakah AM tetap memilih Level 2 final secara
manual dari cabang yang sudah dipersempit (paling aman, konsisten Rule 11 "AM tetap konfirmasi
manual"), atau sistem mengarang default tanpa konfirmasi (DITOLAK — melanggar Rule 9-11).

## §1 — 137 `level2_category` unik (Juli 2026, TikTok Shop)

Alternative Medications & Treatments, Audio & Video, Auto Replacement Parts, Baby Care & Health,
Baby Clothing & Shoes, Baby Furniture, Baby Travel Gear, Bag Accessories, Bakeware, Baking,
Barbecue, Bath & Body Care, Bathroom Fixtures, Bathroom Supplies, Bedding and Linens,
Boys' Clothes, Boys' Footwear, Building Supplies, Cameras & Photography, Camping & Hiking,
Car Electronics, Car Exterior Accessories, Car Interior Accessories, Car Lights, Car Repair Tools,
Car Washing & Maintenance, Children's & Infants' Books, Children's Furniture,
Classic & Novelty Toys, Clothes Accessories, Commercial Appliances, Computer Accessories,
Cookware, Costume Jewelry & Accessories, Cutlery & Tableware, Data Storage & Software,
Desktop Computers, Laptops & Tablets, DIY, Dog & Cat Accessories, Dog & Cat Clothing,
Dog & Cat Food, Dog & Cat Furniture, Dog & Cat Healthcare, Dog & Cat Litter,
Dolls & Stuffed Toys, Dressmaking Fabrics, Drinks, Drinkware, Economics & Management,
Education & Schooling, Educational Toys, Electrical Equipment & Supplies, Eye & Ear Care,
Eyewear, Fashion Watches & Accessories, Feminine Care, Festive & Party Supplies, Fitness,
Formula Milk & Baby Food, Fragrance, Fresh & Frozen Food, Functional Bags, Games & Puzzles,
Garden Supplies, Girls' Clothes, Girls' Footwear, Gold, Hair Accessories, Haircare & Styling,
Hand & Foot Care, Hardware, Hijabs, Home Appliances, Home Care Supplies, Home Decor,
Home Organizers, Household Textiles, Humanities & Social Sciences, Indoor Furniture,
Islamic Accessories, Islamic Sportswear, Kids' Fashion Accessories, Kids' Islamic Clothing,
Kitchen Appliances, Kitchen Fixtures, Kitchen Utensils & Gadgets, Large Home Appliances,
Laundry Tools & Accessories, Leisure & Outdoor Recreation Equipment, Lights & Lighting,
Luggage & Travel Bags, Magazines & Newspapers, Makeup, Maternity Supplies, Medical Supplies,
Men's Bags, Men's Bottoms, Men's Care, Men's Islamic Clothing, Men's Shoes,
Men's Special Occasion Clothing, Men's Tops, Men's Underwear & Socks, Milk & Dairy,
Miscellaneous Home, Mobile Phone Accessories, Motorcycle Accessories, Motorcycle Parts,
Nail Care, Nasal & Oral Care, Network Components, Nursing & Feeding, Nutrition & Wellness,
Office Stationery & Supplies, Outerwear, Pantry Food, Personal Care Appliances,
Phones & Tablets, Prayer Attire & Equipment, Pumps & Plumbing, Shoe Accessories, Skincare,
Smart & Wearable Devices, Smart Home Systems, Snacks, Special Personal Care,
Sport & Outdoor Clothing, Sports & Outdoor Accessories, Sports Footwear,
Staples & Cooking Essentials, Tablet & Computer Accessories, Universal Accessories,
Women's Bags, Women's Bottoms, Women's Dresses, Women's Islamic Clothing, Women's Shoes,
Women's Sleepwear & Loungewear, Women's Special Clothing, Women's Suits & Sets, Women's Tops,
Women's Underwear.

## §2 — Pasangan Level 1 ↔ Level 2 TERAMATI (parsial, dari 137 baris sampel — BUKAN katalog resmi lengkap)

| Level 1 category | Level 2 category (teramati) |
|---|---|
| Phones & Electronics | Phones & Tablets |
| Beauty & Personal Care | Fragrance, Bath & Body Care, Skincare, Makeup |
| Food & Beverages | Staples & Cooking Essentials, Milk & Dairy, Drinks |
| Baby & Maternity | Baby Care & Health |
| Luggage & Bags | Functional Bags, Women's Bags |
| Health | Nutrition & Wellness, Medical Supplies |
| Womenswear & Underwear | Women's Tops, Women's Dresses, Women's Bottoms, Women's Underwear |
| Kitchenware | Drinkware |
| Furniture | Indoor Furniture |

Catatan: tabel di atas HANYA pasangan yang benar-benar muncul berdampingan di 137 baris sampel
Juli 2026 — bukan hasil query katalog resmi TikTok (yang dari 198 nilai penuh). Jangan
diperlakukan sebagai lengkap; satu Level 1 di sini bisa punya cabang Level 2 lain di luar sampel.
