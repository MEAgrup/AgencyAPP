/**
 * PDT (Pusat Data Toko) — identitas toko & periode dari BERKAS (G1-06, PRD §3.1
 * Rule 2-5, `docs/backlog/PDT_BACKLOG.md` G1-06).
 *
 * Fungsi murni saja — nol I/O, nol DB. Pemanggil (batch-creation, belum
 * dibangun — G1-07/G1-09) yang membaca `client_platforms.shop_id`/
 * `akun_konten_toko` dan menulis `pdt_upload_batch.status`/`identitas_sumber`.
 * Pola sama dengan G1-02..G1-05: engine murni lebih dulu, penulis DB menyusul
 * saat pipa batch lengkap.
 *
 * **Format preamble Shopee BELUM terverifikasi ke sample asli** (export asli
 * tidak disimpan di repo — §9 P-04/A-3). Repo ini sendiri sudah punya DUA
 * bentuk fixture untuk baris preamble yang sama:
 *  - `pdt/detect.test.ts` + `apps/api/src/lib/pdt-parse.test.ts` (dibangun G1-02/
 *    G1-05): SATU sel per baris, `"ID Toko: 938284780"` (label:value digabung).
 *  - `report/shopee/shopee.test.ts` `extractIdentity` (kode LAMA, non-PDT):
 *    DUA sel per baris, `['ID Toko', 'SHOP-1']`.
 * `ekstrakPreambleShopee` menerima KEDUANYA (bukan menebak salah satu) —
 * dicatat `docs/DECISIONS.md` G1-06, bukan ditebak diam-diam.
 *
 * **Kolom periode TikTok (`Date Range`/`Rentang Tanggal`/`Tanggal analisis`,
 * Rule 5) — DITUTUP `G1-06-PERIODE-TIKTOK` (`docs/DECISIONS.md`) lewat sample
 * asli "Tiktok - Avitaskin.zip".** Ketiga kandidat TERNYATA ADA di sample —
 * tapi bukan sebagai NAMA KOLOM header (tebakan awal), melainkan sebagai
 * PREAMBLE satu-sel "Label: value" TEPAT SEBELUM baris header, pola SAMA
 * dengan preamble Shopee (`ekstrakPreambleShopee`), dengan variasi
 * label/format per jenis berkas:
 *  - `Shop Analytics_Key metrics_*.xlsx` / `product_list_20260701.xlsx`:
 *    `"Tanggal analisis: 01/07/2026–01/07/2026"` — DD/MM/YYYY, pemisah EN
 *    DASH "–" (U+2013), BUKAN hyphen ASCII.
 *  - `Live Analysis*.xlsx`: `"Date Range: 2026-07-01 ~ 2026-07-31\n"` —
 *    YYYY-MM-DD, pemisah tilde "~", baris diakhiri newline literal di sel.
 *  - `Video Performance List_*.xlsx`: `"[Rentang Tanggal]: 2026-07-01 ~
 *    2026-07-31\n"` — label DIBUNGKUS KURUNG SIKU, sisanya sama pola
 *    `Live Analysis`.
 *  - `product_list.xlsx` (varian TANPA "ID Produk"): `"2026-07-01 ~
 *    2026-07-31"` — TANPA label sama sekali, seluruh sel HANYA rentangnya.
 * `ekstrakPeriodePreambleTiktok` di bawah menangani KEEMPAT bentuk ini —
 * bukan kolom header sama sekali, jadi fungsi lama `ekstrakPeriodeKolomTiktok`
 * (yang mencari NAMA KOLOM di baris header) DIHAPUS, bukan diperbaiki di
 * tempat (arsitekturnya salah total, bukan cuma kandidatnya).
 */

