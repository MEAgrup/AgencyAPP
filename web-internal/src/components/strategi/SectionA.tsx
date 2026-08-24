'use client';

/**
 * A-13b — Section A (Konteks Klien & Bisnis), the account context the rest of
 * the Strategi hangs off.
 *
 * Saved via two endpoints:
 *   1. `saveStrategiKonteks` — the scalar/array header fields (A-1…A-14).
 *   2. `saveStrategiAkses`   — the A-15/A-16 access matrix (one row per
 *      channel × akses type).
 *
 * **A-10 and A-13 are internal-only.**  A-10 is §4.1 HARD-INTERNAL and must
 * never reach a client-facing view; A-13 (SLA) defaults Internal in the
 * visibility map but may be toggled by the AM. Both get a badge here so the
 * form itself signals why those fields won't appear in the client link.
 *
 * **A-11/A-14 are O58 "asked, no answer" fields.** An empty list is not the
 * same as a confirmed "none" — an empty list just means the AM has not answered
 * yet. The form offers a "tidak ada" checkbox as the explicit way to answer
 * "none exists". The submit gate (`checkCompleteness`) reads the flag, not the
 * list length.
 *
 * **A-1, A-5, A-8, A-10, A-12 are READ-ONLY here (QA §3.A 2026-08-20).** They
 * moved to the Interview form; Strategi shows them read-only from the inherited
 * values (`inherited`, derived from `getStrategiPrefill`) and no longer gates
 * them. The AM edits them in the Interview, not here. A-14 (aset) deliberately
 * stayed the editable checklist below — the owner kept it in Strategi.
 */

import type { ReactNode } from 'react';
import RepeatList from './RepeatList';
import {
  ACCESS_KINDS,
  ACCESS_STATES,
  BUSINESS_MODELS,
  PRICE_POSITIONS,
  STOCK_CAPACITIES,
  type AccessChannel,
  type AccessKind,
  type AccessState,
  type BusinessModel,
  type ClientAsset,
  type InheritedKonteks,
  type PricePosition,
  type StockCapacity,
  type StrategiAkses,
  type StrategiAksesBody,
  type StrategiDecisionMaker,
  type StrategiDetail,
  type StrategiKonteksBody,
} from '@/lib/strategi';

// ---- Draft type -----------------------------------------------------------

export interface DecisionMakerDraft {
  nama: string;
  jabatan: string;
  berhak_approve: boolean;
  jalur_eskalasi: string;
}

export interface AksesDraft {
  channel: AccessChannel;
  akses: AccessKind;
  status: AccessState;
  memblokir: boolean;
  target_tanggal_beres: string;
  catatan: string;
}

export interface KonteksDraft {
  nama_brand: string;
  kategori_utama: string;
  sub_kategori: string[];
  model_bisnis: BusinessModel | '';
  margin_kotor_persen: string;
  posisi_harga: PricePosition | '';
  usp: string[];
  kapasitas_stok: StockCapacity | '';
  lead_time_restock_hari: string;
  titik_kirim_kota: string;
  titik_kirim_detail: string;
  ekspektasi_klien: string;
  riwayat_agensi: string;
  pantangan_klien: string[];
  pantangan_klien_tidak_ada: boolean;
  decision_maker: DecisionMakerDraft[];
  sla_klien_jam: string;
  sla_klien_catatan: string;
  aset_dari_klien: ClientAsset[];
  aset_dari_klien_tidak_ada: boolean;
  aset_catatan: string;
  akses: AksesDraft[];
}

// ---- Draft constructors ---------------------------------------------------

function aksesFromRow(a: StrategiAkses): AksesDraft {
  return {
    channel: a.channel as AccessChannel,
    akses: a.akses as AccessKind,
    status: a.status as AccessState,
    memblokir: a.memblokir,
    target_tanggal_beres: a.target_tanggal_beres ?? '',
    catatan: a.catatan,
  };
}

function dmFromRow(d: StrategiDecisionMaker): DecisionMakerDraft {
  return {
    nama: d.nama,
    jabatan: d.jabatan,
    berhak_approve: d.berhak_approve,
    jalur_eskalasi: d.jalur_eskalasi,
  };
}

