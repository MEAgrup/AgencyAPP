'use client';

/**
 * Laporan PDT (Pusat Data Toko) — Flow B langkah 1 (PDT-21 Rule 21).
 *
 * KPI ringkas + kanal + iklan + live + video + afiliasi + tahap + skor +
 * insight per toko klien, dibaca lewat `GET /account/pdt/laporan`. v1
 * SENGAJA sempit (sembilan dari dua belas seksi mesin laporan lama — lihat
 * docblock `packages/core/src/pdt/laporan.ts`): belum ada produk/tokopedia/
 * ads_manager.
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
 * v1 SENGAJA menerima banyak `null` per metrik (funnel Impresi/ATC, hampir
 * seluruh blok Awareness/Consideration) karena TikTok Ads Manager belum
 * punya modul PDT sama sekali — halaman menampilkan catatan/"—" eksplisit,
 * BUKAN 0 yang mengarang aktivitas. Seksi disembunyikan seluruhnya saat
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage, MAX_PAGE_LIMIT } from '@/lib/api';
import { listClients, type Client } from '@/lib/clients';
import {
  getPdtLaporan,
  kirimLaporanPdt,
  riwayatKirimanPdt,
  type PdtKirimanRingkas,
  type PdtLaporan,
  type PdtLaporanInsight,
  type PdtLaporanKiriman,
  type PdtLaporanRekomendasi,
  type PdtTahapSatuan,
} from '@/lib/pdt';
import { formatIDR } from '@/lib/money';

/** Platform toko yang didukung PDT (PDT-22) — cermin `platformKeVokabPdt`. */
const PDT_PLATFORMS = new Set(['Shopee', 'TikTok Shop']);

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

  const platformOptions = useMemo(
    () => (selectedClient ? selectedClient.platforms.filter((p) => p.active && PDT_PLATFORMS.has(p.platform)) : []),
    [selectedClient],
  );

  const loadLaporan = useCallback(async () => {
    // Ganti toko/periode -> hasil kirim sebelumnya (kalau ada) sudah tidak relevan.
    setKirimErr(null);
    setKirimHasil(null);
    if (platformId === '') return;
    setLoading(true);
    setErr(null);
    try {
      const res = await getPdtLaporan(platformId, monthToPeriode(month));
      setLaporan(res);
      setInsightDraft(res.insight);
    } catch (e) {
      setLaporan(null);
      setInsightDraft(null);
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
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
              disabled={!selectedClient || platformOptions.length === 0}
              onChange={(e) => {
                setPlatformId(e.target.value === '' ? '' : Number(e.target.value));
                setLaporan(null);
                setErr(null);
              }}
            >
              <option value="">— pilih platform —</option>
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
        {selectedClient && platformOptions.length === 0 && (
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
            </div>
            {laporan.platform !== 'tiktok' && (
              <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
                GMV Shopee = basis Pesanan Siap Dikirim, TANPA potongan refund (Rule 16) — berbeda dari GMV
                TikTok Shop di atas, yang sudah bersih dari refund (Rule 15). Keduanya tidak boleh dibandingkan
                apa adanya.
              </p>
            )}
          </section>

          <section className="card">
            <h2>Kanal (Sumber GMV)</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              GMV Kotor: {formatIDR(laporan.kanal.gmv_total)}
            </p>
            {!laporan.kanal.lengkap && (
              <div className="alert alertWarning" role="status" style={{ marginTop: 8, marginBottom: 8 }}>
                Belum lengkap — {laporan.platform === 'tiktok' ? 'sumber ini' : 'Shopee Ads dan Affiliate saja'}.
                {laporan.platform !== 'tiktok' && (
                  <> Voucher, Chat, Meta Ads, dan Video belum diproses PDT — GMV dari sumber itu TIDAK berarti nol,
                  hanya belum terhitung di sini.</>
                )}
              </div>
            )}
            {laporan.kanal.gmv_total === null ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Belum ada data untuk periode ini.</p>
            ) : (
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
                {laporan.kanal.items.map((item) => (
                  <div key={item.kode}>
                    <div style={{ fontSize: 20, fontWeight: 'bold' }}>{formatIDR(item.gmv)}</div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {item.label} ({formatPercent(item.persen)})
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {laporan.iklan && (
            <section className="card">
              <h2>Iklan</h2>
              {!laporan.iklan.lengkap && (
                <div className="alert alertWarning" role="status" style={{ marginTop: 8, marginBottom: 8 }}>
                  Belum lengkap — Iklan Toko, Pencarian, dan Live saja. Banner Ads belum diproses PDT — biaya/pendapatan
                  dari sumber itu TIDAK berarti nol, hanya belum terhitung di sini.
                </div>
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

          {laporan.tahap && (
            <section className="card">
              <h2>Tahap (Buyer Journey)</h2>
              <div className="alert alertWarning" role="status" style={{ marginTop: 8, marginBottom: 8 }}>
                Belum lengkap — banyak angka Awareness/Consideration bergantung modul TikTok Ads Manager yang
                belum dibangun (ditandai "—" di bawah, BUKAN nol aktivitas).
              </div>
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
