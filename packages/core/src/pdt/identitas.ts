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
 * Rule 5) BELUM terverifikasi sama sekali** — nol kemunculan literalnya di
 * `PDT_KOLOM_DIPANEN.md`/PRD §7/kode manapun di repo. `KANDIDAT_KOLOM_PERIODE_TIKTOK`
 * di bawah adalah SENTINEL kandidat (pola sama `UNVERIFIED_SIGNATURE`,
 * `modules.ts`) — berkas TikTok yang tidak membawa satu pun kandidatnya
 * sederhana saja dianggap "tidak membawa tanggal terbaca" dan mewarisi
 * periode dari berkas lain di batch yang sama (Rule 5 ayat 2), BUKAN gagal.
 * Dicatat sebagai pertanyaan terbuka `docs/DECISIONS.md` G1-06-PERIODE-TIKTOK
 * — tidak memblokir G1 (preseden P-04/P-07/dst: dicatat, bukan menghalangi).
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

const isBlank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

/**
 * Baca preamble Shopee (`ID Toko`/`Username`/`Nama Toko`/`Periode`, Rule 2/5,
 * baris 1-6 sebelum header) dari SELURUH baris sebelum `barisHeader` (1-terindeks,
 * `PdtModuleDef.barisHeaderHint`). Menerima dua bentuk baris (lihat docblock
 * berkas): satu-sel `"Label: value"` maupun dua-sel `["Label", "value"]`.
 *
 * **Bentuk satu-sel dideteksi dari sel KEDUA kosong (`isBlank(row[1])`), BUKAN
 * `row.length === 1`.** Ditemukan menulis route commit G1-09 sungguhan
 * (bukan ditebak, `docs/DECISIONS.md`): pipa NYATA (`XLSX.utils.sheet_to_json`
 * dengan `defval:''`, G1-05) memadatkan SETIAP baris ke lebar sheet PENUH
 * (lebar baris header, biasanya >1 kolom) — baris preamble satu-sel yang di
 * unit test G1-02/G1-05 memang literal panjang 1 (`['ID Toko: 938284780']`)
 * pada berkas XLSX SUNGGUHAN selalu berakhir panjang N dengan sel ke-2..N
 * berisi string kosong, bukan sungguh-sungguh berhenti di sel pertama. Cek
 * `row.length === 1` yang lama SELALU salah untuk berkas nyata — jatuh ke
 * cabang dua-sel dan membaca teks "Label: value" utuh sebagai label, gagal
 * cocok `LABEL_KUNCI` mana pun, dan preamble (identitas + periode) diam-diam
 * hilang untuk SETIAP upload Shopee sungguhan.
 */
export function ekstrakPreambleShopee(aoa: readonly (readonly unknown[])[], barisHeader: number): PdtPreambleShopee {
  const hasil: PdtPreambleShopee = { idToko: null, username: null, namaToko: null, periode: null };
  const batasBaris = Math.max(0, barisHeader - 1);
  for (const row of aoa.slice(0, batasBaris)) {
    if (!row || row.length === 0) continue;
    let label: string;
    let nilai: string;
    if (isBlank(row[1])) {
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
 * Kandidat nama kolom periode TikTok — **BELUM terverifikasi ke sample asli**
 * (lihat docblock berkas + `docs/DECISIONS.md` G1-06-PERIODE-TIKTOK). Dipakai
 * best-effort oleh `ekstrakPeriodeKolomTiktok`; berkas yang tidak membawa
 * satu pun dari ini mewarisi periode dari berkas lain di batch (Rule 5).
 */
export const KANDIDAT_KOLOM_PERIODE_TIKTOK: readonly string[] = ['Date Range', 'Rentang Tanggal', 'Tanggal analisis'];

/** Best-effort: baca rentang tanggal dari salah satu kandidat kolom periode TikTok pada baris data pertama. */
export function ekstrakPeriodeKolomTiktok(aoa: readonly (readonly unknown[])[], barisHeader: number): PdtRentangTanggal | null {
  const header = aoa[barisHeader - 1] ?? [];
  const barisData = aoa[barisHeader];
  if (!barisData) return null;
  for (const kandidat of KANDIDAT_KOLOM_PERIODE_TIKTOK) {
    const idx = header.findIndex((c) => normLabel(c) === normLabel(kandidat));
    if (idx === -1) continue;
    const nilai = String(barisData[idx] ?? '').trim();
    const rentang = parseRentangTanggal(nilai);
    if (rentang) return rentang;
    // Nilai tanggal TUNGGAL (bukan rentang) — perlakukan sebagai satu hari.
    const satuHari = parseTanggalId(nilai);
    if (satuHari) return { mulai: satuHari, selesai: satuHari };
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