export function konteksDraftOf(d: StrategiDetail): KonteksDraft {
  return {
    nama_brand: d.nama_brand ?? '',
    kategori_utama: d.kategori_utama ?? '',
    sub_kategori: d.sub_kategori,
    model_bisnis: (d.model_bisnis as BusinessModel | null) ?? '',
    margin_kotor_persen: d.margin_kotor_persen !== null ? String(d.margin_kotor_persen) : '',
    posisi_harga: (d.posisi_harga as PricePosition | null) ?? '',
    usp: d.usp,
    kapasitas_stok: (d.kapasitas_stok as StockCapacity | null) ?? '',
    lead_time_restock_hari:
      d.lead_time_restock_hari !== null ? String(d.lead_time_restock_hari) : '',
    titik_kirim_kota: d.titik_kirim_kota ?? '',
    titik_kirim_detail: d.titik_kirim_detail ?? '',
    ekspektasi_klien: d.ekspektasi_klien ?? '',
    riwayat_agensi: d.riwayat_agensi ?? '',
    pantangan_klien: d.pantangan_klien,
    pantangan_klien_tidak_ada: d.pantangan_klien_tidak_ada,
    decision_maker: d.decision_maker.map(dmFromRow),
    sla_klien_jam: d.sla_klien_jam !== null ? String(d.sla_klien_jam) : '',
    sla_klien_catatan: d.sla_klien_catatan ?? '',
    aset_dari_klien: d.aset_dari_klien as ClientAsset[],
    aset_dari_klien_tidak_ada: d.aset_dari_klien_tidak_ada,
    aset_catatan: d.aset_catatan ?? '',
    akses: d.akses.map(aksesFromRow),
  };
}

// ---- API payload converters (used by page.tsx saveActive 'A') ----------------

function numOrNull(s: string): number | null {
  const t = s.trim();
  return t === '' ? null : Number(t);
}

export function konteksDraftToBody(draft: KonteksDraft): StrategiKonteksBody {
  return {
    nama_brand: draft.nama_brand || null,
    kategori_utama: draft.kategori_utama || null,
    sub_kategori: draft.sub_kategori,
    model_bisnis: (draft.model_bisnis as BusinessModel) || null,
    margin_kotor_persen: numOrNull(draft.margin_kotor_persen),
    posisi_harga: (draft.posisi_harga as PricePosition) || null,
    usp: draft.usp.filter(Boolean),
    kapasitas_stok: (draft.kapasitas_stok as StockCapacity) || null,
    lead_time_restock_hari: numOrNull(draft.lead_time_restock_hari),
    // A-7 (plafon) retired — see DECISIONS.md 2026-08-20. Sent as null so any
    // legacy value is cleared on the next save; the DB column stays nullable.
    plafon_unit_per_bulan: null,
    titik_kirim_kota: draft.titik_kirim_kota || null,
    titik_kirim_detail: draft.titik_kirim_detail || null,
    ekspektasi_klien: draft.ekspektasi_klien || null,
    riwayat_agensi: draft.riwayat_agensi || null,
    pantangan_klien: draft.pantangan_klien,
    pantangan_klien_tidak_ada: draft.pantangan_klien_tidak_ada,
    decision_maker: draft.decision_maker,
    sla_klien_jam: numOrNull(draft.sla_klien_jam),
    sla_klien_catatan: draft.sla_klien_catatan || null,
    aset_dari_klien: draft.aset_dari_klien,
    aset_dari_klien_tidak_ada: draft.aset_dari_klien_tidak_ada,
    aset_catatan: draft.aset_catatan || null,
  };
}

export function aksesDraftToBody(akses: AksesDraft[]): StrategiAksesBody[] {
  return akses.map((a) => ({
    channel: a.channel,
    akses: a.akses,
    status: a.status,
    memblokir: a.memblokir,
    target_tanggal_beres: a.target_tanggal_beres || null,
    catatan: a.catatan,
  }));
}

// ---- Labels ---------------------------------------------------------------

