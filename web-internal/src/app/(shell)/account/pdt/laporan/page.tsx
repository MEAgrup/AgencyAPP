'use client';

/**
 * Laporan PDT (Pusat Data Toko) — Flow B langkah 1 (PDT-21 Rule 21).
 *
 * KPI ringkas + harian + kanal + iklan + kampanye + live + sesi LIVE + video
 * + produk + afiliasi + kreator + promo + layanan + tahap + skor + insight
 * per toko klien, dibaca lewat `GET /account/pdt/laporan`.
 *
 * **Grafik (2026-09-21).** Feedback pemilik: laporan PDT "masih kurang
 * detail" dibanding mesin HTML lama, "lengkapi … termasuk grafik dan chart".
 * Lima grafik ditambahkan lewat `@/components/PdtChart` (SVG inline, nol
 * dependensi — alasannya di docblock `@/lib/chart-geom`): garis tren harian,
 * donat kontribusi kanal, batang omzet-vs-biaya per sumber iklan, gelembung
 * matriks produk, dan batang skor per dimensi. Semua menggambar angka yang
 * SUDAH final dari payload — nol agregasi di sisi FE.
 *
 * **Paritas mesin HTML lama (2026-09-21 lanjutan).** Permintaan pemilik
 * "buat semua bagian yg blm ada, supaya hasil akhir sama dengan html lama".
 * Lima bagian ditambahkan — Iklan per Kampanye, Top Sesi LIVE, Top Kreator,
 * Promo (Diskon & Flash Sale, §8 Shopee), dan Layanan & Kesehatan Toko (§9
 * Shopee) — plus tabel "Top Produk by GMV" lintas kuadran yang akhirnya
 * mengisi bagian Portfolio Produk sisi Shopee, dan indikator Outlook yang
 * naik dari dua ke empat per platform.
 *
 * **Yang TETAP tidak ada, dan alasannya bukan "belum sempat":**
 * - **Voucher** (bagian dari §8 mesin lama) — PDT nol modul parser voucher,
 *   jadi klaim/biaya/usage-rate-nya tidak ada di fakta manapun.
 * - **Cancel rate & retur** (§9 mesin lama) — `pdt_fact_shop_daily` tidak
 *   punya kolom pembatalan maupun retur.
 * - **Tokopedia** — nol modul parser, nol baris fakta.
 * Ketiganya ditampilkan sebagai catatan eksplisit di halaman, bukan
 * dihilangkan diam-diam atau diisi 0.
 *
 * **DIKOREKSI (KUADRAN-SHOPEE):** dua baris yang dulu ada di daftar ini sudah
 * tidak benar. **Kuadran produk Shopee** kini ADA (algoritma tiga-band mesin
 * lama, diverifikasi identik ke ekspor asli). **TikTok Ads Manager** TIDAK
 * pernah "nol sumber data": modul `tt_ads_product`/`tt_ads_live`, ekstraktor,
 * dan penulis `pdt_fact_ads`-nya sudah ada sejak `G1-09-2BII-TTADS-SAMPLE`
 * (2026-09-16) dan berkasnya memang ikut di paket unggahan
 * ("creative data for product campaigns", "livestream data for live
 * campaigns"). Angkanya sudah lama memberi makan bagian "iklan", "kampanye"
 * dan CPA "tahap"; yang keliru cuma tiga metrik funnel Consideration yang
 * di-hardcode `null` — kini terisi dari `tayangan`/`klik` Ads Manager.
 *
 * **Kanal** (sumber GMV) TIDAK simetris antar platform (keputusan pemilik
 * via `AskUserQuestion`, 2026-09-16): TikTok lengkap (Live/Video/Kartu
 * Produk & Shop Tab); Shopee SELALU `lengkap: false` (hanya Shopee Ads +
 * Affiliate — voucher/chat/meta_cpas/shopee_video belum ada penulis fakta
 * PDT sama sekali). Halaman menampilkan catatan eksplisit saat `lengkap`
 * `false`, supaya GMV kanal yang belum terproses tidak disalahartikan
 * sebagai GMV kanal yang memang nol.
 *
 * **Live** (Live Streaming, keputusan pemilik via `AskUserQuestion` KETIGA,
 * 2026-09-16) SATU bentuk untuk kedua platform — nol asimetri platform kali
 * ini, cuma `jam`/`gmv_per_jam` SELALU `null` untuk Shopee (kolom sumbernya
 * kosong permanen di penulis `shopee_live`). Seksi ini disembunyikan
 * seluruhnya (bukan ditampilkan nol) saat `live` `null` — nol sesi live
 * sama sekali di periode ini.
 *
 * **Video/Konten** (keputusan pemilik via `AskUserQuestion` KEEMPAT,
 * 2026-09-16): TikTok-only. `shopee_video` masih cuma modul parser
 * terdaftar — nol penulis fakta ke `pdt_fact_content`, jadi `video` SELALU
 * `null` untuk Shopee, PERMANEN (beda dari TikTok `null` yang berarti nol
 * video di periode ini). Halaman membedakan keduanya lewat `laporan.platform`:
 * Shopee menampilkan catatan "belum didukung", TikTok menyembunyikan seksi
 * seluruhnya saat `null`.
 *
 * **Iklan** (keputusan pemilik via `AskUserQuestion` KELIMA, 2026-09-16,
 * setelah `tt_ads_product`/`tt_ads_live` akhirnya punya penulis fakta di PR
 * #413): KEDUA platform dibangun sekaligus — TAPI TETAP tidak simetris,
 * beda root cause dari "kanal": Shopee SELALU `lengkap: false` PERMANEN
 * (`ads_banner` legacy tidak pernah punya modul PDT sama sekali, bukan
 * writer yang belum dibangun), TikTok SELALU `lengkap: true` (dua sumber
 * asli, keduanya sudah lengkap). `roas` per item DAN total DITURUNKAN
 * `Σgmv÷Σbiaya`. Seksi disembunyikan seluruhnya saat `iklan` `null` (nol
 * baris iklan seluruh sumber platform ini di periode ini).
 *
 * **Produk** (Portfolio Produk/kuadran): KEDUA platform sejak KUADRAN-SHOPEE
 * (`docs/DECISIONS.md`) — sebelumnya TikTok-only. Dua algoritma yang memang
 * BERBEDA di mesin lama, bukan satu dengan parameter berbeda: TikTok memakai
 * klik × CVR dua band versus benchmark `quad_klik`/`quad_cvr`, Shopee memakai
 * pengunjung produk × CR-pesanan TIGA band (dengan promosi band `medium`)
 * versus ambang absolut tetap, plus ember ketujuh `no_data` yang TikTok tidak
 * punya. Keduanya diverifikasi IDENTIK dengan mesin HTML atas ekspor asli
 * (Fim Motor Shopee, lima klien TikTok).
 *
 * `distribusi` — mode TERSIMPAN (benchmark/absolut), ambang tetap lintas bulan
 * supaya "SKU pindah kuadran" berarti sesuatu (Rule 19). `relatif` — panel
 * kedua mesin lama, ambang percentile p25/p75 katalog periode ini, dihitung
 * saat laporan dirakit dan TIDAK PERNAH disimpan. `top_aksi` — HANYA tiga
 * kuadran actionable (Bintang/Bocor Traffic/Hidden Gem), diurutkan GMV desc,
 * dipotong 12 (angka sama mesin lama). Seksi disembunyikan seluruhnya saat
 * `produk` `null`.
 *
 * **Afiliasi** (keputusan pemilik via `AskUserQuestion` KEENAM, 2026-09-16):
 * RINGKASAN saja untuk KEDUA platform, SATU bentuk (nol asimetri platform,
 * pola sama "live") — mesin lama membawa daftar per-kreator plus
 * `refund`/`komisi`/`roiKomisi`, `pdt_fact_creator_period` tidak pernah
 * punya kolom itu sama sekali jadi tidak bisa direplikasi. `aov` DITURUNKAN
 * `Σgmv÷Σpesanan`. Sesi Live/Video kreator (`jumlah_live`/`jumlah_video`)
 * SELALU `null` untuk Shopee (`shopee_ams_afiliasi` tidak pernah
 * menulisnya) — halaman menyembunyikan tile itu, bukan menampilkan 0. Seksi
 * disembunyikan seluruhnya saat `afiliasi` `null` (nol baris kreator sama
 * sekali di periode ini).
 *
 * **Tahap** (buyer-journey Awareness→Consideration→Conversion, keputusan
 * pemilik via `AskUserQuestion` KETUJUH, dua ronde, 2026-09-16): TikTok-ONLY
 * — Shopee SELALU `tahap: null` karena mesin lama Shopee tidak pernah punya
 * konsep buyer-journey sama sekali (bukan gap data seperti "video"), jadi
 * seksi ini disembunyikan TOTAL untuk Shopee, bukan ditampilkan kosong.
 * v1 SENGAJA menerima banyak `null` per metrik (Awareness campaign-level, ATC,
 * follower berbayar) — bukan karena TikTok Ads Manager tidak punya modul
 * (ia punya), melainkan karena kolom-kolom ITU tidak ikut dipanen ke
 * `pdt_fact_ads`. Impresi/klik/CTR showcase SUDAH terisi dari Ads Manager.
 * Halaman menampilkan catatan/"—" eksplisit, BUKAN 0 yang mengarang aktivitas. Seksi disembunyikan seluruhnya saat
 * `tahap` `null` (nol baris `pdt_fact_shop_daily` basis `net` periode ini).
 *
 * **Insight & Rekomendasi** (keputusan pemilik via `AskUserQuestion` KEDELAPAN
 * dan KESEMBILAN, 2026-09-16): KEDUA platform SATU bentuk, TIDAK PERNAH
 * `null` (ringkasan/outlook selalu punya sesuatu untuk dikatakan). Rekomendasi
 * v1 GENERIK per dimensi skor (`skor.dimensi` ber-nilai rendah), BUKAN
 * porting penuh aturan per-metrik mesin lama (lihat docblock
 * `pdt.PdtLaporanInsight`, `@cdps/core`). **G2-01-INSIGHT-EDIT**: AM BISA
 * menyunting enam field-nya di sini (state lokal `insightDraft`, disetel
 * ulang dari insight mesin tiap ganti toko/periode, nol persistensi) —
 * editor sama pola `InsightEditor.tsx` mesin lama (`web-internal/src/
 * components/clients/`) MINUS narasi tahap (tahap PDT sudah data
 * terstruktur). Suntingan dikirim APA ADANYA ke `POST .../laporan/kirim`
 * saat "Kirim ke Klien" ditekan — `pdt.normalizePdtInsightDraft` (`@cdps/core`)
 * yang memvalidasi (pesan BI `[...]` muncul di `kirimErr` kalau ditolak),
 * BUKAN state machine draft/publikasi/revisi terpisah seperti
 * `client_report_insight` mesin lama — PDT-21 "snapshot beku HANYA saat
 * dikirim" tetap utuh, `kirimLaporanPdt` tetap satu aksi atomik.
 *
 * Tombol "Kirim ke Klien" (Flow B langkah 4, Rule 22) membekukan snapshot ke
 * `pdt_laporan_kiriman` lewat `POST /account/pdt/laporan/kirim`. Kirim kedua
 * untuk toko+periode yang sama BUKAN error — itu kirim-ulang/revisi (Flow B
 * langkah 5, Rule 23): riwayat kiriman toko ini (`GET /account/pdt/laporan/
 * kiriman`, `pdt.riwayatKirimanPdt`) menentukan apakah periode yang sedang
 * dipilih sudah pernah dikirim — label tombol jadi "Kirim Ulang" (bukan
 * "Kirim ke Klien") kalau sudah, dan tabel "Riwayat Pengiriman" di bawah
 * menampilkan seluruh kiriman toko ini (terbaru dulu, revisi menunjuk
 * kiriman yang digantikannya). Riwayat dimuat SEKALI per toko (bukan
 * per-periode — daftar ini mencakup semua periode sekaligus) dan disegarkan
 * setelah kirim berhasil.
 *
 * Klien+platform dipilih dari daftar (bukan kolom teks bebas): `GET /clients`
 * sudah terbuka untuk Account (RLS `clients_select`), jadi tak ada alasan
 * memaksa AM mengetik ID — beda dari `/ads/screening` yang harus memakai
 * kolom teks karena RLS tidak punya lengan Ads (lihat docblock di sana).
 * Opsi platform disaring ke Shopee/TikTok Shop (PDT-22: Tokopedia/Lazada/
 * Blibli tetap manual) — memilih platform lain hanya akan 400 di server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { errorMessage, MAX_PAGE_LIMIT } from '@/lib/api';
import { listClients, type Client, type Platform } from '@/lib/clients';
import {
  getPdtLaporan,
  kirimLaporanPdt,
  listPlatformPdtKlien,
  type PdtKirimanRingkas,
  type PdtLaporan,
  type PdtLaporanInsight,
  type PdtLaporanKiriman,
  type PdtLaporanRekomendasi,
  type PdtTahapSatuan,
  riwayatKirimanPdt,
} from '@/lib/pdt';
import { formatIDR } from '@/lib/money';
import { GrafikBatang, GrafikDonat, GrafikGaris, GrafikGelembung,
  GrafikPeringkat, GrafikSkor } from '@/components/PdtChart';


/** Label kuadran produk — SAMA persis `report/render.ts` `KUADRAN_META` (mesin lama), bukan istilah baru. */
const KUADRAN_LABEL: Record<string, string> = {
  bintang: 'Produk Bintang',
  hidden_gem: 'Hidden Gem',
  bocor_traffic: 'Bocor Traffic',
  evaluasi: 'Evaluasi',
  tidur: 'Produk Tidur',
  tidak_tayang: 'Tidak Tayang',
  // Ember ketujuh, SHOPEE saja — trafik ada tapi CR tak bisa dihitung. TikTok
  // tidak pernah mengisinya (di sana CVR kosong jatuh ke "Produk Tidur").
  no_data: 'Data Tak Lengkap',
};
const KUADRAN_URUTAN = ['bintang', 'hidden_gem', 'bocor_traffic', 'evaluasi', 'tidur', 'tidak_tayang', 'no_data'];

