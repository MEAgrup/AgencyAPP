/**
 * PDT (Pusat Data Toko) — baris header DICARI, bukan diasumsikan (Rule 7,
 * G1-09, `docs/backlog/PDT_BACKLOG.md` G1-09 bullet 2 "tabel hasil deteksi:
 * ... baris header, kolom dipanen, kolom baru").
 *
 * Fungsi murni saja — nol I/O, nol DB. `PdtModuleDef.barisHeaderHint` (G1-02)
 * sampai G1-08 hanya dipakai LANGSUNG sebagai kalau ia sudah pasti benar
 * (`ekstrakPreambleShopee`/`kolomTerbanyak`/dst. semua menerima `barisHeader`
 * sebagai parameter siap pakai) — tidak ada satu pun fungsi yang benar-benar
 * MENCARI baris itu di `aoa`. G1-09 adalah pemanggil PERTAMA yang punya `aoa`
 * MENTAH (dari `parsePdtZipEntries`, G1-05) tanpa tahu dulu baris headernya
 * benar — jadi pencarian itu harus ada sebelum modul lain di sini bisa
 * dipanggil dengan aman.
 *
 * Algoritma: `barisHeaderHint` tetap titik awal (Rule 7 tidak melarang
 * memberi PETUNJUK, hanya melarang MENGASUMSIKANNYA tanpa verifikasi) — baris
 * yang benar adalah baris dengan JUMLAH KECOCOKAN TERBANYAK terhadap nama
 * kolom yang modul itu diketahui punya (`kolomDipanen` ∪ alias), dan bila
 * dua baris seri, yang PALING DEKAT ke hint menang. Ini bertahan pada dua pola
 * yang PRD §3.2 Rule 7 sebut eksplisit: CSV iklan Shopee (header meleset satu
 * baris dari hint), dan baris penanda seksi SEBELUM header sungguhan
 * (`shopee_shop_stats`, `bisnis_home`) — penanda seksi tidak mengandung nama
 * kolom kanonik apa pun, jadi skornya nol dan kalah dari baris header
 * sungguhan tak peduli seberapa jauh hint meleset.
 */

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/**
 * Hitung berapa banyak `namaKolomDikenal` yang muncul (exact, case-insensitive)
 * sebagai SEL di baris `row`.
 */
function skorBaris(row: readonly unknown[] | undefined, namaKolomDikenal: ReadonlySet<string>): number {
  if (!row) return 0;
  let skor = 0;
  for (const cell of row) {
    if (namaKolomDikenal.has(norm(cell))) skor++;
  }
  return skor;
}

/**
 * Cari baris header sungguhan di `aoa` (1-terindeks, konsisten dengan
 * `PdtModuleDef.barisHeaderHint`). `hint` tetap titik awal; seluruh `aoa`
 * dipindai (Rule 7: dicari, bukan indeks tetap) — biayanya murah (satu batch
 * ≤ 40 entri, tiap sheet biasanya < 10.000 baris). Baris ber-skor TERTINGGI
 * menang; skor 0 di SELURUH baris (tak satu pun nama kolom dikenal muncul) ⇒
 * kembali ke `hint` apa adanya (best effort — modul tak dikenal atau berkas
 * kosong tidak boleh melempar di sini, pemanggil G1-08 yang menilai
 * kegagalannya lewat `validasiKolomWajib`).
 */
export function temukanBarisHeader(
  aoa: readonly (readonly unknown[])[],
  namaKolomDikenal: readonly string[],
  hint: number,
): number {
  if (namaKolomDikenal.length === 0 || aoa.length === 0) return hint;
  const dikenal = new Set(namaKolomDikenal.map(norm));

  let baikBaris = hint;
  let baikSkor = -1;
  let baikJarak = Number.POSITIVE_INFINITY;
  for (let i = 0; i < aoa.length; i++) {
    const barisKe1 = i + 1;
    const skor = skorBaris(aoa[i], dikenal);
    const jarak = Math.abs(barisKe1 - hint);
    if (skor > baikSkor || (skor === baikSkor && jarak < baikJarak)) {
      baikBaris = barisKe1;
      baikSkor = skor;
      baikJarak = jarak;
    }
  }
  return baikSkor > 0 ? baikBaris : hint;
}

export interface PdtKolomDipanenBaruHasil {
  /** Jumlah kolom whitelist (`kolomDipanen`) yang ditemukan di header ini (exact atau alias). */
  jumlahDipanen: number;
  /** Nama SAJA (Rule 8) — sel header yang bukan salah satu `kolomDipanen`/alias modul ini, urutan kemunculan, dedup, sel kosong dibuang. */
  kolomBaru: readonly string[];
}

/**
 * Rule 8: kolom whitelist yang benar-benar ditemukan di header + nama kolom
 * BARU (di luar whitelist ∪ alias — sinyal drift, biaya ~nol karena hanya
 * NAMA yang dicatat, bukan nilai).
 */
export function hitungKolomDipanenBaru(
  header: readonly unknown[],
  kolomDipanen: readonly string[],
  aliasPerKolom: Readonly<Record<string, readonly string[]>> = {},
): PdtKolomDipanenBaruHasil {
  const dikenal = new Set<string>(kolomDipanen.map(norm));
  for (const aliasList of Object.values(aliasPerKolom)) {
    for (const a of aliasList) dikenal.add(norm(a));
  }

  let jumlahDipanen = 0;
  for (const kolom of kolomDipanen) {
    const idxExact = header.findIndex((c) => norm(c) === norm(kolom));
    if (idxExact !== -1) {
      jumlahDipanen++;
      continue;
    }
    const aliasCocok = (aliasPerKolom[kolom] ?? []).some((a) => header.some((c) => norm(c) === norm(a)));
    if (aliasCocok) jumlahDipanen++;
  }

  const kolomBaru: string[] = [];
  const terlihat = new Set<string>();
  for (const cell of header) {
    const nilai = String(cell ?? '').trim();
    if (nilai === '') continue;
    const n = norm(nilai);
    if (dikenal.has(n) || terlihat.has(n)) continue;
    terlihat.add(n);
    kolomBaru.push(nilai);
  }

  return { jumlahDipanen, kolomBaru };
}