const BUSINESS_MODEL_LABELS: Record<BusinessModel, string> = {
  produsen: 'Produsen',
  brand_owner: 'Brand Owner',
  distributor: 'Distributor',
  reseller: 'Reseller',
};

const PRICE_POSITION_LABELS: Record<PricePosition, string> = {
  premium: 'Premium',
  mid: 'Mid-range',
  budget: 'Budget',
  price_fighter: 'Price fighter',
};

const STOCK_CAPACITY_LABELS: Record<StockCapacity, string> = {
  ready_stock: 'Ready stock',
  produksi_per_order: 'Produksi per order',
};

const CLIENT_ASSET_LABELS: Record<ClientAsset, string> = {
  foto_produk: 'Foto produk',
  video: 'Video',
  sampel: 'Sampel',
  katalog: 'Katalog',
  budget_iklan: 'Budget iklan',
  host_live: 'Host live',
};

const ACCESS_KIND_LABELS: Record<AccessKind, string> = {
  seller_center: 'Seller Center',
  ads_manager: 'Ads Manager',
  affiliate_center: 'Affiliate Center',
  akun_chat: 'Akun chat',
  gudang_stok: 'Gudang/stok',
};

const ACCESS_STATE_LABELS: Record<AccessState, string> = {
  sudah: 'Sudah',
  pending: 'Pending',
  ditolak: 'Ditolak',
  tidak_butuh: 'Tidak butuh akses',
};

// ---- Component ------------------------------------------------------------

/**
 * One read-only Section A field, mirrored from the Interview. Shows the inherited
 * value (or a stored legacy value as fallback), or a muted "isi di Interview"
 * prompt when neither exists. `badge` carries A-10's hard-internal marker.
 */
function InterviewMirror({
  title,
  value,
  badge,
}: {
  title: ReactNode;
  value: string | null;
  badge?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="cardHeader" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{title}</span>
        {badge}
        <span style={{ flex: 1 }} />
        <span className="badge badge-gray" style={{ fontWeight: 400 }}>dari Interview</span>
      </div>
      {value && value.trim() !== '' ? (
        <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 14 }}>{value}</p>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
          Belum diisi — isi di modul Interview (lihat panel &ldquo;Dari Interview&rdquo; di atas).
        </p>
      )}
    </div>
  );
}

