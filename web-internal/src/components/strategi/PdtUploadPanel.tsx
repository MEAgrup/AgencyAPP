'use client';

/**
 * Panel "Isi dari PDT" — jembatan Section B Strategi → `/account/pdt/upload`.
 *
 * ## Kenapa panel ini ada
 *
 * Section B punya DUA sumber angka, dan sampai sekarang hanya satu yang
 * kelihatan dari halaman ini:
 *
 *  - **Riset Awal / Video Factory** — AM menempel hasil analisa export.
 *    Terlihat: `BaselinePrefillPanel` dan `VideoFactoryImportPanel`.
 *  - **PDT (Pusat Data Toko)** — batch export yang sudah `verified` mengisi
 *    field B3 (refund rate, pengunjung/bulan, conversion rate, poin penalti)
 *    dari `pdt_fact_*`, dengan selektor "Periode acuan PDT (B-0.7a)".
 *
 * Yang kedua tidak punya pintu masuk sama sekali. Selektor periodenya cuma
 * muncul kalau `periode_referensi_pdt_opsi` TIDAK kosong — artinya tepat saat
 * toko belum punya satu pun batch terverifikasi (persis keadaan yang butuh
 * diperbaiki), AM tidak melihat apa pun yang menyebut PDT. Ia lalu mengisi
 * B3 dengan tangan, seperti "cara lama". Dilaporkan pemilik saat uji produksi
 * 2026-09-19.
 *
 * ## Apa yang panel ini BUKAN
 *
 * Bukan importer. Ia tidak menulis apa pun, tidak menempel payload, dan tidak
 * mengubah draft — beda dari `VideoFactoryImportPanel` di Section A. PDT
 * mengalir ke Section B lewat server (`getBaselinePrefill` membaca
 * `pdt_fact_*` lewat `pdt-prefill`), bukan lewat tempel-menempel. Satu-satunya
 * hal yang kurang adalah tautannya, dan itulah yang ada di sini.
 *
 * Karena alirannya lewat server, panel ini berkata jujur soal urutannya:
 * unggah → batch `verified` → **muat ulang halaman Strategi**. Tidak ada
 * pembaruan langsung; menjanjikannya akan membuat AM menunggu sesuatu yang
 * tidak akan datang.
 *
 * ## Satu syarat yang harus DISEBUT, bukan disembunyikan
 *
 * `getBaselinePrefill` mengembalikan `null` selama klien belum punya interview
 * ber-skor dengan baris `riset_awal_analisa` — dan field B3 dari PDT menumpang
 * di usulan per-kanal yang sama (strangler coexistence, `docs/DECISIONS.md`
 * 2026-09-17 "G3-REFERENCE-PERIODE DIKETOK"). Batch PDT yang `verified` SAJA
 * karena itu belum cukup. Panel menyebutkan itu ketika `prefill` `null`,
 * karena AM yang tidak diberi tahu akan mengunggah batch, memuat ulang, tidak
 * melihat perubahan apa pun, dan menyimpulkan PDT-nya rusak.
 */

import Link from 'next/link';
import { pdtUploadHref } from '@/lib/pdt-deeplink';
import type { StrategiBaselinePrefill } from '@/lib/strategi';

export default function PdtUploadPanel({
  clientId,
  prefill,
}: {
  clientId: string;
  /** `null` saat klien belum punya riset awal ber-analisa — panel tetap tampil
   *  (justru itu keadaan yang paling butuh tautan ini), hanya tanpa tautan
   *  per-toko karena `client_platform_id`-nya memang belum diketahui halaman. */
  prefill: StrategiBaselinePrefill | null;
}) {
  const channels = prefill?.channels ?? [];

  return (
    <section
      className="card"
      style={{
        marginBottom: 16,
        padding: 12,
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        background: 'var(--color-surface-muted, transparent)',
      }}
    >
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>Isi dari PDT (Pusat Data Toko)</strong>
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>
          refund rate · pengunjung/bulan · conversion rate · poin penalti
        </span>
        <span style={{ flex: 1 }} />
        {channels.length === 0 && (
          <Link href={pdtUploadHref(clientId)} className="btn btnGhost btnSm">
            Buka Upload PDT
          </Link>
        )}
      </div>

      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Unggah satu paket ZIP export toko per bulan di halaman <b>Upload Data Toko (PDT)</b>. Begitu
        batch-nya berstatus <b>Terverifikasi</b>, <b>muat ulang halaman Strategi ini</b> — field B3 di
        atas terisi dari data toko, dan selektor <b>“Periode acuan PDT (B-0.7a)”</b> muncul di kartu
        kanal untuk memilih bulan acuannya. Tidak perlu menempel apa pun: alirannya lewat server,
        bukan copy-paste.
      </p>

      {channels.length === 0 && (
        <div className="alert alertInfo" style={{ fontSize: 12, marginTop: 8 }}>
          Klien ini belum punya <b>Riset Awal</b> ber-analisa. Field B3 dari PDT menumpang di usulan
          baseline per kanal yang sama, jadi batch PDT terverifikasi saja belum cukup — selesaikan
          Riset Awal di modul Interview lebih dulu, lalu unggah batch PDT-nya.
        </div>
      )}

      {channels.length > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {channels.map((c) => (
            <Link
              key={c.client_platform_id}
              href={pdtUploadHref(clientId, c.client_platform_id)}
              className="btn btnGhost btnSm"
            >
              Upload PDT — {c.platform}
            </Link>
          ))}
        </div>
      )}

      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        Hanya toko <b>Shopee</b> dan <b>TikTok Shop</b> yang aktif — Tokopedia/Lazada/Blibli tetap
        manual (PDT-22). Angka yang sudah Anda ketik sendiri tidak ditimpa.
      </p>
    </section>
  );
}