const normLabel = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/** "DD/MM/YYYY" → "YYYY-MM-DD", atau `null` bila bentuknya tidak cocok/kalendernya tidak valid. */
export function parseTanggalId(s: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Bulatkan-ke-belakang kalender (mis. 31/02) ditolak — Date.UTC round-trip.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * `"DD/MM/YYYY HH:MM:SS"` → `"YYYY-MM-DD"` (bagian JAM dibuang), atau `null`
 * bila bagian tanggalnya tidak terparse. Bagian waktu BOLEH tidak ada —
 * fungsi ini menerima `"DD/MM/YYYY"` polos dan berperilaku persis
 * `parseTanggalId`.
 *
 * Dipakai `ekstrakBarisBatalHarianTtOrders` untuk kolom `Created Time`
 * (B1-BATAL-TIKTOK). Bentuknya diverifikasi ke ekspor asli
 * `Semua pesanan-2026-08-10-15_50.csv`: sel-selnya berbunyi
 * `"31/07/2026 20:29:25\t"` — SLASH seperti `parseTanggalId`, tapi dengan
 * jam DAN tab di belakang, jadi regex "seluruh sel adalah tanggal" milik
 * `parseTanggalId` menolaknya mentah-mentah. `trim()` membuang tab-nya,
 * `split` pada spasi memisahkan jamnya; sisanya didelegasikan supaya hanya
 * ADA SATU tempat yang memvalidasi kalender (31/02 tetap ditolak).
 *
 * Zona waktu TIDAK dikonversi — `Created Time` sudah waktu lokal toko, basis
 * yang sama dengan baris harian `tt_shop_analytics` yang jadi tetangganya di
 * `pdt_fact_shop_daily`.
 */
export function parseTanggalIdWaktu(s: string): string | null {
  const tanggalSaja = String(s ?? '').trim().split(/\s+/)[0] ?? '';
  return parseTanggalId(tanggalSaja);
}

/**
 * "DD-MM-YYYY" (STRIP, bukan slash) → "YYYY-MM-DD", atau `null` bila bentuk/
 * kalendernya tidak valid. Beda dari `parseTanggalId` (Shopee preamble
 * `Date Range`, SLASH) — sesi 34, verifikasi sample asli "Shopee - Fim
 * Motor.zip" (`fim_motor.shopee-shop-stats.*.xlsx`, kolom `Tanggal` baris
 * harian): dua modul Shopee yang BERBEDA membawa dua bentuk tanggal yang
 * BERBEDA secara nyata, bukan salah satu tebakan yang lalu diseragamkan.
 */
export function parseTanggalIdStrip(s: string): string | null {
  const m = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})\s*$/.exec(s);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → sama persis (ternormalisasi ulang), atau `null` bila bentuk/kalendernya tidak valid. Dipakai preamble TikTok (`Date Range`/`[Rentang Tanggal]`, lihat docblock berkas) — beda dari `parseTanggalId` (Shopee, DD/MM/YYYY). */
export function parseTanggalIso(s: string): string | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface PdtRentangTanggal {
  mulai: string; // "YYYY-MM-DD"
  selesai: string; // "YYYY-MM-DD"
}

/** "DD/MM/YYYY - DD/MM/YYYY" → rentang, atau `null` bila salah satu sisi tidak terparse. */
export function parseRentangTanggal(s: string): PdtRentangTanggal | null {
  const m = /^\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*$/.exec(s);
  if (!m) return null;
  const mulai = parseTanggalId(m[1]);
  const selesai = parseTanggalId(m[2]);
  if (mulai == null || selesai == null) return null;
  return { mulai, selesai };
}

export interface PdtPreambleShopee {
  idToko: string | null;
  username: string | null;
  namaToko: string | null;
  periode: PdtRentangTanggal | null;
}

const LABEL_KUNCI: Record<string, keyof Omit<PdtPreambleShopee, 'periode'> | 'periode'> = {
  'id toko': 'idToko',
  username: 'username',
  'nama toko': 'namaToko',
  periode: 'periode',
};

/**
 * Baca preamble Shopee (`ID Toko`/`Username`/`Nama Toko`/`Periode`, Rule 2/5,
 * baris 1-6 sebelum header) dari SELURUH baris sebelum `barisHeader` (1-terindeks,
 * `PdtModuleDef.barisHeaderHint`). Menerima dua bentuk baris (lihat docblock
 * berkas): satu-sel `"Label: value"` maupun dua-sel `["Label", "value"]`.
 */
