'use client';

import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { FREQUENCIES, PRICING_MODES, type MasterService } from '@/lib/types';
import { formatIDR } from '@/lib/money';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// "Batas Minimal" is stored as a DECIMAL string ("5.00") but is always a whole
// quantity (see backend parseWholeQty) — display it as a plain integer.
function formatQty(value: string | undefined): string {
  if (!value) return '—';
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return '—';
  return String(Math.trunc(n));
}

interface FormState {
  name: string;
  standard_price: string;
  commission_rule: string;
  category: string;
  unit: string;
  min_qty: string;
  pricing_mode: string;
  apply_ppn: boolean;
  frequency: string;
  price_note: string;
  description: string;
  active: boolean;
  effective_from: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  standard_price: '',
  commission_rule: '',
  category: '',
  unit: '',
  min_qty: '',
  pricing_mode: 'flat',
  apply_ppn: false,
  frequency: '',
  price_note: '',
  description: '',
  active: true,
  effective_from: todayISO(),
};

export default function MasterServicesPage() {
  const [effectiveAt, setEffectiveAt] = useState(todayISO());
  const [services, setServices] = useState<MasterService[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
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
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(service: MasterService) {
    setEditingId(service.id);
    setForm({
      name: service.name,
      standard_price: String(service.standard_price),
      commission_rule: service.commission_rule,
      category: service.category,
      unit: service.unit,
      min_qty: service.min_qty,
      pricing_mode: service.pricing_mode || 'flat',
      apply_ppn: service.apply_ppn,
      frequency: service.frequency,
      price_note: service.price_note,
      description: service.description,
      active: service.active,
      effective_from: todayISO(),
    });
    setFormError(null);
    setShowForm(true);
  }

  const isPassthrough = form.pricing_mode === 'passthrough';
  const needsMinQty = form.pricing_mode === 'min_floor' || form.pricing_mode === 'batch_ceiling';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    // Backend expects standard_price as a decimal string and requires effective_from.
    const payload = {
      name: form.name,
      standard_price: isPassthrough ? '0' : form.standard_price,
      commission_rule: form.commission_rule,
      category: form.category,
      unit: form.unit,
      min_qty: needsMinQty ? form.min_qty : '',
      pricing_mode: form.pricing_mode,
      apply_ppn: form.apply_ppn,
      frequency: form.frequency,
      price_note: form.price_note,
      description: form.description,
      active: form.active,
      effective_from: form.effective_from,
    };
    try {
      if (editingId) {
        await api.put(`/master-services/${editingId}`, payload);
      } else {
        await api.post('/master-services', payload);
      }
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
                placeholder="0% of standard price"
                aria-describedby="commission_rule_hint"
                value={form.commission_rule}
                onChange={(e) => setForm((f) => ({ ...f, commission_rule: e.target.value }))}
              />
              {/*
                Free text with no stated grammar is how "10%" got saved and then
                broke every quote downstream. The server rejects anything outside
                these two shapes (DECISIONS O14); say so before the trip to it.
              */}
              <p className="muted" id="commission_rule_hint" style={{ fontSize: 12 }}>
                Hanya dua bentuk: <code>&lt;N&gt;% of standard price</code> (mis.{' '}
                <code>0% of standard price</code>) atau <code>flat Rp &lt;N&gt;</code> (mis.{' '}
                <code>flat Rp 500.000</code>).
              </p>
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
                        <td colSpan={12} style={{ background: 'var(--color-bg)' }}>
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