export default function SectionA({
  detail,
  draft,
  inherited,
  onChange,
  disabled,
}: {
  detail: StrategiDetail;
  draft: KonteksDraft;
  /** Read-only A-1/A-5/A-8/A-10/A-12 values inherited from the Interview (§3.A). */
  inherited: InheritedKonteks;
  onChange: (patch: Partial<KonteksDraft>) => void;
  disabled: boolean;
}) {
  // Legacy Strategi rows filled Section A before the fields moved; fall back to the
  // stored value so their content still shows read-only when no interview supplies it.
  const brand = inherited.namaBrand ?? (draft.nama_brand || null);
  const kategori = inherited.kategori ?? (draft.kategori_utama || null);
  const uspText = inherited.usp ?? (draft.usp.filter(Boolean).join('\n') || null);
  const titikKirim = inherited.titikKirim ?? (draft.titik_kirim_kota || null);
  const riwayat = inherited.riwayatAgensi ?? (draft.riwayat_agensi || null);
  const decisionMaker =
    inherited.decisionMaker ??
    (draft.decision_maker
      .map((d) => [d.nama, d.jabatan].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('; ') || null);
  // Channels that appear in the contract — the access matrix axis.
  const contractChannels = detail.channels.map((c) => c.channel);

  const toggleAsset = (v: ClientAsset) => {
    if (draft.aset_dari_klien_tidak_ada) return;
    const has = draft.aset_dari_klien.includes(v);
    onChange({
      aset_dari_klien: has
        ? draft.aset_dari_klien.filter((x) => x !== v)
        : [...draft.aset_dari_klien, v],
    });
  };

  const setAksesRow = (i: number, patch: Partial<AksesDraft>) => {
    onChange({ akses: draft.akses.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  };

  // Find or create an access row for a given (channel, akses) pair.
  const aksesFor = (channel: string, akses: string): AksesDraft | undefined =>
    draft.akses.find((r) => r.channel === channel && r.akses === akses);

  const setAksesCell = (
    channel: AccessChannel,
    akses: AccessKind,
    status: AccessState,
    memblokir: boolean,
    target_tanggal_beres: string,
    catatan: string,
  ) => {
    const existing = draft.akses.findIndex((r) => r.channel === channel && r.akses === akses);
    if (existing >= 0) {
      setAksesRow(existing, { status, memblokir, target_tanggal_beres, catatan });
    } else {
      onChange({
        akses: [...draft.akses, { channel, akses, status, memblokir, target_tanggal_beres, catatan }],
      });
    }
  };

  return (
    <div className="stack">
      {/* A-1 (read-only, dari Interview + kategori dari data klien) --------- */}
      <InterviewMirror
        title="A-1 · Brand & Kategori"
        value={
          brand || kategori
            ? [brand ? `Brand: ${brand}` : null, kategori ? `Kategori: ${kategori}` : null]
                .filter(Boolean)
                .join('\n')
            : null
        }
      />

      {/* A-2/A-4 ----------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">A-2 / A-4 · Model Bisnis &amp; Posisi Harga</div>
        <div className="formRow">
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Model bisnis (A-2)</span>
            <select
              value={draft.model_bisnis}
              disabled={disabled}
              onChange={(e) => onChange({ model_bisnis: e.target.value as BusinessModel })}
            >
              <option value="">— pilih —</option>
              {BUSINESS_MODELS.map((v) => (
                <option key={v} value={v}>{BUSINESS_MODEL_LABELS[v]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Posisi harga vs kompetitor (A-4)</span>
            <select
              value={draft.posisi_harga}
              disabled={disabled}
              onChange={(e) => onChange({ posisi_harga: e.target.value as PricePosition })}
            >
              <option value="">— pilih —</option>
              {PRICE_POSITIONS.map((v) => (
                <option key={v} value={v}>{PRICE_POSITION_LABELS[v]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* A-3 --------------------------------------------------------------- */}
      <label className="field" style={{ display: 'block' }}>
        <span style={{ fontWeight: 600 }}>
          A-3 · Ruang Margin <span className="badge badge-amber">Internal saja</span>
        </span>
        <span className="muted" style={{ fontSize: 12, display: 'block' }}>
          Margin kotor rata-rata hero SKU (%). Hanya terlihat internal.
        </span>
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={draft.margin_kotor_persen}
          disabled={disabled}
          onChange={(e) => onChange({ margin_kotor_persen: e.target.value })}
          style={{ width: 120 }}
        />
      </label>

      {/* A-5 (read-only, dari Interview) ----------------------------------- */}
      <InterviewMirror title="A-5 · USP Produk" value={uspText} />

      {/* A-6 --------------------------------------------------------------- */}
      {/* A-7 (plafon unit/bulan) retired — see DECISIONS.md 2026-08-20. */}
      <div className="card">
        <div className="cardHeader">A-6 · Kapasitas Stok</div>
        <div className="formRow">
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Kapasitas stok (A-6)</span>
            <select
              value={draft.kapasitas_stok}
              disabled={disabled}
              onChange={(e) => onChange({ kapasitas_stok: e.target.value as StockCapacity })}
            >
              <option value="">— pilih —</option>
              {STOCK_CAPACITIES.map((v) => (
                <option key={v} value={v}>{STOCK_CAPACITY_LABELS[v]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Lead time restock (hari)</span>
            <input
              type="number"
              min={0}
              value={draft.lead_time_restock_hari}
              disabled={disabled}
              onChange={(e) => onChange({ lead_time_restock_hari: e.target.value })}
              style={{ width: 100 }}
            />
          </label>
        </div>
      </div>

      {/* A-8 (read-only, dari Interview — fulfillment) --------------------- */}
      <InterviewMirror title="A-8 · Titik Kirim (kota gudang / origin)" value={titikKirim} />

      {/* A-9 --------------------------------------------------------------- */}
      <label className="field" style={{ display: 'block' }}>
        <span style={{ fontWeight: 600 }}>A-9 · Ekspektasi Klien</span>
        <span className="muted" style={{ fontSize: 12, display: 'block' }}>
          Definisi sukses menurut klien — catat verbatim dari kickoff.
        </span>
        <textarea
          rows={3}
          value={draft.ekspektasi_klien}
          disabled={disabled}
          onChange={(e) => onChange({ ekspektasi_klien: e.target.value })}
        />
      </label>

      {/* A-10 (read-only, dari Interview — hard-internal) ------------------ */}
      <InterviewMirror
        title="A-10 · Riwayat Agensi"
        badge={<span className="badge badge-red">Hard-internal</span>}
        value={riwayat}
      />

      {/* A-11 -------------------------------------------------------------- */}
      <div className="field" style={{ display: 'block' }}>
        <label style={{ fontWeight: 600 }}>A-11 · Pantangan Klien</label>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          Larangan eksplisit: harga tidak boleh turun, KOL tertentu dilarang, klaim yang
          tidak boleh dipakai, brand guideline. Wajib dijawab — isi daftar atau centang
          &ldquo;tidak ada&rdquo;.
        </p>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={draft.pantangan_klien_tidak_ada}
            disabled={disabled || draft.pantangan_klien.length > 0}
            onChange={(e) => {
              if (e.target.checked) {
                onChange({ pantangan_klien: [], pantangan_klien_tidak_ada: true });
              } else {
                onChange({ pantangan_klien_tidak_ada: false });
              }
            }}
          />
          <span>Tidak ada pantangan / larangan eksplisit dari klien</span>
        </label>
        {!draft.pantangan_klien_tidak_ada && (
          <RepeatList<string>
            label=""
            rows={draft.pantangan_klien}
            onChange={(rows) => onChange({ pantangan_klien: rows, pantangan_klien_tidak_ada: false })}
            blank={() => ''}
            disabled={disabled}
            addLabel="Tambah pantangan"
            empty="Belum ada pantangan — atau centang di atas."
          >
            {(row, set) => (
              <input
                value={row}
                disabled={disabled}
                onChange={(e) => set(e.target.value as unknown as Partial<string>)}
              />
            )}
          </RepeatList>
        )}
      </div>

      {/* A-12 (read-only, dari Interview — teks bebas) --------------------- */}
      <InterviewMirror title="A-12 · Decision Maker" value={decisionMaker} />

      {/* A-13 -------------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">
          A-13 · SLA Klien <span className="badge badge-amber">Internal saja</span>
        </div>
        <div className="formRow">
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Berapa lama biasanya balas approval (jam)</span>
            <input
              type="number"
              min={1}
              value={draft.sla_klien_jam}
              disabled={disabled}
              onChange={(e) => onChange({ sla_klien_jam: e.target.value })}
              style={{ width: 120 }}
            />
          </label>
          <label className="field">
            <span className="muted" style={{ fontSize: 12 }}>Jam/hari kerja klien (catatan)</span>
            <input
              value={draft.sla_klien_catatan}
              disabled={disabled}
              onChange={(e) => onChange({ sla_klien_catatan: e.target.value })}
            />
          </label>
        </div>
      </div>

      {/* A-14 -------------------------------------------------------------- */}
      <div className="field" style={{ display: 'block' }}>
        <label style={{ fontWeight: 600 }}>A-14 · Aset dari Klien</label>
        <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
          Yang klien sediakan. Wajib dijawab — centang yang ada atau centang
          &ldquo;tidak ada&rdquo;.
        </p>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={draft.aset_dari_klien_tidak_ada}
            disabled={disabled || draft.aset_dari_klien.length > 0}
            onChange={(e) => {
              if (e.target.checked) {
                onChange({ aset_dari_klien: [], aset_dari_klien_tidak_ada: true });
              } else {
                onChange({ aset_dari_klien_tidak_ada: false });
              }
            }}
          />
          <span>Klien tidak menyediakan aset apa pun</span>
        </label>
        {!draft.aset_dari_klien_tidak_ada && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            {(Object.entries(CLIENT_ASSET_LABELS) as [ClientAsset, string][]).map(([v, label]) => (
              <label key={v} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={draft.aset_dari_klien.includes(v)}
                  disabled={disabled}
                  onChange={() => toggleAsset(v)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
        {!draft.aset_dari_klien_tidak_ada && draft.aset_dari_klien.length > 0 && (
          <label className="field" style={{ marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>Catatan tambahan (opsional)</span>
            <input
              value={draft.aset_catatan}
              disabled={disabled}
              onChange={(e) => onChange({ aset_catatan: e.target.value })}
            />
          </label>
        )}
      </div>

      {/* A-15 / A-16 ------------------------------------------------------- */}
      <div className="card">
        <div className="cardHeader">A-15 / A-16 · Akses &amp; Hak per Channel</div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Status akses per channel. Hanya akses berstatus <strong>Ditolak</strong> yang bisa
          ditandai memblokir eksekusi (A-16) dan wajib menyertakan target tanggal beres — status
          lain (Sudah/Pending/Tidak butuh akses) tidak menghentikan langkah berikutnya.
        </p>
        {contractChannels.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Belum ada channel — isi Section B dulu.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Channel / Akses</th>
                  {ACCESS_KINDS.map((k) => (
                    <th key={k} style={{ textAlign: 'center', minWidth: 110 }}>
                      {ACCESS_KIND_LABELS[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...contractChannels, 'Umum' as const].map((ch) => (
                  <tr key={ch}>
                    <td style={{ fontWeight: 500 }}>{ch}</td>
                    {ACCESS_KINDS.map((ak) => {
                      const row = aksesFor(ch, ak);
                      return (
                        <td key={ak} style={{ textAlign: 'center', verticalAlign: 'top' }}>
                          <div className="stack" style={{ gap: 4 }}>
                            <select
                              value={row?.status ?? ''}
                              disabled={disabled}
                              style={{ fontSize: 12 }}
                              onChange={(e) => {
                                if (!e.target.value) return;
                                const existing = row ?? {
                                  channel: ch as AccessChannel,
                                  akses: ak,
                                  status: 'pending' as AccessState,
                                  memblokir: false,
                                  target_tanggal_beres: '',
                                  catatan: '',
                                };
                                const nextStatus = e.target.value as AccessState;
                                // Only `ditolak` may block (A-16, owner QA 2026-08-24) — moving
                                // away from it drops a blocker flag the checkbox can no longer
                                // show, which would otherwise fail the save silently.
                                const stillBlocks = nextStatus === 'ditolak' && existing.memblokir;
                                setAksesCell(
                                  ch as AccessChannel,
                                  ak,
                                  nextStatus,
                                  stillBlocks,
                                  stillBlocks ? existing.target_tanggal_beres : '',
                                  existing.catatan,
                                );
                              }}
                            >
                              <option value="">—</option>
                              {ACCESS_STATES.map((s) => (
                                <option key={s} value={s}>{ACCESS_STATE_LABELS[s]}</option>
                              ))}
                            </select>
                            {row?.status === 'ditolak' && (
                              <>
                                <label style={{ display: 'flex', gap: 4, fontSize: 11, justifyContent: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={row.memblokir}
                                    disabled={disabled}
                                    onChange={(e) =>
                                      setAksesCell(
                                        ch as AccessChannel,
                                        ak,
                                        row.status,
                                        e.target.checked,
                                        row.target_tanggal_beres,
                                        row.catatan,
                                      )
                                    }
                                  />
                                  memblokir
                                </label>
                                {row.memblokir && (
                                  <input
                                    type="date"
                                    value={row.target_tanggal_beres}
                                    disabled={disabled}
                                    style={{ fontSize: 11 }}
                                    onChange={(e) =>
                                      setAksesCell(
                                        ch as AccessChannel,
                                        ak,
                                        row.status,
                                        row.memblokir,
                                        e.target.value,
                                        row.catatan,
                                      )
                                    }
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
