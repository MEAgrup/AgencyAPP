/**
 * PDT (Pusat Data Toko) — perekat G1-04/G1-05 → G1-09 (`packages/domain/src/pdt.ts`
 * `previewUploadBatch`). `@cdps/domain` tidak boleh bergantung pada Node fs/yauzl
 * (arah dependensi apps/api → domain, bukan sebaliknya), jadi modul ini yang
 * menerjemahkan hasil `bacaDanEkstrakPdtZip` (G1-04) + `parsePdtZipEntries`
 * (G1-05) — keduanya milik apps/api — jadi `pdt.PdtPreviewBerkasInput[]`
 * (domain, murni data) sebelum route memanggil domain.
 *
 * Entri ber-`keputusan.kode === 'dilewati'` (junk macOS, Rule 41) TIDAK
 * disertakan sama sekali — "dilewati TANPA peringatan" berarti AM tidak
 * pernah melihatnya di tabel hasil deteksi.
 */
import { pdt } from '@cdps/core';
import type { pdt as pdtDomain } from '@cdps/domain';
import type { PdtParseBatchHasil } from './pdt-parse';
import type { PdtZipBacaHasil } from './pdt-zip';

const { formatAlasanTolakEntri } = pdt;

export function bangunPreviewBerkasInputs(
  zipHasil: PdtZipBacaHasil,
  parseHasil: PdtParseBatchHasil,
): pdtDomain.PdtPreviewBerkasInput[] {
  const berkasByNama = new Map(parseHasil.berkas.map((b) => [b.nama, b]));
  const gagalByNama = new Map(parseHasil.gagal.map((g) => [g.nama, g]));
  const diekstrakByNama = new Map(zipHasil.diekstrak.map((d) => [d.meta.nama, d]));
  const gagalEkstrakByNama = new Map(zipHasil.gagalEkstrak.map((g) => [g.meta.nama, g]));

  const hasil: pdtDomain.PdtPreviewBerkasInput[] = [];

  for (const { meta, keputusan } of zipHasil.pagar.entri) {
    if (keputusan.kode === 'dilewati') continue; // Rule 41 — junk macOS, tanpa peringatan
    if (keputusan.kode === 'ditolak') {
      hasil.push({
        nama: meta.nama, sha256: null, bytes: null,
        ditolakPagar: { pesan: formatAlasanTolakEntri(meta.nama, keputusan.alasan) },
        decodeGagal: null, aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
      });
      continue;
    }

    // keputusan.kode === 'diproses' — bisa gagal EKSTRAK (G1-04) atau gagal DECODE (G1-05),
    // atau berhasil sepenuhnya (di `parseHasil.berkas`). Ketiganya saling lepas.
    const gagalEkstrak = gagalEkstrakByNama.get(meta.nama);
    if (gagalEkstrak) {
      hasil.push({
        nama: meta.nama, sha256: null, bytes: null, ditolakPagar: null,
        decodeGagal: gagalEkstrak.pesan, aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
      });
      continue;
    }

    const diekstrak = diekstrakByNama.get(meta.nama);
    const gagalDecode = gagalByNama.get(meta.nama);
    if (gagalDecode) {
      hasil.push({
        nama: meta.nama, sha256: diekstrak?.sha256 ?? null, bytes: diekstrak?.bytes ?? null,
        ditolakPagar: null, decodeGagal: gagalDecode.pesan, aoa: null, modulTerdeteksi: null, ambiguous: false, matches: [],
      });
      continue;
    }

    const berkas = berkasByNama.get(meta.nama);
    if (!berkas || !diekstrak) {
      // Struktural TIDAK seharusnya terjadi — entri 'diproses' selalu berakhir di TEPAT
      // satu dari tiga map di atas (bacaDanEkstrakPdtZip/parsePdtZipEntries menjamin ini).
      // Dijaga di sini supaya kegagalan itu terlihat sebagai baris, bukan entri yang lenyap diam-diam.
      hasil.push({
        nama: meta.nama, sha256: null, bytes: null, ditolakPagar: null,
        decodeGagal: 'berkas hilang dari hasil ekstraksi/parse (bug internal)', aoa: null,
        modulTerdeteksi: null, ambiguous: false, matches: [],
      });
      continue;
    }

    hasil.push({
      nama: meta.nama, sha256: diekstrak.sha256, bytes: diekstrak.bytes, ditolakPagar: null,
      decodeGagal: null, aoa: berkas.aoa as unknown[][], modulTerdeteksi: berkas.modul,
      ambiguous: berkas.ambiguous, matches: berkas.matches,
    });
  }

  return hasil;
}
