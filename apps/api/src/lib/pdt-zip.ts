/**
 * PDT (Pusat Data Toko) — pembaca paket ZIP sungguhan (G1-04, PRD §3.8/§6.7).
 *
 * Ini SATU-SATUNYA tempat yang benar-benar membuka bytes ZIP. Keputusan
 * (ditolak/dilewati/diproses per Rule 41, gerbang Rule 42) dihitung oleh
 * `evaluatePdtZipPagar` (`@cdps/core`, murni, nol I/O, diuji langsung dengan
 * metadata) — modul ini HANYA: (1) membaca metadata direktori pusat ZIP
 * (nama/ukuran/status enkripsi tiap entri, TANPA mendekompres satu entri pun)
 * lewat `yauzl`, (2) memanggil pagar, (3) untuk entri yang lolos ('diproses'),
 * mengekstrak STREAMING ke direktori sementara sambil menghitung sha256 —
 * tidak pernah menahan seluruh isi entri di memori (§6.7).
 *
 * Pertahanan berlapis terhadap metadata yang bohong: `validateEntrySizes: true`
 * (default yauzl) membuat ekstraksi GAGAL bila jumlah byte hasil dekompresi
 * sungguhan tidak sama persis dengan `uncompressedSize` yang diklaim direktori
 * pusat — pagar Rule 42 mempercayai angka itu, dan yauzl menjamin angka itu
 * jujur saat entri benar-benar dibaca. Kegagalan begitu ditangkap per entri
 * (tidak menjatuhkan seluruh batch) dan dilaporkan lewat `gagalEkstrak` —
 * konsisten Rule 10 (kegagalan parse tidak ditelan).
 *
 * Nama berkas TUJUAN di disk sementara SENGAJA bukan `entry.fileName` —
 * `nama` entri di dalam ZIP tidak dipercaya sebagai path filesystem (itulah
 * kenapa Rule 41 punya pagar zip-slip di tempat pertama); tujuan tulis dipakai
 * indeks urut yang independen dari isi ZIP.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import * as yauzl from 'yauzl';
import { pdt } from '@cdps/core';

const { evaluatePdtZipPagar } = pdt;
type PdtZipEntryMeta = pdt.PdtZipEntryMeta;
type PdtZipPagarHasil = pdt.PdtZipPagarHasil;

export interface PdtZipEntriTerekstrak {
  meta: PdtZipEntryMeta;
  /** Path di disk sementara — pemanggil (G1-05+) yang membaca isinya dan bertanggung jawab membersihkannya (`bersihkanDirektoriSementaraPdt`). */
  pathSementara: string;
  sha256: string;
  /** Byte SUNGGUHAN yang ditulis — sumber kebenaran, bukan `meta.ukuranAsli` (yang cuma klaim direktori pusat). */
  bytes: number;
}

export interface PdtZipGagalEkstrak {
  meta: PdtZipEntryMeta;
  pesan: string;
}

export interface PdtZipBacaHasil {
  pagar: PdtZipPagarHasil;
  sha256Paket: string;
  /** Hanya entri berkeputusan 'diproses' DAN berhasil diekstrak. */
  diekstrak: readonly PdtZipEntriTerekstrak[];
  /** Entri 'diproses' yang gagal saat ekstraksi sungguhan (mis. metadata bohong, ditangkap `validateEntrySizes`) — TIDAK menjatuhkan entri lain. */
  gagalEkstrak: readonly PdtZipGagalEkstrak[];
  /** `null` bila pagar menolak paket, atau nol entri yang perlu diekstrak. Pemanggil wajib `bersihkanDirektoriSementaraPdt` setelah selesai memakainya. */
  direktoriSementara: string | null;
}

/** Transform pass-through yang menghitung sha256 + jumlah byte SAAT stream lewat — tidak menyimpan salinan di memori (beda dari `hash.update(seluruhBuffer)`). */
function hashingPassthrough(hash: ReturnType<typeof createHash>, counter: { bytes: number }): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, callback) {
      hash.update(chunk);
      counter.bytes += chunk.length;
      callback(null, chunk);
    },
  });
}