/** Label & warna kedalaman jelajah — ambangnya ditetapkan `@cdps/core` (`KEDALAMAN_DALAM_MIN`/`KEDALAMAN_DANGKAL_MAKS`), di sini hanya tampilannya. */
const KEDALAMAN_LABEL: Record<string, string> = {
  dalam: 'jelajah dalam',
  sedang: 'jelajah sedang',
  dangkal: 'jelajah dangkal',
};
const KEDALAMAN_WARNA: Record<string, string> = {
  dalam: '#15803d',
  sedang: '#b45309',
  dangkal: '#b91c1c',
};

/** Angka desimal gaya Indonesia (koma), untuk metrik rasio yang bukan persen dan bukan rupiah. */
function formatDesimal(v: number | null, digit: number): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('id-ID', { minimumFractionDigits: digit, maximumFractionDigits: digit });
}

/**
 * Label sumber iklan untuk bagian "Iklan per Kampanye" — SAMA PERSIS dengan
 * yang dipakai `bangunIklanTiktok`/`bangunIklanShopee` di `@cdps/core`
 * (payload "iklan" membawa labelnya sendiri; payload "kampanye" hanya
 * membawa kode `sumber`, jadi label yang sama diulang di sini supaya dua
 * tabel bertetangga tidak menyebut sumber yang sama dengan dua nama).
 */
const SUMBER_IKLAN_LABEL: Record<string, string> = {
  tt_ads_product: 'Iklan Produk',
  tt_ads_live: 'Iklan Live',
  shopee_ads_cpc: 'Iklan Toko (CPC)',
  shopee_ads_search: 'Iklan Pencarian',
  shopee_ads_live: 'Iklan Live',
};

/** Detik → "1j 30m" / "45m" / "20d". Durasi sesi LIVE dibaca sebagai lama siaran, bukan angka detik mentah. */
function formatDurasi(detik: number | null): string {
  if (detik == null) return '—';
  const j = Math.floor(detik / 3600);
  const m = Math.floor((detik % 3600) / 60);
  if (j > 0) return m > 0 ? `${j}j ${m}m` : `${j}j`;
  if (m > 0) return `${m}m`;
  return `${detik}d`;
}

