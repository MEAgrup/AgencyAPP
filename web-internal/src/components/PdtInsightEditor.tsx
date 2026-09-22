'use client';

/**
 * Editor narasi + publikasi satu kiriman PDT (M20 Gelombang C, C-04).
 *
 * Port `InsightEditor.tsx` (mesin lama M14, `@/components/clients/`) ke bentuk
 * PDT: TUJUH field bisa disunting (enam sama persis mesin lama + `tahap_narasi`
 * baru, khusus C-02), sama idiom simpan/reset/terbitkan/cabut, sama gate
 * "Simpan" vs "Terbitkan" (menyimpan menambah revisi tanpa memindahkan apa yang
 * klien baca; hanya Terbitkan/Terbitkan Ulang memindahkan paku `insight_revisi`
 * — lihat docblock `terbitkanKiriman`/`terbitkanUlangKiriman`, `packages/domain/
 * src/pdt.ts`).
 *
 * ## Yang bisa disunting di sini, dan yang tidak
 *
 * Angka laporan (GMV, ROAS, skor, tabel funnel) beku di `pdt_laporan_kiriman.
 * laporan` sejak "Kirim ke Klien" ditekan — editor ini TIDAK menyentuhnya sama
 * sekali, hanya `ringkasan`/`poin`/`rekomendasi_tinggi`/`rekomendasi_sedang`/
 * `outlook`/`indikator`/`tahap_narasi` di `pdt_laporan_insight` (append-only,
 * revisi baru per simpan).
 *
 * ## Kenapa `badge-green`/`badge-red`/`badge-gray`, bukan `badgeSuccess`/dst
 *
 * `InsightEditor.tsx` (mesin lama) memakai kelas `badgeSuccess`/`badgeDanger`/
 * `badgeWarning` yang TIDAK PERNAH distyle di `globals.css` (lihat catatan di
 * `@/lib/skuscreener-ui.ts`) — bug yang tidak disalin ke sini. Halaman PDT
 * sendiri sudah memakai `badge-green`/`badge-amber`/`badge-red`/`badge-gray`
 * (`skorBadgeClass` di halaman laporan), jadi editor ini memakai keluarga yang
 * sama.
 */
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import {
  bacaInsightKiriman,
  cabutKiriman,
  resetInsightKiriman,
  simpanInsightKiriman,
  terbitkanKiriman,
  terbitkanUlangKiriman,
  type PdtInsightEditDraft,
  type PdtInsightState,
  type PdtLaporanInsightRow,
  type PdtLaporanRekomendasi,
} from '@/lib/pdt';

/**
 * Cermin `MSG_ALASAN_CABUT_WAJIB` (`packages/domain/src/pdt.ts`) — dipakai
 * HANYA sebagai gerbang UX di sini (menahan submit sebelum satu request pun
 * terkirim). Server tetap satu-satunya penegak; kalau dua string ini
 * berbeda suatu saat, pesan SERVER yang benar (lihat `errorMessage(e)` di
 * bawah), bukan konstanta ini.
 */
const MSG_ALASAN_CABUT_WAJIB = '[alasan pencabutan wajib diisi]';

const REK_KOSONG: PdtLaporanRekomendasi = { judul: '', target: '', dampak: '', timeline: '' };
const IND_KOSONG = { nama: '', target: '' };

/** Bentuk draf editor — tujuh field, semua string/array konkret (bukan opsional) supaya kontrol form selalu terkontrol. */
export interface PdtInsightDraft {
  ringkasan: string;
  poin: string[];
  rekomendasi_tinggi: PdtLaporanRekomendasi[];
  rekomendasi_sedang: PdtLaporanRekomendasi[];
  outlook: string;
  indikator: { nama: string; target: string }[];
  tahap_narasi: string;
}

/** Revisi `terbaru` (server) → draf editor. `tahap_narasi` `null` → `''` (textarea kosong). */
export function draftFromRow(row: PdtLaporanInsightRow): PdtInsightDraft {
  return {
    ringkasan: row.ringkasan,
    poin: row.poin,
    rekomendasi_tinggi: row.rekomendasi_tinggi,
    rekomendasi_sedang: row.rekomendasi_sedang,
    outlook: row.outlook,
    indikator: row.indikator,
    tahap_narasi: row.tahap_narasi ?? '',
  };
}

/** Draf editor → body `PUT .../insight`. Dikirim apa adanya — server (`pdt.normalizePdtInsightDraft`/`normTahapNarasi`) yang memvalidasi dan membuang baris kosong. */
export function draftToPayload(d: PdtInsightDraft): PdtInsightEditDraft {
  return {
    ringkasan: d.ringkasan,
    poin: d.poin,
    rekomendasi_tinggi: d.rekomendasi_tinggi,
    rekomendasi_sedang: d.rekomendasi_sedang,
    outlook: d.outlook,
    indikator: d.indikator,
    tahap_narasi: d.tahap_narasi,
  };
}

function statusBadgeClass(status: string): string {
  if (status === '[Terbit]') return 'badge badge-green';
  if (status === '[Dicabut]') return 'badge badge-red';
  return 'badge badge-gray';
}

function formatWaktu(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID');
}

/** Daftar string (Key Insights) — baris kosong terakhir selalu ada supaya AM selalu punya tempat mengetik. */
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

/** Daftar rekomendasi — judul/target/dampak/timeline per baris. */
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
        <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: 8 }}>
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

/** Daftar indikator (nama + target). */
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

