'use client';

/**
 * Employee picker for every assignment door: AM penunjukan (M6 §3), Brief PIC per
 * division (M6 §5), Task PIC (M12 §5.3), Asset PIC (M7 §2), Booking Coordinator
 * (M9 §3).
 *
 * Replaces free-text "Employee ID" boxes — and, on `/account`, a literal
 * `window.prompt("Employee ID Account Manager untuk klien X")`. Nobody memorises
 * `EMP-…` for their own division, let alone another's, so the field was mistyped
 * (the server answers the right BI message but never says who IS valid) or
 * skipped, and the assignment column stayed empty while the work happened
 * anyway. Same defect class, and the same fix, as the campaign picker.
 *
 * A search box over a <select> rather than a custom combobox: one native control
 * per job (type to narrow, then pick), keyboard- and screen-reader-correct with
 * no focus management of our own, and the filtering rule is a pure function that
 * is unit-tested (lib/employee-picker.ts).
 *
 * The list is asked for PER DOOR (`division` + `level`), so what it offers is
 * exactly what that door's server-side validation accepts. Presentational and
 * fully controlled: the owner holds `value` and does the fetching (via
 * `useAssignableEmployees`), so the same picker serves all nine call sites.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { employeeLabel, filterEmployees, groupByDivision } from '@/lib/employee-picker';
import type { AssignableEmployee } from '@/lib/types';

interface Props {
  /** null while loading / after a failed load. */
  employees: AssignableEmployee[] | null;
  loading: boolean;
  /** Verbatim message from a failed load (already BI where the server sent one). */
  error: string | null;
  /** '' (nothing picked) | an employee_id. */
  value: string;
  onChange: (value: string) => void;
  /** Field label. Defaults to a neutral "PIC". */
  label?: string;
  required?: boolean;
  disabled?: boolean;
  /** id of the <select>, so the caller's own label/tests can target it. */
  id?: string;
  /**
   * Extra note per row, appended to the label — used by the AM door to show each
   * AM's active-client count (M6 §3 Rule 5 workload reference, not a hard cap).
   * Derived server-side; this only renders it.
   */
  hint?: (e: AssignableEmployee) => string;
  /**
   * Shown when the list loads but is empty, i.e. the division genuinely has no
   * assignable staff. Says what to DO, because the picker cannot fix it: the
   * employee needs importing or their HRIS jabatan needs a role mapping.
   */
  emptyHint?: string;
  /**
   * Always-visible note under the control. Used by the AM door to say which
   * jabatan qualify (AM and CRO are the same function — owner 2026-08-04) and
   * where to go when somebody expected is missing, since the answer is a role
   * mapping and no picker can fix that by itself.
   */
  note?: ReactNode;
}

export default function EmployeePicker({
  employees,
  loading,
  error,
  value,
  onChange,
  label = 'PIC',
  required,
  disabled,
  id = 'employee-picker',
  hint,
  emptyHint,
  note,
}: Props) {
  const [query, setQuery] = useState('');

  // Memoised so the empty-list fallback keeps a stable identity — otherwise the
  // filter below re-runs on every render (and eslint's exhaustive-deps says so).
  const list = useMemo(() => employees ?? [], [employees]);
  // Keep the picked employee in the option list even when the query excludes it,
  // or narrowing the search after choosing would silently reselect someone else.
  const shown = useMemo(() => filterEmployees(list, query, value), [list, query, value]);
  // Group only when the caller did NOT narrow to one division (the per-door
  // pickers pass one, so their list is flat).
  const groups = useMemo(() => groupByDivision(shown), [shown]);
  const multiDivision = groups.length > 1;
  const picked = value !== '' ? list.find((e) => e.employee_id === value) : undefined;

  const optionLabel = (e: AssignableEmployee): string => {
    const extra = hint?.(e) ?? '';
    return extra === '' ? employeeLabel(e) : `${employeeLabel(e)} · ${extra}`;
  };

  // Load failure = fall back to a manual Employee ID field rather than a dead
  // form. This is the ONLY place a raw id is still typed, and it exists because a
  // dropdown that cannot load must not become a wall: an unreachable directory
  // (a deploy where the picker's migration is not applied yet, a transient 500)
  // would otherwise block every assignment. The server validates either way.
  if (error !== null) {
    return (
      <div className="field">
        <label htmlFor={`${id}-manual`}>{label}</label>
        <input
          id={`${id}-manual`}
          type="text"
          required={required}
          disabled={disabled}
          placeholder="Employee ID (jalan darurat)"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <span className="muted" style={{ fontSize: 12 }} role="alert">
          Daftar karyawan gagal dimuat: {error} &mdash; sementara masukkan Employee ID manual.
        </span>
        {note && <span className="muted" style={{ fontSize: 12 }}>{note}</span>}
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? '' : ' (opsional)'}
      </label>

      {/* Search is a plain filter over the loaded list — no request per keystroke. */}
      <input
        id={`${id}-search`}
        type="search"
        placeholder="Cari karyawan — nama, jabatan, atau ID"
        aria-label="Cari karyawan"
        value={query}
        disabled={disabled || loading || list.length === 0}
        onChange={(e) => setQuery(e.target.value)}
      />

      <select
        id={id}
        value={value}
        required={required}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{loading ? 'Memuat karyawan...' : '— pilih karyawan —'}</option>
        {multiDivision
          ? groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((e) => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {optionLabel(e)}
                  </option>
                ))}
              </optgroup>
            ))
          : shown.map((e) => (
              <option key={e.employee_id} value={e.employee_id}>
                {optionLabel(e)}
              </option>
            ))}
      </select>

      {note && <span className="muted" style={{ fontSize: 12 }}>{note}</span>}
      {!loading && list.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          {emptyHint ??
            'Belum ada karyawan aktif yang bisa ditugaskan. Impor karyawannya di Admin › Karyawan, ' +
              'lalu pastikan jabatan HRIS-nya sudah punya role mapping.'}
        </span>
      )}
      {!loading && list.length > 0 && query !== '' && shown.length === 0 && (
        <span className="muted" style={{ fontSize: 12 }}>
          Tidak ada karyawan yang cocok dengan &ldquo;{query}&rdquo;.
        </span>
      )}
      {/* Echo the choice, id included: that id is what the server stores and what
          shows up in the audit trail, so it is worth seeing before submitting. */}
      {picked && (
        <span className="muted" style={{ fontSize: 12 }} data-testid={`${id}-picked`}>
          Dipilih: {picked.nama} ({picked.employee_id}) &middot; {picked.division} &middot; {picked.level}
        </span>
      )}
    </div>
  );
}