/** ISO → "07 Agu 14:30" (waktu lokal pembaca). `null` ⇒ em dash, aturan rumah #7. */
function formatWaktuSingkat(iso: string | null): string {
  if (iso == null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatPercent(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function formatCount(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('id-ID');
}

function formatBobot(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function formatRoas(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(2)}x`;
}

/** Format nilai metrik "tahap" sesuai `satuan` — `null` SELALU "—" (BUKAN 0, banyak bergantung modul yang belum dibangun). */
function formatTahapNilai(v: number | null, satuan: PdtTahapSatuan): string {
  if (v === null) return '—';
  if (satuan === 'rupiah') return formatIDR(v);
  if (satuan === 'persen') return formatPercent(v);
  if (satuan === 'kali') return formatRoas(v);
  return formatCount(v);
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** `<input type="month">` mengembalikan "YYYY-MM"; route butuh "YYYY-MM-01". */
function monthToPeriode(month: string): string {
  return `${month}-01`;
}

function skorBadgeClass(label: string | null): string {
  if (label === 'SEHAT') return 'badge-green';
  if (label === 'PERLU PERHATIAN') return 'badge-amber';
  if (label === 'KRITIS') return 'badge-red';
  return 'badge-gray';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID');
}

/**
 * Editor "insight" layar pratinjau (G2-01-INSIGHT-EDIT) — pola SAMA
 * `InsightEditor.tsx` (mesin lama, `web-internal/src/components/clients/`)
 * disalin & disederhanakan untuk PDT: enam field yang sama MINUS narasi
 * tahap (tahap PDT sudah data terstruktur, bukan prosa). Nol persistensi di
 * sini — state lokal murni, dikirim apa adanya saat "Kirim ke Klien"
 * ditekan; server (`pdt.normalizePdtInsightDraft`) yang memvalidasi.
 */
const REK_KOSONG: PdtLaporanRekomendasi = { judul: '', target: '', dampak: '', timeline: '' };
const IND_KOSONG = { nama: '', target: '' };

function PoinEditor({ value, disabled, onChange }: { value: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const rows = [...value, ''];
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span className="muted" style={{ fontSize: 12, paddingTop: 8, minWidth: 18 }}>{i + 1}.</span>
          <textarea
            rows={2}
            value={t}
            disabled={disabled}
            placeholder={i === value.length ? 'Tambah poin…' : ''}
            style={{ flex: 1, fontSize: 13 }}
            onChange={(e) => {
              const next = [...value];
              if (i === value.length) next.push(e.target.value);
              else next[i] = e.target.value;
              onChange(next.filter((x, idx) => x.trim() !== '' || idx < next.length - 1));
            }}
          />
          {i < value.length && (
            <button type="button" className="btn btnGhost btnSm" disabled={disabled}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >hapus</button>
          )}
        </div>
      ))}
    </div>
  );
}

function RekEditor({ value, disabled, onChange }: { value: PdtLaporanRekomendasi[]; disabled: boolean; onChange: (v: PdtLaporanRekomendasi[]) => void }) {
  const rows = [...value, REK_KOSONG];
  const set = (i: number, patch: Partial<PdtLaporanRekomendasi>) => {
    const next = [...value];
    if (i === value.length) next.push({ ...REK_KOSONG, ...patch });
    else next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ border: '1px solid var(--line, #DAE2EA)', borderRadius: 4, padding: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input value={r.judul} disabled={disabled} placeholder="Judul"
              onChange={(e) => set(i, { judul: e.target.value })} style={{ fontSize: 13 }} />
            <input value={r.timeline} disabled={disabled} placeholder="Timeline (mis. 2 minggu)"
              onChange={(e) => set(i, { timeline: e.target.value })} style={{ fontSize: 13 }} />
            <input value={r.target} disabled={disabled} placeholder="Target"
              onChange={(e) => set(i, { target: e.target.value })} style={{ fontSize: 13 }} />
            <input value={r.dampak} disabled={disabled} placeholder="Dampak"
              onChange={(e) => set(i, { dampak: e.target.value })} style={{ fontSize: 13 }} />
          </div>
          {i < value.length && (
            <button type="button" className="btn btnGhost btnSm" disabled={disabled} style={{ marginTop: 6 }}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >hapus rekomendasi</button>
          )}
        </div>
      ))}
    </div>
  );
}

function IndEditor({ value, disabled, onChange }: { value: { nama: string; target: string }[]; disabled: boolean; onChange: (v: { nama: string; target: string }[]) => void }) {
  const rows = [...value, IND_KOSONG];
  const set = (i: number, patch: Partial<{ nama: string; target: string }>) => {
    const next = [...value];
    if (i === value.length) next.push({ ...IND_KOSONG, ...patch });
    else next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input value={m.nama} disabled={disabled} placeholder="Nama indikator"
            onChange={(e) => set(i, { nama: e.target.value })} style={{ flex: 1, fontSize: 13 }} />
          <input value={m.target} disabled={disabled} placeholder="Target"
            onChange={(e) => set(i, { target: e.target.value })} style={{ flex: 1, fontSize: 13 }} />
          {i < value.length && (
            <button type="button" className="btn btnGhost btnSm" disabled={disabled}
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >hapus</button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Banner kelengkapan data — DIPAKAI HANYA DI HALAMAN INTERNAL INI.
 *
 * Kenapa penandanya wajib. Halaman ini ada di `web-internal`, dan isinya tidak
 * sampai ke klien lewat portal: RLS `pdt_laporan_kiriman` hanya memberi SELECT
 * ke OD/Director, Lead divisi Account, dan AM pemilik toko — nol realm portal
 * klien, dan `web-client-portal` nol rujukan PDT. Tetapi laporan hari ini sampai
 * ke klien lewat SCREENSHOT dan share-screen, dan di jalur itu peringatan "belum
 * lengkap" terbaca klien sebagai "agensinya sendiri tidak tahu angkanya" —
 * kebalikan dari maksudnya, yang sebenarnya menjaga Rule 12 (tidak diketahui
 * BUKAN nol).
 *
 * Karena itu tiap banner memakai komponen ini, bukan `alert alertWarning`
 * telanjang: satu tempat untuk mengubah penandanya, dan banner berikutnya tidak
 * lahir tanpa penanda karena polanya sudah ada.
 *
 * Ini TIDAK menggantikan aturan render klien. PDT hari ini memang belum punya
 * permukaan klien sama sekali (nol renderer HTML, nol route portal —
 * `kirimLaporanPdt` hanya membekukan JSON), jadi penanda ini menjaga jalur yang
 * NYATA dipakai hari ini: screenshot dan share-screen. Saat permukaan klien
 * dibangun (`docs/backlog/PDT_BACKLOG.md` §2 G2 — port renderer `klien`/
 * `internal` mesin lama M14 ke PDT), banner kelengkapan data dilarang ter-render
 * di sana sama sekali: penanda ini untuk mata AM, bukan izin menampilkannya ke
 * klien.
 */
function CatatanInternal({ children }: { children: React.ReactNode }) {
  return (
    <div className="alert alertWarning" role="status" style={{ marginTop: 8, marginBottom: 8 }}>
      <strong style={{ display: 'block', marginBottom: 4, textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.04em' }}>
        Catatan internal — jangan dikirim / ditampilkan ke klien
      </strong>
      {children}
    </div>
  );
}

export default function LaporanPdtPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsErr, setClientsErr] = useState<string | null>(null);

  const [clientId, setClientId] = useState('');
  const [platformId, setPlatformId] = useState<number | ''>('');
  const [month, setMonth] = useState(currentMonth());

  const [laporan, setLaporan] = useState<PdtLaporan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // G2-01-INSIGHT-EDIT — draf AM, disetel ulang dari insight mesin setiap kali
  // laporan (toko/periode) dimuat ulang. Nol persistensi — murni state layar.
  const [insightDraft, setInsightDraft] = useState<PdtLaporanInsight | null>(null);

  const [kirimLoading, setKirimLoading] = useState(false);
  const [kirimErr, setKirimErr] = useState<string | null>(null);
  const [kirimHasil, setKirimHasil] = useState<PdtLaporanKiriman | null>(null);

  const [riwayat, setRiwayat] = useState<PdtKirimanRingkas[]>([]);
  const [riwayatErr, setRiwayatErr] = useState<string | null>(null);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsErr(null);
    try {
      const res = await listClients({ limit: MAX_PAGE_LIMIT });
      setClients(res.data);
    } catch (e) {
      setClientsErr(errorMessage(e));
    } finally {
      setClientsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  // G1-09-PLATFORM-DARI-DETAIL — platform dibaca dari DETAIL klien, bukan dari
  // baris roster: `ClientListRowWire` sengaja tidak memuat `platforms`, jadi
  // `selectedClient.platforms` adalah `undefined` dan `.filter` di sini dulu
  // mematikan seluruh halaman begitu AM memilih klien (bug kelas O43).
  const [platformOptions, setPlatformOptions] = useState<Platform[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformErr, setPlatformErr] = useState<string | null>(null);

  useEffect(() => {
    if (clientId === '') {
      setPlatformOptions([]);
      setPlatformErr(null);
      return;
    }
    let batal = false;
    setPlatformLoading(true);
    setPlatformErr(null);
    void (async () => {
      try {
        const rows = await listPlatformPdtKlien(clientId);
        if (!batal) setPlatformOptions(rows);
      } catch (e) {
        if (!batal) {
          setPlatformOptions([]);
          setPlatformErr(errorMessage(e));
        }
      } finally {
        if (!batal) setPlatformLoading(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, [clientId]);

  // `permintaanKe` menandai permintaan TERBARU. Tanpa penjaga ini, respons
  // yang datang TERLAMBAT untuk toko/periode yang sudah ditinggalkan akan
  // menimpa laporan yang sudah tampil — dan kalau yang terlambat itu berakhir
  // gagal (mis. 504), halaman menampilkan error padahal laporan yang diminta
  // sekarang sudah berhasil dimuat. Pola `batal` yang sama sudah dipakai efek
  // daftar platform di atas.
  const permintaanKe = useRef(0);

  const loadLaporan = useCallback(async () => {
    // Ganti toko/periode -> hasil kirim sebelumnya (kalau ada) sudah tidak relevan.
    setKirimErr(null);
    setKirimHasil(null);
    if (platformId === '') return;
    const seq = ++permintaanKe.current;
    setLoading(true);
    setErr(null);
    try {
      const res = await getPdtLaporan(platformId, monthToPeriode(month));
      if (seq !== permintaanKe.current) return;
      setLaporan(res);
      setInsightDraft(res.insight);
    } catch (e) {
      if (seq !== permintaanKe.current) return;
      setLaporan(null);
      setInsightDraft(null);
      setErr(errorMessage(e));
    } finally {
      if (seq === permintaanKe.current) setLoading(false);
    }
  }, [platformId, month]);

  useEffect(() => {
    void loadLaporan();
  }, [loadLaporan]);

  // Riwayat mencakup SEMUA periode toko ini sekaligus — dimuat sekali per
  // platformId (bukan per-periode seperti loadLaporan), disegarkan lagi
  // setelah kirim berhasil (lihat handleKirim).
  const loadRiwayat = useCallback(async () => {
    if (platformId === '') {
      setRiwayat([]);
      return;
    }
    setRiwayatErr(null);
    try {
      const res = await riwayatKirimanPdt(platformId);
      setRiwayat(res);
    } catch (e) {
      setRiwayat([]);
      setRiwayatErr(errorMessage(e));
    }
  }, [platformId]);

  useEffect(() => {
    void loadRiwayat();
  }, [loadRiwayat]);

  const periodeIni = monthToPeriode(month);
  // Riwayat terurut terbaru dulu — kecocokan PERTAMA untuk periode ini sudah
  // pasti kiriman TERAKHIR (revisi terbaru), bukan sembarang kiriman lama.
  const kirimanTerakhirUntukPeriodeIni = riwayat.find((k) => k.periode_mulai === periodeIni) ?? null;

  async function handleKirim() {
    if (platformId === '' || !laporan) return;
    const platformLabel = laporan.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee';
    const konfirmasi = kirimanTerakhirUntukPeriodeIni
      ? `Kirim ULANG laporan ${platformLabel} periode ${laporan.periode_awal_bulan} ke klien? ` +
        `Ini akan jadi revisi baru — menggantikan kiriman #${kirimanTerakhirUntukPeriodeIni.id} ` +
        `(${formatDateTime(kirimanTerakhirUntukPeriodeIni.dikirim_pada)}), bukan menimpanya. ` +
        'Tidak meminta berkas diunggah ulang.'
      : `Kirim laporan ${platformLabel} periode ${laporan.periode_awal_bulan} ke klien? ` +
        'Snapshot akan dibekukan (tidak bisa diubah) — kirim ulang nanti membuat revisi baru, bukan menimpa.';
    if (!window.confirm(konfirmasi)) return;
    setKirimLoading(true);
    setKirimErr(null);
    try {
      const hasil = await kirimLaporanPdt(platformId, monthToPeriode(month), insightDraft ?? undefined);
      setKirimHasil(hasil);
      setInsightDraft(hasil.laporan.insight);
      await loadRiwayat();
    } catch (e) {
      setKirimErr(errorMessage(e));
    } finally {
      setKirimLoading(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h1>Laporan PDT</h1>
        <p className="muted">
          Pusat Data Toko — KPI ringkas dan skor performa satu toko klien untuk satu bulan, dihitung dari
          data yang sudah diunggah. Belum termasuk pengiriman ke klien.
        </p>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 280 }}>
            <label htmlFor="pdtLaporanClient">Klien</label>
            <select
              id="pdtLaporanClient"
              className="input"
              value={clientId}
              disabled={clientsLoading}
              onChange={(e) => {
                setClientId(e.target.value);
                setPlatformId('');
                setLaporan(null);
                setErr(null);
              }}
            >
              <option value="">— pilih klien —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.toko} ({c.id})
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 220 }}>
            <label htmlFor="pdtLaporanPlatform">Toko / Platform</label>
            <select
              id="pdtLaporanPlatform"
              className="input"
              value={platformId}
              disabled={!selectedClient || platformLoading || platformOptions.length === 0}
              onChange={(e) => {
                setPlatformId(e.target.value === '' ? '' : Number(e.target.value));
                setLaporan(null);
                setErr(null);
              }}
            >
              <option value="">{platformLoading ? 'memuat toko…' : '— pilih platform —'}</option>
              {platformOptions.map((p) => (
                <option key={p.client_platform_id} value={p.client_platform_id}>
                  {p.platform}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="pdtLaporanPeriode">Periode</label>
            <input
              id="pdtLaporanPeriode"
              type="month"
              className="input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        </div>

        {clientsErr && (
          <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>
            {clientsErr}
          </div>
        )}
        {platformErr && (
          <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>
            {platformErr}
          </div>
        )}
        {selectedClient && !platformLoading && !platformErr && platformOptions.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Klien ini belum punya toko Shopee/TikTok Shop aktif — Tokopedia/Lazada/Blibli tetap manual (PDT-22).
          </p>
        )}
        {selectedClient && (
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            <Link href={`/clients/${encodeURIComponent(selectedClient.id)}`}>Detail Klien →</Link>
          </p>
        )}
      </section>

      {platformId === '' ? (
        <div className="emptyState">Pilih klien dan platform toko untuk memuat laporan.</div>
      ) : loading ? (
        <div className="pageLoading">Memuat laporan...</div>
      ) : err ? (
        <section className="card">
          <div className="alert alertError" role="alert">{err}</div>
        </section>
      ) : laporan ? (
        <>
          <section className="card">
            <div className="cardHeader">
              <div>
                <h2>KPI Ringkas</h2>
                <p className="muted">
                  {laporan.platform === 'tiktok' ? 'TikTok Shop' : 'Shopee'} · {laporan.periode_awal_bulan}
                </p>
              </div>
              <button type="button" className="btn btnPrimary btnSm" disabled={kirimLoading} onClick={() => void handleKirim()}>
                {kirimLoading ? 'Mengirim...' : kirimanTerakhirUntukPeriodeIni ? 'Kirim Ulang' : 'Kirim ke Klien'}
              </button>
            </div>
            {kirimanTerakhirUntukPeriodeIni && !kirimHasil && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
                Periode ini sudah dikirim ke klien pada {formatDateTime(kirimanTerakhirUntukPeriodeIni.dikirim_pada)}{' '}
                oleh {kirimanTerakhirUntukPeriodeIni.dikirim_oleh}.
              </p>
            )}
            {kirimErr && (
              <div className="alert alertError" role="alert" style={{ marginBottom: 16 }}>{kirimErr}</div>
            )}
            {kirimHasil && (
              <div className="alert alertInfo" role="status" style={{ marginBottom: 16 }}>
                Terkirim ke klien pada {formatDateTime(kirimHasil.dikirim_pada)} oleh {kirimHasil.dikirim_oleh}.
                {kirimHasil.menggantikan_kiriman_id !== null && (
                  <> Revisi — menggantikan kiriman #{kirimHasil.menggantikan_kiriman_id}.</>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatIDR(laporan.kpi.gmv)}</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GMV</p>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatCount(laporan.kpi.pesanan)}</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Pesanan</p>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatCount(laporan.kpi.pengunjung)}</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Pengunjung</p>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatPercent(laporan.kpi.cvr)}</div>
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>CVR</p>
              </div>
              {/* Kedalaman jelajah — metrik NIAT, bukan trafik. Satu pengunjung
                  membuka lebih dari satu barang adalah hal yang normal dan justru
                  bagus; dibaca BERSAMA CVR di sebelahnya, ia menunjuk divisi mana
                  yang harus bergerak (lihat docblock KEDALAMAN_DALAM_MIN di core). */}
              {laporan.kpi.barang_per_pengunjung !== null && (
                <div>
                  <div style={{ fontSize: 24, fontWeight: 'bold' }}>
                    {formatDesimal(laporan.kpi.barang_per_pengunjung, 2)}
                    {laporan.kpi.kedalaman !== null && (
                      <span style={{ fontSize: 12, fontWeight: 'normal', marginLeft: 6, color: KEDALAMAN_WARNA[laporan.kpi.kedalaman] ?? undefined }}>
                        {KEDALAMAN_LABEL[laporan.kpi.kedalaman] ?? laporan.kpi.kedalaman}
                      </span>
                    )}
                  </div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Barang dibuka / kunjungan</p>
                </div>
              )}
            </div>
            {laporan.kpi.barang_per_pengunjung !== null && (
              <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
                Satu kunjungan membuka {formatDesimal(laporan.kpi.barang_per_pengunjung, 2)} barang rata-rata. Lebih dari satu
                adalah hal normal dan justru sinyal bagus — pengunjung masih mau melihat-lihat, entah karena belum
                menemukan yang pas atau karena tokonya menarik untuk ditelusuri. Baca angka ini{' '}
                <strong>bersama CVR</strong>: jelajah dalam tapi CVR rendah berarti trafiknya sudah benar dan yang belum
                meyakinkan ada di produk/harga; jelajah dangkal dengan CVR rendah berarti sebaliknya, targeting dulu
                yang diperbaiki. Penyebutnya <strong>kunjungan harian</strong>, jadi angka ini lebih kecil daripada
                angka sejenis di dasbor platform, yang men-dedup pengunjung sepanjang bulan.
              </p>
            )}
            {laporan.platform !== 'tiktok' && (
              <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
                GMV Shopee = basis Pesanan Siap Dikirim, TANPA potongan refund (Rule 16) — berbeda dari GMV
                TikTok Shop di atas, yang sudah bersih dari refund (Rule 15). Keduanya tidak boleh dibandingkan
                apa adanya.
              </p>
            )}
          </section>

          {laporan.harian && (
            <section className="card">
              <h2>Tren Harian</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                GMV per hari · {laporan.harian.hari_terisi} hari terisi
                {laporan.harian.gmv_rata_harian !== null && <> · rata-rata {formatIDR(laporan.harian.gmv_rata_harian)}/hari</>}
              </p>
              <div style={{ marginTop: 12 }}>
                <GrafikGaris
                  judul="Tren GMV harian"
                  titik={laporan.harian.titik.map((t) => ({ label: t.tanggal, nilai: t.gmv }))}
                  acuan={
                    laporan.harian.gmv_rata_harian === null
                      ? null
                      : { nilai: laporan.harian.gmv_rata_harian, label: 'rata-rata' }
                  }
                />
              </div>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12 }}>
                {laporan.harian.gmv_tertinggi && (
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 'bold' }}>{formatIDR(laporan.harian.gmv_tertinggi.gmv)}</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      Hari tertinggi · {laporan.harian.gmv_tertinggi.tanggal}
                    </p>
                  </div>
                )}
                {laporan.harian.gmv_terendah && (
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 'bold' }}>{formatIDR(laporan.harian.gmv_terendah.gmv)}</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      Hari terendah · {laporan.harian.gmv_terendah.tanggal}
                    </p>
                  </div>
                )}
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
                Hari yang berkasnya tidak memuat data TIDAK digambar sebagai nol — garisnya terputus di situ.
                Jumlah GMV harian di grafik ini sama dengan GMV di KPI Ringkas (basis dan sumber barisnya sama).
              </p>
            </section>
          )}

          <section className="card">
            <h2>Kanal (Sumber GMV)</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              GMV Kotor: {formatIDR(laporan.kanal.gmv_total)}
            </p>
            {!laporan.kanal.lengkap && (
              <CatatanInternal>
                Belum lengkap — {laporan.platform === 'tiktok' ? 'sumber ini' : 'Shopee Ads dan Affiliate saja'}.
                {laporan.platform !== 'tiktok' && (
                  <> Voucher, Chat, Meta Ads, dan Video belum diproses PDT — GMV dari sumber itu TIDAK berarti nol,
                  hanya belum terhitung di sini.</>
                )}
              </CatatanInternal>
            )}
            {laporan.kanal.gmv_total === null ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Belum ada data untuk periode ini.</p>
            ) : (
              <div style={{ marginTop: 12 }}>
                <GrafikDonat
                  judul="Kontribusi GMV per kanal"
                  bagian={laporan.kanal.items.map((item) => ({ label: item.label, nilai: item.gmv }))}
                  tengah={null}
                />
              </div>
            )}
          </section>

          {laporan.iklan && (
            <section className="card">
              <h2>Iklan</h2>
              {!laporan.iklan.lengkap && (
                <CatatanInternal>
                  Belum lengkap — Iklan Toko, Pencarian, dan Live saja. Banner Ads belum diproses PDT — biaya/pendapatan
                  dari sumber itu TIDAK berarti nol, hanya belum terhitung di sini.
                </CatatanInternal>
              )}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.iklan.biaya)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Total Biaya Iklan</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.iklan.gmv)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Total GMV Iklan</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatRoas(laporan.iklan.roas)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>ROAS</p>
                </div>
              </div>
              {laporan.iklan.items.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <GrafikBatang
                    judul="Omzet vs biaya iklan per sumber"
                    seri={['GMV', 'Biaya']}
                    kelompok={laporan.iklan.items.map((item) => ({ label: item.label, nilai: [item.gmv, item.biaya] }))}
                  />
                </div>
              )}
              <table style={{ marginTop: 16, width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Sumber</th>
                    <th style={{ textAlign: 'right' }}>Biaya</th>
                    <th style={{ textAlign: 'right' }}>GMV</th>
                    <th style={{ textAlign: 'right' }}>ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {laporan.iklan.items.map((item) => (
                    <tr key={item.kode}>
                      <td>{item.label}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(item.biaya)}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(item.gmv)}</td>
                      <td style={{ textAlign: 'right' }}>{formatRoas(item.roas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* "Per Kampanye" mesin lama — rincian di balik ringkasan per-sumber di
              atas. Satu kampanye rugi yang tersembunyi di balik rata-rata sumber
              yang sehat adalah persis anggaran yang harus dimatikan minggu depan. */}
          {laporan.kampanye && (
            <section className="card">
              <h2>Iklan per Kampanye</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                {laporan.kampanye.total_kampanye} kampanye periode ini
                {laporan.kampanye.tanpa_hasil > 0
                  ? ` · ${laporan.kampanye.tanpa_hasil} tanpa hasil (${formatIDR(laporan.kampanye.biaya_tanpa_hasil)} terbakar)`
                  : ' · nol kampanye tanpa hasil'}
                {laporan.kampanye.total_kampanye > laporan.kampanye.top.length
                  ? ` · ${laporan.kampanye.top.length} terbesar ditampilkan`
                  : ''}
              </p>
              <div style={{ marginTop: 12 }}>
                <GrafikPeringkat
                  judul="Belanja iklan per kampanye"
                  baris={laporan.kampanye.top.map((k) => ({
                    label: k.kampanye_id,
                    catatan: SUMBER_IKLAN_LABEL[k.sumber] ?? k.sumber,
                    nilai: k.biaya,
                  }))}
                  format={formatIDR}
                  warna="#b45309"
                />
              </div>
              <table style={{ marginTop: 12, width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Kampanye</th>
                    <th style={{ textAlign: 'left' }}>Sumber</th>
                    <th style={{ textAlign: 'right' }}>Biaya</th>
                    <th style={{ textAlign: 'right' }}>Omzet</th>
                    <th style={{ textAlign: 'right' }}>ROAS</th>
                    <th style={{ textAlign: 'right' }}>Klik</th>
                    <th style={{ textAlign: 'right' }}>CTR</th>
                    <th style={{ textAlign: 'right' }}>CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {laporan.kampanye.top.map((k) => (
                    <tr key={`${k.sumber}-${k.kampanye_id}`}>
                      <td>{k.kampanye_id}</td>
                      <td>{SUMBER_IKLAN_LABEL[k.sumber] ?? k.sumber}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(k.biaya)}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(k.gmv)}</td>
                      <td style={{ textAlign: 'right' }}>{formatRoas(k.roas)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCount(k.klik)}</td>
                      <td style={{ textAlign: 'right' }}>{formatPercent(k.ctr)}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(k.cpc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {laporan.live && (
            <section className="card">
              <h2>Live Streaming</h2>
              <p className="muted" style={{ fontSize: 12 }}>{laporan.live.sesi} sesi periode ini</p>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.live.gmv)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GMV Live</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.live.vv)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Penonton (VV)</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.live.gmv_per_sesi)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GMV / Sesi</p>
                </div>
                {laporan.live.jam !== null && (
                  <>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{laporan.live.jam.toFixed(2)} jam</div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Total Durasi</p>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.live.gmv_per_jam)}</div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GMV / Jam</p>
                    </div>
                  </>
                )}
              </div>
              {laporan.platform !== 'tiktok' && (
                <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
                  Durasi siaran tidak tersedia dari data Shopee — GMV/Jam tidak bisa dihitung untuk toko ini.
                </p>
              )}
            </section>
          )}

          {/* "Top 10 Sesi" mesin lama — rincian di balik ringkasan LIVE di atas.
              Ringkasan menjawab "seberapa sehat LIVE bulan ini", daftar ini
              menjawab "sesi mana yang bekerja" — yang menentukan jam tayang dan
              host bulan depan. */}
          {laporan.sesi_live && (
            <section className="card">
              <h2>Top Sesi LIVE</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                {laporan.sesi_live.total_sesi} sesi periode ini
                {laporan.sesi_live.kontribusi_top !== null
                  ? ` · ${laporan.sesi_live.top.length} teratas menyumbang ${formatPercent(laporan.sesi_live.kontribusi_top)} GMV LIVE`
                  : ''}
              </p>
              <div style={{ marginTop: 12 }}>
                <GrafikPeringkat
                  judul="GMV per sesi LIVE"
                  baris={laporan.sesi_live.top.map((s) => ({
                    label: formatWaktuSingkat(s.waktu_posting),
                    catatan: s.akun_toko ? 'toko' : (s.creator_handle ?? 'afiliasi'),
                    nilai: s.gmv,
                  }))}
                  format={formatIDR}
                  warna="#9333ea"
                />
              </div>
              <table style={{ marginTop: 12, width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Waktu</th>
                    <th style={{ textAlign: 'left' }}>Host</th>
                    <th style={{ textAlign: 'right' }}>Durasi</th>
                    <th style={{ textAlign: 'right' }}>Penonton</th>
                    <th style={{ textAlign: 'right' }}>GMV</th>
                    <th style={{ textAlign: 'right' }}>GMV / jam</th>
                  </tr>
                </thead>
                <tbody>
                  {laporan.sesi_live.top.map((s) => (
                    <tr key={s.platform_content_id}>
                      <td>{formatWaktuSingkat(s.waktu_posting)}</td>
                      <td>{s.akun_toko ? 'Akun toko' : (s.creator_handle ?? 'Afiliasi')}</td>
                      <td style={{ textAlign: 'right' }}>{formatDurasi(s.durasi_detik)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCount(s.vv)}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(s.gmv)}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(s.gmv_per_jam)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {laporan.platform !== 'tiktok' && (
                <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Durasi sesi tidak tersedia dari data Shopee, jadi GMV/jam tidak bisa dihitung untuk toko ini.
                </p>
              )}
            </section>
          )}

          {laporan.video ? (
            <section className="card">
              <h2>Video / Konten</h2>
              <p className="muted" style={{ fontSize: 12 }}>{laporan.video.total} video periode ini</p>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.video.gmv)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GMV Video</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.video.vv)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Penonton (VV)</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.video.gmv_per_video)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GMV / Video</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.video.likes)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Likes</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.video.dibagikan)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Dibagikan</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.video.klik_produk)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Klik Produk</p>
                </div>
              </div>
            </section>
          ) : laporan.platform !== 'tiktok' ? (
            <section className="card">
              <h2>Video / Konten</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                Belum didukung untuk Shopee — modul parser Video Shopee belum punya penulis data ke PDT.
              </p>
            </section>
          ) : null}

          {laporan.produk && (
            <section className="card">
              <h2>Portfolio Produk</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                {laporan.produk.distribusi
                  ? (laporan.platform === 'tiktok'
                      ? 'Mode Benchmark (vs target MEA) — sumbu klik × CVR'
                      : 'Mode Absolut (ambang tetap) — sumbu pengunjung produk × CR pesanan')
                  : 'Top produk menurut GMV periode ini'}
              </p>
              {laporan.produk.distribusi && (
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                  {KUADRAN_URUTAN
                    .filter((k) => (laporan.produk!.distribusi![k]?.jumlah ?? 0) > 0 || (k !== 'tidur' && k !== 'tidak_tayang' && k !== 'no_data'))
                    .map((k) => (
                      <div key={k}>
                        <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.produk!.distribusi![k]?.jumlah ?? 0)}</div>
                        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          {KUADRAN_LABEL[k] ?? k} · {formatIDR(laporan.produk!.distribusi![k]?.gmv ?? null)}
                        </p>
                      </div>
                    ))}
                </div>
              )}
              {laporan.produk.top_aksi.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <GrafikGelembung
                    judul="Matriks produk: trafik vs konversi, luas gelembung = GMV"
                    labelX={laporan.platform === 'tiktok' ? 'Klik' : 'Pengunjung'}
                    labelY={laporan.platform === 'tiktok' ? 'CVR' : 'CR'}
                    produk={laporan.produk.top_aksi.map((x) => ({
                      label: x.nama_produk ?? x.platform_product_id ?? '—',
                      x: x.klik,
                      y: x.cvr,
                      ukuran: x.gmv,
                      kuadran: x.kuadran,
                    }))}
                  />
                </div>
              )}
              {laporan.produk.top_aksi.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 16 }}>Top Produk by GMV (Bintang/Bocor Traffic/Hidden Gem)</h3>
                  <table style={{ marginTop: 8, width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Produk</th>
                        <th style={{ textAlign: 'left' }}>Kuadran</th>
                        <th style={{ textAlign: 'right' }}>Klik</th>
                        <th style={{ textAlign: 'right' }}>CVR</th>
                        <th style={{ textAlign: 'right' }}>GMV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laporan.produk.top_aksi.map((x, i) => (
                        <tr key={x.platform_product_id ?? i}>
                          <td>{x.nama_produk ?? x.platform_product_id ?? '—'}</td>
                          <td>{KUADRAN_LABEL[x.kuadran] ?? x.kuadran}</td>
                          <td style={{ textAlign: 'right' }}>{formatCount(x.klik)}</td>
                          <td style={{ textAlign: 'right' }}>{formatPercent(x.cvr)}</td>
                          <td style={{ textAlign: 'right' }}>{formatIDR(x.gmv)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {/* "Top Produk by GMV" LINTAS kuadran — satu-satunya isi bagian ini
                  sisi Shopee (nol klasifikator kuadran), dan pelengkap sisi TikTok
                  di mana tabel di atas sengaja menyaring tiga kuadran actionable saja. */}
              {laporan.produk.top.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 16 }}>Top Produk by GMV{laporan.produk.distribusi ? ' (semua kuadran)' : ''}</h3>
                  <GrafikPeringkat
                    judul="Top produk menurut GMV"
                    baris={laporan.produk.top.map((x) => ({
                      label: x.nama_produk ?? x.platform_product_id ?? '—',
                      nilai: x.gmv,
                    }))}
                    format={formatIDR}
                  />
                  <table style={{ marginTop: 12, width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Produk</th>
                        {laporan.produk.distribusi && <th style={{ textAlign: 'left' }}>Kuadran</th>}
                        <th style={{ textAlign: 'right' }}>Tayang</th>
                        <th style={{ textAlign: 'right' }}>Klik</th>
                        <th style={{ textAlign: 'right' }}>CTR</th>
                        <th style={{ textAlign: 'right' }}>{laporan.platform === 'tiktok' ? 'Klik diuji' : 'Kunjungan'}</th>
                        <th style={{ textAlign: 'right' }}>{laporan.platform === 'tiktok' ? 'CVR' : 'CR'}</th>
                        <th style={{ textAlign: 'right' }}>GMV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laporan.produk.top.map((x, i) => (
                        <tr key={`top-${x.platform_product_id ?? i}`}>
                          <td>{x.nama_produk ?? x.platform_product_id ?? '—'}</td>
                          {laporan.produk!.distribusi && <td>{x.kuadran == null ? '—' : (KUADRAN_LABEL[x.kuadran] ?? x.kuadran)}</td>}
                          <td style={{ textAlign: 'right' }}>{formatCount(x.impresi)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCount(x.klik)}</td>
                          <td style={{ textAlign: 'right' }}>{formatPercent(x.ctr)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCount(x.traffic)}</td>
                          <td style={{ textAlign: 'right' }}>{formatPercent(x.cvr)}</td>
                          <td style={{ textAlign: 'right' }}>{formatIDR(x.gmv)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!laporan.produk.distribusi && (
                    <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                      Kuadran belum terhitung untuk periode ini — biasanya karena paket unggahannya belum di-commit ulang
                      setelah kolom pengunjung produk mulai dipanen.
                    </p>
                  )}
                  <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                    Tabel ini membaca funnel utuh, bukan satu angka: <strong>Tayang</strong> = berapa kali kartu produk
                    muncul di feed/pencarian, <strong>Klik</strong> = berapa kali dibuka, <strong>CTR</strong> = Klik ÷ Tayang,{' '}
                    <strong>{laporan.platform === 'tiktok' ? 'Klik diuji' : 'Kunjungan'}</strong> ={' '}
                    {laporan.platform === 'tiktok'
                      ? 'klik yang dipakai menguji kuadran'
                      : 'pengunjung yang benar-benar sampai ke halaman produk'}.
                    Tayang wajar jauh lebih besar dari {laporan.platform === 'tiktok' ? 'klik' : 'kunjungan'} — itu jarak
                    antar tahap, bukan dua versi angka yang sama. Tayang besar dengan CTR kecil berarti fotonya/judulnya
                    yang belum menarik; CTR sehat tapi {laporan.platform === 'tiktok' ? 'CVR' : 'CR'} kecil berarti
                    halaman produk atau harganya yang belum meyakinkan. Dua masalah berbeda dengan perbaikan berbeda.
                  </p>
                </>
              )}
              {/* Panel kedua mesin lama: "dua sudut pandang — relatif antar produk,
                  dan versus benchmark ideal". Ambangnya percentile katalog BULAN INI,
                  jadi ia menjawab "SKU mana yang menonjol di katalog ini" — pertanyaan
                  yang berbeda dari panel di atas, dan sengaja TIDAK disimpan supaya
                  perbandingan lintas bulan tetap memakai ambang yang tetap. */}
              {laporan.produk.relatif && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 20 }}>Mode Relatif (antar produk katalog ini)</h3>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Ambang p75 dari {formatCount(laporan.produk.relatif.ambang.n)} produk aktif periode ini ·{' '}
                    {laporan.platform === 'tiktok' ? 'klik' : 'pengunjung'}{' '}
                    {formatCount(laporan.produk.relatif.ambang.traffic_tinggi)} ·{' '}
                    {laporan.platform === 'tiktok' ? 'CVR' : 'CR'}{' '}
                    {formatPercent(laporan.produk.relatif.ambang.cr_tinggi)}
                  </p>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                    {KUADRAN_URUTAN
                      .filter((k) => (laporan.produk!.relatif!.distribusi[k]?.jumlah ?? 0) > 0)
                      .map((k) => (
                        <div key={`rel-${k}`}>
                          <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.produk!.relatif!.distribusi[k]?.jumlah ?? 0)}</div>
                          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {KUADRAN_LABEL[k] ?? k} · {formatIDR(laporan.produk!.relatif!.distribusi[k]?.gmv ?? null)}
                          </p>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </section>
          )}

          {laporan.afiliasi && (
            <section className="card">
              <h2>Afiliasi</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                {laporan.afiliasi.total_kreator} kreator periode ini ({laporan.afiliasi.produktif} produktif)
              </p>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.afiliasi.gmv)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>GMV Afiliasi</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.afiliasi.pesanan)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Pesanan Teratribusi</p>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.afiliasi.aov)}</div>
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>AOV</p>
                </div>
                {laporan.afiliasi.jumlah_live !== null && (
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.afiliasi.jumlah_live)}</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Sesi Live Kreator</p>
                  </div>
                )}
                {laporan.afiliasi.jumlah_video !== null && (
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.afiliasi.jumlah_video)}</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Video Kreator</p>
                  </div>
                )}
              </div>
              {laporan.platform !== 'tiktok' && (
                <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
                  Sesi Live/Video per kreator tidak tersedia dari data Shopee — hanya ringkasan GMV/pesanan yang bisa dihitung untuk toko ini.
                </p>
              )}
            </section>
          )}

          {/* "Top 10 Creator" mesin lama — rincian di balik ringkasan Afiliasi di
              atas. Ringkasan menjawab "seberapa besar afiliasi", daftar ini
              menjawab "siapa", dan "siapa" adalah satu-satunya yang bisa
              ditindaklanjuti tim Creator Management. */}
          {laporan.kreator && (
            <section className="card">
              <h2>Top Kreator</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                {laporan.kreator.total_kreator} kreator periode ini
                {laporan.kreator.kontribusi_top !== null
                  ? ` · ${laporan.kreator.top.length} teratas menyumbang ${formatPercent(laporan.kreator.kontribusi_top)} GMV afiliasi`
                  : ''}
              </p>
              <div style={{ marginTop: 12 }}>
                <GrafikPeringkat
                  judul="GMV per kreator"
                  baris={laporan.kreator.top.map((k) => ({ label: k.handle, nilai: k.gmv }))}
                  format={formatIDR}
                  warna="#0f766e"
                />
              </div>
              <table style={{ marginTop: 12, width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Kreator</th>
                    <th style={{ textAlign: 'right' }}>GMV</th>
                    <th style={{ textAlign: 'right' }}>Pesanan</th>
                    <th style={{ textAlign: 'right' }}>AOV</th>
                    {laporan.platform === 'tiktok' && <th style={{ textAlign: 'right' }}>Live</th>}
                    {laporan.platform === 'tiktok' && <th style={{ textAlign: 'right' }}>Video</th>}
                  </tr>
                </thead>
                <tbody>
                  {laporan.kreator.top.map((k) => (
                    <tr key={k.handle}>
                      <td>{k.handle}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(k.gmv)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCount(k.pesanan)}</td>
                      <td style={{ textAlign: 'right' }}>{formatIDR(k.aov)}</td>
                      {laporan.platform === 'tiktok' && <td style={{ textAlign: 'right' }}>{formatCount(k.jumlah_live)}</td>}
                      {laporan.platform === 'tiktok' && <td style={{ textAlign: 'right' }}>{formatCount(k.jumlah_video)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                Komisi dan ROI komisi per kreator tidak tersedia — kolomnya tidak pernah ada di data kreator PDT.
              </p>
            </section>
          )}

          {/* §8 mesin Shopee lama. Isinya diskon + flash sale, BUKAN voucher:
              PDT tidak punya modul parser voucher sama sekali, jadi klaim/biaya/
              usage-rate voucher tidak bisa dihitung ulang dan tidak ditebak. */}
          {laporan.promo && (
            <section className="card">
              <h2>Promo — Diskon &amp; Flash Sale</h2>
              <p className="muted" style={{ fontSize: 12 }}>Basis Siap Dikirim, sama dengan KPI di atas</p>

              {laporan.promo.diskon_total && (
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.promo.diskon_total.penjualan_siap_dikirim)}</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Penjualan dari Diskon</p>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.promo.diskon_total.pesanan_siap_dikirim)}</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Pesanan dari Diskon</p>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatPercent(laporan.promo.kontribusi_gmv_diskon)}</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Kontribusi ke GMV Toko</p>
                  </div>
                </div>
              )}

              {laporan.promo.diskon_per_tipe.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 16 }}>Per Tipe Promosi</h3>
                  <p className="muted" style={{ fontSize: 11 }}>
                    Komponen boleh saling tumpang tindih — jangan dijumlahkan; totalnya sudah ada di angka besar di atas.
                  </p>
                  <div style={{ marginTop: 8 }}>
                    <GrafikPeringkat
                      judul="Penjualan per tipe promosi"
                      baris={laporan.promo.diskon_per_tipe.map((t) => ({ label: t.tipe, nilai: t.penjualan_siap_dikirim }))}
                      format={formatIDR}
                      warna="#be123c"
                    />
                  </div>
                  <table style={{ marginTop: 12, width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Tipe</th>
                        <th style={{ textAlign: 'right' }}>Penjualan</th>
                        <th style={{ textAlign: 'right' }}>Pesanan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laporan.promo.diskon_per_tipe.map((t) => (
                        <tr key={t.tipe}>
                          <td>{t.tipe}</td>
                          <td style={{ textAlign: 'right' }}>{formatIDR(t.penjualan_siap_dikirim)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCount(t.pesanan_siap_dikirim)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {laporan.promo.flash_sale && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 16 }}>Flash Sale</h3>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(laporan.promo.flash_sale.penjualan_siap_dikirim)}</div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Penjualan</p>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatCount(laporan.promo.flash_sale.produk_dilihat)}</div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Produk Dilihat</p>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatPercent(laporan.promo.flash_sale.ctr)}</div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>CTR (dilihat → diklik)</p>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatPercent(laporan.promo.flash_sale.cvr)}</div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>CVR (diklik → pesanan)</p>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatPercent(laporan.promo.kontribusi_gmv_flash_sale)}</div>
                      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Kontribusi ke GMV Toko</p>
                    </div>
                  </div>
                </>
              )}

              <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
                Voucher tidak termasuk di sini — PDT belum punya modul parser voucher, jadi klaim, biaya, dan usage rate voucher
                tidak bisa dihitung dari data yang sudah diunggah. Kontribusi diskon dan flash sale juga tidak boleh dijumlahkan:
                satu produk bisa ikut keduanya di bulan yang sama.
              </p>
            </section>
          )}

          {/* §9 mesin Shopee lama. */}
          {laporan.layanan && (
            <section className="card">
              <h2>Layanan &amp; Kesehatan Toko</h2>

              {laporan.layanan.poin_penalti_total !== null && (
                <div
                  style={{
                    marginTop: 8, padding: 12, borderRadius: 8,
                    background: laporan.layanan.poin_penalti_total > 0 ? '#fef2f2' : '#f0fdfa',
                    border: `1px solid ${laporan.layanan.poin_penalti_total > 0 ? '#fecaca' : '#99f6e4'}`,
                  }}
                >
                  <div style={{ fontWeight: 'bold', fontSize: 14 }}>
                    {laporan.layanan.poin_penalti_total > 0
                      ? `Penalti aktif — ${formatCount(laporan.layanan.poin_penalti_total)} poin`
                      : '0 poin penalti — kesehatan toko bersih'}
                  </div>
                  {laporan.layanan.poin_penalti_total > 0 && (
                    <>
                      <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                        Poin penalti menekan traffic organik: produk lebih sulit ditemukan di pencarian dan rekomendasi, dan toko
                        dibatasi ikut program promosi Shopee selama masa penalti berjalan.
                      </p>
                      <table style={{ marginTop: 8, width: '100%', fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>Pelanggaran</th>
                            <th style={{ textAlign: 'left' }}>Durasi</th>
                            <th style={{ textAlign: 'right' }}>Poin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {laporan.layanan.penalti.map((p, i) => (
                            <tr key={`${p.deskripsi}-${i}`}>
                              <td>{p.deskripsi || '—'}</td>
                              <td>{p.durasi || '—'}</td>
                              <td style={{ textAlign: 'right' }}>{formatCount(p.poin)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {laporan.layanan.chat && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 16 }}>Performa Chat</h3>
                  <table style={{ marginTop: 8, width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Metrik</th>
                        <th style={{ textAlign: 'right' }}>Nilai</th>
                        <th style={{ textAlign: 'right' }}>Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          Tingkat Chat Direspon
                          <div className="muted" style={{ fontSize: 11 }}>
                            {formatCount(laporan.layanan.chat.chat_dibalas)} dibalas / {formatCount(laporan.layanan.chat.chat_masuk)} masuk
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatPercent(laporan.layanan.chat.response_rate)}</td>
                        <td style={{ textAlign: 'right' }} className="muted">&gt;95%</td>
                      </tr>
                      <tr>
                        <td>Waktu Respon Rata-rata</td>
                        <td style={{ textAlign: 'right' }}>{formatDurasi(laporan.layanan.chat.waktu_respon_detik)}</td>
                        <td style={{ textAlign: 'right' }} className="muted">&lt;1 jam</td>
                      </tr>
                      <tr>
                        <td>CSAT Chat</td>
                        <td style={{ textAlign: 'right' }}>{formatPercent(laporan.layanan.chat.csat)}</td>
                        <td style={{ textAlign: 'right' }} className="muted">&gt;85%</td>
                      </tr>
                      <tr>
                        <td>
                          Konversi dari Chat Dibalas
                          <div className="muted" style={{ fontSize: 11 }}>
                            {formatCount(laporan.layanan.chat.total_pesanan)} pesanan · {formatIDR(laporan.layanan.chat.penjualan)}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatPercent(laporan.layanan.chat.konversi_chat_dibalas)}</td>
                        <td style={{ textAlign: 'right' }} className="muted">&gt;20%</td>
                      </tr>
                    </tbody>
                  </table>
                  {laporan.layanan.chat.baris_sumber > 1 && (
                    <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                      Dirangkum dari {laporan.layanan.chat.baris_sumber} berkas Performa Chat — waktu respon dan CSAT adalah rata-rata antar berkas.
                    </p>
                  )}
                </>
              )}

              <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
                Cancel rate dan retur belum bisa ditampilkan — data harian PDT tidak memuat kolom pembatalan maupun retur,
                dan menampilkan 0% untuk angka yang tidak diketahui akan menyesatkan.
              </p>
            </section>
          )}

          {laporan.tahap && (
            <section className="card">
              <h2>Tahap (Buyer Journey)</h2>
              <CatatanInternal>
                Belum lengkap — sebagian angka Awareness (impresi/views campaign, follower berbayar) dan Add-to-Cart
                belum dipanen ke fakta, jadi ditandai &quot;—&quot; di bawah, BUKAN nol aktivitas. Impresi, klik dan CTR
                showcase sudah terisi dari TikTok Ads Manager.
              </CatatanInternal>
              <table style={{ marginTop: 8, width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Funnel</th>
                    <th style={{ textAlign: 'right' }}>Nilai</th>
                    <th style={{ textAlign: 'right' }}>Lolos dari sebelumnya</th>
                  </tr>
                </thead>
                <tbody>
                  {laporan.tahap.funnel.map((f) => (
                    <tr key={f.kode}>
                      <td>{f.label}</td>
                      <td style={{ textAlign: 'right' }}>{f.nilai === null ? '—' : formatCount(f.nilai)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {f.lolos === null ? (f.catatan ?? '—') : `${formatPercent(f.lolos)} dari ${f.lolos_dari}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                Conversion rate toko (Σpesanan÷Σpengunjung): {formatPercent(laporan.tahap.konversi_total.nilai)}
                {laporan.tahap.belanja_total !== null && ` — Total belanja iklan: ${formatIDR(laporan.tahap.belanja_total)}`}
              </p>
              {laporan.tahap.blok.map((b) => (
                <div key={b.kode} style={{ marginTop: 16 }}>
                  <h3 style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {b.label}
                    {b.fokus && <span className="badge badge-green">Fokus</span>}
                    {b.belanja !== null && (
                      <span className="muted" style={{ fontSize: 12, fontWeight: 'normal' }}>
                        {formatIDR(b.belanja)} ({formatPercent(b.belanja_persen)} dari total belanja)
                      </span>
                    )}
                  </h3>
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <tbody>
                      {b.metrik.map((m) => (
                        <tr key={m.kode}>
                          <td>{m.label}</td>
                          <td style={{ textAlign: 'right' }}>{formatTahapNilai(m.nilai, m.satuan)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          )}

          {insightDraft && (
            <section className="card">
              <h2>Insight & Rekomendasi</h2>
              <p className="muted" style={{ fontSize: 11, marginTop: -4, marginBottom: 8 }}>
                Draf mesin, bisa disunting di sini sebelum dikirim (G2-01-INSIGHT-EDIT) — angka laporan (GMV, ROAS,
                skor, tabel funnel) TIDAK bisa diubah, hanya teks di bawah ini. Ganti toko/periode akan
                menghapus suntingan yang belum dikirim.
              </p>

              <div className="field">
                <label>Ringkasan Eksekutif</label>
                <textarea rows={3} value={insightDraft.ringkasan} disabled={kirimLoading} style={{ fontSize: 13 }}
                  onChange={(e) => setInsightDraft({ ...insightDraft, ringkasan: e.target.value })} />
              </div>

              <div className="field">
                <label>Key Insights</label>
                <PoinEditor value={insightDraft.poin} disabled={kirimLoading}
                  onChange={(poin) => setInsightDraft({ ...insightDraft, poin })} />
              </div>

              <div className="field">
                <label>Rekomendasi — Prioritas Tinggi</label>
                <RekEditor value={insightDraft.rekomendasi_tinggi} disabled={kirimLoading}
                  onChange={(v) => setInsightDraft({ ...insightDraft, rekomendasi_tinggi: v })} />
              </div>

              <div className="field">
                <label>Rekomendasi — Prioritas Sedang</label>
                <RekEditor value={insightDraft.rekomendasi_sedang} disabled={kirimLoading}
                  onChange={(v) => setInsightDraft({ ...insightDraft, rekomendasi_sedang: v })} />
              </div>

              <div className="field">
                <label>Outlook Periode Berikutnya</label>
                <textarea rows={3} value={insightDraft.outlook} disabled={kirimLoading} style={{ fontSize: 13 }}
                  onChange={(e) => setInsightDraft({ ...insightDraft, outlook: e.target.value })} />
              </div>

              <div className="field">
                <label>Indikator</label>
                <IndEditor value={insightDraft.indikator} disabled={kirimLoading}
                  onChange={(v) => setInsightDraft({ ...insightDraft, indikator: v })} />
              </div>
            </section>
          )}

          <section className="card">
            <div className="cardHeader">
              <div>
                <h2>Skor</h2>
                {laporan.platform === 'tiktok' ? (
                  <p className="muted">Benchmark v{laporan.benchmark_versi ?? '—'}</p>
                ) : (
                  <p className="muted">Shopee belum punya versi benchmark numerik (nol Opens tertutup).</p>
                )}
              </div>
              {laporan.skor.label && (
                <span
                  className={`badge ${skorBadgeClass(laporan.skor.label)}`}
                  style={{ fontSize: 14, padding: '6px 12px' }}
                >
                  {laporan.skor.label}
                </span>
              )}
            </div>
            <div style={{ fontSize: 32, fontWeight: 'bold', marginBottom: 16 }}>
              {laporan.skor.total !== null ? laporan.skor.total.toFixed(1) : '—'}
            </div>

            {laporan.skor.dimensi.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <GrafikSkor
                  judul="Skor per dimensi"
                  dimensi={laporan.skor.dimensi.map((d) => ({ label: d.label, nilai: d.nilai, disertakan: d.disertakan }))}
                />
              </div>
            )}

            {laporan.skor.dimensi.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Dimensi</th>
                      <th>Nilai</th>
                      <th>Disertakan</th>
                      <th>Bobot Dasar</th>
                      <th>Bobot Efektif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laporan.skor.dimensi.map((d) => (
                      <tr key={d.kode}>
                        <td>
                          <strong>{d.label}</strong>
                          {d.label_tampil && (
                            <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                              ({d.label_tampil})
                            </span>
                          )}
                        </td>
                        <td>{d.nilai !== null ? d.nilai.toFixed(1) : '—'}</td>
                        <td>{d.disertakan ? '✓' : '—'}</td>
                        <td>{formatBobot(d.bobot_dasar)}</td>
                        <td>{formatBobot(d.bobot_efektif)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Dimensi yang datanya belum ada dikeluarkan dari skor, dan bobot dasar dimensi lain
                  dinormalisasi ulang (Rule 12) — bukan dinilai netral 5/10.
                </p>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Riwayat Pengiriman</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              Seluruh periode toko ini yang pernah dikirim ke klien, terbaru dulu (Flow B langkah 5).
            </p>
            {riwayatErr && (
              <div className="alert alertError" role="alert" style={{ marginTop: 12 }}>{riwayatErr}</div>
            )}
            {riwayat.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Belum ada laporan yang dikirim untuk toko ini.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Periode</th>
                      <th>Dikirim Pada</th>
                      <th>Dikirim Oleh</th>
                      <th>Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riwayat.map((k) => (
                      <tr key={k.id}>
                        <td>{k.periode_mulai}</td>
                        <td>{formatDateTime(k.dikirim_pada)}</td>
                        <td>{k.dikirim_oleh}</td>
                        <td>
                          {k.menggantikan_kiriman_id !== null
                            ? `Revisi — menggantikan #${k.menggantikan_kiriman_id}`
                            : 'Kiriman pertama'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