export async function bacaDanEkstrakPdtZip(paketBuffer: Buffer): Promise<PdtZipBacaHasil> {
  const sha256Paket = createHash('sha256').update(paketBuffer).digest('hex');

  // autoClose:false — kita menutup manual di finally, supaya openReadStreamPromise
  // masih valid dipanggil SETELAH eachEntry() selesai berjalan (bukan dua kali open).
  //
  // decodeStrings:false SENGAJA — yauzl, saat decodeStrings:true (default),
  // memanggil validateFileName() bawaannya sendiri dan MELEMPAR ERROR untuk
  // SELURUH pembacaan begitu satu entri bernama zip-slip (`../`, path absolut)
  // ditemukan (diverifikasi: `for await (zip.eachEntry())` reject total, bukan
  // per-entri). Itu menjadikan zip-slip kegagalan PAKET, padahal Rule 41
  // memperlakukannya sebagai kegagalan ENTRI (paket lain tetap diproses).
  // Nama di sini didekode manual pakai primitif decode yauzl sendiri
  // (`getFileNameLowLevel`) TANPA validasinya, supaya keputusan zip-slip
  // sepenuhnya di tangan `evaluatePdtZipPagar` (satu-satunya sumber kebenaran
  // Rule 41), bukan terpecah antara yauzl dan pagar.
  const zip = await yauzl.fromBufferPromise(paketBuffer, {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true,
    decodeStrings: false,
  });

  try {
    // Lewatan 1: kumpulkan metadata SAJA (direktori pusat — nol dekompresi) untuk seluruh entri.
    const dikumpulkan: { entry: yauzl.Entry; nama: string; meta: PdtZipEntryMeta }[] = [];
    for await (const entry of zip.eachEntry()) {
      const nama = yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, false);
      if (nama.endsWith('/')) continue; // direktori eksplisit — Rule 40, struktur folder diabaikan
      dikumpulkan.push({
        entry,
        nama,
        meta: {
          nama,
          ukuranTerkompresi: entry.compressedSize,
          ukuranAsli: entry.uncompressedSize,
          terenkripsi: entry.isEncrypted(),
        },
      });
    }

    const pagar = evaluatePdtZipPagar({
      ukuranPaketBytes: paketBuffer.length,
      entries: dikumpulkan.map((d) => d.meta),
    });
    if (!pagar.ok) {
      return { pagar, sha256Paket, diekstrak: [], gagalEkstrak: [], direktoriSementara: null };
    }

    const diprosesNama = new Set(
      pagar.entri.filter((e) => e.keputusan.kode === 'diproses').map((e) => e.meta.nama),
    );
    if (diprosesNama.size === 0) {
      return { pagar, sha256Paket, diekstrak: [], gagalEkstrak: [], direktoriSementara: null };
    }

    // Lewatan 2: HANYA entri 'diproses' benar-benar dibuka & diekstrak streaming.
    const direktoriSementara = await mkdtemp(path.join(tmpdir(), 'pdt-raw-'));
    const diekstrak: PdtZipEntriTerekstrak[] = [];
    const gagalEkstrak: PdtZipGagalEkstrak[] = [];
    let i = 0;
    for (const { entry, meta } of dikumpulkan) {
      if (!diprosesNama.has(meta.nama)) continue;
      const tujuan = path.join(direktoriSementara, String(i++));
      try {
        const stream = await zip.openReadStreamPromise(entry);
        const hash = createHash('sha256');
        const counter = { bytes: 0 };
        await pipeline(stream, hashingPassthrough(hash, counter), createWriteStream(tujuan));
        diekstrak.push({ meta, pathSementara: tujuan, sha256: hash.digest('hex'), bytes: counter.bytes });
      } catch (err) {
        gagalEkstrak.push({ meta, pesan: err instanceof Error ? err.message : String(err) });
      }
    }

    return { pagar, sha256Paket, diekstrak, gagalEkstrak, direktoriSementara };
  } finally {
    zip.close();
  }
}

/** Hapus direktori sementara G1-04 buat (rekursif, tidak error bila sudah tidak ada). */
export async function bersihkanDirektoriSementaraPdt(direktoriSementara: string): Promise<void> {
  await rm(direktoriSementara, { recursive: true, force: true });
}
