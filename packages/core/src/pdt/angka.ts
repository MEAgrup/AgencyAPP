/**
 * PDT (Pusat Data Toko) — normalisasi angka terpusat (G1-03, PRD §6.7).
 *
 * PRD §6.7: *"Encoding: CSV Shopee = utf-8-sig dengan pemisah koma dan angka
 * format Indonesia (1.234,56) — parser wajib punya normalisasi angka lokal
 * terpusat, bukan per modul."* `docs/backlog/PDT_BACKLOG.md` G1-03 menambahkan
 * dua hal spesifik: (1) Ads Manager memakai titik sebagai DESIMAL (koma =
 * ribuan) sementara Seller Center memakai titik sebagai RIBUAN (koma =
 * desimal) — dua konvensi, satu fungsi; (2) **NaN, bukan 0**, untuk nilai yang
 * gagal diparse.
 *
 * Repo ini sudah punya DUA semantik kegagalan-parse yang berbeda
 * (`docs/DECISIONS.md` 2026-09-12 P-04):
 *   - `baseline/angka.ts` `n(v, raw)` → **0** saat gagal (dipakai `report/*`,
 *     `adsscanner/tiktok/angka.ts` lewat delegasi — TIDAK disentuh di sini,
 *     ia dipakai jalur non-PDT yang sudah berjalan dan mengubahnya menggeser
 *     SETIAP angka iklan yang sudah ada).
 *   - `skuscreener/parse.ts` `parseIndonesianNumber(v)` → **NaN** saat gagal
 *     (dipakai SKU screener, absent-value contract beda — lihat docblock-nya).
 *
 * **Keputusan G1-03: fungsi PDT membedakan TIGA keadaan, bukan dua** (backlog
 * §G1-03): sel kosong (`null`/`undefined`/string kosong setelah trim) ⇒ `0`
 * (sah, sel memang ada tapi tidak diisi — semangat sama seperti docblock
 * `n()`: "a present-but-empty cell is 0"). Nilai yang ADA tapi tidak bisa
 * diparse jadi angka (`"-"`, `"N/A"`, `"tidak terbatas"`, teks acak, dll.) ⇒
 * `NaN` — inilah kelas bug yang PDT Rule 12 hapus (skor/agregat yang mengarang
 * 0 dari kolom yang sebenarnya gagal terbaca). Kolom yang tidak ada SAMA
 * SEKALI di sheet adalah keadaan ketiga yang fungsi SEL ini tidak bisa tahu
 * sendiri — itu ditangani di lapisan pemanggil sebagai kegagalan parse
 * BERNAMA (Rule 10/G1-08), bukan dikembalikan lewat nilai angka apa pun.
 *
 * `NaN` yang lolos ke tabel fakta harus TERLIHAT di hilir (agregasi/skor
 * tidak boleh diam-diam memperlakukannya sebagai 0) — itu tanggung jawab
 * pemanggil (G1-05+), bukan fungsi ini.
 *
 * Fitur yang diikutkan (bukan cuma pemisah ribuan/desimal) karena keduanya
 * sudah terbukti perlu di data Shopee/TikTok NYATA yang sudah diverifikasi
 * di repo ini, dan fungsi ini dimaksud jadi SATU-SATUNYA titik parse angka
 * untuk seluruh modul PDT ke depan (G1-05):
 *   - Prefiks `Rp` dibuang (Seller Center, lihat `UAT_TIKTOK_AVITASKIN_20260904.md`
 *     §2.2: `"Rp10.945.407"`).
 *   - Akhiran `%` dibagi 100 (fraksi, bukan 0–100) — konsisten dengan
 *     `n()`/`pct()` housewide supaya formatter tampilan yang sama tetap
 *     berlaku pada kolom PDT.
 *   - Negatif berkurung `"(1.234)"` → `-1234` — dibutuhkan untuk refund/GMV
 *     negatif Shopee (`skuscreener/parse.ts` R03, terverifikasi ke export asli).
 */

/** Sentinel: fungsi ini TIDAK PERNAH memanggil `n()`/`parseIndonesianNumber()` — ia satu implementasi baru untuk jalur PDT saja (DoD: nol pemanggil baru `n()` di jalur PDT). */
export function parsePdtAngka(v: unknown, raw?: boolean): number {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;

  let s = String(v).trim();
  if (s === '') return 0;

  const neg = /^\(.*\)$/.test(s);
  if (neg) s = s.slice(1, -1).trim();

  s = s.replace(/rp/gi, '').replace(/\s/g, '');

  const isPercent = s.endsWith('%');
  if (isPercent) s = s.slice(0, -1);

  if (raw) {
    // Ads Manager: titik = desimal, koma = ribuan.
    s = s.replace(/,/g, '');
  } else {
    // Seller Center / angka format Indonesia: titik = ribuan, koma = desimal.
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      s = s.replace(',', '.');
    } else if (hasDot) {
      const parts = s.split('.');
      if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) s = parts.join('');
    }
  }

  const f = parseFloat(s);
  if (!isFinite(f)) return NaN;

  const signed = neg ? -f : f;
  return isPercent ? signed / 100 : signed;
}
