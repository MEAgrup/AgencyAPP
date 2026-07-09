'use client';

import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { MasterService } from '@/lib/types';
import { formatIDR } from '@/lib/money';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

interface FormState {
  name: string;
  standard_price: string;
  commission_rule: string;
  active: boolean;
}

const EMPTY_FORM: FormState = { name: '', standard_price: '', commission_rule: '', active: true };

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
      active: service.active,
    });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    const payload = {
      name: form.name,
      standard_price: Number(form.standard_price),
      commission_rule: form.commission_rule,
      active: form.active,
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
                  required
                  value={form.standard_price}
                  onChange={(e) => setForm((f) => ({ ...f, standard_price: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="commission_rule">Aturan Komisi</label>
              <input
                id="commission_rule"
                required
                value={form.commission_rule}
                onChange={(e) => setForm((f) => ({ ...f, commission_rule: e.target.value }))}
              />
            </div>
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
                  <th>Harga Standar</th>
                  <th>Aturan Komisi</th>
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
                      <td>{formatIDR(s.standard_price)}</td>
                      <td>{s.commission_rule}</td>
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
                        <td colSpan={7} style={{ background: 'var(--color-bg)' }}>
                          {versionsLoadingId === s.id && <p className="muted">Memuat riwayat versi...</p>}
                          {versionsError && <div className="alert alertError">{versionsError}</div>}
                          {versionsByService[s.id] && versionsByService[s.id].length > 0 && (
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Versi</th>
                                  <th>Harga Standar</th>
                                  <th>Aturan Komisi</th>
                                  <th>Aktif</th>
                                  <th>Berlaku Sejak</th>
                                </tr>
                              </thead>
                              <tbody>
                                {versionsByService[s.id].map((v) => (
                                  <tr key={v.version_no}>
                                    <td>{v.version_no}</td>
                                    <td>{formatIDR(v.standard_price)}</td>
                                    <td>{v.commission_rule}</td>
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