export function ekstrakPreambleShopee(aoa: readonly (readonly unknown[])[], barisHeader: number): PdtPreambleShopee {
  const hasil: PdtPreambleShopee = { idToko: null, username: null, namaToko: null, periode: null };
  const batasBaris = Math.max(0, barisHeader - 1);
  for (const row of aoa.slice(0, batasBaris)) {
    if (!row || row.length === 0) continue;
    let label: string;
    let nilai: string;
    if (row.length === 1) {
      const cell = String(row[0] ?? '');
      const idx = cell.indexOf(':');
      if (idx === -1) continue;
      label = normLabel(cell.slice(0, idx));
      nilai = cell.slice(idx + 1).trim();
    } else {
      label = normLabel(row[0]);
      nilai = String(row[1] ?? '').trim();
    }
    const kunci = LABEL_KUNCI[label];
    if (!kunci || nilai === '') continue;
    if (kunci === 'periode') hasil.periode = parseRentangTanggal(nilai);
    else hasil[kunci] = nilai;
  }
  return hasil;
}

export interface PdtKolomTerbanyakHasil {
  nilai: string;
  jumlah: number;
  totalBaris: number;
}

/**
 * Cari kolom `namaKolom` di baris header `barisHeader` (1-terindeks) dan
 * kembalikan nilai yang PALING SERING muncul di bawahnya + berapa kali —
 * dipakai untuk mengusulkan `ID Kreator` TikTok (Rule 4: "mengusulkan ID
 * Kreator yang paling sering muncul di berkas"). `null` bila kolomnya tidak
 * ditemukan atau tidak ada satu pun baris data berisi.
 */
export function kolomTerbanyak(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
  namaKolom: string,
): PdtKolomTerbanyakHasil | null {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = header.findIndex((c) => normLabel(c) === normLabel(namaKolom));
  if (idx === -1) return null;

  const hitung = new Map<string, number>();
  let total = 0;
  for (const row of aoa.slice(barisHeader)) {
    const v = String(row?.[idx] ?? '').trim();
    if (v === '') continue;
    total += 1;
    hitung.set(v, (hitung.get(v) ?? 0) + 1);
  }
  if (total === 0) return null;

  let nilaiTerbanyak = '';
  let jumlahTerbanyak = -1;
  for (const [nilai, jumlah] of hitung) {
    if (jumlah > jumlahTerbanyak) {
      nilaiTerbanyak = nilai;
      jumlahTerbanyak = jumlah;
    }
  }
  return { nilai: nilaiTerbanyak, jumlah: jumlahTerbanyak, totalBaris: total };
}

/**
 * Label preamble periode TikTok yang TERVERIFIKASI ke sample asli
 * ("Tiktok - Avitaskin.zip", `docs/DECISIONS.md` G1-06-PERIODE-TIKTOK) —
 * dibandingkan SETELAH kurung siku `[...]` dilepas dan dinormalisasi
 * (lihat `ekstrakPeriodePreambleTiktok`), BUKAN nama kolom header.
 */
export const KANDIDAT_LABEL_PERIODE_TIKTOK: readonly string[] = ['Date Range', 'Rentang Tanggal', 'Tanggal analisis'];

