'use client';

/**
 * A-13 — Section G (Kalender & Fase): G-0 read-only, G-1, G-2, G-3, G-4.
 *
 * **G-0 is displayed, not edited, and that is Rule 17.** The cycle start is set
 * once and cannot move after Plan period 1 closes, so it does not belong on an
 * autosaving screen next to four fields that change freely — an autosave that
 * carried G-0 along would be a Rule 17 violation nobody typed on purpose. It has
 * its own header endpoint; this section shows the value and says why.
 *
 * **G-3/G-4 frequency is a text input, not a dropdown.** §4 marks both `Struct`,
 * not `Enum`, and the PRD never writes a frequency vocabulary. A dropdown here
 * would invent one and then quietly force every contract into it.
 */

import RepeatList from './RepeatList';
import type { StrategiDetail } from '@/lib/strategi';

export interface FaseDraft {
  nama: string;
  tanggal_mulai: string;
  tanggal_akhir: string;
  tujuan: string;
  kriteria_lulus: string;
}

export interface TanggalBesarDraft {
  tanggal: string;
  nama: string;
  peran: string;
}

export interface KalenderDraft {
  fase: FaseDraft[];
  tanggal_besar: TanggalBesarDraft[];
  review_klien_frekuensi: string;
  review_klien_format: string;
  review_klien_pic: string;
  review_internal_frekuensi: string;
}

export function kalenderDraftOf(d: StrategiDetail): KalenderDraft {
  return {
    fase: d.fase.map((f) => ({
      nama: f.nama,
      tanggal_mulai: f.tanggal_mulai,
      tanggal_akhir: f.tanggal_akhir,
      tujuan: f.tujuan,
      kriteria_lulus: f.kriteria_lulus,
    })),
    tanggal_besar: d.tanggal_besar.map((t) => ({
      tanggal: t.tanggal,
      nama: t.nama,
      peran: t.peran,
    })),
    review_klien_frekuensi: d.review_klien_frekuensi ?? '',
    review_klien_format: d.review_klien_format ?? '',
    review_klien_pic: d.review_klien_pic ?? '',
    review_internal_frekuensi: d.review_internal_frekuensi ?? '',
  };
}

export default function SectionG({
  detail,
  draft,
  onChange,
  disabled,
}: {
  detail: StrategiDetail;
  draft: KalenderDraft;
  onChange: (patch: Partial<KalenderDraft>) => void;
  disabled: boolean;
}) {
  return (
    <div className="stack">
      <div className="card">
        <div className="cardHeader">G-0 · Tanggal mulai siklus Plan</div>
        <p style={{ margin: '4px 0', fontSize: 15 }}>
          {detail.tanggal_mulai_siklus ?? <span className="muted">belum diset</span>}
          {detail.siklus_terkunci && (
            <span className="badge badge-gray" style={{ marginLeft: 8 }}>
              terkunci
            </span>
          )}
        </p>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Dasar periode anniversary-month. Diset sekali di header Strategi dan tidak bisa
          diubah setelah periode Plan pertama tutup (Rule 17) — karena itu ia tidak ikut
          autosave halaman ini.
        </p>
      </div>

      <RepeatList<FaseDraft>
        label="G-1 · Fase kerja"
        hint="Nama fase, rentang tanggal, tujuan, dan kriteria lulusnya. Minimal dua — satu fase bukan sebuah kalender."
        rows={draft.fase}
        min={2}
        onChange={(fase) => onChange({ fase })}
        blank={() => ({ nama: '', tanggal_mulai: '', tanggal_akhir: '', tujuan: '', kriteria_lulus: '' })}
        disabled={disabled}
        addLabel="Tambah fase"
        empty="Belum ada fase kerja."
      >
        {(row, set) => (
          <>
            <input
              placeholder="Nama fase — mis. Fase 1: perbaikan listing"
              value={row.nama}
              disabled={disabled}
              onChange={(e) => set({ nama: e.target.value })}
            />
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Mulai</span>
                <input
                  type="date"
                  value={row.tanggal_mulai}
                  disabled={disabled}
                  onChange={(e) => set({ tanggal_mulai: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Akhir</span>
                <input
                  type="date"
                  value={row.tanggal_akhir}
                  disabled={disabled}
                  onChange={(e) => set({ tanggal_akhir: e.target.value })}
                />
              </label>
            </div>
            <textarea
              rows={2}
              placeholder="Tujuan fase"
              value={row.tujuan}
              disabled={disabled}
              onChange={(e) => set({ tujuan: e.target.value })}
            />
            <textarea
              rows={2}
              placeholder="Kriteria lulus — angka yang menentukan fase ini selesai"
              value={row.kriteria_lulus}
              disabled={disabled}
              onChange={(e) => set({ kriteria_lulus: e.target.value })}
            />
          </>
        )}
      </RepeatList>

      <RepeatList<TanggalBesarDraft>
        label="G-2 · Tanggal besar"
        hint="Double date, payday, Ramadan/Lebaran, Harbolnas, campaign platform — dan peran tiap tanggal. Plan bulanan memakai ini untuk memberatkan minggu yang memuatnya."
        rows={draft.tanggal_besar}
        min={1}
        onChange={(tanggal_besar) => onChange({ tanggal_besar })}
        blank={() => ({ tanggal: '', nama: '', peran: '' })}
        disabled={disabled}
        addLabel="Tambah tanggal"
        empty="Belum ada tanggal besar."
      >
        {(row, set) => (
          <>
            <div className="formRow">
              <label className="field">
                <span className="muted" style={{ fontSize: 12 }}>Tanggal</span>
                <input
                  type="date"
                  value={row.tanggal}
                  disabled={disabled}
                  onChange={(e) => set({ tanggal: e.target.value })}
                />
              </label>
              <label className="field" style={{ flex: 2 }}>
                <span className="muted" style={{ fontSize: 12 }}>Nama</span>
                <input
                  placeholder="mis. 9.9"
                  value={row.nama}
                  disabled={disabled}
                  onChange={(e) => set({ nama: e.target.value })}
                />
              </label>
            </div>
            <input
              placeholder="Peran tanggal ini — mis. puncak penjualan, stok & voucher disiapkan H-14"
              value={row.peran}
              disabled={disabled}
              onChange={(e) => set({ peran: e.target.value })}
            />
          </>
        )}
      </RepeatList>

      <div className="field" style={{ display: 'block' }}>
        <label style={{ fontWeight: 600 }}>G-3 · Jadwal review dengan klien</label>
        <div className="formRow">
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Frekuensi</span>
            <input
              placeholder="mis. bulanan"
              value={draft.review_klien_frekuensi}
              disabled={disabled}
              onChange={(e) => onChange({ review_klien_frekuensi: e.target.value })}
            />
          </label>
          <label className="field" style={{ flex: 2 }}>
            <span className="muted" style={{ fontSize: 12 }}>Format laporan</span>
            <input
              value={draft.review_klien_format}
              disabled={disabled}
              onChange={(e) => onChange({ review_klien_format: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>PIC</span>
            <input
              value={draft.review_klien_pic}
              disabled={disabled}
              onChange={(e) => onChange({ review_klien_pic: e.target.value })}
            />
          </label>
        </div>
      </div>

      <label className="field" style={{ display: 'block' }}>
        <span style={{ fontWeight: 600 }}>G-4 · Frekuensi review internal SPV</span>
        <input
          placeholder="mis. mingguan"
          value={draft.review_internal_frekuensi}
          disabled={disabled}
          onChange={(e) => onChange({ review_internal_frekuensi: e.target.value })}
        />
      </label>
    </div>
  );
}
