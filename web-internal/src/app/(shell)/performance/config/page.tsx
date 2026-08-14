'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  COMPONENT_LABELS,
  ROLE_TYPES,
  TARGET_STAFF_ALL,
  divisionOfRole,
  getTargetsConfig,
  getWeightsConfig,
  updateTargetsConfig,
  updateWeightsConfig,
  type KPIWeight,
  type PeriodTarget,
} from '@/lib/performance';
import { listAssignableEmployees } from '@/lib/directory';
import { employeeLabel } from '@/lib/employee-picker';
import type { AssignableEmployee } from '@/lib/types';

export default function PerformanceConfigPage() {
  const { role } = useAuth();
  const isDirector = role?.director;

  // Weights config
  const [weights, setWeights] = useState<KPIWeight[] | null>(null);
  const [weightsLoading, setWeightsLoading] = useState(true);
  const [weightsError, setWeightsError] = useState<string | null>(null);

  // Targets config
  const [targets, setTargets] = useState<PeriodTarget[] | null>(null);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [targetsError, setTargetsError] = useState<string | null>(null);

  // Edit weights state (per role_type)
  const [editingRoleType, setEditingRoleType] = useState<string | null>(null);
  const [editWeights, setEditWeights] = useState<Record<string, string>>({});
  const [weightsSubmitting, setWeightsSubmitting] = useState(false);
  const [weightsUpdateError, setWeightsUpdateError] = useState<string | null>(null);
  const [weightsUpdateMessage, setWeightsUpdateMessage] = useState<string | null>(null);

  // Edit target state
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [editTargetValue, setEditTargetValue] = useState('');
  const [editTargetPlaceholder, setEditTargetPlaceholder] = useState(false);
  const [editTargetPeriod, setEditTargetPeriod] = useState('');
  const [targetSubmitting, setTargetSubmitting] = useState(false);
  const [targetUpdateError, setTargetUpdateError] = useState<string | null>(null);
  const [targetUpdateMessage, setTargetUpdateMessage] = useState<string | null>(null);

  const loadWeights = useCallback(async () => {
    setWeightsLoading(true);
    setWeightsError(null);
    try {
      const res = await getWeightsConfig();
      setWeights(res.data);
    } catch (err) {
      setWeightsError(errorMessage(err));
    } finally {
      setWeightsLoading(false);
    }
  }, []);

  const loadTargets = useCallback(async () => {
    setTargetsLoading(true);
    setTargetsError(null);
    try {
      const res = await getTargetsConfig();
      setTargets(res.data);
    } catch (err) {
      setTargetsError(errorMessage(err));
    } finally {
      setTargetsLoading(false);
    }
  }, []);

  // GET weights/targets terbuka untuk semua role CDPS; hanya PUT yang Director-only —
  // semua role boleh melihat tabel, tombol/form ubah hanya dirender untuk Director.
  useEffect(() => {
    loadWeights();
    loadTargets();
  }, [loadWeights, loadTargets]);

  function startEditWeights(roleType: string) {
    const roleWeights = weights?.filter((w) => w.role_type === roleType) || [];
    const map: Record<string, string> = {};
    roleWeights.forEach((w) => {
      map[w.component] = w.weight.toString();
    });
    setEditWeights(map);
    setEditingRoleType(roleType);
    setWeightsUpdateError(null);
    setWeightsUpdateMessage(null);
  }

  async function handleSaveWeights(e: FormEvent) {
    e.preventDefault();
    if (!editingRoleType) return;

    // Validasi Σ = 100
    const total = Object.values(editWeights).reduce((sum, v) => {
      const num = parseFloat(v) || 0;
      return sum + num;
    }, 0);

    if (Math.abs(total - 100) > 1e-6) {
      // Pesan BI verbatim backend (perf.go ErrWeightsNotHundred); info total = teks UI biasa.
      setWeightsUpdateError(`[total bobot KPI harus berjumlah 100] — total saat ini: ${total.toFixed(2)}`);
      return;
    }

    setWeightsUpdateError(null);
    setWeightsUpdateMessage(null);
    setWeightsSubmitting(true);

    try {
      const weightMap: Record<string, number> = {};
      Object.entries(editWeights).forEach(([comp, val]) => {
        weightMap[comp] = parseFloat(val) || 0;
      });

      await updateWeightsConfig(editingRoleType, weightMap);
      setWeightsUpdateMessage(`Bobot untuk ${editingRoleType} telah disimpan.`);
      setEditingRoleType(null);
      await loadWeights();
    } catch (err) {
      setWeightsUpdateError(errorMessage(err));
    } finally {
      setWeightsSubmitting(false);
    }
  }

  function startEditTarget(target: PeriodTarget) {
    setEditingTargetId(`${target.role_type}|${target.component}|${target.staff_id}|${target.period_start}`);
    setEditTargetValue(target.target_value.toString());
    setEditTargetPlaceholder(target.is_placeholder);
    setEditTargetPeriod(target.period_start);
    setTargetUpdateError(null);
    setTargetUpdateMessage(null);
  }

  async function handleSaveTarget(e: FormEvent, target: PeriodTarget) {
    e.preventDefault();
    setTargetUpdateError(null);
    setTargetUpdateMessage(null);
    setTargetSubmitting(true);

    try {
      await updateTargetsConfig(
        target.role_type,
        target.component,
        parseFloat(editTargetValue) || 0,
        editTargetPlaceholder,
        editTargetPeriod || '',
        target.staff_id
      );
      setTargetUpdateMessage(
        `Target untuk ${target.role_type}/${COMPONENT_LABELS[target.component] || target.component} telah disimpan.`
      );
      setEditingTargetId(null);
      await loadTargets();
    } catch (err) {
      setTargetUpdateError(errorMessage(err));
    } finally {
      setTargetSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <Link href="/performance" className="muted">
        &larr; Kembali ke Team Performance
      </Link>

      <div>
        <h1>Konfigurasi KPI Performa</h1>
        <p className="muted">
          Kelola bobot komponen KPI dan target periode untuk perhitungan skor performa tim per role.
          Perubahan hanya mempengaruhi snapshot BERIKUTNYA, bukan snapshot yang sudah dibuat.
        </p>
      </div>

      {/* Weights Section */}
      <section className="card">
        <h2>Bobot Komponen KPI</h2>
        <p className="muted" style={{ marginBottom: '16px' }}>
          Atur bobot setiap komponen per role_type. Total bobot harus tepat 100.
        </p>

        {weightsError && <div className="alert alertError" role="alert">{weightsError}</div>}

        {weightsLoading && <p className="muted">Memuat...</p>}

        {!weightsLoading && !weightsError && weights && (
          <>
            {ROLE_TYPES.map((roleType) => {
              const roleWeights = weights.filter((w) => w.role_type === roleType);
              const isEditing = editingRoleType === roleType;
              const totalWeight = roleWeights.reduce((sum, w) => sum + w.weight, 0);

              return (
                <div key={roleType} style={{ marginBottom: '24px', borderBottom: '1px solid var(--color-border)', paddingBottom: '16px' }}>
                  <div className="row" style={{ justifyContent: 'space-between', marginBottom: '12px' }}>
                    <h3>{roleType}</h3>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                      Total: <strong>{totalWeight.toFixed(1)}%</strong>
                    </span>
                  </div>

                  {!isEditing ? (
                    <>
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Komponen</th>
                              <th style={{ textAlign: 'right' }}>Bobot</th>
                            </tr>
                          </thead>
                          <tbody>
                            {roleWeights.map((w) => (
                              <tr key={w.component}>
                                <td>{COMPONENT_LABELS[w.component] || w.component}</td>
                                <td style={{ textAlign: 'right' }}>{w.weight.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {isDirector && (
                        <button
                          className="btn btnSecondary btnSm"
                          onClick={() => startEditWeights(roleType)}
                          style={{ marginTop: '12px' }}
                        >
                          Ubah Bobot
                        </button>
                      )}
                    </>
                  ) : (
                    <form onSubmit={handleSaveWeights} className="form">
                      {weightsUpdateError && (
                        <div className="alert alertError" role="alert">{weightsUpdateError}</div>
                      )}
                      {weightsUpdateMessage && (
                        <div className="alert alertSuccess" role="status">{weightsUpdateMessage}</div>
                      )}

                      {roleWeights.map((w) => (
                        <div className="field" key={w.component}>
                          <label htmlFor={`weight-${roleType}-${w.component}`}>
                            {COMPONENT_LABELS[w.component] || w.component}
                          </label>
                          <input
                            id={`weight-${roleType}-${w.component}`}
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            value={editWeights[w.component] || ''}
                            onChange={(e) =>
                              setEditWeights((prev) => ({
                                ...prev,
                                [w.component]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}

                      <div style={{ marginTop: '16px' }}>
                        <button
                          type="submit"
                          className="btn btnPrimary"
                          disabled={weightsSubmitting}
                        >
                          {weightsSubmitting ? 'Menyimpan...' : 'Simpan Bobot'}
                        </button>
                        <button
                          type="button"
                          className="btn btnSecondary"
                          onClick={() => setEditingRoleType(null)}
                          style={{ marginLeft: '8px' }}
                          disabled={weightsSubmitting}
                        >
                          Batal
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </>
        )}
      </section>

      {/* Targets Section */}
      <section className="card">
        <h2>Target Periode</h2>
        <p className="muted" style={{ marginBottom: '16px' }}>
          Target normalisasi per komponen dan periode. Jika periode kosong, target berlaku untuk semua periode.
        </p>

        {targetsError && <div className="alert alertError" role="alert">{targetsError}</div>}

        {targetsLoading && <p className="muted">Memuat...</p>}

        {!targetsLoading && !targetsError && targets && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Komponen</th>
                  <th>Staff</th>
                  <th>Periode</th>
                  <th style={{ textAlign: 'right' }}>Target Value</th>
                  <th>Placeholder</th>
                  <th style={{ textAlign: 'center' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((target) => {
                  const editId = `${target.role_type}|${target.component}|${target.staff_id}|${target.period_start}`;
                  const isEditing = editingTargetId === editId;

                  return (
                    <tr key={editId}>
                      <td>{target.role_type}</td>
                      <td>{COMPONENT_LABELS[target.component] || target.component}</td>
                      <td>
                        {/* '*' = default role (berlaku untuk semua staff role ini);
                            selain itu = target khusus satu staff (T-1). */}
                        {target.staff_id === TARGET_STAFF_ALL ? (
                          <span className="muted">Semua Staff</span>
                        ) : (
                          <code>{target.staff_id}</code>
                        )}
                      </td>
                      <td>
                        {/* PUT targets = UPSERT keyed (role_type, component, period_start) —
                            periode dikunci saat mengubah baris agar tidak membuat baris baru. */}
                        {target.period_start || 'Semua Periode'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            value={editTargetValue}
                            onChange={(e) => setEditTargetValue(e.target.value)}
                            style={{ width: '80px' }}
                          />
                        ) : (
                          target.target_value.toFixed(2)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <label style={{ display: 'flex', gap: '4px' }}>
                            <input
                              type="checkbox"
                              checked={editTargetPlaceholder}
                              onChange={(e) => setEditTargetPlaceholder(e.target.checked)}
                            />
                            Placeholder
                          </label>
                        ) : target.is_placeholder ? (
                          <span className="badge badge-amber">Placeholder</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {!isEditing ? (
                          isDirector ? (
                            <button
                              className="btn btnGhost btnSm"
                              onClick={() => startEditTarget(target)}
                            >
                              Ubah
                            </button>
                          ) : (
                            '—'
                          )
                        ) : (
                          <button
                            className="btn btnGhost btnSm"
                            onClick={(e) => handleSaveTarget(e, target)}
                            disabled={targetSubmitting}
                          >
                            {targetSubmitting ? '...' : 'Simpan'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {targetUpdateError && <div className="alert alertError" role="alert" style={{ marginTop: '16px' }}>{targetUpdateError}</div>}
        {targetUpdateMessage && <div className="alert alertSuccess" role="status" style={{ marginTop: '16px' }}>{targetUpdateMessage}</div>}

        {isDirector && weights && (
          <AddStaffTargetForm weights={weights} onSaved={loadTargets} />
        )}
      </section>
    </div>
  );
}

/**
 * AddStaffTargetForm — Director-only form to set a target for ONE specific staff
 * member (T-1 / O9). Role-level targets already exist as seed rows edited inline
 * above; this form is the only way to create a per-staff override row. Omitting
 * the staff leaves the role default untouched — that is what the inline editor is
 * for — so the staff picker is required here.
 */
function AddStaffTargetForm({ weights, onSaved }: { weights: KPIWeight[]; onSaved: () => Promise<void> }) {
  const [roleType, setRoleType] = useState<string>(ROLE_TYPES[0]);
  const [component, setComponent] = useState<string>('');
  const [staffId, setStaffId] = useState<string>('');
  const [period, setPeriod] = useState<string>(''); // "YYYY-MM"; "" = default (semua periode)
  const [value, setValue] = useState<string>('');
  const [placeholder, setPlaceholder] = useState<boolean>(false);
  const [staff, setStaff] = useState<AssignableEmployee[] | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const components = weights
    .filter((w) => w.role_type === roleType)
    .map((w) => w.component);

  // Default the component to the role's first once the role (or weights) resolve.
  useEffect(() => {
    if (components.length > 0 && !components.includes(component)) {
      setComponent(components[0]);
    }
  }, [roleType, components, component]);

  // Load the assignable staff for the selected role's division. Re-fetch on role
  // change; reset the chosen staff so a stale id from another division never sticks.
  useEffect(() => {
    let alive = true;
    setStaff(null);
    setStaffError(null);
    setStaffId('');
    listAssignableEmployees(divisionOfRole(roleType))
      .then((res) => {
        if (alive) setStaff(res.data);
      })
      .catch((err) => {
        if (alive) setStaffError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [roleType]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!component) {
      setError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    if (!staffId) {
      setError('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
      return;
    }
    setSubmitting(true);
    try {
      // "YYYY-MM" → "YYYY-MM-01" (first-of-month, matching the period sentinel scheme).
      const periodStart = period ? `${period}-01` : '';
      await updateTargetsConfig(roleType, component, parseFloat(value) || 0, placeholder, periodStart, staffId);
      setMessage(`Target per-staff untuk ${staffId} telah disimpan.`);
      setValue('');
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ marginTop: '24px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
      <h3>Tambah Target Per-Staff</h3>
      <p className="muted" style={{ marginBottom: '12px' }}>
        Target khusus satu staff menimpa target default role-nya untuk komponen &amp; periode itu (T-1).
        Kosongkan periode agar berlaku untuk semua bulan.
      </p>
      <form onSubmit={submit} className="form">
        {error && <div className="alert alertError" role="alert">{error}</div>}
        {message && <div className="alert alertSuccess" role="status">{message}</div>}

        <div className="field">
          <label htmlFor="add-target-role">Role</label>
          <select id="add-target-role" value={roleType} onChange={(e) => setRoleType(e.target.value)}>
            {ROLE_TYPES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="add-target-component">Komponen</label>
          <select id="add-target-component" value={component} onChange={(e) => setComponent(e.target.value)}>
            {components.map((c) => (
              <option key={c} value={c}>{COMPONENT_LABELS[c] || c}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="add-target-staff">Staff</label>
          {staffError ? (
            <div className="alert alertError" role="alert">{staffError}</div>
          ) : (
            <select
              id="add-target-staff"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              disabled={staff === null}
            >
              <option value="">{staff === null ? 'Memuat...' : '— pilih staff —'}</option>
              {(staff || []).map((emp) => (
                <option key={emp.employee_id} value={emp.employee_id}>{employeeLabel(emp)}</option>
              ))}
            </select>
          )}
        </div>

        <div className="field">
          <label htmlFor="add-target-period">Periode (bulan)</label>
          <input
            id="add-target-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="add-target-value">Target Value</label>
          <input
            id="add-target-value"
            type="number"
            step="0.1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>

        <div className="field">
          <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={placeholder}
              onChange={(e) => setPlaceholder(e.target.checked)}
            />
            Tandai sebagai placeholder (belum dikonfirmasi)
          </label>
        </div>

        <div style={{ marginTop: '12px' }}>
          <button type="submit" className="btn btnPrimary" disabled={submitting}>
            {submitting ? 'Menyimpan...' : 'Simpan Target Per-Staff'}
          </button>
        </div>
      </form>
    </div>
  );
}