/** "DD/MM/YYYY-DD/MM/YYYY" (hyphen ASCII ATAU en dash "–") atau "YYYY-MM-DD~YYYY-MM-DD" → rentang, atau `null`. Dua bentuk TERVERIFIKASI sample asli TikTok (lihat docblock berkas) — BEDA dari `parseRentangTanggal` (Shopee, hyphen ASCII saja), sengaja dipisah supaya perluasan bentuk TikTok tidak diam-diam melonggarkan parser Shopee. */
export function parseRentangTanggalTiktok(s: string): PdtRentangTanggal | null {
  const mId = /^\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*$/.exec(s);
  if (mId) {
    const mulai = parseTanggalId(mId[1]);
    const selesai = parseTanggalId(mId[2]);
    if (mulai != null && selesai != null) return { mulai, selesai };
  }
  const mIso = /^\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(s);
  if (mIso) {
    const mulai = parseTanggalIso(mIso[1]);
    const selesai = parseTanggalIso(mIso[2]);
    if (mulai != null && selesai != null) return { mulai, selesai };
  }
  // Bentuk KETIGA, terverifikasi ke sample asli `tt_affiliate_video`
  // ("CustomReport_Campaign_Creator_Product_Shop_Video_2026-08-01_2026-08-31.xlsx",
  // kolom `Date` = "2026-08-01-2026-08-31"): dua tanggal ISO dipisah hyphen,
  // TANPA tilde. Tidak ambigu walau hyphen juga jadi pemisah komponen tanggal —
  // panjang tiap sisi terkunci `\d{4}-\d{2}-\d{2}`.
  const mIsoHyphen = /^\s*(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})\s*$/.exec(s);
  if (mIsoHyphen) {
    const mulai = parseTanggalIso(mIsoHyphen[1]);
    const selesai = parseTanggalIso(mIsoHyphen[2]);
    if (mulai != null && selesai != null) return { mulai, selesai };
  }
  return null;
}

/**
 * Baca rentang tanggal dari sebuah KOLOM DATA (bukan preamble) — dipakai HANYA
 * oleh modul yang mendaftarkan `PdtModuleDef.kolomPeriode`, lihat docblock
 * field itu untuk kenapa pengecualian ini ada dan kenapa ia ber-nama.
 *
 * Nilai yang dipakai adalah rentang TERBANYAK di kolom itu, bukan baris
 * pertama dan bukan nilai terbanyak apa pun: baris `Summary` TikTok duduk
 * tepat di bawah header dan mengisi kolom ini dengan literal `"Summary"`.
 * Sel yang TIDAK bisa diparse jadi rentang karena itu tidak ikut dihitung
 * sama sekali — bukan sekadar kalah suara. Bedanya nyata untuk berkas
 * ber-SATU baris data: di sana `"Summary"` dan rentangnya sama-sama muncul
 * sekali, dan `kolomTerbanyak` (Rule 3 `ID Kreator`) akan memenangkan yang
 * PERTAMA, yaitu `"Summary"`.
 *
 * `null` bila kolomnya tidak ada atau nol sel yang bisa diparse jadi rentang
 * — berkas lalu MEWARISI periode batch (Rule 5 ayat 2), sama seperti berkas
 * tanpa preamble.
 */
export function ekstrakPeriodeKolomTiktok(
  aoa: readonly (readonly unknown[])[],
  barisHeader: number,
  namaKolom: string,
): PdtRentangTanggal | null {
  const header = aoa[barisHeader - 1] ?? [];
  const idx = header.findIndex((c) => normLabel(c) === normLabel(namaKolom));
  if (idx === -1) return null;

  const hitung = new Map<string, { rentang: PdtRentangTanggal; jumlah: number }>();
  for (const row of aoa.slice(barisHeader)) {
    const v = String(row?.[idx] ?? '').trim();
    if (v === '') continue;
    const sudah = hitung.get(v);
    if (sudah) {
      sudah.jumlah += 1;
      continue;
    }
    const rentang = parseRentangTanggalTiktok(v);
    if (rentang) hitung.set(v, { rentang, jumlah: 1 });
  }

  let menang: { rentang: PdtRentangTanggal; jumlah: number } | null = null;
  for (const kandidat of hitung.values()) {
    if (menang == null || kandidat.jumlah > menang.jumlah) menang = kandidat;
  }
  return menang?.rentang ?? null;
}

