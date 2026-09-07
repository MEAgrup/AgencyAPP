'use client';

import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { FREQUENCIES, PRICING_MODES, type MasterService, type Pengakuan, type PlanTier, type QtyMenambah } from '@/lib/types';
import { TIER_LABELS } from '@/lib/account';
import { formatIDR } from '@/lib/money';
import {
  EMPTY_MSL_FORM,
  formatDurasiBulan,
  formToPayload,
  PENGAKUAN_LABELS,
  QTY_MENAMBAH_LABELS,
  saveMasterService,
  serviceToForm,
  todayISO,
  type MslFormState,
} from '@/lib/msl';

// "Batas Minimal" is stored as a DECIMAL string ("5.00") but is always a whole
// quantity (see backend parseWholeQty) — display it as a plain integer.
function formatQty(value: string | undefined): string {
  if (!value) return '—';
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return '—';
  return String(Math.trunc(n));
}

export default function MasterServicesPage() {
  const [effectiveAt, setEffectiveAt] = useState(todayISO());
  const [services, setServices] = useState<MasterService[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MslFormState>(EMPTY_MSL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [versionsByService, setVersionsByService] = useState<Record<string, MasterService[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsLoadingId, setVersionsLoadingId] = useState<string | null>(null);

  const load = useCallback(async (at: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: MasterService[] }>(`/master-services?effective_at=${at}`);
      setServices(res.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(effectiveAt);
  }, [load, effectiveAt]);

  function openCreateForm() {
    setEditingId(null);
    setForm(EMPTY_MSL_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(service: MasterService) {
    setEditingId(service.id);
    // `serviceToForm` reads back EVERY field the payload will send. That is not
    // tidiness: an update is a full replace, so a field this form does not carry
    // is erased in the new version — see `lib/msl.ts`.
    setForm(serviceToForm(service));
    setFormError(null);
    setShowForm(true);
  }

  const isPassthrough = form.pricing_mode === 'passthrough';
  const needsMinQty = form.pricing_mode === 'min_floor' || form.pricing_mode === 'batch_ceiling';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await saveMasterService(editingId, formToPayload(form));
      setShowForm(false);
      await load(effectiveAt);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleVersions(service: MasterService) {
    if (expandedId === service.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(service.id);
    if (versionsByService[service.id]) return;
    setVersionsError(null);
    setVersionsLoadingId(service.id);
    try {
      const res = await api.get<{ data: MasterService[] }>(`/master-services/${service.id}/versions`);
      setVersionsByService((prev) => ({ ...prev, [service.id]: res.data }));
    } catch (err) {
      setVersionsError(errorMessage(err));
    } finally {
      setVersionsLoadingId(null);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Master Service List</h1>
          <p className="muted">Harga standar &amp; aturan komisi per layanan.</p>
        </div>
        <button type="button" className="btn btnPrimary" onClick={openCreateForm}>
          Tambah Layanan
        </button>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="effective_at">Berlaku Pada Tanggal</label>
            <input
              id="effective_at"
              type="date"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
            />
          </div>
        </div>
      </section>

      {showForm && (
        <section className="card">
          <div className="cardHeader">
            <h2>{editingId ? 'Ubah Layanan' : 'Tambah Layanan'}</h2>
          </div>
          <form className="form" onSubmit={handleSubmit}>
            {formError && <div className="alert alertError" role="alert">{formError}</div>}
            <div className="formRow">
              <div className="field">
                <label htmlFor="name">Nama Layanan</label>
                <input
                  id="name"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="standard_price">Harga Standar (Rp)</label>
                <input
                  id="standard_price"
                  type="number"
                  min="0"
                  required={!isPassthrough}
                  disabled={isPassthrough}
                  value={isPassthrough ? '0' : form.standard_price}
                  onChange={(e) => setForm((f) => ({ ...f, standard_price: e.target.value }))}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="category">Kategori</label>
                <input
                  id="category"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="unit">Satuan</label>
                <input
                  id="unit"
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                />
              </div>
            </div>
            <div className="formRow">
              <div className="field">
                <label htmlFor="pricing_mode">Mode</label>
                <select
                  id="pricing_mode"
                  value={form.pricing_mode}
                  onChange={(e) => setForm((f) => ({ ...f, pricing_mode: e.target.value }))}
                >
                  {PRICING_MODES.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              {needsMinQty && (
                <div className="field">
                  <label htmlFor="min_qty">Batas Minimal</label>
                  <input
                    id="min_qty"
                    type="number"
                    min="1"
                    required
                    value={form.min_qty}
                    onChange={(e) => setForm((f) => ({ ...f, min_qty: e.target.value }))}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="frequency">Frekuensi</label>
                <select
                  id="frequency"
                  value={form.frequency}
                  onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{f === '' ? '—' : f}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="effective_from">Berlaku Sejak</label>
              <input
                id="effective_from"
                type="date"
                required
                value={form.effective_from}
                onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="commission_rule">Aturan Komisi</label>
              <input
                id="commission_rule"
                required
                placeholder="10% of standard price"
                value={form.commission_rule}
                onChange={(e) => setForm((f) => ({ ...f, commission_rule: e.target.value }))}
              />
              {/*
                Bentuk yang dibaca kalkulator hanya dua, dan sampai O73 tidak ada
                satu pun petunjuk di layar ini — 56 dari 96 versi katalog akhirnya
                tersimpan dengan aturan yang tidak bisa dihitung ("0", prosa),
                dan yang menanggung akibatnya sales di Qualified Lead Form.
                Server sekarang menolaknya, tapi ditolak setelah mengetik itu
                pelajaran yang mahal; tulis aturannya di sebelah kolomnya.
              */}
              <span className="muted" style={{ fontSize: 12 }}>
                Dua bentuk yang dikenali: <code>10% of standard price</code> atau{' '}
                <code>flat Rp 500.000</code>. Jasa tanpa komisi ditulis{' '}
                <code>0% of standard price</code>. Komisi yang nominalnya
                dirundingkan per-deal: pakai <code>flat Rp 0</code> di sini,
                jelaskan rumusnya di Catatan Harga, lalu tagih lewat layanan
                &ldquo;Komisi&rdquo;.
              </span>
            </div>
            <div className="field">
              <label htmlFor="price_note">Catatan Harga</label>
              <input
                id="price_note"
                value={form.price_note}
                onChange={(e) => setForm((f) => ({ ...f, price_note: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="description">Deskripsi</label>
              <textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="plan_tier">Kebutuhan Strategi &amp; Plan</label>
              <select
                id="plan_tier"
                value={form.plan_tier}
                onChange={(e) => setForm((f) => ({ ...f, plan_tier: e.target.value as PlanTier }))}
              >
                <option value="tanpa_plan">{TIER_LABELS.tanpa_plan}</option>
                <option value="ditentukan_am">{TIER_LABELS.ditentukan_am}</option>
                <option value="plan_wajib">{TIER_LABELS.plan_wajib}</option>
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                Menentukan jalur Kelola Klien layanan ini. <strong>Plan Wajib</strong> selalu menuntut
                Strategi &amp; Plan sebelum Brief; <strong>Plan Ditentukan AM</strong> menampilkan form
                penentuan dan mencatat keputusan AM; <strong>Tanpa Plan</strong> langsung ke Brief.
                Perubahan hanya berlaku untuk layanan yang di-closing SETELAH versi ini — engagement
                yang sedang jalan memakai versi yang sudah dipin.
              </span>
            </div>
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="durasi_bulan">Durasi Jasa (bulan)</label>
              <input
                id="durasi_bulan"
                type="number"
                min="1"
                step="1"
                placeholder="kosongkan bila sekali jadi"
                value={form.durasi_bulan}
                onChange={(e) => setForm((f) => ({ ...f, durasi_bulan: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                Berapa lama jasa ini berjalan, dalam <strong>bulan kalender</strong>, dihitung
                dari tanggal layanan <strong>mulai jalan</strong> (untuk Ads: start campaign —
                periode riset tidak dihitung). Dipakai Ads untuk Management Date dan menjadi
                dasar skedul pengakuan pendapatan.{' '}
                <strong>Kosongkan untuk layanan sekali jadi</strong> (mis. Jasa Pengajuan Shopee
                Mall): pendapatannya diakui sekaligus saat selesai, bukan disebar 1 bulan.
              </span>
            </div>
            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="qty_menambah">Kalau Klien Beli Lebih dari Satu</label>
              <select
                id="qty_menambah"
                value={form.qty_menambah}
                onChange={(e) => setForm((f) => ({ ...f, qty_menambah: e.target.value as QtyMenambah }))}
              >
                <option value="volume">{QTY_MENAMBAH_LABELS.volume}</option>
                <option value="durasi">{QTY_MENAMBAH_LABELS.durasi}</option>
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                <strong>Durasi</strong> = qty adalah jumlah periode, jadi durasi total ={' '}
                qty &times; durasi di atas (GMV Max beli 3 berarti 3 bulan). Pilihan ini{' '}
                <strong>wajib punya durasi</strong> di atas — kalau kosong, tidak ada yang bisa
                dikali dan simpanan ditolak.{' '}
                <strong>Volume</strong> = qty adalah jumlah keluaran dalam periode yang sama
                (Nano KOL beli 10 berarti 10 KOL, durasinya tidak berubah).
              </span>
            </div>
            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="pengakuan">Kapan Pendapatannya Diakui</label>
              <select
                id="pengakuan"
                value={form.pengakuan}
                onChange={(e) => setForm((f) => ({ ...f, pengakuan: e.target.value as Pengakuan }))}
              >
                <option value="saat_selesai">{PENGAKUAN_LABELS.saat_selesai}</option>
                <option value="per_periode">{PENGAKUAN_LABELS.per_periode}</option>
                <option value="bulan_berikutnya">{PENGAKUAN_LABELS.bulan_berikutnya}</option>
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                Menentukan <strong>bulan mana</strong> yang mengakui pendapatan layanan ini di
                laporan keuangan.{' '}
                <strong>Penuh saat selesai</strong> untuk layanan sekali jadi (Jasa Pengajuan
                Shopee Mall, Nano KOL).{' '}
                <strong>Rata sepanjang durasi</strong> untuk layanan berjalan (GMV Max, Store
                Management) — pilihan ini <strong>wajib punya durasi</strong> di atas, kalau
                kosong simpanan ditolak.{' '}
                <strong>Bulan berikutnya</strong> khusus <strong>Komisi</strong>: angkanya baru
                diketahui bulan depan, jadi diakui satu bulan sesudah penjualannya. Penanda ini{' '}
                <strong>tidak bisa ditebak dari durasi</strong> — Komisi dan Jasa Pengajuan Shopee
                Mall dua-duanya tanpa durasi, dengan arti yang berbeda.
              </span>
            </div>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.apply_ppn}
                onChange={(e) => setForm((f) => ({ ...f, apply_ppn: e.target.checked }))}
              />
              PPN
            </label>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              Aktif
            </label>
            <div className="row" style={{ gap: 10 }}>
              <button type="submit" className="btn btnPrimary" disabled={submitting}>
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button type="button" className="btn btnGhost" onClick={() => setShowForm(false)}>
                Batal
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        {loading && <p className="muted">Memuat...</p>}
        {error && <div className="alert alertError">{error}</div>}
        {!loading && !error && services && services.length === 0 && (
          <div className="emptyState">Belum ada layanan pada tanggal ini.</div>
        )}
        {!loading && !error && services && services.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Kategori</th>
                  <th>Satuan</th>
                  <th>Batas Minimal</th>
                  <th>Harga Standar</th>
                  <th>Aturan Komisi</th>
                  <th>Mode</th>
                  <th>PPN</th>
                  <th>Frekuensi</th>
                  <th>Durasi Jasa</th>
                  <th>Qty Menambah</th>
                  <th>Pengakuan</th>
                  <th>Strategi &amp; Plan</th>
                  <th>Aktif</th>
                  <th>Versi</th>
                  <th>Berlaku Sejak</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <Fragment key={s.id}>
                    <tr>
                      <td>{s.name}</td>
                      <td>{s.category || '—'}</td>
                      <td>{s.unit || '—'}</td>
                      <td>{formatQty(s.min_qty)}</td>
                      <td>{formatIDR(s.standard_price)}</td>
                      <td>{s.commission_rule}</td>
                      <td>{s.pricing_mode || 'flat'}</td>
                      <td>{s.apply_ppn ? 'Ya' : 'Tidak'}</td>
                      <td>{s.frequency || '—'}</td>
                      <td>{formatDurasiBulan(s.durasi_bulan)}</td>
                      <td>{s.qty_menambah === 'durasi' ? 'Durasi' : 'Volume'}</td>
                      <td>{PENGAKUAN_LABELS[s.pengakuan]}</td>
                      <td>{TIER_LABELS[s.plan_tier]}</td>
                      <td>
                        <span className={`badge badge-${s.active ? 'green' : 'darkgray'}`}>
                          {s.active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td>{s.version_no}</td>
                      <td>{s.effective_from}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button type="button" className="btn btnSecondary btnSm" onClick={() => openEditForm(s)}>
                            Ubah
                          </button>
                          <button type="button" className="btn btnGhost btnSm" onClick={() => toggleVersions(s)}>
                            {expandedId === s.id ? 'Tutup Riwayat' : 'Riwayat Versi'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr>
                        <td colSpan={17} style={{ background: 'var(--color-bg)' }}>
                          {versionsLoadingId === s.id && <p className="muted">Memuat riwayat versi...</p>}
                          {versionsError && <div className="alert alertError">{versionsError}</div>}
                          {versionsByService[s.id] && versionsByService[s.id].length > 0 && (
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Versi</th>
                                  <th>Kategori</th>
                                  <th>Satuan</th>
                                  <th>Batas Minimal</th>
                                  <th>Harga Standar</th>
                                  <th>Aturan Komisi</th>
                                  <th>Mode</th>
                                  <th>PPN</th>
                                  <th>Frekuensi</th>
                                  <th>Durasi Jasa</th>
                                  <th>Qty Menambah</th>
                                  <th>Pengakuan</th>
                                  <th>Strategi &amp; Plan</th>
                                  <th>Aktif</th>
                                  <th>Berlaku Sejak</th>
                                </tr>
                              </thead>
                              <tbody>
                                {versionsByService[s.id].map((v) => (
                                  <tr key={v.version_no}>
                                    <td>{v.version_no}</td>
                                    <td>{v.category || '—'}</td>
                                    <td>{v.unit || '—'}</td>
                                    <td>{formatQty(v.min_qty)}</td>
                                    <td>{formatIDR(v.standard_price)}</td>
                                    <td>{v.commission_rule}</td>
                                    <td>{v.pricing_mode || 'flat'}</td>
                                    <td>{v.apply_ppn ? 'Ya' : 'Tidak'}</td>
                                    <td>{v.frequency || '—'}</td>
                                    <td>{formatDurasiBulan(v.durasi_bulan)}</td>
                                    <td>{v.qty_menambah === 'durasi' ? 'Durasi' : 'Volume'}</td>
                                    <td>{PENGAKUAN_LABELS[v.pengakuan]}</td>
                                    <td>{TIER_LABELS[v.plan_tier]}</td>
                                    <td>{v.active ? 'Aktif' : 'Nonaktif'}</td>
                                    <td>{v.effective_from}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {versionsByService[s.id] && versionsByService[s.id].length === 0 && (
                            <p className="muted">Tidak ada riwayat versi.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