export default function PdtInsightEditor({ kirimanId, onPublikasiChange }: {
  kirimanId: number;
  /** Lets the parent table refresh its own state (e.g. a status column) without a full page reload. */
  onPublikasiChange?: () => void;
}) {
  const [state, setState] = useState<PdtInsightState | null>(null);
  const [draft, setDraft] = useState<PdtInsightDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const s = await bacaInsightKiriman(kirimanId);
      setState(s);
      // Editor SELALU dibuka di revisi TERBARU — itulah yang akan dikirim
      // kalau "Simpan" ditekan, jadi ini satu-satunya isi yang jujur.
      setDraft(draftFromRow(s.terbaru));
    } catch (e) {
      setLoadErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [kirimanId]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (fn: () => Promise<unknown>, pesan: string) => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await fn();
      await load();
      setInfo(pesan);
      onPublikasiChange?.();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [load, onPublikasiChange]);

  if (loadErr && !state) {
    return (
      <div className="alert alertError" style={{ fontSize: 13 }}>
        <div>Insight kiriman gagal dimuat: {loadErr}</div>
        <button
          type="button"
          className="btn btnGhost btnSm"
          style={{ marginTop: 8 }}
          onClick={() => void load()}
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (loading || !state || !draft) {
    return <div className="muted" style={{ fontSize: 13 }}>Memuat insight…</div>;
  }

  const pub = state.publikasi;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={statusBadgeClass(pub.status)}>{pub.status}</span>
        {pub.diterbitkan_pada && (
          <span className="muted" style={{ fontSize: 12 }}>
            Diterbitkan {formatWaktu(pub.diterbitkan_pada)} oleh {pub.diterbitkan_oleh}
          </span>
        )}
      </div>

      {pub.status === '[Dicabut]' && pub.alasan_cabut && (
        <div className="alert alertWarning" style={{ fontSize: 13 }}>Dicabut: {pub.alasan_cabut}</div>
      )}

      {err && <div className="alert alertError" style={{ fontSize: 13 }}>{err}</div>}
      {info && <div className="alert alertSuccess" style={{ fontSize: 13 }}>{info}</div>}

      <p className="muted" style={{ fontSize: 12 }}>
        Hanya narasi yang bisa disunting di sini — GMV, ROAS, skor, dan tabel funnel sudah beku
        sejak kiriman ini dibuat dan tidak bisa diubah lewat editor ini.
      </p>

      <div className="field">
        <label>Ringkasan Eksekutif</label>
        <textarea rows={3} value={draft.ringkasan} disabled={busy}
          onChange={(e) => setDraft({ ...draft, ringkasan: e.target.value })} style={{ fontSize: 13 }} />
      </div>

      <div className="field">
        <label>Key Insights</label>
        <PoinEditor value={draft.poin} disabled={busy}
          onChange={(poin) => setDraft({ ...draft, poin })} />
      </div>

      <div className="field">
        <label>Rekomendasi Prioritas Tinggi</label>
        <RekEditor value={draft.rekomendasi_tinggi} disabled={busy}
          onChange={(v) => setDraft({ ...draft, rekomendasi_tinggi: v })} />
      </div>

      <div className="field">
        <label>Rekomendasi Prioritas Sedang</label>
        <RekEditor value={draft.rekomendasi_sedang} disabled={busy}
          onChange={(v) => setDraft({ ...draft, rekomendasi_sedang: v })} />
      </div>

      <div className="field">
        <label>Outlook Periode Berikutnya</label>
        <textarea rows={3} value={draft.outlook} disabled={busy}
          onChange={(e) => setDraft({ ...draft, outlook: e.target.value })} style={{ fontSize: 13 }} />
      </div>

      <div className="field">
        <label>Indikator</label>
        <IndEditor value={draft.indikator} disabled={busy}
          onChange={(v) => setDraft({ ...draft, indikator: v })} />
      </div>

      <div className="field">
        <label>Narasi Tahap (opsional)</label>
        <textarea rows={3} value={draft.tahap_narasi} disabled={busy}
          placeholder="Kosongkan bila tidak perlu catatan tahap"
          onChange={(e) => setDraft({ ...draft, tahap_narasi: e.target.value })} style={{ fontSize: 13 }} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btnPrimary btnSm"
          disabled={busy}
          onClick={() => void run(
            () => simpanInsightKiriman(kirimanId, draftToPayload(draft)),
            'Draf insight disimpan sebagai revisi baru.',
          )}
        >
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>

        <button
          type="button"
          className="btn btnGhost btnSm"
          disabled={busy}
          title="Menyalin narasi mesin sebagai revisi baru; suntingan sebelumnya tetap tersimpan di riwayat"
          onClick={() => void run(() => resetInsightKiriman(kirimanId), 'Dikembalikan ke narasi mesin.')}
        >
          Reset ke narasi mesin
        </button>

        {pub.status === '[Draf]' && (
          <button
            type="button"
            className="btn btnPrimary btnSm"
            disabled={busy}
            onClick={() => void run(() => terbitkanKiriman(kirimanId), 'Laporan diterbitkan ke klien.')}
          >
            Terbitkan
          </button>
        )}

        {pub.status === '[Terbit]' && (
          <button
            type="button"
            className="btn btnGhost btnSm"
            disabled={busy}
            onClick={() => {
              const alasan = window.prompt('Alasan pencabutan (wajib):');
              if (alasan === null) return;
              if (!alasan.trim()) {
                setErr(MSG_ALASAN_CABUT_WAJIB);
                return;
              }
              void run(() => cabutKiriman(kirimanId, alasan), 'Laporan dicabut dari klien.');
            }}
          >
            Cabut
          </button>
        )}

        {pub.status === '[Dicabut]' && (
          <button
            type="button"
            className="btn btnPrimary btnSm"
            disabled={busy}
            onClick={() => void run(() => terbitkanUlangKiriman(kirimanId), 'Laporan diterbitkan ulang ke klien.')}
          >
            Terbitkan Ulang
          </button>
        )}
      </div>
    </div>
  );
}