/**
 * Baca rentang tanggal dari PREAMBLE TikTok (baris sebelum `barisHeader`,
 * satu sel BERISI per baris — lihat docblock kepala berkas untuk keempat
 * bentuk TERVERIFIKASI). **Sel setelah yang pertama boleh ADA tapi harus
 * kosong** — bukan hanya kelonggaran, ini KEHARUSAN: `XLSX.utils.sheet_to_json`
 * (`header:1, defval:''`) MEMADATKAN setiap baris ke lebar kolom SHEET
 * (bukan lebar baris itu sendiri, dibuktikan lewat sample asli DAN
 * round-trip nyata `aoa_to_sheet`→tulis→baca) — preamble asli SENDIRI
 * datang sebagai `['Tanggal analisis: ...', '', '', ..., '']`, bukan
 * `['Tanggal analisis: ...']` polos; memeriksa `row.length === 1` GAGAL
 * terhadap bentuk asli maupun round-trip. Untuk tiap baris preamble: coba
 * pisah `"Label: value"` lalu cocokkan label (kurung siku dilepas, case-
 * insensitive) ke `KANDIDAT_LABEL_PERIODE_TIKTOK`; bila tidak cocok/tidak
 * ada titik dua, coba PULA seluruh isi sel sebagai rentang TANPA label
 * (bentuk `product_list.xlsx`). `null` bila nol baris preamble menghasilkan
 * rentang yang bisa diparse — berkas ini dianggap "tidak membawa periode
 * terbaca" dan mewarisi periode batch (Rule 5 ayat 2), BUKAN gagal.
 */
export function ekstrakPeriodePreambleTiktok(aoa: readonly (readonly unknown[])[], barisHeader: number): PdtRentangTanggal | null {
  const batasBaris = Math.max(0, barisHeader - 1);
  for (const row of aoa.slice(0, batasBaris)) {
    if (!row || row.length === 0) continue;
    if (!row.slice(1).every((c) => String(c ?? '').trim() === '')) continue; // sel ke-2+ HARUS kosong (padding sheet, bukan data sungguhan)
    const cell = String(row[0] ?? '').replace(/[\r\n]+/g, '').trim();
    if (cell === '') continue;
    const idx = cell.indexOf(':');
    if (idx !== -1) {
      const label = cell.slice(0, idx).replace(/[[\]]/g, '').trim();
      const nilai = cell.slice(idx + 1).trim();
      if (KANDIDAT_LABEL_PERIODE_TIKTOK.some((k) => normLabel(k) === normLabel(label)) && nilai !== '') {
        const rentang = parseRentangTanggalTiktok(nilai);
        if (rentang) return rentang;
      }
    }
    // Bentuk TANPA label (`product_list.xlsx`) — seluruh sel adalah rentangnya sendiri.
    const bareRentang = parseRentangTanggalTiktok(cell);
    if (bareRentang) return bareRentang;
  }
  return null;
}

/** Verdict identitas (Rule 2-4): `cocok` (jalur normal) · `usulkan_ikat` (kolom masih kosong, F-4) · `tolak` (menyebut KEDUA nilai, house convention #5). */
export type PdtIdentitasVerdict = { status: 'cocok' } | { status: 'usulkan_ikat'; usulan: string } | { status: 'tolak'; pesan: string };

/**
 * Rule 2 (+ pengikatan `shop_id`, revisi sesi 2 Q-1 opsi A): `ID Toko`
 * preamble vs `client_platforms.shop_id`. `shopIdTersimpan == null` ⇒
 * `usulkan_ikat` (batch PERTAMA, bukan ditolak) — pemanggil yang menulis
 * `pdt_upload_batch.status = 'identitas_belum_terikat'` dan, sesudah AM
 * konfirmasi, `client_platforms.shop_id`.
 */
export function validasiIdentitasShopee(preamble: PdtPreambleShopee, shopIdTersimpan: string | null): PdtIdentitasVerdict {
  if (preamble.idToko == null) {
    return { status: 'tolak', pesan: '[ID Toko tidak ditemukan di preamble berkas Shopee, periksa kelengkapan export]' };
  }
  if (shopIdTersimpan == null) return { status: 'usulkan_ikat', usulan: preamble.idToko };
  if (shopIdTersimpan === preamble.idToko) return { status: 'cocok' };
  return {
    status: 'tolak',
    pesan: `[ID Toko di berkas (${preamble.idToko}) tidak sama dengan shop_id tersimpan (${shopIdTersimpan})]`,
  };
}

