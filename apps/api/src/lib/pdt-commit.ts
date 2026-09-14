/**
 * PDT (Pusat Data Toko) — perekat commit (G1-09 sub-langkah 2a), pasangan
 * `pdt-preview.ts`. Menghitung `pdt.PdtCommitRawMeta` (Rule 38-43) dari hasil
 * `bacaDanEkstrakPdtZip` (G1-04) + byte paket mentah — satu-satunya tempat
 * yang tahu bentuk `PdtZipBacaHasil.pagar.entri`, supaya route commit tidak
 * perlu mengulang penghitungan ini sendiri.
 */
import type { pdt as pdtDomain } from '@cdps/domain';
import type { PdtZipBacaHasil } from './pdt-zip';

/**
 * `entri` = entri 'diproses' + 'ditolak' pagar (Rule 41) — seluruh entri
 * NYATA dalam paket, di luar junk macOS (`entriDilewati`, dilewati tanpa
 * peringatan, kolomnya sendiri di `pdt_upload_batch.raw_entri_dilewati`).
 */
export function hitungPdtCommitRawMeta(zipHasil: PdtZipBacaHasil, isi: Buffer): pdtDomain.PdtCommitRawMeta {
  let entri = 0;
  let entriDilewati = 0;
  for (const { keputusan } of zipHasil.pagar.entri) {
    if (keputusan.kode === 'dilewati') entriDilewati += 1;
    else entri += 1; // 'diproses' | 'ditolak'
  }
  return { sha256: zipHasil.sha256Paket, bytes: isi.length, entri, entriDilewati };
}