/**
 * Rule 3-4: `ID Kreator` terbanyak di berkas vs `client_platforms.akun_konten_toko`.
 * `akunKontenToko` kosong/`null` ⇒ `usulkan_ikat` (batch TikTok PERTAMA).
 */
export function validasiIdentitasTiktok(
  idKreatorTerbanyak: string | null,
  akunKontenToko: readonly string[] | null,
): PdtIdentitasVerdict {
  if (idKreatorTerbanyak == null) {
    return { status: 'tolak', pesan: '[ID Kreator tidak ditemukan di berkas TikTok, periksa kelengkapan export]' };
  }
  if (akunKontenToko == null || akunKontenToko.length === 0) return { status: 'usulkan_ikat', usulan: idKreatorTerbanyak };
  if (akunKontenToko.includes(idKreatorTerbanyak)) return { status: 'cocok' };
  return {
    status: 'tolak',
    pesan: `[ID Kreator di berkas (${idKreatorTerbanyak}) tidak terdaftar di akun_konten_toko klien (${akunKontenToko.join(', ')})]`,
  };
}

/** Satu berkas dalam batch, untuk resolusi periode batch (Rule 5). `periode: null` = berkas ini tidak membawa tanggal terbaca. */
export interface PdtPeriodeBerkas {
  nama: string;
  periode: PdtRentangTanggal | null;
}

export type PdtPeriodeBatchHasil = ({ status: 'ok' } & PdtRentangTanggal) | { status: 'tolak'; pesan: string };

/**
 * Rule 5 (+ toleransi bulan-sama, revisi sesi 2): batch ditolak HANYA bila
 * berkas-berkas ber-periode berasal dari bulan kalender berbeda. Berkas yang
 * TIDAK membawa periode (Shopee tanpa preamble tanggal, atau TikTok yang
 * kandidat kolomnya tidak cocok) dilewati — bukan sumber penolakan, ini yang
 * memberi efek "mewarisi" periode batch (Rule 5 ayat 2) tanpa menuliskan
 * ulang nilai per-berkas. `periodeMulai`/`periodeSelesai` = rentang TERLUAS
 * di antara berkas ber-periode.
 *
 * ⛔ Pembanding bulan HANYA memakai `mulai` tiap berkas (lihat docblock
 * berkas) — rentang per modul yang sebenarnya belum dapat diverifikasi ke
 * sample asli (§9 P-04/A-3).
 */
export function resolvePeriodeBatch(berkas: readonly PdtPeriodeBerkas[]): PdtPeriodeBatchHasil {
  const berTanggal = berkas.filter((b): b is PdtPeriodeBerkas & { periode: PdtRentangTanggal } => b.periode != null);
  if (berTanggal.length === 0) {
    return { status: 'tolak', pesan: '[tidak ada berkas dalam batch yang membawa periode terbaca]' };
  }

  const bulanPerBerkas = new Map<string, string>();
  for (const b of berTanggal) bulanPerBerkas.set(b.nama, b.periode.mulai.slice(0, 7));
  const bulanUnik = new Set(bulanPerBerkas.values());
  if (bulanUnik.size > 1) {
    const daftar = [...bulanPerBerkas.entries()].map(([nama, bulan]) => `${nama}: ${bulan}`).join('; ');
    return { status: 'tolak', pesan: `[berkas dalam batch berasal dari bulan kalender berbeda — ${daftar}]` };
  }

  let mulai = berTanggal[0].periode.mulai;
  let selesai = berTanggal[0].periode.selesai;
  for (const b of berTanggal.slice(1)) {
    if (b.periode.mulai < mulai) mulai = b.periode.mulai;
    if (b.periode.selesai > selesai) selesai = b.periode.selesai;
  }
  return { status: 'ok', mulai, selesai };
}

/** Bentuk `pdt_upload_batch.identitas_sumber` (Rule 2, migrasi G1-01: `{shop_id, username, nama_toko}`). */
export function bangunIdentitasSumberShopee(preamble: PdtPreambleShopee): { shop_id: string | null; username: string | null; nama_toko: string | null } {
  return { shop_id: preamble.idToko, username: preamble.username, nama_toko: preamble.namaToko };
}
